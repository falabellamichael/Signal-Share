/**
 * /edit Command
 *
 * File-targeted Workshop editor integration.
 *
 * Rules:
 * - If the prompt names a file, switch to that file before sending AI context.
 * - Apply AI edits to the resolved game + file, not blindly to the visible file.
 * - Accept [EDIT] blocks, raw SEARCH/REPLACE blocks, and full-file code fences.
 * - Fall back from exact SEARCH matching to whitespace/function/CSS-block matching.
 */
(function () {
    const COMMAND_ID = 'edit';
    let originalGetWorkshopEditorState = null;
    let stateWrapperInstalled = false;
    let lastResolvedTarget = null;

    const STEAM_COMING_SOON_SAFETY = Object.freeze({
        steamComingSoonIsReleasedGame: false,
        steamComingSoonIsQualitySignal: false,
        defaultImportedSteamVisibility: 'needs_review',
        allowedAutoStates: ['detected', 'coming_soon', 'needs_review'],
        blockedAutoStates: ['published', 'approved', 'featured', 'recommended'],
        requiresManualApprovalBeforePublicPromotion: true,
        rule: 'Never auto-publish, auto-approve, feature, or recommend a Steam Coming Soon title from Steam visibility alone.'
    });

    function normalizeText(value = '') {
        return `${value || ''}`.trim();
    }

    function normalizeNewlines(value = '') {
        return `${value || ''}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function collapseWhitespace(value = '') {
        return normalizeNewlines(value).replace(/\s+/g, ' ').trim();
    }

    function escapeRegex(value = '') {
        return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripCodeFence(value = '') {
        let text = normalizeNewlines(value).trim();
        const match = text.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/);
        if (match) text = match[1].trim();
        return text;
    }

    function cleanPatchPart(value = '') {
        return stripCodeFence(value)
            .replace(/^\s*SEARCH\s*:\s*/i, '')
            .replace(/^\s*REPLACE\s*:\s*/i, '')
            .replace(/^\s*```[^\n`]*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();
    }

    function isFileName(value = '') {
        return /^[\w .()\-]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml)$/i.test(normalizeText(value));
    }

    function getSteamComingSoonSafetyContext() {
        return {
            ...STEAM_COMING_SOON_SAFETY,
            quarantineStatus: 'needs_review',
            manualGateRequiredFor: STEAM_COMING_SOON_SAFETY.blockedAutoStates.slice()
        };
    }

    function includesSteamComingSoonReference(value = '') {
        const source = normalizeNewlines(value).toLowerCase();
        return /\bsteam\b/.test(source) && /\bcoming[\s_-]*soon\b/.test(source);
    }

    function hasPublishSurfaceIntent(value = '') {
        return /\b(?:publish(?:ed|ing)?|approve(?:d)?|feature(?:d)?|recommend(?:ed)?|promote(?:d)?|release(?:d)?|ship(?:ped)?|live|public|visible)\b/i.test(value);
    }

    function hasPreventionIntent(value = '') {
        return /\b(?:prevent|block|stop|disable|deny|guard|quarantine|review|manual|manually|needs_review|never|not|no|don't|do\s+not|cannot|can't|shouldn't|wont|won't|fix)\b/i.test(value);
    }

    function isUnsafeSteamComingSoonPublishPrompt(prompt = '') {
        return includesSteamComingSoonReference(prompt)
            && hasPublishSurfaceIntent(prompt)
            && !hasPreventionIntent(prompt);
    }

    function findSteamComingSoonAutoPublishRisk(content = '', fileName = '') {
        const targetFileName = normalizeText(fileName);
        if (/^edit\.js$/i.test(targetFileName) || /(?:^|[\\/])edit\.js$/i.test(targetFileName)) return null;

        const source = normalizeNewlines(content);
        const dangerousPatterns = [
            {
                reason: 'Steam Coming Soon state appears to set a public/published/approved state directly.',
                pattern: /\bsteam(?:Status|State|ReleaseState)?\b[\s\S]{0,240}\bcoming[\s_-]*soon\b[\s\S]{0,240}\b(?:published|approved|featured|recommended|visible|live|public)\s*[:=]\s*(?:true|['"`](?:true|published|approved|featured|recommended|visible|live|public)['"`])/i
            },
            {
                reason: 'Coming Soon appears to map to a published/approved/featured status.',
                pattern: /\bcoming[\s_-]*soon\b[\s\S]{0,240}\b(?:status|state|visibility|surface)\s*[:=]\s*['"`](?:published|approved|featured|recommended|visible|live|public)['"`]/i
            },
            {
                reason: 'Steam page detection appears to auto-mark an item as public/published/approved.',
                pattern: /\b(?:steamPageExists|hasSteamPage|steamStorePage|steamAppId|steamUrl)\b[\s\S]{0,240}\b(?:published|approved|featured|recommended|visible|live|public)\s*[:=]\s*(?:true|['"`](?:true|published|approved|featured|recommended|visible|live|public)['"`])/i
            },
            {
                reason: 'Steam Coming Soon appears to call a publish/approve/feature action.',
                pattern: /\bsteam\b[\s\S]{0,240}\bcoming[\s_-]*soon\b[\s\S]{0,240}\b(?:publish|approve|feature|recommend|promote)(?:Game|Title|Item|Entry|ToSite)?\s*\(/i
            }
        ];

        const hit = dangerousPatterns.find((entry) => entry.pattern.test(source));
        return hit ? hit.reason : null;
    }

    function enforceSteamComingSoonPublishGuard(fileName = '', content = '') {
        const risk = findSteamComingSoonAutoPublishRisk(content, fileName);
        if (!risk) return { ok: true };

        const message = `${risk} Steam Coming Soon imports must stay in needs_review until manually approved.`;
        console.warn('[Arcade: Edit] Blocked unsafe Steam Coming Soon publish edit:', { fileName, message });
        if (typeof window.showFeedback === 'function') window.showFeedback(message, true);
        return { ok: false, message, steamComingSoonPublishGuardBlocked: true };
    }

    function getEditorElement() {
        return document.getElementById('workshop-edit-file-content')
            || document.querySelector('[data-workshop-edit-file-content]')
            || document.querySelector('.workshop-edit-file-content')
            || document.querySelector('textarea[data-file-editor]')
            || document.querySelector('textarea.code-editor')
            || document.querySelector('textarea');
    }

    function getEditorDomContent() {
        const editor = getEditorElement();
        if (!editor) return '';
        if (typeof editor.value === 'string') return editor.value;
        if (typeof editor.textContent === 'string') return editor.textContent;
        return '';
    }

    function setEditorDomContent(content = '') {
        const editor = getEditorElement();
        if (!editor) return false;
        editor.value = `${content || ''}`;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.handleWorkshopEditContentInput === 'function') window.handleWorkshopEditContentInput();
        if (typeof window.syncWorkshopEditorLineNumbers === 'function') window.syncWorkshopEditorLineNumbers();
        return true;
    }

    function getManageableGames() {
        if (typeof window.getWorkshopManageableGames !== 'function') return [];
        try {
            const games = window.getWorkshopManageableGames();
            return Array.isArray(games) ? games : [];
        } catch (_error) {
            return [];
        }
    }

    function getCurrentEditorState() {
        try {
            if (originalGetWorkshopEditorState) return originalGetWorkshopEditorState();
            if (typeof window.getWorkshopEditorState === 'function') return window.getWorkshopEditorState();
        } catch (_error) {
            return null;
        }
        return null;
    }

    function getGameById(gameId = '') {
        const id = normalizeText(gameId);
        if (!id) return null;
        return getManageableGames().find((game) => `${game?.id || ''}` === id) || null;
    }

    function gameTitle(game = null) {
        return normalizeText(game?.title || game?.name || game?.gameTitle || '');
    }

    function gameFiles(game = null) {
        const files = Array.isArray(game?.files) ? game.files : [];
        return files
            .map((file) => typeof file === 'string' ? { name: file } : file)
            .filter((file) => normalizeText(file?.name || file?.fileName));
    }

    function extractPromptFileName(prompt = '') {
        const text = normalizeText(prompt);
        const explicit = text.match(/\b(?:file|filename|path)\s*[:=]?\s*['"]?([\w .()\-]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))['"]?/i)?.[1];
        if (explicit) return normalizeText(explicit);

        const bare = text.match(/(?:^|\s)([\w .()\-]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))(?=\s|$)/i)?.[1];
        return normalizeText(bare || '');
    }

    function resolveFileNameForGame(game = null, requestedFileName = '', state = null) {
        const requested = normalizeText(requestedFileName);
        const files = gameFiles(game);
        if (requested) {
            const direct = files.find((file) => normalizeText(file.name || file.fileName).toLowerCase() === requested.toLowerCase());
            if (direct) return normalizeText(direct.name || direct.fileName);
            return requested;
        }

        const fromState = normalizeText(state?.activeFileName || state?.fileName || state?.selectedFileName);
        if (fromState) return fromState;

        const indexFile = files.find((file) => /^index\.html?$/i.test(normalizeText(file.name || file.fileName)));
        if (indexFile) return normalizeText(indexFile.name || indexFile.fileName);

        const first = files[0];
        return normalizeText(first?.name || first?.fileName || 'index.html');
    }

    function resolveGameFromPrompt(prompt = '', state = null) {
        const games = getManageableGames();
        const cleanPrompt = normalizeText(prompt);

        if (typeof window.resolveWorkshopEditGameFromPrompt === 'function') {
            try {
                const resolved = window.resolveWorkshopEditGameFromPrompt(cleanPrompt);
                if (resolved?.id) return resolved;
            } catch (_error) {
                // Continue with local resolution.
            }
        }

        const stateGame = getGameById(state?.activeGameId || state?.gameId || '');
        if (stateGame && /\b(this|current|open|opened|selected|active)\b/i.test(cleanPrompt)) return stateGame;

        const promptWithoutFile = cleanPrompt.replace(extractPromptFileName(cleanPrompt), '').toLowerCase();
        const byTitle = games
            .slice()
            .sort((a, b) => gameTitle(b).length - gameTitle(a).length)
            .find((game) => {
                const title = gameTitle(game).toLowerCase();
                return title && promptWithoutFile.includes(title);
            });
        if (byTitle) return byTitle;

        if (stateGame) return stateGame;
        if (games.length === 1) return games[0];
        return null;
    }

    async function switchWorkshopTarget(gameId = '', fileName = '') {
        const targetGameId = normalizeText(gameId);
        const targetFileName = normalizeText(fileName || 'index.html');
        if (!targetGameId || typeof window.setWorkshopEditActiveGame !== 'function') {
            return { ok: false, id: targetGameId, fileName: targetFileName };
        }

        try {
            let result = await Promise.resolve(window.setWorkshopEditActiveGame(targetGameId, targetFileName));
            if (result?.ok !== false) return result || { ok: true, id: targetGameId, fileName: targetFileName };

            result = await Promise.resolve(window.setWorkshopEditActiveGame(targetGameId, { fileName: targetFileName }));
            return result || { ok: true, id: targetGameId, fileName: targetFileName };
        } catch (error) {
            console.warn('[Arcade: Edit] Failed to switch Workshop target:', error);
            return { ok: false, id: targetGameId, fileName: targetFileName, error };
        }
    }

    function readWorkshopFile(gameId = '', fileName = '', state = null) {
        const targetGameId = normalizeText(gameId);
        const targetFileName = normalizeText(fileName || 'index.html');

        if (targetGameId && targetFileName && typeof window.getWorkshopFileContent === 'function') {
            try {
                const content = window.getWorkshopFileContent(targetGameId, targetFileName);
                if (typeof content === 'string') return content;
            } catch (_error) {
                // Fall through.
            }
        }

        const stateFile = normalizeText(state?.activeFileName || state?.fileName || '');
        const stateContent = state?.activeFileContent ?? state?.content ?? state?.value;
        if ((!stateFile || stateFile === targetFileName) && typeof stateContent === 'string') return stateContent;

        return getEditorDomContent();
    }

    async function saveWorkshopFile(gameId = '', fileName = '', content = '') {
        const targetGameId = normalizeText(gameId);
        const targetFileName = normalizeText(fileName || 'index.html');
        if (!targetGameId || !targetFileName) return { ok: false, message: 'Missing target game or file.' };

        const safetyCheck = enforceSteamComingSoonPublishGuard(targetFileName, content);
        if (!safetyCheck.ok) return safetyCheck;

        await switchWorkshopTarget(targetGameId, targetFileName);

        if (typeof window.internalApplyWorkshopFileEdit === 'function') {
            const result = await window.internalApplyWorkshopFileEdit(targetGameId, targetFileName, `${content || ''}`, { save: true });
            if (result?.ok !== false) {
                setEditorDomContent(content);
                return result || { ok: true };
            }
            return result;
        }

        setEditorDomContent(content);
        if (typeof window.saveWorkshopEditPanel === 'function') {
            const result = await window.saveWorkshopEditPanel();
            return result || { ok: true };
        }

        return { ok: true, message: 'Updated editor content; save helper unavailable.' };
    }

    function buildSnapshot(target, state = null) {
        const game = getGameById(target.gameId) || target.game || null;
        const content = readWorkshopFile(target.gameId, target.fileName, state);
        const snapshot = {
            ...(state && typeof state === 'object' ? state : {}),
            activeGameId: normalizeText(target.gameId),
            activeGameTitle: normalizeText(target.gameTitle || gameTitle(game)),
            activeFileName: normalizeText(target.fileName || 'index.html'),
            activeFileContent: `${content || ''}`,
            activeFileContentLength: `${content || ''}`.length,
            activeFileContentProvidedInEditProtocol: true,
            steamComingSoonSafety: getSteamComingSoonSafetyContext(),
            source: 'edit-js-targeted-snapshot'
        };

        window.__activeWorkshopEditorContext = snapshot;
        window.__lastWorkshopEditSnapshot = snapshot;
        window.__arcadeSteamComingSoonSafety = snapshot.steamComingSoonSafety;
        lastResolvedTarget = {
            gameId: snapshot.activeGameId,
            gameTitle: snapshot.activeGameTitle,
            fileName: snapshot.activeFileName,
            prompt: target.prompt || '',
            content: snapshot.activeFileContent
        };
        return snapshot;
    }

    function installStateWrapper() {
        if (stateWrapperInstalled) return;
        stateWrapperInstalled = true;
        originalGetWorkshopEditorState = typeof window.getWorkshopEditorState === 'function'
            ? window.getWorkshopEditorState.bind(window)
            : null;

        window.getWorkshopEditorState = function targetedWorkshopEditorState() {
            const original = originalGetWorkshopEditorState ? originalGetWorkshopEditorState() : null;
            const snapshot = window.__activeWorkshopEditorContext || window.__lastWorkshopEditSnapshot || null;
            if (!snapshot) return original;

            const originalFile = normalizeText(original?.activeFileName || original?.fileName || '');
            const originalGame = normalizeText(original?.activeGameId || original?.gameId || '');
            const originalContent = original?.activeFileContent ?? original?.content ?? original?.value;

            if (originalGame === snapshot.activeGameId
                && originalFile === snapshot.activeFileName
                && typeof originalContent === 'string'
                && originalContent.length > 0) {
                return original;
            }

            return {
                ...(original && typeof original === 'object' ? original : {}),
                ...snapshot,
                activeGameId: snapshot.activeGameId,
                activeGameTitle: snapshot.activeGameTitle,
                activeFileName: snapshot.activeFileName,
                activeFileContent: snapshot.activeFileContent,
                activeFileContentLength: snapshot.activeFileContentLength,
                activeFileContentProvidedInEditProtocol: true,
                steamComingSoonSafety: snapshot.steamComingSoonSafety || getSteamComingSoonSafetyContext()
            };
        };
    }

    async function resolveTarget(prompt = '') {
        installStateWrapper();
        const state = getCurrentEditorState();
        const game = resolveGameFromPrompt(prompt, state);
        const requestedFileName = extractPromptFileName(prompt);
        const fileName = resolveFileNameForGame(game, requestedFileName, state);
        const gameId = normalizeText(game?.id || state?.activeGameId || state?.gameId || window.lastPlayedGameId || '');

        const target = {
            game,
            gameId,
            gameTitle: gameTitle(game) || normalizeText(state?.activeGameTitle || state?.gameTitle || state?.title || ''),
            fileName,
            prompt
        };

        if (gameId) await switchWorkshopTarget(gameId, fileName);
        const refreshed = getCurrentEditorState();
        buildSnapshot(target, refreshed);
        return target;
    }

    function inferResponseFileName(text = '', fallbackFileName = 'index.html', userPrompt = '') {
        const source = normalizeNewlines(text);
        const tagged = source.match(/\[(?:EDIT|EDIT_FILE|FILE_EDIT)\s*:\s*([^\]\n]+)\]/i)?.[1];
        if (tagged && isFileName(tagged)) return normalizeText(tagged).replace(/^['"]|['"]$/g, '');

        const kv = source.match(/\b(?:file(?:name)?|path)\s*[:=]\s*['"]?([^'"\s`]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))['"]?/i)?.[1];
        if (kv) return normalizeText(kv);

        const promptFile = extractPromptFileName(userPrompt);
        if (promptFile) return promptFile;

        return normalizeText(fallbackFileName || 'index.html');
    }

    function parseSearchReplaceBlocks(text = '', fallbackFileName = 'index.html', userPrompt = '') {
        const source = normalizeNewlines(text);
        const candidates = [source];
        const fenceRegex = /```[^\n`]*\n([\s\S]*?)```/g;
        let fence;
        while ((fence = fenceRegex.exec(source)) !== null) {
            if (/SEARCH\s*:/i.test(fence[1] || '') && /REPLACE\s*:/i.test(fence[1] || '')) candidates.push(fence[1]);
        }

        const blocks = [];
        const seen = new Set();
        for (const candidate of candidates) {
            if (!/SEARCH\s*:/i.test(candidate) || !/REPLACE\s*:/i.test(candidate)) continue;
            const defaultFile = inferResponseFileName(candidate, fallbackFileName, userPrompt);
            const re = /(?:\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:\s*([^\]\n]+))?\]\s*)?SEARCH\s*:\s*([\s\S]*?)\s*REPLACE\s*:\s*([\s\S]*?)(?=\n\s*\[(?:EDIT|EDIT_FILE|FILE_EDIT)(?:\s*:|\])|\n\s*SEARCH\s*:|\s*\[\/(?:EDIT|EDIT_FILE|FILE_EDIT)\]|$)/gi;
            let match;
            while ((match = re.exec(candidate)) !== null) {
                const fileName = normalizeText(match[1] || defaultFile).replace(/^['"]|['"]$/g, '') || fallbackFileName;
                const search = cleanPatchPart(match[2] || '');
                const replace = cleanPatchPart(match[3] || '');
                if (!search && !replace) continue;
                const key = `${fileName}\n${search}\n${replace}`;
                if (seen.has(key)) continue;
                seen.add(key);
                blocks.push({ fileName, search, replace, kind: 'search-replace' });
            }
        }
        return blocks;
    }

    function parseFullFileBlocks(text = '', fallbackFileName = 'index.html', userPrompt = '') {
        const source = normalizeNewlines(text);
        const blocks = [];
        const re = /```([^\n`]*)\n([\s\S]*?)```/g;
        let match;
        while ((match = re.exec(source)) !== null) {
            const info = normalizeText(match[1] || '');
            const content = normalizeText(match[2] || '');
            if (!content || /SEARCH\s*:/i.test(content) && /REPLACE\s*:/i.test(content)) continue;

            const infoFile = info.match(/\b(?:file(?:name)?|path|name)\s*=?\s*['"]?([^'"\s`]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))['"]?/i)?.[1]
                || info.match(/\b([^\s`]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))\b/i)?.[1]
                || inferResponseFileName(source, fallbackFileName, userPrompt);

            const looksWhole = /^\s*<!doctype html/i.test(content)
                || /^\s*<html[\s>]/i.test(content)
                || /\bfunction\s+[A-Za-z_$][\w$]*\s*\(/.test(content)
                || /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(content)
                || /[.#]?[A-Za-z0-9_-]+\s*\{[\s\S]*\}/.test(content);

            if (looksWhole) blocks.push({ fileName: normalizeText(infoFile || fallbackFileName), content, kind: 'full-file' });
        }
        return blocks;
    }

    function findCollapsedWhitespaceRange(content = '', search = '') {
        const source = normalizeNewlines(content);
        const target = collapseWhitespace(search);
        if (!target) return null;

        for (let start = 0; start < source.length; start += 1) {
            while (start < source.length && /\s/.test(source[start])) start += 1;
            let normalized = '';
            let lastSpace = false;
            for (let end = start; end < source.length; end += 1) {
                const ch = source[end];
                if (/\s/.test(ch)) {
                    if (!lastSpace) normalized += ' ';
                    lastSpace = true;
                } else {
                    normalized += ch;
                    lastSpace = false;
                }

                const partial = normalized.trim();
                if (partial === target) return { start, end: end + 1 };
                if (partial.length > 32 && !target.startsWith(partial)) break;
                if (partial.length > target.length + 8) break;
            }
        }
        return null;
    }

    function extractFunctionName(value = '') {
        const source = normalizeNewlines(value);
        return source.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)?.[1]
            || source.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/)?.[1]
            || '';
    }

    function findBalancedBraceRange(source = '', openBraceIndex = -1) {
        if (openBraceIndex < 0) return null;
        let depth = 0;
        let quote = '';
        let escaped = false;
        let lineComment = false;
        let blockComment = false;

        for (let i = openBraceIndex; i < source.length; i += 1) {
            const ch = source[i];
            const next = source[i + 1];

            if (lineComment) {
                if (ch === '\n') lineComment = false;
                continue;
            }
            if (blockComment) {
                if (ch === '*' && next === '/') {
                    blockComment = false;
                    i += 1;
                }
                continue;
            }
            if (quote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === quote) quote = '';
                continue;
            }

            if (ch === '/' && next === '/') {
                lineComment = true;
                i += 1;
                continue;
            }
            if (ch === '/' && next === '*') {
                blockComment = true;
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
                continue;
            }
            if (ch === '{') depth += 1;
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) return { start: openBraceIndex, end: i + 1 };
            }
        }
        return null;
    }

    function findFunctionRange(content = '', functionName = '') {
        const source = normalizeNewlines(content);
        const name = normalizeText(functionName);
        if (!name) return null;

        const patterns = [
            new RegExp(`\\bfunction\\s+${escapeRegex(name)}\\s*\\(`, 'm'),
            new RegExp(`\\b(?:const|let|var)\\s+${escapeRegex(name)}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`, 'm')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(source);
            if (!match) continue;
            const start = match.index;
            const openBrace = source.indexOf('{', start);
            const range = findBalancedBraceRange(source, openBrace);
            if (!range) continue;
            let end = range.end;
            while (source[end] === ';') end += 1;
            return { start, end };
        }
        return null;
    }

    function extractCssSelector(value = '') {
        const source = normalizeNewlines(value).trim();
        return source.match(/^([^{}@][^{]+)\s*\{/)?.[1]?.trim() || '';
    }

    function findCssRange(content = '', selector = '') {
        const source = normalizeNewlines(content);
        const clean = normalizeText(selector);
        if (!clean) return null;
        const selectorIndex = source.indexOf(clean);
        if (selectorIndex < 0) return null;
        const openBrace = source.indexOf('{', selectorIndex);
        const range = findBalancedBraceRange(source, openBrace);
        if (!range) return null;
        return { start: selectorIndex, end: range.end };
    }

    function looksLikeWholeFile(fileName = '', content = '') {
        const ext = normalizeText(fileName).split('.').pop()?.toLowerCase();
        const body = normalizeNewlines(content).trim();
        if (!body) return false;
        if (ext === 'html' || ext === 'htm') return /^<!doctype html/i.test(body) || /^<html[\s>]/i.test(body) || /<body[\s>]/i.test(body);
        if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return body.length > 120 && /\b(function|const|let|var|class|import|export)\b/.test(body);
        if (ext === 'css') return body.length > 40 && /\{[\s\S]*\}/.test(body);
        return body.length > 20;
    }

    function applyPatchToContent(content = '', fileName = '', search = '', replace = '') {
        const current = normalizeNewlines(content);
        const rawSearch = normalizeNewlines(search);
        const rawReplace = normalizeNewlines(replace);

        if (!rawSearch.trim()) {
            return { ok: true, content: rawReplace, method: 'empty-search-full-replace' };
        }

        if (current.includes(rawSearch)) {
            return { ok: true, content: current.replace(rawSearch, rawReplace), method: 'exact' };
        }

        const collapsedRange = findCollapsedWhitespaceRange(current, rawSearch);
        if (collapsedRange) {
            return {
                ok: true,
                content: `${current.slice(0, collapsedRange.start)}${rawReplace}${current.slice(collapsedRange.end)}`,
                method: 'whitespace-normalized'
            };
        }

        const functionName = extractFunctionName(rawSearch) || extractFunctionName(rawReplace);
        const functionRange = findFunctionRange(current, functionName);
        if (functionName && functionRange) {
            return {
                ok: true,
                content: `${current.slice(0, functionRange.start)}${rawReplace}${current.slice(functionRange.end)}`,
                method: `function:${functionName}`
            };
        }

        const selector = extractCssSelector(rawSearch) || extractCssSelector(rawReplace);
        const cssRange = findCssRange(current, selector);
        if (selector && cssRange) {
            return {
                ok: true,
                content: `${current.slice(0, cssRange.start)}${rawReplace}${current.slice(cssRange.end)}`,
                method: `css:${selector}`
            };
        }

        if (looksLikeWholeFile(fileName, rawReplace) && rawReplace.length > current.length * 0.5) {
            return { ok: true, content: rawReplace, method: 'whole-file-replace-fallback' };
        }

        return { ok: false, content: current, method: 'no-match' };
    }

    async function applyEditBlocks(blocks = [], originalText = '', userPrompt = '') {
        const baseTarget = lastResolvedTarget || await resolveTarget(userPrompt || '');
        const result = {
            handled: blocks.length > 0,
            workshopFileRewriteAttempted: blocks.length > 0,
            workshopFileRewriteSucceeded: false,
            appliedFiles: []
        };

        for (const block of blocks) {
            const targetFileName = normalizeText(block.fileName || baseTarget.fileName || extractPromptFileName(userPrompt) || 'index.html');
            const targetGameId = normalizeText(baseTarget.gameId || window.lastPlayedGameId || '');
            if (!targetGameId || !targetFileName) continue;

            await switchWorkshopTarget(targetGameId, targetFileName);
            const state = getCurrentEditorState();
            const current = readWorkshopFile(targetGameId, targetFileName, state);

            let next = '';
            let method = '';
            if (block.kind === 'full-file') {
                next = normalizeNewlines(block.content || '');
                method = 'full-file-code-block';
            } else {
                const patched = applyPatchToContent(current, targetFileName, block.search || '', block.replace || '');
                if (!patched.ok) {
                    if (window.showFeedback) window.showFeedback(`AI edit did not match ${targetFileName}.`, true);
                    continue;
                }
                next = patched.content;
                method = patched.method;
            }

            const saveResult = await saveWorkshopFile(targetGameId, targetFileName, next);
            if (saveResult?.ok !== false) {
                result.workshopFileRewriteSucceeded = true;
                result.appliedFiles.push({ fileName: targetFileName, method });
                buildSnapshot({ ...baseTarget, fileName: targetFileName }, getCurrentEditorState());
                if (window.showFeedback) window.showFeedback(`Saved AI edit to ${targetFileName}.`, false);
            } else if (window.showFeedback) {
                window.showFeedback(saveResult?.message || `Failed to save ${targetFileName}.`, true);
            }
        }

        return result;
    }

    async function handleResponse(text, options = {}) {
        const userPrompt = options.userPrompt || lastResolvedTarget?.prompt || '';
        const baseFileName = extractPromptFileName(userPrompt)
            || lastResolvedTarget?.fileName
            || normalizeText(getCurrentEditorState()?.activeFileName || 'index.html');

        const structured = typeof window.extractWorkshopEditBlocks === 'function'
            ? window.extractWorkshopEditBlocks(text)
            : [];
        const rawBlocks = parseSearchReplaceBlocks(text, baseFileName, userPrompt);
        const editBlocks = structured.length > 0 ? structured.map((block) => ({
            fileName: block.fileName || baseFileName,
            search: block.search || '',
            replace: block.replace || '',
            kind: 'search-replace'
        })) : rawBlocks;

        if (editBlocks.length > 0) {
            return await applyEditBlocks(editBlocks, text, userPrompt);
        }

        const fullFileBlocks = parseFullFileBlocks(text, baseFileName, userPrompt);
        if (fullFileBlocks.length > 0) {
            return await applyEditBlocks(fullFileBlocks, text, userPrompt);
        }

        if (typeof window.tryAutoWorkshopFileRewriteFromReply === 'function') {
            const fallback = await window.tryAutoWorkshopFileRewriteFromReply(text, userPrompt);
            if (fallback?.attempted) {
                return {
                    handled: true,
                    workshopFileRewriteAttempted: true,
                    workshopFileRewriteSucceeded: !!fallback.ok
                };
            }
        }

        return {
            handled: false,
            workshopFileRewriteAttempted: false,
            workshopFileRewriteSucceeded: false
        };
    }

    window.ArcadeCommandManager.register({
        id: COMMAND_ID,
        description: 'Edit a targeted Workshop file using the active Workshop/Supabase editor state.',

        execute: async (args, inputElement) => {
            const prompt = normalizeText(args);
            window.activeArcadeCommandMode = '/edit';

            if (isUnsafeSteamComingSoonPublishPrompt(prompt)) {
                const message = 'Blocked: Steam Coming Soon titles cannot be auto-published, approved, featured, or recommended. Put them in needs_review and require manual approval.';
                window.activeArcadeCommandMode = null;
                if (typeof window.showFeedback === 'function') window.showFeedback(message, true);
                if (typeof window.addChatMessage === 'function') window.addChatMessage('ai', `⚠️ ${message}`);
                return true;
            }

            try {
                const target = await resolveTarget(prompt);
                const snapshot = window.__activeWorkshopEditorContext;
                if (snapshot?.activeFileContent && getEditorElement()) {
                    setEditorDomContent(snapshot.activeFileContent);
                }
                console.log(`[Command: Edit] Target resolved: ${target.gameTitle || target.gameId || 'current game'} / ${target.fileName}`);
            } catch (error) {
                console.error('[Command: Edit] Failed to resolve target:', error);
            }

            if (inputElement && !inputElement.value.trim()) {
                inputElement.value = prompt ? `/edit ${prompt}` : '/edit';
            }

            return false;
        },

        getSuggestions: (args = '') => {
            const prompt = normalizeText(args).toLowerCase();
            const games = getManageableGames();
            if (games.length === 0) return [];

            const titleMatch = games.find((game) => prompt.startsWith(gameTitle(game).toLowerCase()));
            if (titleMatch) {
                return gameFiles(titleMatch).map((file) => ({
                    id: `${gameTitle(titleMatch)} ${file.name || file.fileName}`,
                    name: file.name || file.fileName,
                    description: `Edit ${file.name || file.fileName} in ${gameTitle(titleMatch)}`
                }));
            }

            return games
                .filter((game) => !prompt || gameTitle(game).toLowerCase().includes(prompt))
                .map((game) => ({
                    id: gameTitle(game),
                    name: gameTitle(game),
                    description: `Edit files in ${gameTitle(game)}`
                }));
        },

        handleResponse
    });
})();
