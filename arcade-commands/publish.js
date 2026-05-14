/**
 * /publish Command
 * Triggers the project publishing protocol.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'publish',
        description: 'Full project upload/publish.',
        execute: async (args, inputElement) => {
            window.activeArcadeCommandMode = '/publish';
            return false; // Let normal flow continue to AI
        }
    });
})();
