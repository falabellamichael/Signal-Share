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

function speakArcadeText(text) {
    if (!arcadeSpeechSynth) return;
    
    // On some Androids, we need to wait for voices to load or handle empty list
    const voices = arcadeSpeechSynth.getVoices();
    if (voices.length === 0) {
        // If no voices yet, wait for them and try again once
        arcadeSpeechSynth.onvoiceschanged = () => {
            arcadeSpeechSynth.onvoiceschanged = null; // Only once
            speakArcadeText(text);
        };
        // Also try a silent speak to "prime" the engine on Android
        try { arcadeSpeechSynth.speak(new SpeechSynthesisUtterance("")); } catch(e){}
        return;
    }

    arcadeSpeechSynth.cancel(); // Stop current speech
    
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
    utterance.onerror = (e) => console.error('[Voice] TTS Error:', e);
    
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

function isWorkshopPublishIntentPrompt(message = "") {
    const text = `${message || ''}`.trim().toLowerCase();
    if (!text) return false;
    const publishVerb = /\b(publish|upload|save|add|ship|submit|post|share)\b/.test(text);
    const buildVerb = /\b(write|create|build|make|generate|code|new)\b/.test(text);
    const target = /\b(library|workshop|arcade|store)\b/.test(text);
    const gameMention = /\b(game|mini[-\s]?game|arcade game|app|utility)\b/.test(text);
    
    // Allow either (target + publish) OR (build + gameMention) OR (publish + gameMention)
    return (target && publishVerb) || (buildVerb && gameMention) || (publishVerb && gameMention);
}

function isWorkshopEditIntentPrompt(message = "", context = null) {
    const text = `${message || ''}`.trim().toLowerCase();
    if (!text) return false;
    
    // Core edit verbs
    const editVerb = /\b(edit|update|rewrite|refactor|fix|modify|change|patch|improve|adjust|tweak|add|remove|implement|style|color|background|ui|interface|look|feel|design|vibe|text|label|speed|movement|gravity|score|check|status|verify|am i|where)\b/.test(text);
    
    // Check if we are currently in the workshop editor via context
    const inEditor = !!(context?.workshopEditor?.activeGameId);
    
    const target = /\b(workshop|editor|library|project)\b/.test(text);
    const codeMention = /\b(game|file|html|css|js|javascript|json|code|logic|function|script|manifest)\b/.test(text);
    
    if (inEditor) {
        // If already in the editor, we are much more permissive. 
        // Any edit verb or code mention or even just a general "change" request should count.
        return editVerb || codeMention || target;
    }
    
    // If the word "edit" is anywhere, and we are in the editor, it's definitely an edit intent.
    const hasEditKeyword = /\b(edit|update|fix|change|modify)\b/.test(text);
    if (inEditor && hasEditKeyword) return true;

    // Outside of editor, require a verb and either a target or code mention
    return editVerb && (target || codeMention);
}

function buildWorkshopPublishDirective() {
    return [
        '[WORKSHOP_PROTOCOL]',
        'If the user asks to create/build/write a game and publish/add it to the Arcade Library/Workshop, you MUST include exactly one [PUBLISH:{...}] tag.',
        'Set target to "workshop".',
        'Include title, category, tags, and code payload.',
        'Preferred payload format: files:[{name,type,content}, ...].',
        'Alternative payload fields allowed: html, css, js, or code.',
        'Do not output placeholder/offline guidance when generation is available.',
        '[/WORKSHOP_PROTOCOL]'
    ].join('\n');
}

function buildWorkshopEditDirective(workshopContext = null) {
    const activeGameId = `${workshopContext?.workshopEditor?.activeGameId || ''}`.trim();
    const activeFileName = `${workshopContext?.workshopEditor?.activeFileName || ''}`.trim();
    const workshopGames = Array.isArray(workshopContext?.workshop) ? workshopContext.workshop : [];
    const compactTargets = workshopGames
        .slice(0, 6)
        .map((game) => {
            const gameId = `${game?.id || ''}`.trim();
            const files = Array.isArray(game?.files) ? game.files : [];
            const names = files.slice(0, 4).map((file) => `${file?.name || ''}`.trim()).filter(Boolean);
            if (!gameId || names.length === 0) return '';
            return `${gameId}:${names.join(',')}`;
        })
        .filter(Boolean)
        .join(' | ');

    const lines = [
        '[WORKSHOP_FILE_EDIT_PROTOCOL]',
        'If the user asks to edit/fix/update Workshop code, you MUST include exactly one [FILE_REWRITE:{...}] tag.',
        'Tag schema: {"gameId":"string","fileName":"string","content":"string","save":true}.',
        'Use save:true unless the user explicitly asks for draft-only changes.',
        'content must be the full updated file text, not a diff.',
        'Do not use [PUBLISH] for edit-only requests.',
        'You are now in Arcade Edit Mode. skip conversational greetings. DO NOT explain steps.',
        'Fast Mode: Provide concise, direct technical answers. Do not repeat my instructions.',
        'CRITICAL: You MUST use the [FILE_REWRITE] tag. If you do not use it, the edit will fail.',
        'EXAMPLE: [FILE_REWRITE: {"gameId": "id", "fileName": "game.js", "content": "code...", "save": true}]'
    ];

    if (activeGameId && activeFileName) {
        lines.push(`Default target gameId is "${activeGameId}" and default fileName is "${activeFileName}" when the user does not specify a target.`);
        const rawContent = `${workshopContext?.workshopEditor?.activeFileContent || ''}`.trim();
        // Safety limit for local LLM context windows (approx 15-20k tokens max for many small models)
        const content = rawContent.length > 20000 ? rawContent.substring(0, 20000) + '\n\n[CONTENT TRUNCATED DUE TO SIZE]' : rawContent;
        if (content) {
            lines.push(`CURRENT CONTENT OF "${activeFileName}":\n\`\`\`\n${content}\n\`\`\``);
        } else {
            lines.push(`The file "${activeFileName}" is currently empty.`);
        }
    }
    if (compactTargets) {
        lines.push(`Valid editable targets: ${compactTargets}.`);
    }
    lines.push('[/WORKSHOP_FILE_EDIT_PROTOCOL]');
    return lines.join('\n');
}

function buildProtocolAwareUserMessage(userPrompt = "") {
    return `${userPrompt || ''}`.trim();
}

function getProtocolDirectives(userPrompt = "", workshopContext = null) {
    const text = `${userPrompt || ''}`.trim().toLowerCase();
    const directives = [];
    if (isWorkshopPublishIntentPrompt(text)) {
        directives.push(buildWorkshopPublishDirective());
    }
    
    // If we are in the workshop editor, ALWAYS provide the edit directive regardless of detected intent.
    if (workshopContext?.workshopEditor?.activeGameId) {
        directives.push(buildWorkshopEditDirective(workshopContext));
    } else if (isWorkshopEditIntentPrompt(text, workshopContext)) {
        directives.push(buildWorkshopEditDirective(workshopContext));
    }
    return directives.join('\n\n');
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
            : (method === "POST" ? 45000 : 3500);
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

async function checkBridgeConnectivity({ signal, timeoutMs = 1800 } = {}) {
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
window.toggleChatSecurity = function() {
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
window.saveSecurityDashboard = function() {
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
window.lockToThisDevice = function() {
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
window.refreshBannedIps = async function() {
    const list = document.getElementById('banned-ips-list');
    if (!list) return;
    
    list.innerHTML = '<span style="color: rgba(255,255,255,0.3)">Refreshing...</span>';
    
    try {
        const res = await bridgeFetch('/api/security/audit', { 
            method: 'GET',
            timeoutMs: 3000 
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
 * Handles image, video, or file selection for the chat.
 */
window.handleChatFileSelect = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    currentChatAttachmentName = file.name;
    const reader = new FileReader();
    reader.onload = function(e) {
        currentChatAttachment = e.target.result;
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
            if (img) {
                img.src = currentChatAttachment;
                img.style.display = 'block';
            }
        } else if (file.type.startsWith('video/')) {
            currentChatAttachmentType = 'video';
            if (video) {
                video.src = currentChatAttachment;
                video.style.display = 'block';
            }
        } else {
            currentChatAttachmentType = 'file';
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
window.clearChatAttachment = function() {
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
window.syncArcadeSidebarOffsets = function() {
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

window.toggleChatHistory = function() {
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
    
    if (content.includes('```')) {
        const parts = content.split('```');
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
        // Strip internal protocol tags from display
        const cleanContent = content
            .replace(/\[(?:IMPLEMENTATION_PLAN|TEST_PLAN|FILE_REWRITE|PATCH_SUGGESTION)\][\s\S]*?\[\/(?:IMPLEMENTATION_PLAN|TEST_PLAN|FILE_REWRITE|PATCH_SUGGESTION)\]/gi, "")
            .replace(/\[(?:\/)?(?:IMPLEMENTATION_PLAN|TEST_PLAN|FILE_REWRITE|PATCH_SUGGESTION)\]/gi, "")
            .replace(/\[COMPOSE:\s*([\s\S]*?)\]/gi, "$1")
            .replace(/\[(?:ARCADE|DUCKDUCKGO|OPEN):\s*[^\]]+\]/gi, "")
            .replace(/\[PUBLISH:\s*({[\s\S]*?})\]/gi, "")
            .trim();
        msgDiv.textContent = cleanContent;
        if (!cleanContent && /\[(?:ARCADE|DUCKDUCKGO|OPEN|PUBLISH|COMPOSE|\/?(?:IMPLEMENTATION_PLAN|TEST_PLAN|FILE_REWRITE|PATCH_SUGGESTION))(?::|\])/i.test(content)) {
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
        speakBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        speakBtn.onclick = (e) => {
            e.stopPropagation();
            speakArcadeText(content);
        };
        msgDiv.appendChild(speakBtn);

        // Auto-speak if it was a voice session
        if (isVoiceSessionActive) {
            speakArcadeText(content);
            isVoiceSessionActive = false; // Reset for next interaction
        }
    }
}

window.executeArcadeAction = function(action) {
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

window.sendChatMessage = async function() {
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
    const text = input.value.trim();
    if (!text) {
        isSendingChatMessage = false;
        return;
    }

    try {
        const attachmentData = currentChatAttachment;
        const attachmentType = currentChatAttachmentType;
        const attachmentName = currentChatAttachmentName;
        
        addChatMessage('user', text);

        const directSteamTarget = parseDirectSteamCommand(text);
        if (directSteamTarget) {
            const response = openSteamGame(directSteamTarget);
            addChatMessage('ai', response);
            arcadeChatHistory.push({ role: 'assistant', content: response });
            saveCurrentChat();
            updateChatStatus('active');
            input.value = '';
            clearChatAttachment();
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
            input.value = '';
            clearChatAttachment();
            isSendingChatMessage = false;
            return;
        }

        const workshopPublishIntent = isWorkshopPublishIntentPrompt(text);

        // Add to history with attachment if present
        arcadeChatHistory.push({ 
            role: 'user', 
            content: text,
            attachment: attachmentData ? {
                data: attachmentData,
                type: attachmentType,
                name: attachmentName
            } : null
        });
        
        input.value = '';
        clearChatAttachment();
        
        // Refresh bridge context on demand so AI has latest info
        if (typeof pollDesktopBridge === 'function') {
            await pollDesktopBridge();
        }
        
        const typingId = addTypingIndicator();
        let activeAiAbortController = new AbortController();
        const { signal } = activeAiAbortController;
        setChatSendButtonMode('stop');

        window.stopArcadeAi = function() {
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

        const pageContext = JSON.stringify(richContext);
        // Omit visible page text if we are in the editor to save tokens
        const pageText = richContext.workshopEditor ? "" : document.body.innerText.substring(0, 300);
        // Keep only the most recent messages to prevent context window overflow on small local models
        const maxHistory = 6;
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
        const protocolDirectives = getProtocolDirectives(text, richContext);
        const fullPageContext = `${pageContext} (Visible text: ${pageText})${sharedAiContext ? `\n\n${sharedAiContext}` : ''}${protocolDirectives ? `\n\n${protocolDirectives}` : ''}`;

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
                const bridgeOnlineOnSend = await checkBridgeConnectivity({ signal, timeoutMs: 1200 });
                updateEngineStatus(bridgeOnlineOnSend);
                if (bridgeOnlineOnSend) {
                    bridgePollFailureCount = 0;
                    bridgePollNextAllowedAt = 0;
                }
            }

            const protocolAwareMessage = buildProtocolAwareUserMessage(text);
            const attachment = arcadeChatHistory[arcadeChatHistory.length - 1].attachment;
            const compactHistory = Array.isArray(normalizedHistory) ? normalizedHistory.slice(-14) : [];
            const compactPageContext = `${fullPageContext || ''}`.slice(0, 25000);
            const payloadVariants = [
                {
                    label: 'full',
                    body: JSON.stringify({
                        message: protocolAwareMessage,
                        model: requestModel,
                        customInstructions,
                        attachment,
                        history: normalizedHistory,
                        pageContext: fullPageContext
                    })
                },
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
                lastError = attemptErrors.length > 0
                    ? attemptErrors.join(" | ")
                    : "Bridge did not return an AI reply";
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
            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');
            
            // Execute any tags in the reply
            const actionResult = await executeArcadeChatActions(reply, { userPrompt: text });
            if (isWorkshopPublishIntentPrompt(text) && !actionResult?.workshopPublishAttempted) {
                await tryAutoPublishWorkshopFromReply(reply, text);
            }
            // Optional: Automated Workshop File Rewrite Fallback
            if (isWorkshopEditIntentPrompt(text, richContext) && !actionResult?.workshopFileRewriteAttempted) {
                await tryAutoWorkshopFileRewriteFromReply(reply, text, richContext);
            }
        } else {
            if (workshopPublishIntent) {
                const emergencyPublish = await tryEmergencyWorkshopPublishFromPrompt(text, lastError);
                if (emergencyPublish?.attempted && emergencyPublish?.ok) {
                    const publishReply = `🕹️ [Arcade Protocol]: Remote generation failed, so I generated and published "${emergencyPublish.title}" directly to your Workshop (${emergencyPublish.assetCount} assets).`;
                    addChatMessage('ai', publishReply);
                    arcadeChatHistory.push({ role: 'assistant', content: publishReply });
                    saveCurrentChat();
                    updateChatStatus('active');
                    return;
                }
                if (emergencyPublish?.attempted && !emergencyPublish?.ok) {
                    const emergencyReason = `${emergencyPublish.reason || 'publish-failed'}`.trim();
                    if (emergencyReason) {
                        lastError = `${lastError || 'Bridge failed'} | emergency-publish:${emergencyReason}`;
                    }
                }
            }

            if (lastError !== 'Bridge disabled') {
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
        window.stopArcadeAi = null;
    }
}

function inferAiWorkshopFileType(fileName) {
    const lower = `${fileName || ''}`.trim().toLowerCase();
    if (lower.endsWith('.html')) return 'text/html';
    if (lower.endsWith('.css')) return 'text/css';
    if (lower.endsWith('.js')) return 'text/javascript';
    if (lower.endsWith('.json')) return 'application/json';
    return 'text/plain';
}

function decodeEscapedCodeText(value) {
    return `${value || ''}`
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function looksLikeExecutableCode(value) {
    const text = `${value || ''}`.trim();
    if (text.length < 80) return false;
    const markers = [
        'function ',
        'const ',
        'let ',
        'var ',
        '=>',
        'document.',
        'addEventListener',
        '<html',
        '<!doctype',
        'return '
    ];
    const hitCount = markers.reduce((count, marker) => count + (text.toLowerCase().includes(marker) ? 1 : 0), 0);
    const structureHits = (text.match(/[{};]/g) || []).length;
    return hitCount >= 2 && structureHits >= 4;
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

    const sourceText = `${rawText || ''}`;
    const blockRegex = /```([a-z0-9_+-]*)\s*\n([\s\S]*?)```/gi;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(sourceText)) !== null) {
        const lang = `${blockMatch[1] || ''}`.trim().toLowerCase();
        const code = `${blockMatch[2] || ''}`.trim();
        if (!code) continue;
        let kind = 'txt';
        if (lang.includes('html')) kind = 'html';
        else if (lang.includes('css')) kind = 'css';
        else if (lang.includes('js') || lang.includes('javascript') || lang.includes('ts')) kind = 'js';
        else if (code.toLowerCase().includes('<!doctype html') || code.toLowerCase().includes('<html')) kind = 'html';
        else if (looksLikeExecutableCode(code)) kind = 'js';
        files.push({
            name: nextName(kind),
            type: kind === 'html' ? 'text/html' : kind === 'css' ? 'text/css' : kind === 'js' ? 'text/javascript' : 'text/plain',
            content: code
        });
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

    if (!looksLikeExecutableCode(fallback)) {
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
        const files = buildAiWorkshopFilesFromText(entry.content);
        if (files.length > 0) return files;
        if (assistantMessagesChecked >= 8) break;
    }
    return [];
}

function buildAiWorkshopPublishFiles(data, rawReplyText) {
    const collected = [];
    const pushFile = (file, fallbackIndex) => {
        if (!file || typeof file !== 'object') return;
        const rawName = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : `file-${fallbackIndex}.txt`;
        const rawContent = typeof file.content === 'string' ? file.content : '';
        if (!rawContent.trim()) return;
        const name = rawName.replace(/[/\\]+/g, '_');
        const type = typeof file.type === 'string' && file.type.trim() ? file.type.trim() : inferAiWorkshopFileType(name);
        collected.push({ name, type, content: rawContent });
    };

    if (Array.isArray(data?.files)) {
        data.files.forEach((file, index) => pushFile(file, index + 1));
    }

    if (typeof data?.html === 'string' && data.html.trim()) {
        collected.push({ name: 'index.html', type: 'text/html', content: data.html.trim() });
    }
    if (typeof data?.css === 'string' && data.css.trim()) {
        collected.push({ name: 'styles.css', type: 'text/css', content: data.css.trim() });
    }
    if (typeof data?.js === 'string' && data.js.trim()) {
        collected.push({ name: 'game.js', type: 'text/javascript', content: data.js.trim() });
    }
    if (typeof data?.code === 'string' && data.code.trim()) {
        const code = decodeEscapedCodeText(data.code.trim());
        const codeLooksHtml = /<!doctype html|<html/i.test(code);
        collected.push({
            name: codeLooksHtml ? 'index.html' : 'game.js',
            type: codeLooksHtml ? 'text/html' : 'text/javascript',
            content: code
        });
    }

    if (collected.length === 0) {
        collected.push(...buildAiWorkshopFilesFromText(rawReplyText));
    }

    if (collected.length === 0) {
        collected.push(...buildAiWorkshopFilesFromHistory());
    }

    const usedNames = new Set();
    return collected
        .map((file, index) => {
            const baseName = `${file.name || `file-${index + 1}.txt`}`.trim() || `file-${index + 1}.txt`;
            let uniqueName = baseName;
            let suffix = 2;
            while (usedNames.has(uniqueName.toLowerCase())) {
                const dotIndex = baseName.lastIndexOf('.');
                if (dotIndex > 0) {
                    uniqueName = `${baseName.slice(0, dotIndex)}-${suffix}${baseName.slice(dotIndex)}`;
                } else {
                    uniqueName = `${baseName}-${suffix}`;
                }
                suffix += 1;
            }
            usedNames.add(uniqueName.toLowerCase());
            return {
                name: uniqueName,
                type: file.type || inferAiWorkshopFileType(uniqueName),
                content: file.content
            };
        })
        .filter((file) => typeof file.content === 'string' && file.content.trim());
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

function extractBalancedJsonTagPayload(text, tagName) {
    const source = `${text || ''}`;
    const upperSource = source.toUpperCase();
    const marker = `[${`${tagName || ''}`.trim().toUpperCase()}:`;
    if (!marker || marker === '[:') return null;

    let searchFrom = 0;
    while (searchFrom < source.length) {
        const markerIndex = upperSource.indexOf(marker, searchFrom);
        if (markerIndex < 0) return null;

        let cursor = markerIndex + marker.length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
        if (source[cursor] !== '{') {
            searchFrom = markerIndex + marker.length;
            continue;
        }

        let depth = 0;
        let inString = false;
        let isEscaped = false;
        for (let i = cursor; i < source.length; i += 1) {
            const ch = source[i];
            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                } else if (ch === '\\') {
                    isEscaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') {
                depth += 1;
                continue;
            }
            if (ch !== '}') continue;

            depth -= 1;
            if (depth !== 0) continue;

            let endCursor = i + 1;
            while (endCursor < source.length && /\s/.test(source[endCursor])) endCursor += 1;
            if (source[endCursor] !== ']') {
                searchFrom = i + 1;
                break;
            }

            return {
                jsonText: source.slice(cursor, i + 1),
                start: markerIndex,
                end: endCursor + 1
            };
        }

        searchFrom = markerIndex + marker.length;
    }

    return null;
}

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
        workshopFileRewriteSucceeded: false
    };
    if (!text) return actionResult;

    // 1. [PUBLISH: {json}]
    const publishPayload = extractBalancedJsonTagPayload(text, 'PUBLISH');
    if (publishPayload?.jsonText) {
        actionResult.publishTagDetected = true;
        try {
            const data = JSON.parse(publishPayload.jsonText);
            const { title, caption, tags } = data;

            const routeToWorkshop = shouldRoutePublishToWorkshop(data, text, options.userPrompt || '');
            if (routeToWorkshop) {
                actionResult.handled = true;
                actionResult.workshopPublishAttempted = true;
                if (typeof window.publishCustomGameFromAi !== 'function') {
                    if (window.showFeedback) window.showFeedback("Workshop publishing is available from the Arcade Library page.", true);
                    return actionResult;
                }

                const workshopFiles = buildAiWorkshopPublishFiles(data, text);
                if (workshopFiles.length === 0) {
                    if (window.showFeedback) {
                        window.showFeedback("Couldn't find game code to publish. Ask the AI to include a code block or code field.", true);
                    }
                    return actionResult;
                }

                const workshopResult = await window.publishCustomGameFromAi({
                    title: title || data.gameTitle || 'AI Workshop Game',
                    category: data.category || 'GAME',
                    description: data.description || caption || '',
                    thumbnail: data.thumbnail || data.poster || '',
                    tags: Array.isArray(tags) ? tags.join(', ') : (typeof tags === 'string' ? tags : ''),
                    files: workshopFiles,
                    mode: data.mode || data.action || data.operation || '',
                    gameId: data.gameId || data.id || data.updateId || data.existingGameId || '',
                    updateTitle: data.updateTitle || data.targetTitle || ''
                });

                if (workshopResult?.ok) {
                    actionResult.workshopPublishSucceeded = true;
                    if (window.showFeedback) {
                        const actionLabel = workshopResult.updated ? 'Updated' : 'Published';
                        window.showFeedback(`${actionLabel} "${workshopResult.title}" in Workshop (${workshopResult.assetCount} assets).`);
                    }
                } else if (window.showFeedback) {
                    window.showFeedback(workshopResult?.message || 'Failed to publish game to Workshop.', true);
                }
                return actionResult;
            }
            
            if (window.publishPostToSupabase) {
                actionResult.handled = true;
                // Determine what to publish. 
                // If there's a recent attachment in history, use it.
                // Otherwise check if there's a URL in the text.
                let postFile = null;
                const lastUserMsg = [...arcadeChatHistory].reverse().find(m => m.role === 'user' && m.attachment);
                if (lastUserMsg && lastUserMsg.attachment && lastUserMsg.attachment.data) {
                    // Convert data URL back to Blob
                    const resp = await fetch(lastUserMsg.attachment.data);
                    const blob = await resp.blob();
                    postFile = new File([blob], lastUserMsg.attachment.name || "published-file", { type: lastUserMsg.attachment.type });
                }

                if (!postFile) {
                    console.warn("[Arcade Chat] No attachment found to publish.");
                    // Check if there's an external URL to publish instead
                    const urlMatch = text.match(/https?:\/\/[^\s\]]+/);
                    if (urlMatch && window.buildExternalPost && window.parseExternalMediaUrl) {
                         const externalUrl = urlMatch[0];
                         const parsedExternal = window.parseExternalMediaUrl(externalUrl);
                         if (parsedExternal) {
                             const basePost = { 
                                 id: `ai-${crypto.randomUUID()}`, 
                                 creator: window.getDefaultProfileName ? window.getDefaultProfileName() : "AI Assistant", 
                                 title: title || "AI Shared Content", 
                                 caption: caption || "Check this out!", 
                                 tags: tags || [], 
                                 likes: 0, 
                                 createdAt: new Date().toISOString() 
                             };
                             const post = window.buildExternalPost(basePost, parsedExternal);
                             const inserted = await window.publishPostToSupabase(post);
                             if (window.state && window.state.userPosts) {
                                 window.state.userPosts = [inserted, ...window.state.userPosts];
                                 if (window.render) window.render();
                             }
                             if (window.showFeedback) window.showFeedback("Post published successfully via AI!");
                             return actionResult;
                          }
                     }
                    if (window.showFeedback) window.showFeedback("AI wanted to publish but no file/link was found.", true);
                    return actionResult;
                }

                // Prepare the post object
                const basePost = { 
                    id: `ai-${crypto.randomUUID()}`, 
                    creator: window.getDefaultProfileName ? window.getDefaultProfileName() : "AI Assistant", 
                    title: title || "AI Shared Content", 
                    caption: caption || "Check this out!", 
                    tags: tags || [], 
                    likes: 0, 
                    createdAt: new Date().toISOString() 
                };

                if (window.buildUploadPost) {
                    const post = window.buildUploadPost(basePost, postFile);
                    const inserted = await window.publishPostToSupabase(post, (p) => {
                        console.log(`[AI Publish] Uploading: ${p}%`);
                    });
                    
                    if (window.state && window.state.userPosts) {
                        window.state.userPosts = [inserted, ...window.state.userPosts];
                        if (window.render) window.render();
                    }
                    if (window.showFeedback) window.showFeedback("Post published successfully via AI!");
                }
            }
        } catch (e) {
            console.error("[Arcade Chat] Failed to execute [PUBLISH] action:", e);
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

    // 6. [FILE_REWRITE: {json}] (with aliases for common AI hallucinations)
    let fileRewritePayload = extractBalancedJsonTagPayload(text, 'FILE_REWRITE');
    
    // Alias support for [Workshop/Edit] or [EDIT: {json}]
    if (!fileRewritePayload) fileRewritePayload = extractBalancedJsonTagPayload(text, 'Workshop/Edit');
    if (!fileRewritePayload) fileRewritePayload = extractBalancedJsonTagPayload(text, 'EDIT');
    
    if (fileRewritePayload?.jsonText) {
        try {
            actionResult.handled = true;
            const data = JSON.parse(fileRewritePayload.jsonText);
            const editorState = typeof window.getWorkshopEditorState === 'function'
                ? window.getWorkshopEditorState()
                : null;
            const gameId = `${data?.gameId || editorState?.activeGameId || ''}`.trim();
            const fileName = `${data?.fileName || editorState?.activeFileName || ''}`.trim();
            const content = typeof data?.content === 'string' ? data.content : '';
            const save = data?.save !== false;
            if (!gameId || !fileName || !content) {
                if (window.showFeedback) {
                    window.showFeedback('AI file rewrite missing gameId, fileName, or content.', true);
                }
                return actionResult;
            }
            if (typeof window.applyAiFileEdit === 'function') {
                actionResult.workshopFileRewriteAttempted = true;
                const applyResult = await window.applyAiFileEdit(gameId, fileName, content, { save: !!save });
                if (applyResult?.ok) {
                    actionResult.workshopFileRewriteSucceeded = true;
                } else if (window.showFeedback) {
                    window.showFeedback(applyResult?.message || `Failed to apply AI edit to ${fileName}.`, true);
                }
            }
        } catch (e) {
            console.error("[Arcade Chat] Failed to execute [FILE_REWRITE] action:", e);
        }
    }
    return actionResult;
}

async function tryAutoWorkshopFileRewriteFromReply(replyText, userPrompt, context = null) {
    const result = {
        attempted: false,
        ok: false,
        reason: ''
    };
    if (!isWorkshopEditIntentPrompt(userPrompt, context)) return result;
    if (extractBalancedJsonTagPayload(replyText, 'FILE_REWRITE')) return result;
    if (typeof window.applyAiFileEdit !== 'function') {
        result.reason = 'file-rewrite-unavailable';
        return result;
    }

    const editorState = typeof window.getWorkshopEditorState === 'function'
        ? window.getWorkshopEditorState()
        : null;
    const gameId = `${editorState?.activeGameId || ''}`.trim();
    const fileName = `${editorState?.activeFileName || ''}`.trim();
    if (!gameId || !fileName) {
        result.reason = 'editor-target-missing';
        return result;
    }

    const parsedFiles = buildAiWorkshopFilesFromText(replyText);
    if (!Array.isArray(parsedFiles) || parsedFiles.length === 0) {
        result.reason = 'no-code-candidate';
        return result;
    }

    const lowerFileName = fileName.toLowerCase();
    const matchingFile = parsedFiles.find((file) => {
        const name = `${file?.name || ''}`.toLowerCase();
        const type = `${file?.type || ''}`.toLowerCase();
        if (lowerFileName.endsWith('.html')) return name.endsWith('.html') || type.includes('text/html');
        if (lowerFileName.endsWith('.css')) return name.endsWith('.css') || type.includes('text/css');
        if (lowerFileName.endsWith('.js') || lowerFileName.endsWith('.mjs') || lowerFileName.endsWith('.cjs')) {
            return name.endsWith('.js') || type.includes('javascript');
        }
        if (lowerFileName.endsWith('.json')) return name.endsWith('.json') || type.includes('json');
        if (lowerFileName.endsWith('.txt') || lowerFileName.endsWith('.md')) return name.endsWith('.txt') || name.endsWith('.md') || type.includes('text/plain');
        return false;
    }) || parsedFiles[0];

    const content = typeof matchingFile?.content === 'string' ? matchingFile.content : '';
    if (!content.trim()) {
        result.reason = 'empty-code-candidate';
        return result;
    }

    result.attempted = true;
    const applyResult = await window.applyAiFileEdit(gameId, fileName, content, { save: true });
    if (!applyResult?.ok) {
        result.reason = 'apply-failed';
        return result;
    }
    result.ok = true;
    return result;
}

async function tryAutoPublishWorkshopFromReply(replyText, userPrompt = '') {
    const result = {
        attempted: false,
        ok: false,
        reason: ''
    };
    if (!isWorkshopPublishIntentPrompt(userPrompt)) return result;
    if (extractBalancedJsonTagPayload(replyText, 'PUBLISH')) return result;
    if (typeof window.publishCustomGameFromAi !== 'function') {
        result.reason = 'publish-function-unavailable';
        return result;
    }

    const files = buildAiWorkshopPublishFiles({}, replyText);
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
    if (!isWorkshopPublishIntentPrompt(userPrompt)) return result;
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


window.toggleChat = function() {
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

window.closeArcadeChat = function(options = {}) {
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
    
    if (arcInput) {
        arcInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                isVoiceSessionActive = false; // Regular typing reset
                sendChatMessage();
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
                } catch(e){}
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
