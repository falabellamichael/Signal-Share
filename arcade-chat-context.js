/**
 * Arcade Chat Context Manager
 * Gives the local model the active Workshop editor context, then asks for code
 * that can be written directly back into the target file.
 */

window.ArcadeChatContext = (function() {
    const MAX_EDIT_SOURCE_CHARS = 26000;
    const MAX_EDIT_CONTEXT_CHARS = 36000;
    const MAX_NORMAL_CONTEXT_CHARS = 14000;

    function truncateMiddle(value = '', maxChars = 12000) {
        const text = `${value || ''}`;
        const limit = Math.max(1000, Number(maxChars) || 12000);
        if (text.length <= limit) return text;
        const head = Math.floor(limit * 0.65);
        const tail = Math.max(700, limit - head - 180);
        return `${text.slice(0, head)}\n\n[...trimmed ${text.length - head - tail} characters to keep the local-model payload inside context...]\n\n${text.slice(-tail)}`;
    }

    function isEditLikeMessage(value = '') {
        const text = `${value || ''}`.trim().toLowerCase();
        return /^\/(?:edit|fix|rewrite)\b/.test(text)
            || /^\[(?:edit|fix|rewrite)\]/.test(text)
            || /workshop validation|workshop editor|active_workshop_editor|direct_editor_write|\[edit\]/i.test(text);
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

    function buildEditorPayload(editor = null) {
        const source = `${editor?.activeFileContent || ''}`;
        return {
            activeGameId: `${editor?.activeGameId || editor?.gameId || ''}`.trim(),
            activeGameTitle: `${editor?.activeGameTitle || editor?.gameTitle || editor?.title || ''}`.trim(),
            activeFileName: `${editor?.activeFileName || editor?.fileName || 'index.html'}`.trim(),
            activeFileContentLength: source.length,
            activeFileContent: truncateMiddle(source, MAX_EDIT_SOURCE_CHARS),
            activeFileContentProvidedInEditProtocol: true,
            source: editor?.source || 'active-workshop-editor'
        };
    }

    return {
        buildModelContext: function(text, richContext, options = {}) {
            const { editRequestActive, attachment, sharedAiContext } = options;
            const safeRichContext = richContext || {};
            const editorPayload = buildEditorPayload(safeRichContext.workshopEditor || {});

            if (editRequestActive) {
                const fileName = editorPayload.activeFileName || 'index.html';
                const language = languageForFile(fileName);
                const editorContext = {
                    request: `${text || ''}`,
                    workshopEditor: editorPayload,
                    visibleEditorAvailable: true,
                    directEditorWriteMode: true
                };

                return truncateMiddle([
                    '[DIRECT_EDITOR_WRITE_CONTEXT]',
                    'The active Workshop editor is already open. Use the file content below as the source of truth.',
                    JSON.stringify(editorContext),
                    '',
                    `[CURRENT_TARGET_FILE: ${fileName}]`,
                    `\`\`\`${language}`,
                    editorPayload.activeFileContent || '',
                    '```',
                    '',
                    'DIRECT WRITE RULES:',
                    `Edit exactly this target file: ${fileName}`,
                    'Return the complete final code for that file in one markdown code block.',
                    `Use this code-fence header exactly: \`\`\`${language} filename=${fileName}`,
                    'Do not return SEARCH text.',
                    'Do not return REPLACE text.',
                    'Do not return [EDIT] tags.',
                    'Do not return a diff or snippet.',
                    'Do not ask me to paste code.',
                    'Do not explain outside the code block.',
                    'The app will save your returned code directly into the target Workshop file.'
                ].join('\n'), MAX_EDIT_CONTEXT_CHARS);
            }

            const contextForModel = {
                ...safeRichContext,
                workshopEditor: safeRichContext.workshopEditor ? editorPayload : null
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
            MAX_EDIT_CONTEXT_CHARS,
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
                || /direct_editor_write|active_workshop_editor|workshop edit|\[edit\]/i.test(context);
            if (!isEditPayload) return body;

            payload.history = [];
            payload.attachment = null;
            payload.customInstructions = 'For edit requests, use the active Workshop editor content provided in context and return only the complete final code for the target file in one markdown code block. Do not return SEARCH/REPLACE, [EDIT] tags, diffs, snippets, or prose.';
            payload.message = window.ArcadeChatContext.truncateMiddle(message, 3500);
            payload.pageContext = window.ArcadeChatContext.truncateMiddle(
                context,
                window.ArcadeChatContext.limits.MAX_EDIT_CONTEXT_CHARS
            );
            payload.optimizedForLocalEditModel = true;
            payload.directEditorWriteMode = true;
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
