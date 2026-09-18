import os
import io
import json
import time
import threading
import requests
import sounddevice as sd
import soundfile as sf
import speech_recognition as sr
from dotenv import load_dotenv

load_dotenv()

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "api_key": os.getenv("FISH_AUDIO_API_KEY", ""),
        "selected_voice": os.getenv("DEFAULT_REFERENCE_ID", "97582f301e1c4f93a514ceda15e23e26"),
        "model": os.getenv("DEFAULT_MODEL", "s2.1-pro-free"),
        "language": "es-ES",
        "input_device": None,
        "output_device_primary": None,
        "output_device_secondary": None,
        "hear_myself": False,
        "volume": 1.0,
        "speed": 1.0,
        "voices": [
            {
                "id": "97582f301e1c4f93a514ceda15e23e26",
                "name": "Voz Predeterminada (Fish Audio)",
                "description": "Voz clonada configurada por defecto",
                "sample_text": "¡Hola! Estoy usando mi voz clonada con inteligencia artificial en tiempo real."
            }
        ]
    }

def save_config(config_data):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=4, ensure_ascii=False)

import queue

class AudioEngine:
    def __init__(self):
        self.config = load_config()
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 300
        self.recognizer.dynamic_energy_threshold = True
        self.is_recording = False
        self.is_processing = False
        
        # Persistent HTTP session for zero-handshake API calls
        self.http_session = requests.Session()
        
        # Audio Playback Queue for smooth continuous streaming
        self.playback_queue = queue.Queue()
        self.queue_worker_thread = threading.Thread(target=self._playback_worker, daemon=True)
        self.queue_worker_thread.start()

    def reload_config(self):
        self.config = load_config()

    def _playback_worker(self):
        """Worker thread that processes the audio playback queue in FIFO order."""
        while True:
            try:
                audio_bytes, target_dev = self.playback_queue.get()
                self._direct_play_audio_bytes(audio_bytes, target_dev)
                self.playback_queue.task_done()
            except Exception as e:
                print(f"[Playback Worker] Error: {e}")

    def queue_audio_bytes(self, audio_bytes: bytes, target_device_id=None):
        """Enqueues audio to be played sequentially without collisions."""
        self.playback_queue.put((audio_bytes, target_device_id))

    def get_audio_devices(self):
        """Returns comprehensive lists of input (microphones) and output audio devices."""
        devices = sd.query_devices()
        hostapis = sd.query_hostapis()
        
        inputs = []
        outputs = []
        
        for idx, dev in enumerate(devices):
            api_name = hostapis[dev['hostapi']]['name']
            raw_name = dev['name']
            
            # Formatted display name
            is_virtual = any(keyword in raw_name.lower() for keyword in ['cable', 'voicemeeter', 'virtual', 'shure', '2do micro', 'salida pc', 'guitarra'])
            
            if dev['max_input_channels'] > 0:
                prefix = "⭐ " if is_virtual else "🎙️ "
                name = f"{prefix}{raw_name} ({api_name})"
                inputs.append({
                    "id": idx,
                    "name": name,
                    "raw_name": raw_name,
                    "channels": dev['max_input_channels'],
                    "default_samplerate": dev['default_samplerate'],
                    "is_default": idx == sd.default.device[0],
                    "is_virtual": is_virtual,
                    "api": api_name
                })
            
            if dev['max_output_channels'] > 0:
                prefix = "⭐ [Discord] " if is_virtual else "🎧 "
                name = f"{prefix}{raw_name} ({api_name})"
                outputs.append({
                    "id": idx,
                    "name": name,
                    "raw_name": raw_name,
                    "channels": dev['max_output_channels'],
                    "default_samplerate": dev['default_samplerate'],
                    "is_default": idx == sd.default.device[1],
                    "is_virtual": is_virtual,
                    "api": api_name
                })
                
        return {"inputs": inputs, "outputs": outputs}

    def generate_tts(self, text: str, reference_id: str = None, model: str = None):
        """Calls the Fish Audio TTS API and returns the audio bytes."""
        api_key = self.config.get("api_key", "").strip()
        if not api_key:
            raise ValueError("No se ha configurado la API Key de Fish Audio.")

        ref_id = reference_id or self.config.get("selected_voice", "97582f301e1c4f93a514ceda15e23e26")
        selected_model = model or self.config.get("model", "s2.1-pro-free")

        url = "https://api.fish.audio/v1/tts"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "model": selected_model
        }
        payload = {
            "text": text,
            "reference_id": ref_id,
            "model": selected_model,
            "format": "mp3",
            "latency": "balanced"
        }

        response = self.http_session.post(url, headers=headers, json=payload, timeout=25)
        
        if response.status_code == 200:
            return response.content
        elif response.status_code == 402:
            raise Exception("Créditos de API insuficientes (Error 402). Por favor, recarga créditos de desarrollador en https://fish.audio/app/developers")
        elif response.status_code == 401:
            raise Exception("API Key inválida o no autorizada (Error 401). Verifica tu clave en config.")
        else:
            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get("message", response.text)
            except Exception:
                pass
            raise Exception(f"Error de Fish Audio ({response.status_code}): {error_detail}")

    def play_audio_bytes(self, audio_bytes: bytes, target_device_id=None):
        """Enqueues audio to be played smoothly in sequence without blocking or collision."""
        self.playback_queue.put((audio_bytes, target_device_id))
        return True

    def _direct_play_audio_bytes(self, audio_bytes: bytes, target_device_id=None):
        """Synchronously plays audio bytes to specified device or configured devices with automatic resampling."""
        try:
            import numpy as np
            data, samplerate = sf.read(io.BytesIO(audio_bytes))
            volume = float(self.config.get("volume", 1.0))
            if volume != 1.0:
                data = data * volume

            devices_to_play = []
            
            if target_device_id is not None:
                devices_to_play.append(target_device_id)
            else:
                primary = self.config.get("output_device_primary")
                secondary = self.config.get("output_device_secondary")
                hear_myself = self.config.get("hear_myself", True)
                
                if primary is not None and (hear_myself or secondary is None):
                    devices_to_play.append(primary)
                if secondary is not None and secondary != primary:
                    devices_to_play.append(secondary)
                    
                if not devices_to_play:
                    devices_to_play.append(None) # Default output device

            all_devices_info = sd.query_devices()

            threads = []
            for dev_id in devices_to_play:
                def _play(d_id, raw_data, orig_sr):
                    try:
                        target_sr = orig_sr
                        dev_channels = 2
                        
                        if d_id is not None and d_id < len(all_devices_info):
                            d_info = all_devices_info[d_id]
                            target_sr = int(d_info.get("default_samplerate", orig_sr))
                            dev_channels = d_info.get("max_output_channels", 2)
                            
                        # Resample if device native samplerate differs
                        play_data = raw_data
                        if target_sr != orig_sr:
                            num_samples = int(len(raw_data) * target_sr / orig_sr)
                            if raw_data.ndim == 1:
                                play_data = np.interp(
                                    np.linspace(0.0, len(raw_data), num_samples, endpoint=False),
                                    np.arange(len(raw_data)),
                                    raw_data
                                )
                            else:
                                play_data = np.zeros((num_samples, raw_data.shape[1]), dtype=raw_data.dtype)
                                for ch in range(raw_data.shape[1]):
                                    play_data[:, ch] = np.interp(
                                        np.linspace(0.0, len(raw_data), num_samples, endpoint=False),
                                        np.arange(len(raw_data)),
                                        raw_data[:, ch]
                                    )
                            play_data = play_data.astype(raw_data.dtype)

                        # Match channel dimension for multi-channel devices (e.g. 8-channel Voicemeeter)
                        if play_data.ndim == 1:
                            if dev_channels > 1:
                                play_data = np.repeat(play_data[:, np.newaxis], dev_channels, axis=1)
                        elif play_data.shape[1] < dev_channels:
                            padded = np.zeros((len(play_data), dev_channels), dtype=play_data.dtype)
                            padded[:, :play_data.shape[1]] = play_data
                            # For stereo input to 8-channel, also replicate to front L/R
                            play_data = padded
                        elif play_data.shape[1] > dev_channels:
                            play_data = play_data[:, :dev_channels]

                        sd.play(play_data, samplerate=target_sr, device=d_id)
                        sd.wait()
                    except Exception as e:
                        print(f"Error reproduciendo en dispositivo {d_id}: {e}")

                t = threading.Thread(target=_play, args=(dev_id, data, samplerate))
                t.start()
                threads.append(t)

            for t in threads:
                t.join()
                
            return True
        except Exception as e:
            print(f"Error en play_audio_bytes: {e}")
            raise e

    def record_and_transcribe(self, duration_seconds=5, language="es-ES"):
        """Records from microphone for a set duration or until silence and transcribes using Google STT."""
        input_device_id = self.config.get("input_device")
        mic_index = None
        
        # Match PyAudio/SpeechRecognition device index if needed
        if input_device_id is not None:
            # We can use sounddevice directly to record clean audio
            samplerate = 16000
            print(f"Grabando {duration_seconds}s del dispositivo {input_device_id}...")
            recording = sd.rec(int(duration_seconds * samplerate), samplerate=samplerate, channels=1, dtype='int16', device=input_device_id)
            sd.wait()
            
            # Convert numpy array to WAV in-memory for SpeechRecognition
            wav_io = io.BytesIO()
            sf.write(wav_io, recording, samplerate, format='WAV', subtype='PCM_16')
            wav_io.seek(0)
            
            with sr.AudioFile(wav_io) as source:
                audio = self.recognizer.record(source)
                try:
                    text = self.recognizer.recognize_google(audio, language=language)
                    return text
                except sr.UnknownValueError:
                    return ""
                except Exception as e:
                    raise Exception(f"Error en reconocimiento de voz: {e}")
        else:
            # Default or configured microphone
            input_idx = self.config.get("input_device")
            mic_kwargs = {}
            if isinstance(input_idx, int):
                mic_kwargs["device_index"] = input_idx
            with sr.Microphone(**mic_kwargs) as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                print("Escuchando...")
                audio = self.recognizer.listen(source, timeout=duration_seconds, phrase_time_limit=10)
                try:
                    text = self.recognizer.recognize_google(audio, language=language)
                    return text
                except sr.UnknownValueError:
                    return ""
                except Exception as e:
                    raise Exception(f"Error en reconocimiento de voz: {e}")

audio_engine = AudioEngine()
