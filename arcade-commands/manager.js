/**
 * Arcade Command Manager
 * Orchestrates the registration and execution of slash commands.
 */
window.ArcadeCommandManager = (function() {
    const commands = new Map();

    function register(cmdObj) {
        if (!cmdObj.id) return;
        commands.set(cmdObj.id.toLowerCase(), cmdObj);
        console.log(`[Command Manager] Registered: /${cmdObj.id}`);
    }

    function getCommand(id) {
        return commands.get(id.toLowerCase());
    }

    function getAllCommands() {
        return Array.from(commands.values());
    }

    async function handle(text, inputElement) {
        let currentText = text.trim();
        let handledSomething = false;
        let lastResult = false;
        
        // Initialize or clear command modes stack
        window.activeArcadeCommandModes = [];

        // Support stacked commands (e.g. /edit /fix)
        while (currentText.startsWith('/') || currentText.startsWith('[')) {
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
                
                // Track all commands in the chain
                if (!window.activeArcadeCommandModes.includes(`/${cmdId}`)) {
                    window.activeArcadeCommandModes.push(`/${cmdId}`);
                }

                // If execute returns true, it means it handled everything (no AI needed)
                lastResult = await command.execute(args, inputElement);
                if (lastResult === true) return true;
                
                // If it returns false, it means "continue to AI or next command"
                currentText = args;
                if (!currentText) break;
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
                    window.activeArcadeCommandModes = [`/${cmdId}`];
                    return await command.execute(aliasMatch[2].trim(), inputElement);
                }
            }
        }

        if (handledSomething && inputElement) {
            inputElement.value = currentText;
        }

        return lastResult; // Return the result of the last command (e.g. false for AI commands)
    }

    function getSuggestions(text) {
        const cleanText = text.trim();
        if (!cleanText.startsWith('/')) return [];

        const parts = cleanText.split(/\s+/);
        const cmdId = parts[0].substring(1).toLowerCase();
        const args = parts.slice(1).join(' ');

        const command = getCommand(cmdId);
        
        // If it's just the command part (no space yet), return top-level matches
        if (!cleanText.includes(' ')) {
            const query = cmdId;
            return getAllCommands()
                .filter(c => c.id.toLowerCase().startsWith(query))
                .map(c => ({
                    id: c.id,
                    name: `/${c.id}`,
                    description: c.description,
                    isTopLevel: true
                }));
        }

        // If we have a command and it provides suggestions for its args
        if (command && typeof command.getSuggestions === 'function') {
            return command.getSuggestions(args).map(s => ({
                ...s,
                commandId: cmdId
            }));
        }

        return [];
    }

    return {
        register,
        getCommand,
        getAllCommands,
        handle,
        getSuggestions
    };
})();
