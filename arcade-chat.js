/**
 * Signal Share Arcade Chat System
 * Shared component for cross-page companion interactions.
 */

let BRIDGE_BASE_URL = "";
const BRIDGE_LAST_WORKING_BASE_KEY = "ss_bridge_last_working_base";
const CHAT_MODEL_PREFERENCE_KEY = 'arcade-chat-model';
const ARCADE_CHAT_SIDEBAR_WIDTH_KEY = 'arcade-chat-sidebar-width';
const STEAM_SHELL_LEFT_NAV_WIDTH = 240;
const STEAM_SHELL_DIVIDER_WIDTH = 6;
const DEFAULT_SIDEBAR_WIDTH = 380;
const MIN_SIDEBAR_WIDTH = 280;
const MIN_GAME_PANEL_WIDTH = 320;
let lastResolvedBridgeCandidatesSignature = "";
let lastResolvedBridgePrimary = "";
let lastBridgeStatusWasOnline = false;
let currentlySpeakingButton = null;
const SPEAKER_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2" fill="currentColor"></rect></svg>';

function normalizeBridgeBaseUrl(baseUrl = "") {
    const raw = `${baseUrl || ""}`.trim();
    if (!raw) return "";
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
        const parsed = new URL(withProtocol, window.location.href);
        const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
        return normalized
            .replace(/\/api\/llm\/chat$/i, "")
            .replace(/\/api\/llm\/models$/i, "")
            .replace(/\/api\/system-media\/current$/i, "")
            .replace(/\/api\/system-media\/action$/i, "");
    } catch (_error) {
        return "";
    }
}

function resolveHttpFallbackBridgeBaseUrl(baseUrl = "") {
    const normalized = normalizeBridgeBaseUrl(baseUrl);
    if (!normalized) return "";
    try {
        const parsed = new URL(normalized, window.location.href);
        if (parsed.protocol !== "https:") return "";
        const targetAddressSpace = getBridgeTargetAddressSpace(normalized);
        if (targetAddressSpace !== "loopback" && targetAddressSpace !== "private") return "";
        parsed.protocol = "http:";
        return normalizeBridgeBaseUrl(parsed.toString());
    } catch (_error) {
        return "";
    }
}

function isAndroidRuntime() {
    return document.documentElement.classList.contains('platform-android')
        || (window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android');
}

function pushBridgeBaseCandidate(candidates, seen, candidate) {
    const normalized = normalizeBridgeBaseUrl(candidate);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
}

function resolveBridgeBaseCandidates() {
    const candidates = [];
    const seen = new Set();
    const host = `${window.location.hostname || ""}`.trim().toLowerCase();
    const protocol = `${window.location.protocol || ""}`.toLowerCase();

    const configured = normalizeBridgeBaseUrl(
        window.SignalShareLocalLlm?.getBridgeBaseUrl?.()
        || localStorage.getItem('ss_bridge_url')
        || localStorage.getItem('signal-share-bridge-url')
        || ""
    );
    const configuredHttpFallback = resolveHttpFallbackBridgeBaseUrl(configured);
    const lastWorking = normalizeBridgeBaseUrl(localStorage.getItem(BRIDGE_LAST_WORKING_BASE_KEY) || "");

    // PRIORITY 1: User Configured URL
    pushBridgeBaseCandidate(candidates, seen, configured);
    pushBridgeBaseCandidate(candidates, seen, configuredHttpFallback);

    // PRIORITY 2: Last Known Working URL
    pushBridgeBaseCandidate(candidates, seen, lastWorking);

    const isLoopbackOrigin = protocol === 'file:'
        || !host
        || host === 'localhost'
        || host.endsWith('.localhost')
        || host === '127.0.0.1'
        || host === '::1'
        || host === '[::1]';

    if (isLoopbackOrigin && protocol !== 'file:') {
        pushBridgeBaseCandidate(candidates, seen, window.location.origin);
    }

    if (host === '127.0.0.1') {
        pushBridgeBaseCandidate(candidates, seen, "http://127.0.0.1:3000");
        pushBridgeBaseCandidate(candidates, seen, "http://localhost:3000");
    } else {
        pushBridgeBaseCandidate(candidates, seen, "http://localhost:3000");
        pushBridgeBaseCandidate(candidates, seen, "http://127.0.0.1:3000");
    }

    if (isAndroidRuntime()) {
        // ALWAYS prioritize the ADB tunnel on Android
        pushBridgeBaseCandidate(candidates, seen, "http://localhost:3000");
        pushBridgeBaseCandidate(candidates, seen, "http://127.0.0.1:3000");
        pushBridgeBaseCandidate(candidates, seen, "http://10.0.2.2:3000");
    }

    if (candidates.length > 0) {
        BRIDGE_BASE_URL = candidates[0];
        const signature = candidates.join("|");
        if (signature !== lastResolvedBridgeCandidatesSignature || BRIDGE_BASE_URL !== lastResolvedBridgePrimary) {
            console.log(`[Arcade Chat] Resolved bridge candidates: ${candidates.join(", ")}. Using: ${BRIDGE_BASE_URL}`);
            lastResolvedBridgeCandidatesSignature = signature;
            lastResolvedBridgePrimary = BRIDGE_BASE_URL;
        }
    } else {
        console.warn("[Arcade Chat] No bridge candidates resolved. AI features may be unavailable.");
    }

    return candidates;
}

// --- VOICE ENGINE (TTS / STT) ---
let arcadeSpeechRecognition = null;
let isArcadeDictating = false;
let isVoiceSessionActive = false;
let isSecureInsecure = false;

function playStartBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
        console.warn('[Voice] Beep failed:', e);
    }
}
let arcadeSpeechSynth = window.speechSynthesis;

function initArcadeSpeech() {
    if (arcadeSpeechRecognition) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    if (!SpeechRecognition) {
        console.error('[Voice] Speech Recognition API not supported in this browser.');
        window.isSpeechSupported = false;
        return;
    }

    // Check for Secure Context (Required for Mic in most browsers)
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.warn('[Voice] Warning: Insecure context detected. Microphone might be blocked.');
        window.isSecureInsecure = true;
    }

    window.isSpeechSupported = true;

    try {
        arcadeSpeechRecognition = new SpeechRecognition();
        arcadeSpeechRecognition.continuous = true;
        arcadeSpeechRecognition.interimResults = true;
        arcadeSpeechRecognition.lang = 'en-US';

        arcadeSpeechRecognition.onstart = () => {
            console.log('[Voice] Dictation started.');
            const input = document.getElementById('arc-chat-input');
            if (input) {
                input.placeholder = "Listening...";
                input.value = ""; // Clear for new dictation
            }
            playStartBeep();
        };

        arcadeSpeechRecognition.onresult = (event) => {
            const input = document.getElementById('arc-chat-input');
            if (!input) return;

            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Update the input with what we have so far
            const combined = (finalTranscript || interimTranscript).trim();
            if (combined) {
                input.value = combined;
                input.placeholder = "Listening...";
                console.log('[Voice] Transcript:', combined);
            }
        };

        arcadeSpeechRecognition.onerror = (event) => {
            console.error('[Voice] Recognition error:', event.error);
            if (event.error === 'no-speech') {
                const input = document.getElementById('arc-chat-input');
                if (input) input.placeholder = "No speech detected. Try speaking louder!";
            }
            if (event.error === 'audio-capture') {
                alert("Microphone not found. Check your Chrome mic settings!");
            }
        };

        arcadeSpeechRecognition.onend = () => {
            console.log('[Voice] Dictation ended.');
            updateChatPlaceholder();
        };
    } catch (err) {
        console.error('[Voice] Failed to initialize SpeechRecognition:', err);
    }
}

function speakArcadeText(text, btnElement = null) {
    if (!arcadeSpeechSynth) return;

    // TOGGLE LOGIC: If already speaking, stop and return
    if (arcadeSpeechSynth.speaking) {
        arcadeSpeechSynth.cancel();
        // If we clicked the SAME button that was speaking, we just stop.
        if (currentlySpeakingButton === btnElement && btnElement) {
            return;
        }
        // If we clicked a DIFFERENT button, we stop the old one (done above) 
        // and continue to start the new one.
    }

    // Reset old button if exists
    if (currentlySpeakingButton) {
        currentlySpeakingButton.innerHTML = SPEAKER_ICON;
        currentlySpeakingButton.classList.remove('speaking');
    }

    // On some Androids, we need to wait for voices to load or handle empty list
    const voices = arcadeSpeechSynth.getVoices();
    if (voices.length === 0) {
        // If no voices yet, wait for them and try again once
        arcadeSpeechSynth.onvoiceschanged = () => {
            arcadeSpeechSynth.onvoiceschanged = null; // Only once
            speakArcadeText(text);
        };
        // Also try a silent speak to "prime" the engine on Android
        try { arcadeSpeechSynth.speak(new SpeechSynthesisUtterance("")); } catch (e) { }
        return;
    }

    const cleanText = text.replace(/\[[\s\S]*?\]/g, "").trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    // Find best English voice, or fallback to any
    const voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
        || voices.find(v => v.lang.startsWith('en'))
        || voices[0];

    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // ERROR HANDLING: If it fails, log it for debugging
    utterance.onerror = (e) => {
        if (currentlySpeakingButton === btnElement) {
            currentlySpeakingButton.innerHTML = SPEAKER_ICON;
            currentlySpeakingButton.classList.remove('speaking');
            currentlySpeakingButton = null;
        }
        // 'interrupted' is normal when we call .cancel() to start a new message
        if (e.error === 'interrupted') return;
        console.error('[Voice] TTS Error:', e);
    };

    utterance.onend = () => {
        if (currentlySpeakingButton === btnElement) {
            currentlySpeakingButton.innerHTML = SPEAKER_ICON;
            currentlySpeakingButton.classList.remove('speaking');
            currentlySpeakingButton = null;
        }
    };

    if (btnElement) {
        currentlySpeakingButton = btnElement;
        currentlySpeakingButton.innerHTML = STOP_ICON;
        currentlySpeakingButton.classList.add('speaking');
    }

    arcadeSpeechSynth.speak(utterance);
}

function parseBridgeBoolean(value) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return null;
}

function isLoopbackSiteOrigin() {
    const protocol = `${window.location.protocol || ""}`.toLowerCase();
    const host = `${window.location.hostname || ""}`.trim().toLowerCase();
    if (protocol === 'file:') return true;
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host === '[::1]'
        || host.endsWith('.localhost');
}

function getWorkshop() {
    if (!window.ArcadeWorkshopManager) {
        return {
            getProtocolDirectives: () => "",
            isWorkshopEditIntentPrompt: () => false,
            isWorkshopRewriteIntentPrompt: () => false,
            isWorkshopMultiFileEditPrompt: () => false,
            isWorkshopEditorReferencePrompt: () => false,
            isWorkshopPublishIntentPrompt: () => false,
            isWorkshopPublishIntent: () => false,
            getActiveWorkshopEditorContext: () => null,
            hasActiveWorkshopEditor: () => false,
            getWorkshopFileKindFromName: () => "",
            allowsLocalStyleFallback: () => false,
            isStyleEditPrompt: () => false,
            isWorkshopEditorModePrompt: () => false,
            extractBalancedJsonTagPayload: () => null,
            robustParseJson: () => null,
            stripArcadeProtocolTags: (c) => c,
            extractWorkshopEditBlocks: () => [],
            buildFilesFromText: () => [],
            looksLikeExecutableCode: () => false,
            buildPublishFiles: () => [],
            inferCodeKind: () => ""
        };
    }
    return window.ArcadeWorkshopManager;
}

function extractBalancedJsonTagPayload(text, tagName) {
    return getWorkshop().extractBalancedJsonTagPayload(text, tagName);
}

function robustParseJson(jsonStr) {
    return getWorkshop().robustParseJson(jsonStr);
}

function stripArcadeProtocolTags(content = "") {
    const result = getWorkshop().stripArcadeProtocolTags(content);
    return { text: result, hadTags: result !== content, publishData: null };
}

function getProtocolDirectives(userPrompt = "", workshopContext = null, attachment = null) {
    try {
        return getWorkshop().getProtocolDirectives(userPrompt, workshopContext, attachment);
    } catch (err) {
        console.error("[Arcade Chat] Failed to get protocol directives:", err);
        return "";
    }
}

/**
 * Checks if the current origin is a private network (LAN) address.
 */
function isPrivateNetworkOrigin() {
    const host = `${window.location.hostname || ""}`.trim().toLowerCase();
    if (!host) return false;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    const octets = host.split('.').map(v => parseInt(v, 10));
    if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (host.endsWith('.local')) return true;
    return false;
}

function isBridgeFeatureEnabled() {
    const explicitFlag = parseBridgeBoolean(
        localStorage.getItem('ss_bridge_enabled')
        ?? localStorage.getItem('signal-share-bridge-enabled')
    );
    if (explicitFlag !== null) return explicitFlag;

    const customBridgeUrl = `${window.SignalShareLocalLlm?.getBridgeBaseUrl?.() || localStorage.getItem('signal-share-bridge-url') || ''}`.trim();
    if (customBridgeUrl) return true;

    const bridgeSecret = `${localStorage.getItem('signal-share-bridge-secret') || ''}`.trim()
        || `${localStorage.getItem('ss_bridge_secret') || ''}`.trim();
    if (bridgeSecret) return true;

    const preferredModel = `${localStorage.getItem(CHAT_MODEL_PREFERENCE_KEY) || ''}`.trim().toLowerCase();
    if (preferredModel && preferredModel !== 'auto') return true;

    if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() !== 'web') {
        return false;
    }

    return isLoopbackSiteOrigin() || isPrivateNetworkOrigin();
}

function toModelDisplayName(modelId = '') {
    const value = `${modelId || ''}`.trim();
    if (!value) return 'Unknown Model';
    return value
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function hydrateChatModelSelect({ forceRefresh = false } = {}) {
    const select = document.getElementById('chat-model-select');
    if (!select) return;
    if (!isBridgeFeatureEnabled()) return;

    try {
        const querySuffix = forceRefresh ? '?force=true' : '';
        const modelCatalogPaths = [`/api/local-llm/models${querySuffix}`, `/api/llm/models${querySuffix}`];
        let response = null;
        for (const path of modelCatalogPaths) {
            const next = await bridgeFetch(path, {
                method: 'GET',
                timeoutMs: 2200
            });
            if (next.ok || next.status !== 404 || path === modelCatalogPaths[modelCatalogPaths.length - 1]) {
                response = next;
                break;
            }
        }

        if (!response || !response.ok) return;
        updateEngineStatus(true);

        const payload = await response.json().catch(() => null);
        const rows = Array.isArray(payload?.models) ? payload.models : [];
        if (rows.length === 0) return;

        const selectedBefore = `${localStorage.getItem(CHAT_MODEL_PREFERENCE_KEY) || select.value || 'auto'}`.trim();
        select.innerHTML = '';

        const autoOption = document.createElement('option');
        autoOption.value = 'auto';
        autoOption.textContent = 'Auto-Select';
        select.appendChild(autoOption);

        const seen = new Set(['auto']);
        for (const row of rows) {
            const modelId = `${row?.id || ''}`.trim();
            if (!modelId) continue;
            const key = modelId.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            const provider = `${row?.provider || ''}`.trim().toLowerCase();
            const option = document.createElement('option');
            option.value = modelId;
            option.textContent = provider && provider !== 'unknown'
                ? `${toModelDisplayName(modelId)} (${provider.toUpperCase()})`
                : toModelDisplayName(modelId);
            select.appendChild(option);
        }

        const hasSelected = Array.from(select.options).some((opt) => opt.value === selectedBefore);
        select.value = hasSelected ? selectedBefore : 'auto';
    } catch (_error) {
        // Keep static options on failure.
    }
}

function setupChatModelSelect() {
    const select = document.getElementById('chat-model-select');
    if (!select) return;

    const savedModel = `${localStorage.getItem(CHAT_MODEL_PREFERENCE_KEY) || ''}`.trim();
    if (savedModel) {
        const hasSaved = Array.from(select.options).some((opt) => opt.value === savedModel);
        select.value = hasSaved ? savedModel : 'auto';
    }

    select.addEventListener('change', () => {
        const nextModel = `${select.value || 'auto'}`.trim();
        localStorage.setItem(CHAT_MODEL_PREFERENCE_KEY, nextModel);
        if (nextModel && nextModel !== 'auto') {
            localStorage.setItem('ss_bridge_enabled', '1');
        }
        void hydrateChatModelSelect({ forceRefresh: true });
    });

    void hydrateChatModelSelect();
}

function resolveChatRequestModel(selectedValue = "auto") {
    const normalizedSelected = `${selectedValue || ""}`.trim();
    if (normalizedSelected && normalizedSelected.toLowerCase() !== "auto") {
        return normalizedSelected;
    }
    // Let the backend auto-selector choose:
    // 1) currently loaded model, 2) DeepSeek fallback if none are loaded.
    return "auto";
}

function getAiCore() {
    return window.SignalShareAiCore || null;
}

function openDuckDuckGoSearch(query = "") {
    const clean = `${query || ""}`.trim();
    if (!clean) return false;
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(clean)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
}

function openSteamGame(target = "") {
    const clean = `${target || ""}`.trim();
    if (!clean) {
        return "🎮 [Steam Protocol]: Tell me which game to launch, e.g. 'Play Grand Theft Auto V'.";
    }

    const plan = getAiCore()?.buildSteamLaunchPlan?.(clean) || null;
    if (plan?.type === "run" && plan.uri) {
        window.location.href = plan.uri;
        return `🎮 [Steam Protocol]: Launching ${plan.key.toUpperCase()} via Steam now.`;
    }

    const searchUrl = plan?.searchUrl || `https://store.steampowered.com/search/?term=${encodeURIComponent(clean)}`;
    window.open(searchUrl, "_blank", "noopener,noreferrer");
    return `🎮 [Steam Protocol]: I couldn't find a direct app ID for "${clean}", so I opened Steam search.`;
}

function parseDirectSteamCommand(text = "") {
    return getAiCore()?.parseDirectSteamCommand?.(text) || "";
}

function parseDuckDuckGoCommand(text = "") {
    return getAiCore()?.parseDuckDuckGoCommand?.(text) || "";
}

function isComposeDraftIntent(message = "") {
    const text = `${message || ""}`.trim().toLowerCase();
    if (!text) return false;
    const hasMessagingTarget = /\b(dm|direct message|message|messenger|inbox|text|reply|respond)\b/.test(text);
    const hasComposeVerb = /\b(compose|draft|write|rewrite|polish|improve|prepare|send)\b/.test(text);
    return hasMessagingTarget && hasComposeVerb;
}



function getActiveWorkshopEditorContext(workshopContext = null) {
    return getWorkshop().getActiveWorkshopEditorContext(workshopContext);
}

function hasActiveWorkshopEditor(workshopContext = null) {
    return getWorkshop().hasActiveWorkshopEditor(workshopContext);
}







function buildProtocolAwareUserMessage(userPrompt = "") {
    return `${userPrompt || ''}`.trim();
}



function buildWorkshopEditRetryContext(userPrompt = '', richContext = null) {
    const latestEditor = typeof window.getWorkshopEditorState === 'function'
        ? window.getWorkshopEditorState()
        : null;
    const editor = latestEditor || getActiveWorkshopEditorContext(richContext);
    const activeGameId = `${editor?.activeGameId || ''}`.trim();
    const activeFileName = `${editor?.activeFileName || ''}`.trim();
    const activeFileContent = `${editor?.activeFileContent || ''}`;
    if (!activeGameId || !activeFileName || !activeFileContent.trim()) return '';

    const context = {
        workshopEditor: {
            activeGameId,
            activeFileName,
            activeFileContent
        }
    };
    const strippedEditor = {
        activeGameId,
        activeFileName,
        activeFileContentLength: activeFileContent.length,
        activeFileContentProvidedInEditProtocol: true,
        retry: true
    };

    return [
        '[WORKSHOP_EDIT_RETRY]',
        'The active editor file content is provided below. Do not ask the user for the file.',
        'Return only an [EDIT] block, or for style-only edits return exactly one fenced css code block.',
        getWorkshop().buildWorkshopEditDirective(context, false, userPrompt),
        `[ACTIVE_WORKSHOP_EDITOR]\n${JSON.stringify(strippedEditor)}`
    ].join('\n');
}

function buildWorkshopRewriteRetryContext(userPrompt = '', richContext = null) {
    const latestEditor = typeof window.getWorkshopEditorState === 'function'
        ? window.getWorkshopEditorState()
        : null;
    const editor = latestEditor || getActiveWorkshopEditorContext(richContext);
    const activeGameId = `${editor?.activeGameId || ''}`.trim();
    const activeFileName = `${editor?.activeFileName || ''}`.trim();
    const activeFileContent = `${editor?.activeFileContent || ''}`;
    if (!activeGameId || !activeFileName || !activeFileContent.trim()) return '';

    const context = {
        workshopEditor: {
            activeGameId,
            activeFileName,
            activeFileContent
        }
    };
    const strippedEditor = {
        activeGameId,
        activeFileName,
        activeFileContentLength: activeFileContent.length,
        activeFileContentProvidedInRewriteProtocol: true,
        retry: true
    };

    return [
        '[WORKSHOP_REWRITE_RETRY]',
        'The active editor file content is provided below. Do not ask the user for the file.',
        'Return fenced code blocks only. The first matching block replaces the active file; extra named blocks are added to the same game.',
        getWorkshop().buildWorkshopRewriteDirective(context, userPrompt),
        `[ACTIVE_WORKSHOP_EDITOR]\n${JSON.stringify(strippedEditor)}`
    ].join('\n');
}

async function retryWorkshopEditWithEditorContext(userPrompt = '', richContext = null, signal = null) {
    const retryContext = buildWorkshopEditRetryContext(userPrompt, richContext);
    if (!retryContext) return '';

    const modelSelect = document.getElementById('chat-model-select');
    const selectedModel = modelSelect ? modelSelect.value : 'auto';
    const requestModel = resolveChatRequestModel(selectedModel);
    const customInstructions = typeof getAiCore()?.getStoredCustomInstructions === 'function'
        ? getAiCore().getStoredCustomInstructions()
        : `${localStorage.getItem('ss_ai_custom_instructions') || ''}`.trim().slice(0, 2000);
    const payload = JSON.stringify({
        message: buildProtocolAwareUserMessage(userPrompt),
        model: requestModel,
        customInstructions,
        attachment: null,
        history: [],
        pageContext: retryContext.slice(0, 10000)
    });

    const chatPaths = ['/api/local-llm/chat', '/api/llm/chat'];
    for (const chatPath of chatPaths) {
        try {
            const response = await bridgeFetch(chatPath, {
                method: 'POST',
                timeoutMs: 0,
                signal,
                body: payload
            });
            if (!response?.ok) continue;
            const data = await response.json().catch(() => null);
            const retryReply = typeof data?.reply === 'string' ? data.reply.trim() : '';
            if (retryReply && !isBridgeLightweightOfflineReply(retryReply)) {
                return retryReply;
            }
        } catch (error) {
            if (signal?.aborted) throw error;
            console.warn('[Arcade Chat] Workshop edit retry failed:', error);
        }
    }

    return '';
}

function getBridgeTargetAddressSpace(baseUrl = "") {
    try {
        const parsed = new URL(baseUrl, window.location.href);
        const host = `${parsed.hostname || ""}`.trim().toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return "loopback";
        if (!host) return "";
        if (host.startsWith("10.") || host.startsWith("192.168.") || host === "10.0.2.2") return "private";
        const octets = host.split(".").map((value) => Number.parseInt(value, 10));
        if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
            if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return "private";
            if (octets[0] === 169 && octets[1] === 254) return "private";
        }
        if (host.endsWith(".local")) return "private";
    } catch (_error) {
        return "";
    }
    return "";
}

function getBridgeSecret() {
    return localStorage.getItem("SIGNAL_SHARE_BRIDGE_SECRET")
        || localStorage.getItem("signal-share-bridge-secret")
        || localStorage.getItem("ss_bridge_secret")
        || "";
}

function getLocalLlmToken() {
    const helperToken = window.SignalShareLocalLlm?.getLocalLlmToken?.();
    if (helperToken) return helperToken;
    return localStorage.getItem("ss_local_llm_token")
        || localStorage.getItem("signal-share-local-llm-token")
        || localStorage.getItem("SIGNAL_SHARE_LOCAL_LLM_TOKEN")
        || "";
}

function getDeviceId() {
    return localStorage.getItem("SIGNAL_SHARE_DEVICE_ID")
        || localStorage.getItem("signal-share-device-id")
        || localStorage.getItem("ss_device_id")
        || "";
}

function isBridgeLightweightOfflineReply(replyText) {
    const normalized = `${replyText || ""}`.trim().toLowerCase();
    if (!normalized) return false;
    return (
        normalized.includes("lightweight offline mode")
        || normalized.includes("currently in lightweight mode")
        || (normalized.includes("connect my logic core") && !normalized.includes("intelligence core offline"))
    );
}

function extractStackLocation(errorLike) {
    const stack = `${errorLike?.stack || ''}`.trim();
    if (!stack) return '';

    const stackLines = stack
        .split('\n')
        .map((line) => `${line || ''}`.trim())
        .filter(Boolean);

    const locationPattern = /([A-Za-z]:\\[^:\s)]+|https?:\/\/[^:\s)]+|file:\/\/\/[^:\s)]+|\/[^:\s)]+|[^:\s)]+\.js(?:\?[^:\s)]*)?):(\d+):(\d+)/i;
    for (const line of stackLines) {
        const match = line.match(locationPattern);
        if (!match) continue;
        const rawFile = `${match[1] || ''}`.trim();
        const normalizedFile = rawFile
            .replace(/^file:\/\/\//i, '')
            .split('?')[0];
        const fileName = normalizedFile.split(/[\\/]/).pop() || normalizedFile || 'unknown-file';
        return `${fileName}:${match[2]}:${match[3]}`;
    }
    return '';
}

function captureClientSourceLocation() {
    return extractStackLocation(new Error());
}

function formatAttemptError(route, reason, sourceLocation = '') {
    const routeLabel = `${route || 'route'}`.trim();
    const reasonLabel = `${reason || 'request failed'}`.trim();
    const source = `${sourceLocation || ''}`.trim();
    return source
        ? `${routeLabel}: ${reasonLabel} @ ${source}`
        : `${routeLabel}: ${reasonLabel}`;
}

async function readBridgeErrorDetails(response) {
    if (!response) {
        return { message: '', sourceLocation: '' };
    }

    const contentType = `${response.headers?.get('content-type') || ''}`.toLowerCase();
    try {
        if (contentType.includes('application/json')) {
            const data = await response.clone().json().catch(() => null);
            const message = `${data?.error || data?.message || data?.detail || ''}`.trim();
            const stackLocation = extractStackLocation({ stack: `${data?.stack || ''}` });
            return { message, sourceLocation: stackLocation };
        }

        const textBody = `${await response.clone().text().catch(() => '')}`.trim();
        if (!textBody) return { message: '', sourceLocation: '' };
        const trimmed = textBody.slice(0, 240).replace(/\s+/g, ' ');
        const stackLocation = extractStackLocation({ stack: textBody });
        return { message: trimmed, sourceLocation: stackLocation };
    } catch (_error) {
        return { message: '', sourceLocation: '' };
    }
}

async function retryWorkshopRewriteWithEditorContext(userPrompt = '', richContext = null, signal = null) {
    const retryContext = buildWorkshopRewriteRetryContext(userPrompt, richContext);
    if (!retryContext) return '';

    const modelSelect = document.getElementById('chat-model-select');
    const selectedModel = modelSelect ? modelSelect.value : 'auto';
    const requestModel = resolveChatRequestModel(selectedModel);
    const customInstructions = typeof getAiCore()?.getStoredCustomInstructions === 'function'
        ? getAiCore().getStoredCustomInstructions()
        : `${localStorage.getItem('ss_ai_custom_instructions') || ''}`.trim().slice(0, 2000);

    try {
        const response = await bridgeFetch('/api/local-llm/chat', {
            method: 'POST',
            timeoutMs: 0,
            signal,
            body: JSON.stringify({
                message: buildProtocolAwareUserMessage(userPrompt),
                model: requestModel,
                customInstructions,
                attachment: null,
                history: [],
                pageContext: retryContext.slice(0, 24000)
            })
        });
        if (!response?.ok) return '';
        const data = await response.json().catch(() => null);
        return typeof data?.reply === 'string' ? data.reply.trim() : '';
    } catch (error) {
        console.warn('[Arcade Chat] Workshop rewrite retry failed:', error);
        return '';
    }
}

async function bridgeFetch(path, options = {}) {
    if (!isBridgeFeatureEnabled()) {
        const error = new Error("Bridge requests disabled");
        error.name = "BridgeDisabledError";
        throw error;
    }

    const {
        timeoutMs,
        signal: externalSignal,
        headers: optionHeaders,
        method: optionMethod,
        suppressNetworkErrors = false,
        ...fetchRest
    } = options || {};

    const method = optionMethod || "GET";
    const localLlmHeaders = window.SignalShareLocalLlm?.getRequestHeaders?.() || {};
    const headers = {
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...(getBridgeSecret() ? { "X-Bridge-Secret": getBridgeSecret() } : {}),
        ...(getLocalLlmToken() ? { "X-Local-LLM-Token": getLocalLlmToken() } : localLlmHeaders),
        ...(getDeviceId() ? { "X-Device-Id": getDeviceId() } : {}),
        "Access-Control-Request-Private-Network": "true",
        ...(optionHeaders || {}),
    };
    const candidates = resolveBridgeBaseCandidates();
    if (candidates.length === 0) {
        throw new Error("No bridge endpoint candidates available");
    }

    let lastNetworkError = null;
    let lastHttpResponse = null;
    const networkFailures = [];

    for (const baseUrl of candidates) {
        const endpoint = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
        const requestController = new AbortController();
        const hasExplicitTimeout = Number.isFinite(timeoutMs);
        const rawTimeoutDuration = hasExplicitTimeout
            ? Number(timeoutMs)
            : (method === "POST" ? 180000 : 5000);
        const timeoutDuration = rawTimeoutDuration > 0
            ? Math.max(250, rawTimeoutDuration)
            : 0;
        const timeout = timeoutDuration > 0
            ? setTimeout(() => requestController.abort(), timeoutDuration)
            : null;
        const targetAddressSpace = getBridgeTargetAddressSpace(baseUrl);
        const handleExternalAbort = () => requestController.abort();

        if (externalSignal) {
            if (externalSignal.aborted) {
                requestController.abort();
            } else {
                externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
            }
        }

        try {
            const response = await fetch(endpoint, {
                method,
                mode: "cors",
                cache: "no-store",
                credentials: "omit",
                ...fetchRest,
                headers,
                signal: requestController.signal,
                targetAddressSpace: targetAddressSpace || "private"
            });

            if (response.ok) {
                const normalizedPath = `${path || ""}`.trim().toLowerCase();
                const expectsJson = normalizedPath.startsWith("/api/");
                if (expectsJson) {
                    const contentType = `${response.headers?.get("content-type") || ""}`.toLowerCase();
                    if (!contentType.includes("application/json")) {
                        const error = new Error(`Unexpected non-JSON response for ${normalizedPath} (content-type: ${contentType || "unknown"})`);
                        networkFailures.push({ baseUrl, error });
                        lastNetworkError = error;
                        continue;
                    }
                }
                BRIDGE_BASE_URL = baseUrl;
                localStorage.setItem(BRIDGE_LAST_WORKING_BASE_KEY, baseUrl);
                return response;
            }

            if (response.status === 401 || response.status === 403 || response.status === 422) {
                BRIDGE_BASE_URL = baseUrl;
                lastHttpResponse = response;
                break;
            }

            lastHttpResponse = response;
        } catch (error) {
            console.error(`[Bridge Fetch] Failed to reach ${endpoint}:`, error.message || error);
            networkFailures.push({ baseUrl, error });
            lastNetworkError = error;
            if (externalSignal?.aborted) break;
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
            if (externalSignal) {
                externalSignal.removeEventListener("abort", handleExternalAbort);
            }
        }
    }

    if (lastHttpResponse) return lastHttpResponse;

    if (!suppressNetworkErrors && networkFailures.length > 0) {
        const hasNonAbortFailure = networkFailures.some(({ error }) => {
            const name = `${error?.name || ""}`.toLowerCase();
            const message = `${error?.message || ""}`.toLowerCase();
            return name !== "aborterror" && !message.includes("aborted");
        });

        if (hasNonAbortFailure) {
            const summary = networkFailures
                .map(({ baseUrl, error }) => `${baseUrl} - ${error?.message || "Failed to fetch"}`)
                .join(" | ");
            console.warn(`[Arcade Chat] Bridge request failed across candidates: ${summary}`);
        }
    }

    // If suppressed, return a mock failed response instead of throwing
    if (suppressNetworkErrors) {
        return { ok: false, status: 0, statusText: "Bridge request failed", json: async () => ({}) };
    }

    throw lastNetworkError || new Error("Bridge request failed");
}

// Expose arcade bridge fetch globally so main-page AI can use the exact
// same bridge request logic/path as mini-games.
if (typeof window !== "undefined") {
    window.bridgeFetch = bridgeFetch;
    window.resolveChatRequestModel = resolveChatRequestModel;
    window.isBridgeFeatureEnabled = isBridgeFeatureEnabled;
}

async function getDesktopBridgeSnapshot({ suppressNetworkErrors = false } = {}) {
    const res = await bridgeFetch("/api/system-media/current", {
        suppressNetworkErrors
    });
    if (!res.ok) return null;
    return res.json();
}

async function checkBridgeConnectivity({ signal, timeoutMs = 3500 } = {}) {
    const probes = [
        "/api/local-llm/models",
        "/api/llm/models",
        "/api/local-llm/health"
    ];
    let sawAuthFailure = false;

    for (const path of probes) {
        try {
            const res = await bridgeFetch(path, {
                method: "GET",
                timeoutMs,
                signal,
                suppressNetworkErrors: true
            });
            if (res?.ok) {
                // If we get a 200 OK from any endpoint, the bridge is alive. 
                // No need to keep probing other paths.
                return true;
            }

            const status = Number(res?.status || 0);
            if (status === 401 || status === 403) {
                sawAuthFailure = true;
            }
        } catch (_error) {
            // Try the next probe.
        }
    }

    if (sawAuthFailure) {
        console.warn("[Arcade Chat] Bridge reachable but authentication failed. Verify Bridge Secret / Local LLM Token.");
    }
    return false;
}

async function sendDesktopBridgeAction(action, appPackage = "") {
    const res = await bridgeFetch("/api/system-media/action", {
        method: "POST",
        body: JSON.stringify({ action, appPackage }),
    });

    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data?.ok);
}

let bridgePollTimer = null;
let bridgePollInFlight = false;
let bridgeEnabled = false;
let bridgePollFailureCount = 0;
let bridgePollNextAllowedAt = 0;

/**
 * Starts background polling for the desktop bridge state.
 */
function startDesktopBridgePolling() {
    if (!isBridgeFeatureEnabled()) {
        bridgeEnabled = false;
        updateEngineStatus(false);
        return;
    }

    bridgeEnabled = true;
    pollDesktopBridge();

    // Lightweight live refresh for bridge status.
    if (bridgePollTimer) clearInterval(bridgePollTimer);
    bridgePollTimer = setInterval(() => {
        pollDesktopBridge();
    }, 10000);
}

/**
 * Stops background polling.
 */
function stopDesktopBridgePolling() {
    bridgeEnabled = false;
    clearInterval(bridgePollTimer);
    bridgePollTimer = null;
}

/**
 * Executes a single poll request to the desktop bridge.
 */
async function pollDesktopBridge() {
    if (!bridgeEnabled || bridgePollInFlight) return;

    bridgePollInFlight = true;
    try {
        // Engine status should be based on LLM endpoint connectivity, not media endpoint health.
        const online = await checkBridgeConnectivity();
        updateEngineStatus(online);

        if (!online) {
            bridgePollFailureCount += 1;
            return;
        }

        bridgePollFailureCount = 0;
        bridgePollNextAllowedAt = 0;

        const snapshot = await getDesktopBridgeSnapshot({ suppressNetworkErrors: true }).catch(() => null);
        if (snapshot && window.state) {
            window.state.desktopSnapshot = snapshot;
        }

        if (snapshot && window.heroMediaPlayerController && typeof window.heroMediaPlayerController.render === 'function') {
            window.heroMediaPlayerController.render();
        }
    } catch (_error) {
        bridgePollFailureCount += 1;
        updateEngineStatus(false);
    } finally {
        bridgePollInFlight = false;
    }
}

async function startArcadeDictation() {
    if (isArcadeDictating) return;
    initArcadeSpeech();

    if (window.isSpeechSupported === false) {
        alert("Speech-to-Text is not supported by your current browser. Please use Chrome or Edge for voice features!");
        return;
    }

    // Special Alert for Insecure IP access
    if (window.isSecureInsecure) {
        alert("MICROPHONE BLOCKED: Chrome blocks microphones on IP addresses (like 192.168...) unless they use HTTPS. \n\nFIX: Please use 'http://localhost:3000' on this PC instead!");
        return;
    }

    if (!arcadeSpeechRecognition) return;

    try {
        // Request microphone permission explicitly for Android/Mobile
        // This forces the system prompt if it hasn't appeared yet.
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // Immediately stop the tracks, we just needed the permission
                stream.getTracks().forEach(track => track.stop());
            } catch (permErr) {
                console.warn('[Voice] Microphone permission denied or failed:', permErr);
                if (permErr.name === 'NotAllowedError') {
                    alert('Microphone access is required for dictation. Please allow it in your browser/app settings.');
                }
                return;
            }
        }

        isArcadeDictating = true;
        isVoiceSessionActive = true;
        arcadeSpeechRecognition.start();
        const btn = getChatSendButton();
        if (btn) btn.classList.add('recording');
    } catch (e) {
        console.warn('[Voice] Failed to start recognition:', e);
    }
}

function stopArcadeDictation() {
    if (!isArcadeDictating) return;
    isArcadeDictating = false;
    if (arcadeSpeechRecognition) arcadeSpeechRecognition.stop();
    const btn = getChatSendButton();
    if (btn) btn.classList.remove('recording');
}

/**
 * Updates the chat input placeholder with a random suggestion.
 */
function updateChatPlaceholder() {
    const input = document.getElementById('arc-chat-input');
    if (!input) return;

    const suggestions = window.arcadeChatSuggestions || ["Ask for gaming advice..."];


    const randomSuggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    input.placeholder = randomSuggestion;
}

/**
 * Updates the Engine Status UI indicator if it exists on the page.
 * @param {boolean} online - Whether the bridge is connected
 */
function updateEngineStatus(online) {
    const statusKey = online ? 'online' : 'offline';
    const nextStyle = online
        ? { text: 'LOCAL LLM ONLINE', color: '#75b022', dot: '#75b022', glow: '0 0 8px #75b022' }
        : { text: 'LLM BRIDGE DISCONNECTED', color: '#e74c3c', dot: '#e74c3c', glow: '0 0 8px #e74c3c' };

    const containers = Array.from(document.querySelectorAll('#engine-status-container'));
    const textNodes = Array.from(document.querySelectorAll('#engine-status-text'));
    const dotNodes = Array.from(document.querySelectorAll('#engine-status-dot'));
    const widgetCount = Math.max(containers.length, textNodes.length, dotNodes.length);

    if (widgetCount === 0) return;

    for (let i = 0; i < widgetCount; i += 1) {
        const container = containers[i] || null;
        const statusText = container?.querySelector('#engine-status-text') || textNodes[i] || null;
        const statusDot = container?.querySelector('#engine-status-dot') || dotNodes[i] || null;
        if (!statusText || !statusDot) continue;

        // Only repaint when the effective status changes.
        if ((container?.dataset?.bridgeStatus || statusText.dataset.bridgeStatus) === statusKey) {
            continue;
        }

        statusText.textContent = nextStyle.text;
        statusDot.style.background = nextStyle.dot;
        statusDot.style.boxShadow = nextStyle.glow;
        if (container) {
            container.style.color = nextStyle.color;
            container.dataset.bridgeStatus = statusKey;
        }
        statusText.dataset.bridgeStatus = statusKey;
    }

    lastBridgeStatusWasOnline = online;
}

function isEngineStatusOffline() {
    const containers = Array.from(document.querySelectorAll('#engine-status-container'));
    const textNodes = Array.from(document.querySelectorAll('#engine-status-text'));
    const nodeCount = Math.max(containers.length, textNodes.length);

    if (nodeCount === 0) return false;

    for (let i = 0; i < nodeCount; i += 1) {
        const container = containers[i] || null;
        const statusText = container?.querySelector('#engine-status-text') || textNodes[i] || null;
        const statusKey = `${container?.dataset?.bridgeStatus || statusText?.dataset?.bridgeStatus || ''}`.trim().toLowerCase();
        if (statusKey === 'offline') return true;

        const label = `${statusText?.textContent || ''}`.trim().toLowerCase();
        if (label.includes('disconnected')) return true;
    }

    return false;
}

/**
 * Toggles the Security Dashboard view in the sidebar.
 */
window.toggleChatSecurity = function () {
    const messages = document.getElementById('chat-messages');
    const history = document.getElementById('chat-history');
    const security = document.getElementById('chat-security');
    const inputArea = document.querySelector('.chat-input-area');

    if (!security) return;

    const isShowing = security.style.display !== 'none';

    // Hide others
    if (messages) messages.style.display = isShowing ? 'flex' : 'none';
    if (history) history.style.display = 'none';
    if (inputArea) {
        if (isShowing) {
            // Restore stylesheet default instead of forcing flex on the container.
            inputArea.style.removeProperty('display');
            inputArea.style.opacity = '1';
            inputArea.style.pointerEvents = 'all';
        } else {
            inputArea.style.display = 'none';
        }
    }

    // Toggle security
    security.style.display = isShowing ? 'none' : 'flex';

    // Update button visual state if possible
    const secBtn = document.querySelector('button[onclick="toggleChatSecurity()"]');
    if (secBtn) {
        secBtn.style.background = isShowing ? '' : 'rgba(103, 193, 245, 0.1)';
    }

    if (!isShowing) {
        // Load current values
        const secretInput = document.getElementById('sidebar-bridge-secret');
        const deviceInput = document.getElementById('sidebar-device-id');
        const bridgeUrlInput = document.getElementById('sidebar-bridge-url');
        const localLlmTokenInput = document.getElementById('sidebar-local-llm-token');

        if (secretInput) secretInput.value = getBridgeSecret();
        if (deviceInput) deviceInput.value = getDeviceId();
        if (bridgeUrlInput) {
            bridgeUrlInput.value = window.SignalShareLocalLlm?.getBridgeBaseUrl?.()
                || `${localStorage.getItem('signal-share-bridge-url') || ''}`.trim();
        }
        if (localLlmTokenInput) localLlmTokenInput.value = getLocalLlmToken();

        // Refresh IP bans
        refreshBannedIps();
    }
};

/**
 * Saves the security settings to localStorage.
 */
window.saveSecurityDashboard = function () {
    const secretInput = document.getElementById('sidebar-bridge-secret');
    const deviceInput = document.getElementById('sidebar-device-id');
    const bridgeUrlInput = document.getElementById('sidebar-bridge-url');
    const localLlmTokenInput = document.getElementById('sidebar-local-llm-token');
    const status = document.getElementById('security-save-status');

    if (!secretInput || !deviceInput) return;

    const secret = secretInput.value.trim();
    const deviceId = deviceInput.value.trim();
    const bridgeUrl = bridgeUrlInput ? bridgeUrlInput.value.trim() : "";
    const localLlmToken = localLlmTokenInput ? localLlmTokenInput.value.trim() : "";

    localStorage.setItem('SIGNAL_SHARE_BRIDGE_SECRET', secret);
    localStorage.setItem('SIGNAL_SHARE_DEVICE_ID', deviceId);
    if (window.SignalShareLocalLlm?.setBridgeBaseUrl) {
        window.SignalShareLocalLlm.setBridgeBaseUrl(bridgeUrl);
    } else if (bridgeUrl) {
        localStorage.setItem('signal-share-bridge-url', bridgeUrl);
    } else {
        localStorage.removeItem('signal-share-bridge-url');
    }

    if (window.SignalShareLocalLlm?.setLocalLlmToken) {
        window.SignalShareLocalLlm.setLocalLlmToken(localLlmToken);
    } else if (localLlmToken) {
        localStorage.setItem('ss_local_llm_token', localLlmToken);
    } else {
        localStorage.removeItem('ss_local_llm_token');
    }

    if (secret || bridgeUrl || localLlmToken) {
        localStorage.setItem('ss_bridge_enabled', '1');
    }

    // Refresh bridge candidate ordering immediately after settings save.
    resolveBridgeBaseCandidates();
    void hydrateChatModelSelect({ forceRefresh: true });

    if (status) {
        status.textContent = '✅ Security settings saved!';
        status.style.color = '#75b022';
        setTimeout(() => { status.textContent = ''; }, 3000);
    }

    // Notify user via AI if open
    console.log('[Security] Keys updated. Bridge handshake will now use these credentials.');
};

/**
 * Generates a persistent fingerprint for this browser/device.
 */
window.lockToThisDevice = function () {
    const deviceInput = document.getElementById('sidebar-device-id');
    if (!deviceInput) return;

    let existingId = localStorage.getItem('SIGNAL_SHARE_DEVICE_ID');
    if (!existingId || existingId.length < 8) {
        // Generate a new random ID if none exists
        existingId = 'dev_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    deviceInput.value = existingId;
    deviceInput.style.color = '#67c1f5';
};

/**
 * Fetches the current list of banned IPs from the bridge.
 */
window.refreshBannedIps = async function () {
    const list = document.getElementById('banned-ips-list');
    if (!list) return;

    list.innerHTML = '<span style="color: rgba(255,255,255,0.3)">Refreshing...</span>';

    try {
        const res = await bridgeFetch('/api/security/audit', {
            method: 'GET',
            timeoutMs: 5000
        });

        if (!res.ok) {
            list.innerHTML = '<span style="color: #ff5555">Failed to fetch audit log.</span>';
            return;
        }

        const data = await res.json();
        const bans = data.bannedIps || [];

        if (bans.length === 0) {
            list.innerHTML = '<span style="color: #75b022">No IPs currently banned.</span>';
        } else {
            list.innerHTML = '';
            bans.forEach(ip => {
                const item = document.createElement('div');
                item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 1px solid rgba(255,0,0,0.1); padding: 4px 0;';

                const ipSpan = document.createElement('span');
                ipSpan.style.fontFamily = 'monospace';
                ipSpan.textContent = ip;

                const statusSpan = document.createElement('span');
                statusSpan.style.cssText = 'font-size: 0.6rem; color: #ff5555; text-transform: uppercase; font-weight: 800;';
                statusSpan.textContent = 'BANNED';

                item.appendChild(ipSpan);
                item.appendChild(statusSpan);
                list.appendChild(item);
            });
        }
    } catch (err) {
        list.innerHTML = '<span style="color: #ff5555">Bridge unreachable.</span>';
    }
};

let arcadeChatHistory = [];
let currentChatId = null;
let currentChatAttachment = null;
let currentChatAttachmentType = null;
let currentChatAttachmentName = null;

function readArcadeChats() {
    try {
        const parsed = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

/**
 * Compress and downscale images to save VRAM on the bridge.
 */
function compressChatImage(dataUrl, maxWidth = 512, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(dataUrl); // Fallback
        img.src = dataUrl;
    });
}

/**
 * Handles image, video, or file selection for the chat.
 */
window.handleChatFileSelect = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    currentChatAttachmentName = file.name;
    const reader = new FileReader();
    reader.onload = async function (e) {
        let fileData = e.target.result;
        
        const preview = document.getElementById('chat-attachment-preview');
        const img = document.getElementById('chat-preview-img');
        const video = document.getElementById('chat-preview-video');
        const fileDiv = document.getElementById('chat-preview-file');
        const fileName = document.getElementById('chat-preview-filename');

        if (!preview) return;
        preview.hidden = false;

        // Reset all
        if (img) img.style.display = 'none';
        if (video) video.style.display = 'none';
        if (fileDiv) fileDiv.style.display = 'none';

        if (file.type.startsWith('image/')) {
            currentChatAttachmentType = 'image';
            // VRAM LIFTING: Compress image before storing
            fileData = await compressChatImage(fileData);
            currentChatAttachment = fileData;
            if (img) {
                img.src = currentChatAttachment;
                img.style.display = 'block';
            }
        } else if (file.type.startsWith('video/')) {
            currentChatAttachmentType = 'video';
            currentChatAttachment = fileData;
            if (video) {
                video.src = currentChatAttachment;
                video.style.display = 'block';
            }
        } else {
            currentChatAttachmentType = 'file';
            currentChatAttachment = fileData;
            if (fileDiv && fileName) {
                fileName.textContent = file.name;
                fileDiv.style.display = 'flex';
            }
        }
    };
    reader.readAsDataURL(file);
};

/**
 * Clears the current chat attachment.
 */
window.clearChatAttachment = function () {
    currentChatAttachment = null;
    currentChatAttachmentType = null;
    currentChatAttachmentName = null;
    const preview = document.getElementById('chat-attachment-preview');
    const fileInput = document.getElementById('chat-file-input');
    if (preview) preview.hidden = true;
    if (fileInput) fileInput.value = '';
};

function updateChatStatus(status) {
    const dot = document.getElementById('chat-status-dot');
    const title = document.getElementById('chat-mode-title');
    if (!dot || !title) return;

    switch (status) {
        case 'active': // Green: Local LLM Active
            dot.style.background = '#2ecc71';
            dot.style.boxShadow = '0 0 10px #2ecc71';
            title.style.color = '#2ecc71';
            title.textContent = 'A.I. Active';
            break;
        case 'idle': // Blue: Chatbot Only
            dot.style.background = '#67c1f5';
            dot.style.boxShadow = '0 0 8px #67c1f5';
            title.style.color = '#67c1f5';
            title.textContent = 'Companion';
            break;
        case 'error': // Red: Connection Error
            dot.style.background = '#e74c3c';
            dot.style.boxShadow = '0 0 12px #e74c3c';
            title.style.color = '#e74c3c';
            title.textContent = 'Bridge Error';
            break;
    }
}


function cleanupOldChats() {
    const chats = readArcadeChats();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const filteredChats = chats.filter(chat => {
        const lastUsed = chat.lastUsed || 0;
        return (now - lastUsed) < sevenDaysMs;
    });

    if (filteredChats.length !== chats.length) {
        localStorage.setItem('arcade-chats', JSON.stringify(filteredChats));
        console.log(`[Arcade Chat] Cleaned up ${chats.length - filteredChats.length} old chats.`);
    }
}

function isDesktopCompanionLayout() {
    return !window.matchMedia('(max-width: 768px)').matches;
}

function getSteamShellBounds(shellElement = null) {
    const shell = shellElement || document.querySelector('.steam-shell');
    if (!shell) return null;
    const shellRect = shell.getBoundingClientRect();
    if (!shellRect || shellRect.width <= 0) return null;
    return shellRect;
}

function clampSteamSidebarWidth(requestedWidth, shellElement = null) {
    const shellRect = getSteamShellBounds(shellElement);
    const shellWidth = shellRect?.width || window.innerWidth;
    const maxWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        shellWidth - STEAM_SHELL_LEFT_NAV_WIDTH - STEAM_SHELL_DIVIDER_WIDTH - MIN_GAME_PANEL_WIDTH
    );
    const numeric = Number(requestedWidth);
    const candidate = Number.isFinite(numeric) ? numeric : DEFAULT_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(candidate, maxWidth));
}

function getStoredSteamSidebarWidth(shellElement = null) {
    const raw = `${localStorage.getItem(ARCADE_CHAT_SIDEBAR_WIDTH_KEY) || ''}`.trim();
    const parsed = Number(raw);
    return clampSteamSidebarWidth(Number.isFinite(parsed) ? parsed : DEFAULT_SIDEBAR_WIDTH, shellElement);
}

function applySteamShellOpenColumns(shellElement, sidebarWidth) {
    if (!shellElement || !isDesktopCompanionLayout()) return;
    const clampedSidebarWidth = clampSteamSidebarWidth(sidebarWidth, shellElement);
    shellElement.style.gridTemplateColumns = `${STEAM_SHELL_LEFT_NAV_WIDTH}px 1fr ${STEAM_SHELL_DIVIDER_WIDTH}px ${Math.round(clampedSidebarWidth)}px`;
}

function applySteamShellCollapsedColumns(shellElement) {
    if (!shellElement || !isDesktopCompanionLayout()) return;
    shellElement.style.gridTemplateColumns = `${STEAM_SHELL_LEFT_NAV_WIDTH}px 1fr 0px 0px`;
}

/**
 * Synchronizes the position of external UI elements (Messenger, Toggle, Runner)
 * based on the current sidebar width and state.
 */
window.syncArcadeSidebarOffsets = function () {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    if (!sidebar) return;

    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const messengerBtn = document.querySelector('.messenger-launcher');
    const messengerSection = document.querySelector('.messenger-section');
    const appRunner = document.getElementById('app-runner');
    const isCollapsed = sidebar.classList.contains('collapsed');

    const isSteamShell = document.querySelector('.steam-shell') || document.documentElement.classList.contains('is-steam-shell');

    if (!isCollapsed) {
        // Use offsetWidth for current real-time geometry, fallback to style width, then default 380
        const currentWidth = sidebar.offsetWidth || parseInt(sidebar.style.width) || 380;

        // Messenger/Floating UI offset (Sidebar width + 20px gutter)
        const gapWidth = currentWidth + 20;

        if (toggleBtn) toggleBtn.style.right = `${gapWidth}px`;
        if (messengerBtn) messengerBtn.style.setProperty('right', `${gapWidth}px`, 'important');

        if (messengerSection) {
            messengerSection.style.setProperty('right', `${gapWidth}px`, 'important');

            // Dynamically limit messenger width if it's expanded to prevent screen cutoff
            if (messengerSection.classList.contains('is-expanded')) {
                const availableWidth = window.innerWidth - gapWidth - 20; // 20px left margin
                messengerSection.style.maxWidth = `${availableWidth}px`;
                if (messengerSection.offsetWidth > availableWidth) {
                    messengerSection.style.width = `${availableWidth}px`;
                }
            } else {
                messengerSection.style.maxWidth = '';
                messengerSection.style.width = '';
            }
        }

        // Runner positioning
        if (appRunner) {
            // Shift right to accommodate the companion sidebar
            appRunner.style.setProperty('right', `${currentWidth}px`, 'important');

            // In Steam Shell mode, also shift left to accommodate the navigation sidebar
            if (isSteamShell && !window.matchMedia('(max-width: 768px)').matches) {
                appRunner.style.setProperty('left', '240px', 'important');
            } else {
                appRunner.style.setProperty('left', '0', 'important');
            }
        }
    } else {
        // Clear inline overrides so CSS defaults take over for collapsed state
        if (toggleBtn) toggleBtn.style.right = '';
        if (messengerBtn) messengerBtn.style.setProperty('right', '', '');
        if (messengerSection) {
            messengerSection.style.setProperty('right', '', '');
            messengerSection.style.maxWidth = '';
            messengerSection.style.width = '';
        }
        if (appRunner) {
            appRunner.style.removeProperty('right');
            appRunner.style.removeProperty('left');
        }
    }
};

function startNewChat() {
    currentChatId = 'chat_' + Date.now();
    arcadeChatHistory = [];
    const container = document.getElementById('chat-messages');
    if (container) {
        container.innerHTML = `
            <div class="chat-message message-ai">
                Hello! I'm your local arcade assistant. How can I help you optimize your gameplay today?
            </div>
        `;
    }
    updateChatStatus('idle');
    showChatView();
    updateChatPlaceholder();
    saveCurrentChat();
}

function saveCurrentChat() {
    if (!currentChatId) return;

    const chats = readArcadeChats();
    const existingIdx = chats.findIndex(c => c.id === currentChatId);

    const chatObj = {
        id: currentChatId,
        name: arcadeChatHistory.length > 0 ? arcadeChatHistory[0].content.substring(0, 30) + (arcadeChatHistory[0].content.length > 30 ? '...' : '') : 'New Session',
        messages: arcadeChatHistory,
        lastUsed: Date.now()
    };

    if (existingIdx >= 0) {
        chats[existingIdx] = chatObj;
    } else {
        chats.unshift(chatObj);
    }

    localStorage.setItem('arcade-chats', JSON.stringify(chats));
    localStorage.setItem('arcade-last-chat-id', currentChatId);
}

function loadChat(id) {
    const chats = readArcadeChats();
    const chat = chats.find(c => c.id === id);
    if (chat) {
        currentChatId = chat.id;
        arcadeChatHistory = chat.messages || [];
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = `
                <div class="chat-message message-ai">
                    Hello! I'm your local arcade assistant. How can I help you optimize your gameplay today?
                </div>
            `;

            arcadeChatHistory.forEach(msg => {
                addChatMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
            });
            container.scrollTop = container.scrollHeight;
        }

        updateChatStatus('idle');
        showChatView();

        chat.lastUsed = Date.now();
        localStorage.setItem('arcade-chats', JSON.stringify(chats));
    }
}
window.loadChat = loadChat;

window.toggleChatHistory = function () {
    const messages = document.getElementById('chat-messages');
    const historyView = document.getElementById('chat-history');
    const title = document.getElementById('chat-mode-title');
    const inputArea = document.querySelector('.chat-input-area');

    if (!messages || !historyView) return;

    if (historyView.style.display === 'flex' || historyView.style.display === 'block') {
        showChatView();
    } else {
        messages.style.display = 'none';
        historyView.style.display = 'block';
        if (inputArea) {
            inputArea.style.opacity = '0.3';
            inputArea.style.pointerEvents = 'none';
        }
        if (title) title.textContent = 'Chat History';
        renderHistoryList();
    }
}

function showChatView() {
    const messages = document.getElementById('chat-messages');
    const historyView = document.getElementById('chat-history');
    const inputArea = document.querySelector('.chat-input-area');
    const title = document.getElementById('chat-mode-title');

    if (messages) messages.style.display = 'flex';
    if (historyView) historyView.style.display = 'none';
    if (inputArea) {
        inputArea.style.opacity = '1';
        inputArea.style.pointerEvents = 'all';
    }
    updateChatStatus('idle');
}

function renderHistoryList() {
    const container = document.getElementById('chat-history');
    const chats = readArcadeChats();
    if (!container) return;

    if (chats.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.3; font-size: 0.8rem;">No chat history yet.</div>';
        return;
    }

    container.innerHTML = '';
    chats.forEach(chat => {
        const date = new Date(chat.lastUsed).toLocaleDateString();
        const time = new Date(chat.lastUsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.onclick = () => loadChat(chat.id);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'history-name';
        nameDiv.textContent = chat.name;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'history-meta';

        const countSpan = document.createElement('span');
        countSpan.textContent = `${chat.messages.length} messages`;

        const dateSpan = document.createElement('span');
        dateSpan.textContent = `${date} ${time}`;

        metaDiv.appendChild(countSpan);
        metaDiv.appendChild(dateSpan);
        item.appendChild(nameDiv);
        item.appendChild(metaDiv);
        container.appendChild(item);
    });
}

function addChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message message-${role === 'ai' ? 'ai' : 'user'}`;

    // Use robust protocol tag stripping to prevent leaking raw JSON/Tags into UI
    const protocolInfo = stripArcadeProtocolTags(content);
    const cleanContent = protocolInfo.text;

    if (content.includes('```')) {
        const parts = cleanContent.split('```');
        parts.forEach((part, index) => {
            if (index % 2 === 0) {
                const paragraphs = part.split(/\n\n+/);
                paragraphs.forEach(para => {
                    if (para.trim()) {
                        const p = document.createElement('p');
                        p.textContent = para.trim();
                        msgDiv.appendChild(p);
                    }
                });
            } else {
                const lines = part.split('\n');
                const lang = lines[0].trim();
                const code = lines.slice(1).join('\n').trim();

                const codeWrapper = document.createElement('div');
                codeWrapper.className = 'code-block-wrapper';

                const pre = document.createElement('pre');
                pre.className = 'chat-code-block';
                pre.setAttribute('data-lang', lang || 'code');
                pre.textContent = code;

                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-code-btn';
                copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                copyBtn.setAttribute('title', 'Copy code');
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(code).then(() => {
                        copyBtn.classList.add('copied');
                        const originalSvg = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                        setTimeout(() => {
                            copyBtn.classList.remove('copied');
                            copyBtn.innerHTML = originalSvg;
                        }, 2000);
                    });
                };

                codeWrapper.appendChild(pre);
                codeWrapper.appendChild(copyBtn);
                msgDiv.appendChild(codeWrapper);
            }
        });
    } else {
        msgDiv.textContent = cleanContent;

        // If the AI is publishing a game but forgot to include markdown code blocks, 
        // automatically generate a snippet box for the main file so the user sees it.
        if (protocolInfo.publishData?.files && protocolInfo.publishData.files.length > 0) {
            const mainFile = protocolInfo.publishData.files.find(f => f.name === 'index.html' || f.name === 'game.js') || protocolInfo.publishData.files[0];
            if (mainFile && mainFile.content) {
                const codeWrapper = document.createElement('div');
                codeWrapper.className = 'code-block-wrapper';
                const pre = document.createElement('pre');
                pre.className = 'chat-code-block';
                pre.setAttribute('data-lang', mainFile.name.split('.').pop() || 'code');
                pre.textContent = mainFile.content;

                const label = document.createElement('div');
                label.style.cssText = 'font-size: 0.6rem; opacity: 0.5; margin-bottom: 4px; font-family: monospace;';
                label.textContent = `Attached Project: ${mainFile.name}`;

                msgDiv.appendChild(label);
                codeWrapper.appendChild(pre);
                msgDiv.appendChild(codeWrapper);
            }
        }

        if (!cleanContent && protocolInfo.hadTags) {
            msgDiv.style.display = 'none';
        }
    }

    // Handle multimedia attachments if present
    const msgObj = arcadeChatHistory.find(m => m.content === content && m.role === (role === 'ai' ? 'assistant' : 'user') && m.attachment);

    let attachmentToRender = null;
    if (msgObj && msgObj.attachment) {
        attachmentToRender = msgObj.attachment;
    } else if (role === 'user' && currentChatAttachment) {
        attachmentToRender = {
            data: currentChatAttachment,
            type: currentChatAttachmentType,
            name: currentChatAttachmentName
        };
    }

    if (attachmentToRender) {
        if (attachmentToRender.type === 'image') {
            const img = document.createElement('img');
            img.src = attachmentToRender.data;
            img.className = 'chat-message-image';
            msgDiv.appendChild(img);
        } else if (attachmentToRender.type === 'video') {
            const video = document.createElement('video');
            video.src = attachmentToRender.data;
            video.className = 'chat-message-video';
            video.controls = true;
            msgDiv.appendChild(video);
        } else if (attachmentToRender.type === 'file') {
            const fileLink = document.createElement('a');
            fileLink.href = attachmentToRender.data;
            fileLink.download = attachmentToRender.name || 'file';
            fileLink.className = 'chat-message-file';
            fileLink.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <span>${attachmentToRender.name || 'Download File'}</span>
            `;
            msgDiv.appendChild(fileLink);
        }
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;

    // Add Speak button for AI messages on all platforms
    if (role === 'ai') {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'msg-speak-btn';
        speakBtn.innerHTML = SPEAKER_ICON;
        speakBtn.onclick = (e) => {
            e.stopPropagation();
            speakArcadeText(content, speakBtn);
        };
        msgDiv.appendChild(speakBtn);

        // Auto-speak if it was a voice session
        if (isVoiceSessionActive) {
            speakArcadeText(content, speakBtn);
            isVoiceSessionActive = false; // Reset for next interaction
        }
    }
}

window.executeArcadeAction = function (action) {
    console.log(`[Arcade Chat] Executing Protocol Action: ${action}`);
    const rawAction = `${action || ""}`.trim();
    const [actionKeyRaw, ...argParts] = rawAction.split(/\s+/);
    const actionKey = (actionKeyRaw || "").toLowerCase();
    const actionArg = argParts.join(" ").trim();

    const triggerClick = (sel) => document.querySelector(sel)?.click();
    const navigate = (hash, fallback) => {
        if (hash.startsWith('#')) {
            const el = document.querySelector(hash);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                const link = document.querySelector(`a[href="${hash}"], [id="${hash.substring(1)}NavLink"]`);
                if (link) link.click();
            } else if (fallback) window.location.href = fallback + hash;
        } else window.location.href = hash;
    };
    const navigateToGames = (cat) => {
        if (typeof window.setCategory === 'function') window.setCategory(cat);
        else window.location.href = 'mini-games.html#' + cat;
    };
    const launchGame = (gid) => {
        const fn = { pinball: 'launchPinball', snake: 'launchSnake', basketball: 'launchBasketball', hoops: 'launchBasketball', calc: 'launchCalc' }[gid];
        if (fn && typeof window[fn] === 'function') window[fn]();
        else if (typeof window.showGameDetails === 'function') window.showGameDetails(gid);
        else window.location.href = `mini-games.html#${gid}`;
    };
    const setTheme = (tid) => {
        const btn = document.querySelector(`[data-theme-option="${tid}"]`);
        if (btn) btn.click();
        else if (typeof window.updateTheme === 'function') window.updateTheme(tid);
    };
    const setMediaSource = (source) => {
        if (!window.heroMediaPlayerController) return;
        if (typeof window.heroMediaPlayerController.setHeroControlMode === 'function') {
            window.heroMediaPlayerController.setHeroControlMode('media');
        }
        if (source && typeof window.heroMediaPlayerController.setHeroControlSource === 'function') {
            window.heroMediaPlayerController.setHeroControlSource(source);
        }
    };
    const runMediaControl = (command, source = "") => {
        if (!window.heroMediaPlayerController) return false;
        const normalizedSource = `${source || ""}`.trim().toLowerCase();
        if (normalizedSource === "spotify" || normalizedSource === "youtube") {
            setMediaSource(normalizedSource);
        }
        if (command === "play" && typeof window.heroMediaPlayerController.play === "function") {
            window.heroMediaPlayerController.play();
            return true;
        }
        if (command === "pause" && typeof window.heroMediaPlayerController.pause === "function") {
            window.heroMediaPlayerController.pause();
            return true;
        }
        if (command === "next" && typeof window.heroMediaPlayerController.next === "function") {
            window.heroMediaPlayerController.next();
            return true;
        }
        if (command === "previous" && typeof window.heroMediaPlayerController.previous === "function") {
            window.heroMediaPlayerController.previous();
            return true;
        }
        return false;
    };
    const openMediaApp = async (source) => {
        if (!window.heroMediaPlayerController || typeof window.heroMediaPlayerController.openNowPlayingMediaApp !== "function") return false;
        const normalizedSource = `${source || ""}`.trim().toLowerCase();
        if (normalizedSource === "spotify") {
            setMediaSource("spotify");
            await window.heroMediaPlayerController.openNowPlayingMediaApp("com.spotify.music", "spotify:");
            return true;
        }
        if (normalizedSource === "youtube") {
            setMediaSource("youtube");
            await window.heroMediaPlayerController.openNowPlayingMediaApp("com.google.android.youtube", "https://www.youtube.com");
            return true;
        }
        return false;
    };

    // Most actions are available as global functions in mini-games.js
    try {
        switch (actionKey) {
            case 'pinball': launchGame('pinball'); break;
            case 'snake': launchGame('snake'); break;
            case 'hoops': case 'basketball': launchGame('basketball'); break;
            case 'calc': case 'calculator': launchGame('calc'); break;
            case 'play':
                if (actionArg && !/^(spotify|youtube|music|media)\b/i.test(actionArg)) {
                    addChatMessage('ai', openSteamGame(actionArg));
                    break;
                }
                runMediaControl('play');
                break;
            case 'pause':
                runMediaControl('pause');
                break;
            case 'next':
                runMediaControl('next');
                break;
            case 'previous':
            case 'prev':
            case 'back':
                runMediaControl('previous');
                break;
            case 'open_spotify':
            case 'spotify_open':
                void openMediaApp('spotify');
                break;
            case 'open_youtube':
            case 'youtube_open':
                void openMediaApp('youtube');
                break;
            case 'play_spotify':
                runMediaControl('play', 'spotify');
                break;
            case 'pause_spotify':
                runMediaControl('pause', 'spotify');
                break;
            case 'next_spotify':
                runMediaControl('next', 'spotify');
                break;
            case 'previous_spotify':
                runMediaControl('previous', 'spotify');
                break;
            case 'play_youtube':
                runMediaControl('play', 'youtube');
                break;
            case 'pause_youtube':
                runMediaControl('pause', 'youtube');
                break;
            case 'next_youtube':
                runMediaControl('next', 'youtube');
                break;
            case 'previous_youtube':
                runMediaControl('previous', 'youtube');
                break;
            case 'steam':
            case 'steam_play':
            case 'play_game':
                addChatMessage('ai', openSteamGame(actionArg));
                break;
            case 'steam_search':
                window.open(
                    `https://store.steampowered.com/search/?term=${encodeURIComponent(actionArg || "")}`,
                    '_blank',
                    'noopener,noreferrer'
                );
                break;
            case 'duckduckgo':
            case 'ddg':
            case 'search_web':
            case 'web_search':
                if (actionArg) openDuckDuckGoSearch(actionArg);
                break;
            case 'library': case 'games': navigateToGames('all'); break;
            case 'shop': case 'store': navigateToGames('store'); break;
            case 'leaderboards': case 'leaderboard': navigateToGames('leaderboard'); break;
            case 'home': navigate('#top', 'index.html'); break;
            case 'feed': navigate('#feed'); break;
            case 'messages': case 'messenger': navigate('#messages'); break;
            case 'profile': case 'view_my_profile': navigate('#profileView'); break;
            case 'account': navigate('#account'); break;
            case 'settings': triggerClick('#settingsToggleButton'); break;
            case 'upload': case 'compose': navigate('#compose'); break;
            case 'notifications': case 'notifications_panel': triggerClick('#notificationBell'); break;
            case 'admin_panel': case 'moderation': triggerClick('#adminBanLauncherButton'); break;
            case 'ban_list': triggerClick('#adminBanLauncherButton'); break;
            case 'toggle_sidebar': case 'toggle_chat': triggerClick('.chat-toggle-btn'); break;
            case 'toggle_messenger': triggerClick('#messengerLauncherButton'); break;
            case 'toggle_player': case 'toggle_mini_player': triggerClick('.mini-player-head'); break;
            case 'expand_viewer': triggerClick('#messengerExpandButton'); break;
            case 'close_viewer': triggerClick('#viewerCloseButton'); break;
            case 'collapse_viewer': triggerClick('#viewerCollapseButton'); break;
            case 'theme_sunset': setTheme('sunset'); break;
            case 'theme_midnight': setTheme('midnight'); break;
            case 'theme_paper': setTheme('paper'); break;
            case 'theme_ember': setTheme('ember'); break;
            case 'theme_forest': setTheme('forest'); break;
            case 'theme_ocean': setTheme('ocean'); break;
            case 'settings_theme': triggerClick('#settingsToggleButton'); break;
            case 'settings_account': navigate('#account'); break;
            case 'settings_bridge': triggerClick('#settingsToggleButton'); setTimeout(() => navigate('#bridgeSecretInput'), 100); break;
            case 'edit_profile': navigate('#profileView'); break;
            case 'sync_profile': triggerClick('#saveProfileButton'); break;
            case 'new_message': navigate('#messages'); setTimeout(() => triggerClick('#messageInput'), 200); break;
            case 'search_contacts': navigate('#messages'); setTimeout(() => triggerClick('#peopleSearchInput'), 200); break;
            case 'search_people': triggerClick('#peopleSearchInput'); break;
            case 'keyboard_shortcuts': triggerClick('#keyboardShortcutsButton'); break;
            case 'help_guide': navigate('./how-to-guide.html'); break;
            case 'view_terms': navigate('./security.html#terms'); break;
            case 'view_privacy': navigate('./security.html#privacy'); break;
            case 'refresh_page': window.location.reload(); break;
            case 'logout': triggerClick('#signOutButton'); break;
            case 'jump_to_top': case 'scroll_to_top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
            case 'jump_to_bottom': case 'scroll_to_bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
            case 'scroll_to_feed': document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth' }); break;
            case 'scroll_to_player': document.querySelector('.mini-player')?.scrollIntoView({ behavior: 'smooth' }); break;
            case 'view_liked': case 'feed_liked': if (typeof window.setFilter === 'function') window.setFilter('saved'); break;
            case 'view_saved': case 'feed_saved': if (typeof window.setFilter === 'function') window.setFilter('saved'); break;
            case 'feed_images': if (typeof window.setFilter === 'function') window.setFilter('image'); break;
            case 'feed_videos': if (typeof window.setFilter === 'function') window.setFilter('video'); break;
            case 'feed_audio': if (typeof window.setFilter === 'function') window.setFilter('audio'); break;
            case 'feed_youtube': if (typeof window.triggerSearch === 'function') window.triggerSearch('youtube'); break;
            case 'feed_spotify': if (typeof window.triggerSearch === 'function') window.triggerSearch('spotify'); break;
            case 'feed_today': if (typeof window.triggerSearch === 'function') window.triggerSearch('today'); break;
            case 'feed_popular': if (typeof window.setSort === 'function') window.setSort('popular'); break;
            case 'feed_newest': if (typeof window.setSort === 'function') window.setSort('newest'); break;
            case 'feed_oldest': if (typeof window.setSort === 'function') window.setSort('oldest'); break;
            case 'mute_audio': if (window.heroMediaPlayerController) window.heroMediaPlayerController.setVolume(0); break;
            case 'unmute_audio': if (window.heroMediaPlayerController) window.heroMediaPlayerController.setVolume(0.5); break;
            case 'reset_player': if (typeof window.resetPlayerDockPosition === 'function') window.resetPlayerDockPosition(); break;
            case 'clear_notifications': triggerClick('#clearNotificationsButton'); break;
            case 'mark_all_read': triggerClick('#markAllReadButton'); break;
            case 'barrel_roll':
                document.body.style.transition = "transform 1s";
                document.body.style.transform = "rotate(360deg)";
                setTimeout(() => document.body.style.transform = "", 1000);
                break;
            case 'joke':
                const jokes = [
                    "Why did the gamer stay in bed? Because he had 'lag'.",
                    "I asked the A.I. to make me a sandwich. It said: 'SUDO make sandwich'.",
                    "How many programmers does it take to change a lightbulb? None, that's a hardware problem.",
                    "What's a gamer's favorite snack? Micro-chips."
                ];
                addChatMessage('ai', "🤖 [Humor Protocol]: " + jokes[Math.floor(Math.random() * jokes.length)]);
                break;
            case 'konami_code':
                addChatMessage('ai', "🕹️ [Easter Egg]: ↑ ↑ ↓ ↓ ← → ← → B A. 30 Lives added! (Metaphorically speaking).");
                break;
            case 'meaning_of_life':
                addChatMessage('ai', "👾 [Deep Protocol]: 42. And also, achieving a new high score in the arcade.");
                break;
            case 'action': console.log('[Arcade Chat] Received generic action placeholder. No-op.'); break;
            default: console.warn(`[Arcade Chat] Unknown protocol action: ${action}`);
        }
    } catch (err) {
        console.error(`[Arcade Chat] Failed to execute ${action}:`, err);
    }
}

function addTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container) return null;
    const id = 'typing_' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = 'chat-message message-ai';
    msgDiv.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

let isSendingChatMessage = false;
window.activeArcadeCommandMode = null;
window.activeArcadeCommandModes = [];
const SEND_BUTTON_SEND_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path></svg>';
const SEND_BUTTON_STOP_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';

function getChatSendButton() {
    return document.querySelector('.chat-input-wrapper .chat-send-btn') || document.querySelector('.chat-send-btn');
}

function setChatSendButtonMode(mode = 'send') {
    const button = getChatSendButton();
    if (!button) return;

    if (mode === 'stop') {
        button.classList.add('is-stop');
        button.innerHTML = SEND_BUTTON_STOP_ICON;
        button.setAttribute('aria-label', 'Stop response');
        button.title = 'Stop response';
        return;
    }

    button.classList.remove('is-stop');
    button.innerHTML = SEND_BUTTON_SEND_ICON;
    button.setAttribute('aria-label', 'Send message');
    button.title = 'Send message';
}

window.sendChatMessage = async function (promptOverride = '') {
    if (isSendingChatMessage) {
        if (typeof window.stopArcadeAi === 'function') window.stopArcadeAi();
        return;
    }
    isSendingChatMessage = true;

    const input = document.getElementById('arc-chat-input');
    if (!input) {
        isSendingChatMessage = false;
        return;
    }
    const overrideText = typeof promptOverride === 'string' ? promptOverride.trim() : '';
    if (overrideText) {
        input.value = overrideText;
    }
    let text = input.value.trim();
    if (!text) {
        isSendingChatMessage = false;
        return;
    }

    try {
        const isCommand = text.startsWith('/')
            || text.startsWith('[')
            || /^(?:edit|fix|rewrite|publish|clear|help)\s*\//i.test(text);
        const originalText = text;
        if (isCommand) {
            try {
                const cmdHandled = await handleArcadeSlashCommand(text, input);
                if (cmdHandled) {
                    // Ensure the user sees their command even if it was handled locally (except /clear which is silent)
                    if (!text.toLowerCase().startsWith('/clear')) {
                        addChatMessage('user', originalText);
                        arcadeChatHistory.push({ role: 'user', content: originalText, attachment: null });
                        saveCurrentChat();
                    }
                    isSendingChatMessage = false;
                    return;
                }
                // Update internal text to stripped version for intent detection
                text = input.value.trim();
            } catch (cmdErr) {
                console.error("[Arcade Chat] Slash command failed:", cmdErr);
                // Fall back to treating it as a normal message if the command failed
            }
        }

        // --- ALWAYS add the user message to UI and history now (if not handled by /clear) ---
        addChatMessage('user', originalText);
        arcadeChatHistory.push({
            role: 'user',
            content: originalText,
            attachment: currentChatAttachment ? {
                data: currentChatAttachment,
                type: currentChatAttachmentType,
                name: currentChatAttachmentName
            } : null
        });
        saveCurrentChat();

        // Clear input early to feel responsive
        input.value = '';
        const attachmentSnapshot = currentChatAttachment ? {
            data: currentChatAttachment,
            type: currentChatAttachmentType,
            name: currentChatAttachmentName
        } : null;
        clearChatAttachment();

        if (isWorkshopStyleRevertPrompt(text)) {
            const revertResult = await tryRevertLocalWorkshopStyleEnhancement();
            const revertReply = revertResult.message || 'No AI style enhancement block was found to revert.';
            addChatMessage('ai', `[Workshop Edit]: ${revertReply}`);
            arcadeChatHistory.push({ role: 'assistant', content: `[Workshop Edit]: ${revertReply}` });
            saveCurrentChat();
            updateChatStatus(revertResult.ok ? 'active' : 'idle');
            isSendingChatMessage = false;
            return;
        }

        const directSteamTarget = parseDirectSteamCommand(text);
        if (directSteamTarget) {
            const response = openSteamGame(directSteamTarget);
            addChatMessage('ai', response);
            arcadeChatHistory.push({ role: 'assistant', content: response });
            saveCurrentChat();
            updateChatStatus('active');
            isSendingChatMessage = false;
            return;
        }

        const duckQuery = parseDuckDuckGoCommand(text);
        if (duckQuery) {
            const opened = openDuckDuckGoSearch(duckQuery);
            const response = opened
                ? `🔎 [Search Protocol]: Searching DuckDuckGo for "${duckQuery}".`
                : "🔎 [Search Protocol]: Tell me what you want to search on DuckDuckGo.";
            addChatMessage('ai', response);
            arcadeChatHistory.push({ role: 'assistant', content: response });
            saveCurrentChat();
            updateChatStatus('active');
            isSendingChatMessage = false;
            return;
        }

        const workshopPublishIntent = getWorkshop().isWorkshopPublishIntentPrompt(text);

        if (getWorkshop().allowsLocalStyleFallback(text)) {
            window.activeArcadeCommandMode = null;
            const localStyleFallback = await tryLocalWorkshopStyleFallback(text);
            const fallbackReply = `[Workshop Edit]: ${localStyleFallback.ok
                ? localStyleFallback.message
                : (localStyleFallback.message || 'No active Workshop file content is available.')}`;
            addChatMessage('ai', fallbackReply);
            arcadeChatHistory.push({ role: 'assistant', content: fallbackReply });
            saveCurrentChat();
            updateChatStatus(localStyleFallback.ok ? 'active' : 'idle');
            isSendingChatMessage = false;
            return;
        }

        // Refresh bridge context on demand so AI has latest info
        if (typeof pollDesktopBridge === 'function') {
            await pollDesktopBridge();
        }

        const typingId = addTypingIndicator();
        let activeAiAbortController = new AbortController();
        const { signal } = activeAiAbortController;
        setChatSendButtonMode('stop');

        window.stopArcadeAi = function () {
            if (activeAiAbortController) {
                activeAiAbortController.abort();
                activeAiAbortController = null;
                removeTypingIndicator(typingId);
                addChatMessage('ai', '🕹️ [Arcade Protocol]: Intelligence process terminated by user.');
                updateChatStatus('idle');
                setChatSendButtonMode('send');
            }
        };

        let reply = null;
        let lastError = null;
        let wasCancelledByUser = false;

        // Prepare rich context for the AI
        let richContext = {
            page: {
                title: document.title,
                url: window.location.href,
                category: typeof currentCategory !== 'undefined' ? currentCategory : 'unknown'
            },
            user: (window.state && window.state.currentUser) ? {
                id: window.state.currentUser.id,
                email: window.state.currentUser.email,
                isBanned: window.state.currentUserBanned
            } : "Guest",
            media: (window.heroMediaPlayerState) ? {
                title: window.heroMediaPlayerState.title,
                meta: window.heroMediaPlayerState.meta,
                playback: window.heroMediaPlayerState.playbackState
            } : "Inactive",
            gameStats: (typeof window.getAllGameStats === 'function') ? window.getAllGameStats() : "Unavailable",
            workshop: (typeof window.getWorkshopGamesForAi === 'function') ? window.getWorkshopGamesForAi() : [],
            workshopEditor: (typeof window.getWorkshopEditorState === 'function') ? window.getWorkshopEditorState() : null,
            ui: {
                messengerOpen: !!(window.state && window.state.messengerOpen),
                sidebarOpen: !!document.querySelector('.steam-chat-sidebar.active')
            }
        };

        const editorReferenceActive = getWorkshop().isWorkshopEditorReferencePrompt(text);
        const multiFileEditActive = getWorkshop().isWorkshopMultiFileEditPrompt(text, richContext);
        const rewriteRequestActive = multiFileEditActive || getWorkshop().isWorkshopRewriteIntentPrompt(text, richContext);
        const editRequestActive = rewriteRequestActive || getWorkshop().isWorkshopEditIntentPrompt(text, richContext);
        const activeEditorForRequest = getActiveWorkshopEditorContext(richContext);
        const activeEditorHasSource = !!`${activeEditorForRequest?.activeFileContent || ''}`.trim();
        if (editRequestActive && hasActiveWorkshopEditor(richContext) && !activeEditorHasSource) {
            const editorName = `${activeEditorForRequest?.activeFileName || 'selected file'}`.trim();
            const replyText = `[Workshop Edit]: I can see ${editorName} selected in the editor, but its source content is not readable yet. Re-select the file in Workshop Edit Mode, then send the edit request again.`;
            removeTypingIndicator(typingId);
            addChatMessage('ai', replyText);
            arcadeChatHistory.push({ role: 'assistant', content: replyText });
            saveCurrentChat();
            updateChatStatus('idle');
            return;
        }
        if (editorReferenceActive && !hasActiveWorkshopEditor(richContext)) {
            const replyText = '[Workshop Edit]: I cannot read an active Workshop editor file yet. Open Workshop Edit Mode, select the game and file, then send the edit request again.';
            removeTypingIndicator(typingId);
            addChatMessage('ai', replyText);
            arcadeChatHistory.push({ role: 'assistant', content: replyText });
            saveCurrentChat();
            updateChatStatus('idle');
            return;
        }
        const contextForModel = {
            ...richContext,
            workshopEditor: richContext.workshopEditor ? {
                ...richContext.workshopEditor,
                activeFileContent: undefined,
                activeFileContentLength: `${richContext.workshopEditor.activeFileContent || ''}`.length,
                ...(editRequestActive ? { activeFileContentProvidedInEditProtocol: true } : {})
            } : null
        };
        const pageContext = JSON.stringify(contextForModel);
        // Omit visible page text if we are in the editor to save tokens
        const pageText = richContext.workshopEditor ? "" : document.body.innerText.substring(0, 300);
        // Keep only the most recent messages to prevent context window overflow on small local models
        const maxHistory = editRequestActive ? (editorReferenceActive ? 6 : 2) : 6;
        const recentHistory = arcadeChatHistory.slice(-maxHistory);

        const normalizedHistory = window.SignalShareAiCore
            ? window.SignalShareAiCore.normalizeHistory(recentHistory, { aiSenderId: 'assistant' })
            : recentHistory.map(m => ({ role: m.role, content: m.content }));
        const sharedAiContext = window.SignalShareAiCore
            ? window.SignalShareAiCore.buildCompanionContext({
                surface: 'mini-games',
                pageTitle: document.title || '',
                pageUrl: window.location.href,
                currentCategory: typeof currentCategory !== 'undefined' ? currentCategory : 'unknown',
                visibleText: pageText,
                attachment: arcadeChatHistory[arcadeChatHistory.length - 1]?.attachment || null
            })
            : '';
        const attachment = attachmentSnapshot;
        const protocolDirectives = getProtocolDirectives(text, richContext, attachment);
        const workshopEditContext = editRequestActive
            ? `[ACTIVE_WORKSHOP_EDITOR]\n${JSON.stringify(contextForModel.workshopEditor || null)}`
            : '';
        const fullPageContext = editRequestActive
            ? `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${workshopEditContext}`
            : `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${sharedAiContext ? `${sharedAiContext}\n\n` : ''}${pageContext} (Visible text: ${pageText})`;

        try {
            const modelSelect = document.getElementById('chat-model-select');
            const selectedModel = modelSelect ? modelSelect.value : 'auto';
            const requestModel = resolveChatRequestModel(selectedModel);
            const customInstructions = typeof getAiCore()?.getStoredCustomInstructions === 'function'
                ? getAiCore().getStoredCustomInstructions()
                : `${localStorage.getItem('ss_ai_custom_instructions') || ''}`.trim().slice(0, 2000);
            if (!isBridgeFeatureEnabled()) {
                // User explicitly asked the companion for an AI reply, so enable bridge attempts.
                localStorage.setItem('ss_bridge_enabled', '1');
            }
            const shouldBridgeSendPreflight = isEngineStatusOffline();
            if (shouldBridgeSendPreflight) {
                const bridgeOnlineOnSend = await checkBridgeConnectivity({ signal, timeoutMs: 1500 });
                updateEngineStatus(bridgeOnlineOnSend);
                if (bridgeOnlineOnSend) {
                    bridgePollFailureCount = 0;
                    bridgePollNextAllowedAt = 0;
                } else {
                    // Preflight failed, the bridge is unreachable. 
                    // Stop here and fall through to the offline protocol.
                    reply = null;
                    lastError = "Bridge is unreachable. Ensure the PC bridge is running and reachable.";
                    throw new Error(lastError);
                }
            }

            const protocolAwareMessage = buildProtocolAwareUserMessage(text);
            const compactHistory = Array.isArray(normalizedHistory) ? normalizedHistory.slice(editRequestActive ? -4 : -10) : [];
            const maxContextChars = editRequestActive ? 9000 : 12000;
            const compactPageContext = `${fullPageContext || ''}`.slice(0, maxContextChars); // Keep small local models responsive

            const payloadVariants = [
                {
                    label: 'compact',
                    body: JSON.stringify({
                        message: protocolAwareMessage,
                        model: requestModel,
                        customInstructions,
                        attachment,
                        history: compactHistory,
                        pageContext: compactPageContext
                    })
                }
            ];

            const chatPaths = ['/api/local-llm/chat', '/api/llm/chat'];
            const attemptErrors = [];

            for (const payloadVariant of payloadVariants) {
                for (const chatPath of chatPaths) {
                    const attemptPath = `${payloadVariant.label}:${chatPath}`;
                    try {
                        const nextResponse = await bridgeFetch(chatPath, {
                            method: 'POST',
                            timeoutMs: 0,
                            signal,
                            body: payloadVariant.body
                        });

                        if (nextResponse?.ok) {
                            const data = await nextResponse.json().catch(() => null);
                            if (!data || typeof data !== 'object') {
                                attemptErrors.push(formatAttemptError(attemptPath, 'non-JSON payload', captureClientSourceLocation()));
                                continue;
                            }
                            const candidateReply = typeof data.reply === 'string' ? data.reply : '';
                            if (!candidateReply.trim()) {
                                attemptErrors.push(formatAttemptError(attemptPath, 'empty AI reply', captureClientSourceLocation()));
                                continue;
                            }

                            if (isBridgeLightweightOfflineReply(candidateReply)) {
                                attemptErrors.push(formatAttemptError(attemptPath, 'lightweight offline fallback from bridge', captureClientSourceLocation()));
                                continue;
                            }

                            reply = candidateReply;
                            break;
                        } else {
                            const statusCode = nextResponse?.status ?? "unknown";
                            const errorDetails = await readBridgeErrorDetails(nextResponse);
                            const statusReason = errorDetails.message
                                ? `HTTP ${statusCode} (${errorDetails.message})`
                                : `HTTP ${statusCode}`;
                            attemptErrors.push(formatAttemptError(
                                attemptPath,
                                statusReason,
                                errorDetails.sourceLocation || captureClientSourceLocation()
                            ));

                            if (nextResponse.status === 404 && chatPath !== chatPaths[chatPaths.length - 1]) {
                                continue;
                            }

                            if ((nextResponse.status === 401 || nextResponse.status === 403)
                                && chatPath === '/api/local-llm/chat'
                                && chatPath !== chatPaths[chatPaths.length - 1]) {
                                // Token/secret mismatch on strict local-llm route; try legacy chat route.
                                continue;
                            }
                        }
                    } catch (routeError) {
                        const routeMessage = `${routeError?.message || 'request failed'}`.trim();
                        const routeLocation = extractStackLocation(routeError) || captureClientSourceLocation();
                        attemptErrors.push(formatAttemptError(attemptPath, routeMessage, routeLocation));
                    }
                }

                if (reply !== null) break;
            }

            if (reply !== null) {
                updateEngineStatus(true);
                bridgePollFailureCount = 0;
                bridgePollNextAllowedAt = 0;
            } else {
                const isAbort = attemptErrors.some(err => err.toLowerCase().includes('abort') || err.toLowerCase().includes('cancel'));
                lastError = isAbort ? 'Request cancelled by user' : (attemptErrors.length > 0
                    ? attemptErrors.join(" | ")
                    : "Bridge did not return an AI reply");
                updateEngineStatus(false);
            }
        } catch (err) {
            const bridgeDisabled = err?.name === 'BridgeDisabledError';
            if (signal.aborted) {
                wasCancelledByUser = true;
                lastError = 'Request cancelled by user';
            } else {
                let nextError = bridgeDisabled
                    ? 'Bridge disabled'
                    : (err?.message || "Connection refused or blocked by browser");
                if (!bridgeDisabled && /failed to fetch/i.test(`${nextError}`)) {
                    const configuredBridge = `${window.SignalShareLocalLlm?.getBridgeBaseUrl?.()
                        || localStorage.getItem('signal-share-bridge-url')
                        || ''}`.trim();
                    if (configuredBridge) {
                        const hint = configuredBridge.toLowerCase().startsWith('https://')
                            ? ' Use http:// for local bridge URLs.'
                            : '';
                        nextError = `Failed to fetch bridge at ${configuredBridge}. Ensure phone and PC are on the same Wi-Fi and port 3000 is allowed.${hint}`;
                    } else {
                        nextError = 'Failed to fetch bridge. Set Bridge URL (PC IP) in settings (example: http://192.168.x.x:3000).';
                    }
                }
                const topLevelErrorLocation = extractStackLocation(err);
                if (topLevelErrorLocation) {
                    nextError = `${nextError} @ ${topLevelErrorLocation}`;
                }
                lastError = nextError;
            }
            if (!bridgeDisabled && !wasCancelledByUser) {
                console.warn(`[Arcade Chat] Bridge request failed:`, err);
                updateEngineStatus(false);
            }
        } finally {
            removeTypingIndicator(typingId);
        }

        if (wasCancelledByUser) {
            return;
        }

        if (reply !== null) {
            if (editRequestActive && isUnhelpfulWorkshopEditReply(reply)) {
                const retryReply = rewriteRequestActive
                    ? await retryWorkshopRewriteWithEditorContext(text, richContext, signal)
                    : await retryWorkshopEditWithEditorContext(text, richContext, signal);
                if (retryReply && !isUnhelpfulWorkshopEditReply(retryReply)) {
                    reply = retryReply;
                }
            }

            if (editRequestActive && isUnhelpfulWorkshopEditReply(reply) && getWorkshop().allowsLocalStyleFallback(text)) {
                const localStyleFallback = await tryLocalWorkshopStyleFallback(text, richContext);
                if (localStyleFallback?.ok) {
                    const fallbackReply = `[Workshop Edit]: ${localStyleFallback.message}`;
                    addChatMessage('ai', fallbackReply);
                    arcadeChatHistory.push({ role: 'assistant', content: fallbackReply });
                    saveCurrentChat();
                    updateChatStatus('active');
                    return;
                }
            }

            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');

            // Execute any tags in the reply
            if (window.showFeedback && (reply.includes('[PUBLISH]') || getWorkshop().isWorkshopPublishIntentPrompt(text))) {
                window.showFeedback("🕹️ Processing Workshop Assets...", false, 4000);
            }
            const actionResult = await executeArcadeChatActions(reply, { userPrompt: text });

            // AUTO-REFINE: If AI requested a search, automatically fetch it and trigger a follow-up
            if (actionResult.findTagDetected && actionResult.feedback) {
                const autoFollowUp = actionResult.feedback;
                console.log('[Arcade Chat] Auto-refining search result for AI...');
                
                // Add the retrieval to history so the AI sees it in context
                arcadeChatHistory.push({ role: 'user', content: autoFollowUp });
                
                // Trigger a recursive call to sendChatMessage with the new context
                setTimeout(() => {
                    sendChatMessage(autoFollowUp);
                }, 500);
                return;
            }

            // MUTUAL EXCLUSION: If an edit was attempted/performed, do not also try to publish a new game.
            // This prevents "Double Actioning" when the prompt is ambiguous.
            if (actionResult?.workshopFileRewriteAttempted) {
                // Edit was handled (either via tag or fallback was skipped because tag handled it)
                // No further action needed for this message.
            } else if (editRequestActive) {
                // Attempt automated edit fallback if no tag was found
                await tryAutoWorkshopFileRewriteFromReply(reply, text, richContext);
            } else if (getWorkshop().isWorkshopPublishIntentPrompt(text) && !actionResult?.workshopPublishAttempted) {
                // Only try auto-publish if NOT an edit intent and no publish tag was found
                await tryAutoPublishWorkshopFromReply(reply, text);
            }
        } else {
            if (workshopPublishIntent && !getWorkshop().isWorkshopEditIntentPrompt(text, richContext)) {
                const publishReply = '🕹️ [Arcade Protocol]: I did not publish anything because the local model did not return a valid game. Please retry with a stronger code model or ask me to generate the files again.';
                addChatMessage('ai', publishReply);
                arcadeChatHistory.push({ role: 'assistant', content: publishReply });
                saveCurrentChat();
                updateChatStatus('idle');
                return;
            }

            if (lastError !== 'Bridge disabled' && lastError !== 'Request cancelled by user') {
                console.warn(`[Arcade Chat] Primary bridge failed (${lastError}). Switching to Offline Protocol.`);

                // NEW: Add a specific error prompt to the chat for the user
                const container = document.getElementById('chat-messages');
                if (container && lastError) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'chat-message system-error';
                    errorDiv.style.cssText = 'align-self: center; background: rgba(231, 76, 60, 0.1); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.2); font-size: 0.7rem; padding: 4px 10px; border-radius: 4px; margin: 8px 0; font-family: monospace; opacity: 0.8;';
                    errorDiv.textContent = `A.I. Bridge Error: ${lastError}`;
                    container.appendChild(errorDiv);
                    container.scrollTop = container.scrollHeight;
                }
            }
            let offlineReply = '';
            if (!workshopPublishIntent && window.ArcadeChatbotEngine?.processIntent) {
                try {
                    const localIntentReply = await Promise.resolve(window.ArcadeChatbotEngine.processIntent(text));
                    if (typeof localIntentReply === 'string' && localIntentReply.trim()) {
                        offlineReply = localIntentReply.trim();
                    }
                } catch (_intentError) {
                    // Fall through to standard offline protocol response.
                }
            }
            if (!offlineReply) {
                offlineReply = getArcadeProtocolOfflineResponse(text);
            }
            addChatMessage('ai', offlineReply);

            arcadeChatHistory.push({ role: 'assistant', content: offlineReply });
            saveCurrentChat();
            updateChatStatus('offline');
        }
    } catch (e) {
        console.error("[Arcade Chat] Error in sendChatMessage:", e);
    } finally {
        isSendingChatMessage = false;
        setChatSendButtonMode('send');
        updateChatStatus('idle');
        window.stopArcadeAi = null;
    }
}


function decodeEscapedCodeText(value) {
    return getWorkshop().decodeEscapedCodeText(value);
}

function stripWorkshopEditSnippet(value = "") {
    let text = decodeEscapedCodeText(value).trim();
    text = text.replace(/\[\/?(?:EDIT|EDIT_FILE|FILE_EDIT|Workshop\/Edit)\]/gi, '').trim();
    const fenceMatch = text.match(/^```[a-z0-9_+-]*\s*\n([\s\S]*?)\n?```$/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    return text;
}

function parseWorkshopSearchReplaceBlock(rawContent = "") {
    const text = stripWorkshopEditSnippet(rawContent);
    const searchMatch = text.match(/SEARCH:\s*([\s\S]+?)\s*REPLACE:\s*([\s\S]+)/i);
    if (!searchMatch) return null;

    const search = stripWorkshopEditSnippet(searchMatch[1]);
    let replace = stripWorkshopEditSnippet(searchMatch[2]);
    replace = replace
        .replace(/\n\s*(?:EXPLANATION|NOTES?|TEST(?:ING)?|SUMMARY)\s*:\s*[\s\S]*$/i, '')
        .trim();

    if (!search || !replace) return null;
    return { search, replace };
}

function extractWorkshopEditBlocks(text = "") {
    return getWorkshop().extractWorkshopEditBlocks(text);
}

function extractAiCodeBlocks(rawText = '') {
    const blocks = [];
    const sourceText = `${rawText || ''}`;
    const blockRegex = /```([^\n`]*)\n([\s\S]*?)```/gi;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(sourceText)) !== null) {
        const lang = `${blockMatch[1] || ''}`.trim().toLowerCase();
        const code = `${blockMatch[2] || ''}`.trim();
        if (code) blocks.push({ lang, code });
    }
    return blocks;
}



function buildAiWorkshopFilesFromText(rawText) {
    const files = [];
    const counters = { html: 0, css: 0, js: 0, txt: 0 };
    const nextName = (kind) => {
        counters[kind] += 1;
        if (kind === 'html') return counters[kind] === 1 ? 'index.html' : `view-${counters[kind]}.html`;
        if (kind === 'css') return counters[kind] === 1 ? 'styles.css' : `styles-${counters[kind]}.css`;
        if (kind === 'js') return counters[kind] === 1 ? 'game.js' : `game-${counters[kind]}.js`;
        return `snippet-${counters.txt}.txt`;
    };
    const fileNameFromInfo = (info = '') => {
        const text = `${info || ''}`.trim();
        const named = text.match(/\b(?:file(?:name)?|name|path)=["']?([^"'\s`]+)["']?/i);
        const direct = named?.[1] || text.match(/\b([a-z0-9][\w.-]*\.(?:html?|css|js|mjs|cjs|json|txt|svg|xml))\b/i)?.[1] || '';
        return direct ? direct.replace(/[/\\]+/g, '_') : '';
    };

    const sourceText = `${rawText || ''}`;
    const codeBlocks = extractAiCodeBlocks(sourceText);
    for (const block of codeBlocks) {
        const code = block.code;
        const kind = getWorkshop().inferCodeKind(block.lang, code);
        files.push({
            name: fileNameFromInfo(block.lang) || nextName(kind),
            type: kind === 'html' ? 'text/html' : kind === 'css' ? 'text/css' : kind === 'js' ? 'text/javascript' : 'text/plain',
            content: code
        });
    }

    if (files.length > 0) {
        return files;
    }

    // Fallback: Check if the AI returned a raw JSON array or object containing files (ignoring our protocol tags)
    const trimmed = sourceText.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
            const rawJson = JSON.parse(trimmed);
            const rawFiles = Array.isArray(rawJson) ? rawJson : (Array.isArray(rawJson.files) ? rawJson.files : null);
            if (rawFiles && rawFiles.length > 0 && (rawFiles[0].content || rawFiles[0].code)) {
                return rawFiles.map(f => ({
                    name: f.name || f.filename || `file-${Math.random().toString(36).slice(2, 5)}.txt`,
                    type: f.type || getWorkshop().inferFileType(f.name || f.filename),
                    content: f.content || f.code || ""
                })).filter(f => f.content);
            }
        } catch (e) { }
    }

    // NEW: Greedy Extraction for truncated JSON content (Handles cases where JSON is malformed/truncated but code is present)
    if (files.length === 0) {
        const contentMatches = sourceText.matchAll(/"(?:content|code)"\s*:\s*"([\s\S]*?)(?<!\\)"/g);
        for (const match of contentMatches) {
            const code = decodeEscapedCodeText(match[1]);
            if (getWorkshop().looksLikeExecutableCode(code)) {
                const kind = getWorkshop().inferCodeKind('', code);
                files.push({
                    name: nextName(kind),
                    type: kind === 'html' ? 'text/html' : kind === 'css' ? 'text/css' : kind === 'js' ? 'text/javascript' : 'text/plain',
                    content: code
                });
            }
        }
    }

    if (files.length > 0) {
        return files;
    }

    let fallback = sourceText.split(/\[PUBLISH:\s*/i)[0] || '';
    fallback = decodeEscapedCodeText(fallback).split(/\n#{2,}\s*step\s*2\b/i)[0].trim();
    const codeStart = fallback.search(/<!doctype html|<html|(?:^|\n)\s*(?:function|const|let|var|class)\s+/i);
    if (codeStart > 0) {
        fallback = fallback.slice(codeStart).trim();
    }

    if (!getWorkshop().looksLikeExecutableCode(fallback)) {
        return [];
    }

    const isHtml = /<!doctype html|<html/i.test(fallback);
    return [{
        name: isHtml ? 'index.html' : 'game.js',
        type: isHtml ? 'text/html' : 'text/javascript',
        content: fallback
    }];
}

function buildAiWorkshopFilesFromHistory() {
    if (!Array.isArray(arcadeChatHistory)) return [];
    let assistantMessagesChecked = 0;
    for (let i = arcadeChatHistory.length - 1; i >= 0; i -= 1) {
        const entry = arcadeChatHistory[i];
        if (!entry || entry.role !== 'assistant' || typeof entry.content !== 'string') continue;
        assistantMessagesChecked += 1;
        const files = getWorkshop().buildFilesFromText(entry.content);
        if (files.length > 0) return files;
        if (assistantMessagesChecked >= 8) break;
    }
    return [];
}


function getWorkshopFileKindFromName(fileName = "") {
    return getWorkshop().getWorkshopFileKindFromName(fileName);
}

function stripStyleWrapperFromCss(value = '') {
    let css = `${value || ''}`.trim();
    const styleMatch = css.match(/^<style\b[^>]*>([\s\S]*?)<\/style>$/i);
    if (styleMatch) css = styleMatch[1].trim();
    return css;
}

function looksLikeCssPatchContent(value = '') {
    const css = stripStyleWrapperFromCss(value);
    if (!css || /<\/?(?:html|body|head|script|main|div|button|input)\b/i.test(css)) return false;
    return /[{}]/.test(css) && /[.#:a-z0-9_*@[\]-][^{]*\{[\s\S]*?\}/i.test(css);
}

function removeGeneratedWorkshopStylePatch(content = '') {
    return `${content || ''}`
        .replace(/\n?\s*<style\s+id=["']ai-generated-workshop-style["'][\s\S]*?<\/style>\s*/gi, '\n')
        .replace(/\n?\s*\/\* AI generated style patch \*\/[\s\S]*?\/\* End AI generated style patch \*\/\s*/gi, '\n');
}

function upsertGeneratedWorkshopStylePatch(content = '', fileName = '', cssPatch = '') {
    const css = stripStyleWrapperFromCss(cssPatch);
    if (!looksLikeCssPatchContent(css)) return content;

    const withoutOld = removeGeneratedWorkshopStylePatch(content).trimEnd();
    const cssBlock = `/* AI generated style patch */\n${css}\n/* End AI generated style patch */`;
    const fileKind = getWorkshopFileKindFromName(fileName);

    if (fileKind === 'css') {
        return `${withoutOld}\n\n${cssBlock}\n`;
    }

    if (fileKind === 'html') {
        const styleBlock = `<style id="ai-generated-workshop-style">\n${cssBlock}\n</style>`;
        if (/<\/head>/i.test(withoutOld)) {
            return withoutOld.replace(/<\/head>/i, `  ${styleBlock}\n</head>`);
        }
        if (/<\/body>/i.test(withoutOld)) {
            return withoutOld.replace(/<\/body>/i, `${styleBlock}\n</body>`);
        }
        return `${styleBlock}\n${withoutOld}`;
    }

    return content;
}

function looksLikeFullActiveFileContent(fileName = '', generatedContent = '', oldContent = '') {
    const kind = getWorkshopFileKindFromName(fileName);
    const generated = `${generatedContent || ''}`.trim();
    const current = `${oldContent || ''}`.trim();
    if (!generated || !current) return false;

    if (kind === 'html') {
        return /<!doctype html|<html[\s>]/i.test(generated);
    }

    const minReasonableLength = Math.max(80, Math.floor(current.length * 0.45));
    if (generated.length < minReasonableLength || generated.length > current.length * 2.5) return false;
    if (kind === 'css') return looksLikeCssPatchContent(generated);
    if (kind === 'js') return getWorkshop().looksLikeExecutableCode(generated);
    return false;
}

function looksLikeHtmlFragment(value = '') {
    const html = `${value || ''}`.trim();
    if (!html) return false;
    if (/<!doctype html|<html[\s>]/i.test(html)) return true;
    const tagCount = (html.match(/<\/?[a-z][\w:-]*(?:\s[^>]*)?>/gi) || []).length;
    return tagCount >= 3 && /<\/(?:div|main|section|style|script|button|form|p|h[1-6])>/i.test(html);
}

function getHtmlAttributeValue(attributes = '', name = '') {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
    const match = `${attributes || ''}`.match(pattern);
    return match?.[2] || '';
}

function getFirstHtmlElementSignature(fragment = '') {
    const source = `${fragment || ''}`.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, '');
    const match = source.match(/<([a-z][\w:-]*)(\s[^>]*)?>/i);
    if (!match) return null;
    const tagName = `${match[1] || ''}`.toLowerCase();
    const attributes = `${match[2] || ''}`;
    const id = getHtmlAttributeValue(attributes, 'id').trim();
    const classes = getHtmlAttributeValue(attributes, 'class')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    return { tagName, id, classes };
}

function htmlOpenTagMatchesSignature(openTag = '', signature = null) {
    if (!signature) return false;
    const tagMatch = `${openTag || ''}`.match(/^<([a-z][\w:-]*)\b([\s\S]*?)>$/i);
    if (!tagMatch || tagMatch[1].toLowerCase() !== signature.tagName) return false;

    const attributes = `${tagMatch[2] || ''}`;
    if (signature.id) {
        return getHtmlAttributeValue(attributes, 'id') === signature.id;
    }

    if (signature.classes.length > 0) {
        const existingClasses = new Set(getHtmlAttributeValue(attributes, 'class').split(/\s+/).filter(Boolean));
        return signature.classes.some((className) => existingClasses.has(className));
    }

    return false;
}

function findMatchingHtmlElementEnd(content = '', startIndex = 0, tagName = '') {
    const name = `${tagName || ''}`.trim().toLowerCase();
    if (!name) return -1;

    const tagRegex = new RegExp(`<\\/?${name}\\b[^>]*>`, 'gi');
    tagRegex.lastIndex = startIndex;
    let depth = 0;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
        const tag = match[0];
        const isClosing = /^<\//.test(tag);
        const isSelfClosing = /\/\s*>$/.test(tag);

        if (isClosing) {
            depth -= 1;
            if (depth === 0) return match.index + tag.length;
        } else if (!isSelfClosing) {
            depth += 1;
        }
    }

    return -1;
}

function buildHtmlFragmentReplacement(oldContent = '', htmlFragment = '') {
    const fragment = decodeEscapedCodeText(htmlFragment).trim();
    if (!looksLikeHtmlFragment(fragment)) return null;

    const signature = getFirstHtmlElementSignature(fragment);
    if (!signature) return null;

    const openTagRegex = new RegExp(`<${signature.tagName}\\b[^>]*>`, 'gi');
    let match;
    while ((match = openTagRegex.exec(oldContent)) !== null) {
        if (!htmlOpenTagMatchesSignature(match[0], signature)) continue;
        const endIndex = findMatchingHtmlElementEnd(oldContent, match.index, signature.tagName);
        if (endIndex <= match.index) continue;
        const nextContent = `${oldContent.slice(0, match.index)}${fragment}${oldContent.slice(endIndex)}`;
        if (nextContent !== oldContent) {
            return {
                nextContent,
                message: `Applied generated HTML fragment to <${signature.tagName}${signature.id ? ` id="${signature.id}"` : signature.classes[0] ? ` class="${signature.classes[0]}"` : ''}>.`
            };
        }
    }

    return null;
}

function ensureHtmlReferencesWorkshopFiles(html = '', generatedFiles = [], activeFileName = '') {
    let nextHtml = `${html || ''}`.trim();
    if (!nextHtml) return '';

    const activeLower = `${activeFileName || ''}`.trim().toLowerCase();
    const cssFiles = [];
    const jsFiles = [];
    for (const file of generatedFiles) {
        const fileName = `${file?.name || ''}`.trim();
        if (!fileName || fileName.toLowerCase() === activeLower) continue;
        const kind = getWorkshopFileKindFromName(file.name) || getWorkshop().inferCodeKind('', file.content);
        if (kind === 'css' && file.content?.trim()) cssFiles.push(fileName);
        if (kind === 'js' && file.content?.trim()) jsFiles.push(fileName);
    }

    nextHtml = nextHtml
        .replace(/\n?\s*<style\s+id=["']ai-rewrite-inline-css["'][\s\S]*?<\/style>\s*/gi, '\n')
        .replace(/\n?\s*<script\s+id=["']ai-rewrite-inline-js["'][\s\S]*?<\/script>\s*/gi, '\n');

    const hasReference = (attr, fileName) => {
        const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`${attr}\\s*=\\s*["'][^"']*${escaped}["']`, 'i').test(nextHtml);
    };

    const cssLinks = cssFiles
        .filter((fileName) => !hasReference('href', fileName))
        .map((fileName) => `  <link rel="stylesheet" href="${fileName}">`)
        .join('\n');
    if (cssLinks) {
        nextHtml = /<\/head>/i.test(nextHtml)
            ? nextHtml.replace(/<\/head>/i, `${cssLinks}\n</head>`)
            : `${cssLinks}\n${nextHtml}`;
    }

    const scriptTags = jsFiles
        .filter((fileName) => !hasReference('src', fileName))
        .map((fileName) => `  <script src="${fileName}"></script>`)
        .join('\n');
    if (scriptTags) {
        nextHtml = /<\/body>/i.test(nextHtml)
            ? nextHtml.replace(/<\/body>/i, `${scriptTags}\n</body>`)
            : `${nextHtml}\n${scriptTags}`;
    }

    return nextHtml;
}

function buildChangedRegionPatch(oldContent = '', newContent = '') {
    if (oldContent === newContent) return null;

    const lineEnding = oldContent.includes('\r\n') ? '\r\n' : '\n';
    const oldLines = `${oldContent || ''}`.replace(/\r\n/g, '\n').split('\n');
    const newLines = `${newContent || ''}`.replace(/\r\n/g, '\n').split('\n');

    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
        start += 1;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
        oldEnd -= 1;
        newEnd -= 1;
    }

    let searchLines = oldLines.slice(start, oldEnd + 1);
    let replaceLines = newLines.slice(start, newEnd + 1);

    if (searchLines.length === 0) {
        if (start > 0) {
            searchLines = [oldLines[start - 1]];
            replaceLines = [oldLines[start - 1], ...replaceLines];
        } else if (oldLines.length > 0) {
            searchLines = [oldLines[0]];
            replaceLines = [...replaceLines, oldLines[0]];
        }
    }

    const search = searchLines.join(lineEnding).trimEnd();
    const replace = replaceLines.join(lineEnding).trimEnd();
    if (!search) return null;
    return { search, replace };
}

async function tryApplyGeneratedWorkshopPatchFromReply(replyText, userPrompt = '', richContext = null, target = {}) {
    const result = { attempted: false, ok: false, reason: '', message: '' };
    if (typeof window.getWorkshopFileContent !== 'function'
        || typeof window.internalApplyWorkshopFileEdit !== 'function') {
        result.reason = 'workshop-edit-functions-unavailable';
        return result;
    }

    const editorState = getActiveWorkshopEditorContext(richContext);
    const gameId = `${target.gameId || editorState?.activeGameId || ''}`.trim();
    const fileName = `${target.fileName || editorState?.activeFileName || ''}`.trim();
    if (!gameId || !fileName) {
        result.reason = 'no-active-editor-file';
        return result;
    }

    const oldContent = window.getWorkshopFileContent(gameId, fileName);
    if (typeof oldContent !== 'string' || !oldContent.trim()) {
        result.reason = 'active-file-content-unavailable';
        return result;
    }

    const generatedFiles = getWorkshop().buildFilesFromText(replyText);
    if (generatedFiles.length === 0) {
        result.reason = 'no-generated-code-blocks';
        return result;
    }

    const activeKind = getWorkshopFileKindFromName(fileName);
    if (activeKind === 'html') {
        const assetFiles = generatedFiles.filter((file) => {
            const name = `${file?.name || ''}`.trim();
            if (!name || name.toLowerCase() === fileName.toLowerCase()) return false;
            const kind = getWorkshopFileKindFromName(name) || getWorkshop().inferCodeKind('', file.content);
            return (kind === 'js' || kind === 'css') && `${file.content || ''}`.trim();
        });

        const hasGeneratedHtmlFile = generatedFiles.some((file) => {
            const kind = getWorkshopFileKindFromName(file.name) || getWorkshop().inferCodeKind('', file.content);
            return kind === 'html' && looksLikeFullActiveFileContent(fileName, file.content, oldContent);
        });

        if (assetFiles.length > 0 && !hasGeneratedHtmlFile) {
            const nextContent = ensureHtmlReferencesWorkshopFiles(oldContent, assetFiles, fileName);
            result.attempted = true;
            if (typeof window.addAiWorkshopFilesToGame !== 'function') {
                result.reason = 'add-files-function-unavailable';
                result.message = 'Workshop file add function is unavailable.';
                return result;
            }

            const applyResult = await window.addAiWorkshopFilesToGame(gameId, assetFiles, {
                activeFileName: fileName,
                activeFileType: getWorkshop().inferFileType(fileName),
                activeFileContent: nextContent
            });
            result.ok = !!applyResult?.ok;
            result.reason = result.ok ? '' : (applyResult?.message || 'asset-file-apply-failed');
            result.message = result.ok
                ? `Added ${assetFiles.length} generated asset file${assetFiles.length === 1 ? '' : 's'} and linked ${fileName}.`
                : result.reason;
            if (window.showFeedback) window.showFeedback(result.message, !result.ok);
            return result;
        }
    }

    if (activeKind === 'html' && !getWorkshop().isWorkshopRewriteIntentPrompt(userPrompt, richContext)) {
        const htmlFragment = generatedFiles.find((file) => {
            const kind = getWorkshopFileKindFromName(file.name) || getWorkshop().inferCodeKind('', file.content);
            return kind === 'html' && looksLikeHtmlFragment(file.content);
        });

        if (htmlFragment?.content && !looksLikeFullActiveFileContent(fileName, htmlFragment.content, oldContent)) {
            const fragmentResult = buildHtmlFragmentReplacement(oldContent, htmlFragment.content);
            if (fragmentResult?.nextContent) {
                result.attempted = true;
                const nextContent = ensureHtmlReferencesWorkshopFiles(fragmentResult.nextContent, generatedFiles, fileName);
                const extraFiles = generatedFiles.filter((file) => {
                    const name = `${file?.name || ''}`.trim();
                    return name && name.toLowerCase() !== fileName.toLowerCase() && `${file.content || ''}`.trim();
                });
                const applyResult = extraFiles.length > 0 && typeof window.addAiWorkshopFilesToGame === 'function'
                    ? await window.addAiWorkshopFilesToGame(gameId, extraFiles, {
                        activeFileName: fileName,
                        activeFileType: getWorkshop().inferFileType(fileName),
                        activeFileContent: nextContent
                    })
                    : await window.internalApplyWorkshopFileEdit(gameId, fileName, nextContent, { save: true });
                result.ok = !!applyResult?.ok;
                result.reason = result.ok ? '' : (applyResult?.message || 'html-fragment-apply-failed');
                result.message = result.ok
                    ? (extraFiles.length > 0
                        ? `${fragmentResult.message || `Applied generated HTML fragment to ${fileName}.`} Added ${extraFiles.length} file${extraFiles.length === 1 ? '' : 's'}.`
                        : fragmentResult.message || `Applied generated HTML fragment to ${fileName}.`)
                    : result.reason;
                if (window.showFeedback) window.showFeedback(result.message, !result.ok);
                return result;
            }
        }
    }

    if (getWorkshop().isStyleEditPrompt(userPrompt) && (activeKind === 'html' || activeKind === 'css')) {
        const cssFile = generatedFiles.find((file) => {
            const kind = getWorkshopFileKindFromName(file.name) || getWorkshop().inferCodeKind('', file.content);
            return kind === 'css' || looksLikeCssPatchContent(file.content);
        });

        if (cssFile?.content && looksLikeCssPatchContent(cssFile.content)) {
            const nextContent = upsertGeneratedWorkshopStylePatch(oldContent, fileName, cssFile.content);
            result.attempted = true;
            if (nextContent === oldContent) {
                result.reason = 'generated-css-made-no-change';
                result.message = 'Generated CSS did not change the active file.';
                return result;
            }

            const applyResult = await window.internalApplyWorkshopFileEdit(gameId, fileName, nextContent, { save: true });
            result.ok = !!applyResult?.ok;
            result.reason = result.ok ? '' : (applyResult?.message || 'generated-css-apply-failed');
            result.message = result.ok
                ? `Applied AI-generated CSS patch to ${fileName}.`
                : result.reason;
            if (window.showFeedback) window.showFeedback(result.message, !result.ok);
            return result;
        }

        result.reason = 'style-edit-no-css-block';
        return result;
    }

    const activeLower = fileName.toLowerCase();
    const generatedActiveFile = generatedFiles.find((file) => `${file.name || ''}`.toLowerCase() === activeLower)
        || generatedFiles.find((file) => looksLikeFullActiveFileContent(fileName, file.content, oldContent));

    if (!generatedActiveFile?.content || !looksLikeFullActiveFileContent(fileName, generatedActiveFile.content, oldContent)) {
        result.reason = 'no-safe-generated-active-file';
        return result;
    }

    const nextContent = `${generatedActiveFile.content || ''}`.trim();
    const patch = buildChangedRegionPatch(oldContent, nextContent);
    if (!patch) {
        result.reason = 'generated-file-made-no-change';
        return result;
    }

    result.attempted = true;
    let applyResult = null;
    if (typeof window.applyAiFilePatch === 'function') {
        applyResult = await window.applyAiFilePatch(gameId, fileName, patch.search, patch.replace, { save: true });
    }

    result.ok = !!applyResult?.ok;
    result.reason = result.ok ? '' : (applyResult?.message || 'generated-file-apply-failed');
    result.message = result.ok
        ? `Applied AI-generated changed-region patch to ${fileName}.`
        : result.reason;
    if (window.showFeedback) window.showFeedback(result.message, !result.ok);
    return result;
}

function shouldRoutePublishToWorkshop(data, rawReplyText, userPrompt) {
    const target = `${data?.target || data?.destination || data?.publishTo || data?.scope || ''}`.trim().toLowerCase();
    if (target && /(library|workshop|arcade)/.test(target)) return true;

    const prompt = `${userPrompt || ''}`.trim().toLowerCase();
    const promptLooksLikeWorkshopIntent = /(publish|upload|save|add)/.test(prompt) && /(library|workshop)/.test(prompt);
    if (promptLooksLikeWorkshopIntent) return true;

    const reply = `${rawReplyText || ''}`.trim().toLowerCase();
    const replyLooksLikeWorkshopIntent = /(library|workshop)/.test(reply) && /\[publish:/i.test(reply);
    return replyLooksLikeWorkshopIntent;
}

// (Function moved to higher scope)

function inferWorkshopTitleFromPrompt(userPrompt = '') {
    const text = `${userPrompt || ''}`.trim();
    const quoted = text.match(/["'`]{1}([^"'`\n]{2,80})["'`]{1}/);
    if (quoted?.[1]) return quoted[1].trim();
    const named = text.match(/\b(?:called|named|title(?:d)?)\s+([a-z0-9 _-]{2,80})$/i);
    if (named?.[1]) return named[1].trim();
    return 'AI Workshop Game';
}

/**
 * Executes AI-generated tags in the chat reply.
 * Handles [PUBLISH], [COMPOSE], [ARCADE], [DUCKDUCKGO], [OPEN].
 */
async function executeArcadeChatActions(text, options = {}) {
    const actionResult = {
        handled: false,
        publishTagDetected: false,
        workshopPublishAttempted: false,
        workshopPublishSucceeded: false,
        workshopFileRewriteAttempted: false,
        workshopFileRewriteSucceeded: false,
        findTagDetected: false,
        feedback: ''
    };
    if (!text) return actionResult;

    // 1. [PUBLISH: {json}]
    const publishCmd = window.ArcadeCommandManager.getCommand('publish');
    if (publishCmd && typeof publishCmd.handleResponse === 'function') {
        const publishResult = await publishCmd.handleResponse(text, options);
        if (publishResult.publishTagDetected) {
            Object.assign(actionResult, publishResult);
            if (publishResult.handled) return actionResult;
        }
    }

    // 2. [COMPOSE: text]
    const composeMatch = text.match(/\[COMPOSE:\s*(.+?)\]/);
    if (composeMatch && isComposeDraftIntent(options.userPrompt || "")) {
        actionResult.handled = true;
        const composeText = composeMatch[1].trim();
        const messengerInput = document.getElementById('messageInput');
        if (messengerInput) {
            messengerInput.value = composeText;
            if (window.openMessengerDock) window.openMessengerDock();
            if (window.showFeedback) window.showFeedback("Pre-filled messenger for you.");
        }
    }

    // 3. [ARCADE: action]
    const arcadeMatch = text.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
        actionResult.handled = true;
        const action = arcadeMatch[1].trim().toLowerCase();
        if (typeof window.executeArcadeAction === 'function') {
            window.executeArcadeAction(action);
        }
    }

    // 4. [DUCKDUCKGO: query]
    const duckDuckGoMatch = text.match(/\[DUCKDUCKGO:\s*([^\]]+)\]/i);
    if (duckDuckGoMatch) {
        actionResult.handled = true;
        const query = duckDuckGoMatch[1].trim();
        if (query) {
            openDuckDuckGoSearch(query);
        }
    }

    // 5. [OPEN: url]
    const openMatch = text.match(/\[OPEN:\s*([^\]]+)\]/);
    if (openMatch) {
        actionResult.handled = true;
        const url = openMatch[1].trim();
        window.open(url, '_blank');
    }

    // 5.5 [FIND: query] - Surgical search and return
    const findMatch = text.match(/\[FIND:\s*([^\]]+)\]/i);
    if (findMatch && typeof window.handleAiSearchCommand === 'function') {
        actionResult.handled = true;
        actionResult.findTagDetected = true;
        const query = findMatch[1].trim();
        const searchResult = window.handleAiSearchCommand(query);
        
        if (searchResult && searchResult.ok) {
            actionResult.feedback = `[SYSTEM RETRIEVAL]: Found "${searchResult.match}" on line ${searchResult.line}. Context: \`${searchResult.match}\`. You may now apply an [EDIT] using this anchor.`;
        } else {
            actionResult.feedback = `[SYSTEM RETRIEVAL]: No matches found for "${query}" in the active editor. Check spelling or try a different keyword from the image.`;
        }
    }

    // 6. WORKSHOP ACTIONS (Re-enabled for Commands)
    const editCmd = window.ArcadeCommandManager.getCommand('edit');
    if (editCmd && typeof editCmd.handleResponse === 'function') {
        const editResult = await editCmd.handleResponse(text, options);
        if (editResult.handled) {
            Object.assign(actionResult, editResult);
            return actionResult;
        }
    }

    return actionResult;
}

async function tryApplyWorkshopRewriteFromReply(replyText, userPrompt = '', richContext = null, target = {}) {
    const result = { attempted: false, ok: false, reason: '', message: '' };
    if (!getWorkshop().isWorkshopRewriteIntentPrompt(userPrompt, richContext)
        && !getWorkshop().isWorkshopMultiFileEditPrompt(userPrompt, richContext)) return result;
    if (typeof window.getWorkshopFileContent !== 'function'
        || typeof window.internalApplyWorkshopFileEdit !== 'function') {
        result.reason = 'workshop-edit-functions-unavailable';
        return result;
    }

    const editorState = getActiveWorkshopEditorContext(richContext);
    const gameId = `${target.gameId || editorState?.activeGameId || ''}`.trim();
    const fileName = `${target.fileName || editorState?.activeFileName || ''}`.trim();
    if (!gameId || !fileName) {
        result.reason = 'no-active-editor-file';
        return result;
    }

    const oldContent = window.getWorkshopFileContent(gameId, fileName);
    if (typeof oldContent !== 'string' || !oldContent.trim()) {
        result.reason = 'active-file-content-unavailable';
        return result;
    }

    const generatedFiles = getWorkshop().buildFilesFromText(replyText);
    if (generatedFiles.length === 0) {
        result.reason = 'no-generated-code-blocks';
        return result;
    }

    const activeKind = getWorkshopFileKindFromName(fileName);
    const activeLower = fileName.toLowerCase();
    let generatedActiveFile = generatedFiles.find((file) => `${file.name || ''}`.toLowerCase() === activeLower)
        || generatedFiles.find((file) => getWorkshopFileKindFromName(file.name) === activeKind)
        || generatedFiles.find((file) => getWorkshop().inferCodeKind('', file.content) === activeKind);

    if (!generatedActiveFile?.content?.trim()) {
        result.reason = 'no-generated-active-file';
        return result;
    }

    let nextContent = decodeEscapedCodeText(generatedActiveFile.content).trim();
    if (activeKind === 'html') {
        nextContent = ensureHtmlReferencesWorkshopFiles(nextContent, generatedFiles, fileName);
    }

    if (!nextContent || nextContent === oldContent.trim()) {
        result.reason = 'rewrite-made-no-change';
        return result;
    }

    result.attempted = true;
    const extraFiles = generatedFiles.filter((file) => {
        const name = `${file?.name || ''}`.trim();
        return name && name.toLowerCase() !== fileName.toLowerCase() && `${file.content || ''}`.trim();
    });
    const applyResult = extraFiles.length > 0 && typeof window.addAiWorkshopFilesToGame === 'function'
        ? await window.addAiWorkshopFilesToGame(gameId, extraFiles, {
            activeFileName: fileName,
            activeFileType: getWorkshop().inferFileType(fileName),
            activeFileContent: nextContent
        })
        : await window.internalApplyWorkshopFileEdit(gameId, fileName, nextContent, { save: true });
    result.ok = !!applyResult?.ok;
    result.reason = result.ok ? '' : (applyResult?.message || 'rewrite-apply-failed');
    result.message = result.ok
        ? (extraFiles.length > 0
            ? `Rewrote ${fileName} and added ${extraFiles.length} file${extraFiles.length === 1 ? '' : 's'}.`
            : `Rewrote and saved ${fileName}.`)
        : result.reason;
    if (window.showFeedback) window.showFeedback(result.message, !result.ok);
    return result;
}

async function tryAutoWorkshopFileRewriteFromReply(replyText, userPrompt = '', richContext = null) {
    const result = { attempted: false, ok: false, reason: '' };
    if (!getWorkshop().isWorkshopEditIntentPrompt(userPrompt, richContext)) return result;
    if (typeof window.applyAiFilePatch !== 'function') {
        result.reason = 'patch-function-unavailable';
        return result;
    }

    const editorState = getActiveWorkshopEditorContext(richContext);
    const gameId = `${editorState?.activeGameId || ''}`.trim();
    const fileName = `${editorState?.activeFileName || ''}`.trim();
    if (!gameId || !fileName) {
        result.reason = 'no-active-editor-file';
        return result;
    }

    if (getWorkshop().isWorkshopRewriteIntentPrompt(userPrompt, richContext)
        || getWorkshop().isWorkshopMultiFileEditPrompt(userPrompt, richContext)) {
        const rewriteResult = await tryApplyWorkshopRewriteFromReply(replyText, userPrompt, richContext, { gameId, fileName });
        if (rewriteResult.attempted) {
            return {
                attempted: true,
                ok: rewriteResult.ok,
                reason: rewriteResult.reason || '',
                message: rewriteResult.message || ''
            };
        }
    }

    const editBlocks = extractWorkshopEditBlocks(replyText);
    if (editBlocks.length === 0) {
        const generatedPatchResult = await tryApplyGeneratedWorkshopPatchFromReply(replyText, userPrompt, richContext, { gameId, fileName });
        if (generatedPatchResult.attempted) {
            return {
                attempted: true,
                ok: generatedPatchResult.ok,
                reason: generatedPatchResult.reason || '',
                message: generatedPatchResult.message || ''
            };
        }

        result.reason = generatedPatchResult.reason || 'no-edit-blocks';
        if (window.showFeedback && getWorkshop().looksLikeExecutableCode(replyText)) {
            window.showFeedback('AI returned code, but it was not safe to apply as a targeted Workshop edit.', true);
        }
        return result;
    }

    for (const editBlock of editBlocks) {
        result.attempted = true;
        const patchResult = await window.applyAiFilePatch(gameId, fileName, editBlock.search, editBlock.replace, { save: true });
        if (!patchResult?.ok) {
            result.reason = patchResult?.message || 'patch-failed';
            if (window.showFeedback) window.showFeedback(result.reason, true);
            return result;
        }
    }

    result.ok = true;
    return result;
}

function isUnhelpfulWorkshopEditReply(replyText = '') {
    const text = `${replyText || ''}`.trim().toLowerCase();
    if (!text) return true;
    return text.includes('logic core returned an empty result')
        || text.includes('empty edit response')
        || text.includes('please provide the source')
        || text.includes('please provide the content')
        || text.includes('please paste the code')
        || text.includes('actual source code')
        || text.includes('specific file you would like me to edit')
        || text.includes('which file contains')
        || text.includes('i still require the source')
        || text.includes('i do not have the current code');
}


function isWorkshopStyleRevertPrompt(prompt = '') {
    return /\b(revert|undo|remove|delete|back out)\b/i.test(`${prompt || ''}`)
        && /\b(style|styles|css|design|visual|ai style enhancement)\b/i.test(`${prompt || ''}`);
}

function buildLocalStyleEnhancementCss() {
    return `/* AI style enhancement */
:root {
  color-scheme: dark;
  --ai-accent: #62c8ff;
  --ai-accent-strong: #8be26b;
  --ai-panel: rgba(8, 18, 30, 0.82);
}

body {
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(98, 200, 255, 0.28), transparent 34rem),
    linear-gradient(135deg, #08121e 0%, #152943 55%, #07111d 100%);
  color: #f3f8ff;
  font-family: "Segoe UI", system-ui, sans-serif;
}

main,
.game,
.container,
.app,
#app {
  background: var(--ai-panel);
  border: 1px solid rgba(98, 200, 255, 0.24);
  border-radius: 18px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.35);
}

button,
input,
select {
  border-radius: 12px;
}

button {
  border: 0;
  background: linear-gradient(135deg, var(--ai-accent), var(--ai-accent-strong));
  color: #04101c;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(98, 200, 255, 0.24);
  cursor: pointer;
}

button:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}`;
}

function upsertLocalStyleEnhancement(content = '', fileName = '') {
    const css = buildLocalStyleEnhancementCss();
    const lowerName = `${fileName || ''}`.toLowerCase();
    if (/\.css$/i.test(lowerName)) {
        const withoutOld = `${content || ''}`.replace(/\/\* AI style enhancement \*\/[\s\S]*$/i, '').trimEnd();
        return `${withoutOld}\n\n${css}\n`;
    }

    const styleBlock = `<style id="ai-style-enhancement">\n${css}\n</style>`;
    const withoutOld = `${content || ''}`.replace(/\n?\s*<style\s+id=["']ai-style-enhancement["'][\s\S]*?<\/style>\s*/i, '\n');
    if (/<\/head>/i.test(withoutOld)) {
        return withoutOld.replace(/<\/head>/i, `  ${styleBlock}\n</head>`);
    }
    return `${styleBlock}\n${withoutOld}`;
}

function removeLocalStyleEnhancement(content = '') {
    return removeGeneratedWorkshopStylePatch(`${content || ''}`)
        .replace(/\/\* AI style enhancement \*\/[\s\S]*$/i, '')
        .replace(/\n?\s*<style\s+id=["']ai-style-enhancement["'][\s\S]*?<\/style>\s*/gi, '\n')
        .trimEnd();
}

async function tryLocalWorkshopStyleFallback(userPrompt = '', richContext = null) {
    const result = { attempted: false, ok: false, message: '' };
    if (!getWorkshop().isStyleEditPrompt(userPrompt)) return result;
    if (typeof window.internalApplyWorkshopFileEdit !== 'function') {
        result.message = 'Workshop edit function is unavailable.';
        return result;
    }

    const editorState = getActiveWorkshopEditorContext(richContext);
    const gameId = `${editorState?.activeGameId || ''}`.trim();
    const fileName = `${editorState?.activeFileName || ''}`.trim();
    const oldContent = typeof window.getWorkshopFileContent === 'function'
        ? window.getWorkshopFileContent(gameId, fileName)
        : editorState?.activeFileContent;

    if (!gameId || !fileName || typeof oldContent !== 'string' || !oldContent.trim()) {
        result.message = 'No active Workshop file content is available.';
        return result;
    }

    result.attempted = true;
    const nextContent = upsertLocalStyleEnhancement(oldContent, fileName);
    const applyResult = await window.internalApplyWorkshopFileEdit(gameId, fileName, nextContent, { save: true });
    if (!applyResult?.ok) {
        result.message = applyResult?.message || 'Local style fallback failed.';
        return result;
    }

    result.ok = true;
    result.message = `Applied a local style enhancement to ${fileName}.`;
    return result;
}

async function tryRevertLocalWorkshopStyleEnhancement() {
    const result = { attempted: false, ok: false, count: 0, message: '' };
    if (typeof window.internalApplyWorkshopFileEdit !== 'function'
        || typeof window.getWorkshopFileContent !== 'function') {
        result.message = 'Workshop edit functions are unavailable.';
        return result;
    }

    const targets = [];
    const activeEditor = getActiveWorkshopEditorContext();
    if (activeEditor?.activeGameId && activeEditor?.activeFileName) {
        targets.push({ gameId: activeEditor.activeGameId, fileName: activeEditor.activeFileName });
    }

    if (typeof window.getWorkshopManageableGames === 'function') {
        const games = window.getWorkshopManageableGames();
        if (Array.isArray(games)) {
            for (const game of games) {
                const files = Array.isArray(game?.files) ? game.files : [];
                for (const file of files) {
                    const fileName = `${file?.name || ''}`.trim();
                    if (!fileName || !/\.(html?|css)$/i.test(fileName)) continue;
                    targets.push({ gameId: game.id, fileName });
                }
            }
        }
    }

    const seen = new Set();
    for (const target of targets) {
        const key = `${target.gameId}::${target.fileName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const oldContent = window.getWorkshopFileContent(target.gameId, target.fileName);
        if (typeof oldContent !== 'string' || !oldContent.trim()) continue;

        const nextContent = removeLocalStyleEnhancement(oldContent);
        if (nextContent === oldContent) continue;

        result.attempted = true;
        const applyResult = await window.internalApplyWorkshopFileEdit(target.gameId, target.fileName, nextContent, { save: true, silent: true });
        if (applyResult?.ok) {
            result.count += 1;
        } else {
            result.message = applyResult?.message || `Failed to revert ${target.fileName}.`;
            return result;
        }
    }

    result.ok = result.count > 0;
    result.message = result.ok
        ? `Reverted AI style enhancement in ${result.count} file${result.count === 1 ? '' : 's'}.`
        : 'No AI style enhancement block was found to revert.';
    return result;
}

async function handleArcadeSlashCommand(text, inputElement) {
    if (typeof window.ArcadeCommandManager !== 'undefined') {
        return await window.ArcadeCommandManager.handle(text, inputElement);
    }
    return false;
}

async function tryAutoPublishWorkshopFromReply(replyText, userPrompt = '') {
    const result = {
        attempted: false,
        ok: false,
        reason: ''
    };
    if (!getWorkshop().isWorkshopPublishIntentPrompt(userPrompt)) return result;
    if (extractBalancedJsonTagPayload(replyText, 'PUBLISH')) return result;
    if (typeof window.publishCustomGameFromAi !== 'function') {
        result.reason = 'publish-function-unavailable';
        return result;
    }

    const files = getWorkshop().buildPublishFiles({}, replyText);
    if (files.length === 0) {
        result.reason = 'no-files';
        return result;
    }

    result.attempted = true;
    const publishPayload = {
        target: 'workshop',
        title: inferWorkshopTitleFromPrompt(userPrompt),
        category: 'GAME',
        tags: 'arcade, ai',
        description: 'AI-generated workshop game',
        files
    };
    const publishResult = await window.publishCustomGameFromAi(publishPayload);
    if (!publishResult?.ok) {
        result.reason = publishResult?.error || 'publish-failed';
        if (window.showFeedback) {
            window.showFeedback(`❌ Auto-Publish: ${publishResult?.message || 'Failed to extract code'}`, true);
        }
        return result;
    }

    result.ok = true;
    if (window.showFeedback) {
        const actionLabel = publishResult.updated ? 'Updated' : 'Published';
        window.showFeedback(`${actionLabel} "${publishResult.title}" in Workshop (${publishResult.assetCount} assets).`);
    }
    return result;
}

function buildEmergencyWorkshopPublishPayload(userPrompt = '') {
    const inferredTitle = inferWorkshopTitleFromPrompt(userPrompt);
    const title = `${inferredTitle || 'AI Workshop Game'}`.replace(/[<>]/g, '').trim().slice(0, 72) || 'AI Workshop Game';
    const description = 'Emergency local publish fallback: generated when remote AI routing is unavailable.';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="game-shell">
    <header class="top-bar">
      <h1>${title}</h1>
      <p>Tap targets fast. Misses cost time.</p>
    </header>
    <section class="hud">
      <div><span>Score</span><strong id="score">0</strong></div>
      <div><span>Time</span><strong id="time">30</strong></div>
      <button id="startBtn" type="button">Start</button>
    </section>
    <section id="arena" class="arena" aria-label="Game arena">
      <button id="target" type="button" class="target" aria-label="Target"></button>
      <div id="message" class="message">Press Start</div>
    </section>
  </main>
  <script src="game.js"></script>
</body>
</html>`;

    const css = `:root{
  color-scheme: dark;
  --bg:#0b1220;
  --panel:#13243b;
  --accent:#66c0f4;
  --good:#a4d007;
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  background:radial-gradient(circle at 10% 10%,#1a2f4e 0%,var(--bg) 60%);
  color:#e9f3ff;
  font-family:"Segoe UI",Tahoma,sans-serif;
}
.game-shell{max-width:900px;margin:0 auto;padding:20px;display:grid;gap:14px}
.top-bar h1{margin:0 0 6px;font-size:1.4rem}
.top-bar p{margin:0;color:rgba(233,243,255,.75)}
.hud{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  background:var(--panel);border:1px solid rgba(102,192,244,.25);padding:10px 12px;border-radius:10px
}
.hud div{display:flex;align-items:baseline;gap:8px}
.hud span{opacity:.75;font-size:.85rem}
.hud strong{font-size:1.2rem}
#startBtn{
  margin-left:auto;border:0;border-radius:8px;padding:10px 16px;
  background:linear-gradient(135deg,var(--accent),#4ea8d9);
  color:#00131f;font-weight:700;cursor:pointer
}
.arena{
  position:relative;height:62vh;min-height:380px;max-height:640px;
  background:linear-gradient(180deg,#0e1b2f,#0a1423);
  border:1px solid rgba(102,192,244,.2);border-radius:14px;overflow:hidden;
}
.target{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.7);
  background:radial-gradient(circle at 30% 30%,#9ce6ff 0%,#53b3e0 55%,#1f5a7b 100%);
  box-shadow:0 0 22px rgba(102,192,244,.65);cursor:pointer;display:none
}
.message{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  font-weight:700;color:rgba(233,243,255,.8);text-align:center;padding:8px 12px
}
@media (max-width:640px){
  .arena{height:54vh;min-height:320px}
  .target{width:56px;height:56px}
}`;

    const js = `(() => {
  const arena = document.getElementById('arena');
  const target = document.getElementById('target');
  const scoreEl = document.getElementById('score');
  const timeEl = document.getElementById('time');
  const messageEl = document.getElementById('message');
  const startBtn = document.getElementById('startBtn');

  let score = 0;
  let timeLeft = 30;
  let running = false;
  let tickTimer = null;
  let relocateTimer = null;

  function setMessage(text){ messageEl.textContent = text || ''; }
  function clamp(value, min, max){ return Math.min(max, Math.max(min, value)); }
  function updateHud(){ scoreEl.textContent = String(score); timeEl.textContent = String(timeLeft); }

  function placeTarget() {
    const rect = arena.getBoundingClientRect();
    const pad = 36;
    const x = Math.random() * (rect.width - pad * 2) + pad;
    const y = Math.random() * (rect.height - pad * 2) + pad;
    target.style.left = x + 'px';
    target.style.top = y + 'px';
  }

  function stopGame() {
    running = false;
    target.style.display = 'none';
    clearInterval(tickTimer); tickTimer = null;
    clearInterval(relocateTimer); relocateTimer = null;
    setMessage('Round complete. Final score: ' + score);
    startBtn.disabled = false;
  }

  function startGame() {
    if (running) return;
    running = true;
    score = 0;
    timeLeft = 30;
    updateHud();
    startBtn.disabled = true;
    setMessage('');
    target.style.display = 'block';
    placeTarget();

    tickTimer = setInterval(() => {
      timeLeft -= 1;
      updateHud();
      if (timeLeft <= 0) stopGame();
    }, 1000);

    relocateTimer = setInterval(() => {
      if (!running) return;
      placeTarget();
    }, 900);
  }

  target.addEventListener('click', () => {
    if (!running) return;
    score += 1;
    timeLeft = clamp(timeLeft + 1, 0, 45);
    updateHud();
    placeTarget();
  });

  arena.addEventListener('click', (event) => {
    if (!running) return;
    if (event.target === target) return;
    timeLeft = clamp(timeLeft - 1, 0, 45);
    updateHud();
    if (timeLeft <= 0) stopGame();
  });

  startBtn.addEventListener('click', startGame);
  updateHud();
})();`;

    return {
        title,
        description,
        files: [
            { name: 'index.html', type: 'text/html', content: html },
            { name: 'styles.css', type: 'text/css', content: css },
            { name: 'game.js', type: 'text/javascript', content: js }
        ]
    };
}

async function tryEmergencyWorkshopPublishFromPrompt(userPrompt = '', reason = '') {
    const result = { attempted: false, ok: false, reason: '', title: '', assetCount: 0 };
    if (!getWorkshop().isWorkshopPublishIntentPrompt(userPrompt)) return result;
    result.attempted = true;
    if (typeof window.publishCustomGameFromAi !== 'function') {
        const source = captureClientSourceLocation();
        result.reason = source
            ? `publish-function-unavailable@${source}`
            : 'publish-function-unavailable';
        return result;
    }

    const payload = buildEmergencyWorkshopPublishPayload(userPrompt);
    const publishResult = await window.publishCustomGameFromAi({
        target: 'workshop',
        title: payload.title,
        category: 'GAME',
        description: `${payload.description}${reason ? ` (${reason})` : ''}`,
        tags: 'arcade, ai, fallback',
        files: payload.files
    });

    if (!publishResult?.ok) {
        result.reason = publishResult?.error || 'publish-failed';
        return result;
    }

    result.ok = true;
    result.title = publishResult.title || payload.title;
    result.assetCount = Number(publishResult.assetCount || payload.files.length) || payload.files.length;
    return result;
}

window.startNewChat = startNewChat;

function setupResizing() {
    const handle = document.getElementById('chat-resize-handle');
    const sidebar = document.querySelector('.steam-chat-sidebar');
    const shell = document.querySelector('.steam-shell') || document.querySelector('.page-shell');
    let isResizing = false;
    let activePointerId = null;

    if (!handle || !sidebar || !shell) return;

    const endResize = () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
        if (activePointerId !== null && typeof handle.releasePointerCapture === 'function') {
            try {
                handle.releasePointerCapture(activePointerId);
            } catch (_error) {
                // Ignore capture release failures.
            }
        }
        activePointerId = null;
    };

    const onPointerMove = (event) => {
        if (!isResizing) return;
        if (activePointerId !== null && event.pointerId !== activePointerId) return;
        // Mouse safety: if button is no longer held, stop immediately.
        if (event.pointerType === 'mouse' && typeof event.buttons === 'number' && event.buttons === 0) {
            endResize();
            return;
        }
        handleResize(event.clientX);
        if (event.cancelable) event.preventDefault();
    };

    const onPointerUp = (event) => {
        if (activePointerId !== null && event.pointerId !== activePointerId) return;
        endResize();
    };

    const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        if (handle.classList.contains('collapsed')) return;

        isResizing = true;
        activePointerId = event.pointerId ?? null;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        if (activePointerId !== null && typeof handle.setPointerCapture === 'function') {
            try {
                handle.setPointerCapture(activePointerId);
            } catch (_error) {
                // Ignore capture failures.
            }
        }

        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
        if (event.cancelable) event.preventDefault();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', endResize);

    function handleResize(clientX) {
        if (!clientX || clientX <= 0) return;

        const isFixed = window.getComputedStyle(sidebar).position === 'fixed';

        if (!isFixed && shell && shell.classList.contains('steam-shell') && isDesktopCompanionLayout()) {
            const shellRect = shell.getBoundingClientRect();
            const requestedSidebarWidth = shellRect.right - clientX;
            const clampedSidebarWidth = clampSteamSidebarWidth(requestedSidebarWidth, shell);

            applySteamShellOpenColumns(shell, clampedSidebarWidth);
            localStorage.setItem(ARCADE_CHAT_SIDEBAR_WIDTH_KEY, `${Math.round(clampedSidebarWidth)}`);
        } else {
            let newWidth = window.innerWidth - clientX;
            // Fixed/floating layout clamp: at most 60% of viewport to keep content usable.
            newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, Math.round(window.innerWidth * 0.6)));
            sidebar.style.width = `${newWidth}px`;
            if (isFixed && handle) {
                handle.style.right = `${newWidth}px`;
            }
            localStorage.setItem(ARCADE_CHAT_SIDEBAR_WIDTH_KEY, `${Math.round(newWidth)}`);
        }

        if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
    }

    handle.addEventListener('dblclick', () => {
        if (!shell || !shell.classList.contains('steam-shell') || !isDesktopCompanionLayout()) return;
        const resetWidth = clampSteamSidebarWidth(DEFAULT_SIDEBAR_WIDTH, shell);
        applySteamShellOpenColumns(shell, resetWidth);
        localStorage.setItem(ARCADE_CHAT_SIDEBAR_WIDTH_KEY, `${Math.round(resetWidth)}`);
        if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
    });
}


window.toggleChat = function () {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    const handle = document.querySelector('.chat-resize-handle');
    const shell = document.querySelector('.steam-shell');

    if (!sidebar) return;

    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('chat-collapsed', isCollapsed);

    // Randomize placeholder when opening
    if (!isCollapsed) {
        updateChatPlaceholder();
        if (typeof pollDesktopBridge === 'function') {
            pollDesktopBridge();
        }
    }

    // Update grid if in integrated desktop mode
    if (shell && isDesktopCompanionLayout()) {
        if (isCollapsed) {
            applySteamShellCollapsedColumns(shell);
        } else {
            applySteamShellOpenColumns(shell, getStoredSteamSidebarWidth(shell));
        }
    }

    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const messengerBtn = document.querySelector('.messenger-launcher');
    const messengerSection = document.querySelector('.messenger-section');

    if (toggleBtn) toggleBtn.style.right = '';
    if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
    if (messengerSection) messengerSection.style.setProperty('right', '', '');

    if (handle) handle.classList.toggle('collapsed', isCollapsed);

    localStorage.setItem('arcade-chat-collapsed', isCollapsed);
};

function isChatOpen() {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    if (!sidebar) return false;
    return !sidebar.classList.contains('collapsed');
}

window.closeArcadeChat = function (options = {}) {
    const { restoreFocus = true } = options;
    if (!isChatOpen()) return false;
    window.toggleChat();
    if (restoreFocus) {
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        if (toggleBtn instanceof HTMLElement) toggleBtn.focus();
    }
    return true;
};


function setupToggle() {
    // Create toggle button regardless of mode, CSS will handle visibility
    if (!document.querySelector('.chat-toggle-btn')) {
        const btn = document.createElement('button');

        // Unified Tab Mode for all pages
        btn.className = 'chat-toggle-btn chat-tab-mode';
        btn.innerHTML = `
            <div class="tab-label" style="writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.7rem; font-weight: 800; letter-spacing: 2px; color: var(--arc-accent); text-transform: uppercase; pointer-events: none; margin-bottom: 12px; font-family: 'Inter', system-ui, sans-serif;">Companion</div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="color: var(--arc-accent); pointer-events: none;">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"></path>
            </svg>
        `;

        btn.onclick = window.toggleChat;
        document.body.appendChild(btn);
    }
}

function setupCloseParityHandlers() {
    const isMiniGamesPage = window.location.pathname.toLowerCase().includes('mini-games');
    if (!isMiniGamesPage) return;

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!isChatOpen()) return;
        window.closeArcadeChat({ restoreFocus: true });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isChatOpen()) return;

        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const sidebar = document.querySelector('.steam-chat-sidebar');
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        if (!sidebar) return;
        if (sidebar.contains(target)) return;
        if (toggleBtn && toggleBtn.contains(target)) return;

        const isOverlayMode = window.matchMedia('(max-width: 768px)').matches || document.documentElement.classList.contains('platform-android');
        if (!isOverlayMode) return;

        window.closeArcadeChat({ restoreFocus: false });
    });
}

// Initialization - Runs after all functions are defined
(function initChat() {
    cleanupOldChats();
    const lastChatId = localStorage.getItem('arcade-last-chat-id');
    if (lastChatId && window.loadChat) {
        window.loadChat(lastChatId);
    } else {
        startNewChat();
    }
    setupResizing();
    setupToggle();
    setupCloseParityHandlers();
    setupChatModelSelect();
    startDesktopBridgePolling();
    updateChatStatus('idle');

    // Restore collapsed state
    const isSteamShell = document.querySelector('.steam-shell') || document.documentElement.classList.contains('is-steam-shell');
    const isAndroidPlatform = document.documentElement.classList.contains('platform-android');
    let wasCollapsed = localStorage.getItem('arcade-chat-collapsed');

    // Default to collapsed (tab mode) on steam-shell pages if no preference exists
    if (wasCollapsed === null && isSteamShell) {
        wasCollapsed = 'true';
    } else {
        wasCollapsed = wasCollapsed === 'true';
    }

    // Keep Android steam-shell pages in tab-open mode by default so content always fits.
    if (isSteamShell && isAndroidPlatform) {
        wasCollapsed = true;
    }

    if (wasCollapsed) {
        const sidebar = document.querySelector('.steam-chat-sidebar');
        const handle = document.querySelector('.chat-resize-handle');
        const shell = document.querySelector('.steam-shell');

        if (sidebar) sidebar.classList.add('collapsed');
        if (handle) handle.classList.add('collapsed');
        document.body.classList.add('chat-collapsed');

        if (shell && isDesktopCompanionLayout()) {
            applySteamShellCollapsedColumns(shell);
        }
    } else {
        const shell = document.querySelector('.steam-shell');
        if (shell && isDesktopCompanionLayout()) {
            applySteamShellOpenColumns(shell, getStoredSteamSidebarWidth(shell));
            if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
        }
        updateChatPlaceholder();
    }

    window.addEventListener('resize', () => {
        const shell = document.querySelector('.steam-shell');
        const sidebar = document.querySelector('.steam-chat-sidebar');
        if (!shell || !sidebar || !shell.classList.contains('steam-shell')) return;
        if (!isDesktopCompanionLayout()) return;
        if (sidebar.classList.contains('collapsed')) return;

        const width = getStoredSteamSidebarWidth(shell);
        applySteamShellOpenColumns(shell, width);
        if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
    }, { passive: true });

    // Ensure Enter key sends the message
    const arcInput = document.getElementById('arc-chat-input');
    const arcSendBtn = getChatSendButton();

    setChatSendButtonMode('send');

    let selectedSuggestionIndex = -1;
    let filteredCommands = [];

    function updateCommandSuggestions() {
        const input = document.getElementById('arc-chat-input');
        const panel = document.getElementById('chat-command-suggestions');
        if (!input || !panel) return;

        const val = input.value;
        if (!val.startsWith('/')) {
            panel.hidden = true;
            selectedSuggestionIndex = -1;
            return;
        }

        filteredCommands = window.ArcadeCommandManager ? window.ArcadeCommandManager.getSuggestions(val) : [];

        if (filteredCommands.length > 0) {
            if (selectedSuggestionIndex >= filteredCommands.length) {
                selectedSuggestionIndex = filteredCommands.length - 1;
            }
            renderSuggestions(filteredCommands);
            panel.hidden = false;
        } else {
            panel.hidden = true;
            selectedSuggestionIndex = -1;
        }
    }

    function renderSuggestions(cmds) {
        const panel = document.getElementById('chat-command-suggestions');
        if (!panel) return;

        panel.innerHTML = cmds.map((c, i) => `
            <div class="command-suggestion-item ${i === selectedSuggestionIndex ? 'selected' : ''}" 
                 onclick="applyCommandSuggestion('${c.id}', ${c.isTopLevel || false}, '${c.commandId || ''}')">
                <div class="command-suggestion-name">${c.name || `/${c.id}`}</div>
                <div class="command-suggestion-desc">${c.description}</div>
            </div>
        `).join('');

        const selected = panel.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    window.applyCommandSuggestion = function(id, isTopLevel, commandId) {
        const input = document.getElementById('arc-chat-input');
        const panel = document.getElementById('chat-command-suggestions');
        if (!input) return;

        if (isTopLevel) {
            input.value = `/${id} `;
        } else {
            input.value = `/${commandId} ${id} `;
        }
        
        input.focus();
        updateCommandSuggestions();
    };

    if (arcInput) {
        arcInput.addEventListener('input', updateCommandSuggestions);

        arcInput.addEventListener('keydown', (event) => {
            const panel = document.getElementById('chat-command-suggestions');
            const isPanelOpen = panel && !panel.hidden;

            if (event.key === 'Enter') {
                if (isPanelOpen && selectedSuggestionIndex >= 0) {
                    event.preventDefault();
                    const sug = filteredCommands[selectedSuggestionIndex];
                    applyCommandSuggestion(sug.id, sug.isTopLevel, sug.commandId);
                } else {
                    event.preventDefault();
                    isVoiceSessionActive = false;
                    sendChatMessage();
                    if (panel) panel.hidden = true;
                }
            } else if (event.key === 'ArrowDown' && isPanelOpen) {
                event.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex + 1) % filteredCommands.length;
                renderSuggestions(filteredCommands);
            } else if (event.key === 'ArrowUp' && isPanelOpen) {
                event.preventDefault();
                selectedSuggestionIndex = (selectedSuggestionIndex - 1 + filteredCommands.length) % filteredCommands.length;
                renderSuggestions(filteredCommands);
            } else if (event.key === 'Escape' && isPanelOpen) {
                panel.hidden = true;
                selectedSuggestionIndex = -1;
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('chat-command-suggestions');
            if (panel && !panel.contains(e.target) && e.target !== arcInput) {
                panel.hidden = true;
            }
        });
    }

    if (arcSendBtn) {
        let holdTimer = null;
        const HOLD_THRESHOLD = 400;
        let speechPrimed = false;

        arcSendBtn.addEventListener('pointerdown', (e) => {
            if (isSendingChatMessage) return;

            // Prime the speech engine on the very first interaction (Required for Android)
            if (!speechPrimed && arcadeSpeechSynth) {
                try {
                    const silent = new SpeechSynthesisUtterance("");
                    silent.volume = 0;
                    arcadeSpeechSynth.speak(silent);
                    speechPrimed = true;
                    console.log("[Voice] Speech engine primed for Android.");
                } catch (e) { }
            }

            holdTimer = setTimeout(() => {
                startArcadeDictation();
                holdTimer = null;
            }, HOLD_THRESHOLD);
        });

        window.addEventListener('pointerup', (e) => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
                // Short click -> Regular send
                isVoiceSessionActive = false;
                sendChatMessage();
            } else if (isArcadeDictating) {
                // Long hold release -> Stop and send
                stopArcadeDictation();
                setTimeout(() => sendChatMessage(), 100);
            }
        });
    }
})();

/**
 * Provides arcade-themed responses when the backend is unreachable.
 */
function getArcadeProtocolOfflineResponse(message) {
    const input = message.toLowerCase();

    const responses = [
        {
            keywords: ["pinball", "gravity"],
            answer: "🕹️ [Arcade Protocol]: In Neon Pinball, keep your eyes on the top bumpers. Hitting them in sequence triggers the 'Gravity Shift' multiplier, which can triple your score in seconds!"
        },
        {
            keywords: ["basketball", "hoops", "shot"],
            answer: "🏀 [Arcade Protocol]: For Neon Hoops, consistency is key. Try to release the ball at the peak of your swipe for a 'Perfect' shot bonus. The net gets smaller as your streak increases!"
        },
        {
            keywords: ["snake", "wrap", "trap"],
            answer: "🐍 [Arcade Protocol]: In Neon Snake, the board is edge-wrapped. If you're about to crash, move through the wall to appear on the other side. Use this to surprise high-value fruit!"
        },
        {
            keywords: ["hello", "hi", "hey"],
            answer: "👋 [Arcade Protocol]: Intelligence core is currently offline, but I am standing by for tactical support. Ask me about the games or how to improve your high score!"
        },
        {
            keywords: ["help", "what can you do"],
            answer: "🎮 [Arcade Protocol]: I am your tactical game assistant. Even in offline mode, I can provide tips for Pinball, Hoops, and Snake. Just ask about a specific game!"
        },
        {
            keywords: ["thank", "thanks"],
            answer: "🕹️ [Arcade Protocol]: You're welcome, player. Now get back in there and break that record!"
        }
    ];

    for (const r of responses) {
        if (r.keywords.some(k => input.includes(k))) return r.answer;
    }

    const fallbacks = [
        "📶 [Arcade Protocol]: My advanced logic core is currently out of range. Check if your Arcade Companion bridge is running on your PC!",
        "📡 [Arcade Protocol]: Communication with the main intelligence core is unstable. Ensure the bridge server is active and try again.",
        "🕹️ [Arcade Protocol]: Sync failed. I'm relying on cached arcade data. If you're on a real device, check your bridge IP settings!",
        "🎮 [Arcade Protocol]: My logic processors are running local-only. (Bridge unreachable). I can still help with game tips though!"
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}
