# 🎙️ Fish Audio Live Voice Changer & Studio

Aplicación de cambio de voz en tiempo real con Inteligencia Artificial utilizando la API de **Fish Audio**.

---

## 🚀 Cómo iniciar el programa

Tienes dos formas de usarlo:

### Opción 1: Interfaz Gráfica de Estudio (Recomendado)
Haz doble clic en el archivo:
👉 **`iniciar_voice_changer.bat`**  
O ejecuta en la terminal:
```bash
python server.py
```
Se abrirá automáticamente en tu navegador en: **`http://localhost:7860`**

### Opción 2: Modo Consola / Terminal
Si prefieres un script rápido por línea de comandos:
```bash
python voice_changer_cli.py
```

---

## 🎧 Cómo transmitir tu voz clonada en Discord, Juegos o Zoom

Ya detectamos que tienes instalado **VB-Audio Virtual Cable** y **Voicemeeter**. Para que tus amigos te escuchen:

1. En la aplicación web (a la derecha):
   - **Dispositivo para escucharte:** Elige tus auriculares / altavoces normales.
   - **Dispositivo de Transmisión:** Selecciona **`CABLE Input (VB-Audio Virtual Cable)`** o tu salida de **Voicemeeter**.
2. En **Discord / Videojuego / OBS**:
   - Ve a **Ajustes de Voz**.
   - En **Dispositivo de Entrada (Micrófono)** selecciona **`CABLE Output (VB-Audio Virtual Cable)`**.
3. ¡Listo! Al hablar manteniendo presionado el botón o la barra espaciadora, tu voz de IA saldrá por Discord.

---

## ⚠️ Nota importante sobre la API Key de Fish Audio (Error 402)

Al realizar la prueba técnica con tu API Key `sk-fish-...`, los servidores de Fish Audio respondieron:
```json
{"status": 402, "message": "Insufficient API credit. API credit is managed independently from platform credit."}
```

> **¿Por qué ocurre esto?**  
> Fish Audio separa el saldo de la web del saldo de desarrollador de la API.
> Para solucionarlo, ingresa a: **[https://fish.audio/app/developers](https://fish.audio/app/developers)** y recarga o activa saldo de créditos de API.

---

## 🛠️ Características del Estudio
- **Push-to-Talk (PTT)** con la tecla `[Espacio]` o con el ratón.
- **Visualizador de ondas de sonido en tiempo real**.
- **Transcripción de voz inmediata** en español.
- **Modo Texto a Voz (TTS)** con botones rápidos de emociones Fish Audio (`[excited]`, `[laughing]`, `[whispering]`, `[angry]`, etc.).
- **Biblioteca de Voces**: Puedes añadir y cambiar entre diferentes Reference IDs de Fish Audio con 1 clic.
- **Enrutamiento dual de audio**: Te escuchas a ti mismo y a la vez envías el audio a Discord/Juegos.
