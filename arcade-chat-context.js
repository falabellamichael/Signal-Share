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