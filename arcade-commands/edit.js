/**
 * /edit or [edit] Command
 * Triggers the surgical code modification protocol.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'edit',
        description: 'Surgical code modification.',
        execute: async (args, inputElement) => {
            // SMART CONTEXT: If args mention a known game, try to switch to it
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame && typeof window.getWorkshopManageableGames === 'function') {
                    const games = window.getWorkshopManageableGames();
                    if (Array.isArray(games) && games.length === 1) targetGame = games[0];
                }
                if (targetGame) {
                    const selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: args });
                    if (selected?.ok) {
                        console.log(`[Command: Edit] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            window.activeArcadeCommandMode = '/edit';
            return false; // Let normal flow continue to AI
        }
    });
})();
