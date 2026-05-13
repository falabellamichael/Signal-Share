/**
 * Signal Share Companion AI Core
 * Shared capability logic for both companions (main page + mini-games).
 */
(function initSignalShareAiCore(global) {
    const CORE_VERSION = "1.1";
    const DEFAULT_MAX_HISTORY_MESSAGES = 18;
    const DEFAULT_MAX_MESSAGE_CHARS = 900;
    const DEFAULT_MAX_PAGE_TEXT_CHARS = 600;
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
            "[/PATCH_SUGGESTION]"
        ].join("\n");
    }

    function buildCapabilitiesManifest(surface) {
        const normalizedSurface = clampText(surface || "main", 32).toLowerCase() || "main";
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
                    "Explain why each rewrite is needed and highlight risk before destructive edits."
                ],
                actions: [
                    "[ARCADE:<action>] to trigger known in-app commands.",
                    "[ARCADE:steam <game>] to launch a Steam game by name.",
                    "[OPEN:<target>] to navigate within app surfaces.",
                    "[DUCKDUCKGO:<query>] to open a DuckDuckGo search.",
                    "[COMPOSE:<text>] to prefill composer/message fields.",
                    "[PUBLISH:{json}] for publish helpers when available.",
                    "[FILE_REWRITE] / [PATCH_SUGGESTION] for code/file edits."
                ]
            },
            requirements: [
                "Do not claim to be text-only if an attachment is present.",
                "If current model lacks vision/file decoding, state limitation clearly and suggest a compatible model.",
                "Prefer precise, actionable output over generic guidance."
            ],
            fileRewriteContract: buildFileRewriteContract()
        };
    }

    function buildCompanionContext(input) {
        const payload = input || {};
        const manifest = buildCapabilitiesManifest(payload.surface);
        const attachment = describeAttachment(payload.attachment);
        const pageTitle = clampText(payload.pageTitle || payload.title || "", 140);
        const pageUrl = clampText(payload.pageUrl || payload.url || "", 280);
        const currentCategory = clampText(payload.currentCategory || "", 80);
        const visibleText = clampText(payload.visibleText || "", Number.isFinite(payload.maxPageTextChars) ? payload.maxPageTextChars : DEFAULT_MAX_PAGE_TEXT_CHARS);

        const contextPacket = {
            companionCore: manifest,
            runtimeContext: {
                pageTitle,
                pageUrl,
                currentCategory,
                visibleTextSample: visibleText
            },
            attachmentContext: attachment
        };

        return `[SignalShare_Companion_Context_v${CORE_VERSION}]\n${JSON.stringify(contextPacket, null, 2)}`;
    }

    const api = {
        CORE_VERSION,
        DEFAULT_MAX_HISTORY_MESSAGES,
        DEFAULT_MAX_MESSAGE_CHARS,
        DEFAULT_MAX_PAGE_TEXT_CHARS,
        clampText,
        normalizeHistory,
        normalizeGameKey,
        resolveSteamGame,
        parseDirectSteamCommand,
        parseDuckDuckGoCommand,
        buildSteamLaunchPlan,
        describeAttachment,
        buildCapabilitiesManifest,
        buildCompanionContext,
        buildFileRewriteContract
    };

    global.SignalShareAiCore = api;
})(window);
