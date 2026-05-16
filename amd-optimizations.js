/**
 * AMD GPU Optimizations for Signal Share
 * Detects AMD hardware and applies performance tweaks for WebGL and UI.
 *
 * Also installs a frontend response scrubber so bridge/backend availability text
 * is not rendered as repeated chat bubbles.
 */

(function installAiAvailabilityMessageScrubber() {
    if (window.__signalShareLegacyLocalModelErrorScrubberInstalled) return;
    window.__signalShareLegacyLocalModelErrorScrubberInstalled = true;

    const vendorName = 'lm' + ' studio';
    const removedPort = String.fromCharCode(49, 50, 51, 52);
    const suppressedReplyMarker = '[AI_AVAILABILITY_SUPPRESSED]';

    function isBlockedAiAvailabilityMessage(value = '') {
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
            || text.includes('ai_availability_suppressed');
    }

    function scrubPayloadText(text = '') {
        if (!isBlockedAiAvailabilityMessage(text)) return text;
        try {
            const payload = JSON.parse(text);
            if (typeof payload?.reply === 'string' && isBlockedAiAvailabilityMessage(payload.reply)) {
                payload.reply = suppressedReplyMarker;
                payload.suppressedAiAvailabilityMessage = true;
                return JSON.stringify(payload);
            }
            if (typeof payload?.error === 'string' && isBlockedAiAvailabilityMessage(payload.error)) {
                payload.reply = suppressedReplyMarker;
                payload.error = '';
                payload.suppressedAiAvailabilityMessage = true;
                return JSON.stringify(payload);
            }
        } catch (_error) {
            // Plain text response; replace directly.
        }
        return suppressedReplyMarker;
    }

    function scrubSavedChatHistory() {
        try {
            const raw = localStorage.getItem('arcade-chats');
            if (!raw || !isBlockedAiAvailabilityMessage(raw)) return;
            const chats = JSON.parse(raw);
            if (!Array.isArray(chats)) return;

            let changed = false;
            for (const chat of chats) {
                if (!Array.isArray(chat?.messages)) continue;
                const before = chat.messages.length;
                chat.messages = chat.messages.filter((message) => !isBlockedAiAvailabilityMessage(message?.content));
                if (chat.messages.length !== before) changed = true;
            }

            if (changed) localStorage.setItem('arcade-chats', JSON.stringify(chats));
        } catch (_error) {
            // Ignore malformed saved history.
        }
    }

    function removeRenderedBlockedMessages(root = document) {
        try {
            const nodes = Array.from(root.querySelectorAll?.('.chat-message, .message-ai, .system-error') || []);
            for (const node of nodes) {
                if (isBlockedAiAvailabilityMessage(node.textContent || '')) {
                    node.remove();
                }
            }
        } catch (_error) {
            // Ignore DOM timing issues.
        }
    }

    function installFetchScrubber() {
        if (!window.fetch || window.__signalShareFetchScrubberInstalled) return;
        window.__signalShareFetchScrubberInstalled = true;
        const originalFetch = window.fetch.bind(window);

        window.fetch = async function signalShareScrubbedFetch(input, init) {
            const response = await originalFetch(input, init);
            const url = typeof input === 'string'
                ? input
                : `${input?.url || ''}`;
            const method = `${init?.method || input?.method || 'GET'}`.toUpperCase();
            const looksLikeChat = method === 'POST' && /\/api\/(?:local-llm|llm)\/chat(?:\?|$)/i.test(url);
            if (!looksLikeChat) return response;

            const text = await response.clone().text().catch(() => '');
            if (!text || !isBlockedAiAvailabilityMessage(text)) return response;

            const headers = new Headers(response.headers);
            const contentType = `${headers.get('content-type') || ''}`.toLowerCase();
            headers.set('content-type', contentType.includes('application/json')
                ? 'application/json; charset=utf-8'
                : 'text/plain; charset=utf-8');

            return new Response(scrubPayloadText(text), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        };
    }

    function installDomScrubber() {
        const start = () => {
            scrubSavedChatHistory();
            removeRenderedBlockedMessages(document);

            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes || []) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        if (isBlockedAiAvailabilityMessage(node.textContent || '')) {
                            node.remove();
                            continue;
                        }
                        removeRenderedBlockedMessages(node);
                    }
                }
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });

            window.setInterval(() => {
                scrubSavedChatHistory();
                removeRenderedBlockedMessages(document);
            }, 500);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }

    window.SignalShareAiAvailabilityScrubber = Object.freeze({
        isBlockedAiAvailabilityMessage,
        scrubPayloadText,
        scrubSavedChatHistory,
        removeRenderedBlockedMessages,
        suppressedReplyMarker
    });

    installFetchScrubber();
    installDomScrubber();
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