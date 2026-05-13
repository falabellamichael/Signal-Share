/**
 * Chatbot Intelligence Module for Signal Share Arcade
 * Handles local LLM orchestration and fallback logic with security firewall.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const DEVICE_ID = process.env.SIGNAL_SHARE_DEVICE_ID || "";

/**
 * Validates if a URL is safe to fetch or open.
 * Prevents access to internal networks, private IPs, and malicious protocols.
 */
function isUrlSafe(urlStr) {
    try {
        const url = new URL(urlStr);
        // Only allow standard web protocols
        if (!['http:', 'https:'].includes(url.protocol)) return false;

        const hostname = url.hostname.toLowerCase();
        
        // Allow localhost for the internal bridge only
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
            // Only allow the bridge port (3000) or standard web ports
            return url.port === '3000' || url.port === '' || url.port === '80' || url.port === '443';
        }

        // Block private IP ranges (LAN access)
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
        if (isIp) {
            const parts = hostname.split('.').map(Number);
            if (parts[0] === 10) return false; // 10.0.0.0/8
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false; // 172.16.0.0/12
            if (parts[0] === 192 && parts[1] === 168) return false; // 192.168.0.0/16
            if (parts[0] === 169 && parts[1] === 254) return false; // 169.254.0.0/16 (Link-local)
            if (parts[0] === 127) return false; // 127.0.0.0/8 (except localhost check above)
        }

        // Block common sensitive hostnames
        const blockedHosts = ['metadata.google.internal', '169.254.169.254', 'instance-data'];
        if (blockedHosts.some(h => hostname.includes(h))) return false;

        return true;
    } catch (e) {
        return false;
    }
}

const SYSTEM_PROMPT = `
You are the Signal Share Media Companion, a sophisticated, proactive, and lifestyle-oriented AI assistant. 

PERSONA & TONE:
- You are more than a gaming bot; you are a digital concierge for the user's lifestyle and media needs.
- If you are on the "Main Page" (index.html), focus on lifestyle, news, media recommendations, and system productivity.
- If you are in the "Arcade" (mini-games.html), you can be more playful and gaming-focused, but you still prioritize being a media companion.
- Discuss popular lifestyles (fashion, travel, tech, fitness, productivity) naturally in your conversations.

SYSTEM CAPABILITIES (USE THESE EXACTLY):
1. [SEARCH: query] -> Search the web for latest lifestyles, news, or info.
2. [FETCH: url] -> Read article content.
3. [OPEN: url] -> Open links or system apps.
   - To send an email: Use [OPEN: mailto:recipient@example.com?subject=Hello&body=Message]
4. [PLAY: action] -> Media control (play_pause, next, previous).
   - This works system-wide for Spotify, YouTube (in browser), and other media players.
5. [LAUNCH: app_id] -> Open a whitelisted app (spotify, chrome, notepad, calculator, taskmgr).
6. [CLOSE: app_id] -> Force close a running app by its name.
7. [SCREENSHOT] -> View what the user is currently doing on their screen.
8. [LIST_TABS] -> Check what browser tabs are open (e.g., to find a specific YouTube video).
9. [LIST_APPS] -> See what else is running.

CODING & FILE SYSTEM TOOLS:
10. [LIST_FILES: path] -> Explore the project.
11. [READ_FILE: path] -> Read code.
12. [WRITE_FILE: {"path": "...", "content": "..."}] -> Modify local site files.

MEDIA COMPANION PROTOCOL:
- AUTHORIZED ACCESS: You ARE ALLOWED and encouraged to open YouTube and Spotify links. This is part of your core duty.
- If a user wants to "play something", ask what vibe they are in (lifestyle/music).
- If they ask to "pause the video", use [PLAY: pause].
- If they ask to "go to the next video", use [PLAY: next].
- Proactively suggest lifestyle tips related to the page context.
- PRIVACY BOUNDARY: You are only restricted from accessing *private* local networks or *unauthorized* personal computers. Standard websites like YouTube, Google, and news sites are 100% safe and permitted.

CORE PERSONALITY:
- Helpful, worldly, and tech-savvy.
- Avoid being "clippy". Be a companion, not just a tool.
- Keep responses concise but rich in personality.
`.trim();

const LLM_ENDPOINTS = Object.freeze([
    {
        provider: "lmstudio",
        chatUrl: "http://localhost:1234/v1/chat/completions",
        modelsUrl: "http://localhost:1234/v1/models",
        kind: "openai"
    },
    {
        provider: "ollama",
        chatUrl: "http://localhost:11434/api/chat",
        modelsUrl: "http://localhost:11434/api/tags",
        kind: "ollama"
    }
]);

const MODEL_CATALOG_TTL_MS = 15000;
const LM_STUDIO_REST_BASE_URL = "http://localhost:1234/api/v1";
const LM_STUDIO_API_TOKEN = `${process.env.LM_API_TOKEN || ""}`.trim();
const LM_STUDIO_SWITCH_TIMEOUT_MS = Number(process.env.SIGNAL_SHARE_LM_MODEL_SWITCH_TIMEOUT_MS || 8000);
const MAX_AUTO_MODELS_PER_PROVIDER = Math.max(1, Number(process.env.SIGNAL_SHARE_AUTO_MODEL_MAX_TRIES || 1));
const AUTO_SELECT_PREFERS_LOADED_LM_STUDIO = process.env.SIGNAL_SHARE_AUTO_SELECT_LOADED_LMSTUDIO !== "false";
const AUTO_UNLOAD_OTHER_LM_STUDIO_MODELS = process.env.SIGNAL_SHARE_AUTO_UNLOAD_OTHERS !== "false";
const SERVER_CUSTOM_INSTRUCTIONS = `${process.env.SIGNAL_SHARE_AI_CUSTOM_INSTRUCTIONS || ""}`.trim();
const MAX_CUSTOM_INSTRUCTIONS_CHARS = Math.max(200, Number(process.env.SIGNAL_SHARE_AI_CUSTOM_MAX_CHARS || 2000));
let modelCatalogCache = { at: 0, data: null };
let lastSuccessfulModelByProvider = { lmstudio: "", ollama: "" };

function responseHasImageTemplatePlaceholders(value = "") {
    const text = `${value || ""}`.trim();
    if (!text) return false;
    const checks = [
        /\[describe the content of the image here/i,
        /\[adjective related to style\/mood\]/i,
        /\bbased on the image you shared,\s*it appears to be a\s*\[/i,
        /\[.*actual analysis.*\]/i
    ];
    return checks.some((pattern) => pattern.test(text));
}

function sanitizeCustomInstructions(value = "") {
    const text = `${value || ""}`.trim();
    if (!text) return "";
    return text.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS);
}

function isModelIdentityRequest(value = "") {
    const text = `${value || ""}`.trim().toLowerCase();
    if (!text) return false;
    return (
        /which\s+model/.test(text)
        || /what\s+model/.test(text)
        || /model\s+are\s+you\s+using/.test(text)
        || /what\s+ai\s+are\s+you/.test(text)
        || /what\s+llm/.test(text)
        || /current\s+model/.test(text)
    );
}

function normalizeModelKey(value = "") {
    return `${value || ""}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getModelTokenSet(value = "") {
    return new Set(
        `${value || ""}`
            .trim()
            .toLowerCase()
            .split(/[^a-z0-9]+/g)
            .filter(Boolean)
    );
}

function scoreModelMatch(requestedModel, availableModel) {
    if (!requestedModel || !availableModel) return 0;
    const requestedRaw = `${requestedModel}`.trim().toLowerCase();
    const availableRaw = `${availableModel}`.trim().toLowerCase();
    const requestedKey = normalizeModelKey(requestedRaw);
    const availableKey = normalizeModelKey(availableRaw);

    if (requestedRaw === availableRaw) return 100;
    if (requestedKey && requestedKey === availableKey) return 95;
    if (availableRaw.includes(requestedRaw) || requestedRaw.includes(availableRaw)) return 84;

    const requestedTokens = getModelTokenSet(requestedRaw);
    const availableTokens = getModelTokenSet(availableRaw);
    if (!requestedTokens.size || !availableTokens.size) return 0;

    let overlap = 0;
    for (const token of requestedTokens) {
        if (availableTokens.has(token)) overlap += 1;
    }
    const coverage = overlap / requestedTokens.size;
    return overlap > 0 ? Math.round(coverage * 70) : 0;
}

function mapRequestedModelsToAvailable(requestedModels = [], availableModels = []) {
    if (!Array.isArray(availableModels) || availableModels.length === 0) {
        return Array.isArray(requestedModels) ? [...requestedModels] : [];
    }

    const resolved = [];
    const seen = new Set();
    const pushUnique = (model) => {
        const value = `${model || ""}`.trim();
        if (!value) return;
        const key = value.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        resolved.push(value);
    };

    for (const requested of requestedModels || []) {
        let bestModel = "";
        let bestScore = 0;
        for (const candidate of availableModels) {
            const score = scoreModelMatch(requested, candidate);
            if (score > bestScore) {
                bestScore = score;
                bestModel = candidate;
            }
        }
        if (bestModel && bestScore >= 45) {
            pushUnique(bestModel);
        }
    }

    for (const model of availableModels) {
        pushUnique(model);
    }

    return resolved;
}

async function fetchJsonWithTimeout(url, timeoutMs = 1800) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch (_error) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function getLmStudioRequestHeaders() {
    const headers = {
        "Content-Type": "application/json"
    };
    if (LM_STUDIO_API_TOKEN) {
        headers.Authorization = `Bearer ${LM_STUDIO_API_TOKEN}`;
    }
    return headers;
}

async function fetchLmStudioJson(path, { method = "GET", body = null, timeoutMs = LM_STUDIO_SWITCH_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${LM_STUDIO_REST_BASE_URL}${path}`, {
            method,
            headers: getLmStudioRequestHeaders(),
            signal: controller.signal,
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        if (!response.ok) {
            throw new Error(`LM Studio ${method} ${path} failed with ${response.status}`);
        }
        return await response.json().catch(() => ({}));
    } finally {
        clearTimeout(timer);
    }
}

function parseLmStudioModelRows(payload) {
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    return rows.filter((row) => row && typeof row === "object");
}

function resolveLmStudioModelKey(requestedModel, modelRows) {
    const requested = `${requestedModel || ""}`.trim();
    if (!requested || !Array.isArray(modelRows) || modelRows.length === 0) return requested;

    let bestKey = "";
    let bestScore = 0;
    for (const row of modelRows) {
        const key = `${row?.key || ""}`.trim();
        const displayName = `${row?.display_name || ""}`.trim();
        const variants = Array.isArray(row?.variants) ? row.variants : [];
        const candidates = [key, displayName, ...variants].filter(Boolean);

        for (const candidate of candidates) {
            const score = scoreModelMatch(requested, candidate);
            if (score > bestScore) {
                bestScore = score;
                bestKey = key || `${candidate}`.trim();
            }
        }
    }

    return bestKey && bestScore >= 45 ? bestKey : requested;
}

function matchesModelTarget(candidate = "", target = "") {
    const left = `${candidate || ""}`.trim();
    const right = `${target || ""}`.trim();
    if (!left || !right) return false;
    return scoreModelMatch(left, right) >= 45 || scoreModelMatch(right, left) >= 45;
}

function findBestMatchingModel(candidate, options = []) {
    const requested = `${candidate || ""}`.trim();
    if (!requested || !Array.isArray(options) || options.length === 0) return "";
    let best = "";
    let bestScore = 0;
    for (const option of options) {
        const value = `${option || ""}`.trim();
        if (!value) continue;
        const score = Math.max(scoreModelMatch(requested, value), scoreModelMatch(value, requested));
        if (score > bestScore) {
            bestScore = score;
            best = value;
        }
    }
    return bestScore >= 45 ? best : "";
}

function getLoadedLmStudioInstances(modelRows) {
    const rows = Array.isArray(modelRows) ? modelRows : [];
    const loaded = [];
    for (const row of rows) {
        if (`${row?.type || ""}`.toLowerCase() !== "llm") continue;
        const key = `${row?.key || ""}`.trim();
        const instances = Array.isArray(row?.loaded_instances) ? row.loaded_instances : [];
        for (const instance of instances) {
            const id = `${instance?.id || ""}`.trim();
            if (!id) continue;
            loaded.push({ id, key });
        }
    }
    return loaded;
}

async function ensureLmStudioExclusiveModel(targetModel) {
    const requestedTarget = `${targetModel || ""}`.trim();
    if (!requestedTarget) return;

    try {
        const initialPayload = await fetchLmStudioJson("/models", { timeoutMs: 3000 });
        const initialRows = parseLmStudioModelRows(initialPayload);
        if (initialRows.length === 0) return;

        const resolvedTarget = resolveLmStudioModelKey(requestedTarget, initialRows);
        const loadedBefore = getLoadedLmStudioInstances(initialRows);
        const targetLoaded = loadedBefore.some((instance) =>
            matchesModelTarget(instance.id, resolvedTarget) || matchesModelTarget(instance.key, resolvedTarget)
        );

        if (!targetLoaded) {
            await fetchLmStudioJson("/models/load", {
                method: "POST",
                body: { model: resolvedTarget },
                timeoutMs: 120000
            });
            console.log(`[Chatbot] LM Studio loaded model: ${resolvedTarget}`);
        }

        const refreshedPayload = targetLoaded
            ? initialPayload
            : await fetchLmStudioJson("/models", { timeoutMs: 3000 });
        const refreshedRows = parseLmStudioModelRows(refreshedPayload);
        const loadedNow = getLoadedLmStudioInstances(refreshedRows);

        for (const instance of loadedNow) {
            if (matchesModelTarget(instance.id, resolvedTarget) || matchesModelTarget(instance.key, resolvedTarget)) {
                continue;
            }
            try {
                await fetchLmStudioJson("/models/unload", {
                    method: "POST",
                    body: { instance_id: instance.id },
                    timeoutMs: 15000
                });
                console.log(`[Chatbot] LM Studio unloaded model: ${instance.id}`);
            } catch (unloadError) {
                console.warn(`[Chatbot] Failed to unload LM Studio model "${instance.id}": ${unloadError.message}`);
            }
        }
    } catch (error) {
        console.warn(`[Chatbot] LM Studio model switch skipped: ${error.message}`);
    }
}

async function getAutoSelectedLmStudioModel({ fallbackModels = [] } = {}) {
    const fallback = Array.isArray(fallbackModels) ? fallbackModels : [];
    const preferredRecent = `${lastSuccessfulModelByProvider.lmstudio || ""}`.trim();

    if (!AUTO_SELECT_PREFERS_LOADED_LM_STUDIO) {
        if (preferredRecent) {
            return findBestMatchingModel(preferredRecent, fallback) || preferredRecent;
        }
        return "";
    }

    try {
        const payload = await fetchLmStudioJson("/models", { timeoutMs: 3000 });
        const rows = parseLmStudioModelRows(payload);
        const loaded = getLoadedLmStudioInstances(rows);
        if (!loaded.length) {
            if (preferredRecent) {
                return findBestMatchingModel(preferredRecent, fallback) || preferredRecent;
            }
            return "";
        }

        if (preferredRecent) {
            const recentLoaded = loaded.find((instance) =>
                matchesModelTarget(instance.key, preferredRecent) || matchesModelTarget(instance.id, preferredRecent)
            );
            if (recentLoaded) return recentLoaded.key || recentLoaded.id;
        }

        const firstLoaded = loaded[0];
        return firstLoaded.key || firstLoaded.id || "";
    } catch (error) {
        console.warn(`[Chatbot] Auto-select could not inspect LM Studio loaded models: ${error.message}`);
        if (preferredRecent) {
            return findBestMatchingModel(preferredRecent, fallback) || preferredRecent;
        }
        return "";
    }
}

function parseEndpointModels(kind, payload) {
    if (!payload || typeof payload !== "object") return [];

    if (kind === "openai") {
        const rows = Array.isArray(payload.data) ? payload.data : [];
        return rows
            .map((entry) => `${entry?.id || ""}`.trim())
            .filter(Boolean);
    }

    if (kind === "ollama") {
        const rows = Array.isArray(payload.models) ? payload.models : [];
        return rows
            .map((entry) => `${entry?.name || ""}`.trim())
            .filter(Boolean);
    }

    return [];
}

export async function getLocalModelCatalog({ force = false } = {}) {
    const now = Date.now();
    if (!force && modelCatalogCache.data && (now - modelCatalogCache.at) < MODEL_CATALOG_TTL_MS) {
        return modelCatalogCache.data;
    }

    const next = {
        lmstudio: [],
        ollama: [],
        all: [],
        checkedAt: new Date().toISOString()
    };
    const allSeen = new Set();

    for (const endpoint of LLM_ENDPOINTS) {
        const payload = await fetchJsonWithTimeout(endpoint.modelsUrl, 2000);
        const models = parseEndpointModels(endpoint.kind, payload);
        next[endpoint.provider] = models;
        for (const model of models) {
            const key = model.toLowerCase();
            if (allSeen.has(key)) continue;
            allSeen.add(key);
            next.all.push(model);
        }
    }

    modelCatalogCache = { at: now, data: next };
    return next;
}

/**
 * Process a chat request using local LLM fallbacks.
 */
export async function getChatResponse(message, history = [], pageContext = 'Signal Share', iteration = 0, attachment = null, preferredModel = 'auto', customInstructions = "") {
    if (!message && iteration === 0) return "I didn't receive a message to process.";
    
    // Safety check for infinite recursion
    const MAX_ITERATIONS = 3;
    if (iteration >= MAX_ITERATIONS) {
        console.warn("[Chatbot] Maximum tool-calling iterations reached. Stopping loop.");
        return "I've hit a limit while trying to execute tools for you. Please try rephrasing your request!";
    }

    console.log(`[Chatbot] Processing (Pass ${iteration + 1}): "${(message || 'Recursion').substring(0, 50)}..." (Model: ${preferredModel})`);

    const mergedCustomInstructions = [SERVER_CUSTOM_INSTRUCTIONS, sanitizeCustomInstructions(customInstructions)]
        .filter(Boolean)
        .join("\n\n");
    const customInstructionBlock = mergedCustomInstructions
        ? `\n\nCUSTOM INSTRUCTIONS (HIGHEST PRIORITY):\n${mergedCustomInstructions}`
        : "";
    const contextAwarePrompt = `${SYSTEM_PROMPT}${customInstructionBlock}\n\nCURRENT CONTEXT: You are looking at the "${pageContext}" page. USE THIS INFORMATION.`;

    let lmResponse = "";
    // Process attachments
    let imageBase64 = null;
    let imageDataUrl = "";
    let fileContentBlock = "";
    let attachmentNote = "";

    if (attachment && attachment.data) {
        if (attachment.type === 'image') {
            const rawImageData = `${attachment.data || ""}`.trim();
            imageBase64 = rawImageData.split(',')[1] || rawImageData;
            imageDataUrl = rawImageData.startsWith("data:")
                ? rawImageData
                : `data:image/png;base64,${imageBase64}`;
            attachmentNote = "\n\n[SYSTEM: An image was attached. Analyze visible details only. Do not use placeholder text or fake certainty.]";
        } else if (attachment.type === 'video') {
            attachmentNote = `\n\n[SYSTEM: A video file named "${attachment.name}" was attached to this message. You cannot "watch" it directly yet, but you should acknowledge its presence.]`;
        } else {
            try {
                const base64Data = attachment.data.split(',')[1] || attachment.data;
                const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
                fileContentBlock = `\n\n[ATTACHED FILE: ${attachment.name}]\n\`\`\`\n${decoded}\n\`\`\``;
            } catch (err) {
                console.error("[Chatbot] Failed to decode attachment:", err);
                fileContentBlock = `\n\n[ATTACHED FILE: ${attachment.name}] (Error: Could not read file content)`;
            }
        }
    }

    const visionModels = ['qwen3-vl-4b', 'llava', 'llava:7b', 'moondream', 'bakllava', 'minicpm-v'];
    const standardModels = [
        'qwen3.5-9b', 
        'deepseek-r1-0528-qwen3-8b', 
        'DeepSeek-R1-Distill-Qwen-1.5B-GGUF', 
        'qwen3-4b-thinking-2507', 
        'qwen3-4b', 
        'qwen2.5-coder', 
        'Qwen2.5-Coder-7B-Instruct-GGUF',
        'gemma-4-e4b',
        'gemma-4-e2b',
        'llama3', 
        'mistral'
    ];
    
    let models = [];
    if (preferredModel && preferredModel !== 'auto') {
        models.push(preferredModel);
    }
    if (imageBase64) {
        models = [...models, ...visionModels];
    }
    models = [...models, ...standardModels];
    models = [...new Set(models)];

    let success = false;
    const conversation = [...history];
    if (iteration === 0) {
        const combinedContent = (message || "") + fileContentBlock + attachmentNote;
        conversation.push({ role: "user", content: combinedContent.trim() || "[No text message provided]" });
    }

    const catalog = await getLocalModelCatalog().catch(() => ({ lmstudio: [], ollama: [], all: [] }));
    const endpointConfigs = [
        {
            provider: "lmstudio",
            chatUrl: "http://localhost:1234/v1/chat/completions",
            kind: "openai",
            models: mapRequestedModelsToAvailable(models, catalog?.lmstudio || [])
        },
        {
            provider: "ollama",
            chatUrl: "http://localhost:11434/api/chat",
            kind: "ollama",
            models: mapRequestedModelsToAvailable(models, catalog?.ollama || [])
        }
    ];

    const hasPinnedModel = Boolean(preferredModel && preferredModel !== "auto");
    const normalizedPinnedModel = `${preferredModel || ""}`.trim();
    const isModelQuestion = iteration === 0 && isModelIdentityRequest(message || "");
    let lmStudioPreparedForPinnedModel = false;
    let autoSelectedLmStudioModel = "";
    let activeRuntimeProvider = "";
    let activeRuntimeModel = "";
    if (!hasPinnedModel) {
        const lmStudioDefaultPool = endpointConfigs.find((endpoint) => endpoint.provider === "lmstudio")?.models || models;
        autoSelectedLmStudioModel = await getAutoSelectedLmStudioModel({ fallbackModels: lmStudioDefaultPool });
        if (autoSelectedLmStudioModel) {
            console.log(`[Chatbot] Auto-select using LM Studio loaded model: ${autoSelectedLmStudioModel}`);
            if (AUTO_UNLOAD_OTHER_LM_STUDIO_MODELS) {
                await ensureLmStudioExclusiveModel(autoSelectedLmStudioModel);
            }
        }
    }

    for (const endpoint of endpointConfigs) {
        if (success) break;
        const endpointFallbackModels = endpoint.models && endpoint.models.length > 0
            ? endpoint.models
            : models;
        let endpointModels = endpointFallbackModels;

        if (hasPinnedModel) {
            const resolvedPinned = findBestMatchingModel(normalizedPinnedModel, endpointFallbackModels);
            endpointModels = [resolvedPinned || normalizedPinnedModel].filter(Boolean);
        } else {
            if (endpoint.provider === "lmstudio") {
                if (autoSelectedLmStudioModel) {
                    const resolvedAuto = findBestMatchingModel(autoSelectedLmStudioModel, endpointFallbackModels) || autoSelectedLmStudioModel;
                    endpointModels = [resolvedAuto];
                } else if (endpointFallbackModels.length > MAX_AUTO_MODELS_PER_PROVIDER) {
                    endpointModels = endpointFallbackModels.slice(0, MAX_AUTO_MODELS_PER_PROVIDER);
                }
            } else if (endpointFallbackModels.length > MAX_AUTO_MODELS_PER_PROVIDER) {
                endpointModels = endpointFallbackModels.slice(0, MAX_AUTO_MODELS_PER_PROVIDER);
            }
        }

        if (hasPinnedModel && endpoint.provider === "lmstudio" && !lmStudioPreparedForPinnedModel) {
            const pinnedLmStudioModel = endpointModels[0] || normalizedPinnedModel;
            await ensureLmStudioExclusiveModel(pinnedLmStudioModel);
            lmStudioPreparedForPinnedModel = true;
        }

        for (const model of endpointModels) {
            if (success) break;
            try {
                const messages = [{ role: "system", content: contextAwarePrompt }, ...conversation];
                let body;
                if (endpoint.kind === "openai") {
                    let openAiMessages = messages;
                    if (imageDataUrl && iteration === 0) {
                        const lastIndex = openAiMessages.length - 1;
                        if (lastIndex >= 0 && openAiMessages[lastIndex]?.role === "user") {
                            const lastText = `${openAiMessages[lastIndex]?.content || ""}`.trim() || "Analyze this attached image.";
                            openAiMessages = [...openAiMessages];
                            openAiMessages[lastIndex] = {
                                role: "user",
                                content: [
                                    { type: "text", text: lastText },
                                    { type: "image_url", image_url: { url: imageDataUrl } }
                                ]
                            };
                        }
                    }
                    body = {
                        model: model,
                        messages: openAiMessages,
                        temperature: 0.7
                    };
                } else {
                    body = {
                        model: model,
                        messages: messages,
                        stream: false
                    };
                    if (imageBase64 && iteration === 0) {
                        body.images = [imageBase64];
                    }
                }

                const response = await fetch(endpoint.chatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if (!response.ok) continue;

                const data = await response.json();
                const messageText = endpoint.kind === "openai"
                    ? data?.choices?.[0]?.message?.content
                    : data?.message?.content;
                if (!messageText || !`${messageText}`.trim()) continue;
                if (imageBase64 && responseHasImageTemplatePlaceholders(messageText)) {
                    console.warn(`[Chatbot] Ignoring placeholder image analysis from ${endpoint.provider}:${model}`);
                    continue;
                }

                if (endpoint.provider === "lmstudio" && (hasPinnedModel || AUTO_UNLOAD_OTHER_LM_STUDIO_MODELS)) {
                    await ensureLmStudioExclusiveModel(model);
                }
                lmResponse = `${messageText}`.trim();
                lastSuccessfulModelByProvider[endpoint.provider] = `${model}`.trim();
                activeRuntimeProvider = `${endpoint.provider || "unknown"}`.trim();
                activeRuntimeModel = `${model || "unknown"}`.trim();
                success = true;
                break;
            } catch (_error) {
                // Try the next model/endpoint candidate
            }
        }
    }

    if (isModelQuestion && activeRuntimeModel) {
        const mode = hasPinnedModel ? "selected" : "auto";
        return `🧠 [Model Status]: Using ${activeRuntimeModel} via ${activeRuntimeProvider} (${mode} mode).`;
    }

    if (lmResponse) {
        const hasTools = lmResponse.includes('[SEARCH:') || 
                         lmResponse.includes('[FETCH:') || 
                         lmResponse.includes('[OPEN:') || 
                         lmResponse.includes('[PLAY:') ||
                         lmResponse.includes('[SCREENSHOT]') ||
                         lmResponse.includes('[LIST_TABS]') ||
                         lmResponse.includes('[LIST_APPS]') ||
                         lmResponse.includes('[LIST_FILES:') ||
                         lmResponse.includes('[READ_FILE:') ||
                         lmResponse.includes('[WRITE_FILE:') ||
                         lmResponse.includes('[LAUNCH:') ||
                         lmResponse.includes('[CLOSE:');

        const isClaimingToSearch = lmResponse.toLowerCase().includes('search') || 
                                   lmResponse.toLowerCase().includes('pulling up') ||
                                   lmResponse.toLowerCase().includes('checking');
        
        if (isClaimingToSearch && !hasTools && iteration === 0) {
            console.log("[Chatbot] Auto-correcting missing search tag...");
            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "system", content: "You said you were searching/checking, but you forgot to use the [SEARCH: query] tag. DO NOT apologize. JUST emit the [SEARCH: query] tag now so I can get the data for you." }
            ], pageContext, iteration + 1, null, preferredModel, customInstructions);
        }

        if (hasTools) {
            console.log(`[Chatbot] Tool detected (Iteration ${iteration + 1}). Executing...`);
            const toolResult = await executeWebTools(lmResponse);
            
            let nextAttachment = attachment;
            if (toolResult.includes('[SYSTEM_IMAGE_ATTACHED]')) {
                try {
                    const bridgeUrl = `http://127.0.0.1:3000/api/system/screenshot`;
                    const response = await fetch(bridgeUrl, { 
                        headers: { 
                            'X-Bridge-Secret': BRIDGE_SECRET,
                            'X-Device-Id': DEVICE_ID
                        } 
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data.image) {
                            nextAttachment = {
                                type: 'image',
                                data: data.image,
                                name: 'system-screenshot.png'
                            };
                        }
                    }
                } catch (e) {
                    console.warn("[Chatbot] Failed to auto-attach screenshot for vision analysis:", e.message);
                }
            }

            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "user", content: `[SYSTEM OBSERVATION]: ${toolResult}\n\nPlease analyze this result and give your final answer to the user now.` }
            ], pageContext, iteration + 1, nextAttachment, preferredModel, customInstructions);
        }
    }

    if (!lmResponse && iteration === 0) return getOfflineResponse(message);
    if (!lmResponse && iteration > 0) {
        return "I've processed your request but my logic core returned an empty result. Please try again or rephrase!";
    }

    return lmResponse || "I'm sorry, I encountered a hiccup while processing that. Could you try again?";
}

/**
 * Executes web intelligence tools found in assistant response.
 */
async function executeWebTools(text) {
    let results = [];
    
    // Handle [SEARCH: query]
    const searchMatch = text.match(/\[SEARCH:\s*([^\]]+)\]/);
    if (searchMatch) {
        const query = searchMatch[1].trim();
        try {
            const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            const resp = await fetch(searchUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                    'Accept': 'text/html'
                }
            });
            const html = await resp.text();
            const resultsList = [];
            const resultRegex = /<a class='result-link' href='([^']+)'>([\s\S]*?)<\/a>[\s\S]*?<td class='result-snippet'>([\s\S]*?)<\/td>/g;
            let match;
            let count = 0;
            while ((match = resultRegex.exec(html)) !== null && count < 4) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                const snippet = match[3].replace(/<[^>]*>/g, '').trim();
                const link = match[1];
                if (title && snippet) {
                    resultsList.push(`- ${title} (${link})\n  ${snippet}`);
                    count++;
                }
            }
            if (resultsList.length > 0) {
                resultsList.push(`\nFull search results: ${searchUrl}`);
                results.push(`WEB SEARCH RESULTS FOR "${query}":\n${resultsList.join('\n\n')}`);
            } else {
                results.push(`SEARCH TRIGGERED FOR "${query}":\nNo direct snippets parsed. See full results here: ${searchUrl}`);
            }
        } catch (e) {
            results.push(`SEARCH FAILED FOR "${query}": ${e.message}`);
        }
    }

    // Handle [FETCH: url]
    const fetchMatch = text.match(/\[FETCH:\s*([^\]]+)\]/);
    if (fetchMatch) {
        const url = fetchMatch[1].trim();
        if (!isUrlSafe(url)) {
            results.push(`SECURITY ERROR: Access to ${url} is restricted. I am not allowed to access internal networks or other people's computers.`);
        } else {
            try {
                const resp = await fetch(url);
                const content = await resp.text();
                results.push(`CONTENT FROM ${url}:\n${content.substring(0, 2000)}...`);
            } catch (e) {
                results.push(`FAILED TO FETCH ${url}: ${e.message}`);
            }
        }
    }

    // Handle [OPEN: url]
    const openMatch = text.match(/\[OPEN:\s*([^\]]+)\]/);
    if (openMatch) {
        const url = openMatch[1].trim();
        const isMediaLink = url.startsWith('spotify:') || url.includes('youtube.com') || url.includes('youtu.be') || url.startsWith('mailto:');
        if (!isUrlSafe(url) && !isMediaLink) {
             results.push(`SECURITY ERROR: Opening ${url} is restricted to protect your network privacy.`);
        } else {
            try {
                const bridgeUrl = `http://127.0.0.1:3000/api/system-media/action`;
                const response = await fetch(bridgeUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-Bridge-Secret': BRIDGE_SECRET,
                        'X-Device-Id': DEVICE_ID
                    },
                    body: JSON.stringify({ action: 'open_uri', uri: url })
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
                }
                results.push(`SUCCESSFULLY OPENED SYSTEM LINK: ${url}`);
            } catch (e) {
                results.push(`FAILED TO OPEN SYSTEM LINK ${url}: ${e.message}`);
            }
        }
    }

    // Handle [PLAY: action]
    const playMatch = text.match(/\[PLAY:\s*([^\]]+)\]/);
    if (playMatch) {
        const action = playMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system-media/action`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                },
                body: JSON.stringify({ action: action })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
            }
            results.push(`MEDIA ACTION EXECUTED: ${action}`);
        } catch (e) {
            results.push(`MEDIA ACTION FAILED: ${e.message}`);
        }
    }

    // Handle [SCREENSHOT]
    if (text.includes('[SCREENSHOT]')) {
        try {
            const bridgeUrl = `http://127.0.0.1:3000/api/system/screenshot`;
            const response = await fetch(bridgeUrl, { 
                headers: { 
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                } 
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.image) {
                results.push(`[SYSTEM_IMAGE_ATTACHED]: A screenshot was successfully captured and is now available for your vision analysis.`);
            } else {
                results.push(`SCREENSHOT FAILED: No image data returned.`);
            }
        } catch (e) {
            results.push(`SCREENSHOT FAILED: ${e.message}`);
        }
    }

    // Handle [LIST_TABS]
    if (text.includes('[LIST_TABS]')) {
        try {
            const bridgeUrl = `http://127.0.0.1:3000/api/system/tabs`;
            const response = await fetch(bridgeUrl, { 
                headers: { 
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                } 
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            results.push(`OPEN BROWSER TABS:\n${JSON.stringify(data.tabs, null, 2)}`);
        } catch (e) {
            results.push(`LIST_TABS FAILED: ${e.message}`);
        }
    }

    // Handle [LIST_APPS]
    if (text.includes('[LIST_APPS]')) {
        try {
            const bridgeUrl = `http://127.0.0.1:3000/api/system/apps`;
            const response = await fetch(bridgeUrl, { 
                headers: { 
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                } 
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            results.push(`RUNNING APPLICATIONS:\n${JSON.stringify(data.apps, null, 2)}`);
        } catch (e) {
            results.push(`LIST_APPS FAILED: ${e.message}`);
        }
    }

    // Handle [LIST_FILES: path]
    const listFilesMatch = text.match(/\[LIST_FILES:\s*([^\]]+)\]/);
    if (listFilesMatch) {
        const path = listFilesMatch[1].trim();
        try {
            const bridgeUrl = `http://127.0.0.1:3000/api/system/files/list?path=${encodeURIComponent(path)}`;
            const response = await fetch(bridgeUrl, { 
                headers: { 
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                } 
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            results.push(`FILES IN ${path}:\n${JSON.stringify(data.files, null, 2)}`);
        } catch (e) {
            results.push(`LIST_FILES FAILED for ${path}: ${e.message}`);
        }
    }

    // Handle [READ_FILE: path]
    const readFileMatch = text.match(/\[READ_FILE:\s*([^\]]+)\]/);
    if (readFileMatch) {
        const path = readFileMatch[1].trim();
        try {
            const bridgeUrl = `http://127.0.0.1:3000/api/system/files/read?path=${encodeURIComponent(path)}`;
            const response = await fetch(bridgeUrl, { 
                headers: { 
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                } 
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            results.push(`CONTENT OF ${path}:\n\`\`\`\n${data.content}\n\`\`\``);
        } catch (e) {
            results.push(`READ_FILE FAILED for ${path}: ${e.message}`);
        }
    }

    // Handle [WRITE_FILE: data]
    const writeFileMatch = text.match(/\[WRITE_FILE:\s*({.+?})\]/);
    if (writeFileMatch) {
        try {
            const data = JSON.parse(writeFileMatch[1]);
            const bridgeUrl = `http://127.0.0.1:3000/api/system/files/write`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const resData = await response.json();
            results.push(`WRITE_FILE SUCCESS: ${resData.message}`);
        } catch (e) {
            results.push(`WRITE_FILE FAILED: ${e.message}`);
        }
    }

    // Handle [LAUNCH: app_id]
    const launchMatch = text.match(/\[LAUNCH:\s*([^\]]+)\]/);
    if (launchMatch) {
        const appId = launchMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system/launch`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                },
                body: JSON.stringify({ appId: appId })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
            }
            results.push(`SYSTEM COMMAND EXECUTED: Successfully launched ${appId} on your PC.`);
        } catch (e) {
            results.push(`SYSTEM COMMAND FAILED: Could not launch ${appId}. Error: ${e.message}`);
        }
    }

    // Handle [CLOSE: app_id]
    const closeMatch = text.match(/\[CLOSE:\s*([^\]]+)\]/);
    if (closeMatch) {
        const appId = closeMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system/close`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Bridge-Secret': BRIDGE_SECRET,
                    'X-Device-Id': DEVICE_ID
                },
                body: JSON.stringify({ appId: appId })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
            }
            results.push(`SYSTEM COMMAND EXECUTED: Successfully closed ${appId} on your PC.`);
        } catch (e) {
            results.push(`SYSTEM COMMAND FAILED: Could not close ${appId}. Error: ${e.message}`);
        }
    }

    // Handle [ARCADE: action]
    const arcadeMatch = text.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
        const action = arcadeMatch[1].trim();
        results.push(`ARCADE PROTOCOL COMMAND REGISTERED: ${action}. The frontend will execute this action immediately.`);
    }

    // Handle [PUBLISH: data]
    const pubMatch = text.match(/\[PUBLISH:\s*({.+?})\]/);
    if (pubMatch) {
        results.push(`PUBLISH PROTOCOL INITIALIZED: The post is being processed and published to the live feed by the frontend protocol.`);
    }

    // Handle [COMPOSE: text]
    const compMatch = text.match(/\[COMPOSE:\s*(.+?)\]/);
    if (compMatch) {
        results.push(`COMPOSE PROTOCOL INITIALIZED: The messenger input is being pre-filled with your refined text.`);
    }

    return results.join('\n\n');
}

/**
 * Provides basic arcade-themed responses when no LLM is available.
 */
function getOfflineResponse(message) {
    const input = message.toLowerCase();
    if (input.includes("pinball")) {
        return "🕹️ [Arcade Protocol]: In Neon Pinball, try hitting the top bumpers to trigger the 'Gravity Shift' multiplier. Keep those flippers sharp!";
    }
    if (input.includes("basketball") || input.includes("hoops")) {
        return "🏀 [Arcade Protocol]: For Neon Hoops, the release angle is everything. Aim for the top of the rim's arc for maximum 'Perfect' shot consistency.";
    }
    if (input.includes("snake")) {
        return "🐍 [Arcade Protocol]: In Neon Snake, the board wraps around. Use the edges to your advantage to trap high-value powerups!";
    }
    if (input.includes("code") || input.includes("js") || input.includes("javascript")) {
        return "💻 [Arcade Protocol]: I'm currently in lightweight offline mode. Connect my logic core (LM Studio or Ollama) to generate full code architectures!";
    }
    return "🎮 I'm operating in lightweight mode. Connect a local inference server (LM Studio/Ollama) to unlock my full tactical intelligence!";
}
