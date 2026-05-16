/**
 * /fix Command
 * Fast bug-fix wrapper around the editor edit pipeline.
 */
(function() {
    function normalize(value = '') {
        return `${value || ''}`.trim();
    }

    function replyLocally(inputElement, message, isError = false) {
        if (typeof window.addChatMessage === 'function') {
            window.addChatMessage('ai', isError ? `⚠️ ${message}` : message);
        } else if (typeof window.showFeedback === 'function') {
            window.showFeedback(message, isError);
        }
        if (inputElement) inputElement.value = '';
        return true;
    }

    function getEditCommand() {
        return window.ArcadeCommandManager?.getCommand?.('edit') || null;
    }

    function getActiveEditorState() {
        if (typeof window.getWorkshopEditorState !== 'function') return null;
        try {
            return window.getWorkshopEditorState();
        } catch (_error) {
            return null;
        }
    }

    function hasActiveEditor() {
        const state = getActiveEditorState();
        return Boolean(`${state?.activeGameId || ''}`.trim() && `${state?.activeFileName || ''}`.trim());
    }

    function hasRealFixInstruction(args = '') {
        const text = normalize(args).toLowerCase();
        if (!text) return false;
        return /\b(?:fix|repair|debug|broken|bug|error|issue|not working|doesn't work|doesnt work|fails?|crash|syntax|validation|line\s+\d+)\b/.test(text);
    }

    window.ArcadeCommandManager.register({
        id: 'fix',
        description: 'Fix a bug in the selected Workshop editor file.',

        execute: async (args, inputElement) => {
            const prompt = normalize(args);
            const editCmd = getEditCommand();

            if (!prompt && !hasActiveEditor()) {
                return replyLocally(inputElement, 'Open a Workshop game/file first, or choose one after /fix.');
            }

            // Let /edit handle game/file target resolution, suggestions, and editor opening.
            if (editCmd && typeof editCmd.execute === 'function') {
                const result = await editCmd.execute(prompt, inputElement);
                if (result === true) return true;
            }

            if (!hasRealFixInstruction(prompt)) {
                return replyLocally(
                    inputElement,
                    'Opened the target. Now describe the bug, for example: /fix score does not update after clicking.'
                );
            }

            window.activeArcadeCommandMode = '/fix';
            window.activeArcadeCommandModes = Array.isArray(window.activeArcadeCommandModes)
                ? Array.from(new Set([...window.activeArcadeCommandModes, '/fix', '/edit']))
                : ['/fix', '/edit'];

            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = `/fix ${prompt}`;
            }
            return false;
        },

        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                workshopFileRewriteAttempted: false,
                workshopFileRewriteSucceeded: false,
                editorEditAttempted: false,
                editorEditSucceeded: false,
                errorReason: null
            };

            const editCmd = getEditCommand();
            if (!editCmd || typeof editCmd.handleResponse !== 'function') return actionResult;

            const result = await editCmd.handleResponse(text, {
                ...options,
                userPrompt: options.userPrompt || '/fix'
            });

            if (!result?.handled) return actionResult;
            return {
                ...actionResult,
                ...result,
                handled: true,
                workshopFileRewriteAttempted: !!(result.workshopFileRewriteAttempted || result.editorEditAttempted),
                workshopFileRewriteSucceeded: !!(result.workshopFileRewriteSucceeded || result.editorEditSucceeded)
            };
        },

        getSuggestions: (args = '') => {
            const editCmd = getEditCommand();
            if (editCmd && typeof editCmd.getSuggestions === 'function') {
                return editCmd.getSuggestions(args).map((suggestion) => ({
                    ...suggestion,
                    description: `${suggestion.description || ''}`.replace(/^Edit\b/i, 'Fix') || 'Fix this Workshop target.'
                }));
            }
            return [
                { id: 'bug', name: 'bug', description: 'Fix a bug in the active editor file.' },
                { id: 'syntax', name: 'syntax', description: 'Fix a syntax/runtime error.' },
                { id: 'layout', name: 'layout', description: 'Fix a layout issue.' }
            ];
        }
    });
})();