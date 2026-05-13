/**
 * Signal Share Companion AI Core
 * Shared capability logic for both companions (main page + mini-games).
 */
(function initSignalShareAiCore(global) {
    const CORE_VERSION = "1.2";
    const DEFAULT_MAX_HISTORY_MESSAGES = 18;
    const DEFAULT_MAX_MESSAGE_CHARS = 900;
    const DEFAULT_MAX_PAGE_TEXT_CHARS = 600;
    const DEFAULT_MAX_STEAM_HINTS = 20;
    const DEFAULT_MAX_VISIBLE_TEXT_SAMPLE = 1200;
    const CUSTOM_INSTRUCTIONS_STORAGE_KEY = "ss_ai_custom_instructions";
    const DEFAULT_MAX_CUSTOM_INSTRUCTIONS_CHARS = 2000;
    const STEAM_GAME_APP_IDS = Object.freeze({
        "grand theft auto v": 271590,
        "gta v": 271590,
        "gta 5": 271590,
        "counter-strike 2": 730,
        "cs2": 730,
        "dota 2": 570,
        "elden ring": 1245620,
        "cyberpunk 2077": 1091500,
        "red dead redemption 2": 1174180,
        "baldur's gate 3": 1086940,
        "baldurs gate 3": 1086940,
        "rust": 252490,
        "terraria": 105600,
        "the witcher 3": 292030,
        "witcher 3": 292030,
        "hades": 1145360,
        "stardew valley": 413150,
        "helldivers 2": 553850
    });
    const ACTION_TAGS = Object.freeze({
        ARCADE: "[ARCADE:<action>]",
        OPEN: "[OPEN:<target>]",
        DUCKDUCKGO: "[DUCKDUCKGO:<query>]",
        COMPOSE: "[COMPOSE:<text>]",
        PUBLISH: "[PUBLISH:{json}]",
        FILE_REWRITE: "[FILE_REWRITE]...[/FILE_REWRITE]",
        PATCH_SUGGESTION: "[PATCH_SUGGESTION]...[/PATCH_SUGGESTION]",
        SCREENSHOT: "[SCREENSHOT]",
        LIST_TABS: "[LIST_TABS]",
        LIST_APPS: "[LIST_APPS]"
    });
    const ARCADE_ACTION_PLAYBOOK = Object.freeze({
        games: [
            "pinball",
            "snake",
            "basketball",
            "calc",
            "library",
            "leaderboard",
            "store"
        ],
        media: [
            "play",
            "pause",
            "next",
            "previous",
            "open_spotify",
            "open_youtube",
            "play_spotify",
            "pause_spotify",
            "next_spotify",
            "previous_spotify",
            "play_youtube",
            "pause_youtube",
            "next_youtube",
            "previous_youtube"
        ],
        desktop: [
            "steam <game name>",
            "steam_play <game name>",
            "steam_search <game name>",
            "duckduckgo <query>",
            "ddg <query>"
        ],
        navigation: [
            "home",
            "feed",
            "messages",
            "profile",
            "account",
            "settings",
            "notifications",
            "help_guide",
            "view_terms",
            "view_privacy"
        ],
        utilities: [
            "theme_sunset",
            "theme_midnight",
            "theme_paper",
            "theme_ember",
            "theme_forest",
            "theme_ocean",
            "scroll_to_top",
            "scroll_to_bottom",
            "refresh_page",
            "barrel_roll",
            "joke",
            "konami_code",
            "meaning_of_life"
        ]
    });
    const SUPPORTED_ATTACHMENT_TYPES = Object.freeze([
        "image/*",
        "video/*",
        "audio/*",
        ".txt",
        ".md",
        ".js",
        ".ts",
        ".jsx",
        ".tsx",
        ".html",
        ".css",
        ".json",
        ".py",
        ".java",
        ".c",
        ".cpp",
        ".cs",
        ".rs",
        ".go",
        ".php",
        ".rb",
        ".lua",
        ".sql",
        ".yaml",
        ".yml",
        ".xml",
        ".pdf",
        ".doc",
        ".docx"
    ]);

    function toText(value) {
        if (value === null || value === undefined) return "";
        return typeof value === "string" ? value : String(value);
    }

    function clampText(value, maxLength) {
        const text = toText(value).trim();
        const limit = Number.isFinite(maxLength) ? Math.max(1, maxLength) : 1000;
        if (!text) return "";
        if (text.length <= limit) return text;
        return text.slice(0, limit);
    }

    function getStoredCustomInstructions(maxLength = DEFAULT_MAX_CUSTOM_INSTRUCTIONS_CHARS) {
        try {
            const raw = global?.localStorage?.getItem(CUSTOM_INSTRUCTIONS_STORAGE_KEY) || "";
            return clampText(raw, maxLength);
        } catch (_error) {
            return "";
        }
    }

    function setStoredCustomInstructions(value, maxLength = DEFAULT_MAX_CUSTOM_INSTRUCTIONS_CHARS) {
        const next = clampText(value, maxLength);
        try {
            if (!global?.localStorage) return next;
            if (next) {
                global.localStorage.setItem(CUSTOM_INSTRUCTIONS_STORAGE_KEY, next);
            } else {
                global.localStorage.removeItem(CUSTOM_INSTRUCTIONS_STORAGE_KEY);
            }
        } catch (_error) {
            // Ignore storage failures; caller still receives normalized text.
        }
        return next;
    }

    function estimateDataUrlBytes(dataUrl) {
        const text = toText(dataUrl);
        const marker = "base64,";
        const markerIndex = text.indexOf(marker);
        if (markerIndex === -1) return 0;
        const base64Payload = text.slice(markerIndex + marker.length);
        const rawLength = base64Payload.replace(/\s+/g, "").length;
        if (!rawLength) return 0;
        return Math.max(0, Math.floor(rawLength * 0.75));
    }

    function extractMimeTypeFromDataUrl(dataUrl) {
        const text = toText(dataUrl);
        const match = text.match(/^data:([^;,]+)[;,]/i);
        return match ? match[1].toLowerCase() : "";
    }

    function inferAttachmentKind(attachment) {
        if (!attachment || typeof attachment !== "object") return "none";
        const declaredType = toText(attachment.type).trim().toLowerCase();
        if (declaredType === "image" || declaredType === "video" || declaredType === "audio" || declaredType === "file") {
            return declaredType;
        }
        const mime = extractMimeTypeFromDataUrl(attachment.data);
        if (!mime) return "file";
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        if (mime.startsWith("audio/")) return "audio";
        return "file";
    }

    function describeAttachment(attachment) {
        if (!attachment || typeof attachment !== "object") {
            return {
                present: false,
                kind: "none",
                name: "",
                mimeType: "",
                approxBytes: 0
            };
        }

        const kind = inferAttachmentKind(attachment);
        const name = clampText(attachment.name, 120);
        const mimeType = extractMimeTypeFromDataUrl(attachment.data);
        const approxBytes = estimateDataUrlBytes(attachment.data);

        return {
            present: true,
            kind,
            name,
            mimeType: mimeType || "",
            approxBytes
        };
    }

    function normalizeHistory(rawHistory, options) {
        const settings = options || {};
        const aiSenderId = toText(settings.aiSenderId || "ai-companion");
        const maxMessages = Number.isFinite(settings.maxMessages) ? Math.max(1, settings.maxMessages) : DEFAULT_MAX_HISTORY_MESSAGES;
        const maxChars = Number.isFinite(settings.maxMessageChars) ? Math.max(30, settings.maxMessageChars) : DEFAULT_MAX_MESSAGE_CHARS;
        const currentMessageId = toText(settings.currentMessageId || "");

        if (!Array.isArray(rawHistory)) return [];

        const normalized = [];
        for (const entry of rawHistory) {
            if (!entry || typeof entry !== "object") continue;
            if (entry.isThinking) continue;
            if (currentMessageId && toText(entry.id) === currentMessageId) continue;

            let role = "";
            if (entry.role) {
                const incoming = toText(entry.role).trim().toLowerCase();
                role = incoming === "assistant" ? "assistant" : "user";
            } else {
                role = toText(entry.senderId) === aiSenderId ? "assistant" : "user";
            }

            const content = clampText(entry.content ?? entry.body ?? "", maxChars);
            if (!content) continue;

            normalized.push({ role, content });
        }

        if (normalized.length <= maxMessages) return normalized;
        return normalized.slice(normalized.length - maxMessages);
    }

    function normalizeGameKey(input) {
        return `${input || ""}`
            .trim()
            .toLowerCase()
            .replace(/[^\w\s']/g, " ")
            .replace(/\s+/g, " ");
    }

    function resolveSteamGame(target) {
        const key = normalizeGameKey(target);
        if (!key) return null;
        if (Object.prototype.hasOwnProperty.call(STEAM_GAME_APP_IDS, key)) {
            return { key, appId: STEAM_GAME_APP_IDS[key] };
        }
        const fuzzy = Object.entries(STEAM_GAME_APP_IDS).find(([known]) =>
            known.includes(key) || key.includes(known)
        );
        if (!fuzzy) return null;
        return { key: fuzzy[0], appId: fuzzy[1] };
    }

    function parseDirectSteamCommand(text) {
        const raw = `${text || ""}`.trim();
        if (!raw) return "";

        const match = raw.match(/^(?:play|launch|start|run|open)\s+(.+)$/i);
        if (!match) return "";

        let target = `${match[1] || ""}`.trim();
        if (!target) return "";

        if (/^(spotify|youtube|music|video|media)\b/i.test(target)) return "";

        target = target.replace(/\s+on\s+steam$/i, "").trim();
        if (!target) return "";

        const hasSteamHint = /\bsteam\b/i.test(raw);
        const knownGame = resolveSteamGame(target);

        if (!hasSteamHint && !knownGame) {
            return "";
        }
        return target;
    }

    function parseDuckDuckGoCommand(text) {
        const raw = `${text || ""}`.trim();
        if (!raw) return "";
        const direct = raw.match(/^(?:duckduckgo|ddg)\s+(.+)$/i);
        if (direct?.[1]) return direct[1].trim();
        const search = raw.match(/^search(?:\s+for)?\s+(.+?)\s+(?:on\s+)?duckduckgo$/i);
        if (search?.[1]) return search[1].trim();
        return "";
    }

    function buildSteamLaunchPlan(target) {
        const requestedTarget = `${target || ""}`.trim();
        if (!requestedTarget) return null;

        const resolved = resolveSteamGame(requestedTarget);
        if (resolved?.appId) {
            return {
                type: "run",
                key: resolved.key,
                appId: resolved.appId,
                uri: `steam://run/${resolved.appId}`,
                requestedTarget
            };
        }

        return {
            type: "search",
            key: normalizeGameKey(requestedTarget),
            appId: null,
            uri: "",
            searchUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(requestedTarget)}`,
            requestedTarget
        };
    }

    function inferAttachmentCapabilities(attachment) {
        const info = describeAttachment(attachment);
        return {
            present: info.present,
            canAttemptVisionAnalysis: info.kind === "image" || info.kind === "video",
            canAttemptAudioReasoning: info.kind === "audio" || info.kind === "video",
            canAttemptFileInspection: info.kind === "file" || info.kind === "image" || info.kind === "video" || info.kind === "audio",
            shouldUseMetadataFallback: info.present && !info.mimeType,
            recommendedPromptMode: info.present ? `analyze-${info.kind}` : "general-chat"
        };
    }

    function getKnownSteamGameHints(limit) {
        const maxItems = Number.isFinite(limit) ? Math.max(1, limit) : DEFAULT_MAX_STEAM_HINTS;
        const uniqueByAppId = new Map();
        for (const [alias, appId] of Object.entries(STEAM_GAME_APP_IDS)) {
            if (!uniqueByAppId.has(appId)) {
                uniqueByAppId.set(appId, { canonicalName: alias, appId, aliases: [alias] });
            } else {
                uniqueByAppId.get(appId).aliases.push(alias);
            }
        }
        return Array.from(uniqueByAppId.values())
            .map((entry) => ({
                name: entry.canonicalName,
                appId: entry.appId,
                aliases: entry.aliases.slice(0, 3)
            }))
            .slice(0, maxItems);
    }

    function buildActionPlaybook(surface) {
        const normalizedSurface = clampText(surface || "main", 32).toLowerCase() || "main";
        return {
            surface: normalizedSurface,
            tags: ACTION_TAGS,
            examples: [
                { user: "Play Grand Theft Auto V", action: "[ARCADE:steam grand theft auto v]" },
                { user: "Open Spotify", action: "[ARCADE:open_spotify]" },
                { user: "Pause YouTube", action: "[ARCADE:pause_youtube]" },
                { user: "Search DDG for LM Studio bridge", action: "[DUCKDUCKGO:LM Studio local bridge troubleshooting]" },
                { user: "Take me to settings", action: "[ARCADE:settings]" },
                { user: "Draft a DM for this post", action: "[COMPOSE:Hey, this looks great. Can we collaborate?]" },
                { user: "What's on my screen?", action: "[SCREENSHOT]" },
                { user: "What tabs do I have open?", action: "[LIST_TABS]" },
                { user: "What apps are running?", action: "[LIST_APPS]" }
            ],
            categories: ARCADE_ACTION_PLAYBOOK
        };
    }

    function buildModelRoutingGuide() {
        return {
            priorities: [
                "Use multimodal-capable models when attachment is present.",
                "Prefer local low-latency models for short commands and action routing.",
                "Use larger reasoning models for architecture changes, refactors, and deep debugging."
            ],
            fallbackPolicy: [
                "If bridge/model is offline, return concise offline guidance and available local actions.",
                "If model cannot inspect attachment, state limitation explicitly and continue using metadata/context.",
                "Do not fabricate file content, API results, or execution outcomes."
            ]
        };
    }

    function buildExecutionBoundaries() {
        return {
            hardRules: [
                "Never claim an action executed unless a tag/action is emitted.",
                "Never output secrets or private credentials.",
                "Use [COMPOSE:<text>] only when the user explicitly asks to draft/prefill a DM or message.",
                "Never use [COMPOSE:<text>] for coding requests, debugging, or general Q&A.",
                "Prefer [PATCH_SUGGESTION] for risky edits spanning many files.",
                "Ask for explicit user confirmation before destructive operations."
            ],
            bridgeBoundaries: [
                "Desktop/local-bridge actions must remain local-only and user-initiated.",
                "CORS, mixed-content, and localhost restrictions should be explained plainly when requests fail.",
                "On failure, provide next-step remediation instead of repeating failing calls."
            ]
        };
    }

    function buildFileRewriteContract() {
        return [
            "When the user asks to rewrite or generate code/files, use one of these response formats:",
            "1) Full-file rewrite:",
            "[FILE_REWRITE]",
            "path: relative/or/absolute/path.ext",
            "language: html|css|javascript|json|text|other",
            "summary: one-line reason for the rewrite",
            "---BEGIN_CONTENT---",
            "<full file content>",
            "---END_CONTENT---",
            "[/FILE_REWRITE]",
            "2) Targeted patch suggestion:",
            "[PATCH_SUGGESTION]",
            "path: relative/or/absolute/path.ext",
            "summary: what changed",
            "---BEGIN_PATCH---",
            "<unified diff or find/replace instructions>",
            "---END_PATCH---",
            "[/PATCH_SUGGESTION]",
            "3) Multi-step implementation plan:",
            "[IMPLEMENTATION_PLAN]",
            "scope: short title",
            "risk: low|medium|high",
            "steps:",
            "- step 1",
            "- step 2",
            "[/IMPLEMENTATION_PLAN]",
            "4) Test plan for validation:",
            "[TEST_PLAN]",
            "- test case 1",
            "- test case 2",
            "[/TEST_PLAN]",
            "Never claim tests passed unless explicit test results are provided."
        ].join("\n");
    }

    function buildCapabilitiesManifest(surface) {
        const normalizedSurface = clampText(surface || "main", 32).toLowerCase() || "main";
        const actionPlaybook = buildActionPlaybook(normalizedSurface);
        const routingGuide = buildModelRoutingGuide();
        const executionBoundaries = buildExecutionBoundaries();
        return {
            coreVersion: CORE_VERSION,
            surface: normalizedSurface,
            abilities: {
                multimodal: [
                    "Inspect image attachments when the model supports vision.",
                    "Inspect video attachments by describing visible frames/scene cues when possible.",
                    "Inspect attached text/code/doc files and extract actionable details.",
                    "Use filename, mime type, and metadata for unsupported formats."
                ],
                coding: [
                    "Generate full rewrites for HTML, CSS, JavaScript, JSON, and text files.",
                    "Produce targeted patch suggestions for safer incremental changes.",
                    "Explain why each rewrite is needed and highlight risk before destructive edits.",
                    "Design modular refactors with explicit boundaries for UI, state, API, and utility layers."
                ],
                pcAndMediaControl: [
                    "Control media playback using actionable tags for play/pause/next/previous.",
                    "Open Spotify and YouTube via supported bridge/player actions when available.",
                    "Launch Steam games using [ARCADE:steam <game>] with app-id mapping and fallback search.",
                    "Capture and analyze the current screen with [SCREENSHOT].",
                    "Identify open browser tabs and running desktop applications with [LIST_TABS] and [LIST_APPS]."
                ],
                webResearch: [
                    "Route search intents to DuckDuckGo with [DUCKDUCKGO:<query>].",
                    "Generate focused search queries for debugging, docs, and troubleshooting."
                ],
                agenticWorkflow: [
                    "Translate user goals into concrete execution plans before editing.",
                    "Provide explicit validation steps after code/output generation.",
                    "Prefer deterministic structured output tags when tool execution is needed."
                ],
                actions: Object.values(ACTION_TAGS),
                actionTags: ACTION_TAGS,
                attachmentSupport: SUPPORTED_ATTACHMENT_TYPES
            },
            actionPlaybook,
            routingGuide,
            executionBoundaries,
            requirements: [
                "Do not claim to be text-only if an attachment is present.",
                "If current model lacks vision/file decoding, state limitation clearly and suggest a compatible model.",
                "Prefer precise, actionable output over generic guidance.",
                "Do not claim external side effects (file writes, playback control, app launch) without an explicit action tag or confirmed execution."
            ],
            responseStyle: [
                "Default to concise, operational responses.",
                "Include exact action tags when direct execution is intended.",
                "When debugging, include likely root cause and one minimal safe fix."
            ],
            fileRewriteContract: buildFileRewriteContract()
        };
    }

    function buildCompanionContext(input) {
        const payload = input || {};
        const manifest = buildCapabilitiesManifest(payload.surface);
        const attachment = describeAttachment(payload.attachment);
        const attachmentCapabilities = inferAttachmentCapabilities(payload.attachment);
        const pageTitle = clampText(payload.pageTitle || payload.title || "", 140);
        const pageUrl = clampText(payload.pageUrl || payload.url || "", 280);
        const currentCategory = clampText(payload.currentCategory || "", 80);
        const maxPageTextChars = Number.isFinite(payload.maxPageTextChars)
            ? Math.max(100, payload.maxPageTextChars)
            : DEFAULT_MAX_VISIBLE_TEXT_SAMPLE;
        const visibleText = clampText(payload.visibleText || "", maxPageTextChars);
        const intentHints = Array.isArray(payload.intentHints)
            ? payload.intentHints.map((item) => clampText(item, 120)).filter(Boolean).slice(0, 12)
            : [];
        const platform = typeof navigator !== "undefined" ? clampText(navigator.userAgent || "", 260) : "";
        const steamHints = getKnownSteamGameHints(payload.maxSteamHints);

        const contextPacket = {
            companionCore: manifest,
            runtimeContext: {
                timestampUtc: new Date().toISOString(),
                pageTitle,
                pageUrl,
                currentCategory,
                visibleTextSample: visibleText,
                platform
            },
            attachmentContext: attachment,
            attachmentCapabilities,
            commandHints: {
                knownSteamGames: steamHints
            },
            intentHints
        };

        return `[SignalShare_Companion_Context_v${CORE_VERSION}]\n${JSON.stringify(contextPacket, null, 2)}`;
    }

    const api = {
        CORE_VERSION,
        DEFAULT_MAX_HISTORY_MESSAGES,
        DEFAULT_MAX_MESSAGE_CHARS,
        DEFAULT_MAX_PAGE_TEXT_CHARS,
        DEFAULT_MAX_STEAM_HINTS,
        DEFAULT_MAX_VISIBLE_TEXT_SAMPLE,
        CUSTOM_INSTRUCTIONS_STORAGE_KEY,
        DEFAULT_MAX_CUSTOM_INSTRUCTIONS_CHARS,
        ACTION_TAGS,
        ARCADE_ACTION_PLAYBOOK,
        SUPPORTED_ATTACHMENT_TYPES,
        clampText,
        getStoredCustomInstructions,
        setStoredCustomInstructions,
        normalizeHistory,
        normalizeGameKey,
        resolveSteamGame,
        parseDirectSteamCommand,
        parseDuckDuckGoCommand,
        buildSteamLaunchPlan,
        inferAttachmentCapabilities,
        getKnownSteamGameHints,
        buildActionPlaybook,
        buildModelRoutingGuide,
        buildExecutionBoundaries,
        describeAttachment,
        buildCapabilitiesManifest,
        buildCompanionContext,
        buildFileRewriteContract
    };

    global.SignalShareAiCore = api;
})(window);
