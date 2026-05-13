import fs from 'fs';
const path = 'arcade-chat.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

// Find the area between stopArcadeAi and bridgePollTimer
const stopAiIndex = lines.findIndex(line => line.includes('window.stopArcadeAi = function() {'));
const pollTimerIndex = lines.findIndex(line => line.includes('let bridgePollTimer = null;'));

if (stopAiIndex !== -1 && pollTimerIndex !== -1) {
    const newMiddle = [
        "        window.stopArcadeAi = function() {",
        "            if (activeAiAbortController) {",
        "                activeAiAbortController.abort();",
        "                activeAiAbortController = null;",
        "                removeTypingIndicator(typingId);",
        "                addChatMessage('assistant', '🕹️ [Arcade Protocol]: Intelligence process terminated by user.');",
        "            }",
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
        "                body: JSON.stringify({ ",
        "                    message: text,",
        "                    attachment: arcadeChatHistory[arcadeChatHistory.length - 1].attachment,",
        "                    history: arcadeChatHistory.map(m => ({ role: m.role, content: m.content })),",
        "                    pageContext: `${pageContext} (Visible text: ${pageText})`",
        "                })",
        "            });",
        "",
        "            if (response.ok) {",
        "                const data = await response.json();",
        "                reply = data.reply;",
        "            } else {",
        "                lastError = `Bridge returned ${response.status}`;",
        "            }",
        "        } catch (err) {",
        "            lastError = err.message || \"Connection refused or blocked by browser\";",
        "            console.warn(`[Arcade Chat] Bridge request failed:`, err);",
        "        } finally {",
        "            removeTypingIndicator(typingId);",
        "        }",
        ""
    ];
    
    const finalLines = [
        ...lines.slice(0, stopAiIndex),
        ...newMiddle,
        ...lines.slice(pollTimerIndex)
    ];
    
    fs.writeFileSync(path, finalLines.join('\n'), 'utf8');
    console.log("Successfully fixed arcade-chat.js logic and context.");
} else {
    console.error("Could not find stopAiIndex or pollTimerIndex");
}
