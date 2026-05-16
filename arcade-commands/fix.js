/**
 * /fix Command
 * Specialized protocol for rapid bug fixing.
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
        id: 'fix',
        description: 'Rapid bug fixing protocol.',
        execute: async (args, inputElement) => {
            let selected = null;
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame) targetGame = resolveFallbackEditTarget(args);
                if (targetGame) {
                    selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: args });
                    if (selected?.ok) {
                        console.log(`[Command: Fix] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            if (selected?.ok && isTargetOnlyEditRequest(args, selected)) {
                window.activeArcadeCommandMode = null;
                return replyLocally(
                    inputElement,
                    `[Workshop Fix]: Opened "${selected.title}" in Fix Mode (${selected.fileName}). Tell me the exact bug to fix, for example: /fix ${selected.title} fix the scoring bug.`
                );
            }

            if (!selected?.ok && isTargetOnlyEditRequest(args, selected)) {
                window.activeArcadeCommandMode = null;
                return replyLocally(
                    inputElement,
                    '[Workshop Fix]: I need a matching Workshop game and a fix request. Try: /fix Random Number Guessing Game fix the scoring bug.'
                );
            }

            window.activeArcadeCommandMode = '/fix';
            return false; // Let normal flow continue to AI
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
                        
                        if (!fallbackResult.ok) {
                            actionResult.errorReason = fallbackResult.reason || 'Auto-patch failed';
                            if (window.showFeedback) window.showFeedback(`Auto-Patch Failed: ${actionResult.errorReason}`, true);
                        }
                        return actionResult;
                    }
                }
                return actionResult;
            }

            if (window.showFeedback) window.showFeedback('Applying surgical fixes...', false);
            actionResult.handled = true;
            const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const gameId = editorState?.activeGameId || window.lastPlayedGameId || "";
            const fileName = editorState?.activeFileName || "index.html";

            if (!gameId || !fileName) {
                console.warn('[Arcade: Fix] No active game/file for surgical fix.');
                return actionResult;
            }

            for (const editBlock of editBlocks) {
                try {
                    if (editBlock?.search && typeof window.applyAiFilePatch === 'function') {
                        actionResult.workshopFileRewriteAttempted = true;
                        const targetFileName = editBlock.fileName || fileName;
                        console.log(`[Arcade: Fix] Applying patch to ${targetFileName}`);
                        const patchResult = await window.applyAiFilePatch(gameId, targetFileName, editBlock.search, editBlock.replace, { save: true });
                        if (patchResult?.ok) {
                            actionResult.workshopFileRewriteSucceeded = true;
                        } else if (window.showFeedback) {
                            window.showFeedback(patchResult?.message || `Fix failed for ${targetFileName}`, true);
                        }
                    }
                } catch (e) {
                    console.error("[Arcade: Fix] Action failed:", e);
                }
            }

            return actionResult;
        },
        getSuggestions: (args = '') => {
            const editCmd = window.ArcadeCommandManager.getCommand('edit');
            if (editCmd && typeof editCmd.getSuggestions === 'function') {
                return editCmd.getSuggestions(args).map(s => ({
                    ...s,
                    description: s.description.replace('Edit', 'Fix')
                }));
            }
            return [];
        }
    });
})();
