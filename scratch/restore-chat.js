import fs from 'fs';
const path = 'arcade-chat.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

// Find the area around stopArcadeAi
const stopAiIndex = lines.findIndex(line => line.includes('window.stopArcadeAi = function() {'));
// Find where the broken body starts
const bodyIndex = lines.findIndex(line => line.includes('body: JSON.stringify({'));

if (stopAiIndex !== -1 && bodyIndex !== -1) {
    const startOfFix = stopAiIndex + 8; // End of stopArcadeAi block
    
    const newLines = [
        ...lines.slice(0, startOfFix),
        "        };",
        "",
        "        let reply = null;",
        "        let lastError = null;",
        "",
        "        // Prepare rich context for the AI",
        "        let richContext = {",
        "            page: {",
        "                title: document.title,",
        "                url: window.location.href,",
        "                category: typeof currentCategory !== 'undefined' ? currentCategory : 'unknown'",
        "            },",
        "            user: (window.state && window.state.currentUser) ? {",
        "                id: window.state.currentUser.id,",
        "                email: window.state.currentUser.email,",
        "                isBanned: window.state.currentUserBanned",
        "            } : \"Guest\",",
        "            media: (window.heroMediaPlayerState) ? {",
        "                title: window.heroMediaPlayerState.title,",
        "                meta: window.heroMediaPlayerState.meta,",
        "                playback: window.heroMediaPlayerState.playbackState",
        "            } : \"Inactive\",",
        "            gameStats: (typeof window.getAllGameStats === 'function') ? window.getAllGameStats() : \"Unavailable\",",
        "            ui: {",
        "                messengerOpen: !!(window.state && window.state.messengerOpen),",
        "                sidebarOpen: !!document.querySelector('.steam-chat-sidebar.active')",
        "            }",
        "        };",
        "",
        "        const pageContext = JSON.stringify(richContext);",
        "        const pageText = document.body.innerText.substring(0, 800);",
        "",
        "        try {",
        "            const response = await bridgeFetch('/api/llm/chat', {",
        "                method: 'POST',",
        "                signal,",
        ...lines.slice(bodyIndex)
    ];
    
    fs.writeFileSync(path, newLines.join('\n'), 'utf8');
    console.log("Successfully restored and enhanced arcade-chat.js");
} else {
    console.log("Could not find insertion points in arcade-chat.js");
}
