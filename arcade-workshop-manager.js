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

    getActiveWorkshopEditorContext: function(workshopContext = null) {
        const providedEditor = workshopContext?.workshopEditor || null;
        if (providedEditor) return providedEditor;
        if (typeof window.getWorkshopEditorState === 'function') {
            return window.getWorkshopEditorState();
        }
        return null;
    },

    hasActiveWorkshopEditor: function(workshopContext = null) {
        const editor = this.getActiveWorkshopEditorContext(workshopContext);
        return !!(`${editor?.activeGameId || ''}`.trim() && `${editor?.activeFileName || ''}`.trim());
    },

    looksLikeExecutableCode: function(value) {
        const text = `${value || ''}`.trim();
        if (text.length < 40) return false;
        
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

    inferCodeKind: function(langHint = "", code = "") {
        const hint = `${langHint || ''}`.toLowerCase().trim();
        if (hint === 'html' || hint === 'htm') return 'html';
        if (hint === 'css') return 'css';
        if (hint === 'javascript' || hint === 'js') return 'js';
        
        const source = `${code || ''}`.trim();
        // More robust HTML detection: check for common tags or any tag-like structure
        if (source.startsWith('<!doctype html') || source.startsWith('<html') || source.includes('<body') || source.includes('<script') || /<[a-z1-6]+(?:\s+[^>]*?)?>/i.test(source)) {
            return 'html';
        }
        if (source.includes('{') && source.includes(':') && (source.includes('background-') || source.includes('margin:'))) return 'css';
        if (this.looksLikeExecutableCode(source)) return 'js';
        
        return 'txt';
    },

    /**
     * Working code principles for AI guidance.
     */
    workingCodePrinciples: {
        architecture: "Single-file component style, separation of concerns via modules if needed.",
        media: "Use standard HTML5 audio/video. No external assets unless data-URLs.",
        state: "Predictable state management, no global leaks.",
        styling: "Neon-themed, premium CSS, glassmorphism, responsive.",
        events: "Passive listeners where possible, clean cleanup."
    },

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

        // 3. Last Resort Fallback: use extractFilesGreedily
        return this.extractFilesGreedily(rawText);
    },

    /**
     * Deep regex-based search for {"name": "...", "content": "..."} patterns
     * within a potentially malformed or truncated string.
     */
    extractFilesGreedily: function(text = "") {
        const source = `${text || ""}`;
        const files = [];
        const usedNames = new Set();
        
        // Match patterns like "name": "index.html", "content": "..."
        // Handles optional spaces, different quotes, and escaped quotes
        const filePattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"(?:content|code)"\s*:\s*"([\s\S]*?)(?<!\\)"/gi;
        let match;
        while ((match = filePattern.exec(source)) !== null) {
            const name = match[1].trim();
            const content = this.decodeEscapedCodeText(match[2]);
            if (name && content && !usedNames.has(name.toLowerCase())) {
                const inferredKind = this.inferCodeKind(this.getWorkshopFileKindFromName(name), content);
                let finalName = name;
                
                // If the AI gave us a JS name but the content is clearly HTML, fix it.
                if (inferredKind === 'html' && (name.toLowerCase().endsWith('.js') || name.toLowerCase().endsWith('.css'))) {
                    finalName = 'index.html';
                } else if (inferredKind === 'js' && (name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.css'))) {
                    finalName = 'game.js';
                }

                files.push({
                    name: finalName,
                    type: this.inferFileType(finalName),
                    content: content
                });
                usedNames.add(finalName.toLowerCase());
            }
        }

        // If still nothing, try looking for just content strings that look like code
        if (files.length === 0) {
            const contentMatches = source.matchAll(/"(?:content|code|body|html)"\s*:\s*"([\s\S]*?)(?<!\\)"/gi);
            for (const cMatch of contentMatches) {
                const code = this.decodeEscapedCodeText(cMatch[1]);
                if (this.looksLikeExecutableCode(code)) {
                    const kind = this.inferCodeKind('', code);
                    let name = kind === 'html' ? 'index.html' : kind === 'css' ? 'styles.css' : 'game.js';
                    if (kind === 'txt') name = 'snippet.txt';
                    
                    if (!usedNames.has(name.toLowerCase())) {
                        files.push({ name, type: this.inferFileType(name), content: code });
                        usedNames.add(name.toLowerCase());
                    }
                }
            }
        }

        if (files.length === 0) {
            let fallback = source.split(/\[PUBLISH:\s*/i)[0] || '';
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
            'Generate a functional, playable, self-contained browser game. It could be just a single HTML file or a multi-file package. At least 1 file must be generated (images are always optional).',
            'If multi-file, index.html MUST be the entry point and reference any other files (styles.css, game.js) by their relative paths in the folder.',
            'Use plain browser APIs only; no external libraries, CDNs, or module syntax.',
            'VISUALIZATION: In addition to the [PUBLISH] tag, also provide markdown code blocks (```html, ```javascript) for the primary files so the user can see your work.',
            '[/WORKSHOP_PROTOCOL]'
        ].join('\n');
    },

    /**
     * Determines if a prompt indicates an intent to publish a game to the workshop.
     */
    isWorkshopPublishIntentPrompt: function(message = "") {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
        if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);

        if (modes.has('/publish')) return true;

        if (!text) return false;
        if (/^\/publish\b/.test(text) || /^\[publish\]/.test(text)) return true;

        return /\b(?:publish|upload|share|save|release|submit|deploy)\b/i.test(text) 
            && /\b(?:game|project|workshop|arcade|app|logic|code|files)\b/i.test(text);
    },

    /**
     * Determines if a prompt indicates a style-only edit request.
     */
    isStyleEditPrompt: function(prompt = "") {
        const text = `${prompt || ""}`.toLowerCase();
        return /\b(style|styles|css|design|visual|theme|color|colour|pretty|background|polish|make it look)\b/i.test(text);
    },

    /**
     * Determines if a prompt allows for a local style enhancement fallback.
     */
    allowsLocalStyleFallback: function(prompt = "") {
        return /\b(local fallback|quick style fallback|apply local style|fallback style)\b/i.test(`${prompt || ""}`);
    },

    /**
     * Determines if a prompt indicates an intent to edit a game's code.
     */
    isWorkshopEditIntentPrompt: function(message = "", workshopContext = null) {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
        if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);

        if (modes.has('/edit') || modes.has('/fix')) return true;

        if (!text) return false;
        if (/^\/(?:edit|fix)\b/.test(text) || /^\[(?:edit|fix)\]/.test(text)) return true;

        const keywords = /\b(?:edit|fix|change|update|modify|tweak|repair|debug|add|insert|remove|replace)\b/i;
        const codeContext = /\b(?:code|file|script|index|logic|game|project|workshop|html|css|javascript|js)\b/i;
        
        return keywords.test(text) && codeContext.test(text) && this.hasActiveWorkshopEditor(workshopContext);
    },

    /**
     * Determines if a prompt indicates an intent to rewrite a file entirely.
     */
    isWorkshopRewriteIntentPrompt: function(message = "", workshopContext = null) {
        const text = `${message || ''}`.trim().toLowerCase();
        const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
        if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);

        if (modes.has('/rewrite')) return true;

        if (!text) return false;
        if (/^\/rewrite\b/.test(text) || /^\[rewrite\]/.test(text)) return true;
        
        return /\b(?:rewrite|rebuild|recreate|overhaul|start over|clean slate|full replacement)\b/i.test(text)
            && /\b(?:code|file|script|index|logic|game|project|workshop|html|css|javascript|js)\b/i.test(text)
            && this.hasActiveWorkshopEditor(workshopContext);
    },

    /**
     * Determines if a prompt refers to the workshop editor being open/visible.
     */
    isWorkshopEditorReferencePrompt: function(message = "") {
        const text = `${message || ''}`.trim().toLowerCase();
        if (!text) return false;
        return /\b(?:file|code|game|it|that|this)\b.{0,80}\b(?:open|opened|loaded|selected|showing|visible)\b.{0,80}\b(?:editor|workshop editor)\b/.test(text)
            || /\b(?:editor|workshop editor)\b.{0,80}\b(?:open|opened|loaded|selected|showing|visible)\b/.test(text)
            || /\b(?:the\s+)?(?:file|code|game)\s+is\s+(?:already\s+)?(?:in|inside|on)\s+the\s+(?:workshop\s+)?editor\b/.test(text)
            || /\bi\s+(?:have|got)\s+(?:it|the\s+(?:file|code|game))\s+(?:open|opened|loaded|selected)\s+in\s+the\s+(?:workshop\s+)?editor\b/.test(text);
    },

    /**
     * Determines if a prompt indicates a request to edit multiple files in the workshop.
     */
    isWorkshopMultiFileEditPrompt: function(message = "", workshopContext = null) {
        const text = `${message || ''}`.trim().toLowerCase();
        if (!text || !this.hasActiveWorkshopEditor(workshopContext)) return false;
        const editor = this.getActiveWorkshopEditorContext(workshopContext);
        if (this.getWorkshopFileKindFromName(editor?.activeFileName || '') !== 'html') return false;

        const wantsAssetFile = /\b(?:javascript|java\s*script|js|script|module|css|stylesheet|style\s*sheet|separate\s+file|new\s+file|add\s+(?:a\s+)?file|external\s+(?:file|script|stylesheet))\b/.test(text);
        const wantsImplementation = /\b(?:add|write|create|generate|code|build|make|handle|implement|integrate|wire|connect|need|want|same|also)\b/.test(text);
        return wantsAssetFile && wantsImplementation;
    },

    /**
     * Determines if a prompt is simply asking to enter the Workshop Editor.
     */
    isWorkshopEditorModePrompt: function(message = "") {
        const text = `${message || ''}`.trim().toLowerCase();
        return /\b(?:enter|open|go to|show|start|use)\b.{0,20}\b(?:workshop|editor|workshop editor|edit mode)\b/i.test(text);
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
                    end: endCursor + (hasClosingBracket ? 1 : 0)
                };
            }
            searchFrom = markerIndex + markerLength;
        }
        return null;
    },

    robustParseJson: function(jsonStr) {
        if (!jsonStr || typeof jsonStr !== 'string') return null;
        let clean = jsonStr.trim();
        
        // Remove common LLM prefixes like "JSON:" or "```json"
        clean = clean.replace(/^(?:JSON|Output):\s*/i, '').trim();
        clean = clean.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

        const attemptParse = (str) => {
            try { return JSON.parse(str); } catch (e) { return null; }
        };

        // 1. Direct attempt
        let result = attemptParse(clean);
        if (result) return result;

        // 2. Fix "Smart Quotes" and other non-standard chars
        let standardized = clean
            .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // Smart double quotes
            .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"); // Smart single quotes
            
        result = attemptParse(standardized);
        if (result) return result;

        // 3. Sanitize unescaped characters in strings
        let sanitized = "", inString = false, escaped = false;
        for (let i = 0; i < standardized.length; i++) {
            const char = standardized[i];
            if (char === '"' && !escaped) { 
                inString = !inString; 
                sanitized += char; 
            } else if (inString && !escaped) {
                if (char === '\n') sanitized += "\\n";
                else if (char === '\r') sanitized += "\\r";
                else if (char === '\t') sanitized += "\\t";
                else if (char === '\\') { escaped = true; sanitized += char; }
                else sanitized += char;
            } else { 
                sanitized += char; 
                escaped = false; 
            }
        }
        // If we are still in a string at the end of the content, close it
        if (inString) sanitized += '"';

        result = attemptParse(sanitized);
        if (result) return result;

        // 4. Fix common malformations (single quotes, trailing commas, missing quotes on keys)
        let fixed = sanitized
            .replace(/'/g, '"') // Single to double quotes
            .replace(/,\s*([}\]])/g, '$1') // Trailing commas
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3'); // Unquoted keys

        result = attemptParse(fixed);
        if (result) return result;

        // 5. Handle truncation (add missing closing braces/brackets)
        let openBraces = (fixed.match(/{/g) || []).length - (fixed.match(/}/g) || []).length;
        let openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/]/g) || []).length;
        
        let closing = "";
        while (openBraces > 0) { closing += "}"; openBraces--; }
        while (openBrackets > 0) { closing += "]"; openBrackets--; }
        
        if (closing) {
            result = attemptParse(fixed + closing);
            if (result) return result;
        }

        // 6. Last resort: if it's still failing, it might be double-encoded or have a leading/trailing trash
        const firstBrace = fixed.indexOf('{');
        const lastBrace = fixed.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            result = attemptParse(fixed.substring(firstBrace, lastBrace + 1));
            if (result) return result;
        }

        // Final log for debugging (won't be visible to user unless they open console)
        console.debug('[Arcade: RobustParse] All parsing attempts failed for string:', jsonStr);
        return null;
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
        
        // Strip balanced JSON tags first
        const jsonTags = ['PUBLISH', 'ARCADE', 'COMPOSE', 'SEARCH', 'FETCH', 'LAUNCH', 'SHELL', 'FIND', 'REASONING_ORCHESTRATOR_V2', 'PLANNING', 'IMPLEMENTATION_PLAN', 'TEST_PLAN'];
        for (const tag of jsonTags) {
            let pubInner, safetyInner = 0;
            while ((pubInner = this.extractBalancedJsonTagPayload(text, tag)) !== null && safetyInner < 10) {
                hadTags = true;
                text = text.substring(0, pubInner.start) + text.substring(pubInner.end);
                safetyInner++;
            }
        }

        // Strip internal context markers and leaked protocol tags
        const patternRegex = /\[(?:SignalShare|WORKSHOP|SURGICAL|FULL_FILE|IDEA|DEEP|WORKSHOP_PROTOCOL|WORKSHOP_REWRITE)[\s\S]*?\]/gi;
        text = text.replace(patternRegex, () => { hadTags = true; return ""; });

        // Strip leaked XML-like tags (e.g. </REPLACE>, </workshop>)
        const xmlLeakRegex = /<\/?(?:REPLACE|workshop|file|code|content|plan|thought|reasoning|system)[\s\S]*?>/gi;
        text = text.replace(xmlLeakRegex, () => { hadTags = true; return ""; });

        const simpleRegex = /\[(ARCADE|DUCKDUCKGO|OPEN|COMPOSE|PLANNING|IMPLEMENTATION_PLAN|TEST_PLAN|EDIT|FILE_EDIT|Workshop\/Edit|IDEA_PROTOCOL|WORKSHOP_PROTOCOL):\s*([\s\S]*?)\]/gi;
        text = text.replace(simpleRegex, (match, tag, val) => {
            hadTags = true;
            return tag === 'COMPOSE' ? val : "";
        });

        // Final cleanup of trailing brackets or stray colons left by broken tags
        text = text.replace(/^[:\s\]]+/, '').trim();
        
        return text;
    },

    getProtocolDirectives: function(userPrompt = "", workshopContext = null, attachment = null) {
        try {
            const text = `${userPrompt || ''}`.trim().toLowerCase();
            const directives = [];
            const modes = new Set(Array.isArray(window.activeArcadeCommandModes) ? window.activeArcadeCommandModes : []);
            if (window.activeArcadeCommandMode) modes.add(window.activeArcadeCommandMode);

            if (this.isWorkshopPublishIntentPrompt(text)) {
                directives.push(this.getPublishDirective());
            }

            if (this.isWorkshopRewriteIntentPrompt(text, workshopContext)) {
                const editor = this.getActiveWorkshopEditorContext(workshopContext);
                directives.push([
                    '[WORKSHOP_REWRITE]',
                    `You are rewriting the ENTIRE content of "${editor.activeFileName}" for the game "${editor.activeGameId}".`,
                    'Your response MUST contain the full, improved code for this file.',
                    'IMPORTANT: Wrap your code in standard markdown code blocks.',
                    '[/WORKSHOP_REWRITE]'
                ].join('\n'));
            } else if (this.isWorkshopEditIntentPrompt(text, workshopContext)) {
                const editor = this.getActiveWorkshopEditorContext(workshopContext);
                directives.push([
                    '[SURGICAL_EDIT]',
                    `You are editing "${editor.activeFileName}" in the game "${editor.activeGameId}".`,
                    'Provide surgical edits using [EDIT]SEARCH:...REPLACE:...[/EDIT] blocks.',
                    'Include as much context as needed in the SEARCH block to ensure a unique match.',
                    '[/SURGICAL_EDIT]'
                ].join('\n'));
            }

            return directives.join('\n\n');
        } catch (err) {
            console.error("[Arcade Workshop Manager] Failed to get directives:", err);
            return "";
        }
    },

    shouldRouteToWorkshop: function(data, text, userPrompt) {
        if (data?.target === 'workshop') return true;
        return this.isWorkshopPublishIntentPrompt(userPrompt) || text.includes('[PUBLISH]');
    },

    generateCodeSkeleton: function(content, fileName = '') {
        const lines = content.split('\n');
        const kind = this.getWorkshopFileKindFromName(fileName);
        const skeleton = [];

        if (kind === 'js') {
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                // Match function declarations, arrows, classes
                if (/^(?:async\s+)?function\s+\w+|^(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\(.*?\)|[^({]+?)\s*=>|^\w+\s*\(.*?\)\s*\{|^\s*(?:static\s+)?(?:get|set)?\s*\w+\s*\(.*?\)\s*\{|^class\s+\w+/.test(trimmed)) {
                    skeleton.push(`${i + 1}: ${line} ...`);
                } else if (trimmed.startsWith('export ') || trimmed.startsWith('import ')) {
                    skeleton.push(`${i + 1}: ${line}`);
                }
            });
        } else if (kind === 'css') {
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith(' ') && !trimmed.startsWith('}') && !trimmed.startsWith('*')) {
                    skeleton.push(`${i + 1}: ${line} { ... }`);
                }
            });
        } else if (kind === 'html') {
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.startsWith('<!--') && (trimmed.includes(' id=') || trimmed.includes(' class=') || trimmed.includes('<h') || trimmed.includes('<section') || trimmed.includes('<div') || trimmed.includes('<button'))) {
                    skeleton.push(`${i + 1}: ${line.split('>')[0]}> ...`);
                }
            });
        }

        if (skeleton.length === 0) {
            return `[File is large (${content.length} chars). No clear structural blocks identified for skeleton view.]`;
        }
        return skeleton.join('\n');
    }
};
