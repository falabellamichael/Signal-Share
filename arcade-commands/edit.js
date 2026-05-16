/**
 * /edit Command
 *
 * Editor-only AI edit helper.
 *
 * Rules:
 * - Only reads from the currently open editor.
 * - Only writes back to the currently open editor.
 * - Does not resolve games, switch files, publish, import, or touch external store state.
 * - Accepts SEARCH/REPLACE blocks and single full-file code fences.
 */
(function () {
    const COMMAND_ID = 'edit';
    let lastEditPrompt = '';
    let lastEditorSnapshot = '';

    function normalizeText(value = '') {
        return `${value || ''}`.trim();
    }

    function normalizeNewlines(value = '') {
        return `${value || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

    window.ArcadeCommandManager.register({
        id: COMMAND_ID,
        description: 'Edit only the currently open editor content.',

        execute: async (args, inputElement) => {
            const prompt = normalizeText(args);
            lastEditPrompt = prompt;
            lastEditorSnapshot = readEditorContent();

            window.activeArcadeCommandMode = '/edit';
            if (Array.isArray(window.activeArcadeCommandModes)) {
                if (!window.activeArcadeCommandModes.includes('/edit')) window.activeArcadeCommandModes.push('/edit');
            } else {
                window.activeArcadeCommandModes = ['/edit'];
            }

            window.__activeWorkshopEditorContext = {
                activeFileContent: lastEditorSnapshot,
                activeFileContentLength: lastEditorSnapshot.length,
                activeFileContentProvidedInEditProtocol: true,
                source: 'edit-js-editor-only-snapshot'
            };

            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = prompt ? `/edit ${prompt}` : '/edit';
            }

            return false;
        },

        getSuggestions: () => [],

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
