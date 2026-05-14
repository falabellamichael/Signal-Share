/**
 * /help Command
 * Displays the dynamic list of registered commands.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'help',
        description: 'Show this guide.',
        execute: async (args, inputElement) => {
            const commands = window.ArcadeCommandManager.getAllCommands();
            const helpLines = commands.map(c => `/${c.id} - ${c.description}`);
            
            const helpText = `🛠️ [Command Hub]:\n${helpLines.join('\n')}`;
            
            if (typeof window.addChatMessage === 'function') {
                window.addChatMessage('ai', helpText);
                inputElement.value = '';
                return true; // Locally handled
            }
            return false;
        }
    });
})();
