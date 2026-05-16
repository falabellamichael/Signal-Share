/**
 * /edit Command
 * Opens the editor to the game, reads contents, and lets AI decide the fix.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: "edit",
        description: "Edit the active file in the Workshop.",

        execute: async (args, inputElement) => {
            window.activeArcadeCommandMode = "/edit";

            // 1. Open the editor to the corresponding game
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function'
                && typeof window.setWorkshopEditActiveGame === 'function') {
                const targetGame = window.resolveWorkshopEditGameFromPrompt(args);
                if (targetGame) {
                    window.setWorkshopEditActiveGame(targetGame.id);
                }
            }

            // 2. Read all the contents
            const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const content = editorState?.content || editorState?.value || "";
            const fileName = editorState?.activeFileName || "index.html";

            // 3. Pass content to AI by injecting it into the input
            if (content && inputElement) {
                inputElement.value = `${args}\n\n[FILE: ${fileName}]\n${content}`;
            }

            return false; // Let the AI generate the response
        },

        handleResponse: async (text, options = {}) => {
            // 4. Save the fix
            // Look for code blocks in the AI response
            const codeBlockRegex = /```(\w+)(?:\s+filename=([^\s]+))?\s*([\s\S]*?)```/g;
            let match;
            let fixApplied = false;

            while ((match = codeBlockRegex.exec(text)) !== null) {
                const lang = match[1];
                const filename = match[2] || "index.html";
                const content = match[3].trim();

                const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
                const gameId = editorState?.activeGameId;
                
                if (gameId && typeof window.setWorkshopEditActiveGame === 'function') {
                    // Switch to the file specified by the AI (or default to index.html)
                    window.setWorkshopEditActiveGame(gameId, filename);
                    
                    // Wait a bit for the editor to load the file (if async)
                    setTimeout(async () => {
                        const editor = document.getElementById('workshop-edit-file-content');
                        if (editor) {
                            editor.value = content;
                            
                            // Call the save function
                            if (typeof window.saveWorkshopEditPanel === 'function') {
                                await window.saveWorkshopEditPanel();
                                if (window.showFeedback) window.showFeedback(`Saved fix to ${filename}`);
                            }
                        }
                    }, 100);
                    
                    fixApplied = true;
                }
            }

            return { handled: fixApplied };
        }
    });
})();
