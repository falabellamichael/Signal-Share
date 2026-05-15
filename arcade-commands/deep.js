/**
 * /deep Command
 * Triggers a Deep Reasoning session for high-complexity architectural tasks.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'deep',
        description: 'Triggers a Deep Reasoning session for high-complexity architectural tasks.',
        execute: async (args, inputElement) => {
            // Re-use logic from edit for target resolution if it looks like an edit
            const editCmd = window.ArcadeCommandManager.getCommand('edit');
            if (editCmd) {
                await editCmd.execute(args, inputElement);
            }
            window.activeArcadeCommandMode = '/deep';
            return false; // Let AI take over with the new mode
        }
    });
})();
