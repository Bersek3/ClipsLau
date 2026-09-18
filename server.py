import os
import io
import json
import base64
import webbrowser
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response, JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from audio_engine import audio_engine, load_config, save_config, CONFIG_FILE
import db

app = FastAPI(title="Fish Audio Real-Time Voice Changer with MongoDB Auth")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed MongoDB with default 28 voices on server boot
try:
    _initial_voices = load_config().get("voices", [])
    db.seed_default_voices(_initial_voices)
except Exception as _e:
    print(f"[Startup] Advertencia inicializando DB: {_e}")

# Ensure static folder exists
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

class TTSRequest(BaseModel):
    text: str
    reference_id: Optional[str] = None
    model: Optional[str] = None
    play_now: Optional[bool] = True

class ConfigUpdateRequest(BaseModel):
    api_key: Optional[str] = None
    selected_voice: Optional[str] = None
    model: Optional[str] = None
    language: Optional[str] = None
    input_device: Optional[int] = None
    output_device_primary: Optional[int] = None
    output_device_secondary: Optional[int] = None
    hear_myself: Optional[bool] = None
    volume: Optional[float] = None
    speed: Optional[float] = None

class VoiceItem(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    sample_text: Optional[str] = ""

class ReplayRequest(BaseModel):
    audio_base64: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

# Helper to retrieve current authenticated user from Authorization header
def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    payload = db.verify_token(token)
    if not payload:
        return None
    return db.get_user_by_id(payload.get("user_id"))

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Fish Audio Voice Changer", "version": "2.0"}

# =========================================================================
# 🔐 AUTHENTICATION ENDPOINTS (MONGODB)
# =========================================================================

@app.post("/api/auth/register")
def auth_register(req: RegisterRequest):
    """Registers a new user account in MongoDB."""
    try:
        user_info = db.register_user(req.username, req.password, req.email)
        return {"status": "ok", "user": user_info}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        print(f"[Auth Register Error]: {e}")
        raise HTTPException(status_code=500, detail="Error interno al registrar usuario.")

@app.post("/api/auth/login")
def auth_login(req: LoginRequest):
    """Authenticates user with MongoDB and returns a JWT session token."""
    try:
        user_info = db.authenticate_user(req.username, req.password)
        return {"status": "ok", "user": user_info}
    except ValueError as ve:
        raise HTTPException(status_code=401, detail=str(ve))
    except Exception as e:
        print(f"[Auth Login Error]: {e}")
        raise HTTPException(status_code=500, detail="Error interno al iniciar sesión.")

@app.get("/api/auth/me")
def auth_me(user: Optional[dict] = Depends(get_current_user)):
    """Returns profile and custom settings for authenticated user."""
    if not user:
        raise HTTPException(status_code=401, detail="No has iniciado sesión o la sesión expiró.")
    return {"status": "ok", "user": user}

@app.post("/api/auth/logout")
def auth_logout():
    """Logs out user (client removes token from storage)."""
    return {"status": "ok", "message": "Sesión cerrada"}

# =========================================================================
# ⚙️ CONFIG & VOICES ENDPOINTS (MONGODB SYNC)
# =========================================================================

@app.get("/api/config")
def get_current_config(user: Optional[dict] = Depends(get_current_user)):
    config = load_config()
    if user and "settings" in user:
        # Override with user settings if authenticated
        for k, v in user["settings"].items():
            if v is not None:
                config[k] = v
        if "selected_voice" in user and user["selected_voice"]:
            config["selected_voice"] = user["selected_voice"]

    masked_key = ""
    raw_key = config.get("api_key", "")
    if raw_key:
        masked_key = raw_key[:7] + "..." + raw_key[-4:] if len(raw_key) > 12 else raw_key
    return {
        "config": config,
        "masked_key": masked_key,
        "is_authenticated": user is not None,
        "username": user.get("username") if user else None
    }

@app.post("/api/config")
def update_config(req: ConfigUpdateRequest, user: Optional[dict] = Depends(get_current_user)):
    current = load_config()
    update_data = req.dict(exclude_unset=True)
    for k, v in update_data.items():
        if v is not None:
            current[k] = v
    save_config(current)
    audio_engine.reload_config()

    # If user is authenticated, also persist to their MongoDB account
    if user:
        db.update_user_preferences(user["user_id"], {
            "selected_voice": current.get("selected_voice"),
            "settings": {
                "model": current.get("model"),
                "language": current.get("language"),
                "hear_myself": current.get("hear_myself"),
                "output_device_primary": current.get("output_device_primary"),
                "output_device_secondary": current.get("output_device_secondary")
            }
        })

    return {"status": "ok", "config": current}

@app.get("/api/devices")
def get_devices():
    try:
        devices = audio_engine.get_audio_devices()
        return devices
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/voices")
def get_voices(user: Optional[dict] = Depends(get_current_user)):
    """Returns combined list of global voices + user custom voices from MongoDB."""
    user_id = user["user_id"] if user else None
    voices = db.get_all_voices(user_id=user_id)
    return voices

@app.post("/api/voices")
def add_voice(voice: VoiceItem, user: Optional[dict] = Depends(get_current_user)):
    """Adds a new voice ID to MongoDB (and user profile if authenticated)."""
    # 1. Update local config as fallback
    config = load_config()
    voices = config.get("voices", [])
    existing = False
    for i, v in enumerate(voices):
        if v["id"] == voice.id:
            voices[i] = voice.dict()
            existing = True
            break
    if not existing:
        voices.append(voice.dict())
    config["voices"] = voices
    save_config(config)
    audio_engine.reload_config()

    # 2. Persist to MongoDB
    if user:
        db.add_custom_voice_to_user(user["user_id"], voice.dict())
    else:
        db.seed_default_voices([voice.dict()])

    user_id = user["user_id"] if user else None
    all_voices = db.get_all_voices(user_id=user_id)
    return {"status": "ok", "voices": all_voices}

@app.delete("/api/voices/{voice_id}")
def delete_voice(voice_id: str, user: Optional[dict] = Depends(get_current_user)):
    config = load_config()
    voices = config.get("voices", [])
    config["voices"] = [v for v in voices if v["id"] != voice_id]
    save_config(config)
    audio_engine.reload_config()
    
    user_id = user["user_id"] if user else None
    all_voices = db.get_all_voices(user_id=user_id)
    return {"status": "ok", "voices": all_voices}

@app.post("/api/tts")
def process_tts(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")
    
    try:
        audio_bytes = audio_engine.generate_tts(
            text=req.text,
            reference_id=req.reference_id,
            model=req.model
        )
        
        # Play in background to configured hardware/virtual devices if requested
        if req.play_now:
            try:
                audio_engine.play_audio_bytes(audio_bytes)
            except Exception as pe:
                print(f"Advertencia al reproducir en dispositivo local: {pe}")

        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        error_msg = str(e)
        status_code = 500
        if "402" in error_msg or "Créditos" in error_msg:
            status_code = 402
        elif "401" in error_msg:
            status_code = 401
        raise HTTPException(status_code=status_code, detail=error_msg)

@app.get("/favicon.ico")
def get_favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.post("/api/replay")
def replay_audio(req: ReplayRequest):
    """Replays previously generated audio to Discord without consuming any Fish Audio API credits."""
    try:
        b64_data = req.audio_base64
        if "base64," in b64_data:
            b64_data = b64_data.split("base64,")[1]
        raw_bytes = base64.b64decode(b64_data)
        
        # Play directly into configured audio devices (including Discord VB-Cable)
        audio_engine.play_audio_bytes(raw_bytes)
        return {"status": "ok", "message": "Audio retransmitido a Discord con éxito"}
    except Exception as e:
        print(f"[Replay] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# =========================================================================
# 🧠 WHISPER AI & AUDIO CLEANING PIPELINE
# =========================================================================

_whisper_model = None

def get_whisper_model():
    """Loads faster-whisper model (small) as a singleton for fast Spanish speech recognition."""
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            print("[STT] Inicializando modelo Whisper AI (small - 244M params)...")
            print("[STT] Primera carga puede tomar unos minutos si descarga el modelo (~460MB)...")
            _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
            print("[STT] OK: Whisper AI (small) listo para reconocimiento rápido.")
        except Exception as e:
            print(f"[STT] Advertencia cargando Whisper AI: {e}")
            print(f"[STT] Instala con: pip install faster-whisper")
            _whisper_model = False
    return _whisper_model if _whisper_model is not False else None

# Known Whisper hallucination patterns (repeated text, subtitles artifacts, etc.)
_HALLUCINATION_PATTERNS = [
    "subtítulos", "subtitulos", "subtitulado", "suscríbete", "suscribete",
    "gracias por ver", "amara.org", "www.", "http", ".com", ".org",
    "música", "aplausos", "risas",
]

def filter_whisper_hallucinations(text: str) -> str:
    """Filters common Whisper hallucinations and repetitive artifacts."""
    if not text:
        return ""
    
    # 1. Remove text that matches known hallucination patterns
    text_lower = text.lower().strip()
    for pattern in _HALLUCINATION_PATTERNS:
        if pattern in text_lower and len(text_lower) < 40:
            print(f"[STT Filter] Hallucination detected and removed: '{text}'")
            return ""
    
    # 2. Detect excessive repetition (Whisper sometimes loops the same phrase)
    words = text.split()
    if len(words) >= 6:
        # Check if the text is mostly repeated 2-3 word ngrams
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words)-1)]
        from collections import Counter
        bigram_counts = Counter(bigrams)
        most_common_count = bigram_counts.most_common(1)[0][1] if bigram_counts else 0
        if most_common_count >= 3 and most_common_count / len(bigrams) > 0.4:
            # More than 40% of bigrams are repeated -> hallucination
            # Keep only first occurrence
            unique_part = []
            seen_bigrams = set()
            for i, w in enumerate(words):
                bg = f"{words[i]} {words[i+1]}" if i < len(words)-1 else ""
                if bg and bg in seen_bigrams:
                    break
                seen_bigrams.add(bg)
                unique_part.append(w)
            text = " ".join(unique_part)
            print(f"[STT Filter] Repetition cleaned: '{text}'")
    
    # 3. Remove leading/trailing punctuation artifacts
    text = text.strip(" .,;:!?¿¡-—")
    
    return text.strip()

def clean_and_convert_audio(content: bytes) -> bytes:
    """Uses FFmpeg with advanced noise reduction, bandpass filter, and dynamic normalization."""
    import subprocess
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    # Advanced audio filter chain:
    # 1. highpass=f=80 — Remove low-frequency rumble (AC hum, breathing)
    # 2. lowpass=f=8000 — Remove high-frequency hiss above speech range
    # 3. afftdn=nf=-25 — FFT-based noise reduction (removes background noise)
    # 4. acompressor — Compress dynamic range for consistent volume
    # 5. dynaudnorm — Normalize volume dynamically across the clip
    audio_filter = (
        "highpass=f=80,"
        "lowpass=f=8000,"
        "afftdn=nf=-25:nt=w:om=o,"
        "acompressor=threshold=-20dB:ratio=4:attack=5:release=50,"
        "dynaudnorm=f=75:g=15:p=0.95"
    )
    
    proc = subprocess.Popen(
        [
            ffmpeg_exe, "-y", "-i", "pipe:0",
            "-af", audio_filter,
            "-f", "wav", "-ar", "16000", "-ac", "1", "pipe:1"
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    wav_bytes, err = proc.communicate(input=content)
    
    if proc.returncode != 0 or len(wav_bytes) == 0:
        print(f"[Audio Filter] Error en FFmpeg: {err.decode('utf-8', errors='ignore')}")
        raise HTTPException(status_code=400, detail="No se pudo procesar el formato de audio.")
    return wav_bytes

def transcribe_audio_pipeline(wav_bytes: bytes, lang: str = "es-CL") -> str:
    """Transcribes audio using Whisper AI (medium) with optimized params and automatic fallback to Google STT."""
    import time as _time
    
    # 1. Primary Engine: Whisper AI Medium (769M params — high accuracy for Spanish)
    whisper = get_whisper_model()
    if whisper:
        try:
            import numpy as np
            import soundfile as sf
            
            with io.BytesIO(wav_bytes) as bio:
                audio_data, _ = sf.read(bio, dtype="float32")
            
            # Extract 2-letter language code (es-CL -> es)
            whisper_lang = lang.split("-")[0] if "-" in lang else (lang or "es")
            
            t0 = _time.time()
            segments, info = whisper.transcribe(
                audio_data,
                language=whisper_lang,
                task="transcribe",     # Force transcription, prevent translation to English
                initial_prompt="Contexto: Comentarios deportivos, gritos, fútbol, frases informales chilenas (weón, ctm, cachai, bacán, Alexis, copa, gol, pego, etc.).",
                beam_size=2,           # Reduced from 5 to 2 for faster processing
                best_of=2,             # Reduced from 3 to 2 for faster processing
                temperature=0.0,       # Deterministic decoding (no randomness)
                condition_on_previous_text=False,  # Prevent error propagation
                vad_filter=True,       # Built-in voice activity detection
                vad_parameters=dict(
                    min_silence_duration_ms=300,
                    speech_pad_ms=200
                ),
                no_speech_threshold=0.6,      # Be stricter about detecting speech
                log_prob_threshold=-1.0,       # Filter low-confidence segments
                compression_ratio_threshold=2.4,  # Filter repetitive hallucinations
            )
            
            raw_text = " ".join([seg.text.strip() for seg in segments]).strip()
            elapsed = _time.time() - t0
            
            # Apply hallucination filter
            text = filter_whisper_hallucinations(raw_text)
            
            if text:
                print(f"[STT Whisper AI] OK: Transcripción ({whisper_lang}, {elapsed:.1f}s): \"{text}\"")
                return text
            else:
                print(f"[STT Whisper AI] Texto filtrado como alucinación: \"{raw_text}\" -> Intentando Google STT...")
        except Exception as we:
            print(f"[STT] Whisper falló ({we}), recurriendo a Google Speech Recognition...")

    # 2. Secondary Fallback: Google Speech Recognition with regional dialect
    import speech_recognition as sr
    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 120
    recognizer.dynamic_energy_threshold = True
    
    try:
        with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data, language=lang)
            print(f"[STT Google] Transcripción obtenida ({lang}): \"{text}\"")
            return text.strip()
    except sr.UnknownValueError:
        print("[STT] No se detectaron palabras audibles.")
        raise HTTPException(status_code=400, detail="No se entendió ninguna palabra clara. Habla más cerca del micrófono.")
    except Exception as ge:
        print(f"[STT] Error en Google STT: {ge}")
        raise HTTPException(status_code=500, detail=f"Error en transcripción: {ge}")

@app.post("/api/transcribe")
async def transcribe_only(
    file: UploadFile = File(...),
):
    """Pure STT endpoint — transcribes audio without generating TTS. Used by live mode."""
    try:
        content = await file.read()
        if len(content) < 800:
            raise HTTPException(status_code=400, detail="Audio demasiado corto.")
        
        wav_bytes = clean_and_convert_audio(content)
        cfg = load_config()
        current_lang = cfg.get("language", "es-CL")
        text = transcribe_audio_pipeline(wav_bytes, lang=current_lang)
        
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="No se detectaron palabras claras.")
        
        return {"transcription": text}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Transcribe] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/voice-convert")
async def voice_convert_audio(
    file: UploadFile = File(...),
    reference_id: Optional[str] = Form(None)
):
    """Takes microphone audio, cleans it, transcribes with Whisper AI, and converts with Fish Audio."""
    try:
        content = await file.read()
        print(f"\n[Voice Convert] Recibido audio de {len(content)} bytes ({file.content_type})")
        
        if len(content) < 1000:
            raise HTTPException(status_code=400, detail="Grabación demasiado corta o vacía. Mantén pulsado mientras hablas.")

        # 1. Clean audio with FFmpeg
        wav_bytes = clean_and_convert_audio(content)
        print(f"[Voice Convert] Audio limpiado y normalizado ({len(wav_bytes)} bytes WAV 16kHz)")

        # 2. Transcribe with Whisper AI / Google STT
        cfg = load_config()
        current_lang = cfg.get("language", "es-CL")
        text = transcribe_audio_pipeline(wav_bytes, lang=current_lang)

        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="No se detectaron palabras claras.")

        # 3. Call Fish Audio TTS with model s2.1-pro-free
        ref_id = reference_id or cfg.get("selected_voice", "97582f301e1c4f93a514ceda15e23e26")
        model_name = cfg.get("model", "s2.1-pro-free")
        
        print(f"[Voice Convert] Enviando a Fish Audio (Model: {model_name}, RefID: {ref_id})...")
        audio_bytes = audio_engine.generate_tts(
            text=text,
            reference_id=ref_id,
            model=model_name
        )
        print(f"[Voice Convert] Audio generado con éxito ({len(audio_bytes)} bytes)")

        # 4. Play to hardware / Discord virtual cable
        try:
            audio_engine.play_audio_bytes(audio_bytes)
        except Exception as pe:
            print(f"[Voice Convert] Advertencia al reproducir en hardware: {pe}")

        # 5. Return transcription and audio base64 for browser playback
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {
            "transcription": text,
            "audio_base64": f"data:audio/mp3;base64,{audio_base64}"
        }

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"[Voice Convert] Error general: {error_msg}")
        status_code = 500
        if "402" in error_msg:
            status_code = 402
        raise HTTPException(status_code=status_code, detail=error_msg)

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

if __name__ == "__main__":
    port = 7860
    # Clean up stale processes on port 7860 on Windows if present
    try:
        import subprocess
        out = subprocess.check_output(f'netstat -ano | findstr :{port}', shell=True).decode()
        for line in out.strip().split('\n'):
            parts = line.strip().split()
            if len(parts) >= 5 and parts[1].endswith(f':{port}') and 'LISTENING' in line.upper():
                pid = parts[-1]
                if int(pid) != os.getpid():
                    print(f"Liberando puerto {port} ocupado por proceso PID {pid}...")
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
    except Exception:
        pass

    print(f"Iniciando Voice Changer en http://localhost:{port} ...")
    uvicorn.run("server:app", host="127.0.0.1", port=port, reload=False)
