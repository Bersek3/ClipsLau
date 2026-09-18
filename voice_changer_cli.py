import sys
import time
import speech_recognition as sr
from audio_engine import audio_engine, load_config

def main():
    print("=" * 60)
    print("   🎙️  FISH AUDIO AI VOICE CHANGER - TERMINAL EDITION  🎙️")
    print("=" * 60)

    config = load_config()
    api_key = config.get("api_key", "")
    voice_id = config.get("selected_voice", "97582f301e1c4f93a514ceda15e23e26")
    
    print(f"• API Key configurada: {'✓ Sí' if api_key else '❌ No'}")
    print(f"• ID de Voz seleccionada: {voice_id}")
    print("\nInstrucciones:")
    print(" 1. Presiona ENTER para empezar a hablar.")
    print(" 2. Di la frase que quieras que diga tu clon de voz.")
    print(" 3. El sistema reconocerá lo que dices, llamará a Fish Audio y lo reproducirá.")
    print(" 4. Escribe 'q' y presiona ENTER para salir.\n")

    recognizer = sr.Recognizer()

    while True:
        try:
            cmd = input("\n[Presiona ENTER para hablar / 'q' para salir]: ")
            if cmd.lower().strip() == 'q':
                print("Saliendo...")
                break

            print("\n🎤 Hablando... Di tu frase:")
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.4)
                audio = recognizer.listen(source, timeout=6, phrase_time_limit=12)

            print("⏳ Transcribiendo voz...")
            try:
                text = recognizer.recognize_google(audio, language="es-ES")
                print(f"🗣️ Dijiste: \"{text}\"")
            except sr.UnknownValueError:
                print("⚠️ No se entendió con claridad. Intenta de nuevo.")
                continue

            print("✨ Conectando con Fish Audio para clonar voz...")
            try:
                audio_bytes = audio_engine.generate_tts(text=text, reference_id=voice_id)
                print("🔊 Reproduciendo audio clonado...")
                audio_engine.play_audio_bytes(audio_bytes)
                print("✓ ¡Listo!")
            except Exception as e:
                print(f"❌ Error al generar con Fish Audio: {e}")

        except KeyboardInterrupt:
            print("\nSaliendo...")
            break
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()
