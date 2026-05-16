/**
 * /edit or [edit] Command
 * Triggers the surgical Workshop code modification protocol.
 *
 * Important: do not inject full file contents into the chat input.
 * arcade-chat.js already passes active Workshop editor content through
 * bounded model context for edit requests. Injecting source into the input
 * can make the command reprocess a huge prompt and freeze the page.
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

    async function handleResponse(text, options = {}) {
        const actionResult = {
            handled: false,
            workshopFileRewriteAttempted: false,
            workshopFileRewriteSucceeded: false
        };

        const editBlocks = typeof window.extractWorkshopEditBlocks === 'function'
            ? window.extractWorkshopEditBlocks(text)
            : [];

        if (editBlocks.length === 0) {
            if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
                if (window.showFeedback) {
                    window.showFeedback('No explicit [EDIT] tags found. Attempting automatic patch...', false);
                }

                const fallbackResult = await window.tryAutoWorkshopFileRewriteFromReply(
                    text,
                    options.userPrompt || ''
                );

                if (fallbackResult?.attempted) {
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

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState()
            : null;
        const gameId = editorState?.activeGameId || window.lastPlayedGameId || '';
        const fallbackFileName = editorState?.activeFileName || 'index.html';

        if (!gameId) {
            console.warn('[Arcade: Edit] No active Workshop game for surgical edit.');
            return actionResult;
        }

        for (const editBlock of editBlocks) {
            try {
                if (editBlock?.search && typeof window.applyAiFilePatch === 'function') {
                    actionResult.workshopFileRewriteAttempted = true;
                    const targetFileName = editBlock.fileName || fallbackFileName;
                    const patchResult = await window.applyAiFilePatch(
                        gameId,
                        targetFileName,
                        editBlock.search,
                        editBlock.replace,
                        { save: true }
                    );

                    if (patchResult?.ok) {
                        actionResult.workshopFileRewriteSucceeded = true;
                    } else if (window.showFeedback) {
                        window.showFeedback(patchResult?.message || 'Edit failed.', true);
                    }
                }
            } catch (error) {
                console.error('[Arcade: Edit] Action failed:', error);
            }
        }

        return actionResult;
    }

    window.ArcadeCommandManager.register({
        id: 'edit',
        description: 'Surgical code modification.',

        execute: async (args, inputElement) => {
            const cleanArgs = `${args || ''}`.trim();
            let selected = null;

            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(cleanArgs);
                if (!targetGame) targetGame = resolveFallbackEditTarget(cleanArgs);

                if (targetGame) {
                    selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: cleanArgs });
                    if (selected?.ok) {
                        console.log(`[Command: Edit] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            window.activeArcadeCommandMode = '/edit';

            if (inputElement) {
                // Critical: ArcadeCommandManager.handle() keeps executing while the
                // input starts with '/'. Strip the command before returning false
                // so /edit continues to the AI exactly once instead of looping.
                inputElement.value = cleanArgs;
            }

            // Do not append file contents to inputElement.value.
            // sendChatMessage will continue with the stripped user request, and
            // ArcadeChatContext will include bounded Workshop editor context.
            return false;
        },

        getSuggestions: (args = '') => {
            if (typeof window.getWorkshopManageableGames !== 'function') return [];
            const games = window.getWorkshopManageableGames();
            if (!Array.isArray(games) || games.length === 0) return [];

            const prompt = `${args || ''}`.trim().toLowerCase();

            if (!prompt) {
                return games.map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Edit files in "${game.title}"`
                }));
            }

            const matchingGame = games.find((game) => prompt.startsWith(game.title.toLowerCase()));
            if (matchingGame) {
                const files = Array.isArray(matchingGame.files) ? matchingGame.files : [];
                const remaining = prompt.substring(matchingGame.title.length).trim();

                return files
                    .map((file) => ({
                        id: `${matchingGame.title} ${file.name}`,
                        name: file.name,
                        description: `Edit ${file.name} in "${matchingGame.title}"`
                    }))
                    .filter((suggestion) => !remaining || suggestion.name.toLowerCase().includes(remaining));
            }

            return games
                .filter((game) => game.title.toLowerCase().includes(prompt))
                .map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Edit files in "${game.title}"`
                }));
        },

        handleResponse
    });
})();
