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

    async function handleResponse(text, options = {}) {
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
            
            // Read file content
            const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const content = editorState?.content || editorState?.value || "";
            const fileName = editorState?.activeFileName || "index.html";
            
            const updatedMessage = `${args}\n\n[FILE: ${fileName}]\n${content}`;
            
            if (window.showFeedback) window.showFeedback('Calling AI for edit...', false);
            
            try {
                const bridgeUrl = window.SignalShareLocalLlm?.getBridgeBaseUrl() || "http://localhost:3000";
                const headers = window.SignalShareLocalLlm?.getRequestHeaders() || {};
                
                const response = await fetch(`${bridgeUrl}/api/local-llm/chat`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        ...headers
                    },
                    body: JSON.stringify({
                        message: updatedMessage,
                        history: []
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const reply = data.reply || data.message || data; // Handle different response formats
                    
                    const result = await handleResponse(reply, { userPrompt: args });
                    if (result.workshopFileRewriteSucceeded) {
                        if (window.showFeedback) window.showFeedback('Edit applied successfully!', false);
                    } else {
                        if (window.showFeedback) window.showFeedback('Failed to apply edit.', true);
                    }
                } else {
                    if (window.showFeedback) window.showFeedback('AI request failed.', true);
                }
            } catch (e) {
                console.error("[Command: Edit] AI call failed:", e);
                if (window.showFeedback) window.showFeedback('Failed to connect to AI.', true);
            }
            
            return true; // Stop processing in manager
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
        handleResponse: handleResponse
    });
})();
