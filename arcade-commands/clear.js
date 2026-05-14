/**
 * /clear Command
 * Locally clears the arcade chat history.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'clear',
        description: 'Clear chat history.',
        execute: async (args, inputElement) => {
            if (typeof window.arcadeChatHistory !== 'undefined') {
                window.arcadeChatHistory = [];
                if (typeof window.saveCurrentChat === 'function') window.saveCurrentChat();
                if (typeof window.renderArcadeChatMessages === 'function') window.renderArcadeChatMessages();
                inputElement.value = '';
                return true; // Locally handled
            }
            return false;
        }
    });
})();
