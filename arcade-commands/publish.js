/**
 * /publish Command
 * Handles Workshop Arcade publish/update actions from the Arcade chat.
 */
(function() {
    function getWorkshopManager() {
        return window.ArcadeWorkshopManager || null;
    }

    function ensureLiveWorkshopPublishedPromptApi() {
        const manager = getWorkshopManager();
        if (!manager || typeof manager !== "object") return;

        if (typeof manager.setLiveWorkshopPublishedPrompt !== "function") {
            manager.setLiveWorkshopPublishedPrompt = function(prompt = "") {
                const normalizedPrompt = `${prompt || ""}`.trim();
                manager.liveWorkshopPublishedPrompt = normalizedPrompt;
                window.__arcadeLiveWorkshopPublishedPrompt = normalizedPrompt;
                return normalizedPrompt;
            };
        }

        if (typeof manager.getLiveWorkshopPublishedPrompt !== "function") {
            manager.getLiveWorkshopPublishedPrompt = function() {
                return `${manager.liveWorkshopPublishedPrompt || window.__arcadeLiveWorkshopPublishedPrompt || ""}`.trim();
            };
        }

        if (typeof manager.clearLiveWorkshopPublishedPrompt !== "function") {
            manager.clearLiveWorkshopPublishedPrompt = function() {
                manager.liveWorkshopPublishedPrompt = "";
                window.__arcadeLiveWorkshopPublishedPrompt = "";
            };
        }
    }

    function normalizeArgs(args, inputElement) {
        if (Array.isArray(args)) return args.join(" ").trim();
        const directArgs = `${args || ""}`.trim();
        if (directArgs) return directArgs;
        return `${inputElement?.value || ""}`.trim();
    }

    function pushCommandMode(mode) {
        window.activeArcadeCommandMode = mode;
        window.activeArcadeCommandModes = [mode]; // Overwrite instead of pushing to prevent mixing
    }

    function showPublishFeedback(message, isError = false) {
        if (!message) return;

        if (typeof window.showFeedback === "function") {
            window.showFeedback(message, isError);
            return;
        }

        if (typeof window.addChatMessage === "function") {
            window.addChatMessage("ai", isError ? `⚠️ ${message}` : message);
        }
    }

    function resolveFallbackPublishTarget(args = "") {
        if (typeof window.getWorkshopManageableGames !== "function") return null;

        const games = window.getWorkshopManageableGames();
        if (!Array.isArray(games) || games.length === 0) return null;

        const editorState = typeof window.getWorkshopEditorState === "function"
            ? window.getWorkshopEditorState()
            : null;

        const activeGameId = `${editorState?.activeGameId || ""}`.trim();
        const activeGame = activeGameId
            ? games.find((game) => game.id === activeGameId)
            : null;

        if (activeGame) return activeGame;

        const prompt = `${args || ""}`.toLowerCase();

        if (games.length === 1 || /\b(any|whatever|something|one of my|a game|my game)\b/.test(prompt)) {
            return games[0];
        }

        return null;
    }

    function resolvePublishTarget(args = "") {
        let targetGame = null;

        if (typeof window.resolveWorkshopEditGameFromPrompt === "function") {
            targetGame = window.resolveWorkshopEditGameFromPrompt(args);
        }

        if (!targetGame) {
            targetGame = resolveFallbackPublishTarget(args);
        }

        return targetGame;
    }

    function getStringFieldFromJsonText(jsonText = "", key = "", fallback = "") {
        if (!jsonText || !key) return fallback;

        const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`"${safeKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
        const match = jsonText.match(pattern);

        if (!match) return fallback;

        try {
            return JSON.parse(`"${match[1]}"`);
        } catch (_error) {
            return match[1];
        }
    }

    function recoverPublishData(jsonText = "") {
        const manager = getWorkshopManager();

        return {
            title: getStringFieldFromJsonText(jsonText, "title", ""),
            gameTitle: getStringFieldFromJsonText(jsonText, "gameTitle", ""),
            category: getStringFieldFromJsonText(jsonText, "category", "GAME"),
            description: getStringFieldFromJsonText(jsonText, "description", ""),
            caption: getStringFieldFromJsonText(jsonText, "caption", ""),
            mode: getStringFieldFromJsonText(jsonText, "mode", ""),
            action: getStringFieldFromJsonText(jsonText, "action", ""),
            gameId: getStringFieldFromJsonText(jsonText, "gameId", ""),
            id: getStringFieldFromJsonText(jsonText, "id", ""),
            updateId: getStringFieldFromJsonText(jsonText, "updateId", ""),
            existingGameId: getStringFieldFromJsonText(jsonText, "existingGameId", ""),
            targetTitle: getStringFieldFromJsonText(jsonText, "targetTitle", ""),
            updateTitle: getStringFieldFromJsonText(jsonText, "updateTitle", ""),
            files: typeof manager?.extractFilesGreedily === "function"
                ? manager.extractFilesGreedily(jsonText)
                : []
        };
    }

    function isExplicitPublishPrompt(prompt = "") {
        const manager = getWorkshopManager();

        if (typeof manager?.isExplicitWorkshopPublishIntentPrompt === "function") {
            return manager.isExplicitWorkshopPublishIntentPrompt(prompt);
        }

        const text = `${prompt || ""}`.trim();
        if (!text) return false;

        return /^\/publish\b/i.test(text)
            || /^\[publish\]/i.test(text)
            || (
                /\b(?:publish|upload|share|save|release|submit|deploy)\b/i.test(text)
                && /\b(?:game|project|workshop|arcade|app|logic|code|files)\b/i.test(text)
            );
    }

    function getEditorFilesFallback(gameId) {
        if (!gameId) return [];
        if (typeof window.getWorkshopManageableGames !== "function") return [];
        if (typeof window.getWorkshopEditableFiles !== "function") return [];

        const games = window.getWorkshopManageableGames();
        const activeGame = Array.isArray(games)
            ? games.find((game) => game.id === gameId)
            : null;

        if (!activeGame) return [];

        const editableFiles = window.getWorkshopEditableFiles(activeGame);
        if (!Array.isArray(editableFiles)) return [];

        return editableFiles.map((file) => ({
            name: file.name,
            type: file.type,
            content: typeof window.decodeWorkshopFileContent === "function"
                ? window.decodeWorkshopFileContent(file)
                : `${file.content || ""}`
        }));
    }

    function normalizeWorkshopFileName(name = "") {
        return `${name || ""}`.trim().replace(/^\.?\//, "");
    }

    function getWorkshopFileBaseName(name = "") {
        return normalizeWorkshopFileName(name).split("/").pop() || "";
    }

    function getReferencedAssetNamesFromHtml(html = "") {
        const refs = new Set();
        const source = `${html || ""}`;

        const patterns = [
            /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
            /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi
        ];

        for (const pattern of patterns) {
            let match;

            while ((match = pattern.exec(source))) {
                const raw = `${match[1] || ""}`.trim();
                if (!raw) continue;

                if (/^(https?:)?\/\//i.test(raw)) continue;
                if (/^(data:|blob:|mailto:|tel:)/i.test(raw)) continue;

                refs.add(normalizeWorkshopFileName(raw.split("?")[0].split("#")[0]));
            }
        }

        return Array.from(refs).filter(Boolean);
    }

    function inferWorkshopFileTypeFromName(name = "") {
        const lower = `${name || ""}`.toLowerCase();

        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
        if (lower.endsWith(".css")) return "css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "js";
        if (lower.endsWith(".json")) return "json";

        return "asset";
    }

    function mergeMissingReferencedFilesFromEditor(workshopFiles = [], editorState = null) {
        const files = Array.isArray(workshopFiles) ? [...workshopFiles] : [];

        const existingNames = new Set(
            files.map((file) => normalizeWorkshopFileName(file.name).toLowerCase())
        );

        const existingBaseNames = new Set(
            files.map((file) => getWorkshopFileBaseName(file.name).toLowerCase())
        );

        const htmlFiles = files.filter((file) => {
            return normalizeWorkshopFileName(file.name).toLowerCase().endsWith(".html");
        });

        const referencedNames = htmlFiles.flatMap((file) => {
            return getReferencedAssetNamesFromHtml(file.content || "");
        });

        if (referencedNames.length === 0) return files;
        if (!editorState?.activeGameId) return files;
        if (typeof window.getWorkshopManageableGames !== "function") return files;
        if (typeof window.getWorkshopEditableFiles !== "function") return files;

        const games = window.getWorkshopManageableGames();
        const activeGame = Array.isArray(games)
            ? games.find((game) => game.id === editorState.activeGameId)
            : null;

        if (!activeGame) return files;

        const editableFiles = window.getWorkshopEditableFiles(activeGame);
        if (!Array.isArray(editableFiles)) return files;

        for (const refName of referencedNames) {
            const normalizedRef = normalizeWorkshopFileName(refName);
            const refKey = normalizedRef.toLowerCase();
            const refBaseKey = getWorkshopFileBaseName(normalizedRef).toLowerCase();

            if (existingNames.has(refKey) || existingBaseNames.has(refBaseKey)) {
                continue;
            }

            const sourceFile = editableFiles.find((file) => {
                const sourceName = normalizeWorkshopFileName(file.name).toLowerCase();
                const sourceBaseName = getWorkshopFileBaseName(file.name).toLowerCase();

                return sourceName === refKey || sourceBaseName === refBaseKey;
            });

            if (!sourceFile) {
                console.warn(`[Arcade: Publish] Missing referenced file could not be found in editor: ${normalizedRef}`);
                continue;
            }

            const content = typeof window.decodeWorkshopFileContent === "function"
                ? window.decodeWorkshopFileContent(sourceFile)
                : `${sourceFile.content || ""}`;

            files.push({
                name: sourceFile.name || normalizedRef,
                type: sourceFile.type || inferWorkshopFileTypeFromName(sourceFile.name || normalizedRef),
                content
            });

            existingNames.add(refKey);
            existingBaseNames.add(refBaseKey);

            console.log(`[Arcade: Publish] Added missing referenced file from editor: ${normalizedRef}`);
        }

        return files;
    }

    async function publishToWorkshop({ data, text, userPrompt, editorState, actionResult }) {
        const manager = getWorkshopManager();

        actionResult.handled = true;
        actionResult.workshopPublishAttempted = true;

        if (typeof window.publishCustomGameFromAi !== "function") {
            const feedbackMsg = "Workshop publishing is unavailable in this environment.";
            console.warn(`[Arcade: Publish] API function missing: ${feedbackMsg}`);
            showPublishFeedback(feedbackMsg, true);
            actionResult.errorReason = feedbackMsg;
            return actionResult;
        }

        const targetGameId = data.gameId
            || data.id
            || data.updateId
            || data.existingGameId
            || window.activeArcadePublishTarget?.id
            || editorState?.activeGameId
            || "";

        let workshopFiles = typeof manager?.buildPublishFiles === "function"
            ? manager.buildPublishFiles(data, text)
            : [];

        if (workshopFiles.length === 0 && typeof window.buildAiWorkshopFilesFromText === "function") {
            workshopFiles = window.buildAiWorkshopFilesFromText(text);
        }

        if (workshopFiles.length === 0 && targetGameId) {
            console.log(`[Arcade: Publish] No files in AI response, falling back to editor state for game: ${targetGameId}`);
            workshopFiles = getEditorFilesFallback(targetGameId);
        }

        workshopFiles = mergeMissingReferencedFilesFromEditor(workshopFiles, editorState);

        if (workshopFiles.length === 0 && !targetGameId) {
            console.log("[Arcade: Publish] No files found. Attempting to use entire response as index.html.");
            const trimmedText = text.trim();
            const hasHtml = trimmedText.includes("<!DOCTYPE html>") || trimmedText.includes("<html") || trimmedText.includes("<body");
            
            if (hasHtml) {
                workshopFiles = [
                    {
                        name: "index.html",
                        type: "html",
                        content: text
                    }
                ];
                data.mode = "create";
                data.title = data.title || "AI Generated Game";
            }
        }

        if (workshopFiles.length === 0) {
            const feedbackMsg = "Couldn't find game code to publish. Try telling me to write the full code and publish.";
            console.warn(`[Arcade: Publish] No files found: ${feedbackMsg}`);
            showPublishFeedback(feedbackMsg, true);
            actionResult.errorReason = feedbackMsg;
            return actionResult;
        }

        const isNewGameRequest = /\b(new|create|fresh|brand new)\b/i.test(userPrompt);

        const publishMode = data.mode
            || data.action
            || data.operation
            || (isNewGameRequest ? "create" : (targetGameId ? "update" : ""));

        const publishPayload = {
            title: data.title || data.gameTitle || window.activeArcadePublishTarget?.title || "AI Workshop Game",
            category: data.category || "GAME",
            description: data.description || data.caption || "",
            thumbnail: data.thumbnail || data.poster || "",
            tags: Array.isArray(data.tags)
                ? data.tags.join(", ")
                : (typeof data.tags === "string" ? data.tags : "arcade, ai"),
            files: workshopFiles,
            mode: publishMode,
            gameId: targetGameId,
            updateTitle: data.updateTitle || data.targetTitle || window.activeArcadePublishTarget?.title || ""
        };

        console.log("[Arcade: Publish] Sending to publishCustomGameFromAi:", {
            title: publishPayload.title,
            mode: publishPayload.mode,
            gameId: publishPayload.gameId,
            updateTitle: publishPayload.updateTitle,
            fileCount: workshopFiles.length,
            files: workshopFiles.map((file) => ({
                name: file.name,
                type: file.type,
                contentLength: `${file.content || ""}`.length
            }))
        });

        try {
            const workshopResult = await window.publishCustomGameFromAi(publishPayload);

            if (workshopResult?.ok) {
                actionResult.workshopPublishSucceeded = true;

                const actionLabel = workshopResult.updated ? "Updated" : "Published";
                showPublishFeedback(`${actionLabel} "${workshopResult.title}" in Workshop (${workshopResult.assetCount} assets).`);
            } else {
                const apiError = workshopResult?.message || "Failed to publish game to Workshop due to a server issue.";

                console.error("[Arcade: Publish] Publishing API call failed:", workshopResult);

                actionResult.errorReason = apiError;
                showPublishFeedback(apiError, true);
            }
        } catch (error) {
            console.error("[Arcade: Publish] Critical system failure during publish attempt:", error);

            actionResult.errorReason = `Critical upload error: ${error?.message || "Check console for details."}`;
            showPublishFeedback(actionResult.errorReason, true);
        }

        return actionResult;
    }

    ensureLiveWorkshopPublishedPromptApi();

    window.ArcadeCommandManager.register({
        id: "publish",
        description: "Full project upload/publish to Workshop Arcade.",

        execute: async (args, inputElement) => {
            ensureLiveWorkshopPublishedPromptApi();

            const prompt = normalizeArgs(args, inputElement);
            const targetGame = resolvePublishTarget(prompt);

            window.activeArcadePublishTarget = targetGame;

            const manager = getWorkshopManager();

            if (typeof manager?.setLiveWorkshopPublishedPrompt === "function") {
                manager.setLiveWorkshopPublishedPrompt(prompt);
            }

            pushCommandMode("/publish");

            if (targetGame) {
                showPublishFeedback(`Preparing update for "${targetGame.title}"...`);
            }

            return false;
        },

        getSuggestions: (args = "") => {
            if (typeof window.getWorkshopManageableGames !== "function") return [];

            const games = window.getWorkshopManageableGames();
            if (!Array.isArray(games) || games.length === 0) return [];

            const prompt = `${args || ""}`.trim().toLowerCase();

            if (!prompt) {
                return games.map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Update or publish "${game.title}"`
                }));
            }

            return games
                .filter((game) => `${game.title || ""}`.toLowerCase().includes(prompt))
                .map((game) => ({
                    id: game.title,
                    name: game.title,
                    description: `Update or publish "${game.title}"`
                }));
        },

        /**
         * Handles [PUBLISH: {...}] tags in AI replies and explicit /publish requests.
         */
        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                publishTagDetected: false,
                workshopPublishAttempted: false,
                workshopPublishSucceeded: false,
                errorReason: null
            };

            ensureLiveWorkshopPublishedPromptApi();

            const manager = getWorkshopManager();
            const userPrompt = `${options.userPrompt || manager?.getLiveWorkshopPublishedPrompt?.() || ""}`.trim();

            try {
                if (!manager) {
                    actionResult.errorReason = "Workshop manager is unavailable.";
                    return actionResult;
                }

                const publishPayload = typeof manager.extractBalancedJsonTagPayload === "function"
                    ? manager.extractBalancedJsonTagPayload(text, "PUBLISH")
                    : null;

                const explicitPublish = isExplicitPublishPrompt(userPrompt);

                if (publishPayload?.jsonText) {
                    actionResult.publishTagDetected = true;
                } else if (!explicitPublish) {
                    return actionResult;
                }

                // Check for unhelpful replies in /publish mode
                if (window.activeArcadeCommandMode === '/publish') {
                    if (text.toLowerCase().includes('audit:') || text.toLowerCase().includes('logic:')) {
                        return {
                            ...actionResult,
                            requiresRetry: true,
                            retryPrompt: 'CRITICAL: You provided a plan instead of code. Stop planning and IMMEDIATELY write the full game code and output the [PUBLISH] block.'
                        };
                    }
                    if (!publishPayload?.jsonText && text.includes('```')) {
                        return {
                            ...actionResult,
                            requiresRetry: true,
                            retryPrompt: 'CRITICAL: You provided code but forgot to wrap it in the [PUBLISH] protocol. Please output the code inside a [PUBLISH: {...}] block.'
                        };
                    }
                }

                const editorState = typeof window.getWorkshopEditorState === "function"
                    ? window.getWorkshopEditorState()
                    : null;

                const isEditingActive = typeof manager.isWorkshopEditIntentPrompt === "function"
                    ? manager.isWorkshopEditIntentPrompt(userPrompt, { workshopEditor: editorState })
                    : false;

                if (isEditingActive && !explicitPublish) {
                    console.warn("[Arcade: Publish] Ignoring [PUBLISH] during active editor edit request.");
                    actionResult.errorReason = "Cannot publish while actively editing a file.";
                    return actionResult;
                }

                const jsonToParse = publishPayload?.jsonText || "";
                let data = null;

                if (jsonToParse && typeof manager.robustParseJson === "function") {
                    try {
                        data = manager.robustParseJson(jsonToParse);
                    } catch (error) {
                        console.error("[Arcade: Publish] Critical error during JSON parsing:", error);
                    }
                }

                if (!data && jsonToParse) {
                    console.warn("[Arcade: Publish] Robust parse failed, attempting field recovery.");
                    data = recoverPublishData(jsonToParse);
                }

                if (!data || typeof data !== "object") {
                    data = {};
                }

                const routeToWorkshop = explicitPublish
                    || (
                        typeof manager.shouldRouteToWorkshop === "function"
                        && manager.shouldRouteToWorkshop(data, text, userPrompt)
                    );

                if (!routeToWorkshop) {
                    return actionResult;
                }

                return await publishToWorkshop({
                    data,
                    text,
                    userPrompt,
                    editorState,
                    actionResult
                });
            } catch (error) {
                console.error("[Arcade: Publish] Unexpected publish handler error:", error);

                actionResult.errorReason = error?.message || "Unexpected publish handler error.";
                showPublishFeedback(actionResult.errorReason, true);

                return actionResult;
            } finally {
                window.activeArcadePublishTarget = null;

                if (typeof manager?.clearLiveWorkshopPublishedPrompt === "function") {
                    manager.clearLiveWorkshopPublishedPrompt();
                }
            }
        }
    });
})();