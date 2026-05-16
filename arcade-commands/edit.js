/**
 * /edit or [edit] Command
 * Opens the active Workshop file, keeps /edit routing intact, and applies AI fixes.
 *
 * Design notes:
 * - Keep the slash command visible to downstream intent detection.
 * - Do not inject full source into the chat input.
 * - Read/write through the Workshop editor/Supabase-backed helpers when available.
 * - Force a reliable active editor snapshot so the model can see the open game/file.
 * - Treat raw SEARCH/REPLACE output as executable edits even if the model omits [EDIT] tags.
 */
(function() {
    let workshopStateWrapperInstalled = false;
    let originalGetWorkshopEditorState = null;

    function normalizeText(value = '') {
        return `${value || ''}`.trim();
    }

    function normalizeNewlines(value = '') {
        return `${value || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function stripOuterCodeFence(value = '') {
        let text = normalizeNewlines(value).trim();
        const fenceMatch = text.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
        if (fenceMatch) text = fenceMatch[1].trim();
        return text;
    }

    function cleanPatchText(value = '') {
        return stripOuterCodeFence(value)
            .replace(/^\s*```[^\n`]*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .replace(/^\s*SEARCH:\s*/i, '')
            .replace(/^\s*REPLACE:\s*/i, '')
            .trim();
    }

    function getEditorElement() {
        return document.getElementById('workshop-edit-file-content')
            || document.querySelector('[data-workshop-edit-file-content]')
            || document.querySelector('.workshop-edit-file-content')
            || document.querySelector('textarea[data-file-editor]')
            || document.querySelector('textarea.code-editor')
            || document.querySelector('textarea');
    }

    function getEditorDomContent() {
        const editorElement = getEditorElement();
        if (!editorElement) return '';
        if (typeof editorElement.value === 'string') return editorElement.value;
        if (typeof editorElement.textContent === 'string') return editorElement.textContent;
        return '';
    }

    function readDatasetValue(keys = []) {
        const candidates = [
            document.querySelector('[data-active-game-id]'),
            document.querySelector('[data-workshop-game-id]'),
            document.querySelector('[data-active-file-name]'),
            document.querySelector('[data-workshop-file-name]'),
            document.querySelector('.workshop-editor'),
            document.querySelector('#workshop-editor'),
            document.body,
            document.documentElement
        ].filter(Boolean);

        for (const node of candidates) {
            for (const key of keys) {
                const value = normalizeText(node?.dataset?.[key]);
                if (value) return value;
            }
        }
        return '';
    }

    function getVisibleEditorFileName(state = null) {
        const fromState = normalizeText(state?.activeFileName || state?.fileName || state?.selectedFileName);
        if (fromState) return fromState;

        const fromDataset = readDatasetValue(['activeFileName', 'workshopFileName', 'fileName', 'selectedFileName']);
        if (fromDataset) return fromDataset;

        const selectedFile = document.querySelector('.workshop-file.active, .workshop-file.selected, [data-file-name].active, [data-file-name].selected, [aria-selected="true"][data-file-name]');
        const selectedFileName = normalizeText(selectedFile?.dataset?.fileName || selectedFile?.textContent);
        if (selectedFileName && /\.[a-z0-9]+$/i.test(selectedFileName)) return selectedFileName;

        return 'index.html';
    }

    function getManageableGames() {
        if (typeof window.getWorkshopManageableGames !== 'function') return [];
        const games = window.getWorkshopManageableGames();
        return Array.isArray(games) ? games : [];
    }

    function getGameFromId(gameId = '') {
        const id = normalizeText(gameId);
        if (!id) return null;
        return getManageableGames().find((game) => `${game?.id || ''}` === id) || null;
    }

    function getVisibleEditorGame(state = null, selected = null, args = '') {
        if (selected?.id || selected?.gameId || selected?.activeGameId) {
            return {
                id: normalizeText(selected.id || selected.gameId || selected.activeGameId),
                title: normalizeText(selected.title || selected.name || selected.gameTitle)
            };
        }

        const stateGameId = normalizeText(state?.activeGameId || state?.gameId || state?.id);
        if (stateGameId) {
            const game = getGameFromId(stateGameId);
            return {
                id: stateGameId,
                title: normalizeText(state?.activeGameTitle || state?.gameTitle || state?.title || game?.title || game?.name)
            };
        }

        const datasetGameId = readDatasetValue(['activeGameId', 'workshopGameId', 'gameId', 'selectedGameId']);
        if (datasetGameId) {
            const game = getGameFromId(datasetGameId);
            return {
                id: datasetGameId,
                title: normalizeText(game?.title || game?.name)
            };
        }

        const games = getManageableGames();
        const prompt = normalizeText(args).toLowerCase();
        const promptGame = games.find((game) => {
            const title = normalizeText(game?.title || game?.name).toLowerCase();
            return title && prompt.includes(title);
        });
        if (promptGame) {
            return {
                id: normalizeText(promptGame.id),
                title: normalizeText(promptGame.title || promptGame.name)
            };
        }

        const visibleTitle = normalizeText(
            document.querySelector('#workshop-edit-game-title')?.textContent
            || document.querySelector('.workshop-edit-game-title')?.textContent
            || document.querySelector('[data-workshop-active-title]')?.textContent
            || document.querySelector('.workshop-editor-title')?.textContent
        );
        if (visibleTitle) {
            const titleGame = games.find((game) => visibleTitle.toLowerCase().includes(normalizeText(game?.title || game?.name).toLowerCase()));
            return {
                id: normalizeText(titleGame?.id || window.lastPlayedGameId || ''),
                title: normalizeText(titleGame?.title || titleGame?.name || visibleTitle)
            };
        }

        if (games.length === 1) {
            return {
                id: normalizeText(games[0].id),
                title: normalizeText(games[0].title || games[0].name)
            };
        }

        return {
            id: normalizeText(window.lastPlayedGameId || ''),
            title: ''
        };
    }

    function getWorkshopFileContentSafe(gameId = '', fileName = '', state = null) {
        const stateContent = state?.activeFileContent ?? state?.content ?? state?.value;
        if (typeof stateContent === 'string' && stateContent.length > 0) return stateContent;

        const domContent = getEditorDomContent();
        if (typeof domContent === 'string' && domContent.length > 0) return domContent;

        if (gameId && fileName && typeof window.getWorkshopFileContent === 'function') {
            try {
                const source = window.getWorkshopFileContent(gameId, fileName);
                if (typeof source === 'string') return source;
            } catch (error) {
                console.warn('[Arcade: Edit] getWorkshopFileContent failed:', error);
            }
        }

        return typeof stateContent === 'string' ? stateContent : '';
    }

    function buildReliableEditorSnapshot(state = null, selected = null, args = '') {
        const game = getVisibleEditorGame(state, selected, args);
        const activeFileName = getVisibleEditorFileName(state);
        const activeFileContent = getWorkshopFileContentSafe(game.id, activeFileName, state);

        const snapshot = {
            ...(state && typeof state === 'object' ? state : {}),
            activeGameId: normalizeText(game.id || state?.activeGameId || state?.gameId || ''),
            activeGameTitle: normalizeText(game.title || state?.activeGameTitle || state?.gameTitle || state?.title || ''),
            activeFileName,
            activeFileContent,
            activeFileContentLength: `${activeFileContent || ''}`.length,
            activeFileContentProvidedInEditProtocol: true,
            source: 'edit-command-visible-editor-snapshot'
        };

        window.__activeWorkshopEditorContext = snapshot;
        window.__lastWorkshopEditSnapshot = snapshot;
        return snapshot;
    }

    function installWorkshopEditorStateFallback() {
        if (workshopStateWrapperInstalled) return;
        workshopStateWrapperInstalled = true;
        originalGetWorkshopEditorState = typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState.bind(window)
            : null;

        window.getWorkshopEditorState = function getReliableWorkshopEditorState() {
            const originalState = originalGetWorkshopEditorState ? originalGetWorkshopEditorState() : null;
            const fallback = window.__activeWorkshopEditorContext || window.__lastWorkshopEditSnapshot || null;
            if (!fallback) return originalState;

            const originalHasIdentity = normalizeText(originalState?.activeGameId || originalState?.gameId || '')
                && normalizeText(originalState?.activeFileName || originalState?.fileName || '');
            const originalContent = originalState?.activeFileContent ?? originalState?.content ?? originalState?.value;
            const originalHasContent = typeof originalContent === 'string' && originalContent.length > 0;

            if (originalHasIdentity && originalHasContent) return originalState;

            const merged = {
                ...(fallback || {}),
                ...(originalState && typeof originalState === 'object' ? originalState : {})
            };

            merged.activeGameId = normalizeText(originalState?.activeGameId || originalState?.gameId || fallback?.activeGameId || fallback?.gameId || '');
            merged.activeGameTitle = normalizeText(originalState?.activeGameTitle || originalState?.gameTitle || originalState?.title || fallback?.activeGameTitle || fallback?.gameTitle || fallback?.title || '');
            merged.activeFileName = normalizeText(originalState?.activeFileName || originalState?.fileName || fallback?.activeFileName || fallback?.fileName || 'index.html');
            merged.activeFileContent = typeof originalContent === 'string' && originalContent.length > 0
                ? originalContent
                : `${fallback?.activeFileContent || ''}`;
            merged.activeFileContentLength = merged.activeFileContent.length;
            merged.activeFileContentProvidedInEditProtocol = true;
            merged.source = originalState?.source || fallback?.source || 'edit-command-state-wrapper';
            return merged;
        };
    }

    function resolveFallbackEditTarget(args = '') {
        const games = getManageableGames();
        if (games.length === 0) return null;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState()
            : null;
        const activeGameId = normalizeText(editorState?.activeGameId);
        const activeGame = activeGameId ? games.find((game) => game.id === activeGameId) : null;
        if (activeGame) return activeGame;

        const prompt = `${args || ''}`.toLowerCase();
        const promptGame = games.find((game) => {
            const title = normalizeText(game?.title || game?.name).toLowerCase();
            return title && prompt.includes(title);
        });
        if (promptGame) return promptGame;

        if (games.length === 1 || /\b(any|whatever|something|one of my|a game|my game|this|current|open|opened|selected)\b/.test(prompt)) {
            return games[0];
        }

        return null;
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
        const gameId = normalizeText(state?.activeGameId);
        const fileName = normalizeText(state?.activeFileName || 'index.html');
        return getWorkshopFileContentSafe(gameId, fileName, state);
    }

    async function selectWorkshopTargetFromPrompt(args = '') {
        const cleanArgs = normalizeText(args);
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

    async function hydrateEditorFromWorkshopState(selected = null, args = '') {
        const editorElement = getEditorElement();
        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;

        const snapshot = buildReliableEditorSnapshot(editorState, selected, args);
        const content = readCurrentWorkshopFileContent(snapshot);

        if (editorElement && typeof content === 'string' && content.length > 0) {
            writeEditorContent(editorElement, content);
        }

        buildReliableEditorSnapshot({ ...snapshot, activeFileContent: content }, selected, args);
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

    function extractCandidateTextsForPatchParsing(text = '') {
        const source = normalizeNewlines(text);
        const candidates = [source];
        const fenceRegex = /```[^\n`]*\n([\s\S]*?)```/g;
        let match;
        while ((match = fenceRegex.exec(source)) !== null) {
            if (match[1] && /SEARCH\s*:/i.test(match[1]) && /REPLACE\s*:/i.test(match[1])) {
                candidates.push(match[1]);
            }
        }
        return candidates;
    }

    function inferPatchFileName(text = '', fallbackFileName = 'index.html') {
        const source = normalizeNewlines(text);
        const editTagFile = source.match(/\[(?:EDIT|EDIT_FILE|FILE_EDIT)\s*:\s*([^\]\n]+)\]/i)?.[1];
        if (editTagFile) return editTagFile.trim().replace(/^['"]|['"]$/g, '');

        const filenameValue = source.match(/\b(?:file(?:name)?|path)\s*[:=]\s*['"]?([^'"\s`]+\.(?:html?|css|js|mjs|cjs|json|txt|svg|xml))['"]?/i)?.[1];
        if (filenameValue) return filenameValue.trim();

        const bareFilename = source.match(/\b([a-z0-9][\w.-]*\.(?:html?|css|js|mjs|cjs|json|txt|svg|xml))\b/i)?.[1];
        if (bareFilename) return bareFilename.trim();

        return fallbackFileName;
    }

    function parseRawSearchReplaceEdits(text = '', fallbackFileName = 'index.html') {
        const parsed = [];
        const seen = new Set();
        const candidates = extractCandidateTextsForPatchParsing(text);

        for (const candidate of candidates) {
            const source = stripOuterCodeFence(candidate);
            if (!/SEARCH\s*:/i.test(source) || !/REPLACE\s*:/i.test(source)) continue;

            const fileName = inferPatchFileName(source, fallbackFileName);
            const blockRegex = /(?:\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:\s*([^\]\n]+))?\]\s*)?SEARCH\s*:\s*([\s\S]*?)\s*REPLACE\s*:\s*([\s\S]*?)(?=\n\s*\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:|\])|\n\s*SEARCH\s*:|\s*\[\/(?:EDIT|EDIT_FILE|FILE_EDIT)\]|$)/gi;
            let match;
            while ((match = blockRegex.exec(source)) !== null) {
                const blockFileName = normalizeText(match[1] || fileName).replace(/^['"]|['"]$/g, '') || fallbackFileName;
                const search = cleanPatchText(match[2] || '');
                const replace = cleanPatchText(match[3] || '');
                if (!search && !replace) continue;

                const key = `${blockFileName}\n---SEARCH---\n${search}\n---REPLACE---\n${replace}`;
                if (seen.has(key)) continue;
                seen.add(key);
                parsed.push({ fileName: blockFileName, search, replace, source: 'raw-search-replace' });
            }
        }

        return parsed;
    }

    function removeDisplayedRawEditMessage(text = '') {
        const source = `${text || ''}`;
        if (!/SEARCH\s*:/i.test(source) || !/REPLACE\s*:/i.test(source)) return false;
        const container = document.getElementById('chat-messages');
        if (!container) return false;

        const messages = Array.from(container.querySelectorAll('.chat-message, .message-ai'));
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const node = messages[index];
            const content = `${node.textContent || ''}`;
            if (/SEARCH\s*:/i.test(content) && /REPLACE\s*:/i.test(content)) {
                node.remove();
                return true;
            }
        }
        return false;
    }

    async function saveWholeFile(gameId = '', fileName = '', content = '') {
        const targetGameId = normalizeText(gameId);
        const targetFileName = normalizeText(fileName || 'index.html');
        if (!targetGameId || !targetFileName) return { ok: false, message: 'Missing game or file.' };

        if (typeof window.internalApplyWorkshopFileEdit === 'function') {
            return await window.internalApplyWorkshopFileEdit(targetGameId, targetFileName, content, { save: true });
        }

        const editorElement = getEditorElement();
        writeEditorContent(editorElement, content);
        if (typeof window.saveWorkshopEditPanel === 'function') {
            const result = await window.saveWorkshopEditPanel();
            return result || { ok: true };
        }

        return { ok: true, message: 'Updated editor content, but no save helper was available.' };
    }

    async function applyManualSearchReplace(gameId = '', fileName = '', search = '', replace = '') {
        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const currentContent = getWorkshopFileContentSafe(gameId, fileName, editorState);
        if (typeof currentContent !== 'string') {
            return { ok: false, message: 'Could not read current file content.' };
        }

        const normalizedSearch = normalizeNewlines(search);
        const normalizedCurrent = normalizeNewlines(currentContent);
        if (!normalizedSearch) {
            return saveWholeFile(gameId, fileName, replace);
        }

        if (currentContent.includes(search)) {
            return saveWholeFile(gameId, fileName, currentContent.replace(search, replace));
        }

        if (normalizedCurrent.includes(normalizedSearch)) {
            const next = normalizedCurrent.replace(normalizedSearch, normalizeNewlines(replace));
            return saveWholeFile(gameId, fileName, next);
        }

        return { ok: false, message: `Search block not found in ${fileName}.` };
    }

    async function applyFullFileCodeBlocks(text = '') {
        const result = { attempted: false, ok: false };
        const blocks = extractAiCodeBlocks(text);
        if (blocks.length === 0) return result;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const gameId = normalizeText(editorState?.activeGameId || window.lastPlayedGameId || '');
        const fallbackFileName = normalizeText(editorState?.activeFileName || 'index.html');
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

                const applyResult = await saveWholeFile(gameId, targetFileName, content);
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

    async function applySurgicalEditBlocks(editBlocks = [], originalText = '') {
        const actionResult = {
            handled: false,
            workshopFileRewriteAttempted: false,
            workshopFileRewriteSucceeded: false
        };

        if (!Array.isArray(editBlocks) || editBlocks.length === 0) return actionResult;
        if (window.showFeedback) window.showFeedback('Applying surgical edits...', false);
        actionResult.handled = true;

        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const gameId = normalizeText(editorState?.activeGameId || window.lastPlayedGameId || '');
        const fallbackFileName = normalizeText(editorState?.activeFileName || 'index.html');

        if (!gameId) {
            console.warn('[Arcade: Edit] No active Workshop game for surgical edit.');
            return actionResult;
        }

        for (const editBlock of editBlocks) {
            const targetFileName = normalizeText(editBlock?.fileName || fallbackFileName);
            const search = `${editBlock?.search || ''}`;
            const replace = `${editBlock?.replace || ''}`;
            if (!targetFileName || (!search && !replace)) continue;

            actionResult.workshopFileRewriteAttempted = true;

            try {
                if (typeof window.setWorkshopEditActiveGame === 'function') {
                    await Promise.resolve(window.setWorkshopEditActiveGame(gameId, targetFileName));
                }

                let patchResult = null;
                if (search && typeof window.applyAiFilePatch === 'function') {
                    patchResult = await window.applyAiFilePatch(
                        gameId,
                        targetFileName,
                        search,
                        replace,
                        { save: true }
                    );
                }

                if (!patchResult?.ok) {
                    patchResult = await applyManualSearchReplace(gameId, targetFileName, search, replace);
                }

                if (patchResult?.ok) {
                    actionResult.workshopFileRewriteSucceeded = true;
                    removeDisplayedRawEditMessage(originalText);
                    if (window.showFeedback) window.showFeedback(`Saved AI edit to ${targetFileName}.`, false);
                } else if (window.showFeedback) {
                    window.showFeedback(patchResult?.message || 'Edit failed.', true);
                }
            } catch (error) {
                console.error('[Arcade: Edit] Action failed:', error);
                if (window.showFeedback) window.showFeedback(`Failed to save ${targetFileName}.`, true);
            }
        }

        return actionResult;
    }

    async function handleResponse(text, options = {}) {
        const editorState = typeof window.getWorkshopEditorState === 'function'
            ? await Promise.resolve(window.getWorkshopEditorState())
            : null;
        const fallbackFileName = normalizeText(editorState?.activeFileName || 'index.html');

        const structuredEditBlocks = typeof window.extractWorkshopEditBlocks === 'function'
            ? window.extractWorkshopEditBlocks(text)
            : [];
        const rawEditBlocks = parseRawSearchReplaceEdits(text, fallbackFileName);
        const editBlocks = structuredEditBlocks.length > 0 ? structuredEditBlocks : rawEditBlocks;

        if (editBlocks.length > 0) {
            return await applySurgicalEditBlocks(editBlocks, text);
        }

        const actionResult = {
            handled: false,
            workshopFileRewriteAttempted: false,
            workshopFileRewriteSucceeded: false
        };

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
                if (fallbackResult.ok) removeDisplayedRawEditMessage(text);
                return actionResult;
            }
        }

        const fullFileResult = await applyFullFileCodeBlocks(text);
        if (fullFileResult.attempted) {
            actionResult.handled = true;
            actionResult.workshopFileRewriteAttempted = true;
            actionResult.workshopFileRewriteSucceeded = !!fullFileResult.ok;
            if (fullFileResult.ok) removeDisplayedRawEditMessage(text);
            return actionResult;
        }

        return actionResult;
    }

    window.ArcadeCommandManager.register({
        id: 'edit',
        description: 'Edit the active Workshop file using the Workshop/Supabase editor state.',

        execute: async (args, inputElement) => {
            const cleanArgs = normalizeText(args);
            window.activeArcadeCommandMode = '/edit';

            try {
                installWorkshopEditorStateFallback();
                const selected = await selectWorkshopTargetFromPrompt(cleanArgs);
                await hydrateEditorFromWorkshopState(selected, cleanArgs);
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
            const games = getManageableGames();
            if (games.length === 0) return [];

            const prompt = `${args || ''}`.trim().toLowerCase();

            if (!prompt) {
                return games.map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Edit files in "${game.title}"`
                }));
            }

            const matchingGame = games.find((game) => prompt.startsWith(normalizeText(game.title).toLowerCase()));
            if (matchingGame) {
                const files = Array.isArray(matchingGame.files) ? matchingGame.files : [];
                const remaining = prompt.substring(normalizeText(matchingGame.title).length).trim();

                return files
                    .map((file) => ({
                        id: `${matchingGame.title} ${file.name}`,
                        name: file.name,
                        description: `Edit ${file.name} in "${matchingGame.title}"`
                    }))
                    .filter((suggestion) => !remaining || suggestion.name.toLowerCase().includes(remaining));
            }

            return games
                .filter((game) => normalizeText(game.title).toLowerCase().includes(prompt))
                .map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Edit files in "${game.title}"`
                }));
        },

        handleResponse
    });
})();
