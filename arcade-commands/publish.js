/**
 * /publish Command
 * Triggers the project publishing protocol for Workshop Arcade submissions.
 * This script handles AI response parsing, conflict resolution, and API interaction.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'publish',
        description: 'Full project upload/publish to Workshop Arcade.',
        execute: async (args, inputElement) => {
            // Set the command mode so subsequent AI responses know this is a publish intent
            window.activeArcadeCommandMode = '/publish'; 
            return false; // Let normal flow continue to AI for response generation
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
                errorReason: null // Added for centralized error reporting
            };

            // 1. Extract the structured payload from the AI's response text
            const publishPayload = window.ArcadeWorkshopManager.extractBalancedJsonTagPayload(text, 'PUBLISH');
            if (!publishPayload?.jsonText) {
                return actionResult; // No [PUBLISH] tag found
            }

            actionResult.publishTagDetected = true;

            // 2. Check for conflicts (e.g., publishing while actively editing)
            const editorStateForActions = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const isEditingActive = window.ArcadeWorkshopManager.isWorkshopEditIntentPrompt(options.userPrompt || '', { workshopEditor: editorStateForActions });
            const isExplicitPublishIntent = window.ArcadeWorkshopManager.isExplicitWorkshopPublishIntentPrompt(options.userPrompt || '');

            // Skip publishing if we are in an active edit mode AND the user didn't explicitly command a publish action.
            if (isEditingActive && !isExplicitPublishIntent) {
                console.warn('[Arcade: Publish] Ignoring [PUBLISH] during active editor edit request.');
                actionResult.errorReason = 'Cannot publish while actively editing a file.';
                return actionResult;
            }

            let data = null;
            try {
                 // Attempt to parse the JSON payload first using robust parser
                data = window.ArcadeWorkshopManager.robustParseJson(publishPayload.jsonText);
            } catch (e) {
                console.error('[Arcade: Publish] Critical error during JSON parsing:', e);
                actionResult.errorReason = 'Failed to process AI response due to malformed data.';
                return actionResult;
            }

            // 3. Fallback/Validation Check if robust parse failed
            if (!data) {
                console.warn('[Arcade: Publish] Robust parse failed, attempting greedy field recovery.');
                // Greedy field recovery (original logic preserved for resilience)
                data = {
                    title: publishPayload.jsonText.match(/"title"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || '',
                    category: publishPayload.jsonText.match(/"category"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || 'GAME',
                    description: publishPayload.jsonText.match(/"description"\s*:\s*"([\s\S]*?)(?<!\\)"/i)?.[1] || ''
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
                    return actionResult;
                }

                const workshopFiles = window.ArcadeWorkshopManager.buildPublishFiles(data, text);
                if (workshopFiles.length === 0) {
                    const feedbackMsg = "Couldn't find game code to publish from the AI response.";
                    console.warn(`[Arcade: Publish] No files found: ${feedbackMsg}`);
                    if (window.showFeedback) window.showFeedback(feedbackMsg, true);
                    actionResult.errorReason = feedbackMsg;
                    return actionResult;
                }

                // 4. Execute API Call with Try/Catch for network/runtime errors
                try {
                    const workshopResult = await window.publishCustomGameFromAi({
                        title: data.title || data.gameTitle || 'AI Workshop Game',
                        category: data.category || 'GAME',
                        description: data.description || data.caption || '',
                        thumbnail: data.thumbnail || data.poster || '',
                        tags: Array.isArray(data.tags) ? data.tags.join(', ') : (typeof data.tags === 'string' ? data.tags : ''),
                        files: workshopFiles,
                        mode: data.mode || data.action || data.operation || '',
                        gameId: data.gameId || data.id || data.updateId || data.existingGameId || '',
                        updateTitle: data.updateTitle || data.targetTitle || ''
                    });

                    if (workshopResult?.ok) {
                        // Success path
                        actionResult.workshopPublishSucceeded = true;
                        const actionLabel = workshopResult.updated ? 'Updated' : 'Published';
                        if (window.showFeedback) {
                            window.showFeedback(`${actionLabel} "${workshopResult.title}" in Workshop (${workshopResult.assetCount} assets).`);
                        }
                    } else {
                        // API returned an error object
                        const apiError = workshopResult?.message || 'Failed to publish game to Workshop due to an unknown server issue.';
                        console.error('[Arcade: Publish] Publishing API call failed:', workshopResult);
                        actionResult.errorReason = apiError;
                        if (window.showFeedback) window.showFeedback(apiError, true);
                    }
                } catch (e) {
                    // Network or runtime exception during the await call
                    console.error('[Arcade: Publish] Critical system failure during publish attempt:', e);
                    actionResult.errorReason = `Critical upload error: ${e.message || 'Check console for details.'}`;
                    if (window.showFeedback) window.showFeedback(actionResult.errorReason, true);
                }

            } else {
                // Route to Standard Post (Supabase)
                if (typeof window.publishPostToSupabase === 'function') {
                    actionResult.handled = true;
                    console.log('[Arcade: Publish] Routing to standard social post.');
                } else {
                     const feedbackMsg = "Standard posting functionality is unavailable.";
                     console.warn(`[Arcade: Publish] API function missing: ${feedbackMsg}`);
                     if (window.showFeedback) window.showFeedback(feedbackMsg, true);
                     actionResult.errorReason = feedbackMsg;
                }
            }

            return actionResult;
        }
    });
})();
