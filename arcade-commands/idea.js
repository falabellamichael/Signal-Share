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
        },
        getSuggestions: (args = "") => {
            const prompt = `${args || ""}`.trim().toLowerCase();
            const genres = [
                'Action',
                'Puzzle',
                'RPG',
                'Arcade',
                'Strategy',
                'Sports',
                'Adventure',
                'Simulation'
            ];

            if (!prompt) {
                return genres.map(genre => ({
                    id: genre,
                    name: genre,
                    description: `Brainstorm ${genre} game ideas`
                }));
            }

            return genres
                .filter(genre => genre.toLowerCase().includes(prompt))
                .map(genre => ({
                    id: genre,
                    name: genre,
                    description: `Brainstorm ${genre} game ideas`
                }));
        }
    });
})();
