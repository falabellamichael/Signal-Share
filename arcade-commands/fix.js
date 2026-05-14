/**
 * /fix Command
 * Specialized protocol for rapid bug fixing.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'fix',
        description: 'Rapid bug fixing protocol.',
        execute: async (args, inputElement) => {
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame && typeof window.getWorkshopManageableGames === 'function') {
                    const games = window.getWorkshopManageableGames();
                    if (Array.isArray(games) && games.length === 1) targetGame = games[0];
                }
                if (targetGame) {
                    const selected = window.setWorkshopEditActiveGame(targetGame.id);
                    if (selected?.ok) {
                        console.log(`[Command: Fix] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            window.activeArcadeCommandMode = '/fix';
            return false; // Let normal flow continue to AI
        }
    });
})();
