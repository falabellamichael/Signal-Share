/**
 * /idea Command
 * Triggers the AI to brainstorm new game concepts.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'idea',
        description: 'Brainstorm 3 unique game ideas.',
        execute: async (args, inputElement) => {
            const genre = args.trim();
            const directive = window.ArcadeWorkshopManager.getIdeaDirective(genre);
            
            // Set the command mode to ensure the AI gets the context
            window.activeArcadeCommandMode = '/idea';
            
            // Inject the directive into the user prompt or system flow
            // Note: Normal flow continues to AI with this mode set
            return false; 
        }
    });
})();
