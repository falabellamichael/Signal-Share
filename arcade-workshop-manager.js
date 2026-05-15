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
        const hitCount = markers.reduce((count, marker) => count + (text.toLowerCase().includes(marker) ? 1 : 0), 0);
        const structureHits = (text.match(/[{};]/g) || []).length;
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
            'Before building a game, you MUST output a concise [PLANNING] block.',
            'IMPORTANT: You MUST include the [PUBLISH] tag in the same response as the plan.',
            'The tag MUST contain a valid JSON object with: { "target": "workshop", "title": "...", "files": [{ "name": "...", "content": "..." }] }.',
            'Generate a complete, playable, self-contained browser game.',
            'index.html MUST be the entry point and reference any other files (styles.css, game.js) by their exact name.',
            'Use plain browser APIs only; no external libraries, CDNs, or module syntax.',
            'VISUALIZATION: In addition to the [PUBLISH] tag, also provide markdown code blocks (```html, ```javascript) for the primary files so the user can see your work.',
            '[/WORKSHOP_PROTOCOL]'
        ].join('\n');
    }
};
