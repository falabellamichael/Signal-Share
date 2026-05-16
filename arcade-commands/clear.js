/**
 * /clear Command
 * Clears local chat state and installs the edit-patch pre-render guard.
 */
(function() {
    function clearMessagesDom() {
        const container = document.getElementById('chat-messages');
        if (!container) return false;
        container.innerHTML = '<div class="chat-message message-ai">Chat cleared. What do you want to do next?</div>';
        return true;
    }

    function clearSavedChats(scope = 'chat') {
        if (scope === 'history' || scope === 'all') {
            localStorage.removeItem('arcade-chats');
            localStorage.removeItem('arcade-last-chat-id');
        }
    }

    window.ArcadeCommandManager.register({
        id: 'clear',
        description: 'Clear the current chat or saved chat history.',

        execute: async (args, inputElement) => {
            const scope = `${args || 'chat'}`.trim().toLowerCase();
            if (scope === 'history' || scope === 'all') clearSavedChats(scope);

            if (Array.isArray(window.arcadeChatHistory)) {
                window.arcadeChatHistory.length = 0;
            } else {
                window.arcadeChatHistory = [];
            }

            clearMessagesDom();
            if (typeof window.saveCurrentChat === 'function' && scope !== 'history' && scope !== 'all') {
                window.saveCurrentChat();
            }
            if (inputElement) inputElement.value = '';
            return true;
        },

        getSuggestions: (args = '') => {
            const prompt = `${args || ''}`.trim().toLowerCase();
            return [
                { id: 'chat', name: 'chat', description: 'Clear the visible current chat.' },
                { id: 'history', name: 'history', description: 'Clear saved chat history.' },
                { id: 'all', name: 'all', description: 'Clear visible chat and saved history.' }
            ].filter(item => !prompt || `${item.id} ${item.description}`.toLowerCase().includes(prompt));
        }
    });

    if (window.__arcadeEditRawPatchPreRendererInstalled) return;
    window.__arcadeEditRawPatchPreRendererInstalled = true;

    let pendingEditPrompt = '';
    let pendingEditStartedAt = 0;

    function isPatchText(value = '') {
        const text = `${value || ''}`;
        return /SEARCH\s*:/i.test(text) && /REPLACE\s*:/i.test(text);
    }

    function isEditPrompt(value = '') {
        const text = `${value || ''}`.trim().toLowerCase();
        return /^\/(?:edit|fix|rewrite)\b/.test(text)
            || /^\[(?:edit|fix|rewrite)\]/.test(text)
            || /^fix this workshop validation/i.test(text);
    }

    function rememberPromptFromOutgoingMessage(value = '') {
        const text = `${value || ''}`.trim();
        if (!text) return;

        if (isEditPrompt(text)) {
            pendingEditPrompt = text;
            pendingEditStartedAt = Date.now();
            return;
        }

        pendingEditPrompt = '';
        pendingEditStartedAt = 0;
    }

    function hasFreshPendingEditPrompt() {
        return Boolean(pendingEditPrompt)
            && isEditPrompt(pendingEditPrompt)
            && Date.now() - pendingEditStartedAt < 120000;
    }

    function patchSendChatMessage() {
        if (typeof window.sendChatMessage !== 'function') {
            window.setTimeout(patchSendChatMessage, 50);
            return;
        }
        if (window.sendChatMessage.__arcadeEditPromptTracker) return;

        const originalSendChatMessage = window.sendChatMessage;
        window.sendChatMessage = function patchedSendChatMessage(message, ...rest) {
            const input = document.getElementById('arc-chat-input');
            const prompt = typeof message === 'string' && message.trim()
                ? message
                : `${input?.value || ''}`;
            rememberPromptFromOutgoingMessage(prompt);
            return originalSendChatMessage.apply(this, arguments);
        };
        window.sendChatMessage.__arcadeEditPromptTracker = true;
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

            if (role !== 'ai' && role !== 'assistant' && role !== 'system' && role !== 'bot') {
                rememberPromptFromOutgoingMessage(text);
                return originalAddChatMessage.apply(this, arguments);
            }

            if ((role === 'ai' || role === 'assistant') && hasFreshPendingEditPrompt() && isPatchText(text)) {
                const editCommand = window.ArcadeCommandManager?.getCommand?.('edit');
                if (editCommand && typeof editCommand.handleResponse === 'function') {
                    const userPromptForThisEdit = pendingEditPrompt;
                    pendingEditPrompt = '';
                    pendingEditStartedAt = 0;

                    window.setTimeout(async () => {
                        let result = null;
                        try {
                            result = await editCommand.handleResponse(text, { userPrompt: userPromptForThisEdit });
                        } catch (error) {
                            console.error('[Arcade Edit] Failed to apply raw SEARCH/REPLACE reply:', error);
                        }

                        const attempted = !!(result?.workshopFileRewriteAttempted || result?.editorEditAttempted || result?.fileAddAttempted);
                        const saved = !!(result?.workshopFileRewriteSucceeded || result?.editorEditSucceeded || result?.fileAddSucceeded);
                        const message = saved
                            ? '[Workshop Edit]: Applied and saved the AI edit.'
                            : attempted
                                ? '[Workshop Edit]: The AI edit was detected, but it could not be applied to the active target.'
                                : '[Workshop Edit]: The AI returned an edit block, but no active editable target accepted it.';

                        originalAddChatMessage.call(window, 'ai', message);
                    }, 0);
                    return null;
                }
            }

            return originalAddChatMessage.apply(this, arguments);
        };

        window.addChatMessage.__arcadeEditRawPatchPreRenderer = true;
    }

    patchSendChatMessage();
    patchAddChatMessage();
})();