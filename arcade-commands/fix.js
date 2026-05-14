/**
 * /fix Command
 * Specialized protocol for rapid bug fixing.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'fix',
        description: 'Rapid bug fixing protocol.',
        execute: async (args, inputElement) => {
            window.activeArcadeCommandMode = '/fix';
            return false; // Let normal flow continue to AI
        }
    });
})();
