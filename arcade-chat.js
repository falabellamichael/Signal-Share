/**
 * Signal Share Arcade Chat System
 * Shared component for cross-page companion interactions.
 */

let BRIDGE_BASE_URL = localStorage.getItem('signal-share-bridge-url') || "http://127.0.0.1:3000";

// Dynamically resolve bridge URL for mobile/android if no custom URL is set
if (!localStorage.getItem('signal-share-bridge-url')) {
    if (document.documentElement.classList.contains('platform-android') || (window.Capacitor && window.Capacitor.getPlatform() === 'android')) {
        // 10.0.2.2 is the default bridge for Android emulators to reach the host PC
        BRIDGE_BASE_URL = "http://10.0.2.2:3000";
    }
}

function getBridgeTargetAddressSpace(baseUrl = "") {
    try {
        const parsed = new URL(baseUrl, window.location.href);
        const host = `${parsed.hostname || ""}`.trim().toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return "loopback";
        if (!host) return "";
        if (host.startsWith("10.") || host.startsWith("192.168.") || host === "10.0.2.2") return "private";
        const octets = host.split(".").map((value) => Number.parseInt(value, 10));
        if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
            if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return "private";
            if (octets[0] === 169 && octets[1] === 254) return "private";
        }
        if (host.endsWith(".local")) return "private";
    } catch (_error) {
        return "";
    }
    return "";
}

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
    const targetAddressSpace = getBridgeTargetAddressSpace(BRIDGE_BASE_URL);

    try {
        return await fetch(`${BRIDGE_BASE_URL}${path}`, {
            method,
            mode: "cors",
            cache: "no-store",
            credentials: "omit",
            ...options,
            headers,
            signal: options.signal || controller.signal,
            ...(targetAddressSpace ? { targetAddressSpace } : {})
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

    const suggestions = window.arcadeChatSuggestions || ["Ask for gaming advice..."];


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

function readArcadeChats() {
    try {
        const parsed = JSON.parse(localStorage.getItem('arcade-chats') || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

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
    const chats = readArcadeChats();
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

/**
 * Synchronizes the position of external UI elements (Messenger, Toggle, Runner)
 * based on the current sidebar width and state.
 */
window.syncArcadeSidebarOffsets = function() {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    if (!sidebar) return;

    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const messengerBtn = document.querySelector('.messenger-launcher');
    const messengerSection = document.querySelector('.messenger-section');
    const appRunner = document.getElementById('app-runner');
    const isCollapsed = sidebar.classList.contains('collapsed');

    if (!isCollapsed) {
        // Use offsetWidth for current real-time geometry, fallback to style width, then default 380
        const currentWidth = sidebar.offsetWidth || parseInt(sidebar.style.width) || 380;
        const gapWidth = currentWidth + 20;

        if (toggleBtn) toggleBtn.style.right = `${gapWidth}px`;
        if (messengerBtn) messengerBtn.style.setProperty('right', `${gapWidth}px`, 'important');
        
        if (messengerSection) {
            messengerSection.style.setProperty('right', `${gapWidth}px`, 'important');
            
            // Dynamically limit messenger width if it's expanded to prevent screen cutoff
            if (messengerSection.classList.contains('is-expanded')) {
                const availableWidth = window.innerWidth - gapWidth - 20; // 20px left margin
                messengerSection.style.maxWidth = `${availableWidth}px`;
                if (messengerSection.offsetWidth > availableWidth) {
                    messengerSection.style.width = `${availableWidth}px`;
                }
            } else {
                messengerSection.style.maxWidth = '';
                messengerSection.style.width = '';
            }
        }
        if (appRunner) appRunner.style.right = `${currentWidth}px`;
    } else {
        // Clear inline overrides so CSS defaults take over for collapsed state
        if (toggleBtn) toggleBtn.style.right = '';
        if (messengerBtn) messengerBtn.style.setProperty('right', '', '');
        if (messengerSection) {
            messengerSection.style.setProperty('right', '', '');
            messengerSection.style.maxWidth = '';
            messengerSection.style.width = '';
        }
        if (appRunner) appRunner.style.right = '';
    }
};

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
    
    const chats = readArcadeChats();
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
    const chats = readArcadeChats();
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
    const chats = readArcadeChats();
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
        // Strip internal protocol tags from display
        const cleanContent = content.replace(/\[ARCADE:\s*[^\]]+\]/g, "").trim();
        msgDiv.textContent = cleanContent;
        if (!cleanContent && content.includes("[ARCADE:")) {
            msgDiv.style.display = 'none';
        }
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

    // Process [COMPOSE: text] tags
    const composeMatch = content.match(/\[COMPOSE:\s*([^\]]+)\]/);
    if (composeMatch) {
        const composeText = composeMatch[1].trim();
        const msgInput = document.getElementById('messageInput');
        if (msgInput) {
            msgInput.value = composeText;
            msgInput.focus();
            // Automatically expand messenger if closed
            if (typeof openMessengerDock === 'function' && !window.state?.messengerOpen) {
                openMessengerDock({ expanded: true });
            }
        }
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

window.executeArcadeAction = function(action) {
    console.log(`[Arcade Chat] Executing Protocol Action: ${action}`);
    
    const triggerClick = (sel) => document.querySelector(sel)?.click();
    const navigate = (hash, fallback) => {
        if (hash.startsWith('#')) {
            const el = document.querySelector(hash);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth' });
                const link = document.querySelector(`a[href="${hash}"], [id="${hash.substring(1)}NavLink"]`);
                if (link) link.click();
            } else if (fallback) window.location.href = fallback + hash;
        } else window.location.href = hash;
    };
    const navigateToGames = (cat) => {
        if (typeof window.setCategory === 'function') window.setCategory(cat);
        else window.location.href = 'mini-games.html#' + cat;
    };
    const launchGame = (gid) => {
        const fn = { pinball: 'launchPinball', snake: 'launchSnake', basketball: 'launchBasketball', hoops: 'launchBasketball', calc: 'launchCalc' }[gid];
        if (fn && typeof window[fn] === 'function') window[fn]();
        else if (typeof window.showGameDetails === 'function') window.showGameDetails(gid);
        else window.location.href = `mini-games.html#${gid}`;
    };
    const setTheme = (tid) => {
        const btn = document.querySelector(`[data-theme-option="${tid}"]`);
        if (btn) btn.click();
        else if (typeof window.updateTheme === 'function') window.updateTheme(tid);
    };

    // Most actions are available as global functions in mini-games.js
    try {
                switch (action) {
            case 'pinball': launchGame('pinball'); break;
            case 'snake': launchGame('snake'); break;
            case 'hoops': case 'basketball': launchGame('basketball'); break;
            case 'calc': case 'calculator': launchGame('calc'); break;
            case 'library': case 'games': navigateToGames('all'); break;
            case 'shop': case 'store': navigateToGames('store'); break;
            case 'leaderboards': case 'leaderboard': navigateToGames('leaderboard'); break;
            case 'home': navigate('#top', 'index.html'); break;
            case 'feed': navigate('#feed'); break;
            case 'messages': case 'messenger': navigate('#messages'); break;
            case 'profile': case 'view_my_profile': navigate('#profileView'); break;
            case 'account': navigate('#account'); break;
            case 'settings': triggerClick('#settingsToggleButton'); break;
            case 'upload': case 'compose': navigate('#compose'); break;
            case 'notifications': case 'notifications_panel': triggerClick('#notificationBell'); break;
            case 'admin_panel': case 'moderation': triggerClick('#adminBanLauncherButton'); break;
            case 'ban_list': triggerClick('#adminBanLauncherButton'); break;
            case 'toggle_sidebar': case 'toggle_chat': triggerClick('.chat-toggle-btn'); break;
            case 'toggle_messenger': triggerClick('#messengerLauncherButton'); break;
            case 'toggle_player': case 'toggle_mini_player': triggerClick('.mini-player-head'); break;
            case 'expand_viewer': triggerClick('#messengerExpandButton'); break;
            case 'close_viewer': triggerClick('#viewerCloseButton'); break;
            case 'collapse_viewer': triggerClick('#viewerCollapseButton'); break;
            case 'theme_sunset': setTheme('sunset'); break;
            case 'theme_midnight': setTheme('midnight'); break;
            case 'theme_paper': setTheme('paper'); break;
            case 'theme_ember': setTheme('ember'); break;
            case 'theme_forest': setTheme('forest'); break;
            case 'theme_ocean': setTheme('ocean'); break;
            case 'settings_theme': triggerClick('#settingsToggleButton'); break;
            case 'settings_account': navigate('#account'); break;
            case 'settings_bridge': triggerClick('#settingsToggleButton'); setTimeout(() => navigate('#bridgeSecretInput'), 100); break;
            case 'edit_profile': navigate('#profileView'); break;
            case 'sync_profile': triggerClick('#saveProfileButton'); break;
            case 'new_message': navigate('#messages'); setTimeout(() => triggerClick('#messageInput'), 200); break;
            case 'search_contacts': navigate('#messages'); setTimeout(() => triggerClick('#peopleSearchInput'), 200); break;
            case 'search_people': triggerClick('#peopleSearchInput'); break;
            case 'keyboard_shortcuts': triggerClick('#keyboardShortcutsButton'); break;
            case 'help_guide': navigate('./how-to-guide.html'); break;
            case 'view_terms': navigate('./security.html#terms'); break;
            case 'view_privacy': navigate('./security.html#privacy'); break;
            case 'refresh_page': window.location.reload(); break;
            case 'logout': triggerClick('#signOutButton'); break;
            case 'jump_to_top': case 'scroll_to_top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
            case 'jump_to_bottom': case 'scroll_to_bottom': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
            case 'scroll_to_feed': document.getElementById('feed')?.scrollIntoView({ behavior: 'smooth' }); break;
            case 'scroll_to_player': document.querySelector('.mini-player')?.scrollIntoView({ behavior: 'smooth' }); break;
            case 'view_liked': case 'feed_liked': if (typeof window.setFilter === 'function') window.setFilter('saved'); break;
            case 'view_saved': case 'feed_saved': if (typeof window.setFilter === 'function') window.setFilter('saved'); break;
            case 'feed_images': if (typeof window.setFilter === 'function') window.setFilter('image'); break;
            case 'feed_videos': if (typeof window.setFilter === 'function') window.setFilter('video'); break;
            case 'feed_audio': if (typeof window.setFilter === 'function') window.setFilter('audio'); break;
            case 'feed_youtube': if (typeof window.triggerSearch === 'function') window.triggerSearch('youtube'); break;
            case 'feed_spotify': if (typeof window.triggerSearch === 'function') window.triggerSearch('spotify'); break;
            case 'feed_today': if (typeof window.triggerSearch === 'function') window.triggerSearch('today'); break;
            case 'feed_popular': if (typeof window.setSort === 'function') window.setSort('popular'); break;
            case 'feed_newest': if (typeof window.setSort === 'function') window.setSort('newest'); break;
            case 'feed_oldest': if (typeof window.setSort === 'function') window.setSort('oldest'); break;
            case 'mute_audio': if (window.heroMediaPlayerController) window.heroMediaPlayerController.setVolume(0); break;
            case 'unmute_audio': if (window.heroMediaPlayerController) window.heroMediaPlayerController.setVolume(0.5); break;
            case 'reset_player': if (typeof window.resetPlayerDockPosition === 'function') window.resetPlayerDockPosition(); break;
            case 'clear_notifications': triggerClick('#clearNotificationsButton'); break;
            case 'mark_all_read': triggerClick('#markAllReadButton'); break;
            case 'action': console.log('[Arcade Chat] Received generic action placeholder. No-op.'); break;
            default: console.warn(`[Arcade Chat] Unknown protocol action: ${action}`);
        }    } catch (err) {
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
            
            // Execute any tags in the reply
            executeArcadeChatActions(reply);
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

/**
 * Executes AI-generated tags in the chat reply.
 * Handles [PUBLISH], [COMPOSE], [ARCADE], [OPEN].
 */
async function executeArcadeChatActions(text) {
    if (!text) return;

    // 1. [PUBLISH: {json}]
    const publishMatch = text.match(/\[PUBLISH:\s*({.+?})\]/);
    if (publishMatch) {
        try {
            const data = JSON.parse(publishMatch[1]);
            const { title, caption, tags } = data;
            
            if (window.publishPostToSupabase) {
                // Determine what to publish. 
                // If there's a recent attachment in history, use it.
                // Otherwise check if there's a URL in the text.
                let postFile = null;
                const lastUserMsg = [...arcadeChatHistory].reverse().find(m => m.role === 'user' && m.attachment);
                if (lastUserMsg && lastUserMsg.attachment && lastUserMsg.attachment.data) {
                    // Convert data URL back to Blob
                    const resp = await fetch(lastUserMsg.attachment.data);
                    const blob = await resp.blob();
                    postFile = new File([blob], lastUserMsg.attachment.name || "published-file", { type: lastUserMsg.attachment.type });
                }

                if (!postFile) {
                    console.warn("[Arcade Chat] No attachment found to publish.");
                    // Check if there's an external URL to publish instead
                    const urlMatch = text.match(/https?:\/\/[^\s\]]+/);
                    if (urlMatch && window.buildExternalPost && window.parseExternalMediaUrl) {
                         const externalUrl = urlMatch[0];
                         const parsedExternal = window.parseExternalMediaUrl(externalUrl);
                         if (parsedExternal) {
                             const basePost = { 
                                 id: `ai-${crypto.randomUUID()}`, 
                                 creator: window.getDefaultProfileName ? window.getDefaultProfileName() : "AI Assistant", 
                                 title: title || "AI Shared Content", 
                                 caption: caption || "Check this out!", 
                                 tags: tags || [], 
                                 likes: 0, 
                                 createdAt: new Date().toISOString() 
                             };
                             const post = window.buildExternalPost(basePost, parsedExternal);
                             const inserted = await window.publishPostToSupabase(post);
                             if (window.state && window.state.userPosts) {
                                 window.state.userPosts = [inserted, ...window.state.userPosts];
                                 if (window.render) window.render();
                             }
                             if (window.showFeedback) window.showFeedback("Post published successfully via AI!");
                             return;
                         }
                    }
                    if (window.showFeedback) window.showFeedback("AI wanted to publish but no file/link was found.", true);
                    return;
                }

                // Prepare the post object
                const basePost = { 
                    id: `ai-${crypto.randomUUID()}`, 
                    creator: window.getDefaultProfileName ? window.getDefaultProfileName() : "AI Assistant", 
                    title: title || "AI Shared Content", 
                    caption: caption || "Check this out!", 
                    tags: tags || [], 
                    likes: 0, 
                    createdAt: new Date().toISOString() 
                };

                if (window.buildUploadPost) {
                    const post = window.buildUploadPost(basePost, postFile);
                    const inserted = await window.publishPostToSupabase(post, (p) => {
                        console.log(`[AI Publish] Uploading: ${p}%`);
                    });
                    
                    if (window.state && window.state.userPosts) {
                        window.state.userPosts = [inserted, ...window.state.userPosts];
                        if (window.render) window.render();
                    }
                    if (window.showFeedback) window.showFeedback("Post published successfully via AI!");
                }
            }
        } catch (e) {
            console.error("[Arcade Chat] Failed to execute [PUBLISH] action:", e);
        }
    }

    // 2. [COMPOSE: text]
    const composeMatch = text.match(/\[COMPOSE:\s*(.+?)\]/);
    if (composeMatch) {
        const composeText = composeMatch[1].trim();
        const messengerInput = document.getElementById('messageInput');
        if (messengerInput) {
            messengerInput.value = composeText;
            if (window.openMessengerDock) window.openMessengerDock();
            if (window.showFeedback) window.showFeedback("Pre-filled messenger for you.");
        }
    }

    // 3. [ARCADE: action]
    const arcadeMatch = text.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
        const action = arcadeMatch[1].trim().toLowerCase();
        if (typeof window.executeArcadeAction === 'function') {
            window.executeArcadeAction(action);
        }
    }

    // 4. [OPEN: url]
    const openMatch = text.match(/\[OPEN:\s*([^\]]+)\]/);
    if (openMatch) {
        const url = openMatch[1].trim();
        window.open(url, '_blank');
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
        if (!clientX || clientX <= 0) return;

        const isFixed = window.getComputedStyle(sidebar).position === 'fixed';
        let newWidth;
        
        if (isFixed) {
            newWidth = window.innerWidth - clientX;
        } else {
            const shellRect = shell.getBoundingClientRect();
            newWidth = shellRect.right - clientX;
        }

        // Clamp width between 280px and 60% of screen
        const minWidth = 280;
        const maxWidth = window.innerWidth * 0.6;
        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
        
        if (!isFixed && shell && shell.classList.contains('steam-shell')) {
            // In integrated mode, we resize the center section (column 2)
            // The handle sits between column 2 and column 4 (with a 6px divider)
            const shellRect = shell.getBoundingClientRect();
            const absoluteHandlePos = clientX - shellRect.left;
            
            // 240px is the fixed left sidebar width
            const newTilesWidth = absoluteHandlePos - 240; 
            
            // Clamp the center content to ensure chat has at least minWidth
            const maxTilesWidth = shellRect.width - 240 - 6 - minWidth;
            const clampedTilesWidth = Math.max(300, Math.min(newTilesWidth, maxTilesWidth));
            
            shell.style.gridTemplateColumns = `240px ${clampedTilesWidth}px 6px 1fr`;
        } else {
            sidebar.style.width = `${newWidth}px`;
            if (isFixed && handle) {
                handle.style.right = `${newWidth}px`;
            }
        }
        
        if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
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
    if (window.syncArcadeSidebarOffsets) window.syncArcadeSidebarOffsets();
    if (messengerSection) messengerSection.style.setProperty('right', '', '');
    
    if (handle) handle.classList.toggle('collapsed', isCollapsed);
    
    localStorage.setItem('arcade-chat-collapsed', isCollapsed);
};

function isChatOpen() {
    const sidebar = document.querySelector('.steam-chat-sidebar');
    if (!sidebar) return false;
    return !sidebar.classList.contains('collapsed');
}

window.closeArcadeChat = function(options = {}) {
    const { restoreFocus = true } = options;
    if (!isChatOpen()) return false;
    window.toggleChat();
    if (restoreFocus) {
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        if (toggleBtn instanceof HTMLElement) toggleBtn.focus();
    }
    return true;
};


function setupToggle() {
    // Create toggle button regardless of mode, CSS will handle visibility
    if (!document.querySelector('.chat-toggle-btn')) {
        const btn = document.createElement('button');
        
        // Unified Tab Mode for all pages
        btn.className = 'chat-toggle-btn chat-tab-mode';
        btn.innerHTML = `
            <div class="tab-label" style="writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.65rem; font-weight: 900; letter-spacing: 2.5px; color: var(--arc-accent); text-transform: uppercase; pointer-events: none;">Companion</div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color: var(--arc-accent); margin-top: 8px; pointer-events: none;">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
        `;
        
        btn.onclick = window.toggleChat;
        document.body.appendChild(btn);
    }
}

function setupCloseParityHandlers() {
    const isMiniGamesPage = window.location.pathname.toLowerCase().includes('mini-games');
    if (!isMiniGamesPage) return;

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!isChatOpen()) return;
        window.closeArcadeChat({ restoreFocus: true });
    });

    document.addEventListener('pointerdown', (event) => {
        if (!isChatOpen()) return;

        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const sidebar = document.querySelector('.steam-chat-sidebar');
        const toggleBtn = document.querySelector('.chat-toggle-btn');
        if (!sidebar) return;
        if (sidebar.contains(target)) return;
        if (toggleBtn && toggleBtn.contains(target)) return;

        const isOverlayMode = window.matchMedia('(max-width: 768px)').matches || document.documentElement.classList.contains('platform-android');
        if (!isOverlayMode) return;

        window.closeArcadeChat({ restoreFocus: false });
    });
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
    setupCloseParityHandlers();
    startDesktopBridgePolling();
    updateChatStatus('idle');
    
    // Restore collapsed state
    const isSteamShell = document.querySelector('.steam-shell') || document.documentElement.classList.contains('is-steam-shell');
    const isAndroidPlatform = document.documentElement.classList.contains('platform-android');
    let wasCollapsed = localStorage.getItem('arcade-chat-collapsed');
    
    // Default to collapsed (tab mode) on steam-shell pages if no preference exists
    if (wasCollapsed === null && isSteamShell) {
        wasCollapsed = 'true';
    } else {
        wasCollapsed = wasCollapsed === 'true';
    }

    // Keep Android steam-shell pages in tab-open mode by default so content always fits.
    if (isSteamShell && isAndroidPlatform) {
        wasCollapsed = true;
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

    // Ensure Enter key sends the message
    const arcInput = document.getElementById('arc-chat-input');
    if (arcInput) {
        arcInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                sendChatMessage();
            }
        });
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

    const fallbacks = [
        "📶 [Arcade Protocol]: My advanced logic core is currently out of range, but my tactical database is active. I can still give you tips for the arcade games—just name one!",
        "📡 [Arcade Protocol]: Communication with the main intelligence core is unstable. I'm operating on low-power mode. Ask me about Pinball or Snake tactics!",
        "🕹️ [Arcade Protocol]: Sync failed. I'm relying on cached arcade data. Try asking about 'Hoops' or 'Snake' while I try to reconnect.",
        "🎮 [Arcade Protocol]: My logic processors are running local-only. I can provide game tips, but complex conversation is limited until I'm back in range of the bridge."
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

