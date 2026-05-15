/**
 * /fix Command
 * Specialized protocol for rapid bug fixing.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'fix',
        description: 'Rapid bug fixing protocol.',
        execute: async (args, inputElement) => {
            // Re-use logic from edit for target resolution
            const editCmd = window.ArcadeCommandManager.getCommand('edit');
            if (editCmd) {
                await editCmd.execute(args, inputElement);
            }
            if (window.activeArcadeCommandModes && !window.activeArcadeCommandModes.includes('/fix')) {
                window.activeArcadeCommandModes.push('/fix');
            }
            return false;
        },
        /**
         * The response handler aliases to the edit handler.
         */
        handleResponse: async (text, options = {}) => {
            const editCmd = window.ArcadeCommandManager.getCommand('edit');
            if (editCmd && typeof editCmd.handleResponse === 'function') {
                return await editCmd.handleResponse(text, options);
            }
            return { handled: false };
        },
        getSuggestions: (args = '') => {
            const editCmd = window.ArcadeCommandManager.getCommand('edit');
            if (editCmd && typeof editCmd.getSuggestions === 'function') {
                return editCmd.getSuggestions(args).map(s => ({
                    ...s,
                    description: s.description.replace('Edit', 'Fix')
                }));
            }
            return [];
        }
    });
})();
