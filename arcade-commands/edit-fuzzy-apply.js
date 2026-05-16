/**
 * /edit fuzzy apply support.
 *
 * LM Studio often returns useful SEARCH/REPLACE edits whose SEARCH text differs
 * from the active file by formatting, comments, or small regenerated details.
 * This module wraps the registered /edit handler and adds safe fallback patching:
 * - exact apply remains first
 * - normalized-whitespace apply second
 * - full JavaScript function replacement third
 * - CSS selector block replacement fourth
 */
(function () {
    if (window.__arcadeEditFuzzyApplyInstalled) return;
    window.__arcadeEditFuzzyApplyInstalled = true;

    function normalizeText(value = '') {
        return `${value || ''}`.trim();
    }

    function normalizeNewlines(value = '') {
        return `${value || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function collapseWhitespace(value = '') {
        return normalizeNewlines(value).replace(/\s+/g, ' ').trim();
    }

    function getEditorState() {
        try {
            return typeof window.getWorkshopEditorState === 'function'
                ? window.getWorkshopEditorState()
                : null;
        } catch (_error) {
            return null;
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

    function readFileContent(gameId = '', fileName = '', state = null) {
        const stateContent = state?.activeFileContent ?? state?.content ?? state?.value;
        if (typeof stateContent === 'string' && stateContent.length > 0) return stateContent;

        if (gameId && fileName && typeof window.getWorkshopFileContent === 'function') {
            try {
                const content = window.getWorkshopFileContent(gameId, fileName);
                if (typeof content === 'string') return content;
            } catch (_error) {
                // Fall through to editor DOM.
            }
        }

        const editorElement = getEditorElement();
        if (typeof editorElement?.value === 'string') return editorElement.value;
        if (typeof editorElement?.textContent === 'string') return editorElement.textContent;
        return '';
    }

    function writeEditorContent(content = '') {
        const editorElement = getEditorElement();
        if (!editorElement) return false;
        editorElement.value = `${content || ''}`;
        editorElement.dispatchEvent(new Event('input', { bubbles: true }));
        editorElement.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.handleWorkshopEditContentInput === 'function') window.handleWorkshopEditContentInput();
        if (typeof window.syncWorkshopEditorLineNumbers === 'function') window.syncWorkshopEditorLineNumbers();
        return true;
    }

    async function saveWholeFile(gameId = '', fileName = '', content = '') {
        if (typeof window.internalApplyWorkshopFileEdit === 'function') {
            return await window.internalApplyWorkshopFileEdit(gameId, fileName, content, { save: true });
        }

        writeEditorContent(content);
        if (typeof window.saveWorkshopEditPanel === 'function') {
            const result = await window.saveWorkshopEditPanel();
            return result || { ok: true };
        }
        return { ok: true, message: 'Updated editor content; no save helper was available.' };
    }

    function stripFence(value = '') {
        let text = normalizeNewlines(value).trim();
        const match = text.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
        if (match) text = match[1].trim();
        return text;
    }

    function cleanBlock(value = '') {
        return stripFence(value)
            .replace(/^\s*SEARCH:\s*/i, '')
            .replace(/^\s*REPLACE:\s*/i, '')
            .trim();
    }

    function inferFileName(text = '', fallbackFileName = 'index.html') {
        const source = normalizeNewlines(text);
        return source.match(/\[(?:EDIT|EDIT_FILE|FILE_EDIT)\s*:\s*([^\]\n]+)\]/i)?.[1]?.trim()
            || source.match(/\b(?:file(?:name)?|path)\s*[:=]\s*['"]?([^'"\s`]+\.(?:html?|css|js|mjs|cjs|json|txt|svg|xml))['"]?/i)?.[1]?.trim()
            || fallbackFileName;
    }

    function parseSearchReplaceBlocks(text = '', fallbackFileName = 'index.html') {
        const source = normalizeNewlines(text);
        const candidates = [source];
        const fenceRegex = /```[^\n`]*\n([\s\S]*?)```/g;
        let fenceMatch;
        while ((fenceMatch = fenceRegex.exec(source)) !== null) {
            if (/SEARCH\s*:/i.test(fenceMatch[1] || '') && /REPLACE\s*:/i.test(fenceMatch[1] || '')) {
                candidates.push(fenceMatch[1]);
            }
        }

        const blocks = [];
        const seen = new Set();
        for (const candidate of candidates) {
            const fileName = inferFileName(candidate, fallbackFileName);
            const blockRegex = /(?:\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:\s*([^\]\n]+))?\]\s*)?SEARCH\s*:\s*([\s\S]*?)\s*REPLACE\s*:\s*([\s\S]*?)(?=\n\s*\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:|\])|\n\s*SEARCH\s*:|\s*\[\/(?:EDIT|EDIT_FILE|FILE_EDIT)\]|$)/gi;
            let match;
            while ((match = blockRegex.exec(candidate)) !== null) {
                const targetFile = normalizeText(match[1] || fileName) || fallbackFileName;
                const search = cleanBlock(match[2] || '');
                const replace = cleanBlock(match[3] || '');
                if (!search && !replace) continue;
                const key = `${targetFile}\n${search}\n${replace}`;
                if (seen.has(key)) continue;
                seen.add(key);
                blocks.push({ fileName: targetFile, search, replace });
            }
        }
        return blocks;
    }

    function findCollapsedWhitespaceRange(content = '', search = '') {
        const source = normalizeNewlines(content);
        const target = collapseWhitespace(search);
        if (!target) return null;

        for (let start = 0; start < source.length; start += 1) {
            while (start < source.length && /\s/.test(source[start])) start += 1;
            let i = start;
            let normalized = '';
            let lastWasSpace = false;

            while (i < source.length && normalized.length <= target.length + 4) {
                const ch = source[i];
                if (/\s/.test(ch)) {
                    if (!lastWasSpace) {
                        normalized += ' ';
                        lastWasSpace = true;
                    }
                } else {
                    normalized += ch;
                    lastWasSpace = false;
                }

                const partial = normalized.trim();
                if (partial === target) return { start, end: i + 1 };
                if (!target.startsWith(partial) && partial.length > 20) break;
                i += 1;
            }
        }
        return null;
    }

    function extractFunctionName(value = '') {
        const text = normalizeNewlines(value);
        return text.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1]
            || text.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/)?.[1]
            || '';
    }

    function findFunctionRange(content = '', functionName = '') {
        const source = normalizeNewlines(content);
        const name = normalizeText(functionName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!name) return null;

        const patterns = [
            new RegExp(`\\bfunction\\s+${name}\\s*\\(`, 'm'),
            new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`, 'm')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(source);
            if (!match) continue;

            const start = match.index;
            const openBrace = source.indexOf('{', start);
            if (openBrace === -1) continue;

            let depth = 0;
            let quote = '';
            let escaped = false;
            for (let i = openBrace; i < source.length; i += 1) {
                const ch = source[i];
                if (quote) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === quote) {
                        quote = '';
                    }
                    continue;
                }

                if (ch === '"' || ch === "'" || ch === '`') {
                    quote = ch;
                    continue;
                }
                if (ch === '{') depth += 1;
                if (ch === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        let end = i + 1;
                        while (source[end] === ';' || source[end] === '\n') end += 1;
                        return { start, end };
                    }
                }
            }
        }
        return null;
    }

    function extractCssSelector(value = '') {
        const text = normalizeNewlines(value).trim();
        return text.match(/^([^{}@][^{]+)\s*\{/)?.[1]?.trim() || '';
    }

    function findCssBlockRange(content = '', selector = '') {
        const source = normalizeNewlines(content);
        const cleanSelector = normalizeText(selector);
        if (!cleanSelector) return null;
        const selectorIndex = source.indexOf(cleanSelector);
        if (selectorIndex === -1) return null;
        const openBrace = source.indexOf('{', selectorIndex);
        if (openBrace === -1) return null;
        let depth = 0;
        for (let i = openBrace; i < source.length; i += 1) {
            if (source[i] === '{') depth += 1;
            if (source[i] === '}') {
                depth -= 1;
                if (depth === 0) return { start: selectorIndex, end: i + 1 };
            }
        }
        return null;
    }

    function applyFuzzyPatchToContent(content = '', search = '', replace = '') {
        const current = normalizeNewlines(content);
        const exactSearch = `${search || ''}`;
        const replacement = `${replace || ''}`;

        if (!exactSearch.trim()) {
            return replacement;
        }

        if (current.includes(exactSearch)) {
            return current.replace(exactSearch, replacement);
        }

        const normalizedRange = findCollapsedWhitespaceRange(current, exactSearch);
        if (normalizedRange) {
            return `${current.slice(0, normalizedRange.start)}${replacement}${current.slice(normalizedRange.end)}`;
        }

        const functionName = extractFunctionName(exactSearch) || extractFunctionName(replacement);
        const functionRange = findFunctionRange(current, functionName);
        if (functionName && functionRange) {
            return `${current.slice(0, functionRange.start)}${replacement}${current.slice(functionRange.end)}`;
        }

        const selector = extractCssSelector(exactSearch) || extractCssSelector(replacement);
        const cssRange = findCssBlockRange(current, selector);
        if (selector && cssRange) {
            return `${current.slice(0, cssRange.start)}${replacement}${current.slice(cssRange.end)}`;
        }

        return null;
    }

    async function applyFuzzyBlocks(text = '') {
        const state = getEditorState();
        const gameId = normalizeText(state?.activeGameId || window.lastPlayedGameId || '');
        const fallbackFileName = normalizeText(state?.activeFileName || 'index.html');
        if (!gameId) return { attempted: false, ok: false, message: 'No active game.' };

        const blocks = parseSearchReplaceBlocks(text, fallbackFileName);
        if (blocks.length === 0) return { attempted: false, ok: false, message: 'No search/replace block.' };

        let ok = false;
        let attempted = false;
        let lastMessage = '';

        for (const block of blocks) {
            const fileName = normalizeText(block.fileName || fallbackFileName);
            const current = readFileContent(gameId, fileName, state);
            const next = applyFuzzyPatchToContent(current, block.search, block.replace);
            attempted = true;

            if (next === null || next === current) {
                lastMessage = `Search text did not match ${fileName}.`;
                continue;
            }

            if (typeof window.setWorkshopEditActiveGame === 'function') {
                await Promise.resolve(window.setWorkshopEditActiveGame(gameId, fileName));
            }

            const result = await saveWholeFile(gameId, fileName, next);
            if (result?.ok !== false) {
                ok = true;
                lastMessage = `Saved fuzzy edit to ${fileName}.`;
                if (window.showFeedback) window.showFeedback(lastMessage, false);
            } else {
                lastMessage = result?.message || `Failed to save ${fileName}.`;
                if (window.showFeedback) window.showFeedback(lastMessage, true);
            }
        }

        return { attempted, ok, message: lastMessage };
    }

    function installWrapper() {
        const editCommand = window.ArcadeCommandManager?.getCommand?.('edit');
        if (!editCommand || typeof editCommand.handleResponse !== 'function') {
            window.setTimeout(installWrapper, 50);
            return;
        }
        if (editCommand.handleResponse.__fuzzyApplyWrapped) return;

        const originalHandleResponse = editCommand.handleResponse.bind(editCommand);
        editCommand.handleResponse = async function fuzzyEditHandleResponse(text, options = {}) {
            const originalResult = await originalHandleResponse(text, options);
            if (originalResult?.workshopFileRewriteSucceeded) return originalResult;

            const fuzzyResult = await applyFuzzyBlocks(text);
            if (!fuzzyResult.attempted) return originalResult;

            return {
                handled: true,
                workshopFileRewriteAttempted: true,
                workshopFileRewriteSucceeded: !!fuzzyResult.ok,
                fuzzyApplied: !!fuzzyResult.ok,
                message: fuzzyResult.message || originalResult?.message || ''
            };
        };
        editCommand.handleResponse.__fuzzyApplyWrapped = true;
    }

    installWrapper();
})();
