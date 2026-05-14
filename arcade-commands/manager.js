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
        const cleanText = text.trim();
        const isSlash = cleanText.startsWith('/');
        const isBracket = cleanText.startsWith('[') && cleanText.includes(']');
        
        if (!isSlash && !isBracket) return false;

        let cmdId = "";
        let args = "";

        if (isSlash) {
            const parts = cleanText.split(/\s+/);
            cmdId = parts[0].substring(1).toLowerCase();
            args = parts.slice(1).join(' ').trim();
        } else {
            const match = cleanText.match(/^\[(.*?)\]\s*(.*)$/);
            if (match) {
                cmdId = match[1].toLowerCase();
                args = match[2].trim();
            }
        }

        const command = getCommand(cmdId);
        if (command) {
            return await command.execute(args, inputElement);
        }

        return false;
    }

    return {
        register,
        getCommand,
        getAllCommands,
        handle
    };
})();
