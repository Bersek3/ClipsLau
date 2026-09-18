// Environment Detection
const isLocalServer = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// State
let appConfig = null;
let voices = [];
let audioDevices = { inputs: [], outputs: [] };

// Auth State (MongoDB)
let authToken = localStorage.getItem("voice_clone_auth_token") || null;
let currentUser = null;
let authMode = "login";

// Manual PTT State
let isRecording = false;
let isProcessing = false;
let manualAudioChunks = [];
let manualMediaRecorder = null;
let manualSpeechRecognizer = null;
let manualPttTranscript = "";

// Continuous Live Mode State (VAD)
let isLiveStreaming = false;
let isSpeechActive = false;
let vadThreshold = 20; // 20% default
let vadSilenceLimit = 350; // 350ms for ultra-low latency
let silenceTimer = null;
let speechStartTime = 0;
let liveAudioChunks = [];
let liveMediaRecorder = null;
let liveStream = null;
let liveAudioCtx = null;
let liveAnalyser = null;
let liveAnimFrame = null;
let liveSpeechRecognizer = null;
let liveRecognizedText = "";

// Audio Context & Visualizer for PTT
let audioCtx = null;
let analyser = null;
let micStream = null;
let visualizerAnimationId = null;
const canvas = document.getElementById("visualizerCanvas");
const canvasCtx = canvas.getContext("2d");

// DOM Elements
const apiStatusBadge = document.getElementById("apiStatusBadge");
const statusText = document.getElementById("statusText");
const creditAlertBanner = document.getElementById("creditAlertBanner");
const btnPtt = document.getElementById("btnPtt");
const recordingBadge = document.getElementById("recordingBadge");
const processingBadge = document.getElementById("processingBadge");
const transcriptionText = document.getElementById("transcriptionText");
const transcriptionStatus = document.getElementById("transcriptionStatus");
const latestAudioCard = document.getElementById("latestAudioCard");
const audioPlayer = document.getElementById("audioPlayer");
const activeVoiceName = document.getElementById("activeVoiceName");
const activeVoiceDesc = document.getElementById("activeVoiceDesc");
const activeVoiceId = document.getElementById("activeVoiceId");
const voiceDropdownSelect = document.getElementById("voiceDropdownSelect");
const voiceList = document.getElementById("voiceList");
const selectInputDevice = document.getElementById("selectInputDevice");
const selectPrimaryOutput = document.getElementById("selectPrimaryOutput");
const selectSecondaryOutput = document.getElementById("selectSecondaryOutput");
const checkHearMyself = document.getElementById("checkHearMyself");
const ttsTextInput = document.getElementById("ttsTextInput");
const btnGenerateTTS = document.getElementById("btnGenerateTTS");
const btnClearTTS = document.getElementById("btnClearTTS");
const charCount = document.getElementById("charCount");
const toast = document.getElementById("toast");

let browserAudioInputs = [];
let selectedMicBrowserId = null;

// Continuous Live DOM Elements
const btnToggleLive = document.getElementById("btnToggleLive");
const btnToggleLiveText = document.getElementById("btnToggleLiveText");
const liveStateBadge = document.getElementById("liveStateBadge");
const liveStateText = document.getElementById("liveStateText");
const vadStatusText = document.getElementById("vadStatusText");
const vadMeterFill = document.getElementById("vadMeterFill");
const vadThresholdLine = document.getElementById("vadThresholdLine");
const sliderVadThreshold = document.getElementById("sliderVadThreshold");
const sliderSilenceTime = document.getElementById("sliderSilenceTime");
const valThreshold = document.getElementById("valThreshold");
const valSilenceTime = document.getElementById("valSilenceTime");
const liveSentencesFeed = document.getElementById("liveSentencesFeed");
const btnClearFeed = document.getElementById("btnClearFeed");

// Modals
const settingsModal = document.getElementById("settingsModal");
const newVoiceModal = document.getElementById("newVoiceModal");
const settingApiKey = document.getElementById("settingApiKey");
const settingModel = document.getElementById("settingModel");
const settingLang = document.getElementById("settingLang");
const newVoiceId = document.getElementById("newVoiceId");
const newVoiceName = document.getElementById("newVoiceName");
const newVoiceDesc = document.getElementById("newVoiceDesc");

// Auth DOM Elements
const btnOpenLoginModal = document.getElementById("btnOpenLoginModal");
const userInfoNav = document.getElementById("userInfoNav");
const loggedInUsername = document.getElementById("loggedInUsername");
const btnLogout = document.getElementById("btnLogout");
const authModal = document.getElementById("authModal");
const tabAuthLogin = document.getElementById("tabAuthLogin");
const tabAuthRegister = document.getElementById("tabAuthRegister");
const authAlert = document.getElementById("authAlert");
const authUsername = document.getElementById("authUsername");
const authEmail = document.getElementById("authEmail");
const authEmailGroup = document.getElementById("authEmailGroup");
const authPassword = document.getElementById("authPassword");
const btnSubmitAuth = document.getElementById("btnSubmitAuth");
const btnSubmitAuthText = document.getElementById("btnSubmitAuthText");
const authFooterHint = document.getElementById("authFooterHint");

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
    initCanvas();
    setupTabSwitching();
    setupEventListeners();
    setupContinuousControls();
    setupAuthListeners();
    await checkAuthStatus();
    await loadAppConfig();
    await loadAudioDevices();
    await loadVoices();
    startIdleVisualizer();
});

function initCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    window.addEventListener("resize", () => {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    });
}

// Default catalog of 28 voices (Used on GitHub Pages and as offline fallback)
const DEFAULT_VOICES_FALLBACK = [
    { id: "d9f0d3d3fe734af6acb5ecc9129bc49a", name: "Dross Rotzank", description: "Voz de Dross (Terror y Misterio)", sample_text: "Les ha hablado Dross y les deseo buenas noches..." },
    { id: "a4e70883b9324211a5e91837a69c2b6f", name: "Don Francisco", description: "Voz de Mario Kreutzberger (Sábado Gigante)", sample_text: "¡¿Qué dice el público?!" },
    { id: "dfa5b230c8054f429e434f4a6e9bbdec", name: "Farid Dieck", description: "Voz de Farid (Reflexiones y Filosofía)", sample_text: "Las cosas no pasan por algo, pasan para algo." },
    { id: "f37045b497864c988c8691919f1c557a", name: "Mega (Locutor)", description: "Voz oficial del canal Mega", sample_text: "A continuación en Mega, no te pierdas el gran estreno." },
    { id: "02ecd5ab859f42cfb15ba5d1b71bc74b", name: "Gabriel Boric", description: "Voz de Gabriel Boric (Presidente de Chile)", sample_text: "Compañeros y compañeras, seguimos adelante con fuerza y convicción." },
    { id: "97582f301e1c4f93a514ceda15e23e26", name: "AuronPlay / Predeterminada", description: "Voz de Auronplay (Twitch / YouTube)", sample_text: "¡Hola a todos chavales! Pero bueno, ¿qué está pasando aquí?" },
    { id: "30ca8b4d162e463d818bb99101f4857e", name: "Lionel Messi", description: "Voz de Leo Messi (¿Qué mirás, bobo?)", sample_text: "¿Qué mirás, bobo? Andá pa' allá, bobo." },
    { id: "1f278d1516e54ff2b18189f5c71c9027", name: "Homero Simpson", description: "Voz de Homero Simpson (Los Simpson)", sample_text: "¡D'oh! Mmm... ¡rosquillas!" },
    { id: "4788d6bc34254724beec4d8fed512a3f", name: "Sebastián Piñera", description: "Voz de Sebastián Piñera (Expresidente de Chile)", sample_text: "Compatriotas, tiempos mejores están por venir." },
    { id: "c16b557e3765474eb0b5f58eec763094", name: "Augusto Pinochet", description: "Voz de Augusto Pinochet", sample_text: "¡Señores!... La patria está por sobre todas las cosas." },
    { id: "90cd415e0257431cbb3fe9d70fceeb14", name: "Tio Rene", description: "", sample_text: "" },
    { id: "49d39d466be44756ba765a49242cfd6a", name: "nicolas maduro", description: "", sample_text: "" },
    { id: "18d5dcc7904945569b728b88ddf0a1a1", name: "Messi ( prueba)", description: "", sample_text: "" },
    { id: "74fadda965294c4280843931010a7083", name: "Cristiano Ronaldo", description: "", sample_text: "" },
    { id: "9f850ee9ada24b20a6866825eaefd3f8", name: "Goku", description: "", sample_text: "" },
    { id: "8fb6fd42128d4b82bb1d8dbba6da64f6", name: "Mariano Closs", description: "", sample_text: "" },
    { id: "063240d1a2f34a8abcc20c8cfb8ffabd", name: "claudio palma", description: "", sample_text: "" },
    { id: "b1161d68925c41f7b54cca5a91580182", name: "Peruano", description: "", sample_text: "" },
    { id: "8f23453397d14e4d9a579bad5aab41a8", name: "xokas", description: "", sample_text: "" },
    { id: "0bf1d759a4d342548d108fb2513413cc", name: "SHREK", description: "", sample_text: "" },
    { id: "649999d3a5b444c6bf159bcbdaa52f42", name: "BURRO SHREK", description: "", sample_text: "" },
    { id: "ddfb915f6b3c40adb125f017878435c9", name: "JULIO CESAR RODRIGUEZ", description: "", sample_text: "" },
    { id: "ccee4a6d3b7249df9eae750a53dbb961", name: "FELIPE CAMIROAGA", description: "", sample_text: "" },
    { id: "087a4cf88ea94f638ceb37e66d95b92b", name: "FELIPE CAMIROAGA V2", description: "", sample_text: "" },
    { id: "a9b4081c9ff44264b19cd1835bb50952", name: "ERICK CARTMAN", description: "", sample_text: "" },
    { id: "a25199e3d7ac4e12bfe6b62ab33355c0", name: "MARADONA", description: "", sample_text: "" },
    { id: "7bd610c647ff4a48bd0584fef1a5ffba", name: "Huaso", description: "", sample_text: "" },
    { id: "51ea54dc9b7d46b49a58918742c1a2cd", name: "Davo", description: "", sample_text: "" }
];

function getAuthHeaders(includeContentType = true) {
    const headers = {};
    if (includeContentType) headers["Content-Type"] = "application/json";
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    return headers;
}

function showToast(message, isError = false) {
    toast.textContent = message;
    toast.style.borderColor = isError ? "var(--danger)" : "var(--primary)";
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}

// --- API Config & Devices ---
async function loadAppConfig() {
    if (isLocalServer) {
        try {
            const res = await fetch("/api/config", { headers: getAuthHeaders(false) });
            if (res.ok) {
                const data = await res.json();
                appConfig = data.config;
            }
        } catch (e) {}
    }

    if (!appConfig) {
        // Standalone browser / GitHub Pages fallback
        appConfig = {
            api_key: localStorage.getItem("fish_api_key") || "sk-fish-MrvjytXetS4Gh8Yrlj7n380D3CvWK3T4McgK6WSk6Dc",
            selected_voice: localStorage.getItem("fish_selected_voice") || "a4e70883b9324211a5e91837a69c2b6f",
            model: localStorage.getItem("fish_model") || "s2.1-pro-free",
            language: localStorage.getItem("fish_language") || "es-CL",
            hear_myself: true
        };
    }
    
    activeVoiceId.textContent = appConfig.selected_voice || "No seleccionada";
    checkHearMyself.checked = appConfig.hear_myself === true;

    if (appConfig.api_key) {
        apiStatusBadge.className = "status-badge online";
        statusText.textContent = isLocalServer ? "API y Servidor Listos" : "API Lista (Modo Web)";
    } else {
        apiStatusBadge.className = "status-badge error";
        statusText.textContent = "Sin API Key";
    }
}

async function loadAudioDevices() {
    let backendInputs = [];
    let backendOutputs = [];

    // Query browser media devices to allow exact physical deviceId binding
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            const navDevices = await navigator.mediaDevices.enumerateDevices();
            browserAudioInputs = navDevices.filter(d => d.kind === 'audioinput');
        }
    } catch (mErr) {}

    if (isLocalServer) {
        try {
            const res = await fetch("/api/devices");
            if (res.ok) {
                audioDevices = await res.json();
                backendInputs = audioDevices.inputs || [];
                backendOutputs = audioDevices.outputs || [];
            }
        } catch (e) {}
    }

    // 1. Populate Input Microphones
    if (selectInputDevice) {
        selectInputDevice.innerHTML = `<option value="">-- Micrófono Predeterminado del Sistema --</option>`;
        if (backendInputs.length > 0) {
            backendInputs.forEach(dev => {
                const optInput = document.createElement("option");
                optInput.value = dev.id;
                optInput.textContent = dev.name;
                if (appConfig && appConfig.input_device === dev.id) optInput.selected = true;
                selectInputDevice.appendChild(optInput);
            });
        } else if (browserAudioInputs.length > 0) {
            browserAudioInputs.forEach((dev, idx) => {
                const optInput = document.createElement("option");
                optInput.value = dev.deviceId;
                optInput.textContent = `🎙️ ${dev.label || `Micrófono ${idx + 1}`}`;
                selectInputDevice.appendChild(optInput);
            });
        }
    }

    // 2. Populate Output Devices (Headphones & Discord Virtual Cable)
    selectPrimaryOutput.innerHTML = `<option value="">-- Dispositivo Predeterminado de Windows --</option>`;
    selectSecondaryOutput.innerHTML = `<option value="">-- Ninguno / Desactivado --</option>`;

    if (backendOutputs.length > 0) {
        backendOutputs.forEach(dev => {
            const isCable = dev.is_virtual || dev.name.toLowerCase().includes("cable") || dev.name.toLowerCase().includes("voicemeeter");
            const optPrimary = document.createElement("option");
            optPrimary.value = dev.id;
            optPrimary.textContent = dev.name;
            if (appConfig && appConfig.output_device_primary === dev.id) optPrimary.selected = true;
            selectPrimaryOutput.appendChild(optPrimary);

            const optSecondary = document.createElement("option");
            optSecondary.value = dev.id;
            optSecondary.textContent = (isCable ? "⭐ [Recomendado Discord] " : "") + dev.name;
            if (appConfig && appConfig.output_device_secondary === dev.id) {
                optSecondary.selected = true;
            } else if (!appConfig.output_device_secondary && isCable && dev.name.toLowerCase().includes("cable input")) {
                optSecondary.selected = true;
                updateAudioRouting();
            }
            selectSecondaryOutput.appendChild(optSecondary);
        });
    } else {
        const optPrimary = document.createElement("option");
        optPrimary.value = "";
        optPrimary.textContent = "🎧 Altavoces / Auriculares del Navegador";
        selectPrimaryOutput.appendChild(optPrimary);

        const optSecondary = document.createElement("option");
        optSecondary.value = "";
        optSecondary.textContent = "⭐ Discord Virtual Cable (Inicia el servidor local para activar)";
        selectSecondaryOutput.appendChild(optSecondary);
    }
}

async function updateAudioRouting() {
    let inputDev = null;
    if (selectInputDevice && selectInputDevice.value !== "") {
        const parsed = parseInt(selectInputDevice.value);
        inputDev = isNaN(parsed) ? selectInputDevice.value : parsed;
    }
    const primary = selectPrimaryOutput.value ? parseInt(selectPrimaryOutput.value) : null;
    const secondary = selectSecondaryOutput.value ? parseInt(selectSecondaryOutput.value) : null;
    const hearMyself = checkHearMyself.checked;

    // Match browser deviceId if possible
    if (selectInputDevice && selectInputDevice.selectedIndex > 0) {
        const val = selectInputDevice.value;
        const directMatch = browserAudioInputs.find(b => b.deviceId === val);
        if (directMatch) {
            selectedMicBrowserId = directMatch.deviceId;
        } else {
            const selectedText = selectInputDevice.options[selectInputDevice.selectedIndex].text.toLowerCase();
            const matched = browserAudioInputs.find(b => {
                const lbl = (b.label || "").toLowerCase();
                return lbl && (selectedText.includes(lbl) || lbl.includes(selectedText.slice(0, 15)));
            });
            selectedMicBrowserId = matched ? matched.deviceId : null;
        }
    } else {
        selectedMicBrowserId = null;
    }

    if (isLocalServer) {
        try {
            await fetch("/api/config", {
                method: "POST",
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    input_device: typeof inputDev === "number" ? inputDev : null,
                    output_device_primary: primary,
                    output_device_secondary: secondary,
                    hear_myself: hearMyself
                })
            });
        } catch (e) {}
    }
}

async function loadVoices() {
    voices = DEFAULT_VOICES_FALLBACK;
    if (isLocalServer) {
        try {
            const res = await fetch("/api/voices", { headers: getAuthHeaders(false) });
            if (res.ok) {
                const backendVoices = await res.json();
                if (backendVoices && backendVoices.length > 0) {
                    voices = backendVoices;
                }
            }
        } catch (e) {}
    } else {
        try {
            const customSaved = JSON.parse(localStorage.getItem("custom_voices_web") || "[]");
            if (customSaved && customSaved.length > 0) {
                voices = [...customSaved, ...DEFAULT_VOICES_FALLBACK.filter(v => !customSaved.some(c => c.id === v.id))];
            }
        } catch (e) {}
    }
    renderVoiceList();
}

function getVoiceEmoji(name) {
    const n = name.toLowerCase();
    if (n.includes("dross")) return "💀";
    if (n.includes("francisco")) return "🎩";
    if (n.includes("farid")) return "🧠";
    if (n.includes("mega")) return "📺";
    if (n.includes("boric")) return "🇨🇱";
    if (n.includes("auron")) return "🎮";
    if (n.includes("messi")) return "⚽";
    if (n.includes("cristiano") || n.includes("ronaldo") || n.includes("cr7")) return "🐐";
    if (n.includes("maradona")) return "🔟";
    if (n.includes("homero") || n.includes("simpson")) return "🍩";
    if (n.includes("piñera") || n.includes("pinera")) return "🇨🇱";
    if (n.includes("pinochet")) return "🎖️";
    if (n.includes("maduro")) return "🇻🇪";
    if (n.includes("goku")) return "💥";
    if (n.includes("closs") || n.includes("palma")) return "📢";
    if (n.includes("peruano")) return "🇵🇪";
    if (n.includes("xokas")) return "⚡";
    if (n.includes("shrek")) return "🧅";
    if (n.includes("burro")) return "🫏";
    if (n.includes("julio") || n.includes("jc")) return "🎙️";
    if (n.includes("camiroaga")) return "🦅";
    if (n.includes("cartman")) return "🍔";
    if (n.includes("huaso") || n.includes("tio rene")) return "🤠";
    if (n.includes("davo")) return "🟦";
    return "🎙️";
}

function renderVoiceList() {
    voiceList.innerHTML = "";
    voiceDropdownSelect.innerHTML = "";

    voices.forEach(v => {
        const isSelected = appConfig && appConfig.selected_voice === v.id;
        const emoji = getVoiceEmoji(v.name);

        if (isSelected) {
            activeVoiceName.textContent = `${emoji} ${v.name}`;
            activeVoiceDesc.textContent = v.description || "Voz activa para transmisión";
            activeVoiceId.textContent = v.id;
        }

        // Add to Dropdown
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = `${emoji} ${v.name}`;
        if (isSelected) opt.selected = true;
        voiceDropdownSelect.appendChild(opt);

        // Add to List
        const card = document.createElement("div");
        card.className = `voice-card ${isSelected ? "selected" : ""}`;
        card.innerHTML = `
            <div>
                <div class="voice-card-name">${emoji} ${v.name}</div>
                <div class="voice-card-id">${v.id.substring(0, 16)}...</div>
            </div>
            ${isSelected ? '<span style="color:var(--primary); font-size:12px;">✓ Activa</span>' : ''}
        `;
        card.onclick = () => selectVoice(v);
        voiceList.appendChild(card);
    });

    // Dropdown change listener
    voiceDropdownSelect.onchange = (e) => {
        const targetId = e.target.value;
        const found = voices.find(x => x.id === targetId);
        if (found) selectVoice(found);
    };
}

async function selectVoice(voice) {
    const emoji = getVoiceEmoji(voice.name);
    activeVoiceName.textContent = `${emoji} ${voice.name}`;
    activeVoiceDesc.textContent = voice.description || "Voz activa para transmisión";
    activeVoiceId.textContent = voice.id;
    if (appConfig) appConfig.selected_voice = voice.id;
    localStorage.setItem("fish_selected_voice", voice.id);
    voiceDropdownSelect.value = voice.id;
    
    if (isLocalServer) {
        try {
            await fetch("/api/config", {
                method: "POST",
                headers: getAuthHeaders(true),
                body: JSON.stringify({ selected_voice: voice.id })
            });
        } catch (e) {}
    }
    
    renderVoiceList();
    showToast(`Voz activada: ${voice.name}`);
}

// =========================================================================
// 🔴 CONTINUOUS LIVE STREAMING (ALWAYS-ON DISCORD MODE)
// =========================================================================

function setupContinuousControls() {
    btnToggleLive.addEventListener("click", toggleLiveStreaming);

    sliderVadThreshold.addEventListener("input", (e) => {
        vadThreshold = parseInt(e.target.value);
        valThreshold.textContent = `${vadThreshold}%`;
        vadThresholdLine.style.left = `${vadThreshold}%`;
    });

    sliderSilenceTime.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        const sec = (val / 10).toFixed(1);
        vadSilenceLimit = val * 100; // e.g. 4 -> 400ms
        valSilenceTime.textContent = `${sec}s`;
    });

    btnClearFeed.addEventListener("click", () => {
        liveSentencesFeed.innerHTML = `<div class="empty-feed-msg">El feed de transmisión ha sido limpiado.</div>`;
    });
}

async function toggleLiveStreaming() {
    if (isLiveStreaming) {
        stopLiveStreaming();
    } else {
        await startLiveStreaming();
    }
}

async function startLiveStreaming() {
    try {
        const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        };
        if (selectedMicBrowserId) {
            audioConstraints.deviceId = { exact: selectedMicBrowserId };
        }

        liveStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints
        });

        liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (liveAudioCtx.state === 'suspended') await liveAudioCtx.resume();

        const source = liveAudioCtx.createMediaStreamSource(liveStream);
        liveAnalyser = liveAudioCtx.createAnalyser();
        liveAnalyser.fftSize = 512;
        source.connect(liveAnalyser);

        // Start background Speech Recognition for ultra-fast parallel STT if supported
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            try {
                liveSpeechRecognizer = new SpeechRecognition();
                liveSpeechRecognizer.continuous = true;
                liveSpeechRecognizer.interimResults = true;
                liveSpeechRecognizer.lang = (appConfig && appConfig.language) || "es-CL";
                liveSpeechRecognizer.onresult = (e) => {
                    let text = "";
                    for (let i = 0; i < e.results.length; ++i) {
                        text += e.results[i][0].transcript;
                    }
                    liveRecognizedText = text.trim();
                };
                liveSpeechRecognizer.onerror = () => {};
                liveSpeechRecognizer.start();
            } catch (srErr) {}
        }

        isLiveStreaming = true;
        btnToggleLive.classList.add("is-active");
        btnToggleLiveText.textContent = "DETENER TRANSMISIÓN";
        document.querySelector(".master-live-card").classList.add("is-live-active");
        updateLiveState("listening");

        startVadLoop();
        showToast("⚡ Modo Ultra Rápido en Vivo ACTIVADO");
    } catch (e) {
        console.error("Error activando modo en vivo:", e);
        showToast("Error al abrir el micrófono. Permite el acceso en tu navegador.", true);
    }
}

function stopLiveStreaming() {
    isLiveStreaming = false;
    isSpeechActive = false;

    if (liveAnimFrame) cancelAnimationFrame(liveAnimFrame);
    if (silenceTimer) clearTimeout(silenceTimer);

    if (liveSpeechRecognizer) {
        try { liveSpeechRecognizer.stop(); } catch(e){}
        liveSpeechRecognizer = null;
    }

    if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
        liveMediaRecorder.stop();
        liveMediaRecorder = null;
    }

    if (liveStream) {
        liveStream.getTracks().forEach(t => t.stop());
        liveStream = null;
    }

    btnToggleLive.classList.remove("is-active");
    btnToggleLiveText.textContent = "ACTIVAR TRANSMISIÓN";
    document.querySelector(".master-live-card").classList.remove("is-live-active");
    updateLiveState("off");

    vadMeterFill.style.width = "0%";
    vadStatusText.textContent = "Apagado";
    showToast("Transmisión en Vivo Desactivada");
}

function updateLiveState(state) {
    liveStateBadge.className = `live-state-badge state-${state}`;
    if (state === 'off') {
        liveStateText.textContent = "MODO ESPERA (APAGADO)";
    } else if (state === 'listening') {
        liveStateText.textContent = "🟢 EN VIVO (ESCUCHANDO MICRÓFONO)";
    } else if (state === 'speaking') {
        liveStateText.textContent = "🔴 HABLANDO (GRABANDO FRASE)";
    } else if (state === 'processing') {
        liveStateText.textContent = "⚡ CLONANDO CON FISH AUDIO...";
    }
}

function startVadLoop() {
    const buffer = new Uint8Array(liveAnalyser.frequencyBinCount);

    function checkVad() {
        if (!isLiveStreaming) return;
        liveAnimFrame = requestAnimationFrame(checkVad);

        liveAnalyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i];
        }
        const avg = sum / buffer.length;
        const volumePercent = Math.min(100, Math.round((avg / 128) * 100));

        // Update Meter UI
        vadMeterFill.style.width = `${volumePercent}%`;

        // Check against threshold
        if (volumePercent >= vadThreshold) {
            // User is actively speaking
            vadStatusText.textContent = `🎙️ Hablando (${volumePercent}%)`;
            vadStatusText.style.color = "#00ff88";

            if (!isSpeechActive) {
                // Speech started!
                isSpeechActive = true;
                speechStartTime = Date.now();
                liveRecognizedText = "";
                updateLiveState("speaking");
                startLiveChunkRecording();
            }

            // Reset silence timer whenever volume is above threshold
            if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
            }
        } else {
            // Silence
            if (isSpeechActive) {
                vadStatusText.textContent = `Pausa detectada... (${volumePercent}%)`;
                vadStatusText.style.color = "var(--text-muted)";

                if (!silenceTimer) {
                    silenceTimer = setTimeout(() => {
                        // User stopped speaking for the silence duration limit
                        finalizeLiveChunk();
                    }, vadSilenceLimit);
                }
            } else {
                vadStatusText.textContent = `En silencio (${volumePercent}%)`;
                vadStatusText.style.color = "var(--text-dim)";
            }
        }
    }
    checkVad();
}

function startLiveChunkRecording() {
    liveAudioChunks = [];
    try {
        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';

        liveMediaRecorder = new MediaRecorder(liveStream, { mimeType });
        liveMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) liveAudioChunks.push(e.data);
        };
        liveMediaRecorder.start(100);
    } catch (e) {
        console.error("Error starting live MediaRecorder:", e);
    }
}

function finalizeLiveChunk() {
    if (!isSpeechActive) return;
    isSpeechActive = false;
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }

    const duration = Date.now() - speechStartTime;
    const fastText = liveRecognizedText.trim();

    if (duration < 500 && !fastText) {
        // Ignore tiny background noise / clicks without error
        updateLiveState("listening");
        if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
            liveMediaRecorder.stop();
        }
        return;
    }

    updateLiveState("processing");

    if (fastText && fastText.length > 1) {
        // ULTRA-FAST PATH: Send pre-transcribed text directly to TTS!
        liveRecognizedText = "";
        processLiveTextDirect(fastText);
    } else if (liveMediaRecorder && liveMediaRecorder.state !== 'inactive') {
        // FALLBACK PATH: Upload audio chunk to server
        liveMediaRecorder.onstop = async () => {
            if (liveAudioChunks.length > 0 && duration >= 500) {
                const blob = new Blob(liveAudioChunks, { type: liveMediaRecorder.mimeType || 'audio/webm' });
                await processLiveSentenceChunk(blob);
            } else {
                updateLiveState("listening");
            }
        };
        liveMediaRecorder.stop();
    } else {
        updateLiveState("listening");
    }
}

// --- Helper to Replay Audio directly to Discord ---
async function replayToDiscord(audioBase64, feedElement, text) {
    try {
        feedElement.classList.add("playing");
        const tag = feedElement.querySelector(".feed-tag");
        if (tag) {
            tag.className = "feed-tag";
            tag.textContent = "🔁 RE-ENVIANDO...";
        }

        const res = await fetch("/api/replay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio_base64: audioBase64 })
        });

        if (!res.ok) {
            throw new Error("Error retransmitiendo audio");
        }

        if (tag) {
            tag.className = "feed-tag done";
            tag.textContent = "✓ RE-EMITIDO A DISCORD";
        }

        showToast(`🔁 Re-transmitido a Discord: "${text.substring(0, 30)}..."`);

        setTimeout(() => {
            feedElement.classList.remove("playing");
        }, 2000);
    } catch (err) {
        console.error("Replay error:", err);
        showToast("Error al retransmitir a Discord", true);
    }
}

function playLocally(audioBase64) {
    const snd = new Audio(audioBase64);
    snd.play().catch(() => {});
}

// Ultra-Fast Direct Text Processing (0ms STT delay)
async function processLiveTextDirect(text) {
    const timeStr = new Date().toLocaleTimeString();
    const currentVoiceObj = voices.find(v => v.id === appConfig.selected_voice) || { name: "Voz IA" };
    const emoji = getVoiceEmoji(currentVoiceObj.name);

    const feedItem = document.createElement("div");
    feedItem.className = "feed-item";
    feedItem.innerHTML = `
        <div class="feed-main">
            <div class="feed-text">"${text}"</div>
            <div class="feed-voice-sub">${emoji} ${currentVoiceObj.name}</div>
        </div>
        <div class="feed-meta">
            <span class="feed-time">${timeStr}</span>
            <span class="feed-tag">PROCESANDO...</span>
        </div>
    `;

    const emptyMsg = liveSentencesFeed.querySelector(".empty-feed-msg");
    if (emptyMsg) emptyMsg.remove();
    liveSentencesFeed.prepend(feedItem);

    try {
        let audioBlob;
        if (isLocalServer) {
            try {
                const res = await fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: text,
                        reference_id: appConfig.selected_voice,
                        model: appConfig.model || "s2.1-pro-free",
                        play_now: true
                    })
                });

                if (res.status === 402) {
                    creditAlertBanner.classList.remove("hidden");
                    throw new Error("Créditos de desarrollador insuficientes (Error 402).");
                }

                if (res.ok) {
                    audioBlob = await res.blob();
                } else {
                    audioBlob = await callFishAudioDirect(text);
                }
            } catch (err) {
                if (err.message.includes("402")) throw err;
                audioBlob = await callFishAudioDirect(text);
            }
        } else {
            audioBlob = await callFishAudioDirect(text);
        }
        
        // Convert Blob to Base64 for instant replaying
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64Audio = reader.result;
            
            feedItem.classList.add("playing");
            feedItem.innerHTML = `
                <div class="feed-main">
                    <div class="feed-text">"${text}"</div>
                    <div class="feed-voice-sub">${emoji} ${currentVoiceObj.name}</div>
                </div>
                <div class="feed-meta">
                    <span class="feed-time">${timeStr}</span>
                    <button class="btn-listen-local" title="Escuchar en tus auriculares" onclick="playLocally('${base64Audio}')">▶️</button>
                    <button class="btn-replay-discord" title="Volver a transmitir a Discord">
                        <span>🔁</span> Re-transmitir a Discord
                    </button>
                    <span class="feed-tag done">✓ EMITIDO</span>
                </div>
            `;

            feedItem.querySelector(".btn-replay-discord").onclick = () => {
                replayToDiscord(base64Audio, feedItem, text);
            };

            setTimeout(() => feedItem.classList.remove("playing"), 2000);
        };

        if (checkHearMyself.checked) {
            audioPlayer.src = URL.createObjectURL(audioBlob);
            audioPlayer.play().catch(() => {});
        }

    } catch (e) {
        console.warn("Direct TTS error:", e.message);
        feedItem.querySelector(".feed-meta").innerHTML = `
            <span class="feed-time">${timeStr}</span>
            <span class="feed-tag" style="background:rgba(255,51,102,0.2); color:#ff3366;">ERROR</span>
        `;
    } finally {
        if (isLiveStreaming) {
            updateLiveState("listening");
        }
    }
}

async function processLiveSentenceChunk(blob) {
    const timeStr = new Date().toLocaleTimeString();
    const currentVoiceObj = voices.find(v => v.id === appConfig.selected_voice) || { name: "Voz IA" };
    const emoji = getVoiceEmoji(currentVoiceObj.name);

    const feedItem = document.createElement("div");
    feedItem.className = "feed-item";
    feedItem.innerHTML = `
        <div class="feed-main">
            <div class="feed-text">⏳ Reconociendo audio...</div>
            <div class="feed-voice-sub">${emoji} ${currentVoiceObj.name}</div>
        </div>
        <div class="feed-meta">
            <span class="feed-time">${timeStr}</span>
            <span class="feed-tag">PROCESANDO</span>
        </div>
    `;

    const emptyMsg = liveSentencesFeed.querySelector(".empty-feed-msg");
    if (emptyMsg) emptyMsg.remove();
    liveSentencesFeed.prepend(feedItem);

    try {
        if (isLocalServer) {
            const formData = new FormData();
            formData.append("file", blob, "chunk.webm");
            if (appConfig && appConfig.selected_voice) {
                formData.append("reference_id", appConfig.selected_voice);
            }

            const res = await fetch("/api/voice-convert", {
                method: "POST",
                body: formData
            });

            if (res.status === 402) {
                creditAlertBanner.classList.remove("hidden");
                throw new Error("Créditos de API de desarrollador insuficientes (Error 402).");
            }

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Error" }));
                throw new Error(err.detail || "Error en el servidor");
            }

            const data = await res.json();
            const base64Audio = data.audio_base64;
            const text = data.transcription;

            feedItem.classList.add("playing");
            feedItem.innerHTML = `
                <div class="feed-main">
                    <div class="feed-text">"${text}"</div>
                    <div class="feed-voice-sub">${emoji} ${currentVoiceObj.name}</div>
                </div>
                <div class="feed-meta">
                    <span class="feed-time">${timeStr}</span>
                    <button class="btn-listen-local" title="Escuchar en tus auriculares" onclick="playLocally('${base64Audio}')">▶️</button>
                    <button class="btn-replay-discord" title="Volver a transmitir a Discord">
                        <span>🔁</span> Re-transmitir a Discord
                    </button>
                    <span class="feed-tag done">✓ EMITIDO</span>
                </div>
            `;

            feedItem.querySelector(".btn-replay-discord").onclick = () => {
                replayToDiscord(base64Audio, feedItem, text);
            };

            setTimeout(() => feedItem.classList.remove("playing"), 2000);

            if (checkHearMyself.checked) {
                audioPlayer.src = base64Audio;
                audioPlayer.play().catch(() => {});
            }
        } else {
            // Web Client fallback for continuous mode
            const textToSay = liveRecognizedText || "Frase detectada por voz";
            await processLiveTextDirect(textToSay);
            feedItem.remove();
        }

    } catch (e) {
        console.warn("Live chunk error:", e.message);
        feedItem.remove(); // Remove empty noise trigger cleanly
    } finally {
        if (isLiveStreaming) {
            updateLiveState("listening");
        }
    }
}

// =========================================================================
// 🎙️ MANUAL PUSH-TO-TALK (PTT)
// =========================================================================

async function startSpeaking() {
    if (isRecording || isProcessing || isLiveStreaming) return;
    isRecording = true;
    manualAudioChunks = [];
    manualPttTranscript = "";
    
    btnPtt.classList.add("active-recording");
    recordingBadge.classList.remove("hidden");
    transcriptionStatus.textContent = "Grabando...";
    transcriptionText.textContent = "Escuchando tu voz por el micrófono...";

    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        
        const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        };
        if (selectedMicBrowserId) {
            audioConstraints.deviceId = { exact: selectedMicBrowserId };
        }

        micStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints
        });

        // Setup Visualizer
        const source = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        startVisualizerLoop();

        // Setup Speech Recognition for instant client STT
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            try {
                manualSpeechRecognizer = new SpeechRecognition();
                manualSpeechRecognizer.continuous = true;
                manualSpeechRecognizer.interimResults = true;
                manualSpeechRecognizer.lang = (appConfig && appConfig.language) || "es-CL";
                manualSpeechRecognizer.onresult = (e) => {
                    let text = "";
                    for (let i = 0; i < e.results.length; ++i) {
                        text += e.results[i][0].transcript;
                    }
                    manualPttTranscript = text.trim();
                    if (manualPttTranscript) {
                        transcriptionText.textContent = `"${manualPttTranscript}"`;
                    }
                };
                manualSpeechRecognizer.onerror = () => {};
                manualSpeechRecognizer.start();
            } catch (srErr) {}
        }

        // Setup MediaRecorder
        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';

        manualMediaRecorder = new MediaRecorder(micStream, { mimeType });
        manualMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) manualAudioChunks.push(e.data);
        };

        manualMediaRecorder.onstop = async () => {
            if (manualAudioChunks.length > 0) {
                const audioBlob = new Blob(manualAudioChunks, { type: manualMediaRecorder.mimeType || 'audio/webm' });
                await sendVoiceToConvert(audioBlob);
            }
        };

        manualMediaRecorder.start(100);
    } catch (e) {
        console.error("Error accediendo al micrófono:", e);
        showToast("Error al acceder al micrófono. Permite el acceso en el navegador.", true);
        stopSpeaking();
    }
}

async function stopSpeaking() {
    if (!isRecording) return;
    isRecording = false;
    btnPtt.classList.remove("active-recording");
    recordingBadge.classList.add("hidden");

    if (manualSpeechRecognizer) {
        try { manualSpeechRecognizer.stop(); } catch (e) {}
        manualSpeechRecognizer = null;
    }

    if (manualMediaRecorder && manualMediaRecorder.state !== 'inactive') {
        manualMediaRecorder.stop();
    }

    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
}

async function sendVoiceToConvert(audioBlob) {
    if (audioBlob.size < 1000 && !manualPttTranscript) {
        transcriptionStatus.textContent = "Listo";
        transcriptionText.textContent = "Grabación muy corta. Mantén presionado mientras hablas.";
        startIdleVisualizer();
        return;
    }

    isProcessing = true;
    processingBadge.classList.remove("hidden");
    transcriptionStatus.textContent = "Transcribiendo y Clonando...";
    transcriptionText.textContent = "Procesando con IA...";

    try {
        if (isLocalServer) {
            const formData = new FormData();
            formData.append("file", audioBlob, "voice.webm");
            if (appConfig && appConfig.selected_voice) {
                formData.append("reference_id", appConfig.selected_voice);
            }

            const res = await fetch("/api/voice-convert", {
                method: "POST",
                body: formData
            });

            if (res.status === 402) {
                creditAlertBanner.classList.remove("hidden");
                throw new Error("Créditos insuficientes en tu cuenta de desarrollador de Fish Audio (Error 402). Recarga en fish.audio/app/developers");
            }

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({ detail: "Error en el servidor" }));
                throw new Error(errJson.detail || `Error HTTP ${res.status}`);
            }

            const data = await res.json();
            transcriptionText.textContent = `"${data.transcription}"`;
            transcriptionStatus.textContent = "✓ Clonado con Éxito";

            latestAudioCard.classList.remove("hidden");
            audioPlayer.src = data.audio_base64;
            audioPlayer.play();

            showToast("¡Voz clonada y transmitida con éxito!");
        } else {
            // Standalone Web Mode (GitHub Pages)
            const textToSay = manualPttTranscript || "¡Hola! Probando voz clonada con inteligencia artificial.";
            transcriptionText.textContent = `"${textToSay}"`;
            await sendToFishAudio(textToSay);
        }

    } catch (err) {
        transcriptionStatus.textContent = "❌ Error";
        showToast(err.message, true);
    } finally {
        isProcessing = false;
        processingBadge.classList.add("hidden");
        startIdleVisualizer();
    }
}

// =========================================================================
// ✍️ TEXT TO SPEECH
// =========================================================================

async function sendToFishAudio(text) {
    isProcessing = true;
    processingBadge.classList.remove("hidden");
    transcriptionStatus.textContent = "Generando Voz IA...";

    try {
        let audioBlob;
        if (isLocalServer) {
            try {
                const res = await fetch("/api/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: text,
                        reference_id: appConfig.selected_voice,
                        model: appConfig.model || "s2.1-pro-free",
                        play_now: true
                    })
                });

                if (res.status === 402) {
                    creditAlertBanner.classList.remove("hidden");
                    throw new Error("Créditos insuficientes en tu cuenta de desarrollador de Fish Audio (Error 402). Recarga en fish.audio/app/developers");
                }

                if (res.ok) {
                    audioBlob = await res.blob();
                } else {
                    throw new Error("Fallback directo");
                }
            } catch (serverErr) {
                if (serverErr.message.includes("402")) throw serverErr;
                audioBlob = await callFishAudioDirect(text);
            }
        } else {
            audioBlob = await callFishAudioDirect(text);
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        latestAudioCard.classList.remove("hidden");
        audioPlayer.src = audioUrl;
        audioPlayer.play();

        transcriptionStatus.textContent = "✓ Reproducido con éxito";
        showToast("¡Audio generado y reproducido!");

    } catch (err) {
        transcriptionStatus.textContent = "❌ Error";
        showToast(err.message, true);
    } finally {
        isProcessing = false;
        processingBadge.classList.add("hidden");
        startIdleVisualizer();
    }
}

async function callFishAudioDirect(text) {
    const apiKey = (appConfig && appConfig.api_key) || localStorage.getItem("fish_api_key") || "sk-fish-MrvjytXetS4Gh8Yrlj7n380D3CvWK3T4McgK6WSk6Dc";
    const directRes = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "model": (appConfig && appConfig.model) || "s2.1-pro-free"
        },
        body: JSON.stringify({
            text: text,
            reference_id: (appConfig && appConfig.selected_voice) || "97582f301e1c4f93a514ceda15e23e26",
            format: "mp3",
            latency: "balanced"
        })
    });

    if (directRes.status === 402) {
        creditAlertBanner.classList.remove("hidden");
        throw new Error("Créditos insuficientes en Fish Audio API (Error 402). Recarga créditos de desarrollador en https://fish.audio/app/developers");
    }

    if (!directRes.ok) {
        throw new Error(`Error en Fish Audio API: HTTP ${directRes.status}`);
    }

    return await directRes.blob();
}

// --- Visualizer Animation ---
function startVisualizerLoop() {
    if (visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!isRecording && !isProcessing) return;
        visualizerAnimationId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        canvasCtx.fillStyle = "rgba(10, 13, 20, 0.4)";
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

            const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, 0);
            gradient.addColorStop(0, '#00f0ff');
            gradient.addColorStop(0.5, '#9d4edd');
            gradient.addColorStop(1, '#ff007f');

            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 2;
        }
    }
    draw();
}

function startIdleVisualizer() {
    if (visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);
    let step = 0;

    function drawIdle() {
        if (isRecording || isProcessing) return;
        visualizerAnimationId = requestAnimationFrame(drawIdle);

        canvasCtx.fillStyle = "rgba(10, 13, 20, 0.25)";
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        canvasCtx.beginPath();
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = "rgba(0, 240, 255, 0.35)";

        const sliceWidth = canvas.width / 100;
        let x = 0;

        for (let i = 0; i < 100; i++) {
            const y = canvas.height / 2 + Math.sin(i * 0.15 + step) * 12 + Math.cos(i * 0.08 - step) * 8;
            if (i === 0) canvasCtx.moveTo(x, y);
            else canvasCtx.lineTo(x, y);
            x += sliceWidth;
        }

        canvasCtx.stroke();
        step += 0.04;
    }
    drawIdle();
}

// --- Event Listeners & Shortcuts ---
function setupEventListeners() {
    // Mouse PTT
    btnPtt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startSpeaking();
    });
    window.addEventListener("mouseup", () => {
        if (isRecording) stopSpeaking();
    });

    // Touch PTT
    btnPtt.addEventListener("touchstart", (e) => {
        e.preventDefault();
        startSpeaking();
    });
    window.addEventListener("touchend", () => {
        if (isRecording) stopSpeaking();
    });

    // Keyboard Spacebar PTT (only if live streaming is off)
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
            if (!isLiveStreaming) {
                e.preventDefault();
                if (!isRecording) startSpeaking();
            }
        }
        if (e.ctrlKey && e.code === "Enter" && ttsTextInput === document.activeElement) {
            btnGenerateTTS.click();
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
            if (!isLiveStreaming) {
                e.preventDefault();
                if (isRecording) stopSpeaking();
            }
        }
    });

    // TTS Studio
    ttsTextInput.addEventListener("input", () => {
        charCount.textContent = `${ttsTextInput.value.length} caracteres`;
    });

    btnGenerateTTS.addEventListener("click", () => {
        const text = ttsTextInput.value.trim();
        if (!text) {
            showToast("Escribe algún texto para generar", true);
            return;
        }
        sendToFishAudio(text);
    });

    btnClearTTS.addEventListener("click", () => {
        ttsTextInput.value = "";
        charCount.textContent = "0 caracteres";
    });

    // Routing selects
    if (selectInputDevice) selectInputDevice.addEventListener("change", updateAudioRouting);
    selectPrimaryOutput.addEventListener("change", updateAudioRouting);
    selectSecondaryOutput.addEventListener("change", updateAudioRouting);
    checkHearMyself.addEventListener("change", updateAudioRouting);

    // Modals
    document.getElementById("btnOpenSettings").addEventListener("click", openSettingsModal);
    document.getElementById("btnSaveSettings").addEventListener("click", saveSettings);
    document.getElementById("btnAddNewVoice").addEventListener("click", openNewVoiceModal);
    document.getElementById("btnSaveNewVoice").addEventListener("click", saveNewVoice);
}

// --- Tab Switching ---
function setupTabSwitching() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

            tab.classList.add("active");
            const targetId = tab.getAttribute("data-tab");
            document.getElementById(targetId).classList.add("active");
        });
    });
}

function insertTag(tag) {
    const start = ttsTextInput.selectionStart;
    const end = ttsTextInput.selectionEnd;
    const text = ttsTextInput.value;
    ttsTextInput.value = text.substring(0, start) + tag + " " + text.substring(end);
    ttsTextInput.focus();
    ttsTextInput.selectionStart = ttsTextInput.selectionEnd = start + tag.length + 1;
    charCount.textContent = `${ttsTextInput.value.length} caracteres`;
}

// --- Modal Handlers ---
function openSettingsModal() {
    settingApiKey.value = appConfig.api_key || "";
    settingModel.value = appConfig.model || "s2.1-pro-free";
    settingLang.value = appConfig.language || "es-CL";
    settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
    settingsModal.classList.add("hidden");
}

async function saveSettings() {
    const key = settingApiKey.value.trim();
    const model = settingModel.value;
    const lang = settingLang.value;

    localStorage.setItem("fish_api_key", key);
    localStorage.setItem("fish_model", model);
    localStorage.setItem("fish_language", lang);

    if (isLocalServer) {
        try {
            await fetch("/api/config", {
                method: "POST",
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    api_key: key,
                    model: model,
                    language: lang
                })
            });
        } catch (e) {}
    }

    closeSettingsModal();
    await loadAppConfig();
    showToast("Configuración guardada");
}

function openNewVoiceModal() {
    newVoiceId.value = "";
    newVoiceName.value = "";
    newVoiceDesc.value = "";
    newVoiceModal.classList.remove("hidden");
}

function closeNewVoiceModal() {
    newVoiceModal.classList.add("hidden");
}

async function saveNewVoice() {
    const id = newVoiceId.value.trim();
    const name = newVoiceName.value.trim();
    const desc = newVoiceDesc.value.trim();

    if (!id || !name) {
        showToast("El Reference ID y el Nombre son obligatorios", true);
        return;
    }

    if (isLocalServer) {
        try {
            await fetch("/api/voices", {
                method: "POST",
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    id: id,
                    name: name,
                    description: desc
                })
            });
        } catch (e) {}
    } else {
        try {
            const customSaved = JSON.parse(localStorage.getItem("custom_voices_web") || "[]");
            customSaved.unshift({ id, name, description: desc, sample_text: "" });
            localStorage.setItem("custom_voices_web", JSON.stringify(customSaved));
        } catch (e) {}
    }

    closeNewVoiceModal();
    await loadVoices();
    showToast(`Voz "${name}" añadida a tu biblioteca`);
}

// =========================================================================
// 🔐 MONGODB AUTHENTICATION & USER SESSION HANDLERS
// =========================================================================

function setupAuthListeners() {
    if (btnOpenLoginModal) btnOpenLoginModal.addEventListener("click", () => openAuthModal("login"));
    if (btnLogout) btnLogout.addEventListener("click", logoutUser);
    if (btnSubmitAuth) btnSubmitAuth.addEventListener("click", submitAuth);

    // Press Enter to submit in auth inputs
    [authUsername, authEmail, authPassword].forEach(input => {
        if (input) {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") submitAuth();
            });
        }
    });
}

async function checkAuthStatus() {
    if (!authToken) {
        currentUser = null;
        updateAuthUI();
        return;
    }

    if (isLocalServer) {
        try {
            const res = await fetch("/api/auth/me", {
                headers: getAuthHeaders(false)
            });

            if (res.ok) {
                const data = await res.json();
                currentUser = data.user;
                updateAuthUI();
                return;
            } else {
                // Token expired or invalid
                authToken = null;
                currentUser = null;
                localStorage.removeItem("voice_clone_auth_token");
                updateAuthUI();
                return;
            }
        } catch (e) {}
    }

    // In Web Mode, read stored user
    try {
        const storedUser = JSON.parse(localStorage.getItem("voice_clone_current_user") || "null");
        currentUser = storedUser;
    } catch (e) {
        currentUser = null;
    }
    updateAuthUI();
}

function updateAuthUI() {
    if (currentUser) {
        btnOpenLoginModal.classList.add("hidden");
        userInfoNav.classList.remove("hidden");
        loggedInUsername.textContent = currentUser.username;
    } else {
        btnOpenLoginModal.classList.remove("hidden");
        userInfoNav.classList.add("hidden");
        loggedInUsername.textContent = "";
    }
}

function switchAuthMode(mode) {
    authMode = mode;
    authAlert.className = "auth-alert hidden";
    authAlert.textContent = "";

    if (mode === "login") {
        tabAuthLogin.classList.add("active");
        tabAuthRegister.classList.remove("active");
        authEmailGroup.classList.add("hidden");
        btnSubmitAuthText.textContent = "Iniciar Sesión";
        authFooterHint.innerHTML = `¿No tienes cuenta? <a href="javascript:void(0)" onclick="switchAuthMode('register')">Regístrate aquí</a>`;
    } else {
        tabAuthLogin.classList.remove("active");
        tabAuthRegister.classList.add("active");
        authEmailGroup.classList.remove("hidden");
        btnSubmitAuthText.textContent = "Crear Cuenta en MongoDB";
        authFooterHint.innerHTML = `¿Ya tienes cuenta? <a href="javascript:void(0)" onclick="switchAuthMode('login')">Inicia sesión aquí</a>`;
    }
}

function openAuthModal(mode = "login") {
    switchAuthMode(mode);
    authUsername.value = "";
    authEmail.value = "";
    authPassword.value = "";
    authAlert.className = "auth-alert hidden";
    authAlert.textContent = "";
    authModal.classList.remove("hidden");
    authUsername.focus();
}

function closeAuthModal() {
    authModal.classList.add("hidden");
}

async function submitAuth() {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    const email = authEmail.value.trim();

    if (!username || !password) {
        showAuthAlert("Ingresa usuario y contraseña", true);
        return;
    }

    btnSubmitAuth.disabled = true;
    const originalText = btnSubmitAuthText.textContent;
    btnSubmitAuthText.textContent = "Procesando...";

    try {
        if (!isLocalServer) {
            // Web Client Mode Login/Register simulation
            currentUser = { username: username, email: email || "" };
            authToken = "web-token-" + btoa(username);
            localStorage.setItem("voice_clone_auth_token", authToken);
            localStorage.setItem("voice_clone_current_user", JSON.stringify(currentUser));
            updateAuthUI();
            closeAuthModal();
            showToast(`¡Sesión iniciada como ${username}!`);
            return;
        }

        const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
        const payload = authMode === "login" 
            ? { username, password } 
            : { username, password, email: email || null };

        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || "Error en autenticación");
        }

        // Save Token & User Session
        authToken = data.user.token;
        localStorage.setItem("voice_clone_auth_token", authToken);
        currentUser = data.user;

        updateAuthUI();
        closeAuthModal();

        // Reload user voices and config
        await loadAppConfig();
        await loadVoices();

        const successMsg = authMode === "login" 
            ? `¡Bienvenido de nuevo, ${currentUser.username}!` 
            : `¡Cuenta creada con éxito! Bienvenido, ${currentUser.username}`;
        showToast(successMsg);

    } catch (err) {
        showAuthAlert(err.message, true);
    } finally {
        btnSubmitAuth.disabled = false;
        btnSubmitAuthText.textContent = originalText;
    }
}

function showAuthAlert(msg, isError = true) {
    authAlert.className = `auth-alert ${isError ? "error" : "success"}`;
    authAlert.textContent = msg;
    authAlert.classList.remove("hidden");
}

async function logoutUser() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem("voice_clone_auth_token");
    localStorage.removeItem("voice_clone_current_user");

    if (isLocalServer) {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (e) {}
    }

    updateAuthUI();
    await loadAppConfig();
    await loadVoices();
    showToast("Has cerrado sesión.");
}
