/**
 * Signal Share Arcade Chat System
 * Shared component for cross-page companion interactions.
 */

const BRIDGE_BASE_URL = "http://127.0.0.1:3000";

function getBridgeSecret() {
    return localStorage.getItem("signal-share-bridge-secret") || "";
}

async function bridgeFetch(path, options = {}) {
    const method = options.method || "GET";
    const headers = {
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
        ...(getBridgeSecret() ? { "X-Bridge-Secret": getBridgeSecret() } : {}),
        ...(options.headers || {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 1500);

    try {
        return await fetch(`${BRIDGE_BASE_URL}${path}`, {
            method,
            mode: "cors",
            cache: "no-store",
            credentials: "omit",
            ...options,
            headers,
            signal: options.signal || controller.signal,
            // Only apply 'private' for LAN IPs. 127.0.0.1 is 'loopback' and should not have this header
            ...(BRIDGE_BASE_URL.includes('127.0.0.1') || BRIDGE_BASE_URL.includes('localhost') ? {} : { targetAddressSpace: 'private' })
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function getDesktopBridgeSnapshot() {
    const res = await bridgeFetch("/api/system-media/current");
    if (!res.ok) return null;
    return res.json();
}

async function sendDesktopBridgeAction(action, appPackage = "") {
    const res = await bridgeFetch("/api/system-media/action", {
        method: "POST",
        body: JSON.stringify({ action, appPackage }),
    });

    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data?.ok);
}

let bridgePollTimer = null;
let bridgePollInFlight = false;
let bridgeEnabled = false;

/**
 * Starts background polling for the desktop bridge state.
 */
function startDesktopBridgePolling() {
    // Background polling removed to avoid duplicate intervals and reduce lag.
    // The bridge will be polled on-demand when chat is opened or a message is sent.
    bridgeEnabled = true;
    pollDesktopBridge();
}

/**
 * Stops background polling.
 */
function stopDesktopBridgePolling() {
    bridgeEnabled = false;
    clearInterval(bridgePollTimer);
    bridgePollTimer = null;
}

/**
 * Executes a single poll request to the desktop bridge.
 */
async function pollDesktopBridge() {
    if (!bridgeEnabled || bridgePollInFlight) return;

    bridgePollInFlight = true;
    try {
        const snapshot = await getDesktopBridgeSnapshot();
        if (snapshot) {
            // Update global state if available
            if (window.state) {
                window.state.desktopSnapshot = snapshot;
            }
            // Notify hero player controller if available
            if (window.heroMediaPlayerController && typeof window.heroMediaPlayerController.render === 'function') {
                window.heroMediaPlayerController.render();
            }
            updateEngineStatus(true);
        } else {
            updateEngineStatus(false);
        }
    } catch (_error) {
        updateEngineStatus(false);
    } finally {
        bridgePollInFlight = false;
    }
}

/**
 * Updates the chat input placeholder with a random suggestion.
 */
function updateChatPlaceholder() {
    const input = document.getElementById('arc-chat-input');
    if (!input) return;

    const suggestions = [
        "Ask to play Spotify...",
        "Ask to open YouTube...",
        "Ask to play a game...",
        "How can I help you today?",
        "Ask for gaming advice...",
        "Ask to open the library...",
        "Say 'Play some music'...",
        "Say 'Open Pinball'...",
        "Ask to see the leaderboard...",
        "Ask to open the shop...",
        "Ask for gameplay tips...",
        "Ask to see your high scores..."
    ];

    const randomSuggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    input.placeholder = randomSuggestion;
}

/**
 * Updates the Engine Status UI indicator if it exists on the page.
 * @param {boolean} online - Whether the bridge is connected
 */
function updateEngineStatus(online) {
    const statusText = document.getElementById('engine-status-text');
    const statusDot = document.getElementById('engine-status-dot');
    const statusContainer = document.getElementById('engine-status-container');
    
    if (!statusText || !statusDot) return;
    
    if (online) {
        statusText.textContent = 'LOCAL LLM ONLINE';
        if (statusContainer) statusContainer.style.color = '#75b022';
        statusDot.style.background = '#75b022';
        statusDot.style.boxShadow = '0 0 8px #75b022';
    } else {
        statusText.textContent = 'BRIDGE OFFLINE';
        if (statusContainer) statusContainer.style.color = '#e74c3c';
        statusDot.style.background = '#e74c3c';
        statusDot.style.boxShadow = '0 0 8px #e74c3c';
    }
}

let arcadeChatHistory = [];
let currentChatId = null;
let currentChatAttachment = null;
let currentChatAttachmentType = null;
let currentChatAttachmentName = null;

/**
 * Handles image, video, or file selection for the chat.
 */
window.handleChatFileSelect = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    currentChatAttachmentName = file.name;
    const reader = new FileReader();
    reader.onload = function(e) {
        currentChatAttachment = e.target.result;
        const preview = document.getElementById('chat-attachment-preview');
        const img = document.getElementById('chat-preview-img');
        const video = document.getElementById('chat-preview-video');
        const fileDiv = document.getElementById('chat-preview-file');
        const fileName = document.getElementById('chat-preview-filename');

        if (!preview) return;
        preview.hidden = false;

        // Reset all
        if (img) img.style.display = 'none';
        if (video) video.style.display = 'none';
        if (fileDiv) fileDiv.style.display = 'none';

        if (file.type.startsWith('image/')) {
            currentChatAttachmentType = 'image';
            if (img) {
                img.src = currentChatAttachment;
                img.style.display = 'block';
            }
        } else if (file.type.startsWith('video/')) {
            currentChatAttachmentType = 'video';
            if (video) {
                video.src = currentChatAttachment;
                video.style.display = 'block';
            }
        } else {
            currentChatAttachmentType = 'file';
            if (fileDiv && fileName) {
                fileName.textContent = file.name;
                fileDiv.style.display = 'flex';
            }
        }
    };
    reader.readAsDataURL(file);
};

/**
 * Clears the current chat attachment.
 */
window.clearChatAttachment = function() {
    currentChatAttachment = null;
    currentChatAttachmentType = null;
    currentChatAttachmentName = null;
    const preview = document.getElementById('chat-attachment-preview');
    const fileInput = document.getElementById('chat-file-input');
    if (preview) preview.hidden = true;
    if (fileInput) fileInput.value = '';
};

function updateChatStatus(status) {
    const dot = document.getElementById('chat-status-dot');
    const title = document.getElementById('chat-mode-title');
    if (!dot || !title) return;

    switch (status) {
        case 'active': // Green: Local LLM Active
            dot.style.background = '#2ecc71';
            dot.style.boxShadow = '0 0 10px #2ecc71';
            title.style.color = '#2ecc71';
            title.textContent = 'A.I. Active';
            break;
        case 'idle': // Blue: Chatbot Only
            dot.style.background = '#67c1f5';
            dot.style.boxShadow = '0 0 8px #67c1f5';
            title.style.color = '#67c1f5';
            title.textContent = 'Companion';
            break;
        case 'error': // Red: Connection Error
            dot.style.background = '#e74c3c';
            dot.style.boxShadow = '0 0 12px #e74c3c';
            title.style.color = '#e74c3c';
            title.textContent = 'Bridge Error';
            break;
    }
}


function cleanupOldChats() {
    const chats = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    
    const filteredChats = chats.filter(chat => {
        const lastUsed = chat.lastUsed || 0;
        return (now - lastUsed) < sevenDaysMs;
    });
    
    if (filteredChats.length !== chats.length) {
        localStorage.setItem('arcade-chats', JSON.stringify(filteredChats));
        console.log(`[Arcade Chat] Cleaned up ${chats.length - filteredChats.length} old chats.`);
    }
}

function startNewChat() {
    currentChatId = 'chat_' + Date.now();
    arcadeChatHistory = [];
    const container = document.getElementById('chat-messages');
    if (container) {
        container.innerHTML = `
            <div class="chat-message message-ai">
                Hello! I'm your local arcade assistant. How can I help you optimize your gameplay today?
            </div>
        `;
    }
    updateChatStatus('idle');
    showChatView();
    updateChatPlaceholder();
    saveCurrentChat();
}

function saveCurrentChat() {
    if (!currentChatId) return;
    
    const chats = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
    const existingIdx = chats.findIndex(c => c.id === currentChatId);
    
    const chatObj = {
        id: currentChatId,
        name: arcadeChatHistory.length > 0 ? arcadeChatHistory[0].content.substring(0, 30) + (arcadeChatHistory[0].content.length > 30 ? '...' : '') : 'New Session',
        messages: arcadeChatHistory,
        lastUsed: Date.now()
    };

    if (existingIdx >= 0) {
        chats[existingIdx] = chatObj;
    } else {
        chats.unshift(chatObj);
    }

    localStorage.setItem('arcade-chats', JSON.stringify(chats));
    localStorage.setItem('arcade-last-chat-id', currentChatId);
}

function loadChat(id) {
    const chats = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
    const chat = chats.find(c => c.id === id);
    if (chat) {
        currentChatId = chat.id;
        arcadeChatHistory = chat.messages || [];
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = `
                <div class="chat-message message-ai">
                    Hello! I'm your local arcade assistant. How can I help you optimize your gameplay today?
                </div>
            `;
            
            arcadeChatHistory.forEach(msg => {
                addChatMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
            });
            container.scrollTop = container.scrollHeight;
        }
        
        updateChatStatus('idle');
        showChatView();
        
        chat.lastUsed = Date.now();
        localStorage.setItem('arcade-chats', JSON.stringify(chats));
    }
}
window.loadChat = loadChat;

window.toggleChatHistory = function() {
    const messages = document.getElementById('chat-messages');
    const historyView = document.getElementById('chat-history');
    const title = document.getElementById('chat-mode-title');
    const inputArea = document.querySelector('.chat-input-area');

    if (!messages || !historyView) return;

    if (historyView.style.display === 'flex' || historyView.style.display === 'block') {
        showChatView();
    } else {
        messages.style.display = 'none';
        historyView.style.display = 'block';
        if (inputArea) {
            inputArea.style.opacity = '0.3';
            inputArea.style.pointerEvents = 'none';
        }
        if (title) title.textContent = 'Chat History';
        renderHistoryList();
    }
}

function showChatView() {
    const messages = document.getElementById('chat-messages');
    const historyView = document.getElementById('chat-history');
    const inputArea = document.querySelector('.chat-input-area');
    const title = document.getElementById('chat-mode-title');

    if (messages) messages.style.display = 'flex';
    if (historyView) historyView.style.display = 'none';
    if (inputArea) {
        inputArea.style.opacity = '1';
        inputArea.style.pointerEvents = 'all';
    }
    updateChatStatus('idle');
}

function renderHistoryList() {
    const container = document.getElementById('chat-history');
    const chats = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
    if (!container) return;
    
    if (chats.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.3; font-size: 0.8rem;">No chat history yet.</div>';
        return;
    }

    container.innerHTML = chats.map(chat => {
        const date = new Date(chat.lastUsed).toLocaleDateString();
        const time = new Date(chat.lastUsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="chat-history-item" onclick="loadChat('${chat.id}')">
                <div class="history-name">${chat.name}</div>
                <div class="history-meta">
                    <span>${chat.messages.length} messages</span>
                    <span>${date} ${time}</span>
                </div>
            </div>
        `;
    }).join('');
}

function addChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message message-${role === 'ai' ? 'ai' : 'user'}`;
    
    if (content.includes('```')) {
        const parts = content.split('```');
        parts.forEach((part, index) => {
            if (index % 2 === 0) {
                const paragraphs = part.split(/\n\n+/);
                paragraphs.forEach(para => {
                    if (para.trim()) {
                        const p = document.createElement('p');
                        p.textContent = para.trim();
                        msgDiv.appendChild(p);
                    }
                });
            } else {
                const lines = part.split('\n');
                const lang = lines[0].trim();
                const code = lines.slice(1).join('\n').trim();
                const pre = document.createElement('pre');
                pre.className = 'chat-code-block';
                pre.setAttribute('data-lang', lang || 'code');
                pre.textContent = code;
                msgDiv.appendChild(pre);
            }
        });
    } else {
        msgDiv.textContent = content;
    }

    // Handle multimedia attachments if present
    const msgObj = arcadeChatHistory.find(m => m.content === content && m.role === (role === 'ai' ? 'assistant' : 'user') && m.attachment);
    
    let attachmentToRender = null;
    if (msgObj && msgObj.attachment) {
        attachmentToRender = msgObj.attachment;
    } else if (role === 'user' && currentChatAttachment) {
        attachmentToRender = {
            data: currentChatAttachment,
            type: currentChatAttachmentType,
            name: currentChatAttachmentName
        };
    }

    if (attachmentToRender) {
        if (attachmentToRender.type === 'image') {
            const img = document.createElement('img');
            img.src = attachmentToRender.data;
            img.className = 'chat-message-image';
            msgDiv.appendChild(img);
        } else if (attachmentToRender.type === 'video') {
            const video = document.createElement('video');
            video.src = attachmentToRender.data;
            video.className = 'chat-message-video';
            video.controls = true;
            msgDiv.appendChild(video);
        } else if (attachmentToRender.type === 'file') {
            const fileLink = document.createElement('a');
            fileLink.href = attachmentToRender.data;
            fileLink.download = attachmentToRender.name || 'file';
            fileLink.className = 'chat-message-file';
            fileLink.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <span>${attachmentToRender.name || 'Download File'}</span>
            `;
            msgDiv.appendChild(fileLink);
        }
    }

    // Process [ARCADE: action] tags
    const arcadeMatch = content.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
        const action = arcadeMatch[1].trim().toLowerCase();
        executeArcadeAction(action);
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function executeArcadeAction(action) {
    console.log(`[Arcade Chat] Executing Protocol Action: ${action}`);
    
    // Most actions are available as global functions in mini-games.js
    try {
        switch (action) {
            case 'pinball':
                if (typeof window.launchPinball === 'function') window.launchPinball();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('pinball');
                break;
            case 'snake':
                if (typeof window.launchSnake === 'function') window.launchSnake();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('snake');
                break;
            case 'hoops':
            case 'basketball':
                if (typeof window.launchBasketball === 'function') window.launchBasketball();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('basketball');
                break;
            case 'calc':
            case 'calculator':
                if (typeof window.launchCalc === 'function') window.launchCalc();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('calc');
                break;
            case 'leaderboards':
            case 'leaderboard':
                if (typeof window.setCategory === 'function') window.setCategory('leaderboard');
                break;
            case 'shop':
            case 'store':
                if (typeof window.setCategory === 'function') window.setCategory('store');
                break;
            case 'library':
            case 'games':
                if (typeof window.setCategory === 'function') window.setCategory('all');
                break;
            case 'home':
                if (typeof window.setCategory === 'function') window.setCategory('all');
                break;
            default:
                console.warn(`[Arcade Chat] Unknown protocol action: ${action}`);
        }
    } catch (err) {
        console.error(`[Arcade Chat] Failed to execute ${action}:`, err);
    }
}

function addTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container) return null;
    const id = 'typing_' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = 'chat-message message-ai';
    msgDiv.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

let isSendingChatMessage = false;

window.sendChatMessage = async function() {
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

        // Prepare context
        const pageContext = document.title || 'Signal Share';
        const pageText = document.body.innerText.substring(0, 1000);

        try {
            const response = await bridgeFetch('/api/llm/chat', {
                method: 'POST',
                signal,
                body: JSON.stringify({ 
                    message: text,
                    attachment: arcadeChatHistory[arcadeChatHistory.length - 1].attachment,
                    history: arcadeChatHistory.map(m => ({ role: m.role, content: m.content })),
                    pageContext: `${pageContext} (Visible text: ${pageText})`
                })
            });

            if (response.ok) {
                const data = await response.json();
                reply = data.reply;
            } else {
                lastError = `Bridge returned ${response.status}`;
            }
        } catch (err) {
            lastError = err.message || "Connection refused or blocked by browser";
            console.warn(`[Arcade Chat] Bridge request failed:`, err);
        } finally {
            removeTypingIndicator(typingId);
        }

        if (reply !== null) {
            addChatMessage('ai', reply || "...");
            arcadeChatHistory.push({ role: 'assistant', content: reply });
            saveCurrentChat();
            updateChatStatus('active');
        } else {
            console.warn(`[Arcade Chat] Primary bridge failed (${lastError}). Switching to Offline Protocol.`);
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

window.startNewChat = startNewChat;

function setupResizing() {
    const handle = document.getElementById('chat-resize-handle');
    const sidebar = document.querySelector('.steam-chat-sidebar');
    const shell = document.querySelector('.steam-shell') || document.querySelector('.page-shell');
    let isResizing = false;
    let initialMax = 0;

    if (!handle || !sidebar || !shell) return;

    const onMove = (e) => {
        if (!isResizing) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        handleResize(clientX);
    };

    const onEnd = () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        }
    };

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        initialMax = sidebar.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    });

    handle.addEventListener('touchstart', (e) => {
        isResizing = true;
        initialMax = sidebar.offsetWidth;
        handle.classList.add('active');
        document.body.style.userSelect = 'none';
        
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }, { passive: true });

    function handleResize(clientX) {
        const isFixed = window.getComputedStyle(sidebar).position === 'fixed';
        let newWidth;
        
        if (isFixed) {
            newWidth = window.innerWidth - clientX;
        } else {
            const shellRect = shell.getBoundingClientRect();
            newWidth = shellRect.right - clientX;
        }

        if (newWidth > initialMax) newWidth = initialMax;
        if (newWidth < 280) newWidth = 280;
        
        if (!isFixed && shell.classList.contains('steam-shell')) {
            // In integrated mode, we resize the TILES section (column 2) 
            // and the chat (column 4) fills the rest.
            const tilesWidth = clientX - 240; // 240 is the fixed left sidebar
            const clampedTilesWidth = Math.max(300, Math.min(tilesWidth, window.innerWidth - 600));
            shell.style.gridTemplateColumns = `240px ${clampedTilesWidth}px 6px 1fr`;
        } else {
            sidebar.style.width = `${newWidth}px`;
            if (isFixed && handle) {
                handle.style.right = `${newWidth}px`;
            }
        }
        
        // Dynamic toggle button and messenger elements position
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        const messengerBtn = document.querySelector('.messenger-launcher');
        const messengerSection = document.querySelector('.messenger-section');
        
        if (!sidebar.classList.contains('collapsed')) {
            const gapWidth = newWidth + 20;
            const appRunner = document.getElementById('app-runner');
            if (toggleBtn) toggleBtn.style.right = `${gapWidth}px`;
            if (messengerBtn) messengerBtn.style.setProperty('right', `${gapWidth}px`, 'important');
            if (messengerSection) messengerSection.style.setProperty('right', `${gapWidth}px`, 'important');
            if (appRunner) appRunner.style.right = `${newWidth}px`;
        }
    }
}


window.toggleChat = function() {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    const handle = document.querySelector('.chat-resize-handle');
    const shell = document.querySelector('.steam-shell');
    
    if (!sidebar) return;
    
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('chat-collapsed', isCollapsed);

    // Randomize placeholder when opening
    if (!isCollapsed) {
        updateChatPlaceholder();
    }
    
    // Update grid if in integrated mode
    if (shell) {
        if (isCollapsed) {
            shell.style.gridTemplateColumns = '240px 1fr 0px 0px';
        } else {
            shell.style.gridTemplateColumns = '240px 1fr 6px 380px';
        }
    }
    
    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const messengerBtn = document.querySelector('.messenger-launcher');
    const messengerSection = document.querySelector('.messenger-section');
    
    if (toggleBtn) toggleBtn.style.right = '';
    if (messengerBtn) messengerBtn.style.setProperty('right', '', '');
    if (messengerSection) messengerSection.style.setProperty('right', '', '');
    
    if (handle) handle.classList.toggle('collapsed', isCollapsed);
    
    localStorage.setItem('arcade-chat-collapsed', isCollapsed);
};


function setupToggle() {
    // Create toggle button regardless of mode, CSS will handle visibility
    if (!document.querySelector('.chat-toggle-btn')) {
        const btn = document.createElement('button');
        // Robust detection: Check for .steam-shell anywhere in the document
        const isSteamShell = document.querySelector('.steam-shell') || document.documentElement.classList.contains('is-steam-shell');
        
        console.log('[Arcade Chat] Initializing toggle. Steam Shell detected:', !!isSteamShell);
        
        if (isSteamShell) {
            btn.className = 'chat-toggle-btn chat-tab-mode';
            btn.innerHTML = `
                <div class="tab-label" style="writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.65rem; font-weight: 900; letter-spacing: 2.5px; color: #67c1f5; text-transform: uppercase; pointer-events: none;">Companion</div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color: #67c1f5; margin-top: 8px; pointer-events: none;">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            `;
        } else {
            btn.className = 'chat-toggle-btn';
            btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
        }
        
        btn.onclick = window.toggleChat;
        document.body.appendChild(btn);
    }
}

// Initialization - Runs after all functions are defined
(function initChat() {
    cleanupOldChats();
    const lastChatId = localStorage.getItem('arcade-last-chat-id');
    if (lastChatId && window.loadChat) {
        window.loadChat(lastChatId);
    } else {
        startNewChat();
    }
    setupResizing();
    setupToggle();
    startDesktopBridgePolling();
    updateChatStatus('idle');
    
    // Restore collapsed state
    const isSteamShell = document.querySelector('.steam-shell') || document.documentElement.classList.contains('is-steam-shell');
    let wasCollapsed = localStorage.getItem('arcade-chat-collapsed');
    
    // Default to collapsed (tab mode) on the games page if no preference exists
    if (wasCollapsed === null && isSteamShell) {
        wasCollapsed = 'true';
    } else {
        wasCollapsed = wasCollapsed === 'true';
    }

    if (wasCollapsed) {
        const sidebar = document.querySelector('.steam-chat-sidebar');
        const handle = document.querySelector('.chat-resize-handle');
        const shell = document.querySelector('.steam-shell');
        
        if (sidebar) sidebar.classList.add('collapsed');
        if (handle) handle.classList.add('collapsed');
        document.body.classList.add('chat-collapsed');
        
        if (shell) {
            shell.style.gridTemplateColumns = '240px 1fr 0px 0px';
        }
    } else {
        updateChatPlaceholder();
    }
})();

/**
 * Provides arcade-themed responses when the backend is unreachable.
 */
function getArcadeProtocolOfflineResponse(message) {
    const input = message.toLowerCase();
    
    const responses = [
        { 
            keywords: ["pinball", "gravity"], 
            answer: "🕹️ [Arcade Protocol]: In Neon Pinball, keep your eyes on the top bumpers. Hitting them in sequence triggers the 'Gravity Shift' multiplier, which can triple your score in seconds!" 
        },
        { 
            keywords: ["basketball", "hoops", "shot"], 
            answer: "🏀 [Arcade Protocol]: For Neon Hoops, consistency is key. Try to release the ball at the peak of your swipe for a 'Perfect' shot bonus. The net gets smaller as your streak increases!" 
        },
        { 
            keywords: ["snake", "wrap", "trap"], 
            answer: "🐍 [Arcade Protocol]: In Neon Snake, the board is edge-wrapped. If you're about to crash, move through the wall to appear on the other side. Use this to surprise high-value fruit!" 
        },
        { 
            keywords: ["hello", "hi", "hey"], 
            answer: "👋 [Arcade Protocol]: Intelligence core is currently offline, but I am standing by for tactical support. Ask me about the games or how to improve your high score!" 
        },
        { 
            keywords: ["help", "what can you do"], 
            answer: "🎮 [Arcade Protocol]: I am your tactical game assistant. Even in offline mode, I can provide tips for Pinball, Hoops, and Snake. Just ask about a specific game!" 
        },
        { 
            keywords: ["thank", "thanks"], 
            answer: "🕹️ [Arcade Protocol]: You're welcome, player. Now get back in there and break that record!" 
        }
    ];

    for (const r of responses) {
        if (r.keywords.some(k => input.includes(k))) return r.answer;
    }

    return "📶 [Arcade Protocol]: My advanced logic core is currently out of range, but my tactical database is active. I can still give you tips for the arcade games—just name one!";
}
