/**
 * Signal Share Arcade Chat System
 * Shared component for cross-page companion interactions.
 */

let arcadeChatHistory = [];
let currentChatId = null;


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
    const title = document.getElementById('chat-mode-title');
    if (title) title.textContent = 'Companion';
    showChatView();
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
        
        const title = document.getElementById('chat-mode-title');
        if (title) title.textContent = 'Companion';
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
    if (title) title.textContent = 'Companion';
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

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
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

window.sendChatMessage = async function() {
    const input = document.getElementById('arc-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    addChatMessage('user', text);
    input.value = '';
    
    const typingId = addTypingIndicator();
    
    const candidates = [
        'http://localhost:3000/api/llm/chat',
        'http://127.0.0.1:3000/api/llm/chat',
        window.location.origin + '/api/llm/chat',
        '/api/llm/chat'
    ];

    let reply = null;
    let lastError = null;

    for (const url of candidates) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: text,
                    history: arcadeChatHistory,
                    pageContext: document.title || 'Signal Share'
                })
            });

            if (response.ok) {
                const data = await response.json();
                reply = data.reply;
                break;
            } else {
                lastError = `Status ${response.status}`;
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    removeTypingIndicator(typingId);

    if (reply) {
        addChatMessage('ai', reply);
        arcadeChatHistory.push({ role: 'user', content: text });
        arcadeChatHistory.push({ role: 'assistant', content: reply });
        saveCurrentChat();
    } else {
        addChatMessage('ai', `⚠️ [Connection Error] I couldn't reach my logic core. (Error: ${lastError})`);
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

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        initialMax = sidebar.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const isFixed = window.getComputedStyle(sidebar).position === 'fixed';
        let newWidth;
        
        if (isFixed) {
            newWidth = window.innerWidth - e.clientX;
        } else {
            const shellRect = shell.getBoundingClientRect();
            newWidth = shellRect.right - e.clientX;
        }

        if (newWidth > initialMax) newWidth = initialMax;
        if (newWidth < 280) newWidth = 280;
        
        if (!isFixed && shell.classList.contains('steam-shell')) {
            shell.style.gridTemplateColumns = `240px auto 6px ${newWidth}px`;
        } else {
            sidebar.style.width = `${newWidth}px`;
            if (isFixed && handle) {
                handle.style.right = `${newWidth}px`;
            }
        }
        
        // Dynamic toggle button and messenger launcher position
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        const messengerBtn = document.querySelector('.messenger-launcher');
        
        if (!sidebar.classList.contains('collapsed')) {
            if (toggleBtn) toggleBtn.style.right = `${newWidth + 20}px`;
            if (messengerBtn) {
                messengerBtn.style.setProperty('right', `${newWidth + 20}px`, 'important');
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}
window.toggleChat = function() {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    const handle = document.querySelector('.chat-resize-handle');
    
    if (!sidebar) return;
    
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('chat-collapsed', isCollapsed);
    
    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const messengerBtn = document.querySelector('.messenger-launcher');
    if (toggleBtn) toggleBtn.style.right = '';
    if (messengerBtn) messengerBtn.style.setProperty('right', '', '');
    
    if (handle) handle.classList.toggle('collapsed', isCollapsed);
    
    localStorage.setItem('arcade-chat-collapsed', isCollapsed);
};

function setupToggle() {
    // Add toggle button to DOM if it doesn't exist
    if (!document.querySelector('.chat-toggle-btn')) {
        const btn = document.createElement('button');
        btn.className = 'chat-toggle-btn';
        btn.onclick = window.toggleChat;
        btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
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
    
    // Restore collapsed state
    const wasCollapsed = localStorage.getItem('arcade-chat-collapsed') === 'true';
    if (wasCollapsed) {
        const sidebar = document.querySelector('.steam-chat-sidebar');
        const handle = document.querySelector('.chat-resize-handle');
        if (sidebar) sidebar.classList.add('collapsed');
        if (handle) handle.classList.add('collapsed');
        document.body.classList.add('chat-collapsed');
    }
})();
