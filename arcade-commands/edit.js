/**
 * /edit or [edit] Command
 * Triggers the surgical code modification protocol.
 */
(function() {
    function resolveFallbackEditTarget(args = '') {
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
        id: 'edit',
        description: 'Surgical code modification.',
        execute: async (args, inputElement) => {
            // SMART CONTEXT: If args mention a known game, try to switch to it
            let selected = null;
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame) targetGame = resolveFallbackEditTarget(args);
                if (targetGame) {
                    selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: args });
                    if (selected?.ok) {
                        console.log(`[Command: Edit] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            window.activeArcadeCommandMode = '/edit';
            return false; // Let normal flow continue to AI
        },
        getSuggestions: (args = '') => {
            if (typeof window.getWorkshopManageableGames !== 'function') return [];
            const games = window.getWorkshopManageableGames();
            if (!Array.isArray(games) || games.length === 0) return [];

            const prompt = `${args || ''}`.trim().toLowerCase();
            
            if (!prompt) {
                return games.map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Edit files in "${g.title}"`
                }));
            }

            const matchingGame = games.find(g => prompt.startsWith(g.title.toLowerCase()));
            if (matchingGame) {
                const files = Array.isArray(matchingGame.files) ? matchingGame.files : [];
                const remaining = prompt.substring(matchingGame.title.length).trim();
                
                return files.map(f => ({
                    id: `${matchingGame.title} ${f.name}`,
                    name: f.name,
                    description: `Edit ${f.name} in "${matchingGame.title}"`
                })).filter(s => !remaining || s.name.toLowerCase().includes(remaining));
            }

            return games
                .filter(g => g.title.toLowerCase().includes(prompt))
                .map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Edit files in "${g.title}"`
                }));
        },
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                workshopFileRewriteAttempted: false,
                workshopFileRewriteSucceeded: false
            };

            const editBlocks = typeof window.extractWorkshopEditBlocks === 'function' ? window.extractWorkshopEditBlocks(text) : [];
            
            if (editBlocks.length === 0) {
                if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
                    if (window.showFeedback) window.showFeedback('No explicit [EDIT] tags found. Attempting automatic patch...', false);
                    const fallbackResult = await window.tryAutoWorkshopFileRewriteFromReply(text, options.userPrompt || '');
                    if (fallbackResult.attempted) {
                        actionResult.handled = true;
                        actionResult.workshopFileRewriteAttempted = true;
                        actionResult.workshopFileRewriteSucceeded = !!fallbackResult.ok;
                        return actionResult;
                    }
                }
                return actionResult;
            }

            if (window.showFeedback) window.showFeedback('Applying surgical edits...', false);
            actionResult.handled = true;
            const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const gameId = editorState?.activeGameId || window.lastPlayedGameId || "";
            const fileName = editorState?.activeFileName || "index.html";

            for (const editBlock of editBlocks) {
                try {
                    if (editBlock?.search && typeof window.applyAiFilePatch === 'function') {
                        actionResult.workshopFileRewriteAttempted = true;
                        const targetFileName = editBlock.fileName || fileName;
                        const patchResult = await window.applyAiFilePatch(gameId, targetFileName, editBlock.search, editBlock.replace, { save: true });
                        if (patchResult?.ok) {
                            actionResult.workshopFileRewriteSucceeded = true;
                        }
                    }
                } catch (e) {
                    console.error("[Arcade: Edit] Action failed:", e);
                }
            }

            return actionResult;
        }
    });
})();
