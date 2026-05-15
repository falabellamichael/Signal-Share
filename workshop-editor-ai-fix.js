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

    function buildAiFixPrompt(errorDetail) {
        const detail = errorDetail || {};
        const state = getEditorState();
        const fileName = detail.fileName || state.activeFileName || 'the open file';
        const lineText = detail.line ? ` line ${detail.line}` : '';
        const activeFileText = state.activeFileName && state.activeFileName !== fileName
            ? ` The editor is currently on ${state.activeFileName}.`
            : '';

        return [
            `/fix ${fileName}${lineText}`,
            `Workshop validation failed: ${detail.message || 'Unknown editor error.'}`,
            'Use the current Workshop editor files, inspect any referenced HTML/CSS/JS files, and make the smallest surgical fix.',
            'If the duplicate or syntax issue is split across index.html and game.js, edit the correct file instead of rewriting the whole game.',
            activeFileText
        ].filter(Boolean).join(' ');
    }

    function runAiFix() {
        if (!lastWorkshopEditorError) return;

        const input = document.getElementById('arc-chat-input');
        if (!input) return;

        input.value = buildAiFixPrompt(lastWorkshopEditorError);
        input.focus();

        if (typeof window.sendChatMessage === 'function') {
            void window.sendChatMessage();
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
