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
            window.activeArcadeCommandMode = '/fix';
            return false;
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
