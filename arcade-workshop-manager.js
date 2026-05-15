/**
 * Arcade Workshop Manager
 * Handles project publishing, code extraction, and workshop-specific logic.
 */
window.ArcadeWorkshopManager = {
    /**
     * Infers the MIME type for a given filename in the workshop context.
     */
    inferFileType: function(fileName) {
        const lower = `${fileName || ''}`.trim().toLowerCase();
        if (lower.endsWith('.html')) return 'text/html';
        if (lower.endsWith('.css')) return 'text/css';
        if (lower.endsWith('.js')) return 'text/javascript';
        if (lower.endsWith('.json')) return 'application/json';
        return 'text/plain';
    },

    /**
     * Checks if a string looks like executable browser code.
     */
    looksLikeExecutableCode: function(value) {
        const text = `${value || ''}`.trim();
        if (text.length < 80) return false;
        
        const markers = [
            'function ', 'const ', 'let ', 'var ', '=>',
            'document.', 'addEventListener', '<html', '<!doctype', 'return '
        ];
        
        let hitCount = 0;
        const lowerText = text.toLowerCase();
        for (const marker of markers) {
            if (lowerText.includes(marker)) hitCount++;
        }
        
        // Use a simple loop for structure hits instead of .match() to avoid large array overhead
        let structureHits = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{' || ch === '}' || ch === ';') {
                structureHits++;
                if (structureHits >= 20) break; // We have enough proof
            }
        }
        
        return hitCount >= 2 && structureHits >= 4;
    },

    /**
     * Infers the language (html, css, js, txt) based on code markers.
     */
    inferCodeKind: function(lang = '', code = '') {
        const language = `${lang || ''}`.trim().toLowerCase();
        const source = `${code || ''}`.trim();
        const lower = source.toLowerCase();
        if (language.includes('html')) return 'html';
        if (language.includes('css')) return 'css';
        if (language.includes('js') || language.includes('javascript') || language.includes('ts')) return 'js';
        if (lower.includes('<!doctype html') || lower.includes('<html')) return 'html';
        if (/^<style[\s>]/i.test(source) || /^[.#:a-z0-9_*@[\]-][^{\n]*\{[\s\S]*\}/i.test(source)) return 'css';
        if (this.looksLikeExecutableCode(source)) return 'js';
        return 'txt';
    },

    /**
     * Determines if a publish request should be routed to the workshop vs a standard post.
     */
    shouldRouteToWorkshop: function(data, rawReplyText, userPrompt) {
        const prompt = `${userPrompt || ''}`.toLowerCase();
        const reply = `${rawReplyText || ''}`.toLowerCase();
        
        // Explicit workshop keywords
        const workshopKeywords = ['workshop', 'arcade library', 'game library', 'mini-game', 'playable', 'publish game', 'upload game'];
        const hasKeyword = workshopKeywords.some(k => prompt.includes(k) || reply.includes(k));
        
        // Structural clues in payload
        const hasWorkshopTarget = data?.target === 'workshop' || data?.destination === 'workshop';
        const hasMultipleFiles = Array.isArray(data?.files) && data.files.length > 0;
        const hasEntrypoint = Array.isArray(data?.files) && data.files.some(f => f.name === 'index.html');
        
        return hasKeyword || hasWorkshopTarget || hasMultipleFiles || hasEntrypoint;
    },

    /**
     * Extracts files from a block of text using greedy regex and protocol fallbacks.
     */
    buildFilesFromText: function(rawText) {
        const files = [];
        const counters = { html: 0, css: 0, js: 0, txt: 0 };
        const nextName = (kind) => {
            counters[kind] += 1;
            if (kind === 'html') return counters[kind] === 1 ? 'index.html' : `view-${counters[kind]}.html`;
            if (kind === 'css') return counters[kind] === 1 ? 'styles.css' : `styles-${counters[kind]}.css`;
            if (kind === 'js') return counters[kind] === 1 ? 'game.js' : `game-${counters[kind]}.js`;
            return `snippet-${counters.txt}.txt`;
        };

        const sourceText = `${rawText || ''}`;
        
        // 1. Extract markdown code blocks
        const blocks = [];
        const blockRegex = /```([^\n`]*)\n([\s\S]*?)```/gi;
        let blockMatch;
        while ((blockMatch = blockRegex.exec(sourceText)) !== null) {
            const lang = `${blockMatch[1] || ''}`.trim().toLowerCase();
            const code = `${blockMatch[2] || ''}`.trim();
            if (code) blocks.push({ lang, code });
        }

        blocks.forEach(b => {
            const kind = this.inferCodeKind(b.lang, b.code);
            files.push({
                name: nextName(kind),
                type: kind === 'html' ? 'text/html' : kind === 'css' ? 'text/css' : kind === 'js' ? 'text/javascript' : 'text/plain',
                content: b.code
            });
        });

        if (files.length > 0) return files;

        // 2. Greedy Extraction for truncated JSON
        const contentMatches = sourceText.matchAll(/"(?:content|code)"\s*:\s*"([\s\S]*?)(?<!\\)"/g);
        for (const match of contentMatches) {
            const code = (window.decodeEscapedCodeText ? window.decodeEscapedCodeText(match[1]) : match[1]);
            if (this.looksLikeExecutableCode(code)) {
                const kind = this.inferCodeKind('', code);
                files.push({
                    name: nextName(kind),
                    type: kind === 'html' ? 'text/html' : kind === 'css' ? 'text/css' : kind === 'js' ? 'text/javascript' : 'text/plain',
                    content: code
                });
            }
        }

        if (files.length > 0) return files;

        // 3. Last Resort Fallback
        let fallback = sourceText.split(/\[PUBLISH:\s*/i)[0] || '';
        const codeStart = fallback.search(/<!doctype html|<html|(?:^|\n)\s*(?:function|const|let|var|class)\s+/i);
        if (codeStart >= 0) {
            fallback = fallback.slice(codeStart).trim();
            if (this.looksLikeExecutableCode(fallback)) {
                const isHtml = /<!doctype html|<html/i.test(fallback);
                files.push({
                    name: isHtml ? 'index.html' : 'game.js',
                    type: isHtml ? 'text/html' : 'text/javascript',
                    content: fallback
                });
            }
        }

        return files;
    },

    /**
     * Builds a complete file manifest from a publish payload and reply text.
     */
    buildPublishFiles: function(data, rawReplyText) {
        const collected = [];
        const pushFile = (file, fallbackIndex) => {
            if (!file || typeof file !== 'object') return;
            const rawName = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : `file-${fallbackIndex}.txt`;
            const rawContent = typeof file.content === 'string' ? file.content : '';
            if (!rawContent.trim()) return;
            const name = rawName.replace(/[/\\]+/g, '_');
            const type = typeof file.type === 'string' && file.type.trim() ? file.type.trim() : this.inferFileType(name);
            collected.push({ name, type, content: rawContent });
        };

        if (Array.isArray(data?.files)) {
            data.files.forEach((file, index) => pushFile(file, index + 1));
        }

        if (typeof data?.html === 'string' && data.html.trim()) {
            collected.push({ name: 'index.html', type: 'text/html', content: data.html.trim() });
        }
        if (typeof data?.css === 'string' && data.css.trim()) {
            collected.push({ name: 'styles.css', type: 'text/css', content: data.css.trim() });
        }
        if (typeof data?.js === 'string' && data.js.trim()) {
            collected.push({ name: 'game.js', type: 'text/javascript', content: data.js.trim() });
        }
        
        if (collected.length === 0) {
            collected.push(...this.buildFilesFromText(rawReplyText));
        }

        // De-duplicate names
        const usedNames = new Set();
        return collected.map((file, index) => {
            const baseName = `${file.name || `file-${index + 1}.txt`}`.trim();
            let uniqueName = baseName;
            let suffix = 2;
            while (usedNames.has(uniqueName.toLowerCase())) {
                const dotIndex = baseName.lastIndexOf('.');
                if (dotIndex > 0) {
                    uniqueName = `${baseName.slice(0, dotIndex)}-${suffix}${baseName.slice(dotIndex)}`;
                } else {
                    uniqueName = `${baseName}-${suffix}`;
                }
                suffix += 1;
            }
            usedNames.add(uniqueName.toLowerCase());
            return {
                name: uniqueName,
                type: file.type || this.inferFileType(uniqueName),
                content: file.content
            };
        });
    },

    /**
     * Generates the system directive for workshop publishing.
     */
    getPublishDirective: function() {
        return [
            '[WORKSHOP_PROTOCOL]',
            'REASONING PROTOCOL: [REASONING_ORCHESTRATOR_V2]',
            'FOLDER CONTEXT: You are working in a dedicated project folder. All files you generate belong to this project.',
            'Before building a game, you MUST output a concise [PLANNING] block.',
            'CRITICAL: Do NOT ask for permission or wait for approval. IMPLEMENT NOW.',
            'IMPORTANT: You MUST include the [PUBLISH] tag in the same response as the plan.',
            'The tag MUST contain a valid JSON object with: { "target": "workshop", "title": "...", "files": [{ "name": "...", "content": "..." }] }.',
            'Generate a complete, playable, self-contained browser game package.',
            'index.html MUST be the entry point and reference any other files (styles.css, game.js) by their relative paths in the folder.',
            'Use plain browser APIs only; no external libraries, CDNs, or module syntax.',
            'VISUALIZATION: In addition to the [PUBLISH] tag, also provide markdown code blocks (```html, ```javascript) for the primary files so the user can see your work.',
            '[/WORKSHOP_PROTOCOL]'
        ].join('\n');
    },

    /**
     * Principles for ensuring AI-generated code is 'real' and functional.
     */
    workingCodePrinciples: [
        "SELF-CONTAINED: All logic (JS), styles (CSS), and markup (HTML) must reside within the provided files.",
        "VANILLA: No external dependencies (jQuery, React, etc.) unless explicitly requested.",
        "CANVAS-FIRST: For arcade games, prefer <canvas> for performance and flexibility.",
        "RESPONSIVE: Use 'dvh' or 'vh' for height and percentage-based widths to fit any screen.",
        "STATE-DRIVEN: Use a central 'gameState' object to make debugging and saving easy.",
        "BATTLE-TESTED: Avoid 'theoretical' APIs; stick to well-supported browser features."
    ],

    /**
     * Checks if the user prompt mentions the workshop editor.
     */
    isWorkshopEditorReferencePrompt: function(message = "") {
        const text = `${message || ''}`.trim().toLowerCase();
        return /\b(?:file|code|game|it|that|this)\b.{0,80}\b(?:open|opened|loaded|selected|showing|visible)\b.{0,80}\b(?:editor|workshop editor)\b/.test(text)
            || /\b(?:editor|workshop editor)\b.{0,80}\b(?:open|opened|loaded|selected|showing|visible)\b/.test(text)
            || /\b(?:the\s+)?(?:file|code|game)\s+is\s+(?:already\s+)?(?:in|inside|on)\s+the\s+(?:workshop\s+)?editor\b/.test(text)
            || /\bi\s+(?:have|got)\s+(?:it|the\s+(?:file|code|game))\s+(?:open|opened|loaded|selected)\s+in\s+the\s+(?:workshop\s+)?editor\b/.test(text);
    },

    /**
     * Determines if a prompt indicates an intent to edit a workshop file.
     */
    isWorkshopEditIntentPrompt: function(message = "", workshopContext = null) {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = window.activeArcadeCommandModes || [];
        const hasExplicitMode = modes.includes('/edit') || modes.includes('/fix') || modes.includes('/rewrite');
        if (hasExplicitMode) return true;

        if (!text) return false;
        if (/^\/(?:edit|fix|rewrite)\b/.test(text) || /^\[(?:edit|fix|rewrite)\]/.test(text)) return true;
        if (this.isWorkshopEditorReferencePrompt(text) && (typeof window.hasActiveWorkshopEditor === 'function' && window.hasActiveWorkshopEditor(workshopContext))) return true;

        const editVerb = /\b(edit|fix|repair|change|update|modify|replace|remove|delete|add|insert|improve|tweak|adjust|refactor|rename|debug|rewrite)\b/.test(text);
        const activeEditor = (typeof window.hasActiveWorkshopEditor === 'function' && window.hasActiveWorkshopEditor(workshopContext));
        const editorCodeGenVerb = /\b(write|create|generate|code|build|make|implement|integrate)\b/.test(text);
        if (!editVerb && !(activeEditor && editorCodeGenVerb)) return false;

        const fileTarget = /\b(editor|website|workshop|file|code|html|css|javascript|js|game|page|button|screen|layout|style)\b/.test(text);
        return activeEditor || fileTarget;
    },

    /**
     * Checks if a prompt is explicitly asking to publish to the workshop.
     */
    isExplicitWorkshopPublishIntentPrompt: function(message = "") {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = window.activeArcadeCommandModes || [];
        if (modes.includes('/publish')) return true;

        if (!text) return false;
        if (/^\/publish\b/.test(text) || /^\[publish\]/.test(text)) return true;
        
        return /\b(?:publish|upload|share|save|update|sync)\b.{0,30}\b(?:workshop|library|game|project)\b/.test(text)
            || /\b(?:send|put|move)\s+(?:this|the|it|code)\s+(?:to|into)\s+(?:the\s+)?(?:workshop|library)\b/.test(text);
    },

    /**
     * Determines if a prompt indicates an intent to rewrite a file entirely.
     */
    isWorkshopRewriteIntentPrompt: function(message = "", workshopContext = null) {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = window.activeArcadeCommandModes || [];
        if (modes.includes('/rewrite')) return true;

        if (!text) return false;
        if (/^\/rewrite\b/.test(text) || /^\[rewrite\]/.test(text)) return true;
        return /\brewrite\b/.test(text)
            && /\b(editor|website|workshop|file|code|html|css|javascript|js|game|page)\b/.test(text)
            && (typeof window.hasActiveWorkshopEditor === 'function' && window.hasActiveWorkshopEditor(workshopContext));
    },

    /**
     * Curated list of neon-themed game concepts for AI inspiration.
     */
    seedIdeas: [
        { title: "Paper Pilot", genre: "Flight/Arcade", concept: "Sketch-style paper plane flight. Navigate through a hand-drawn office environment with physics-based wind." },
        { title: "Zen Garden", genre: "Relaxation/Puzzle", concept: "Rake sand to match patterns. Minimalist aesthetic with procedural ripples and calming soundscapes." },
        { title: "Brutalist Blocks", genre: "Physics/Stacking", concept: "Stack raw concrete slabs in a stark, monochromatic architecture. Focus on weight and brutalist shadows." },
        { title: "Pixel Pasture", genre: "Farming/Sim", concept: "Lo-fi 8-bit farming. Grow digital crops to trade for better seeds in a vibrant, chunky pixel-art world." },
        { title: "Glass Void", genre: "Puzzle/Refraction", concept: "Direct light through glass prisms. Use glassmorphism effects and soft blurred gradients." },
        { title: "Sketch Escape", genre: "Platformer", concept: "A world drawn in a notebook. Erase obstacles or draw paths to help the character reach the exit." },
        { title: "Cyber Shield", genre: "Action/Rhythm", concept: "Defend a core from pulses. While high-tech, focus on clean vector lines and geometric shapes." },
        { title: "Signal Breach", genre: "Puzzle/Strategy", concept: "Connect nodes in a data map. Focus on blueprint-style aesthetics and technical diagrams." },
        { title: "Ink Blot", genre: "Abstract/Arcade", concept: "Control an ink drop on parchment. Absorb other drops to grow while avoiding water spills." },
        { title: "Monochrome Maze", genre: "Exploration", concept: "A stark black-and-white maze where shadows reveal the path. High contrast, film-noir aesthetic." }
    ],

    /**
     * Generates a directive for the AI to brainstorm new game ideas.
     */
    getIdeaDirective: function(genreHint = "") {
        const hintText = genreHint ? ` focusing on the "${genreHint}" genre` : "";
        return [
            '[IDEA_PROTOCOL]',
            `AUTONOMOUS DESIGNER MODE: Suggest 3 unique, high-concept mini-game ideas${hintText}.`,
            'IMPORTANT: These must be REAL, implementable concepts, not "placeholder" ideas.',
            'Each idea MUST have: A catchy Title, Genre, and a 2-sentence Concept.',
            'Themes: Minimalist, Paper-Sketch, Glassmorphism, Brutalist, Lo-Fi Pixel, or High-Contrast Noir.',
            'Constraint: Must follow these WORKING CODE PRINCIPLES:',
            JSON.stringify(this.workingCodePrinciples),
            'Reference these existing seeds for inspiration:',
            JSON.stringify(this.seedIdeas.slice(0, 5)),
            '[/IDEA_PROTOCOL]'
        ].join('\n');
    },

    /**
     * Robustly parses balanced JSON tags like [PUBLISH:{...}]
     */
    extractBalancedJsonTagPayload: function(text, tagName) {
        const source = `${text || ''}`;
        if (!tagName) return null;
        const markerPattern = '\\[' + tagName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':';
        const markerRegex = new RegExp(markerPattern, 'gi');

        let searchFrom = 0;
        while (searchFrom < source.length) {
            markerRegex.lastIndex = searchFrom;
            const match = markerRegex.exec(source);
            if (!match) return null;

            const markerIndex = match.index;
            const markerLength = match[0].length;
            let cursor = markerIndex + markerLength;
            while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
            if (source[cursor] !== '{') {
                searchFrom = markerIndex + markerLength;
                continue;
            }

            let depth = 0, inString = false, isEscaped = false;
            for (let i = cursor; i < source.length; i += 1) {
                const ch = source[i];
                if (inString) {
                    if (isEscaped) isEscaped = false;
                    else if (ch === '\\') isEscaped = true;
                    else if (ch === '"') inString = false;
                    continue;
                }
                if (ch === '"') { inString = true; continue; }
                if (ch === '{') { depth += 1; continue; }
                if (ch !== '}') continue;
                depth -= 1;
                if (depth !== 0) continue;

                let endCursor = i + 1;
                while (endCursor < source.length && /\s/.test(source[endCursor])) endCursor += 1;
                const hasClosingBracket = source[endCursor] === ']';
                if (!hasClosingBracket && `${tagName || ''}`.trim().toUpperCase() !== 'PUBLISH') {
                    searchFrom = i + 1;
                    break;
                }
                return {
                    jsonText: source.slice(cursor, i + 1),
                    start: markerIndex,
                    end: hasClosingBracket ? endCursor + 1 : i + 1
                };
            }
            searchFrom = markerIndex + markerLength;
        }
        return null;
    },

    /**
     * Safely parses JSON that might contain LLM artifacts like unescaped newlines.
     */
    robustParseJson: function(jsonStr) {
        if (!jsonStr || typeof jsonStr !== 'string') return null;
        let clean = jsonStr.trim();
        try { return JSON.parse(clean); } catch (e) {
            let sanitized = "", inString = false, escaped = false;
            for (let i = 0; i < clean.length; i++) {
                const char = clean[i];
                if (char === '"' && !escaped) { inString = !inString; sanitized += char; }
                else if (inString && !escaped) {
                    if (char === '\n') sanitized += "\\n";
                    else if (char === '\r') sanitized += "\\r";
                    else if (char === '\t') sanitized += "\\t";
                    else if (char === '\\') { escaped = true; sanitized += char; }
                    else sanitized += char;
                } else { sanitized += char; escaped = false; }
            }
            try { return JSON.parse(sanitized); } catch (e2) {
                try { if (clean.startsWith('{') && !clean.endsWith('}')) return JSON.parse(clean + '}'); } catch (e3) {}
                return null;
            }
        }
    },

    /**
     * Extracts surgical edit blocks from AI response.
     */
    extractWorkshopEditBlocks: function(text = "") {
        const source = `${text || ''}`;
        const blocks = [];
        const workshopActionRegex = /\[(EDIT|EDIT_FILE|FILE_EDIT|Workshop\/Edit)(?::\s*([\s\S]*?))?\]([\s\S]*?)(?:\[\/\1\]|$)/gi;
        let match;
        while ((match = workshopActionRegex.exec(source)) !== null) {
            const parsed = this.parseWorkshopSearchReplaceBlock(match[3]);
            if (parsed) blocks.push(parsed);
        }
        if (blocks.length === 0 && /SEARCH:\s*[\s\S]+?REPLACE:/i.test(source)) {
            const parsed = this.parseWorkshopSearchReplaceBlock(source);
            if (parsed) blocks.push(parsed);
        }
        return blocks;
    },

    parseWorkshopSearchReplaceBlock: function(raw) {
        const text = `${raw || ""}`;
        const searchMatch = text.match(/SEARCH:\s*([\s\S]*?)(?=REPLACE:|$)/i);
        const replaceMatch = text.match(/REPLACE:\s*([\s\S]*?)(?=SEARCH:|$)/i);
        if (!searchMatch || !replaceMatch) return null;
        return { search: searchMatch[1].trim(), replace: replaceMatch[1].trim() };
    },

    decodeEscapedCodeText: function(value) {
        return `${value || ''}`.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    },

    getWorkshopFileKindFromName: function(fileName = '') {
        const lower = `${fileName || ''}`.trim().toLowerCase();
        if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
        if (lower.endsWith('.css')) return 'css';
        if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
        if (lower.endsWith('.json')) return 'json';
        return 'text';
    },

    stripArcadeProtocolTags: function(content = "") {
        let text = `${content || ""}`;
        let hadTags = false;
        let pub;
        let safety = 0;
        while ((pub = this.extractBalancedJsonTagPayload(text, 'PUBLISH')) !== null && safety < 10) {
            hadTags = true;
            text = text.substring(0, pub.start) + text.substring(pub.end);
            safety++;
        }
        const blockTypes = ['PLANNING', 'IMPLEMENTATION_PLAN', 'TEST_PLAN', 'EDIT', 'FILE_EDIT', 'Workshop/Edit'];
        for (const type of blockTypes) {
            const startTag = `[${type}`, endTag = `[/${type}]`, upper = text.toUpperCase();
            let sIdx = upper.indexOf(startTag);
            while (sIdx !== -1) {
                const eTagIdx = upper.indexOf(endTag, sIdx);
                if (eTagIdx !== -1) {
                    text = text.substring(0, sIdx) + text.substring(eTagIdx + endTag.length);
                    hadTags = true;
                    sIdx = text.toUpperCase().indexOf(startTag);
                } else {
                    text = text.substring(0, sIdx) + text.substring(sIdx + startTag.length);
                    break;
                }
            }
        }
        const jsonTags = ['PUBLISH', 'ARCADE', 'COMPOSE', 'SEARCH', 'FETCH', 'LAUNCH', 'SHELL', 'FIND'];
        for (const tag of jsonTags) {
            let pubInner, safetyInner = 0;
            while ((pubInner = this.extractBalancedJsonTagPayload(text, tag)) !== null && safetyInner < 10) {
                hadTags = true;
                text = text.substring(0, pubInner.start) + text.substring(pubInner.end);
                safetyInner++;
            }
        }
        const simpleRegex = /\[(ARCADE|DUCKDUCKGO|OPEN|COMPOSE|PLANNING|IMPLEMENTATION_PLAN|TEST_PLAN|EDIT|FILE_EDIT|Workshop\/Edit):\s*([^\]]+)\]/gi;
        text = text.replace(simpleRegex, (match, tag, val) => {
            hadTags = true;
            return tag === 'COMPOSE' ? val : "";
        });
        return text.trim();
    },

    getProtocolDirectives: function(userPrompt = "", workshopContext = null, attachment = null) {
        const text = `${userPrompt || ''}`.trim().toLowerCase();
        const directives = [];
        const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
        if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);

        const hasActiveWorkshop = typeof window.hasActiveWorkshopEditor === 'function' ? window.hasActiveWorkshopEditor(workshopContext) : false;
        const isPublishIntent = modes.has('/publish') || modes.has('/build') || text.includes('/publish') || text.includes('/build');
        const isEditIntent = modes.has('/edit') || modes.has('/fix') || text.includes('/edit') || text.includes('/fix');

        if (isPublishIntent) directives.push(this.getPublishDirective());
        if (isEditIntent && hasActiveWorkshop) {
            directives.push('[SURGICAL_EDIT_PROTOCOL]');
            directives.push('You are in surgical edit mode. Output exactly one [EDIT] SEARCH/REPLACE block.');
            directives.push('SEARCH: Exact lines to find. REPLACE: New code to insert.');
            directives.push('Keep edits minimal and preserve existing logic. Use [FIND: query] if unsure of exact lines.');
            directives.push('[/SURGICAL_EDIT_PROTOCOL]');
        }
        return directives.join('\n\n');
    }
};

