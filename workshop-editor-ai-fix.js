/**
 * Workshop editor error actions.
 * Owns the "Fix with A.I." control so the core editor can stay focused on editing.
 */
(function () {
    const ACTIONS_ID = 'workshop-edit-error-actions';
    let lastWorkshopEditorError = null;

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
        const snippets = buildErrorContextSnippets(detail, state);

        return [
            `Fix this Workshop validation error in ${fileName}${lineText}.`,
            `Error: ${detail.message || 'Unknown editor error.'}`,
            'Do not ask me to paste code. The Workshop editor and related file snippets are available in this request.',
            'Use the current Workshop editor files, inspect any referenced HTML/CSS/JS files, and make the smallest surgical fix.',
            'If the duplicate or syntax issue is split across index.html and game.js, edit the correct file instead of rewriting the whole game.',
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
        note.textContent = 'Sends this error and editor context to the arcade assistant.';

        actionsEl.replaceChildren(button, note);
    }

    window.syncWorkshopAiFixAction = renderActions;
    window.requestWorkshopAiErrorFix = runAiFix;

    window.addEventListener('workshop-editor-status-change', (event) => {
        renderActions(event.detail || null);
    });

    document.addEventListener('DOMContentLoaded', () => {
        renderActions(window.workshopEditorLastError || null);
    });
})();
