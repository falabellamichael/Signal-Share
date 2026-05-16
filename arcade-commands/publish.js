/**
 * /publish Command
 * Handles Workshop Arcade publish actions from the Arcade chat.
 */
(function() {
    const RANDOM_IDEAS = [
        'a random creative mini-game with a unique theme',
        'a game like asteroids but with a twist',
        'a paper-sketch style platformer game',
        'a neon-themed puzzle game',
        'a lo-fi pixel art farming game',
        'a one-button arcade survival game',
        'a quick clicker challenge with upgrades'
    ];

    const PUBLISH_LOCK_TTL_MS = 2 * 60 * 1000;
    const PUBLISH_LOCK_NAMESPACE = '__arcadePublishCommandLocks';
    let lastPublishPrompt = '';
    let lastPublishTurnId = '';

    function getPublishLocks() {
        if (!window[PUBLISH_LOCK_NAMESPACE]) {
            window[PUBLISH_LOCK_NAMESPACE] = {
                inFlight: new Map(),
                completed: new Map()
            };
        }
        return window[PUBLISH_LOCK_NAMESPACE];
    }

    function prunePublishLocks() {
        const locks = getPublishLocks();
        const now = Date.now();
        for (const [key, value] of locks.inFlight.entries()) {
            if (now - Number(value?.at || 0) > PUBLISH_LOCK_TTL_MS) locks.inFlight.delete(key);
        }
        for (const [key, value] of locks.completed.entries()) {
            if (now - Number(value?.at || 0) > PUBLISH_LOCK_TTL_MS) locks.completed.delete(key);
        }
    }

    function hashText(value = '') {
        const text = `${value || ''}`;
        let hash = 5381;
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    }

    function makePublishKey(userPrompt = '', responseText = '') {
        const prompt = normalize(userPrompt || lastPublishPrompt || '').toLowerCase();
        const responseHash = hashText(responseText || '');
        return `${lastPublishTurnId || 'publish'}::${prompt}::${responseHash}`;
    }

    function tryAcquirePublishLock(key = '') {
        prunePublishLocks();
        const locks = getPublishLocks();
        if (!key) return { ok: false, reason: 'missing-key' };
        if (locks.inFlight.has(key)) return { ok: false, reason: 'in-flight' };
        if (locks.completed.has(key)) return { ok: false, reason: 'completed' };
        locks.inFlight.set(key, { at: Date.now() });
        return { ok: true };
    }

    function completePublishLock(key = '', data = {}) {
        if (!key) return;
        const locks = getPublishLocks();
        locks.inFlight.delete(key);
        locks.completed.set(key, { at: Date.now(), ...data });
    }

    function releasePublishLock(key = '') {
        if (!key) return;
        getPublishLocks().inFlight.delete(key);
    }

    function clearPublishMode() {
        window.activeArcadeCommandMode = null;
        window.activeArcadeCommandModes = Array.isArray(window.activeArcadeCommandModes)
            ? window.activeArcadeCommandModes.filter(mode => mode !== '/publish')
            : [];
    }

    function showPublishFeedback(message, isError = false) {
        if (!message) return;
        if (typeof window.showFeedback === 'function') {
            window.showFeedback(message, isError);
            return;
        }
        if (typeof window.addChatMessage === 'function') {
            window.addChatMessage('ai', isError ? `⚠️ ${message}` : message);
        }
    }

    function normalize(value = '') {
        return `${value || ''}`.trim();
    }

    function inferTypeFromName(name = '', fallback = 'html') {
        const lower = normalize(name).toLowerCase();
        if (/\.html?$/.test(lower)) return 'html';
        if (/\.css$/.test(lower)) return 'css';
        if (/\.(?:js|mjs|cjs)$/.test(lower)) return 'javascript';
        if (/\.json$/.test(lower)) return 'json';
        if (/\.svg$/.test(lower)) return 'svg';
        if (/\.txt$/.test(lower)) return 'text';
        return fallback || 'text';
    }

    function sanitizeFileName(name = '', fallback = 'index.html') {
        const clean = normalize(name).replace(/[\\/]+/g, '_').replace(/^[']|[']$/g, '').replace(/^["]|["]$/g, '');
        return clean || fallback;
    }

    function fileNameFromFenceInfo(info = '', index = 0, lang = '') {
        const text = normalize(info);
        const explicit = text.match(/\b(?:filename|file|name|path)\s*=\s*["']?([^"'\s`]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))\b/i)?.[1]
            || text.match(/\b([a-z0-9][\w.-]*\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml))\b/i)?.[1]
            || '';
        if (explicit) return sanitizeFileName(explicit);
        if (index === 0) return 'index.html';
        const ext = inferTypeFromName('', lang).replace('javascript', 'js').replace('text', 'txt');
        return `file_${index}.${ext}`;
    }

    function extractWorkshopFiles(text = '') {
        if (typeof window.buildAiWorkshopFilesFromText === 'function') {
            const files = window.buildAiWorkshopFilesFromText(text);
            if (Array.isArray(files) && files.length > 0) {
                return files
                    .map((file, index) => ({
                        name: sanitizeFileName(file.name, index === 0 ? 'index.html' : `file_${index}.txt`),
                        type: file.type || inferTypeFromName(file.name),
                        content: normalize(file.content || file.code || '')
                    }))
                    .filter(file => file.content);
            }
        }

        const files = [];
        const codeBlockRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const info = normalize(match[1] || '');
            const content = normalize(match[2] || '');
            if (!content) continue;
            const lang = info.split(/\s+/)[0] || inferTypeFromName('', 'text');
            const filename = fileNameFromFenceInfo(info, files.length, lang);
            let cleanedContent = content;
            if (/\.(?:js|mjs|cjs)$/i.test(filename) || /^(?:javascript|js)$/i.test(lang)) {
                cleanedContent = cleanedContent.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
            }
            files.push({
                name: filename,
                type: inferTypeFromName(filename, lang),
                content: cleanedContent
            });
        }
        return files;
    }

    function looksPublishable(files = []) {
        if (!Array.isArray(files) || files.length === 0) return false;
        const index = files.find(file => /^index\.html?$/i.test(file.name)) || files[0];
        const content = `${index?.content || ''}`.trim();
        if (!content) return false;
        if (/\.html?$/i.test(index.name)) return /<!doctype html|<html[\s>]|<body[\s>]|<canvas\b|<script\b/i.test(content);
        return /\b(function|const|let|var|class|document\.|window\.|addEventListener)\b/.test(content);
    }

    function inferTitleFromPrompt(userPrompt = '') {
        const text = normalize(userPrompt).replace(/^\/publish\b/i, '').trim();
        const quoted = text.match(/["'`]([^"'`\n]{2,80})["'`]/)?.[1];
        if (quoted) return quoted.trim();
        const called = text.match(/\b(?:called|named|titled)\s+([^.,\n]{2,80})/i)?.[1];
        if (called) return called.trim();
        const withoutSubcommand = text.replace(/^(?:random|game|demo|puzzle|arcade|utility|from editor|update current)\b/i, '').trim();
        if (withoutSubcommand.length >= 3 && withoutSubcommand.length <= 48) {
            return withoutSubcommand.replace(/^a\s+/i, '').trim();
        }
        return 'AI Generated Game';
    }

    function buildPromptFromSubcommand(args = '') {
        const text = normalize(args);
        if (!text || /^random\b/i.test(text)) {
            return RANDOM_IDEAS[Math.floor(Math.random() * RANDOM_IDEAS.length)];
        }
        if (/^demo\b/i.test(text)) return `a small polished playable demo: ${text.replace(/^demo\b/i, '').trim() || 'arcade prototype'}`;
        if (/^puzzle\b/i.test(text)) return `a puzzle arcade game: ${text.replace(/^puzzle\b/i, '').trim() || 'clever grid challenge'}`;
        if (/^arcade\b/i.test(text)) return `a fast arcade game: ${text.replace(/^arcade\b/i, '').trim() || 'score attack challenge'}`;
        if (/^utility\b/i.test(text)) return `a useful browser utility app: ${text.replace(/^utility\b/i, '').trim() || 'simple productivity tool'}`;
        if (/^game\b/i.test(text)) return text.replace(/^game\b/i, '').trim() || RANDOM_IDEAS[0];
        return text;
    }

    window.ArcadeCommandManager.register({
        id: 'publish',
        description: 'Generate and publish a new Workshop game/app.',

        execute: async (args, inputElement) => {
            const prompt = buildPromptFromSubcommand(args);

            if (!prompt) {
                showPublishFeedback('Tell me what to publish, or use /publish random.', true);
                if (inputElement) inputElement.value = '';
                return true;
            }

            lastPublishPrompt = `/publish ${prompt}`;
            lastPublishTurnId = `publish-${Date.now()}-${hashText(lastPublishPrompt)}`;
            window.__arcadeActivePublishTurnId = lastPublishTurnId;

            window.activeArcadeCommandMode = '/publish';
            window.activeArcadeCommandModes = Array.isArray(window.activeArcadeCommandModes)
                ? Array.from(new Set([...window.activeArcadeCommandModes, '/publish']))
                : ['/publish'];

            if (inputElement) {
                inputElement.value = lastPublishPrompt;
            }
            return false;
        },

        getSuggestions: (args = '') => {
            const prompt = normalize(args).toLowerCase();
            return [
                { id: 'random', name: 'random', description: 'Generate and publish a random playable mini-game.' },
                { id: 'game', name: 'game', description: 'Publish a new game from a prompt.' },
                { id: 'demo', name: 'demo', description: 'Publish a polished demo/prototype.' },
                { id: 'puzzle', name: 'puzzle', description: 'Publish a puzzle game.' },
                { id: 'arcade', name: 'arcade', description: 'Publish a fast arcade-style game.' },
                { id: 'utility', name: 'utility', description: 'Publish a useful browser app/tool.' }
            ].filter(item => !prompt || `${item.id} ${item.description}`.toLowerCase().includes(prompt));
        },

        handleResponse: async (text, options = {}) => {
            const actionResult = {
                handled: false,
                publishTagDetected: /\[PUBLISH/i.test(text),
                workshopPublishAttempted: false,
                workshopPublishSucceeded: false,
                publishSkippedDuplicate: false,
                requiresRetry: false,
                retryPrompt: '',
                errorReason: null
            };

            const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
            if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);
            const userPrompt = options.userPrompt || lastPublishPrompt || '';
            const publishIntent = modes.has('/publish') || /^\s*\/publish\b/i.test(userPrompt) || actionResult.publishTagDetected;
            if (!publishIntent) return actionResult;

            actionResult.handled = true;
            const publishKey = makePublishKey(userPrompt, text);
            const lock = tryAcquirePublishLock(publishKey);
            if (!lock.ok) {
                actionResult.publishSkippedDuplicate = true;
                actionResult.errorReason = `Duplicate publish ignored (${lock.reason}).`;
                clearPublishMode();
                return actionResult;
            }

            // Clear the mode before the async publish call so a second response/action pass cannot also publish.
            clearPublishMode();
            actionResult.workshopPublishAttempted = true;

            if (typeof window.publishCustomGameFromAi !== 'function') {
                const message = 'Workshop publishing is unavailable in this environment.';
                showPublishFeedback(message, true);
                actionResult.errorReason = message;
                releasePublishLock(publishKey);
                return actionResult;
            }

            const workshopFiles = extractWorkshopFiles(text);
            if (!looksPublishable(workshopFiles)) {
                actionResult.requiresRetry = true;
                actionResult.retryPrompt = [
                    '[WORKSHOP_PUBLISH_RETRY]',
                    'Return a complete playable browser game now.',
                    'Use fenced code blocks with filenames.',
                    'Required: ```html filename=index.html ... ```',
                    'Optional: ```css filename=styles.css ... ``` and ```javascript filename=game.js ... ```',
                    'Do not return a plan, audit, summary, or prose-only response.',
                    `Original request: ${userPrompt}`
                ].join('\n');
                actionResult.errorReason = 'AI did not return publishable game files.';
                releasePublishLock(publishKey);
                return actionResult;
            }

            const title = inferTitleFromPrompt(userPrompt);
            const publishPayload = {
                title,
                category: 'GAME',
                description: `Published via /publish command.\nPrompt: ${userPrompt}`,
                thumbnail: '',
                tags: 'arcade, ai',
                files: workshopFiles,
                mode: 'create',
                gameId: '',
                updateTitle: '',
                publishTurnId: lastPublishTurnId || window.__arcadeActivePublishTurnId || ''
            };

            try {
                const workshopResult = await window.publishCustomGameFromAi(publishPayload);
                if (workshopResult?.ok) {
                    actionResult.workshopPublishSucceeded = true;
                    completePublishLock(publishKey, { id: workshopResult.id || '', title: workshopResult.title || title });
                    showPublishFeedback(`Published "${workshopResult.title || title}" in Workshop!`);
                    if (typeof window.setWorkshopEditActiveGame === 'function' && workshopResult.id) {
                        setTimeout(() => window.setWorkshopEditActiveGame(workshopResult.id), 800);
                    }
                } else {
                    const message = workshopResult?.message || 'Failed to publish game to Workshop.';
                    actionResult.errorReason = message;
                    showPublishFeedback(message, true);
                    releasePublishLock(publishKey);
                }
            } catch (error) {
                console.error('[Arcade: Publish] Critical system failure:', error);
                actionResult.errorReason = error?.message || 'Critical upload error.';
                showPublishFeedback(actionResult.errorReason, true);
                releasePublishLock(publishKey);
            }

            return actionResult;
        }
    });
})();