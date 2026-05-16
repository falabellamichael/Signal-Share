/**
 * Arcade Chat Context Manager
 * Handles building the context for the AI model, including file contents and protocol directives.
 */

window.ArcadeChatContext = (function() {
    return {
        buildModelContext: function(text, richContext, options = {}) {
            const { editRequestActive, attachment, sharedAiContext } = options;
            
            const contextForModel = {
                ...richContext,
                workshopEditor: richContext.workshopEditor ? {
                    ...richContext.workshopEditor,
                    // Provide the full file content so the AI has context on the first try
                    activeFileContent: richContext.workshopEditor.activeFileContent,
                    activeFileContentLength: `${richContext.workshopEditor.activeFileContent || ''}`.length,
                    ...(editRequestActive ? { activeFileContentProvidedInEditProtocol: true } : {})
                } : null
            };
            
            const pageContext = JSON.stringify(contextForModel);
            // Omit visible page text if we are in the editor to save tokens
            const pageText = richContext.workshopEditor ? "" : document.body.innerText.substring(0, 300);
            
            const protocolDirectives = typeof window.getProtocolDirectives === 'function'
                ? window.getProtocolDirectives(text, richContext, attachment)
                : '';
                
            const workshopEditContext = editRequestActive
                ? `[ACTIVE_WORKSHOP_EDITOR]\n${JSON.stringify(contextForModel.workshopEditor || null)}`
                : '';
                
            const fullPageContext = editRequestActive
                ? `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${workshopEditContext}`
                : `${protocolDirectives ? `${protocolDirectives}\n\n` : ''}${sharedAiContext ? `${sharedAiContext}\n\n` : ''}${pageContext} (Visible text: ${pageText})`;
                
            return fullPageContext;
        }
    };
})();

/**
 * Quiet background bridge probes.
 *
 * Model dropdown hydration and bridge health polling use GET /models and GET
 * /health probes. When no local bridge is running, those requests generate noisy
 * ERR_CONNECTION_REFUSED console entries. Avoid hitting dead localhost model
 * probes in the background; actual chat POST requests are not intercepted.
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

    function isBackgroundBridgeProbe(input, init = {}) {
        const method = `${init?.method || input?.method || 'GET'}`.toUpperCase();
        if (method !== 'GET') return false;

        const rawUrl = typeof input === 'string' ? input : `${input?.url || ''}`;
        if (!rawUrl) return false;

        try {
            const url = new URL(rawUrl, window.location.href);
            if (!isLoopbackHost(url.hostname)) return false;
            return /^\/api\/(?:local-llm|llm)\/models$/i.test(url.pathname)
                || /^\/api\/local-llm\/health$/i.test(url.pathname);
        } catch (_error) {
            return false;
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