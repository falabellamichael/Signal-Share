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
