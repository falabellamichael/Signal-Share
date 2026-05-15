/**
 * Arcade Workshop Editor Search Engine
 * Enables AI-powered searching and navigation within the code editor.
 */
(function initWorkshopEditorSearch() {
    /**
     * Finds a string or regex in the active workshop editor and navigates to it.
     * @param {string} query - The term to search for
     * @param {object} options - { isRegex: boolean, caseSensitive: boolean, wrap: boolean }
     * @returns {object} - { ok: boolean, line: number, match: string, total: number }
     */
    window.findInWorkshopEditor = function(query, options = {}) {
        const editor = document.getElementById('workshop-edit-file-content');
        if (!editor) return { ok: false, error: 'Editor not found. Are you in Edit mode?' };
        
        const text = editor.value;
        if (!text) return { ok: false, error: 'Editor is empty.' };

        const { isRegex = false, caseSensitive = false } = options;
        let index = -1;
        let matchLength = 0;
        let flags = 'g';
        if (!caseSensitive) flags += 'i';

        try {
            if (isRegex) {
                const re = new RegExp(query, flags);
                const match = re.exec(text);
                if (match) {
                    index = match.index;
                    matchLength = match[0].length;
                }
            } else {
                const searchStr = caseSensitive ? query : query.toLowerCase();
                const content = caseSensitive ? text : text.toLowerCase();
                index = content.indexOf(searchStr);
                matchLength = query.length;
            }
        } catch (e) {
            return { ok: false, error: 'Invalid search pattern.' };
        }

        if (index === -1) {
            return { ok: false, error: `No matches found for "${query}"` };
        }

        // Execution: Focus and Select
        editor.focus();
        editor.setSelectionRange(index, index + matchLength);

        // Navigation: Calculate Scroll
        const linesBefore = text.substring(0, index).split('\n').length;
        
        // Attempt to get accurate line height from computed styles
        const style = window.getComputedStyle(editor);
        const lineHeight = parseFloat(style.lineHeight) || 18.56;
        const paddingTop = parseFloat(style.paddingTop) || 12;

        // Position the target line roughly in the upper third of the editor view
        const editorHeight = editor.clientHeight;
        const targetScroll = (linesBefore - 1) * lineHeight;
        const offset = Math.max(0, targetScroll - (editorHeight / 3));

        editor.scrollTop = offset;

        // Sync visual line numbers
        if (typeof window.syncWorkshopEditorLineNumbers === 'function') {
            window.syncWorkshopEditorLineNumbers();
        }

        // Highlight the line number margin
        if (typeof window.updateWorkshopEditorLineNumbers === 'function') {
            window.updateWorkshopEditorLineNumbers(linesBefore);
        }

        return {
            ok: true,
            line: linesBefore,
            match: text.substring(index, index + matchLength),
            message: `Found "${query}" on line ${linesBefore}`
        };
    };

    /**
     * Integration hook for the Arcade Chatbot.
     * Allows the chatbot to trigger a search automatically.
     */
    window.handleAiSearchCommand = function(query) {
        if (!query) return null;
        console.log(`[Editor Search] AI requested search for: ${query}`);
        
        const result = window.findInWorkshopEditor(query);
        
        if (result.ok) {
            // Provide a small visual toast or feedback if needed
            showSearchFeedback(result.message);
        }
        
        return result;
    };

    function showSearchFeedback(msg) {
        const status = document.getElementById('workshop-edit-status');
        if (status) {
            status.textContent = `🔍 ${msg}`;
            status.style.color = 'var(--steam-light)';
            setTimeout(() => {
                if (status.textContent === `🔍 ${msg}`) status.textContent = '';
            }, 4000);
        }
    }

    console.log('[Editor Search] System initialized.');
})();
