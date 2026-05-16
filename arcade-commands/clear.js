/**
 * /clear Command
 * Locally clears the arcade chat history.
 *
 * This file also installs a small /edit response guard. It loads after
 * arcade-commands/edit.js and before arcade-chat.js, so it can suppress raw
 * SEARCH/REPLACE replies and route them into the edit handler first.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'clear',
        description: 'Clear chat history.',
        execute: async (args, inputElement) => {
            if (typeof window.arcadeChatHistory !== 'undefined') {
                window.arcadeChatHistory = [];
                if (typeof window.saveCurrentChat === 'function') window.saveCurrentChat();
                if (typeof window.renderArcadeChatMessages === 'function') window.renderArcadeChatMessages();
                inputElement.value = '';
                return true; // Locally handled
            }
            return false;
        }
    });

    if (window.__arcadeEditRawPatchPreRendererInstalled) return;
    window.__arcadeEditRawPatchPreRendererInstalled = true;

    let lastUserPrompt = '';

    function isPatchText(value = '') {
        const text = `${value || ''}`;
        return /SEARCH\s*:/i.test(text) && /REPLACE\s*:/i.test(text);
    }

    function isEditPrompt(value = '') {
        const text = `${value || ''}`.trim().toLowerCase();
        return /^\/(?:edit|fix|rewrite)\b/.test(text)
            || /^\[(?:edit|fix|rewrite)\]/.test(text)
            || /workshop validation|workshop editor/.test(text);
    }

    function patchAddChatMessage() {
        if (typeof window.addChatMessage !== 'function') {
            window.setTimeout(patchAddChatMessage, 50);
            return;
        }
        if (window.addChatMessage.__arcadeEditRawPatchPreRenderer) return;

        const originalAddChatMessage = window.addChatMessage;

        window.addChatMessage = function patchedAddChatMessage(sender, content, ...rest) {
            const role = `${sender || ''}`.toLowerCase();
            const text = `${content || ''}`;

            if (role === 'user') {
                lastUserPrompt = text;
                return originalAddChatMessage.apply(this, arguments);
            }

            const editModeActive = isEditPrompt(lastUserPrompt)
                || window.activeArcadeCommandMode === '/edit'
                || (Array.isArray(window.activeArcadeCommandModes) && window.activeArcadeCommandModes.includes('/edit'));

            if ((role === 'ai' || role === 'assistant') && editModeActive && isPatchText(text)) {
                const editCommand = window.ArcadeCommandManager?.getCommand?.('edit');
                if (editCommand && typeof editCommand.handleResponse === 'function') {
                    window.setTimeout(async () => {
                        let result = null;
                        try {
                            result = await editCommand.handleResponse(text, { userPrompt: lastUserPrompt });
                        } catch (error) {
                            console.error('[Arcade Edit] Failed to apply raw SEARCH/REPLACE reply:', error);
                        }

                        const attempted = !!result?.workshopFileRewriteAttempted;
                        const saved = !!result?.workshopFileRewriteSucceeded;
                        const message = saved
                            ? '[Workshop Edit]: Applied and saved the AI edit to the active file.'
                            : attempted
                                ? '[Workshop Edit]: The AI edit was detected, but the SEARCH text did not match the active file.'
                                : '[Workshop Edit]: The AI returned an edit block, but I could not apply it to the active file.';

                        originalAddChatMessage.call(window, 'ai', message);
                    }, 0);
                    return null;
                }
            }

            return originalAddChatMessage.apply(this, arguments);
        };

        window.addChatMessage.__arcadeEditRawPatchPreRenderer = true;
    }

    patchAddChatMessage();
})();