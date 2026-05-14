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
            if (typeof window.getWorkshopManageableGames === 'function') {
                const games = window.getWorkshopManageableGames();
                const mentionedGame = games.find(g => args.toLowerCase().includes((g.title || "").toLowerCase()));
                if (mentionedGame && typeof window.setWorkshopEditActiveGame === 'function') {
                    console.log(`[Command: Edit] Auto-switching context to: ${mentionedGame.title}`);
                    window.setWorkshopEditActiveGame(mentionedGame.id);
                }
            }

            window.activeArcadeCommandMode = '/edit';
            return false; // Let normal flow continue to AI
        }
    });
})();
