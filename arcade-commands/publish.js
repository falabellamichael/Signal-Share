(function() {
    window.ArcadeCommandManager.register({
        id: 'publish',
        description: 'Full project upload/publish to Workshop Arcade.',
        execute: async (args, inputElement) => {
            // Smart context: try to resolve a target game from the args
            let targetGame = null;
            if (typeof window.resolveWorkshopEditGameFromPrompt === 'function') {
                targetGame = window.resolveWorkshopEditGameFromPrompt(args);
            }

            // Store the resolved target globally so handleResponse can use it as a fallback
            window.activeArcadePublishTarget = targetGame;
            
            // Set the command mode so subsequent AI responses know this is a publish intent
            window.activeArcadeCommandMode = '/publish'; 
            
            if (targetGame && typeof window.showFeedback === 'function') {
                window.showFeedback(`Preparing update for "${targetGame.title}"...`);
            }

            return false; // Let normal flow continue to AI for response generation
        },
        getSuggestions: (args = '') => {
            if (typeof window.getWorkshopManageableGames !== 'function') return [];
            const games = window.getWorkshopManageableGames();
            if (!Array.isArray(games) || games.length === 0) return [];

            const prompt = `${args || ''}`.trim().toLowerCase();
            
            // If no args, suggest all games
            if (!prompt) {
                return games.map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Update or publish "${g.title}"`
                }));
            }

            // Search games
            return games
                .filter(g => g.title.toLowerCase().includes(prompt))
                .map(g => ({
                    id: g.title,
                    name: g.title,
                    description: `Update or publish "${g.title}"`
                }));
        },
        /**
         * The response handler handles the [PUBLISH] tag in the AI reply.
         * This moves the pipeline logic out of the main chat loop, ensuring clean separation and robust error handling.
         */
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                publishTagDetected: false,
                workshopPublishAttempted: false,
                workshopPublishSucceeded: false,
                errorReason: null
            };

            // 1. Extract the structured payload from the AI's response text
            const publishPayload = window.ArcadeWorkshopManager.extractBalancedJsonTagPayload(text, 'PUBLISH');
            
            // AUTO-EXTRACTION HARDLINING:
            // If no [PUBLISH] tag is found, but the user's prompt was a publish command,
            // we should still try to extract files from the response text and proceed.
            const isExplicitPublish = window.ArcadeWorkshopManager.isExplicitWorkshopPublishIntentPrompt(options.userPrompt || '');
            
            if (publishPayload?.jsonText) {
                actionResult.publishTagDetected = true;
            } else if (!isExplicitPublish) {
                return actionResult; // No tag and no explicit publish intent, nothing to do.
            }

            // 2. Check for conflicts (e.g., publishing while actively editing)
            const editorState = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const isEditingActive = window.ArcadeWorkshopManager.isWorkshopEditIntentPrompt(options.userPrompt || '', { workshopEditor: editorState });
            const isExplicitPublishIntent = window.ArcadeWorkshopManager.isExplicitWorkshopPublishIntentPrompt(options.userPrompt || '');

            // Skip publishing if we are in an active edit mode AND the user didn't explicitly command a publish action.
            if (isEditingActive && !isExplicitPublishIntent) {
                console.warn('[Arcade: Publish] Ignoring [PUBLISH] during active editor edit request.');
                actionResult.errorReason = 'Cannot publish while actively editing a file.';
                return actionResult;
            }

            let data = null;
            const jsonToParse = publishPayload?.jsonText || '';
            
            try {
                // Attempt to parse the JSON payload first using robust parser
                if (jsonToParse) {
                    data = window.ArcadeWorkshopManager.robustParseJson(jsonToParse);
                }
            } catch (e) {
                console.error('[Arcade: Publish] Critical error during JSON parsing:', e);
                actionResult.errorReason = 'Failed to process AI response due to malformed data.';
                return actionResult;
            }

            // 3. Fallback/Validation Check if robust parse failed
            if (!data) {
                console.warn('[Arcade: Publish] Robust parse failed, attempting greedy field recovery.');
                data = {
                    title: jsonToParse.match(/"title"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || '',
                    category: jsonToParse.match(/"category"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || 'GAME',
                    description: jsonToParse.match(/"description"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || '',
                    mode: jsonToParse.match(/"mode"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || ''
                };
            }

            const routeToWorkshop = window.ArcadeWorkshopManager.shouldRouteToWorkshop(data, text, options.userPrompt || '');
            if (routeToWorkshop) {
                actionResult.handled = true;
                actionResult.workshopPublishAttempted = true;

                // Check if the necessary API function exists before proceeding
                if (typeof window.publishCustomGameFromAi !== 'function') {
                    const feedbackMsg = "Workshop publishing is unavailable in this environment.";
                    console.warn(`[Arcade: Publish] API function missing: ${feedbackMsg}`);
                    if (window.showFeedback) window.showFeedback(feedbackMsg, true);
                    actionResult.errorReason = feedbackMsg;
                    actionResult.handled = true; // Still mark as handled to prevent further fallbacks
                    return actionResult;
                }

                // File Extraction Fallback Logic
                let workshopFiles = window.ArcadeWorkshopManager.buildPublishFiles(data, text);
                
                // EXTRA: Try buildAiWorkshopFilesFromText if buildPublishFiles was too strict
                if (workshopFiles.length === 0 && typeof window.buildAiWorkshopFilesFromText === 'function') {
                    workshopFiles = window.buildAiWorkshopFilesFromText(text);
                }
                
                // If no files were found in the AI response but an editor is active, 
                // and the AI was prompted to publish/save, use the editor's current content as the source.
                if (workshopFiles.length === 0 && editorState?.activeGameId) {
                    console.log('[Arcade: Publish] No files in AI response, falling back to editor state.');
                    if (typeof window.getWorkshopManageableGames === 'function' && typeof window.getWorkshopEditableFiles === 'function') {
                        const games = window.getWorkshopManageableGames();
                        const activeGame = games.find(g => g.id === editorState.activeGameId);
                        if (activeGame) {
                            workshopFiles = window.getWorkshopEditableFiles(activeGame).map(f => ({
                                name: f.name,
                                type: f.type,
                                content: (typeof window.decodeWorkshopFileContent === 'function') ? window.decodeWorkshopFileContent(f) : (f.content || '')
                            }));
                        }
                    }
                }

                if (workshopFiles.length === 0) {
                    const feedbackMsg = "Couldn't find game code to publish. Try telling me to 'write the full code and publish'.";
                    console.warn(`[Arcade: Publish] No files found: ${feedbackMsg}`);
                    if (window.showFeedback) window.showFeedback(feedbackMsg, true);
                    actionResult.errorReason = feedbackMsg;
                    actionResult.handled = true; // Mark as handled because we attempted but failed
                    return actionResult;
                }

                // 4. Resolve Target Game ID (Update vs New)
                const targetGameId = data.gameId || data.id || data.updateId || (window.activeArcadePublishTarget?.id) || '';
                const publishMode = (data.mode || data.action || (targetGameId ? 'update' : '')) || '';

                // 5. Execute API Call
                try {
                    const workshopResult = await window.publishCustomGameFromAi({
                        title: data.title || data.gameTitle || (window.activeArcadePublishTarget?.title) || 'AI Workshop Game',
                        category: data.category || 'GAME',
                        description: data.description || data.caption || '',
                        thumbnail: data.thumbnail || data.poster || '',
                        tags: Array.isArray(data.tags) ? data.tags.join(', ') : (typeof data.tags === 'string' ? data.tags : ''),
                        files: workshopFiles,
                        mode: publishMode,
                        gameId: targetGameId,
                        updateTitle: data.updateTitle || data.targetTitle || ''
                    });

                    if (workshopResult?.ok) {
                        actionResult.workshopPublishSucceeded = true;
                        const actionLabel = workshopResult.updated ? 'Updated' : 'Published';
                        if (window.showFeedback) {
                            window.showFeedback(`${actionLabel} "${workshopResult.title}" in Workshop (${workshopResult.assetCount} assets).`);
                        }
                    } else {
                        const apiError = workshopResult?.message || 'Failed to publish game to Workshop due to a server issue.';
                        console.error('[Arcade: Publish] Publishing API call failed:', workshopResult);
                        actionResult.errorReason = apiError;
                        if (window.showFeedback) window.showFeedback(apiError, true);
                    }
                } catch (e) {
                    console.error('[Arcade: Publish] Critical system failure during publish attempt:', e);
                    actionResult.errorReason = `Critical upload error: ${e.message || 'Check console for details.'}`;
                    if (window.showFeedback) window.showFeedback(actionResult.errorReason, true);
                }

            } else if (!isExplicitPublish && typeof window.publishPostToSupabase === 'function') {
                // Route to Standard Social Post (Supabase)
                // ONLY if this wasn't an explicit workshop command
                actionResult.handled = true;
                    try {
                        const postPayload = {
                            title: data.title || 'Shared Game',
                            content: data.description || text.substring(0, 500),
                            type: 'game_link',
                            metadata: {
                                aiGenerated: true,
                                ...data
                            }
                        };
                        const postResult = await window.publishPostToSupabase(postPayload);
                        if (postResult?.ok) {
                            if (window.showFeedback) window.showFeedback("Posted to Signal Share!");
                        }
                    } catch (err) {
                        console.error('[Arcade: Publish] Social post failed:', err);
                    }
                } else {
                     const feedbackMsg = "Standard posting functionality is unavailable.";
                     console.warn(`[Arcade: Publish] API function missing: ${feedbackMsg}`);
                     if (window.showFeedback) window.showFeedback(feedbackMsg, true);
                     actionResult.errorReason = feedbackMsg;
            }

            // Cleanup
            window.activeArcadePublishTarget = null;
            return actionResult;
        }
    });
})();

