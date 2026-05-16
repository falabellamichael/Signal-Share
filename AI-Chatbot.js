/**
 * Signal Share AI Chatbot Support Layer
 *
 * This file does not replace the real local AI model. It prepares compact,
 * editor-aware context so the model can spend GPU/VRAM on writing code instead
 * of rediscovering files, targets, and project rules.
 */
(function installAiChatbotSupport(global) {
    if (global.AIChatbotSupport) return;

    const SUPPORT_VERSION = '1.0';
    const MAX_ACTIVE_FILE_CHARS = 18000;
    const MAX_SIDE_FILE_CHARS = 2600;
    const MAX_SUPPORT_CONTEXT_CHARS = 30000;
    const MAX_FILE_INVENTORY = 18;
    const MAX_RELEVANT_SIDE_FILES = 6;

    function text(value = '') {
        return value === null || value === undefined ? '' : `${value}`;
    }

    function clean(value = '') {
        return text(value).trim();
    }

    function truncateMiddle(value = '', maxChars = 12000) {
        const source = text(value);
        const limit = Math.max(500, Number(maxChars) || 12000);
        if (source.length <= limit) return source;
        const head = Math.max(300, Math.floor(limit * 0.62));
        const tail = Math.max(220, limit - head - 140);
        return `${source.slice(0, head)}\n\n[...AI_CHATBOT_SUPPORT_TRIMMED_${source.length - head - tail}_CHARS...]\n\n${source.slice(-tail)}`;
    }

    function byteLength(value = '') {
        return new Blob([text(value)]).size;
    }

    function decodeDataUrlContent(value = '') {
        const raw = text(value);
        if (!raw.startsWith('data:')) return raw;
        const comma = raw.indexOf(',');
        if (comma < 0) return '';
        const meta = raw.slice(0, comma).toLowerCase();
        const payload = raw.slice(comma + 1);
        try {
            if (meta.includes(';base64')) {
                return decodeURIComponent(escape(atob(payload)));
            }
            return decodeURIComponent(payload);
        } catch (_error) {
            try {
                return atob(payload);
            } catch (_secondError) {
                return '';
            }
        }
    }

    function inferLanguage(fileName = '', type = '') {
        const lower = `${fileName || ''}`.toLowerCase();
        const mime = `${type || ''}`.toLowerCase();
        if (/\.html?$/.test(lower) || mime.includes('html')) return 'html';
        if (/\.css$/.test(lower) || mime.includes('css')) return 'css';
        if (/\.(?:js|mjs|cjs)$/.test(lower) || mime.includes('javascript')) return 'javascript';
        if (/\.json$/.test(lower) || mime.includes('json')) return 'json';
        if (/\.svg$/.test(lower) || mime.includes('svg')) return 'xml';
        if (/\.xml$/.test(lower) || mime.includes('xml')) return 'xml';
        return 'text';
    }

    function normalizeFileName(value = '') {
        return clean(value).replace(/[\\/]+/g, '_');
    }

    function getWorkshopEditorState() {
        if (typeof global.getWorkshopEditorState !== 'function') return null;
        try {
            return global.getWorkshopEditorState();
        } catch (_error) {
            return null;
        }
    }

    function getManageableGames() {
        if (typeof global.getWorkshopManageableGames !== 'function') return [];
        try {
            const games = global.getWorkshopManageableGames();
            return Array.isArray(games) ? games : [];
        } catch (_error) {
            return [];
        }
    }

    function getActiveGame(editorState = null) {
        const state = editorState || getWorkshopEditorState() || {};
        const gameId = clean(state.activeGameId || state.gameId || '');
        if (!gameId) return null;
        return getManageableGames().find((game) => `${game?.id || ''}` === gameId) || null;
    }

    function getFileContent(file = null) {
        if (!file || typeof file !== 'object') return '';
        return decodeDataUrlContent(file.content || file.code || '');
    }

    function getEditorTextareaContent() {
        const editor = global.document?.getElementById('workshop-edit-file-content');
        if (!editor) return '';
        if (typeof editor.value === 'string') return editor.value;
        return text(editor.textContent || '');
    }

    function getActiveFileContent(editorState = null, activeGame = null) {
        const textareaContent = getEditorTextareaContent();
        if (textareaContent) return textareaContent;

        const state = editorState || getWorkshopEditorState() || {};
        const stateContent = text(state.activeFileContent || state.content || '');
        if (stateContent) return stateContent;

        const activeFileName = clean(state.activeFileName || state.fileName || '');
        const game = activeGame || getActiveGame(state);
        const files = Array.isArray(game?.files) ? game.files : [];
        const activeFile = files.find((file) => clean(file?.name || file?.fileName) === activeFileName) || null;
        return getFileContent(activeFile);
    }

    function getGameFiles(game = null) {
        const files = Array.isArray(game?.files) ? game.files : [];
        return files
            .filter((file) => file && typeof file === 'object')
            .map((file) => ({
                ...file,
                name: normalizeFileName(file.name || file.fileName || 'file.txt'),
                type: clean(file.type || '')
            }));
    }

    function extractHtmlReferences(source = '') {
        const html = text(source);
        const refs = new Set();
        const patterns = [
            /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
            /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
            /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
        ];
        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(html)) !== null) {
                const ref = clean(match[1] || '').split(/[?#]/)[0];
                if (ref && !/^https?:\/\//i.test(ref) && !/^data:/i.test(ref)) refs.add(ref.replace(/^\.\//, ''));
            }
        }
        return Array.from(refs);
    }

    function extractCodeSymbols(source = '', language = '') {
        const code = text(source);
        const symbols = new Set();
        const addMatches = (regex) => {
            let match;
            while ((match = regex.exec(code)) !== null) {
                if (match[1]) symbols.add(match[1]);
            }
        };

        if (language === 'javascript' || /\b(function|const|let|var|class)\b/.test(code)) {
            addMatches(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g);
            addMatches(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g);
            addMatches(/\bclass\s+([A-Za-z_$][\w$]*)\b/g);
            addMatches(/\.addEventListener\s*\(\s*["']([^"']+)/g);
        }

        if (language === 'html' || /<\w+/.test(code)) {
            addMatches(/\bid=["']([^"']+)["']/g);
            addMatches(/\bclass=["']([^"']+)["']/g);
        }

        if (language === 'css' || /\{[\s\S]*\}/.test(code)) {
            addMatches(/(^|\n)\s*([.#][A-Za-z0-9_-]+)/g);
        }

        return Array.from(symbols).slice(0, 28);
    }

    function summarizeFile(file = null, options = {}) {
        const name = normalizeFileName(file?.name || file?.fileName || options.name || 'file.txt');
        const type = clean(file?.type || options.type || '');
        const language = inferLanguage(name, type);
        const content = options.content !== undefined ? text(options.content) : getFileContent(file);
        const refs = language === 'html' ? extractHtmlReferences(content) : [];
        const symbols = extractCodeSymbols(content, language);
        return {
            name,
            type: type || language,
            language,
            chars: content.length,
            bytes: byteLength(content),
            references: refs,
            symbols,
            preview: truncateMiddle(content, options.maxChars || MAX_SIDE_FILE_CHARS)
        };
    }

    function mentionedFileNames(prompt = '', files = []) {
        const lowerPrompt = text(prompt).toLowerCase();
        return files
            .map((file) => normalizeFileName(file.name || file.fileName || ''))
            .filter((name) => name && lowerPrompt.includes(name.toLowerCase()));
    }

    function selectRelevantFiles(prompt = '', activeFileName = '', activeContent = '', files = []) {
        const activeLower = activeFileName.toLowerCase();
        const mentioned = new Set(mentionedFileNames(prompt, files).map((name) => name.toLowerCase()));
        const htmlRefs = new Set(extractHtmlReferences(activeContent).map((name) => name.toLowerCase()));
        const coreNames = new Set(['index.html', 'styles.css', 'style.css', 'game.js', 'script.js', 'main.js', 'app.js']);

        const scored = files.map((file) => {
            const name = normalizeFileName(file.name || file.fileName || '');
            const lower = name.toLowerCase();
            let score = 0;
            if (lower === activeLower) score += 100;
            if (mentioned.has(lower)) score += 60;
            if (htmlRefs.has(lower)) score += 40;
            if (coreNames.has(lower)) score += 20;
            if (/\.(?:html?|css|js)$/i.test(lower)) score += 6;
            if (/\b(?:css|style|visual|design|color|layout)\b/i.test(prompt) && /\.css$/i.test(lower)) score += 18;
            if (/\b(?:script|logic|bug|function|click|score|timer|javascript|js)\b/i.test(prompt) && /\.js$/i.test(lower)) score += 18;
            return { file, score, name };
        });

        return scored
            .filter((row) => row.score > 0 && row.name.toLowerCase() !== activeLower)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RELEVANT_SIDE_FILES)
            .map((row) => row.file);
    }

    function isAddFileRequest(prompt = '') {
        return /\b(?:add|create|make|generate)\s+(?:a\s+|new\s+|another\s+)?file\b/i.test(prompt)
            || /\b(?:add|create|make|generate)\s+[^\s]+\.(?:html?|css|js|mjs|cjs|json|svg|txt|xml)\b/i.test(prompt);
    }

    function buildOutputContract(prompt = '', activeFileName = '') {
        if (isAddFileRequest(prompt)) {
            return [
                'OUTPUT CONTRACT FOR ADD-FILE REQUEST:',
                '- Return one or more fenced code blocks only.',
                '- Every code block must include filename=<name.ext> in the fence header.',
                '- Example: ```css filename=styles.css',
                '- Do not rewrite index.html unless the user explicitly asks to change it.',
                '- Keep new files self-contained and compatible with the existing files.'
            ].join('\n');
        }

        const language = inferLanguage(activeFileName);
        return [
            'OUTPUT CONTRACT FOR EDIT REQUEST:',
            `- Return exactly one complete final code block for ${activeFileName || 'the active file'}.`,
            `- Fence header must be: \`\`\`${language} filename=${activeFileName || 'index.html'}`,
            '- No prose before or after the code block.',
            '- No SEARCH/REPLACE blocks.',
            '- No diff format.',
            '- Preserve existing external file references unless changing them is required.'
        ].join('\n');
    }

    function buildSuggestions(prompt = '', activeFileName = '', inventory = []) {
        const lower = text(prompt).toLowerCase();
        const suggestions = [];
        if (/\b(?:style|css|visual|layout|color|pretty|design)\b/.test(lower)) {
            suggestions.push('Prefer CSS-only changes when possible; avoid rewriting game logic.');
        }
        if (/\b(?:bug|fix|error|not working|crash|syntax)\b/.test(lower)) {
            suggestions.push('Find the smallest safe fix first; preserve public function names and event handlers.');
        }
        if (/\b(?:mobile|touch|android)\b/.test(lower)) {
            suggestions.push('Keep pointer/touch events mobile-safe; avoid heavy animation loops.');
        }
        if (/\b(?:performance|vram|gpu|lag|memory)\b/.test(lower)) {
            suggestions.push('Reduce DOM churn, large canvases, repeated gradients, unbounded arrays, and per-frame allocations.');
        }
        if (isAddFileRequest(prompt)) {
            suggestions.push('Create the new file only; the app will queue and save it through Workshop file tools.');
        }
        if (activeFileName) {
            suggestions.push(`Target file is ${activeFileName}; do not invent another active target.`);
        }
        if (inventory.length > 0) {
            suggestions.push('Use the file inventory instead of asking what files exist.');
        }
        return suggestions.slice(0, 8);
    }

    function buildSupportContext(userPrompt = '', richContext = {}, options = {}) {
        const prompt = text(userPrompt);
        const editorState = richContext?.workshopEditor || getWorkshopEditorState() || {};
        const activeGame = getActiveGame(editorState);
        const files = getGameFiles(activeGame);
        const activeFileName = normalizeFileName(editorState.activeFileName || editorState.fileName || 'index.html');
        const activeContent = getActiveFileContent(editorState, activeGame);
        const activeSummary = summarizeFile(
            { name: activeFileName, type: editorState.activeFileType || '', content: activeContent },
            { content: activeContent, maxChars: MAX_ACTIVE_FILE_CHARS }
        );
        const relevantFiles = selectRelevantFiles(prompt, activeFileName, activeContent, files);
        const relevantSummaries = relevantFiles.map((file) => summarizeFile(file, { maxChars: MAX_SIDE_FILE_CHARS }));
        const inventory = files.slice(0, MAX_FILE_INVENTORY).map((file) => {
            const name = normalizeFileName(file.name || file.fileName || '');
            const language = inferLanguage(name, file.type || '');
            const contentLength = getFileContent(file).length;
            return {
                name,
                language,
                chars: contentLength,
                active: name === activeFileName
            };
        });

        const payload = {
            version: SUPPORT_VERSION,
            role: 'VRAM/GPU support scaffold for the real local AI model',
            goal: 'Pre-read editor state, reduce context waste, and give the model direct implementation constraints.',
            request: prompt,
            activeGame: activeGame ? {
                id: clean(activeGame.id || ''),
                title: clean(activeGame.title || activeGame.name || '')
            } : null,
            activeFile: {
                name: activeFileName,
                language: activeSummary.language,
                chars: activeSummary.chars,
                symbols: activeSummary.symbols,
                references: activeSummary.references
            },
            fileInventory: inventory,
            relevantSideFiles: relevantSummaries.map((summary) => ({
                name: summary.name,
                language: summary.language,
                chars: summary.chars,
                symbols: summary.symbols,
                references: summary.references,
                preview: summary.preview
            })),
            modelHints: buildSuggestions(prompt, activeFileName, inventory),
            outputContract: buildOutputContract(prompt, activeFileName),
            vramPolicy: {
                history: 'Use only the latest relevant user request and the provided file context.',
                attachments: 'Ignore attachments for code edits unless the user explicitly asks about the attachment.',
                reasoning: 'Do not narrate reasoning; spend tokens on complete code.',
                codeReuse: 'Reuse existing functions, IDs, classes, and file names from the summaries.'
            }
        };

        const context = [
            '[AI_CHATBOT_SUPPORT_V1]',
            JSON.stringify(payload),
            '',
            `[ACTIVE_FILE_SOURCE: ${activeFileName}]`,
            `\`\`\`${activeSummary.language} filename=${activeFileName}`,
            activeSummary.preview,
            '```',
            '[/AI_CHATBOT_SUPPORT_V1]'
        ].join('\n');

        return truncateMiddle(context, options.maxChars || MAX_SUPPORT_CONTEXT_CHARS);
    }

    function optimizeChatPayload(payload = {}) {
        if (!payload || typeof payload !== 'object') return payload;
        const message = text(payload.message || '');
        const pageContext = text(payload.pageContext || '');
        const isEditorPayload = /^\/(?:edit|fix|rewrite)\b/i.test(message)
            || /DIRECT_EDITOR_WRITE_CONTEXT|ACTIVE_WORKSHOP_EDITOR|AI_CHATBOT_SUPPORT/i.test(pageContext)
            || /workshop editor/i.test(message);

        if (!isEditorPayload) return payload;

        const optimized = { ...payload };
        optimized.history = [];
        optimized.attachment = null;
        optimized.message = truncateMiddle(message, 3500);
        optimized.pageContext = truncateMiddle(pageContext, MAX_SUPPORT_CONTEXT_CHARS);
        optimized.customInstructions = [
            clean(payload.customInstructions || ''),
            'For code edits, rely on AI_CHATBOT_SUPPORT_V1 context. Do not ask for files that are already listed. Output only the required code block(s). Keep reasoning hidden and spend tokens on correct code.'
        ].filter(Boolean).join('\n\n').slice(0, 2400);
        optimized.aiChatbotSupport = true;
        optimized.vramOptimized = true;
        return optimized;
    }

    function inspect() {
        const state = getWorkshopEditorState() || {};
        const game = getActiveGame(state);
        const files = getGameFiles(game);
        return {
            version: SUPPORT_VERSION,
            activeGameId: clean(state.activeGameId || state.gameId || ''),
            activeFileName: clean(state.activeFileName || state.fileName || ''),
            fileCount: files.length,
            bridgeAware: true,
            vramOptimized: true
        };
    }

    global.AIChatbotSupport = {
        version: SUPPORT_VERSION,
        buildSupportContext,
        optimizeChatPayload,
        summarizeFile,
        inspect,
        truncateMiddle,
        isAddFileRequest
    };
})(window);
