/**
 * /edit or [edit] Command
 * Opens the active Workshop file, keeps /edit routing intact, and applies AI fixes.
 *
 * Design notes:
 * - Keep the slash command visible to downstream intent detection.
 * - Do not inject full source into the chat input.
 * - Read/write through the Workshop editor/Supabase-backed helpers when available.
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

    function getEditorElement() {
        return document.getElementById('workshop-edit-file-content');
    }

    function writeEditorContent(editorElement, content = '') {
        if (!editorElement) return false;
        editorElement.value = `${content || ''}`;
        editorElement.dispatchEvent(new Event('input', { bubbles: true }));
        editorElement.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.handleWorkshopEditContentInput === 'function') {
            window.handleWorkshopEditContentInput();
        }
        if (typeof window.syncWorkshopEditorLineNumbers === 'function') {
            window.syncWorkshopEditorLineNumbers();
        }
        return true;
    }

    function readCurrentWorkshopFileContent(editorState = null) {
        const state = editorState || (typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState()
            : null);
        const gameId = `${state?.activeGameId || ''}`.trim();
        const fileName = `${state?.activeFileName || 'index.html'}`.trim();

        if (gameId && fileName && typeof window.getWorkshopFileContent === 'function') {
            const source = window.getWorkshopFileContent(gameId, fileName);
            if (typeof source === 'string') return source;
        }

        const stateContent = state?.activeFileContent ?? state?.content ?? state?.value;
        if (typeof stateContent === 'string') return stateContent;

        const editorElement = getEditorElement();
        return typeof editorElement?.value === 'string' ? editorElement.value : '';
    }

    async function selectWorkshopTargetFromPrompt(args = '') {
        const cleanArgs = `${args || ''}`.trim();
        if (typeof window.resolveWorkshopEditGameFromPrompt !== 'function'
            || typeof window.setWorkshopEditActiveGame !== 'function') {
            return null;
        }

        let targetGame = window.resolveWorkshopEditGameFromPrompt(cleanArgs);
        if (!targetGame) targetGame = resolveFallbackEditTarget(cleanArgs);
        if (!targetGame) return null;

        const selected = await Promise.resolve(window.setWorkshopEditActiveGame(targetGame.id, { prompt: cleanArgs }));
        if (selected?.ok) {
            console.log(`[Command: Edit] Auto-switching context to: ${selected.title} / ${selected.fileName}`);
        }
        return selected || targetGame;
    }

    async function hydrateEditorFromWorkshopState() {
        const editorElement = getEditorElement();
        if (!editorElement) return false;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const content = readCurrentWorkshopFileContent(editorState);
        if (typeof content !== 'string') return false;

        writeEditorContent(editorElement, content);
        return true;
    }

    function extractAiCodeBlocks(text = '') {
        const blocks = [];
        const source = `${text || ''}`;
        const regex = /```([^\n`]*)\n([\s\S]*?)```/g;
        let match;
        while ((match = regex.exec(source)) !== null) {
            const info = `${match[1] || ''}`.trim();
            const content = `${match[2] || ''}`.trim();
            if (!content) continue;
            const fileName = info.match(/\b(?:file(?:name)?|name|path)=['"]?([^'"\s`]+)['"]?/i)?.[1]
                || info.match(/\b([a-z0-9][\w.-]*\.(?:html?|css|js|mjs|cjs|json|txt|svg|xml))\b/i)?.[1]
                || '';
            blocks.push({ info, fileName: fileName.replace(/[/\\]+/g, '_'), content });
        }
        return blocks;
    }

    async function applyFullFileCodeBlocks(text = '') {
        const result = { attempted: false, ok: false };
        const blocks = extractAiCodeBlocks(text);
        if (blocks.length === 0) return result;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const gameId = `${editorState?.activeGameId || window.lastPlayedGameId || ''}`.trim();
        const fallbackFileName = `${editorState?.activeFileName || 'index.html'}`.trim();
        if (!gameId) return result;

        for (const block of blocks) {
            const targetFileName = block.fileName || fallbackFileName;
            const content = block.content;
            if (!targetFileName || !content) continue;

            result.attempted = true;

            try {
                if (typeof window.setWorkshopEditActiveGame === 'function') {
                    await Promise.resolve(window.setWorkshopEditActiveGame(gameId, targetFileName));
                }

                let applyResult = null;
                if (typeof window.internalApplyWorkshopFileEdit === 'function') {
                    applyResult = await window.internalApplyWorkshopFileEdit(gameId, targetFileName, content, { save: true });
                } else {
                    const editorElement = getEditorElement();
                    writeEditorContent(editorElement, content);
                    if (typeof window.saveWorkshopEditPanel === 'function') {
                        applyResult = await window.saveWorkshopEditPanel();
                    }
                }

                const applied = applyResult?.ok !== false;
                result.ok = result.ok || applied;
                if (window.showFeedback) {
                    window.showFeedback(
                        applied ? `Saved AI fix to ${targetFileName}.` : (applyResult?.message || `Failed to save ${targetFileName}.`),
                        !applied
                    );
                }
            } catch (error) {
                console.error('[Arcade: Edit] Failed to apply generated code block:', error);
                if (window.showFeedback) window.showFeedback(`Failed to save ${targetFileName}.`, true);
            }
        }

        return result;
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

            const fullFileResult = await applyFullFileCodeBlocks(text);
            if (fullFileResult.attempted) {
                actionResult.handled = true;
                actionResult.workshopFileRewriteAttempted = true;
                actionResult.workshopFileRewriteSucceeded = !!fullFileResult.ok;
                return actionResult;
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
        description: 'Edit the active Workshop file using the Workshop/Supabase editor state.',

        execute: async (args, inputElement) => {
            const cleanArgs = `${args || ''}`.trim();
            window.activeArcadeCommandMode = '/edit';

            try {
                await selectWorkshopTargetFromPrompt(cleanArgs);
                await hydrateEditorFromWorkshopState();
            } catch (error) {
                console.error('[Arcade: Edit] Failed to prepare Workshop editor:', error);
            }

            // Keep the slash-command text intact. The command manager guards
            // against no-progress loops, while the downstream Workshop intent
            // detector still sees /edit exactly as before.
            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = cleanArgs ? `/edit ${cleanArgs}` : '/edit';
            }

            // Do not append file contents to inputElement.value.
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
