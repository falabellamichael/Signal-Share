/**
 * /find Command
 * Searches the workshop editor for a specific string and navigates to it.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'find',
        description: 'Search for text in the editor. Usage: /find <text>',
        execute: async (args, inputElement) => {
            const query = args.join(' ').trim();
            if (!query) {
                if (typeof window.addChatMessage === 'function') {
                    window.addChatMessage('ai', '⚠️ Please provide a search term. Example: /find updateScore');
                }
                return true;
            }

            if (typeof window.findInWorkshopEditor !== 'function') {
                if (typeof window.addChatMessage === 'function') {
                    window.addChatMessage('ai', '❌ Search engine is not initialized or you are not in the Workshop.');
                }
                return true;
            }

            const result = window.findInWorkshopEditor(query);
            
            if (typeof window.addChatMessage === 'function') {
                if (result.ok) {
                    window.addChatMessage('ai', `🔍 **Found it!** "${result.match}" is on line **${result.line}**. I've scrolled the editor there for you.`);
                    inputElement.value = '';
                } else {
                    window.addChatMessage('ai', `🚫 **No matches found** for "${query}". Check your spelling or try a different term.`);
                }
            }
            
            return true; // Command was handled locally
        },
        getSuggestions: (args = "") => {
            const prompt = `${args || ""}`.trim().toLowerCase();
            if (!prompt) return [];

            const editorState = typeof window.getWorkshopEditorState === "function"
                ? window.getWorkshopEditorState()
                : null;

            const content = editorState?.activeFileContent || "";
            if (!content) return [];

            // Extract unique words longer than 3 chars
            const words = content.match(/\b[a-zA-Z_]\w{3,}\b/g) || [];
            const uniqueWords = [...new Set(words)];

            return uniqueWords
                .filter(word => word.toLowerCase().includes(prompt))
                .slice(0, 5)
                .map(word => ({
                    id: word,
                    name: word,
                    description: `Search for "${word}"`
                }));
        }
    });
})();
