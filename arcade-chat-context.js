/**
 * Arcade Chat Context Manager
 * Handles building compact context for the AI model, including Workshop editor data and protocol directives.
 */

window.ArcadeChatContext = (function() {
    const MAX_EDIT_SOURCE_CHARS = 7000;
    const MAX_EDIT_DIRECTIVES_CHARS = 2500;
    const MAX_EDIT_POST_CONTEXT_CHARS = 7800;
    const MAX_NORMAL_CONTEXT_CHARS = 14000;

    function truncateMiddle(value = '', maxChars = 12000) {
        const text = `${value || ''}`;
        const limit = Math.max(1000, Number(maxChars) || 12000);
        if (text.length <= limit) return text;
        const head = Math.floor(limit * 0.62);
        const tail = Math.max(500, limit - head - 160);
        return `${text.slice(0, head)}\n\n[...trimmed ${text.length - head - tail} characters to keep the local-model payload small...]\n\n${text.slice(-tail)}`;
    }

    function isEditLikeMessage(value = '') {
        const text = `${value || ''}`.trim().toLowerCase();
        return /^\/(?:edit|fix|rewrite)\b/.test(text)
            || /^\[(?:edit|fix|rewrite)\]/.test(text)
            || /workshop validation|workshop editor|active_workshop_editor|active_workshop_editor_compact|\[edit\]/i.test(text);
    }

    function compactWorkshopEditor(editor = null, includeSource = false) {
        if (!editor) return null;
        const source = `${editor.activeFileContent || ''}`;
        return {
            activeGameId: `${editor.activeGameId || editor.gameId || ''}`.trim(),
            activeGameTitle: `${editor.activeGameTitle || editor.gameTitle || editor.title || ''}`.trim(),
            activeFileName: `${editor.activeFileName || editor.fileName || 'index.html'}`.trim(),
            activeFileContentLength: source.length,
            activeFileContentProvidedInEditProtocol: Boolean(includeSource),
            ...(includeSource ? { activeFileContent: truncateMiddle(source, MAX_EDIT_SOURCE_CHARS) } : {})
        };
    }

    return {
        buildModelContext: function(text, richContext, options = {}) {
            const { editRequestActive, attachment, sharedAiContext } = options;
            const safeRichContext = richContext || {};
            const compactEditor = compactWorkshopEditor(safeRichContext.workshopEditor, editRequestActive);

            const contextForModel = {
                ...safeRichContext,
                workshopEditor: compactEditor
            };

            const protocolDirectives = typeof window.getProtocolDirectives === 'function'
                ? window.getProtocolDirectives(text, safeRichContext, attachment)
                : '';

            if (editRequestActive) {
                const compactDirectives = truncateMiddle(protocolDirectives, MAX_EDIT_DIRECTIVES_CHARS);
                return [
                    compactDirectives,
                    '[ACTIVE_WORKSHOP_EDITOR_COMPACT]',
                    JSON.stringify(compactEditor || null),
                    'Return only the smallest valid [EDIT] block needed to satisfy the user. Do not ask for pasted code.'
                ].filter(Boolean).join('\n\n');
            }

            const pageContext = truncateMiddle(JSON.stringify(contextForModel), MAX_NORMAL_CONTEXT_CHARS);
            const pageText = safeRichContext.workshopEditor ? '' : document.body.innerText.substring(0, 300);
            return `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${sharedAiContext ? `${sharedAiContext}\n\n` : ''}${pageContext} (Visible text: ${pageText})`;
        },
        truncateMiddle,
        isEditLikeMessage,
        limits: {
            MAX_EDIT_SOURCE_CHARS,
            MAX_EDIT_DIRECTIVES_CHARS,
            MAX_EDIT_POST_CONTEXT_CHARS,
            MAX_NORMAL_CONTEXT_CHARS
        }
    };
})();

/**
 * Quiet bridge probe and compact /edit POST guard.
 *
 * This wrapper does two things before arcade-chat.js sends requests:
 * - GET /models and GET /health localhost probes are answered quietly when no
 *   bridge is confirmed online, avoiding noisy connection-refused loops.
 * - /edit, /fix, and /rewrite POST bodies are stripped of stale history,
 *   attachments, and oversized page context before they reach LM Studio.
 */
(function installQuietBridgeProbeGuard() {
    if (window.__arcadeQuietBridgeProbeGuardInstalled || !window.fetch) return;
    window.__arcadeQuietBridgeProbeGuardInstalled = true;

    const originalFetch = window.fetch.bind(window);

    function isLoopbackHost(hostname = '') {
        const host = `${hostname || ''}`.trim().toLowerCase();
        return host === 'localhost'
            || host === '127.0.0.1'
            || host === '::1'
            || host === '[::1]';
    }

    function getRequestMethod(input, init = {}) {
        return `${init?.method || input?.method || 'GET'}`.toUpperCase();
    }

    function parseUrl(input) {
        const rawUrl = typeof input === 'string' ? input : `${input?.url || ''}`;
        if (!rawUrl) return null;
        try {
            return new URL(rawUrl, window.location.href);
        } catch (_error) {
            return null;
        }
    }

    function isBackgroundBridgeProbe(input, init = {}) {
        if (getRequestMethod(input, init) !== 'GET') return false;
        const url = parseUrl(input);
        if (!url || !isLoopbackHost(url.hostname)) return false;
        return /^\/api\/(?:local-llm|llm)\/models$/i.test(url.pathname)
            || /^\/api\/local-llm\/health$/i.test(url.pathname);
    }

    function isChatPost(input, init = {}) {
        if (getRequestMethod(input, init) !== 'POST') return false;
        const url = parseUrl(input);
        if (!url) return false;
        return /^\/api\/(?:local-llm|llm)\/chat$/i.test(url.pathname);
    }

    function sanitizeChatPostBody(body) {
        if (typeof body !== 'string' || !body.trim()) return body;
        try {
            const payload = JSON.parse(body);
            const message = `${payload.message || ''}`;
            const context = `${payload.pageContext || ''}`;
            const isEditPayload = window.ArcadeChatContext?.isEditLikeMessage?.(message)
                || /active_workshop_editor|active_workshop_editor_compact|workshop edit|\[edit\]/i.test(context);
            if (!isEditPayload) return body;

            payload.history = [];
            payload.attachment = null;
            payload.customInstructions = `${payload.customInstructions || ''}`.slice(0, 1000);
            payload.message = window.ArcadeChatContext.truncateMiddle(message, 3500);
            payload.pageContext = window.ArcadeChatContext.truncateMiddle(
                context,
                window.ArcadeChatContext.limits.MAX_EDIT_POST_CONTEXT_CHARS
            );
            payload.optimizedForLocalEditModel = true;
            return JSON.stringify(payload);
        } catch (_error) {
            return body;
        }
    }

    window.fetch = function arcadeQuietBridgeProbeFetch(input, init = {}) {
        if (isBackgroundBridgeProbe(input, init)) {
            return Promise.resolve(new Response(JSON.stringify({
                ok: false,
                models: [],
                quietBridgeProbeSkipped: true,
                message: 'Background bridge probe skipped because no bridge is currently confirmed online.'
            }), {
                status: 503,
                statusText: 'Bridge probe skipped',
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }));
        }

        if (isChatPost(input, init) && typeof init?.body === 'string') {
            return originalFetch(input, {
                ...init,
                body: sanitizeChatPostBody(init.body)
            });
        }

        return originalFetch(input, init);
    };
})();

/**
 * Chat latency compatibility patch.
 *
 * arcade-chat.js performs a short bridge preflight when the engine status is
 * offline. That preflight can fail after ~1500ms and abort the real chat POST,
 * making the typing dots disappear almost immediately. This patch keeps health
 * polling intact, but makes send-time preflight advisory by returning true for
 * the short timeout call. The actual chat API request still runs and remains
 * responsible for success/failure.
 */
(function installSendTimePreflightBypass() {
    if (window.__arcadeSendTimePreflightBypassInstalled) return;
    window.__arcadeSendTimePreflightBypassInstalled = true;

    function patch() {
        if (typeof window.checkBridgeConnectivity !== 'function') {
            window.setTimeout(patch, 50);
            return;
        }

        if (window.checkBridgeConnectivity.__sendTimePreflightBypass) return;
        const originalCheckBridgeConnectivity = window.checkBridgeConnectivity;

        window.checkBridgeConnectivity = async function patchedCheckBridgeConnectivity(options = {}) {
            const timeoutMs = Number(options?.timeoutMs || 0);
            const isSendTimePreflight = timeoutMs > 0 && timeoutMs <= 1500;
            if (isSendTimePreflight) {
                console.log('[Arcade Chat] Skipping blocking send-time bridge preflight; allowing chat request to proceed.');
                return true;
            }
            return originalCheckBridgeConnectivity.apply(this, arguments);
        };

        window.checkBridgeConnectivity.__sendTimePreflightBypass = true;
    }

    patch();
})();