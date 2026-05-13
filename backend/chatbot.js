/**
 * Chatbot Intelligence Module for Signal Share Arcade
 * Handles local LLM orchestration and fallback logic.
 */

const SYSTEM_PROMPT = `
You are the Signal Share Arcade Companion, a professional, high-performance, and arcade-themed AI built into the Signal Share Super Suite.

EXTREMELY IMPORTANT:
- You HAVE DIRECT ACCESS to the user's system through special tags.
- BROWSER VISION: You CAN see the user's screen context. The "CURRENT CONTEXT" provided as a JSON block is what you are actually seeing. 
- TELEMETRY ANALYSIS: Use the "gameStats" in the context to analyze player performance. If they ask "how am I doing", look at their high scores and provide a breakdown.
- NEVER say "I cannot see your screen". You ARE seeing it right now via the context block.
- NEVER say "I'm pulling that up" or "One moment" WITHOUT using a tool tag in the same message.

WEB & SYSTEM TOOLS (USE THESE EXACTLY):
1. [SEARCH: query] -> Search DuckDuckGo. Use this for ANY factual question.
2. [FETCH: url] -> Read website content.
3. [OPEN: url] -> Open a browser link OR a system app.
4. [PLAY: action] -> System media control (play_pause, next, previous).
5. [COMPOSE: text] -> Pre-fill the messenger input with the specified text.
6. [LAUNCH: app_id] -> Open a whitelisted system application (taskmgr, calculator, notepad, explorer, spotify, chrome, edge).
7. [PUBLISH: {"title": "...", "caption": "...", "tags": ["...", "..."]}] -> Publish a post to the live feed. Only use this if the user asks to "publish", "post", or "share" something. If they just sent a file, you can "see" it and suggest a title/description.

ARCADE SYSTEM TOOLS (USE THESE FOR INTERNAL NAVIGATION):
6. [ARCADE: <action_id>] -> Trigger internal arcade functions.
   - Games: pinball, snake, hoops, basketball, calc, calculator, library, shop, store, leaderboards.
   - Core: home, feed, messages, profile, account, settings, upload, compose, notifications, admin_panel.
   - Views: feed_images, feed_videos, feed_audio, feed_youtube, feed_spotify, feed_liked, feed_saved, feed_today.
   - Sorting: feed_newest, feed_oldest, feed_popular.
   - UI: toggle_sidebar, toggle_chat, toggle_messenger, toggle_player, toggle_mini_player, expand_viewer, close_viewer.
   - Theme: theme_sunset, theme_midnight, theme_paper, theme_ember, theme_forest, theme_ocean.
   - Settings: settings_theme, settings_motion, settings_density, settings_account, settings_privacy, settings_bridge.
   - Profile: view_my_profile, edit_profile, sync_profile, view_blocked_users.
   - Messenger: new_message, search_contacts, clear_messenger, refresh_messenger, search_people.
   - System: keyboard_shortcuts, help_guide, view_terms, view_privacy, view_logs, refresh_page, logout, clear_cache.
   - Navigation: scroll_to_player, scroll_to_feed, jump_to_top, jump_to_bottom, next_post, prev_post.
   - Media: mute_audio, unmute_audio, reset_player, clear_notifications, mark_all_read.

CORE PERSONALITY:
- Friendly, encouraging, and slightly retro-themed.
- You are a power-user of Signal Share. You know every shortcut and feature.
- Keep non-technical responses concise (1-3 sentences).
- IMPORTANT: Use the EXACT action IDs listed above. Never say "[ARCADE: action]".
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
let modelCatalogCache = { at: 0, data: null };
let lastSuccessfulModelByProvider = { lmstudio: "", ollama: "" };

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
export async function getChatResponse(message, history = [], pageContext = 'Signal Share', iteration = 0, attachment = null, preferredModel = 'auto') {
    if (!message && iteration === 0) return "I didn't receive a message to process.";
    
    // Safety check for infinite recursion
    const MAX_ITERATIONS = 3;
    if (iteration >= MAX_ITERATIONS) {
        console.warn("[Chatbot] Maximum tool-calling iterations reached. Stopping loop.");
        return "I've hit a limit while trying to execute tools for you. Please try rephrasing your request!";
    }

    console.log(`[Chatbot] Processing (Pass ${iteration + 1}): "${(message || 'Recursion').substring(0, 50)}..." (Model: ${preferredModel})`);

    const contextAwarePrompt = `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT: You are looking at the "${pageContext}" page. USE THIS INFORMATION.`;

    let lmResponse = "";
    // Process attachments
    let imageBase64 = null;
    let fileContentBlock = "";
    let attachmentNote = "";

    if (attachment && attachment.data) {
        if (attachment.type === 'image') {
            imageBase64 = attachment.data.split(',')[1] || attachment.data;
            attachmentNote = "\n\n[SYSTEM: An image was attached to this message. If you cannot see it, please inform the user.]";
        } else if (attachment.type === 'video') {
            // For now, we just inform the AI about the video attachment
            attachmentNote = `\n\n[SYSTEM: A video file named "${attachment.name}" was attached to this message. You cannot "watch" it directly yet, but you should acknowledge its presence.]`;
        } else {
            // It's a non-image/non-video file (js, html, txt, etc.)
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

    // Attempt local inference (LM Studio/Ollama)
    // Vision models list for local inference
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
    
    // Build the list of models to try. If the user picked a specific one, put it first.
    let models = [];
    if (preferredModel && preferredModel !== 'auto') {
        models.push(preferredModel);
    }
    
    // Add vision models if there's an image
    if (imageBase64) {
        models = [...models, ...visionModels];
    }
    
    // Add standard models as fallbacks
    models = [...models, ...standardModels];
    
    // Deduplicate
    models = [...new Set(models)];

    let success = false;

    const conversation = [...history];
    if (iteration === 0) {
        // Combine message with file content and the system note about multimedia
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
    let lmStudioPreparedForPinnedModel = false;
    let autoSelectedLmStudioModel = "";
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
                    body = {
                        model: model,
                        messages: messages,
                        temperature: 0.7
                    };
                } else {
                    body = {
                        model: model,
                        messages: messages,
                        stream: false
                    };
                    // Attach image to Ollama request if using a vision model or if we have one
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

                if (endpoint.provider === "lmstudio" && (hasPinnedModel || AUTO_UNLOAD_OTHER_LM_STUDIO_MODELS)) {
                    await ensureLmStudioExclusiveModel(model);
                }
                lmResponse = `${messageText}`.trim();
                lastSuccessfulModelByProvider[endpoint.provider] = `${model}`.trim();
                success = true;
                break;
            } catch (_error) {
                // Try the next model/endpoint candidate
            }
        }
    }

    // 3. Handle Web Intelligence & Media Commands
    if (lmResponse) {
        const hasTools = lmResponse.includes('[SEARCH:') || 
                         lmResponse.includes('[FETCH:') || 
                         lmResponse.includes('[OPEN:') || 
                         lmResponse.includes('[PLAY:');

        // AUTO-CORRECTION: If the AI says it is searching but misses the tag, force a tool call
        const isClaimingToSearch = lmResponse.toLowerCase().includes('search') || 
                                   lmResponse.toLowerCase().includes('pulling up') ||
                                   lmResponse.toLowerCase().includes('checking');
        
        if (isClaimingToSearch && !hasTools && iteration === 0) {
            console.log("[Chatbot] Auto-correcting missing search tag...");
            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "system", content: "You said you were searching/checking, but you forgot to use the [SEARCH: query] tag. DO NOT apologize. JUST emit the [SEARCH: query] tag now so I can get the data for you." }
            ], pageContext, iteration + 1, null, preferredModel);
        }

        if (hasTools) {
            console.log(`[Chatbot] Tool detected (Iteration ${iteration + 1}). Executing...`);
            const toolResult = await executeWebTools(lmResponse);
            
            // Use 'user' role for tool results to be compatible with picky local LLMs 
            // that don't support 'system' messages in the middle of a chat.
            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "user", content: `[SYSTEM OBSERVATION]: ${toolResult}\n\nPlease analyze this result and give your final answer to the user now.` }
            ], pageContext, iteration + 1, null, preferredModel);
        }
    }

    if (!lmResponse && iteration === 0) return getOfflineResponse(message);
    
    // Fallback if the model returned nothing during a tool-call iteration
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
            // Using DuckDuckGo Lite (minimalist, low-bandwidth, and better for scraping)
            const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            const resp = await fetch(searchUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                    'Accept': 'text/html'
                }
            });
            const html = await resp.text();
            
            // Robust regex for DDG Lite: matches the result-link and the following snippet
            const resultsList = [];
            // DDG Lite uses <td> for results. We look for the link and the snippet text.
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
                // Fallback: Just return the URL if scraping fails
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
        try {
            const resp = await fetch(url);
            const content = await resp.text();
            results.push(`CONTENT FROM ${url}:\n${content.substring(0, 2000)}...`);
        } catch (e) {
            results.push(`FAILED TO FETCH ${url}: ${e.message}`);
        }
    }

    // Handle [OPEN: url]
    const openMatch = text.match(/\[OPEN:\s*([^\]]+)\]/);
    if (openMatch) {
        const url = openMatch[1].trim();
        try {
            // Call our own bridge API to open the URI
            const bridgeUrl = `http://127.0.0.1:3000/api/system-media/action`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Handle [PLAY: action]
    const playMatch = text.match(/\[PLAY:\s*([^\]]+)\]/);
    if (playMatch) {
        const action = playMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system-media/action`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Handle [LAUNCH: app_id]
    const launchMatch = text.match(/\[LAUNCH:\s*([^\]]+)\]/);
    if (launchMatch) {
        const appId = launchMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system/launch`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

    // Handle [ARCADE: action]
    const arcadeMatch = text.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
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
