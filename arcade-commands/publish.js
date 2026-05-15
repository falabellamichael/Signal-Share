/**
 * /publish Command
 * Triggers the project publishing protocol.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'publish',
        description: 'Full project upload/publish.',
        execute: async (args, inputElement) => {
            window.activeArcadeCommandMode = '/publish';
            return false; // Let normal flow continue to AI
        },
        /**
         * The response handler handles the [PUBLISH] tag in the AI reply.
         * This moves the pipeline logic out of the main chat loop.
         */
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                publishTagDetected: false,
                workshopPublishAttempted: false,
                workshopPublishSucceeded: false
            };

            const publishPayload = window.ArcadeWorkshopManager.extractBalancedJsonTagPayload(text, 'PUBLISH');
            if (!publishPayload?.jsonText) return actionResult;

            actionResult.publishTagDetected = true;

            const editorStateForActions = typeof window.getWorkshopEditorState === 'function' ? window.getWorkshopEditorState() : null;
            const shouldSkipPublishForEditorEdit = window.ArcadeWorkshopManager.isWorkshopEditIntentPrompt(options.userPrompt || '', { workshopEditor: editorStateForActions })
                && !window.ArcadeWorkshopManager.isExplicitWorkshopPublishIntentPrompt(options.userPrompt || '');

            if (shouldSkipPublishForEditorEdit) {
                console.warn('[Arcade: Publish] Ignoring [PUBLISH] during active editor edit request.');
                return actionResult;
            }

            let data = window.ArcadeWorkshopManager.robustParseJson(publishPayload.jsonText);
            if (!data) {
                // Greedy field recovery
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

                if (typeof window.publishCustomGameFromAi !== 'function') {
                    if (window.showFeedback) window.showFeedback("Workshop publishing is available from the Arcade Library page.", true);
                    return actionResult;
                }

                const workshopFiles = window.ArcadeWorkshopManager.buildPublishFiles(data, text);
                if (workshopFiles.length === 0) {
                    if (window.showFeedback) window.showFeedback("Couldn't find game code to publish.", true);
                    return actionResult;
                }

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
                    actionResult.workshopPublishSucceeded = true;
                    if (window.showFeedback) {
                        const actionLabel = workshopResult.updated ? 'Updated' : 'Published';
                        window.showFeedback(`${actionLabel} "${workshopResult.title}" in Workshop (${workshopResult.assetCount} assets).`);
                    }
                } else if (window.showFeedback) {
                    window.showFeedback(workshopResult?.message || 'Failed to publish game to Workshop.', true);
                }
            } else {
                // Route to Standard Post (Supabase)
                if (typeof window.publishPostToSupabase === 'function') {
                    actionResult.handled = true;
                    // Note: Supabase logic remains simplified here, 
                    // focusing on the Workshop pipeline as the primary objective.
                    console.log('[Arcade: Publish] Routing to standard social post.');
                }
            }

            return actionResult;
        }
    });
})();
