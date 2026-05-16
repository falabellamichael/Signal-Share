/**
 * Arcade Command Manager
 * Orchestrates the registration and execution of slash commands.
 */
window.ArcadeCommandManager = (function() {
    const commands = new Map();

    const DEFAULT_SUBCOMMANDS = {
        publish: [
            ['random', 'Random game', 'Generate and publish a random playable mini-game.'],
            ['game', 'New game', 'Publish a new game from an AI prompt.'],
            ['demo', 'Demo build', 'Create a small polished demo/prototype.'],
            ['puzzle', 'Puzzle game', 'Generate a puzzle-style arcade game.'],
            ['arcade', 'Arcade game', 'Generate a fast arcade-style game.'],
            ['utility', 'Utility app', 'Publish a small useful tool/app.'],
            ['from editor', 'From editor', 'Use the current editor code as the publish target.'],
            ['update current', 'Update current', 'Update the currently selected Workshop item.']
        ],
        edit: [
            ['style current editor', 'Style current editor', 'Improve visuals in the currently open editor.'],
            ['fix current editor', 'Fix current editor', 'Repair the code currently open in the editor.'],
            ['add button', 'Add button', 'Add a button/control to the current editor file.'],
            ['rename variable', 'Rename variable', 'Rename something in the current editor file.'],
            ['refactor current editor', 'Refactor current editor', 'Clean up code in the current editor only.'],
            ['replace text', 'Replace text', 'Replace matching text in the current editor.'],
            ['full rewrite', 'Full rewrite', 'Ask for a complete replacement of the current editor content.'],
            ['explain before editing', 'Explain then edit', 'Ask for a brief edit plan before applying code.']
        ],
        fix: [
            ['bug', 'Bug fix', 'Fix a bug in the active file.'],
            ['syntax', 'Syntax error', 'Fix syntax/runtime errors.'],
            ['layout', 'Layout bug', 'Fix broken UI layout.'],
            ['mobile', 'Mobile bug', 'Fix mobile/touch behavior.'],
            ['performance', 'Performance bug', 'Fix lag or performance issues.']
        ],
        rewrite: [
            ['current editor', 'Rewrite current editor', 'Replace the current editor content.'],
            ['split files', 'Split files', 'Rewrite and separate HTML/CSS/JS.'],
            ['simplify', 'Simplify', 'Rewrite the file to be simpler.'],
            ['polish', 'Polish', 'Rewrite with better structure and UI polish.']
        ],
        find: [
            ['function', 'Find function', 'Search for a function name in the editor.'],
            ['button', 'Find button', 'Search for button/control code.'],
            ['style', 'Find style', 'Search for CSS/style code.'],
            ['error', 'Find error', 'Search for suspicious error-related code.']
        ],
        plan: [
            ['feature', 'Plan feature', 'Create a plan for a new feature.'],
            ['fix', 'Plan fix', 'Create a plan for a bug fix.'],
            ['refactor', 'Plan refactor', 'Create a refactor plan.'],
            ['performance', 'Plan performance', 'Create a performance plan.']
        ],
        vram: [
            ['flush', 'Flush VRAM', 'Unload local model memory.'],
            ['status', 'VRAM status', 'Check local model/memory status.']
        ],
        clear: [
            ['chat', 'Clear chat', 'Clear the current chat history.'],
            ['history', 'Clear history', 'Clear saved chat history.']
        ],
        help: [
            ['commands', 'All commands', 'Show every registered command.'],
            ['publish', 'Publish help', 'Show publishing command help.'],
            ['edit', 'Edit help', 'Show editor command help.']
        ]
    };

    function register(cmdObj) {
        if (!cmdObj.id) return;
        commands.set(cmdObj.id.toLowerCase(), cmdObj);
        console.log(`[Command Manager] Registered: /${cmdObj.id}`);
    }

    function getCommand(id) {
        return commands.get(`${id || ''}`.toLowerCase());
    }

    function getAllCommands() {
        return Array.from(commands.values());
    }

    function clearCommandModes() {
        window.activeArcadeCommandMode = '';
        window.activeArcadeCommandModes = [];
        window.__arcadeCommandModeTurnActive = false;
    }

    function markCommandMode(cmdId) {
        const mode = `/${cmdId}`;
        window.activeArcadeCommandMode = mode;
        window.__arcadeCommandModeTurnActive = true;
        if (!Array.isArray(window.activeArcadeCommandModes)) {
            window.activeArcadeCommandModes = [];
        }
        if (!window.activeArcadeCommandModes.includes(mode)) {
            window.activeArcadeCommandModes.push(mode);
        }
    }

    async function handle(text, inputElement) {
        let currentText = text.trim();
        let handledSomething = false;
        let lastResult = false;
        let safetyCounter = 0;
        
        // Command modes are one-shot per send. Clear stale /edit or /fix state
        // before parsing this message so normal chat cannot inherit old modes.
        clearCommandModes();

        // Support stacked commands (e.g. /edit /fix)
        while (currentText.startsWith('/') || currentText.startsWith('[')) {
            safetyCounter += 1;
            if (safetyCounter > 10) {
                console.warn('[Command Manager] Stopped command chain after 10 iterations:', currentText);
                break;
            }

            const previousText = currentText;
            let cmdId = "";
            let args = "";

            if (currentText.startsWith('/')) {
                const parts = currentText.split(/\s+/);
                cmdId = parts[0].substring(1).toLowerCase();
                args = parts.slice(1).join(' ').trim();
            } else {
                const match = currentText.match(/^\[(.*?)\]\s*(.*)$/);
                if (match) {
                    cmdId = match[1].toLowerCase();
                    args = match[2].trim();
                } else {
                    break;
                }
            }

            const command = getCommand(cmdId);
            if (command) {
                handledSomething = true;
                markCommandMode(cmdId);

                // If execute returns true, it means it handled everything (no AI needed)
                lastResult = await command.execute(args, inputElement);
                if (lastResult === true) return true;
                
                // If it returns false, it means "continue to AI or next command".
                // A command may intentionally preserve the slash text so the AI/context
                // layer can still see the command intent. If no progress was made, stop
                // parsing here instead of executing the same command forever.
                currentText = inputElement ? inputElement.value.trim() : args;
                if (!currentText) break;
                if (currentText === previousText) break;
            } else {
                break; // Unknown command
            }
        }

        // Handle Alias (legacy support)
        if (!handledSomething) {
            const aliasMatch = currentText.match(/^([a-z][a-z0-9_-]*)\s*\/\s*(.*)$/i);
            if (aliasMatch) {
                const cmdId = aliasMatch[1].toLowerCase();
                const command = getCommand(cmdId);
                if (command) {
                    markCommandMode(cmdId);
                    return await command.execute(aliasMatch[2].trim(), inputElement);
                }
            }
        }

        if (handledSomething && inputElement) {
            inputElement.value = currentText;
        }

        return lastResult; // Return the result of the last command (e.g. false for AI commands)
    }

    function normalizeSuggestion(raw, cmdId = '') {
        if (!raw) return null;
        if (typeof raw === 'string') {
            return {
                id: raw,
                name: raw,
                description: `Use /${cmdId} ${raw}`,
                commandId: cmdId
            };
        }

        const id = `${raw.id || raw.value || raw.insertText || raw.name || ''}`.trim();
        if (!id) return null;
        return {
            ...raw,
            id,
            name: raw.name || id,
            description: raw.description || `Use /${cmdId} ${id}`,
            commandId: raw.commandId || cmdId
        };
    }

    function getDefaultSubcommandSuggestions(cmdId = '', args = '') {
        const rows = DEFAULT_SUBCOMMANDS[cmdId] || [];
        const prompt = `${args || ''}`.trim().toLowerCase();
        return rows
            .map(([id, name, description]) => ({ id, name, description, commandId: cmdId }))
            .filter((item) => {
                if (!prompt) return true;
                const haystack = `${item.id} ${item.name} ${item.description}`.toLowerCase();
                return haystack.includes(prompt);
            });
    }

    function getCommandArgSuggestions(command, cmdId = '', args = '') {
        let provided = [];
        if (command && typeof command.getSuggestions === 'function') {
            try {
                provided = command.getSuggestions(args) || [];
            } catch (error) {
                console.warn(`[Command Manager] /${cmdId} suggestions failed:`, error);
                provided = [];
            }
        } else if (Array.isArray(command?.subcommands)) {
            provided = command.subcommands;
        }

        const normalizedProvided = provided
            .map((item) => normalizeSuggestion(item, cmdId))
            .filter(Boolean);

        const defaults = getDefaultSubcommandSuggestions(cmdId, args)
            .map((item) => normalizeSuggestion(item, cmdId))
            .filter(Boolean);

        const seen = new Set();
        return [...normalizedProvided, ...defaults].filter((item) => {
            const key = `${item.commandId}::${item.id}`.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 10);
    }

    function getTopLevelSuggestions(query = '') {
        return getAllCommands()
            .filter(c => c.id.toLowerCase().startsWith(query))
            .map(c => ({
                id: c.id,
                name: `/${c.id}`,
                description: c.description,
                isTopLevel: true
            }));
    }

    function getSuggestions(text) {
        const cleanText = `${text || ''}`.trim();
        if (!cleanText.startsWith('/')) return [];

        const parts = cleanText.split(/\s+/);
        const cmdId = parts[0].substring(1).toLowerCase();
        const args = parts.slice(1).join(' ');
        const command = getCommand(cmdId);
        const hasSpace = /\s$/.test(text) || cleanText.includes(' ');

        if (!cmdId) return getTopLevelSuggestions('');

        // Partial command: show top-level matches.
        if (!hasSpace && !command) {
            return getTopLevelSuggestions(cmdId);
        }

        // Exact command, even before the trailing space: show command-scoped options.
        if (command && !hasSpace) {
            const commandSuggestions = getCommandArgSuggestions(command, cmdId, '');
            return commandSuggestions.length > 0 ? commandSuggestions : getTopLevelSuggestions(cmdId);
        }

        if (command) {
            return getCommandArgSuggestions(command, cmdId, args);
        }

        return [];
    }

    return {
        register,
        getCommand,
        getAllCommands,
        handle,
        getSuggestions,
        clearCommandModes
    };
})();