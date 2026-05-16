/**
 * /help Command
 * Displays command-specific or full command help.
 */
(function() {
    function normalize(value = '') {
        return `${value || ''}`.trim();
    }

    function formatCommandHelp(command) {
        if (!command) return '';
        const id = command.id || '';
        const suggestions = typeof command.getSuggestions === 'function'
            ? command.getSuggestions('').slice(0, 6)
            : [];
        const optionLines = suggestions.length > 0
            ? `\n  Options: ${suggestions.map(s => s.id || s.name).filter(Boolean).join(', ')}`
            : '';
        return `/${id} - ${command.description || 'No description.'}${optionLines}`;
    }

    window.ArcadeCommandManager.register({
        id: 'help',
        description: 'Show all commands or help for one command.',

        execute: async (args, inputElement) => {
            const topic = normalize(args).replace(/^\//, '').toLowerCase();
            const manager = window.ArcadeCommandManager;
            const commands = manager.getAllCommands();

            let helpText = '';
            if (topic) {
                const command = manager.getCommand(topic);
                helpText = command
                    ? `🛠️ [Command Help]:\n${formatCommandHelp(command)}`
                    : `⚠️ Unknown command: /${topic}`;
            } else {
                helpText = `🛠️ [Command Hub]:\n${commands.map(formatCommandHelp).join('\n')}`;
            }

            if (typeof window.addChatMessage === 'function') {
                window.addChatMessage('ai', helpText);
                if (inputElement) inputElement.value = '';
                return true;
            }
            return false;
        },

        getSuggestions: (args = '') => {
            const prompt = normalize(args).replace(/^\//, '').toLowerCase();
            const commands = window.ArcadeCommandManager.getAllCommands();
            return commands
                .filter(c => !prompt || c.id.toLowerCase().includes(prompt))
                .map(c => ({
                    id: c.id,
                    name: c.id,
                    description: c.description || `Show help for /${c.id}`
                }))
                .slice(0, 10);
        }
    });
})();