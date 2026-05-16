/**
 * /edit or [edit] Command
 * Triggers the surgical code modification protocol.
 */
(function() {
    const ACTION_WORDS = new Set([
        'add', 'insert', 'create', 'make', 'build', 'change', 'update', 'modify', 'replace',
        'remove', 'delete', 'fix', 'repair', 'debug', 'style', 'styles', 'css', 'javascript',
        'js', 'stopwatch', 'timer', 'score', 'button', 'layout', 'color', 'colour', 'work',
        'working', 'better', 'new', 'feature'
    ]);
    const FILLER_WORDS = new Set([
        'a', 'an', 'and', 'the', 'to', 'for', 'in', 'on', 'of', 'my', 'game', 'workshop',
        'editor', 'file', 'index', 'html', 'please'
    ]);

    function tokenize(value = '') {
        return `${value || ''}`.toLowerCase().match(/[a-z0-9]+/g) || [];
    }

    function isTargetOnlyEditRequest(args = '', selected = null) {
        const argTokens = tokenize(args);
        if (argTokens.length === 0) return true;

        const titleTokens = new Set(tokenize(selected?.title || ''));
        const fileTokens = new Set(tokenize(selected?.fileName || ''));
        const remaining = argTokens.filter((token) => {
            return !titleTokens.has(token)
                && !fileTokens.has(token)
                && !FILLER_WORDS.has(token);
        });

        if (remaining.length === 0) return true;
        return !remaining.some((token) => ACTION_WORDS.has(token));
    }

    function replyLocally(inputElement, message) {
        if (typeof window.addChatMessage === 'function') {
            window.addChatMessage('ai', message);
        }
        if (inputElement) inputElement.value = '';
        if (typeof window.updateChatStatus === 'function') window.updateChatStatus('active');
        return true;
    }

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

            if (selected?.ok && isTargetOnlyEditRequest(args, selected)) {
                window.activeArcadeCommandMode = null;
                return replyLocally(
                    inputElement,
                    `[Workshop Edit]: Opened "${selected.title}" in Edit Mode (${selected.fileName}). Tell me the exact change to make, for example: /edit ${selected.title} add a stopwatch.`
                );
            }

            if (!selected?.ok && isTargetOnlyEditRequest(args, selected)) {
                window.activeArcadeCommandMode = null;
                return replyLocally(
                    inputElement,
                    '[Workshop Edit]: I need a matching Workshop game and a change request. Try: /edit Random Number Guessing Game add a stopwatch.'
                );
            }

            window.activeArcadeCommandMode = '/edit';
            return false; // Let normal flow continue to AI
        },
        getSuggestions: (args = '') => {
            if (typeof window.getWorkshopManageableGames !== 'function') return [];
            const games = window.getWorkshopManageableGames();
            if (!Array.isArray(games) || games.length === 0) return [];

            const prompt = `${args || ''}`.trim().toLowerCase();
            
            // If no args, suggest all games
            if (!prompt) {
                return games.map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Edit files in "${g.title}"`
                }));
            }

            // Try to match a game exactly to suggest its files
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

            // Search games
            return games
                .filter(g => g.title.toLowerCase().includes(prompt))
                .map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Edit files in "${g.title}"`
                }));
        },
        /**
         * The response handler handles the [EDIT] blocks in the AI reply.
         * Moves the surgical modification pipeline out of the main chat loop.
         */
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                workshopFileRewriteAttempted: false,
                workshopFileRewriteSucceeded: false
            };

            const editBlocks = typeof window.extractWorkshopEditBlocks === 'function' ? window.extractWorkshopEditBlocks(text) : [];
            let editSucceeded = false;
            
            if (editBlocks.length > 0) {
                if (window.showFeedback) window.showFeedback('Applying surgical edits...', false);
                actionResult.handled = true;
                const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
                const gameId = editorState?.activeGameId || window.lastPlayedGameId || "";
                const fileName = editorState?.activeFileName || "index.html";

                if (!gameId || !fileName) {
                    console.warn('[Arcade: Edit] No active game/file for surgical edit.');
                } else {
                    for (const editBlock of editBlocks) {
                        try {
                            if (editBlock?.search && typeof window.applyAiFilePatch === 'function') {
                                actionResult.workshopFileRewriteAttempted = true;
                                const targetFileName = editBlock.fileName || fileName;
                                console.log(`[Arcade: Edit] Applying patch to ${targetFileName}`);
                                const patchResult = await window.applyAiFilePatch(gameId, targetFileName, editBlock.search, editBlock.replace, { save: true });
                                if (patchResult?.ok) {
                                    actionResult.workshopFileRewriteSucceeded = true;
                                    editSucceeded = true;
                                }
                            }
                        } catch (e) {
                            console.error("[Arcade: Edit] Action failed:", e);
                        }
                    }
                }
            }

            if (!editSucceeded) {
                // FALLBACK: If no tags were found OR all edits failed, try the automatic rewrite/patch logic
                if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
                    if (window.showFeedback) window.showFeedback('Edits failed or not found. Attempting automatic patch...', false);
                    const fallbackResult = await window.tryAutoWorkshopFileRewriteFromReply(text, options.userPrompt || '');
                    if (fallbackResult.attempted) {
                        actionResult.handled = true;
                        actionResult.workshopFileRewriteAttempted = true;
                        actionResult.workshopFileRewriteSucceeded = !!fallbackResult.ok;
                        
                        if (!fallbackResult.ok) {
                            actionResult.errorReason = fallbackResult.reason || 'Auto-patch failed';
                            if (window.showFeedback) window.showFeedback(`Auto-Patch Failed: ${actionResult.errorReason}`, true);
                        }
                        return actionResult;
                    }
                }
            }

            return actionResult;
        }
    });
})();
