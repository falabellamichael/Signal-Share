/**
 * /rewrite or [rewrite] Command
 * Requests a complete replacement for the active Workshop editor file.
 */
(function() {
    const ACTION_WORDS = new Set([
        'add', 'insert', 'create', 'make', 'build', 'change', 'update', 'modify', 'replace',
        'remove', 'delete', 'fix', 'repair', 'debug', 'style', 'styles', 'css', 'javascript',
        'js', 'stopwatch', 'timer', 'score', 'button', 'layout', 'color', 'colour', 'work',
        'working', 'better', 'new', 'feature', 'rebuild', 'redesign'
    ]);
    const FILLER_WORDS = new Set([
        'a', 'an', 'and', 'the', 'to', 'for', 'in', 'on', 'of', 'my', 'game', 'workshop',
        'editor', 'file', 'index', 'html', 'please'
    ]);

    function tokenize(value = '') {
        return `${value || ''}`.toLowerCase().match(/[a-z0-9]+/g) || [];
    }

    function isTargetOnlyRewriteRequest(args = '', selected = null) {
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
            let selected = null;
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                let targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (!targetGame) targetGame = resolveFallbackRewriteTarget(args);
                if (targetGame) {
                    selected = window.setWorkshopEditActiveGame(targetGame.id, { prompt: args });
                    if (selected?.ok) {
                        console.log(`[Command: Rewrite] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
                    }
                }
            }

            if (selected?.ok && isTargetOnlyRewriteRequest(args, selected)) {
                // Clear modes if we are just replying with info
                window.activeArcadeCommandModes = [];
                return replyLocally(
                    inputElement,
                    `[Workshop Edit]: Opened "${selected.title}" in Rewrite Mode (${selected.fileName}). Tell me what the full rewrite should do, for example: /rewrite ${selected.title} add a stopwatch and split CSS/JS into separate files.`
                );
            }

            if (!selected?.ok && isTargetOnlyRewriteRequest(args, selected)) {
                window.activeArcadeCommandModes = [];
                return replyLocally(
                    inputElement,
                    '[Workshop Edit]: I need a matching Workshop game and rewrite instructions. Try: /rewrite Random Number Guessing Game add a stopwatch and split CSS/JS into separate files.'
                );
            }

            // Command mode is already added by the manager, but we can ensure it's here
            if (window.activeArcadeCommandModes && !window.activeArcadeCommandModes.includes('/rewrite')) {
                window.activeArcadeCommandModes.push('/rewrite');
            }

            return false;
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
                    description: `Rewrite files in "${g.title}"`
                }));
            }

            const matchingGame = games.find(g => prompt.startsWith(g.title.toLowerCase()));
            if (matchingGame) {
                const files = Array.isArray(matchingGame.files) ? matchingGame.files : [];
                const remaining = prompt.substring(matchingGame.title.length).trim();
                
                return files.map(f => ({
                    id: `${matchingGame.title} ${f.name}`,
                    name: f.name,
                    description: `Rewrite ${f.name} in "${matchingGame.title}"`
                })).filter(s => !remaining || s.name.toLowerCase().includes(remaining));
            }

            return games
                .filter(g => g.title.toLowerCase().includes(prompt))
                .map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Rewrite files in "${g.title}"`
                }));
        },
        /**
         * The response handler handles full-file rewrites from the AI reply.
         */
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                workshopFileRewriteAttempted: false,
                workshopFileRewriteSucceeded: false,
                errorReason: null
            };

            // 1. Explicit check for rewrite intent
            const isExplicitRewrite = window.ArcadeWorkshopManager.isWorkshopRewriteIntentPrompt(options.userPrompt || '');
            if (!isExplicitRewrite && !text.includes('[REWRITE]')) {
                return actionResult;
            }

            if (window.showFeedback) window.showFeedback('Processing Workshop rewrite...', false);

            // 2. Try the automatic rewrite logic
            if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
                const fallbackResult = await window.tryAutoWorkshopFileRewriteFromReply(text, options.userPrompt || '');
                if (fallbackResult.attempted) {
                    actionResult.handled = true;
                    actionResult.workshopFileRewriteAttempted = true;
                    actionResult.workshopFileRewriteSucceeded = !!fallbackResult.ok;
                    
                    if (!fallbackResult.ok) {
                        actionResult.errorReason = fallbackResult.reason || 'Rewrite failed';
                        if (window.showFeedback) window.showFeedback(`Rewrite Failed: ${actionResult.errorReason}`, true);
                    }
                    return actionResult;
                }
            }

            return actionResult;
        }
    });
})();
