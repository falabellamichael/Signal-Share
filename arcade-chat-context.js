/**
 * Arcade Chat Context Manager
 * Handles compact context for the AI model, including Workshop editor data.
 */

window.ArcadeChatContext = (function() {
    const MAX_EDIT_SOURCE_CHARS = 11000;
    const MAX_EDIT_POST_CONTEXT_CHARS = 14000;
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
            || /workshop validation|workshop editor|active_workshop_editor|active_workshop_editor_code_payload|\[edit\]/i.test(text);
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

    function languageForFile(fileName = '') {
        const ext = `${fileName || ''}`.split('.').pop()?.toLowerCase();
        if (ext === 'html' || ext === 'htm') return 'html';
        if (ext === 'css') return 'css';
        if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
        if (ext === 'json') return 'json';
        if (ext === 'svg') return 'xml';
        return 'text';
    }

    return {
        buildModelContext: function(text, richContext, options = {}) {
            const { editRequestActive, attachment, sharedAiContext } = options;
            const safeRichContext = richContext || {};
            const compactEditor = compactWorkshopEditor(safeRichContext.workshopEditor, editRequestActive);

            if (editRequestActive) {
                const fileName = compactEditor?.activeFileName || 'index.html';
                const language = languageForFile(fileName);
                return [
                    '[ACTIVE_WORKSHOP_EDITOR_CODE_PAYLOAD]',
                    JSON.stringify(compactEditor || null),
                    '',
                    'EDIT MODE RULES:',
                    `You are editing exactly this file: ${fileName}`,
                    'Write the corrected code for that file.',
                    'Return code only in one markdown code block.',
                    `Use this code-fence header: \`\`\`${language} filename=${fileName}`,
                    'Do not return SEARCH text.',
                    'Do not return REPLACE text.',
                    'Do not return [EDIT] tags.',
                    'Do not explain. Do not ask for pasted code.',
                    'The app will save the returned code directly into the target file.'
                ].join('\n');
            }

            const contextForModel = {
                ...safeRichContext,
                workshopEditor: compactEditor
            };
            const protocolDirectives = typeof window.getProtocolDirectives === 'function'
                ? window.getProtocolDirectives(text, safeRichContext, attachment)
                : '';
            const pageContext = truncateMiddle(JSON.stringify(contextForModel), MAX_NORMAL_CONTEXT_CHARS);
            const pageText = safeRichContext.workshopEditor ? '' : document.body.innerText.substring(0, 300);
            return `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${sharedAiContext ? `${sharedAiContext}\n\n` : ''}${pageContext} (Visible text: ${pageText})`;
        },
        truncateMiddle,
        isEditLikeMessage,
        limits: {
            MAX_EDIT_SOURCE_CHARS,
            MAX_EDIT_POST_CONTEXT_CHARS,
            MAX_NORMAL_CONTEXT_CHARS
        }
    };
})();

/**
 * Quiet bridge probe and compact /edit POST guard.
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
                || /active_workshop_editor|active_workshop_editor_code_payload|workshop edit|\[edit\]/i.test(context);
            if (!isEditPayload) return body;

            payload.history = [];
            payload.attachment = null;
            payload.customInstructions = 'For edit requests, return only code in one markdown code block. Do not return SEARCH/REPLACE or [EDIT] patches.';
            payload.message = window.ArcadeChatContext.truncateMiddle(message, 3500);
            payload.pageContext = window.ArcadeChatContext.truncateMiddle(
                context,
                window.ArcadeChatContext.limits.MAX_EDIT_POST_CONTEXT_CHARS
            );
            payload.optimizedForLocalEditModel = true;
            payload.directCodeEditMode = true;
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
