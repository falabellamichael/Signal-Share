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

    function buildAiChatbotSupportContext(text, richContext, options = {}) {
        if (!window.AIChatbotSupport || typeof window.AIChatbotSupport.buildSupportContext !== 'function') return '';
        try {
            return window.AIChatbotSupport.buildSupportContext(text, richContext, {
                maxChars: Math.max(12000, Math.floor(MAX_EDIT_CONTEXT_CHARS * 0.72)),
                ...options
            });
        } catch (error) {
            console.warn('[Arcade Chat Context] AI chatbot support context failed:', error);
            return '';
        }
    }

    return {
        buildModelContext: function(text, richContext, options = {}) {
            const { editRequestActive, attachment, sharedAiContext } = options;
            const safeRichContext = richContext || {};
            const editorPayload = buildEditorPayload(safeRichContext.workshopEditor || {});

            if (editRequestActive) {
                const fileName = editorPayload.activeFileName || 'index.html';
                const language = languageForFile(fileName);
                const supportContext = buildAiChatbotSupportContext(text, safeRichContext);
                const editorContext = {
                    request: `${text || ''}`,
                    workshopEditor: editorPayload,
                    visibleEditorAvailable: true,
                    directEditorWriteMode: true,
                    aiChatbotSupportEnabled: !!supportContext
                };

                return truncateMiddle([
                    '[DIRECT_EDITOR_WRITE_CONTEXT]',
                    'The active Workshop editor is already open. Use the file content below as the source of truth.',
                    'AI_CHATBOT_SUPPORT_V1, when present, is the compact file map and implementation scaffold. Trust it before asking for files.',
                    JSON.stringify(editorContext),
                    '',
                    supportContext,
                    '',
                    `[CURRENT_TARGET_FILE: ${fileName}]`,
                    `\`\`\`${language} filename=${fileName}`,
                    editorPayload.activeFileContent || '',
                    '```',
                    '',
                    'DIRECT WRITE RULES:',
                    `Edit exactly this target file unless AI_CHATBOT_SUPPORT_V1 says this is an add-file request: ${fileName}`,
                    'For normal edits, return the complete final code for that file in one markdown code block.',
                    `For normal edits, use this code-fence header exactly: \`\`\`${language} filename=${fileName}`,
                    'For add-file requests, return only the new file block(s), each with filename=<name.ext>.',
                    'Do not return SEARCH text.',
                    'Do not return REPLACE text.',
                    'Do not return [EDIT] tags.',
                    'Do not return a diff or snippet.',
                    'Do not ask me to paste code or list files.',
                    'Do not explain outside the required code block(s).',
                    'The app will save your returned code directly into the target Workshop file or queued new file.'
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
        buildAiChatbotSupportContext,
        limits: {
            MAX_EDIT_SOURCE_CHARS,
            MAX_EDIT_CONTEXT_CHARS,
            MAX_NORMAL_CONTEXT_CHARS
        }
    };
})();

/**
 * Local bridge request guard.
 *
 * Keep the default bridge usable. The app should attempt localhost/127.0.0.1
 * from a local project page without requiring a saved bridge URL/token first.
 */
(function installLocalBridgeRequestGuard() {
    if (window.__arcadeLocalBridgeRequestGuardInstalled || !window.fetch) return;
    window.__arcadeLocalBridgeRequestGuardInstalled = true;

    const originalFetch = window.fetch.bind(window);
    const OFFLINE_UNTIL_KEY = 'ss_bridge_offline_until';
    const OFFLINE_BACKOFF_MS = 5 * 1000;

    function normalizeBoolean(value) {
        const text = `${value ?? ''}`.trim().toLowerCase();
        if (!text) return null;
        if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
        if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
        return null;
    }

    function getStoredValue(...keys) {
        for (const key of keys) {
            const value = `${localStorage.getItem(key) || ''}`.trim();
            if (value) return value;
        }
        return '';
    }

    function isPrivateHost(hostname = '') {
        const host = `${hostname || ''}`.trim().toLowerCase();
        if (!host) return false;
        if (host === 'localhost' || host.endsWith('.localhost')) return true;
        if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
        if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
        const octets = host.split('.').map((part) => Number.parseInt(part, 10));
        return octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
    }

    function isLocalProjectOrigin() {
        const protocol = `${window.location.protocol || ''}`.toLowerCase();
        if (protocol === 'file:') return true;
        return isPrivateHost(window.location.hostname || '');
    }

    function bridgeTrafficAllowed() {
        const explicitEnabled = normalizeBoolean(
            localStorage.getItem('signal-share-bridge-enabled')
            ?? localStorage.getItem('ss_bridge_enabled')
        );
        if (explicitEnabled === false) return false;
        if (explicitEnabled === true) return true;

        const configuredUrl = `${window.SignalShareLocalLlm?.getBridgeBaseUrl?.() || ''}`.trim()
            || getStoredValue('signal-share-bridge-url', 'ss_bridge_url');
        if (configuredUrl) return true;

        const bridgeSecret = getStoredValue(
            'SIGNAL_SHARE_BRIDGE_SECRET',
            'signal-share-bridge-secret',
            'ss_bridge_secret'
        );
        if (bridgeSecret) return true;

        const localToken = `${window.SignalShareLocalLlm?.getLocalLlmToken?.() || ''}`.trim()
            || getStoredValue(
                'SIGNAL_SHARE_LOCAL_LLM_TOKEN',
                'signal-share-local-llm-token',
                'ss_local_llm_token'
            );
        if (localToken) return true;

        const selectedModel = getStoredValue('arcade-chat-model').toLowerCase();
        if (selectedModel && selectedModel !== 'auto') return true;

        return isLocalProjectOrigin();
    }

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

    function isLocalBridgeRoute(url) {
        if (!url || !isLoopbackHost(url.hostname)) return false;
        return /^\/api\/(?:local-llm|llm)\/(?:chat|models|health)$/i.test(url.pathname)
            || /^\/api\/tools\/duckduckgo\/search$/i.test(url.pathname)
            || /^\/api\/assistant\/intent$/i.test(url.pathname)
            || /^\/api\/system-media\/(?:current|action)$/i.test(url.pathname)
            || /^\/api\/system\/apps(?:\/(?:open|action))?$/i.test(url.pathname)
            || /^\/api\/security\/audit$/i.test(url.pathname);
    }

    function isChatPost(input, init = {}) {
        if (getRequestMethod(input, init) !== 'POST') return false;
        const url = parseUrl(input);
        if (!url) return false;
        return /^\/api\/(?:local-llm|llm)\/chat$/i.test(url.pathname);
    }

    function isOfflineBackoffActive() {
        const until = Number(localStorage.getItem(OFFLINE_UNTIL_KEY) || 0);
        return Number.isFinite(until) && until > Date.now();
    }

    function markBridgeOffline() {
        localStorage.setItem(OFFLINE_UNTIL_KEY, String(Date.now() + OFFLINE_BACKOFF_MS));
        window.__arcadeBridgeConfirmedOnline = false;
    }

    function markBridgeOnline() {
        localStorage.removeItem(OFFLINE_UNTIL_KEY);
        window.__arcadeBridgeConfirmedOnline = true;
    }

    function makeBridgeUnavailableResponse(url, reason = 'Local LLM bridge unavailable') {
        return new Response(JSON.stringify({
            ok: false,
            error: reason,
            message: reason,
            route: url?.pathname || '',
            bridgeUnavailable: true
        }), {
            status: 503,
            statusText: 'Bridge unavailable',
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    function makeJsonChatResponse(payload, status = 200) {
        return new Response(JSON.stringify(payload), {
            status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    function classifyMainPageToolIntent(message = '') {
        const raw = `${message || ''}`.trim();
        const text = raw.toLowerCase().replace(/\s+/g, ' ');
        if (!text) return null;

        const searchMatch = raw.match(/^(?:search|look up|lookup|duckduckgo)\s+(?:for\s+)?(.+)$/i);
        if (searchMatch?.[1]?.trim()) {
            return {
                type: 'duckduckgo.search',
                query: searchMatch[1].trim()
            };
        }

        const appMap = [
            { id: 'spotify', words: ['spotify'] },
            { id: 'notepad', words: ['notepad', 'note pad', 'notes'] },
            { id: 'calculator', words: ['calculator', 'calc'] },
            { id: 'file-explorer', words: ['file explorer', 'explorer', 'files'] },
            { id: 'chrome', words: ['chrome', 'google chrome'] },
            { id: 'edge', words: ['edge', 'microsoft edge', 'ms edge'] },
            { id: 'vscode', words: ['vscode', 'vs code', 'visual studio code'] },
            { id: 'discord', words: ['discord'] },
            { id: 'steam', words: ['steam'] }
        ];

        const openRequested = /^(?:open|launch|start)\b/i.test(text);
        if (openRequested) {
            const app = appMap.find((row) => row.words.some((word) => text.includes(word)));
            if (app) {
                return {
                    type: 'pc.open_app',
                    appId: app.id
                };
            }

            return {
                type: 'unsupported',
                reply: 'That app is not available in the allowed desktop app list.'
            };
        }

        const mediaActionMap = [
            { action: 'play_pause', words: ['play pause', 'play/pause', 'pause', 'play'] },
            { action: 'next', words: ['next', 'skip'] },
            { action: 'previous', words: ['previous', 'back'] }
        ];

        const mediaAction = mediaActionMap.find((row) => row.words.some((word) => text === word || text.startsWith(`${word} `)));
        if (mediaAction && text.includes('spotify')) {
            return {
                type: 'pc.app_action',
                appId: 'spotify',
                action: mediaAction.action
            };
        }

        return null;
    }

    async function handleStrictToolChatRequest(input, init = {}) {
        if (!isChatPost(input, init) || typeof init?.body !== 'string') return null;

        let payload = null;
        try {
            payload = JSON.parse(init.body);
        } catch (_error) {
            return null;
        }

        const intent = classifyMainPageToolIntent(payload?.message || '');
        if (!intent) return null;

        const sourceUrl = parseUrl(input);
        if (!sourceUrl) return null;

        if (intent.type === 'unsupported') {
            return makeJsonChatResponse({
                ok: true,
                reply: intent.reply
            });
        }

        if (intent.type === 'duckduckgo.search') {
            const searchUrl = new URL('/api/tools/duckduckgo/search', sourceUrl.origin);
            const response = await originalFetch(searchUrl.href, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(init.headers || {})
                },
                body: JSON.stringify({
                    query: intent.query,
                    maxResults: 5
                })
            });

            if (!response) {
                return makeJsonChatResponse({ ok: true, reply: 'DuckDuckGo search failed.' });
            }

            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.ok) {
                return makeJsonChatResponse({
                    ok: true,
                    reply: 'DuckDuckGo search failed.'
                });
            }

            const results = Array.isArray(data.results) ? data.results : [];
            const reply = results.length
                ? results.map((result, index) => {
                    const title = result.title || 'Untitled result';
                    const url = result.url || '';
                    const snippet = result.snippet ? ` — ${result.snippet}` : '';
                    return `${index + 1}. ${title}\n${url}${snippet}`;
                }).join('\n\n')
                : 'No DuckDuckGo results found.';

            return makeJsonChatResponse({
                ok: true,
                reply,
                tool: intent.type,
                results
            });
        }

        if (intent.type === 'pc.open_app') {
            const appUrl = new URL('/api/system/apps/open', sourceUrl.origin);
            const response = await originalFetch(appUrl.href, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(init.headers || {})
                },
                body: JSON.stringify({
                    appId: intent.appId
                })
            });

            if (!response) {
                return makeJsonChatResponse({ ok: true, reply: 'App open request failed.' });
            }

            const data = await response.json().catch(() => null);
            const reply = response.ok && data?.ok
                ? `Opened ${data.label || intent.appId}.`
                : (data?.error || 'App open request failed.');

            return makeJsonChatResponse({
                ok: true,
                reply,
                tool: intent.type,
                appId: intent.appId
            });
        }

        if (intent.type === 'pc.app_action') {
            const actionUrl = new URL('/api/system/apps/action', sourceUrl.origin);
            const response = await originalFetch(actionUrl.href, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(init.headers || {})
                },
                body: JSON.stringify({
                    appId: intent.appId,
                    action: intent.action
                })
            });

            if (!response) {
                return makeJsonChatResponse({ ok: true, reply: 'App action failed.' });
            }

            const data = await response.json().catch(() => null);
            const reply = response.ok && data?.ok
                ? `Ran ${intent.action} for ${intent.appId}.`
                : (data?.error || 'App action failed.');

            return makeJsonChatResponse({
                ok: true,
                reply,
                tool: intent.type,
                appId: intent.appId,
                action: intent.action
            });
        }

        return null;
    }

    function shouldShortCircuitBridgeRequest(url) {
        if (!isLocalBridgeRoute(url)) return false;
        if (!bridgeTrafficAllowed()) return true;
        return isOfflineBackoffActive() && window.__arcadeBridgeConfirmedOnline === false;
    }

    function sanitizeChatPostBody(body) {
        if (typeof body !== 'string' || !body.trim()) return body;
        try {
            const payload = JSON.parse(body);
            const message = `${payload.message || ''}`;
            const context = `${payload.pageContext || ''}`;
            const isEditPayload = window.ArcadeChatContext?.isEditLikeMessage?.(message)
                || /direct_editor_write|active_workshop_editor|workshop edit|\[edit\]|AI_CHATBOT_SUPPORT/i.test(context);
            if (!isEditPayload) return body;

            const optimizedPayload = window.AIChatbotSupport?.optimizeChatPayload?.(payload) || payload;
            optimizedPayload.history = [];
            optimizedPayload.attachment = null;
            optimizedPayload.customInstructions = [
                optimizedPayload.customInstructions || '',
                'For edit requests, use the active Workshop editor content and AI_CHATBOT_SUPPORT_V1 file map. Return only the complete final code for the target file, or new file block(s) for add-file requests. Do not return SEARCH/REPLACE, [EDIT] tags, diffs, snippets, or prose.'
            ].filter(Boolean).join('\n\n').slice(0, 2600);
            optimizedPayload.message = window.ArcadeChatContext.truncateMiddle(optimizedPayload.message || message, 3500);
            optimizedPayload.pageContext = window.ArcadeChatContext.truncateMiddle(
                optimizedPayload.pageContext || context,
                window.ArcadeChatContext.limits.MAX_EDIT_CONTEXT_CHARS
            );
            optimizedPayload.optimizedForLocalEditModel = true;
            optimizedPayload.directEditorWriteMode = true;
            optimizedPayload.aiChatbotSupport = true;
            return JSON.stringify(optimizedPayload);
        } catch (_error) {
            return body;
        }
    }

    window.fetch = async function arcadeLocalBridgeGuardedFetch(input, init = {}) {
        const url = parseUrl(input);
        const isBridgeRoute = isLocalBridgeRoute(url);

        if (isChatPost(input, init) && typeof init?.body === 'string') {
            const strictToolResponse = await handleStrictToolChatRequest(input, init);
            if (strictToolResponse) return strictToolResponse;
        }

        if (shouldShortCircuitBridgeRequest(url)) {
            const reason = bridgeTrafficAllowed()
                ? 'Local LLM bridge is temporarily offline.'
                : 'Local LLM bridge is disabled.';
            return Promise.resolve(makeBridgeUnavailableResponse(url, reason));
        }

        const nextInit = isChatPost(input, init) && typeof init?.body === 'string'
            ? { ...init, body: sanitizeChatPostBody(init.body) }
            : init;

        try {
            const response = await originalFetch(input, nextInit);
            if (!response) {
                if (isBridgeRoute) {
                    markBridgeOffline();
                    return makeBridgeUnavailableResponse(url, 'Local LLM bridge returned no response.');
                }
                throw new TypeError('Fetch returned no response.');
            }
            if (isBridgeRoute && response.ok) markBridgeOnline();
            return response;
        } catch (error) {
            if (isBridgeRoute) {
                markBridgeOffline();
                return makeBridgeUnavailableResponse(url, error?.message || 'Local LLM bridge request failed.');
            }
            throw error;
        }
    };
})();

/**
 * Chat latency compatibility patch.
 */
(function installSendTimePreflightBypass() {
    if (window.__arcadeSendTimePreflightBypassInstalled) return;
    window.__arcadeSendTimePreflightBypassInstalled = true;

    function isPrivateOrLocalOrigin() {
        const protocol = `${window.location.protocol || ''}`.toLowerCase();
        const host = `${window.location.hostname || ''}`.trim().toLowerCase();
        if (protocol === 'file:') return true;
        if (!host) return false;
        if (host === 'localhost' || host.endsWith('.localhost')) return true;
        if (host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
        if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
        const octets = host.split('.').map((part) => Number.parseInt(part, 10));
        return octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
    }

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
            const explicitEnabled = ['1', 'true', 'yes', 'on', 'enabled'].includes(
                `${localStorage.getItem('ss_bridge_enabled') ?? localStorage.getItem('signal-share-bridge-enabled') ?? ''}`.trim().toLowerCase()
            );
            const explicitDisabled = ['0', 'false', 'no', 'off', 'disabled'].includes(
                `${localStorage.getItem('ss_bridge_enabled') ?? localStorage.getItem('signal-share-bridge-enabled') ?? ''}`.trim().toLowerCase()
            );
            const bridgeConfigured = Boolean(
                explicitEnabled
                || isPrivateOrLocalOrigin()
                || localStorage.getItem('signal-share-bridge-url')
                || localStorage.getItem('ss_bridge_url')
                || localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET')
                || localStorage.getItem('signal-share-bridge-secret')
                || localStorage.getItem('ss_bridge_secret')
                || localStorage.getItem('SIGNAL_SHARE_LOCAL_LLM_TOKEN')
                || localStorage.getItem('signal-share-local-llm-token')
                || localStorage.getItem('ss_local_llm_token')
            );

            if (explicitDisabled) return false;
            if (isSendTimePreflight && !bridgeConfigured) return false;

            return originalCheckBridgeConnectivity.apply(this, arguments);
        };

        window.checkBridgeConnectivity.__sendTimePreflightBypass = true;
    }

    patch();
})();
