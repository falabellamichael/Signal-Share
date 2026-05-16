/**
 * /rewrite Command
 * Requests a complete replacement for the active Workshop editor file.
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

    function getEditorState() {
        if (typeof window.getWorkshopEditorState !== 'function') return null;
        try {
            return window.getWorkshopEditorState();
        } catch (_error) {
            return null;
        }
    }

    function hasActiveEditor() {
        const state = getEditorState();
        return Boolean(`${state?.activeGameId || ''}`.trim() && `${state?.activeFileName || ''}`.trim());
    }

    function hasRewriteInstruction(args = '') {
        const text = normalize(args).toLowerCase();
        if (!text) return false;
        return /\b(?:rewrite|rebuild|redesign|replace|full|from scratch|complete|entire|split|refactor|make it|turn it into|convert)\b/.test(text);
    }

    window.ArcadeCommandManager.register({
        id: 'rewrite',
        description: 'Rewrite the selected Workshop editor file.',

        execute: async (args, inputElement) => {
            const prompt = normalize(args);
            const editCmd = getEditCommand();

            if (!prompt && !hasActiveEditor()) {
                return replyLocally(inputElement, 'Open a Workshop game/file first, or choose one after /rewrite.');
            }

            if (editCmd && typeof editCmd.execute === 'function') {
                const result = await editCmd.execute(prompt, inputElement);
                if (result === true) return true;
            }

            if (!hasRewriteInstruction(prompt)) {
                return replyLocally(
                    inputElement,
                    'Opened the target. Now describe the rewrite, for example: /rewrite make the whole game cleaner and mobile friendly.'
                );
            }

            window.activeArcadeCommandMode = '/rewrite';
            window.activeArcadeCommandModes = Array.isArray(window.activeArcadeCommandModes)
                ? Array.from(new Set([...window.activeArcadeCommandModes, '/rewrite', '/edit']))
                : ['/rewrite', '/edit'];

            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = `/rewrite ${prompt}`;
            }
            return false;
        },

        getSuggestions: (args = '') => {
            const editCmd = getEditCommand();
            if (editCmd && typeof editCmd.getSuggestions === 'function') {
                return editCmd.getSuggestions(args).map((suggestion) => ({
                    ...suggestion,
                    description: `${suggestion.description || ''}`.replace(/^Edit\b/i, 'Rewrite') || 'Rewrite this Workshop target.'
                }));
            }
            return [
                { id: 'current editor', name: 'current editor', description: 'Rewrite the active editor file.' },
                { id: 'split files', name: 'split files', description: 'Rewrite into separated HTML/CSS/JS files.' },
                { id: 'polish', name: 'polish', description: 'Rewrite with better structure and polish.' }
            ];
        },

        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                workshopFileRewriteAttempted: false,
                workshopFileRewriteSucceeded: false,
                errorReason: null
            };

            const userPrompt = options.userPrompt || '/rewrite';
            const isRewritePrompt = /^\s*\/rewrite\b/i.test(userPrompt)
                || /\b(?:rewrite|rebuild|redesign|full\s+rewrite|from scratch)\b/i.test(userPrompt)
                || /\[REWRITE\]/i.test(text);
            if (!isRewritePrompt) return actionResult;

            if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
                const result = await window.tryAutoWorkshopFileRewriteFromReply(text, userPrompt);
                if (result?.attempted) {
                    actionResult.handled = true;
                    actionResult.workshopFileRewriteAttempted = true;
                    actionResult.workshopFileRewriteSucceeded = !!result.ok;
                    actionResult.errorReason = result.ok ? null : (result.reason || result.message || 'Rewrite failed');
                    if (window.showFeedback) {
                        window.showFeedback(
                            result.ok ? (result.message || 'Rewrote the active file.') : actionResult.errorReason,
                            !result.ok
                        );
                    }
                    return actionResult;
                }
            }

            const editCmd = getEditCommand();
            if (editCmd && typeof editCmd.handleResponse === 'function') {
                const editResult = await editCmd.handleResponse(text, { ...options, userPrompt });
                if (editResult?.handled) {
                    return {
                        ...actionResult,
                        ...editResult,
                        handled: true,
                        workshopFileRewriteAttempted: !!(editResult.workshopFileRewriteAttempted || editResult.editorEditAttempted),
                        workshopFileRewriteSucceeded: !!(editResult.workshopFileRewriteSucceeded || editResult.editorEditSucceeded)
                    };
                }
            }

            return actionResult;
        }
    });
})();