/**
 * /edit Command
 *
 * Editor-scoped AI edit helper.
 *
 * Rules:
 * - Suggestions may read the current user's editable Workshop games/files.
 * - Execution may open a selected Workshop game/file in the editor.
 * - Saves only write back through the currently open editor.
 * - Does not publish, import, or touch external store state.
 * - Accepts SEARCH/REPLACE blocks and single full-file code fences.
 */
(function () {
    const COMMAND_ID = 'edit';
    let lastEditPrompt = '';
    let lastEditorSnapshot = '';

    const ACTION_WORDS = new Set([
        'add', 'insert', 'create', 'make', 'build', 'change', 'update', 'modify', 'replace',
        'remove', 'delete', 'fix', 'repair', 'debug', 'style', 'styles', 'css', 'javascript',
        'js', 'button', 'layout', 'color', 'colour', 'work', 'working', 'better', 'new',
        'feature', 'refactor', 'rename', 'rewrite', 'polish', 'improve', 'tweak', 'adjust'
    ]);

    const FILLER_WORDS = new Set([
        'a', 'an', 'and', 'the', 'to', 'for', 'in', 'on', 'of', 'my', 'game', 'workshop',
        'editor', 'file', 'index', 'html', 'please', 'current', 'selected', 'open', 'opened'
    ]);

    function normalizeText(value = '') {
        return `${value || ''}`.trim();
    }

    function normalizeNewlines(value = '') {
        return `${value || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function tokenize(value = '') {
        return `${value || ''}`.toLowerCase().match(/[a-z0-9]+/g) || [];
    }

    function showEditFeedback(message = '', isError = false) {
        if (!message) return;
        if (typeof window.showFeedback === 'function') {
            window.showFeedback(message, isError);
            return;
        }
        if (typeof window.addChatMessage === 'function') {
            window.addChatMessage('ai', isError ? `⚠️ ${message}` : message);
        }
    }

    function getEditorElement() {
        return document.getElementById('workshop-edit-file-content')
            || document.querySelector('[data-workshop-edit-file-content]')
            || document.querySelector('.workshop-edit-file-content')
            || document.querySelector('textarea[data-file-editor]')
            || document.querySelector('textarea.code-editor')
            || document.querySelector('textarea');
    }

    function readEditorContent() {
        const editor = getEditorElement();
        if (!editor) return '';
        if (typeof editor.value === 'string') return editor.value;
        if (typeof editor.textContent === 'string') return editor.textContent;
        return '';
    }

    function writeEditorContent(content = '') {
        const editor = getEditorElement();
        if (!editor) return false;

        const next = `${content || ''}`;
        if (typeof editor.value === 'string') {
            editor.value = next;
        } else {
            editor.textContent = next;
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));

        if (typeof window.handleWorkshopEditContentInput === 'function') window.handleWorkshopEditContentInput();
        if (typeof window.syncWorkshopEditorLineNumbers === 'function') window.syncWorkshopEditorLineNumbers();

        return true;
    }

    async function saveEditorContent(content = '') {
        if (!writeEditorContent(content)) {
            return { ok: false, message: 'No active editor was found.' };
        }

        if (typeof window.saveWorkshopEditPanel === 'function') {
            try {
                const result = await Promise.resolve(window.saveWorkshopEditPanel());
                if (result?.ok === false) return result;
            } catch (error) {
                return { ok: false, message: error?.message || 'Editor save failed.' };
            }
        }

        return { ok: true };
    }

    function getEditableGames() {
        if (typeof window.getWorkshopManageableGames !== 'function') return [];
        try {
            const games = window.getWorkshopManageableGames();
            return Array.isArray(games) ? games : [];
        } catch (_error) {
            return [];
        }
    }

    function gameTitle(game = null) {
        return normalizeText(game?.title || game?.name || game?.gameTitle || game?.id || '');
    }

    function gameFiles(game = null) {
        const files = Array.isArray(game?.files) ? game.files : [];
        return files
            .map((file) => typeof file === 'string' ? { name: file } : file)
            .filter((file) => normalizeText(file?.name || file?.fileName));
    }

    function fileName(file = null) {
        return normalizeText(file?.name || file?.fileName || '');
    }

    function getEditorState() {
        if (typeof window.getWorkshopEditorState !== 'function') return null;
        try {
            return window.getWorkshopEditorState();
        } catch (_error) {
            return null;
        }
    }

    function getActiveEditableGame() {
        const state = getEditorState();
        const activeId = normalizeText(state?.activeGameId || state?.gameId || '');
        if (!activeId) return null;
        return getEditableGames().find((game) => `${game?.id || ''}` === activeId) || null;
    }

    function stripLeadingTarget(args = '', target = null) {
        let remaining = normalizeText(args);
        if (!remaining || !target) return remaining;

        const title = gameTitle(target.game);
        const file = normalizeText(target.fileName || '');
        if (title && remaining.toLowerCase().startsWith(title.toLowerCase())) {
            remaining = remaining.slice(title.length).trim();
        }
        if (file && remaining.toLowerCase().startsWith(file.toLowerCase())) {
            remaining = remaining.slice(file.length).trim();
        }
        return remaining;
    }

    function isTargetOnlyEditRequest(args = '', target = null) {
        const remaining = stripLeadingTarget(args, target);
        const tokens = tokenize(remaining).filter((token) => !FILLER_WORDS.has(token));
        if (tokens.length === 0) return true;
        return !tokens.some((token) => ACTION_WORDS.has(token));
    }

    function resolveEditTarget(args = '') {
        const prompt = normalizeText(args).toLowerCase();
        if (!prompt) return null;

        const games = getEditableGames()
            .slice()
            .sort((a, b) => gameTitle(b).length - gameTitle(a).length);

        for (const game of games) {
            const title = gameTitle(game);
            if (!title || !prompt.startsWith(title.toLowerCase())) continue;

            const rest = normalizeText(args).slice(title.length).trim().toLowerCase();
            const files = gameFiles(game);
            const matchedFile = files
                .slice()
                .sort((a, b) => fileName(b).length - fileName(a).length)
                .find((file) => {
                    const name = fileName(file).toLowerCase();
                    return name && rest.startsWith(name);
                });

            return {
                game,
                gameId: normalizeText(game?.id || ''),
                gameTitle: title,
                fileName: matchedFile ? fileName(matchedFile) : ''
            };
        }

        return null;
    }

    async function openEditorTarget(target = null, args = '') {
        if (!target?.gameId || typeof window.setWorkshopEditActiveGame !== 'function') {
            return { ok: false, message: 'Workshop editor target switching is unavailable.' };
        }

        try {
            const file = normalizeText(target.fileName || '');
            const result = file
                ? await Promise.resolve(window.setWorkshopEditActiveGame(target.gameId, file))
                : await Promise.resolve(window.setWorkshopEditActiveGame(target.gameId, { prompt: args }));
            return result || { ok: true };
        } catch (error) {
            return { ok: false, message: error?.message || 'Failed to open Workshop editor target.' };
        }
    }

    function buildEditorSnapshot() {
        const state = getEditorState();
        const editorContent = readEditorContent();
        const content = editorContent || `${state?.activeFileContent || state?.content || ''}`;
        const snapshot = {
            ...(state && typeof state === 'object' ? state : {}),
            activeFileContent: content,
            activeFileContentLength: content.length,
            activeFileContentProvidedInEditProtocol: true,
            source: 'edit-js-editor-scoped-snapshot'
        };
        window.__activeWorkshopEditorContext = snapshot;
        return snapshot;
    }

    function stripCodeFence(value = '') {
        let text = normalizeNewlines(value).trim();
        const match = text.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
        if (match) text = match[1].trim();
        return text;
    }

    function cleanPatchPart(value = '') {
        return stripCodeFence(value)
            .replace(/^\s*SEARCH\s*:\s*/i, '')
            .replace(/^\s*REPLACE\s*:\s*/i, '')
            .replace(/^\s*```[^\n`]*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();
    }

    function parseSearchReplaceBlocks(text = '') {
        const source = normalizeNewlines(text);
        const candidates = [source];
        const fenceRegex = /```[^\n`]*\n([\s\S]*?)```/g;
        let fence;

        while ((fence = fenceRegex.exec(source)) !== null) {
            if (/SEARCH\s*:/i.test(fence[1] || '') && /REPLACE\s*:/i.test(fence[1] || '')) {
                candidates.push(fence[1]);
            }
        }

        const blocks = [];
        const seen = new Set();
        const blockRegex = /(?:\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:[^\]\n]+)?\]\s*)?SEARCH\s*:\s*([\s\S]*?)\s*REPLACE\s*:\s*([\s\S]*?)(?=\n\s*\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:|\])|\n\s*SEARCH\s*:|\s*\[\/(?:EDIT|EDIT_FILE|FILE_EDIT)\]|$)/gi;

        for (const candidate of candidates) {
            if (!/SEARCH\s*:/i.test(candidate) || !/REPLACE\s*:/i.test(candidate)) continue;

            let match;
            while ((match = blockRegex.exec(candidate)) !== null) {
                const search = cleanPatchPart(match[1] || '');
                const replace = cleanPatchPart(match[2] || '');
                const key = `${search}\n---\n${replace}`;
                if ((!search && !replace) || seen.has(key)) continue;
                seen.add(key);
                blocks.push({ search, replace });
            }
        }

        return blocks;
    }

    function parseSingleFullFileBlock(text = '') {
        const source = normalizeNewlines(text).trim();
        const blocks = [];
        const fenceRegex = /```[^\n`]*\n([\s\S]*?)```/g;
        let match;

        while ((match = fenceRegex.exec(source)) !== null) {
            const content = normalizeNewlines(match[1] || '').trim();
            if (!content) continue;
            if (/SEARCH\s*:/i.test(content) && /REPLACE\s*:/i.test(content)) continue;
            blocks.push(content);
        }

        if (blocks.length === 1) return blocks[0];
        return '';
    }

    function collapseWhitespace(value = '') {
        return normalizeNewlines(value).replace(/\s+/g, ' ').trim();
    }

    function findCollapsedWhitespaceRange(content = '', search = '') {
        const source = normalizeNewlines(content);
        const target = collapseWhitespace(search);
        if (!target) return null;

        for (let start = 0; start < source.length; start += 1) {
            while (start < source.length && /\s/.test(source[start])) start += 1;

            let normalized = '';
            let lastSpace = false;
            for (let end = start; end < source.length; end += 1) {
                const ch = source[end];
                if (/\s/.test(ch)) {
                    if (!lastSpace) normalized += ' ';
                    lastSpace = true;
                } else {
                    normalized += ch;
                    lastSpace = false;
                }

                const partial = normalized.trim();
                if (partial === target) return { start, end: end + 1 };
                if (partial.length > 32 && !target.startsWith(partial)) break;
                if (partial.length > target.length + 8) break;
            }
        }

        return null;
    }

    function applySearchReplace(content = '', search = '', replace = '') {
        const current = normalizeNewlines(content);
        const rawSearch = normalizeNewlines(search);
        const rawReplace = normalizeNewlines(replace);

        if (!rawSearch.trim()) {
            return { ok: true, content: rawReplace, method: 'full-replace' };
        }

        if (current.includes(rawSearch)) {
            return { ok: true, content: current.replace(rawSearch, rawReplace), method: 'exact' };
        }

        const collapsedRange = findCollapsedWhitespaceRange(current, rawSearch);
        if (collapsedRange) {
            return {
                ok: true,
                content: `${current.slice(0, collapsedRange.start)}${rawReplace}${current.slice(collapsedRange.end)}`,
                method: 'whitespace-normalized'
            };
        }

        return { ok: false, content: current, method: 'no-match' };
    }

    function isEditActive(text = '') {
        const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
        if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);
        return modes.has('/edit') || /^\s*\/edit\b/i.test(text);
    }

    function getGameSuggestions(args = '') {
        const prompt = normalizeText(args).toLowerCase();
        const games = getEditableGames();
        const activeGame = getActiveEditableGame();
        const suggestions = [];

        if (!prompt && activeGame) {
            const activeState = getEditorState();
            const activeFile = normalizeText(activeState?.activeFileName || '');
            suggestions.push({
                id: activeFile ? `${gameTitle(activeGame)} ${activeFile}` : gameTitle(activeGame),
                name: activeFile ? `Current: ${gameTitle(activeGame)} / ${activeFile}` : `Current: ${gameTitle(activeGame)}`,
                description: 'Edit the currently open Workshop editor target.'
            });
        }

        const sortedGames = games
            .slice()
            .sort((a, b) => gameTitle(a).localeCompare(gameTitle(b)));

        const matchingGame = sortedGames.find((game) => {
            const title = gameTitle(game).toLowerCase();
            return title && prompt.startsWith(title);
        });

        if (matchingGame) {
            const title = gameTitle(matchingGame);
            const remaining = prompt.slice(title.length).trim();
            const files = gameFiles(matchingGame);
            return files
                .filter((file) => !remaining || fileName(file).toLowerCase().includes(remaining))
                .slice(0, 10)
                .map((file) => ({
                    id: `${title} ${fileName(file)}`,
                    name: fileName(file),
                    description: `Open ${fileName(file)} in "${title}" for editing.`
                }));
        }

        const gameMatches = sortedGames
            .filter((game) => {
                const title = gameTitle(game).toLowerCase();
                if (!title) return false;
                if (!prompt) return true;
                return title.includes(prompt);
            })
            .slice(0, 10)
            .map((game) => {
                const files = gameFiles(game);
                return {
                    id: gameTitle(game),
                    name: gameTitle(game),
                    description: files.length > 0
                        ? `Edit ${files.length} file${files.length === 1 ? '' : 's'} in this Workshop game.`
                        : 'Open this Workshop game for editing.'
                };
            });

        return [...suggestions, ...gameMatches].slice(0, 10);
    }

    window.ArcadeCommandManager.register({
        id: COMMAND_ID,
        description: 'Edit the current editor or choose one of your editable Workshop games.',

        execute: async (args, inputElement) => {
            const prompt = normalizeText(args);
            let target = resolveEditTarget(prompt);

            if (target?.gameId) {
                const opened = await openEditorTarget(target, prompt);
                if (opened?.ok === false) {
                    showEditFeedback(opened.message || 'Failed to open the selected editor target.', true);
                    return true;
                }

                // If the user only selected a game/file, stop here and ask for edit instructions.
                if (isTargetOnlyEditRequest(prompt, target)) {
                    if (inputElement) inputElement.value = '';
                    const state = getEditorState();
                    const selectedFile = normalizeText(state?.activeFileName || target.fileName || 'selected file');
                    if (typeof window.addChatMessage === 'function') {
                        window.addChatMessage('ai', `[Workshop Edit]: Opened "${target.gameTitle}" (${selectedFile}). Now tell me what to edit, for example: /edit ${target.gameTitle} ${selectedFile} style the start screen.`);
                    }
                    return true;
                }
            }

            lastEditPrompt = prompt;
            const snapshot = buildEditorSnapshot();
            lastEditorSnapshot = snapshot.activeFileContent || readEditorContent();

            window.activeArcadeCommandMode = '/edit';
            if (Array.isArray(window.activeArcadeCommandModes)) {
                if (!window.activeArcadeCommandModes.includes('/edit')) window.activeArcadeCommandModes.push('/edit');
            } else {
                window.activeArcadeCommandModes = ['/edit'];
            }

            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = prompt ? `/edit ${prompt}` : '/edit';
            }

            return false;
        },

        getSuggestions: getGameSuggestions,

        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                editorEditAttempted: false,
                editorEditSucceeded: false,
                errorReason: null
            };

            const userPrompt = options.userPrompt || lastEditPrompt || '';
            if (!isEditActive(userPrompt)) return actionResult;

            const current = readEditorContent();
            if (!getEditorElement()) {
                actionResult.handled = true;
                actionResult.editorEditAttempted = true;
                actionResult.errorReason = 'No active editor was found.';
                showEditFeedback(actionResult.errorReason, true);
                return actionResult;
            }

            actionResult.handled = true;
            actionResult.editorEditAttempted = true;

            let next = current;
            const blocks = parseSearchReplaceBlocks(text);

            if (blocks.length > 0) {
                for (const block of blocks) {
                    const patched = applySearchReplace(next, block.search, block.replace);
                    if (!patched.ok) {
                        actionResult.errorReason = 'AI edit did not match the current editor content.';
                        showEditFeedback(actionResult.errorReason, true);
                        return actionResult;
                    }
                    next = patched.content;
                }
            } else {
                const fullFile = parseSingleFullFileBlock(text);
                if (!fullFile) {
                    actionResult.errorReason = 'No editor edit block was found.';
                    showEditFeedback(actionResult.errorReason, true);
                    return actionResult;
                }
                next = fullFile;
            }

            const saveResult = await saveEditorContent(next);
            if (saveResult?.ok === false) {
                actionResult.errorReason = saveResult?.message || 'Editor save failed.';
                showEditFeedback(actionResult.errorReason, true);
                return actionResult;
            }

            lastEditorSnapshot = next;
            actionResult.editorEditSucceeded = true;
            showEditFeedback('Saved edit to the current editor.', false);

            window.activeArcadeCommandMode = null;
            window.activeArcadeCommandModes = Array.isArray(window.activeArcadeCommandModes)
                ? window.activeArcadeCommandModes.filter((mode) => mode !== '/edit')
                : [];

            return actionResult;
        }
    });
})();
