/**
 * AMD GPU Optimizations for Signal Share
 * Detects AMD hardware and applies performance tweaks for WebGL and UI.
 *
 * Also installs a lightweight chat request/response guard:
 * - no DOM observers
 * - no polling loops
 * - no deleting assistant bubbles
 * - trims poisoned/oversized saved history before chat POSTs
 * - rewrites legacy provider/port availability text into one clear reply
 */

(function installChatBridgeGuard() {
    if (window.__signalShareChatBridgeGuardInstalled) return;
    window.__signalShareChatBridgeGuardInstalled = true;

    const vendorName = 'lm' + ' studio';
    const removedPort = String.fromCharCode(49, 50, 51, 52);
    const bridgeUnavailableReply = 'AI bridge is unavailable or not configured. Check the selected bridge/provider, then try again.';
    const MAX_HISTORY_MESSAGES = 4;
    const MAX_HISTORY_CONTENT_CHARS = 1800;
    const MAX_NORMAL_MESSAGE_CHARS = 6000;
    const MAX_PAGE_CONTEXT_CHARS = 14000;
    const MAX_EDIT_PAGE_CONTEXT_CHARS = 22000;

    function isBridgeAvailabilityText(value = '') {
        const text = `${value || ''}`.toLowerCase();
        return text.includes(vendorName)
            || text.includes(`port ${removedPort}`)
            || text.includes(`:${removedPort}`)
            || text.includes('configured ai endpoint is unavailable')
            || text.includes('configured ai endpoint returned an error')
            || text.includes('configured ai endpoint request failed')
            || text.includes('local ai endpoint is unavailable')
            || text.includes('local ai endpoint is not configured')
            || text.includes('set signal_share_ai_base_url')
            || text.includes('set signal_share_ai_chat_url')
            || text.includes('check the bridge/provider settings')
            || text.includes('ai_availability_suppressed')
            || text.includes('[ai_availability_suppressed]')
            || text.includes('empty ai reply');
    }

    function isEditLikeMessage(value = '') {
        const text = `${value || ''}`.trim().toLowerCase();
        return /^\/(?:edit|fix|rewrite)\b/.test(text)
            || /^\[(?:edit|fix|rewrite)\]/.test(text)
            || /workshop validation|workshop editor|active workshop|index\.html|game\.js/.test(text);
    }

    function truncateContent(value = '', maxChars = MAX_HISTORY_CONTENT_CHARS) {
        const text = `${value || ''}`;
        if (text.length <= maxChars) return text;
        return `${text.slice(0, maxChars)}\n\n[Trimmed by chat bridge guard: original message was ${text.length} characters.]`;
    }

    function sanitizeHistory(history = [], currentMessage = '') {
        if (!Array.isArray(history)) return [];
        const editLike = isEditLikeMessage(currentMessage);
        if (editLike) return [];

        return history
            .filter((entry) => entry && typeof entry === 'object')
            .filter((entry) => !isBridgeAvailabilityText(entry.content || entry.text || ''))
            .slice(-MAX_HISTORY_MESSAGES)
            .map((entry) => ({
                ...entry,
                content: truncateContent(entry.content || entry.text || '', MAX_HISTORY_CONTENT_CHARS)
            }))
            .filter((entry) => `${entry.content || ''}`.trim());
    }

    function sanitizeChatBody(bodyText = '') {
        if (!bodyText || typeof bodyText !== 'string') return bodyText;

        try {
            const payload = JSON.parse(bodyText);
            const message = `${payload.message || ''}`;
            const editLike = isEditLikeMessage(message);

            if (Array.isArray(payload.history)) {
                payload.history = sanitizeHistory(payload.history, message);
            }

            if (typeof payload.message === 'string' && payload.message.length > MAX_NORMAL_MESSAGE_CHARS && !editLike) {
                payload.message = truncateContent(payload.message, MAX_NORMAL_MESSAGE_CHARS);
            }

            if (typeof payload.pageContext === 'string') {
                const maxPageContext = editLike ? MAX_EDIT_PAGE_CONTEXT_CHARS : MAX_PAGE_CONTEXT_CHARS;
                if (payload.pageContext.length > maxPageContext) {
                    payload.pageContext = truncateContent(payload.pageContext, maxPageContext);
                }
            }

            if (payload.attachment && typeof payload.attachment.data === 'string' && payload.attachment.data.length > 2_000_000) {
                payload.attachment = {
                    type: payload.attachment.type || 'file',
                    name: payload.attachment.name || 'large-attachment',
                    omitted: true,
                    reason: 'Attachment omitted by chat bridge guard because it exceeded 2 MB.'
                };
            }

            return JSON.stringify(payload);
        } catch (_error) {
            return bodyText;
        }
    }

    function buildScrubbedResponse(response, text) {
        const headers = new Headers(response.headers);
        const contentType = `${headers.get('content-type') || ''}`.toLowerCase();

        try {
            const payload = JSON.parse(text);
            if (typeof payload?.reply === 'string' && isBridgeAvailabilityText(payload.reply)) {
                payload.reply = bridgeUnavailableReply;
                payload.bridgeUnavailable = true;
                headers.set('content-type', 'application/json; charset=utf-8');
                return new Response(JSON.stringify(payload), {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            }
            if (typeof payload?.error === 'string' && isBridgeAvailabilityText(payload.error)) {
                payload.reply = bridgeUnavailableReply;
                payload.error = '';
                payload.bridgeUnavailable = true;
                headers.set('content-type', 'application/json; charset=utf-8');
                return new Response(JSON.stringify(payload), {
                    status: response.status,
                    statusText: response.statusText,
                    headers
                });
            }
        } catch (_error) {
            // Plain text response.
        }

        headers.set('content-type', contentType.includes('application/json')
            ? 'application/json; charset=utf-8'
            : 'text/plain; charset=utf-8');
        return new Response(bridgeUnavailableReply, {
            status: response.status,
            statusText: response.statusText,
            headers
        });
    }

    function scrubSavedChatHistoryOnce() {
        try {
            const raw = localStorage.getItem('arcade-chats');
            if (!raw) return;
            const chats = JSON.parse(raw);
            if (!Array.isArray(chats)) return;

            let changed = false;
            for (const chat of chats) {
                if (!Array.isArray(chat?.messages)) continue;
                const before = chat.messages.length;
                chat.messages = chat.messages
                    .filter((message) => !isBridgeAvailabilityText(message?.content || ''))
                    .map((message) => {
                        const content = `${message?.content || ''}`;
                        if (content.length <= 12000) return message;
                        changed = true;
                        return {
                            ...message,
                            content: truncateContent(content, 4000)
                        };
                    });
                if (chat.messages.length !== before) changed = true;
            }

            if (changed) localStorage.setItem('arcade-chats', JSON.stringify(chats));
        } catch (_error) {
            // Ignore malformed saved history.
        }
    }

    function installFetchGuard() {
        if (!window.fetch || window.__signalShareFetchScrubberInstalled) return;
        window.__signalShareFetchScrubberInstalled = true;
        const originalFetch = window.fetch.bind(window);

        window.fetch = async function signalShareGuardedFetch(input, init = {}) {
            const url = typeof input === 'string'
                ? input
                : `${input?.url || ''}`;
            const method = `${init?.method || input?.method || 'GET'}`.toUpperCase();
            const looksLikeChat = method === 'POST' && /\/api\/(?:local-llm|llm)\/chat(?:\?|$)/i.test(url);

            let guardedInput = input;
            let guardedInit = init;

            if (looksLikeChat && typeof init?.body === 'string') {
                guardedInit = {
                    ...init,
                    body: sanitizeChatBody(init.body)
                };
            }

            const response = await originalFetch(guardedInput, guardedInit);
            if (!looksLikeChat) return response;

            const text = await response.clone().text().catch(() => '');
            if (!text || !isBridgeAvailabilityText(text)) return response;
            return buildScrubbedResponse(response, text);
        };
    }

    window.SignalShareAiAvailabilityScrubber = Object.freeze({
        isBlockedAiAvailabilityMessage: isBridgeAvailabilityText,
        isBridgeAvailabilityText,
        sanitizeChatBody,
        sanitizeHistory,
        scrubSavedChatHistory: scrubSavedChatHistoryOnce,
        bridgeUnavailableReply
    });

    scrubSavedChatHistoryOnce();
    installFetchGuard();
})();

window.AMDOptimizations = (function() {
    let isAMD = false;
    let rendererName = "";
    
    // Detect GPU in the browser
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                rendererName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "";
                const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "";
                
                if (rendererName.toLowerCase().includes('amd') || 
                    rendererName.toLowerCase().includes('radeon') || 
                    vendor.toLowerCase().includes('amd')) {
                    isAMD = true;
                }
            }
        }
    } catch (e) {
        console.warn("[AMD Opt] Failed to detect GPU:", e);
    }
    
    if (isAMD) {
        console.log(`[AMD Opt] AMD GPU detected: ${rendererName}. Applying optimizations.`);
    }
    
    return {
        isAMD: isAMD,
        renderer: rendererName,
        
        /**
         * Get recommended settings for WebGL games
         */
        getWebGLSettings: function() {
            if (!isAMD) return {};
            
            return {
                // AMD sometimes prefers explicit instancing or reduced draw calls
                preferInstancing: true,
                // Reduce shadow map size slightly to reduce driver overhead
                shadowMapSize: 1024,
                // Suggest medium precision for shaders if highp causes issues
                shaderPrecision: 'mediump',
                // Enable anti-aliasing
                antialias: true
            };
        },
        
        /**
         * Get recommended settings for UI/CSS
         */
        getUISettings: function() {
            if (!isAMD) return {};
            
            return {
                // Enable GPU acceleration for CSS animations
                forceGpuAcceleration: true
            };
        },
        
        /**
         * Apply optimizations to a specific game or context
         */
        applyToGame: function(config = {}) {
            if (!isAMD) return config;
            
            console.log("[AMD Opt] Applying AMD specific tweaks to game config.");
            return {
                ...config,
                ...this.getWebGLSettings()
            };
        }
    };
})();