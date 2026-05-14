/**
 * /rewrite or [rewrite] Command
 * Requests a complete replacement for the active Workshop editor file.
 */
(function() {
    function resolveFallbackRewriteTarget(args = '') {
        if (typeof window.getWorkshopManageableGames !== 'function') return null;
        const games = window.getWorkshopManageableGames();
        if (!Array.isArray(games) || games.length === 0) return null;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState()
            : null;
        const activeGameId = `${editorState?.activeGameId || ''}`.trim();
        const activeGame = activeGameId ? games.find((game) => game.id === activeGameId) : null;
        if (activeGame) return activeGame;

        const prompt = `${args || ''}`.toLowerCase();
        if (games.length === 1 || /\b(any|whatever|something|one of my|a game|my game)\b/.test(prompt)) {
            return games[0];
        }

        return null;
    }

    window.ArcadeCommandManager.register({
        id: 'rewrite',
        description: 'Rewrite the active Workshop file.',
        execute: async (args, inputElement) => {
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame) targetGame = resolveFallbackRewriteTarget(args);
                if (targetGame) {
                    const selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: args });
                    if (selected?.ok) {
                        console.log(`[Command: Rewrite] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            window.activeArcadeCommandMode = '/rewrite';
            return false;
        }
    });
})();
