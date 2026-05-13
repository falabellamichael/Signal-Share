import fs from 'fs';
const path = 'arcade-chat.js';
let content = fs.readFileSync(path, 'utf8');

// The file is corrupted with multiple versions of sendChatMessage and bridge polling.
// We will find the FIRST occurrence of sendChatMessage and the LAST occurrence of startNewChat
// and replace everything in between.

const sendChatMarker = "window.sendChatMessage = async function() {";
const startNewChatMarker = "window.startNewChat = startNewChat;";

const firstSendChat = content.indexOf(sendChatMarker);
const lastStartNewChat = content.lastIndexOf(startNewChatMarker);

if (firstSendChat !== -1 && lastStartNewChat !== -1) {
    const correctSendChatMessage = `window.sendChatMessage = async function() {
    if (isSendingChatMessage) return;
    isSendingChatMessage = true;
    
    const input = document.getElementById('arc-chat-input');
    if (!input) {
        isSendingChatMessage = false;
        return;
    }
    const text = input.value.trim();
    if (!text) {
        isSendingChatMessage = false;
        return;
    }

    try {
        const attachmentData = currentChatAttachment;
        const attachmentType = currentChatAttachmentType;
        const attachmentName = currentChatAttachmentName;
        
        addChatMessage('user', text);

        // Check for local intents/actions via the Chatbot Engine
        if (window.ArcadeChatbotEngine) {
            const intentReply = window.ArcadeChatbotEngine.processIntent(text);
            if (intentReply) {
                const typingId = addTypingIndicator();
                setTimeout(() => {
                    removeTypingIndicator(typingId);
                    addChatMessage('ai', intentReply);
                    arcadeChatHistory.push({ role: 'assistant', content: intentReply });
                    saveCurrentChat();
                    updateChatStatus('idle');
                }, 600);
                
                input.value = '';
                clearChatAttachment();
                isSendingChatMessage = false;
                return;
            }
        }

        // Add to history with attachment if present
        arcadeChatHistory.push({ 
            role: 'user', 
            content: text,
            attachment: attachmentData ? {
                data: attachmentData,
                type: attachmentType,
                name: attachmentName
            } : null
        });
        
        input.value = '';
        clearChatAttachment();
        
        // Refresh bridge context on demand so AI has latest info
        if (typeof pollDesktopBridge === 'function') {
            await pollDesktopBridge();
        }
        
        const typingId = addTypingIndicator();
        let activeAiAbortController = new AbortController();
        const { signal } = activeAiAbortController;

        window.stopArcadeAi = function() {
            if (activeAiAbortController) {
                activeAiAbortController.abort();
                activeAiAbortController = null;
                removeTypingIndicator(typingId);
                addChatMessage('assistant', '🕹️ [Arcade Protocol]: Intelligence process terminated by user.');
            }
        };

        let reply = null;
        let lastError = null;

        // Prepare rich context for the AI
        let richContext = {
            page: {
                title: document.title,
                url: window.location.href,
                category: typeof currentCategory !== 'undefined' ? currentCategory : 'unknown'
            },
            user: (window.state && window.state.currentUser) ? {
                id: window.state.currentUser.id,
                email: window.state.currentUser.email,
                isBanned: window.state.currentUserBanned
            } : "Guest",
            media: (window.heroMediaPlayerState) ? {
                title: window.heroMediaPlayerState.title,
                meta: window.heroMediaPlayerState.meta,
                playback: window.heroMediaPlayerState.playbackState
            } : "Inactive",
            gameStats: (typeof window.getAllGameStats === 'function') ? window.getAllGameStats() : "Unavailable",
            ui: {
                messengerOpen: !!(window.state && window.state.messengerOpen),
                sidebarOpen: !!document.querySelector('.steam-chat-sidebar.active')
            }
        };

        const pageContext = JSON.stringify(richContext);
        const pageText = document.body.innerText.substring(0, 800);

        try {
            const response = await bridgeFetch('/api/llm/chat', {
                method: 'POST',
                signal,
                body: JSON.stringify({ 
                    message: text,
                    attachment: arcadeChatHistory[arcadeChatHistory.length - 1].attachment,
                    history: arcadeChatHistory.map(m => ({ role: m.role, content: m.content })),
                    pageContext: \`\${pageContext} (Visible text: \${pageText})\`
                })
            });

            if (response.ok) {
                const data = await response.json();
                reply = data.reply;
            } else {
                lastError = \`Bridge returned \${response.status}\`;
            }
        } catch (err) {
            lastError = err.message || "Connection refused or blocked by browser";
            console.warn(\`[Arcade Chat] Bridge request failed:\`, err);
        } finally {
            removeTypingIndicator(typingId);
        }

        if (reply !== null) {
            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');
        } else {
            console.warn(\`[Arcade Chat] Primary bridge failed (\${lastError}). Switching to Offline Protocol.\`);
            const offlineReply = getArcadeProtocolOfflineResponse(text);
            addChatMessage('ai', offlineReply);
            
            arcadeChatHistory.push({ role: 'assistant', content: offlineReply });
            saveCurrentChat();
            updateChatStatus('offline');
        }
    } catch (e) {
        console.error("[Arcade Chat] Error in sendChatMessage:", e);
    } finally {
        isSendingChatMessage = false;
    }
}

`;

    const newContent = content.substring(0, firstSendChat) + correctSendChatMessage + content.substring(lastStartNewChat);
    fs.writeFileSync(path, newContent, 'utf8');
    console.log("Successfully restored arcade-chat.js");
} else {
    console.error("Markers not found");
}
