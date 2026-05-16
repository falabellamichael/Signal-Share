/**
 * Workshop editor error actions.
 * Owns the "Fix with A.I." control so the core editor can stay focused on editing.
 */
(function () {
    const ACTIONS_ID = 'workshop-edit-error-actions';
    const observedPreviewFrames = new WeakSet();
    let lastWorkshopEditorError = null;
    let lastCapturedRuntimeErrorKey = '';
    let lastCapturedRuntimeErrorAt = 0;

    function getActionsContainer() {
        const statusEl = document.getElementById('workshop-edit-status');
        if (!statusEl) return null;

        let actionsEl = document.getElementById(ACTIONS_ID);
        if (!actionsEl) {
            actionsEl = document.createElement('div');
            actionsEl.id = ACTIONS_ID;
            actionsEl.className = 'workshop-edit-error-actions';
            statusEl.insertAdjacentElement('afterend', actionsEl);
        }
        return actionsEl;
    }

    function clearActions() {
        const actionsEl = document.getElementById(ACTIONS_ID);
        if (actionsEl) actionsEl.replaceChildren();
    }

    function getEditorState() {
        if (typeof window.getWorkshopEditorState !== 'function') return {};
        try {
            return window.getWorkshopEditorState() || {};
        } catch (error) {
            console.warn('[Workshop Editor] Failed to read editor state for AI fix:', error);
            return {};
        }
    }

    function parseRelatedErrorFile(message = '') {
        const text = `${message || ''}`;
        const declaredInMatch = text.match(/\bdeclared\s+in\s+([A-Za-z0-9_.-]+\.(?:html?|css|js|mjs|cjs|json|txt))\s+at\s+line\s+(\d+)/i);
        if (declaredInMatch) {
            return {
                fileName: declaredInMatch[1],
                line: Number.parseInt(declaredInMatch[2], 10) || 0,
                role: 'Original declaration'
            };
        }

        const previousLineMatch = text.match(/\bprevious\s+declaration\s+at\s+line\s+(\d+)/i);
        if (previousLineMatch) {
            return {
                fileName: '',
                line: Number.parseInt(previousLineMatch[1], 10) || 0,
                role: 'Previous declaration'
            };
        }

        return null;
    }

    function parseUndefinedIdentifier(message = '') {
        const match = `${message || ''}`.match(/(?:ReferenceError:\s*)?([A-Za-z_$][\w$]*)\s+is\s+not\s+defined/i);
        return match ? match[1] : '';
    }

    function getLineSnippet(content = '', targetLine = 0, radius = 5) {
        const lines = `${content || ''}`.replace(/\r\n/g, '\n').split('\n');
        const lineNumber = Math.max(1, Number.parseInt(targetLine, 10) || 1);
        const start = Math.max(1, lineNumber - radius);
        const end = Math.min(lines.length, lineNumber + radius);
        const width = `${end}`.length;
        const snippet = [];

        for (let line = start; line <= end; line += 1) {
            const marker = line === lineNumber ? '>' : ' ';
            snippet.push(`${marker} ${`${line}`.padStart(width, ' ')} | ${lines[line - 1] || ''}`);
        }

        return snippet.join('\n');
    }

    function getIdentifierSnippets(content = '', identifier = '', radius = 4, maxSnippets = 4) {
        const name = `${identifier || ''}`.trim();
        if (!name) return '';

        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\b${escaped}\\b`);
        const lines = `${content || ''}`.replace(/\r\n/g, '\n').split('\n');
        const hits = [];

        for (let index = 0; index < lines.length; index += 1) {
            if (pattern.test(lines[index])) hits.push(index + 1);
            if (hits.length >= maxSnippets) break;
        }

        if (hits.length === 0) return '';

        return hits.map((lineNumber) => [
            `[Identifier reference: ${name} near line ${lineNumber}]`,
            '```',
            getLineSnippet(content, lineNumber, radius),
            '```'
        ].join('\n')).join('\n\n');
    }

    function getWorkshopFileSnippet(gameId = '', fileName = '', line = 0, role = 'File') {
        const targetGameId = `${gameId || ''}`.trim();
        const targetFileName = `${fileName || ''}`.trim();
        if (!targetGameId || !targetFileName || typeof window.getWorkshopFileContent !== 'function') return '';

        const content = window.getWorkshopFileContent(targetGameId, targetFileName);
        if (typeof content !== 'string' || !content.trim()) return '';

        return [
            `[${role}: ${targetFileName}${line ? ` line ${line}` : ''}]`,
            '```',
            getLineSnippet(content, line || 1),
            '```'
        ].join('\n');
    }

    function getWorkshopFileContentSafe(gameId = '', fileName = '', state = {}) {
        if (typeof state.activeFileContent === 'string' && state.activeFileContent.trim()) {
            return state.activeFileContent;
        }

        if (gameId && fileName && typeof window.getWorkshopFileContent === 'function') {
            try {
                const content = window.getWorkshopFileContent(gameId, fileName);
                if (typeof content === 'string') return content;
            } catch (_error) {
                return '';
            }
        }

        const editorElement = document.getElementById('workshop-edit-file-content');
        return typeof editorElement?.value === 'string' ? editorElement.value : '';
    }

    function buildErrorContextSnippets(detail, state) {
        const snippets = [];
        const gameId = `${state.activeGameId || ''}`.trim();
        const errorFileName = `${detail.fileName || state.activeFileName || ''}`.trim();
        const errorLine = detail.line || state.highlightedLine || 0;
        const related = parseRelatedErrorFile(detail.message);
        const relatedFileName = `${related?.fileName || errorFileName}`.trim();

        const errorSnippet = getWorkshopFileSnippet(gameId, errorFileName, errorLine, 'Error target');
        if (errorSnippet) snippets.push(errorSnippet);

        if (related?.line && relatedFileName && !(relatedFileName === errorFileName && related.line === errorLine)) {
            const relatedSnippet = getWorkshopFileSnippet(gameId, relatedFileName, related.line, related.role);
            if (relatedSnippet) snippets.push(relatedSnippet);
        }

        const undefinedIdentifier = detail.undefinedIdentifier || parseUndefinedIdentifier(detail.message);
        if (undefinedIdentifier) {
            const content = getWorkshopFileContentSafe(gameId, errorFileName || state.activeFileName, state);
            const identifierSnippets = getIdentifierSnippets(content, undefinedIdentifier);
            if (identifierSnippets) snippets.push(identifierSnippets);
        }

        return snippets.join('\n\n');
    }

    function openCompanionIfCollapsed() {
        const sidebar = document.querySelector('.steam-chat-sidebar');
        if (!sidebar || !sidebar.classList.contains('collapsed')) return;
        if (typeof window.toggleChat === 'function') {
            window.toggleChat();
        }
    }

    function buildAiFixPrompt(errorDetail) {
        const detail = errorDetail || {};
        const state = getEditorState();
        const fileName = detail.fileName || state.activeFileName || 'the open file';
        const lineText = detail.line ? ` line ${detail.line}` : '';
        const activeFileText = state.activeFileName && state.activeFileName !== fileName
            ? ` The editor is currently on ${state.activeFileName}.`
            : '';
        const undefinedIdentifier = detail.undefinedIdentifier || parseUndefinedIdentifier(detail.message);
        const runtimeText = detail.runtimeSource
            ? ` Runtime source: ${detail.runtimeSource}${detail.runtimeLine ? `:${detail.runtimeLine}` : ''}.`
            : '';
        const snippets = buildErrorContextSnippets(detail, state);

        return [
            `Fix this Workshop validation/runtime error in ${fileName}${lineText}.`,
            `Error: ${detail.message || 'Unknown editor error.'}`,
            undefinedIdentifier ? `The undefined identifier is "${undefinedIdentifier}". Find where it is used and either declare it correctly, replace it with the intended variable, or derive it from the current object/state.` : '',
            runtimeText,
            'Do not ask me to paste code. The Workshop editor and related file snippets are available in this request.',
            'Use the current Workshop editor files, inspect any referenced HTML/CSS/JS files, and make the smallest surgical fix.',
            'If the issue is split across index.html and game.js, edit the correct file instead of rewriting the whole game.',
            snippets ? `Relevant snippets:\n${snippets}` : '',
            activeFileText
        ].filter(Boolean).join(' ');
    }

    function runAiFix() {
        if (!lastWorkshopEditorError) return;

        const prompt = buildAiFixPrompt(lastWorkshopEditorError);
        const state = getEditorState();
        
        // If the file is empty, use rewrite mode instead of fix mode
        if (!state.activeFileContent || !state.activeFileContent.trim()) {
            window.activeArcadeCommandMode = '/rewrite';
        } else {
            window.activeArcadeCommandMode = '/fix';
        }
        
        openCompanionIfCollapsed();

        if (typeof window.sendChatMessage === 'function') {
            void window.sendChatMessage(prompt);
            return;
        }

        const input = document.getElementById('arc-chat-input');
        if (input) {
            input.value = prompt;
            input.focus();
        }
    }

    function renderActions(errorDetail) {
        const detail = errorDetail || {};
        if (!detail.isError || !detail.message) {
            lastWorkshopEditorError = null;
            clearActions();
            return;
        }

        lastWorkshopEditorError = detail;
        const actionsEl = getActionsContainer();
        if (!actionsEl) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workshop-ai-fix-btn';
        button.textContent = 'Fix with A.I.';
        button.addEventListener('click', runAiFix);

        const note = document.createElement('span');
        note.className = 'workshop-ai-fix-note';
        note.textContent = detail.kind === 'runtime'
            ? 'Captured preview runtime error and editor context for the arcade assistant.'
            : 'Sends this error and editor context to the arcade assistant.';

        actionsEl.replaceChildren(button, note);
    }

    function publishRuntimeError(detail) {
        const message = `${detail?.message || ''}`.trim();
        if (!message) return;

        const key = [message, detail.fileName || '', detail.line || '', detail.runtimeSource || '', detail.runtimeLine || ''].join('|');
        const now = Date.now();
        if (key === lastCapturedRuntimeErrorKey && now - lastCapturedRuntimeErrorAt < 1500) return;
        lastCapturedRuntimeErrorKey = key;
        lastCapturedRuntimeErrorAt = now;

        const normalized = {
            isError: true,
            kind: 'runtime',
            message,
            fileName: detail.fileName || getEditorState().activeFileName || 'index.html',
            line: Number.parseInt(detail.line, 10) || 0,
            runtimeSource: detail.runtimeSource || '',
            runtimeLine: Number.parseInt(detail.runtimeLine, 10) || 0,
            runtimeColumn: Number.parseInt(detail.runtimeColumn, 10) || 0,
            undefinedIdentifier: detail.undefinedIdentifier || parseUndefinedIdentifier(message)
        };

        window.workshopEditorLastError = normalized;
        renderActions(normalized);
        window.dispatchEvent(new CustomEvent('workshop-editor-status-change', { detail: normalized }));
    }

    function captureErrorEvent(event, sourceLabel = '') {
        const message = event?.message || event?.error?.message || `${event?.error || ''}`;
        if (!message || /ResizeObserver loop/i.test(message)) return;

        publishRuntimeError({
            message,
            runtimeSource: sourceLabel || event?.filename || '',
            runtimeLine: event?.lineno || 0,
            runtimeColumn: event?.colno || 0,
            undefinedIdentifier: parseUndefinedIdentifier(message)
        });
    }

    function captureRejectionEvent(event, sourceLabel = '') {
        const reason = event?.reason;
        const message = reason?.message || `${reason || ''}`;
        if (!message) return;

        publishRuntimeError({
            message,
            runtimeSource: sourceLabel,
            undefinedIdentifier: parseUndefinedIdentifier(message)
        });
    }

    function attachPreviewFrameErrorListeners(frame) {
        if (!frame || observedPreviewFrames.has(frame)) return;
        observedPreviewFrames.add(frame);

        const attach = () => {
            try {
                const previewWindow = frame.contentWindow;
                if (!previewWindow || previewWindow.__workshopRuntimeErrorCaptureInstalled) return;
                previewWindow.__workshopRuntimeErrorCaptureInstalled = true;
                previewWindow.addEventListener('error', (event) => captureErrorEvent(event, frame.src || 'preview iframe'), true);
                previewWindow.addEventListener('unhandledrejection', (event) => captureRejectionEvent(event, frame.src || 'preview iframe'), true);
            } catch (_error) {
                // Cross-origin iframes cannot be inspected. Blob previews are same-origin and should work.
            }
        };

        frame.addEventListener('load', attach);
        window.setTimeout(attach, 0);
    }

    function installPreviewRuntimeErrorCapture() {
        window.addEventListener('error', (event) => captureErrorEvent(event), true);
        window.addEventListener('unhandledrejection', (event) => captureRejectionEvent(event), true);

        document.querySelectorAll('iframe').forEach(attachPreviewFrameErrorListeners);

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (node?.tagName === 'IFRAME') {
                        attachPreviewFrameErrorListeners(node);
                    } else if (node?.querySelectorAll) {
                        node.querySelectorAll('iframe').forEach(attachPreviewFrameErrorListeners);
                    }
                }
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    window.syncWorkshopAiFixAction = renderActions;
    window.requestWorkshopAiErrorFix = runAiFix;
    window.captureWorkshopPreviewRuntimeError = publishRuntimeError;

    window.addEventListener('workshop-editor-status-change', (event) => {
        renderActions(event.detail || null);
    });

    document.addEventListener('DOMContentLoaded', () => {
        renderActions(window.workshopEditorLastError || null);
        installPreviewRuntimeErrorCapture();
    });

    if (document.readyState !== 'loading') {
        renderActions(window.workshopEditorLastError || null);
        installPreviewRuntimeErrorCapture();
    }
})();
