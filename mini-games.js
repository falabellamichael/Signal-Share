/**
 * Signal Share Mini Games & Tools System
 * Unified logic for Library, Workshop, and Store.
 * Supports Desktop and Android (Capacitor) environments.
 */

const GAMES = [
    { id: 'snake', title: 'Neon Snake', category: 'ARCADE', poster: 'snake_game_poster_1778466261855.png', tag: 'ARCADE • READY', type: 'game', trackedStats: ['snake-best', 'snake-food-total', 'snake-games-played'] },
    { id: 'basketball', title: 'Neon Hoops', category: 'ARCADE', poster: 'basketball_game_poster.png', tag: 'ARCADE • 3D', type: 'game', trackedStats: ['hoops-bests', 'hoops-total-points', 'hoops-sessions'] },
    { id: 'pinball', title: 'Neon Pinball', category: 'ARCADE', poster: 'neon_pinball_v2_poster.png', tag: 'ARCADE • NEW', type: 'game', trackedStats: ['pinball-pro-best', 'pinball-total-score', 'pinball-avg-score', 'pinball-sessions'] },
    { id: 'calc', title: 'Scientific Calc', category: 'UTILITY', poster: 'calculator_tool_poster_1778466276736.png', tag: 'UTILITY', type: 'utility', trackedStats: [] }
];

function safeParseJson(rawValue, fallbackValue) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) return fallbackValue;
    try {
        const parsed = JSON.parse(rawValue);
        return parsed ?? fallbackValue;
    } catch (_error) {
        return fallbackValue;
    }
}

function readStoredArray(key) {
    const parsed = safeParseJson(localStorage.getItem(key), []);
    return Array.isArray(parsed) ? parsed : [];
}

function normalizeUserRecord(rawUser) {
    if (!rawUser || typeof rawUser !== 'object') return null;

    const email = typeof rawUser.email === 'string' ? rawUser.email.trim() : '';
    const fallbackName = email.includes('@') ? email.split('@')[0] : '';
    const displayName = [
        rawUser.name,
        rawUser.display_name,
        rawUser.displayName,
        rawUser.username,
        rawUser.user_metadata?.display_name,
        fallbackName
    ].find((value) => typeof value === 'string' && value.trim());
    const id = [
        rawUser.id,
        rawUser.user_id,
        rawUser.uid,
        email
    ].find((value) => typeof value === 'string' && value.trim());

    if (!displayName && !id && !email) return null;

    return {
        id: id || 'LOCAL-USER',
        name: displayName || 'Guest',
        email: email || null
    };
}

function syncStoredUser(user) {
    currentUser = normalizeUserRecord(user);
    if (currentUser) {
        localStorage.setItem('ss-user', JSON.stringify(currentUser));
    } else {
        localStorage.removeItem('ss-user');
    }
}

let currentCategory = 'all';
let currentUser = normalizeUserRecord(safeParseJson(localStorage.getItem('ss-user'), null));
let isNavigatingHistory = false;
const isAndroidPlatform = /Android/i.test(navigator.userAgent) || (window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android');
const LOCAL_NETWORK_PERMISSION_PROBE_URLS = Object.freeze([
    'http://localhost:3000/api/llm/chat',
    'http://127.0.0.1:3000/api/llm/chat',
    'http://10.0.2.2:3000/api/llm/chat'
]);
let localNetworkPermissionProbePromise = null;
let permissionPromptHandlersBound = false;

function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
}

let customGames = readStoredArray('ss-custom-games');
let uploadedFiles = [];

// Detection
const isNative = !!window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() !== 'web';

function syncCurrentCategoryGlobal() {
    window.currentCategory = currentCategory;
}

function isLoopbackBridgeUrl(url) {
    try {
        const parsed = new URL(url, window.location.href);
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === '[::1]';
    } catch (_error) {
        return false;
    }
}

function getBridgeTargetAddressSpace(url) {
    if (isLoopbackBridgeUrl(url)) return 'local';
    try {
        const parsed = new URL(url, window.location.href);
        const host = `${parsed.hostname || ''}`.trim().toLowerCase();
        if (!host) return '';
        if (host.startsWith('10.') || host.startsWith('192.168.') || host === '10.0.2.2') return 'private';
        const octets = host.split('.').map((value) => Number.parseInt(value, 10));
        if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
            if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return 'private';
            if (octets[0] === 169 && octets[1] === 254) return 'private';
        }
        if (host.endsWith('.local')) return 'private';
    } catch (_error) {
        return '';
    }
    return '';
}

async function probeLocalNetworkPermission() {
    if (!window.isSecureContext) return false;
    if (localNetworkPermissionProbePromise) return localNetworkPermissionProbePromise;

    localNetworkPermissionProbePromise = (async () => {
        for (const url of LOCAL_NETWORK_PERMISSION_PROBE_URLS) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1800);
            const targetAddressSpace = getBridgeTargetAddressSpace(url);
            try {
                await fetch(url, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: controller.signal,
                    ...(targetAddressSpace ? { targetAddressSpace } : {})
                });
                return true;
            } catch (_error) {
                // Keep probing candidates; any attempt can trigger browser permission handling.
            } finally {
                clearTimeout(timeout);
            }
        }
        return false;
    })();

    try {
        return await localNetworkPermissionProbePromise;
    } finally {
        localNetworkPermissionProbePromise = null;
    }
}

function requestMiniGamesPermissions({ fromUserGesture = false } = {}) {
    if (fromUserGesture && 'Notification' in window && window.isSecureContext && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => { });
    }
    void probeLocalNetworkPermission().catch(() => { });
}

function bindPermissionPromptHandlers() {
    if (permissionPromptHandlersBound) return;
    permissionPromptHandlersBound = true;

    const onGesture = () => requestMiniGamesPermissions({ fromUserGesture: true });
    window.addEventListener('pointerdown', onGesture, { passive: true, once: true });
    window.addEventListener('keydown', onGesture, { once: true });
}

function resetShellScrollPosition(behavior = 'auto') {
    const content = document.querySelector('.steam-content');
    const supportsSmooth = typeof document !== 'undefined' && document.documentElement && 'scrollBehavior' in document.documentElement.style;
    const canSmooth = behavior === 'smooth' && supportsSmooth;
    if (content) {
        try {
            if (canSmooth && typeof content.scrollTo === 'function') {
                content.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            } else if (typeof content.scrollTo === 'function') {
                content.scrollTo(0, 0);
            } else {
                content.scrollTop = 0;
                content.scrollLeft = 0;
            }
        } catch (_error) {
            content.scrollTop = 0;
            content.scrollLeft = 0;
        }
        return;
    }

    try {
        if (canSmooth && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        } else if (typeof window.scrollTo === 'function') {
            window.scrollTo(0, 0);
        }
    } catch (_error) {
        if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    }
}

function updateAndroidMiniViewportHeight() {
    if (!isAndroidPlatform) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    if (!viewportHeight) return;
    document.documentElement.style.setProperty('--mini-vh', `${Math.round(viewportHeight)}px`);
}

function initAndroidMiniShell() {
    if (!isAndroidPlatform) return;
    updateAndroidMiniViewportHeight();
    window.addEventListener('resize', updateAndroidMiniViewportHeight, { passive: true });
    window.addEventListener('orientationchange', updateAndroidMiniViewportHeight, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateAndroidMiniViewportHeight, { passive: true });
        window.visualViewport.addEventListener('scroll', updateAndroidMiniViewportHeight, { passive: true });
    }
}

function collapseCompanionByDefaultOnAndroid() {
    if (!isAndroidPlatform) return;
    const shell = document.querySelector('.steam-shell');
    if (!shell) return;

    const sidebar = document.querySelector('.steam-chat-sidebar');
    const handle = document.querySelector('.chat-resize-handle');
    if (sidebar) sidebar.classList.add('collapsed');
    if (handle) handle.classList.add('collapsed');
    document.body.classList.add('chat-collapsed');
}

// Supabase Auth Integration
let supabaseClient = null;
if (window.supabase) {
    try {
        const config = window.SIGNAL_SHARE_CONFIG || {
            supabaseUrl: "https://gswptxeikjmihdjxoiar.supabase.co",
            supabaseAnonKey: "sb_publishable_gIwGxzf1C4cD55l9XS16wg_Qn-LuYqT"
        };
        supabaseClient = window.arcadeSupabaseClient
            || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        window.arcadeSupabaseClient = supabaseClient;
        
        // Listen for auth changes to stay in sync with the main page
        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log(`[Mini-Games] Auth event: ${event}`);
            if (session?.user) {
                syncStoredUser({
                    id: session.user.id,
                    name: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email
                });
            } else {
                syncStoredUser(null);
            }
            updateAuthUI();
        });
    } catch (error) {
        console.warn('[Mini-Games] Supabase initialization failed, running without live auth sync:', error);
        supabaseClient = null;
    }
}

/**
 * Initialize the Library and Workshop state.
 */
async function init() {
    initAndroidMiniShell();
    collapseCompanionByDefaultOnAndroid();
    syncCurrentCategoryGlobal();
    bindPermissionPromptHandlers();
    requestMiniGamesPermissions({ fromUserGesture: false });

    // Initial sync if supabase already has a session
    if (supabaseClient) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user) {
                syncStoredUser({
                    id: session.user.id,
                    name: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email
                });
            }
        } catch (error) {
            console.warn('[Mini-Games] Failed initial auth session sync:', error);
        }
    }

    loadCustomGames();
    setupFileUpload();
    updateAuthUI();

    // Set initial state so back button works even on first load
    history.replaceState({ type: 'category', cat: 'all' }, '');
    renderLibrary();

    // Standardize Signal Share Suite UI - Adjust for different viewport contexts
    handleIframeContext();
}

/**
 * Ensures UI elements are adjusted when running inside a WebView or IFrame.
 */
function handleIframeContext() {
    if (window.self !== window.top) {
        const header = document.querySelector('.runner-header');
        if (header) header.style.display = 'none';

        const content = document.querySelector('.steam-content');
        if (content) content.style.paddingTop = '10px';
    }
}

function loadCustomGames() {
    customGames.forEach(game => {
        const existing = GAMES.find(g => g.id === game.id);
        if (!existing) {
            GAMES.push(game);
        }
    });
}

function setupFileUpload() {
    const fileInput = document.getElementById('game-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            if (this.files.length > 0) {
                Array.from(this.files).forEach(file => {
                    if (!uploadedFiles.find(f => f.name === file.name)) {
                        uploadedFiles.push(file);
                    }
                });
                updateFilePreview();
            }
        });
    }
}

function updateFilePreview() {
    const container = document.getElementById('file-items-container');
    const preview = document.getElementById('file-list-preview');
    if (!container || !preview) return;

    if (uploadedFiles.length === 0) {
        preview.style.display = 'none';
        return;
    }

    preview.style.display = 'block';
    container.innerHTML = '';

    uploadedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 10px 15px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);';

        const type = file.name.split('.').pop().toUpperCase();
        const typeColor = type === 'HTML' ? '#ff4b2b' : type === 'JS' ? '#f1e05a' : '#563d7c';

        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 0.6rem; font-weight: 900; background: ${typeColor}; color: #000; padding: 2px 6px; border-radius: 3px;">${type}</div>
                <span style="font-size: 0.85rem; color: #fff; font-weight: 500;">${file.name}</span>
                <span style="font-size: 0.7rem; opacity: 0.3;">(${(file.size / 1024).toFixed(1)} KB)</span>
            </div>
            <button onclick="removeUploadedFile(${index})" style="background: none; border: none; color: rgba(255,255,255,0.2); cursor: pointer; padding: 5px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        container.appendChild(item);
    });
}

function removeUploadedFile(index) {
    uploadedFiles.splice(index, 1);
    updateFilePreview();
    if (uploadedFiles.length === 0) {
        const input = document.getElementById('game-file-input');
        if (input) input.value = '';
    }
}

async function publishCustomGame() {
    if (!currentUser) {
        alert('Please sign in to publish games');
        return;
    }

    if (uploadedFiles.length === 0) {
        alert('Please select at least one game file');
        return;
    }

    const title = document.getElementById('game-title').value || 'Untitled Game';
    const category = document.getElementById('game-category').value;
    const description = document.getElementById('game-description').value || '';
    const thumbnail = document.getElementById('game-thumbnail').value || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22%3E%3Crect fill=%22%23233c51%22 width=%22200%22 height=%22300%22/%3E%3C/svg%3E';
    const tags = document.getElementById('game-tags').value || '';

    try {
        const filePromises = uploadedFiles.map(file => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve({
                    name: file.name,
                    content: e.target.result,
                    type: file.type
                });
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        });

        const processedFiles = await Promise.all(filePromises);
        const gameId = 'custom_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

        let entryFile = processedFiles.find(f => f.name.toLowerCase() === 'index.html') ||
            processedFiles.find(f => f.name.endsWith('.html')) ||
            processedFiles[0];

        const allCode = processedFiles.map(f => f.content).join(' ');
        const trackedStats = [];
        const statRegex = /localStorage\.(?:get|set)Item\(['"]([^'"]+)['"]\)/g;
        let match;
        while ((match = statRegex.exec(allCode)) !== null) {
            const key = match[1];
            const lowerKey = key.toLowerCase();
            // Expanded scanner keywords from the sophisticated list
            const keywords = ['score', 'best', 'level', 'stats', 'rank', 'xp', 'streak', 'win', 'lose', 'food', 'points', 'plays', 'time', 'likes', 'views', 'eng', 'rep', 'consecutive'];
            if (keywords.some(k => lowerKey.includes(k))) {
                if (!trackedStats.includes(key)) trackedStats.push(key);
            }
        }

        const newGame = {
            id: gameId,
            title: title,
            category: category,
            poster: thumbnail,
            tag: `${category} • CUSTOM`,
            type: category.toLowerCase() === 'utility' ? 'utility' : 'game',
            description: description,
            tags: tags,
            author: currentUser.name,
            files: processedFiles,
            entryFile: entryFile.name,
            publishedAt: new Date().toISOString(),
            trackedStats: trackedStats
        };

        customGames.push(newGame);
        GAMES.push(newGame);
        localStorage.setItem('ss-custom-games', JSON.stringify(customGames));

        document.getElementById('game-title').value = '';
        document.getElementById('game-category').value = 'GAME';
        document.getElementById('game-description').value = '';
        document.getElementById('game-thumbnail').value = '';
        document.getElementById('game-tags').value = '';
        document.getElementById('game-file-input').value = '';
        uploadedFiles = [];
        updateFilePreview();

        renderPublishedGames();
        alert('Game published successfully with ' + processedFiles.length + ' assets!');
    } catch (err) {
        console.error('Publish error:', err);
        alert('Failed to process files. Please try again.');
    }
}

function renderPublishedGames() {
    const grid = document.getElementById('published-games-grid');
    const noMsg = document.getElementById('no-published-msg');
    const countEl = document.getElementById('workshop-count');

    if (!grid) return;

    const userGames = customGames.filter(g => g.author === currentUser?.name);
    if (countEl) countEl.textContent = userGames.length + ' FILES PUBLISHED';

    grid.innerHTML = '';
    noMsg.style.display = userGames.length === 0 ? 'block' : 'none';

    userGames.forEach(game => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; transition: all 0.3s; position: relative;';

        const desc = (game.description || '').substring(0, 80);
        const descSuffix = (game.description || '').length > 80 ? '...' : '';

        const posterUrl = (game.poster && !game.poster.includes('${')) ? game.poster : 'icon-512.png';
        card.innerHTML = `
            <div style="height: 160px; background: url('${posterUrl}') center/cover; position: relative; overflow: hidden;">
                <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(16, 24, 34, 0.9), transparent); display: flex; align-items: flex-end; padding: 15px;">
                    <span style="font-size: 0.6rem; background: rgba(102, 192, 244, 0.2); color: var(--steam-light); padding: 4px 8px; border-radius: 4px; font-weight: 800; letter-spacing: 1px;">${game.tag}</span>
                </div>
            </div>
            <div style="padding: 20px;">
                <h4 style="margin: 0 0 8px; font-size: 1rem; font-weight: 800; color: #fff;">${game.title}</h4>
                <p style="margin: 0 0 20px; font-size: 0.8rem; opacity: 0.5; line-height: 1.5; min-height: 2.4em;">${desc}${descSuffix}</p>
                <div style="display: flex; gap: 10px;">
                    <button class="play-btn" onclick="launchCustomGame('${game.id}')" style="flex: 1; font-size: 0.8rem; padding: 10px; margin: 0; letter-spacing: 1px;">LAUNCH</button>
                    <button class="play-btn" onclick="deleteCustomGame('${game.id}')" style="flex: 0 0 auto; font-size: 0.8rem; padding: 10px 15px; margin: 0; background: rgba(255, 100, 100, 0.15); color: #ff6464; border: 1px solid rgba(255, 100, 100, 0.1);">REMOVE</button>
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

function launchCustomGame(gameId) {
    const game = GAMES.find(g => g.id === gameId);
    if (!game) {
        alert('Game not found');
        return;
    }

    recordLaunch(gameId);

    if (game.files && game.files.length > 0) {
        const entry = game.files.find(f => f.name === game.entryFile) || game.files[0];

        if (entry.name.endsWith('.html')) {
            let content = entry.content.split('base64,')[1] ? atob(entry.content.split('base64,')[1]) : entry.content;

            game.files.forEach(f => {
                if (f.name === entry.name) return;
                const escapedName = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                if (f.name.endsWith('.js')) {
                    const js = f.content.split('base64,')[1] ? atob(f.content.split('base64,')[1]) : f.content;
                    const scriptRegex = new RegExp('<scr' + 'ipt[^>]*src=["\']' + escapedName + '["\'][^>]*></scr' + 'ipt>', 'gi');
                    content = content.replace(scriptRegex, '<scr' + 'ipt>' + js + '</scr' + 'ipt>');
                }
                else if (f.name.endsWith('.css')) {
                    const css = f.content.split('base64,')[1] ? atob(f.content.split('base64,')[1]) : f.content;
                    const styleRegex = new RegExp('<link[^>]*href=["\']' + escapedName + '["\'][^>]*>', 'gi');
                    content = content.replace(styleRegex, '<style>' + css + '</style>');
                }
                else {
                    const srcRegex = new RegExp('(["\'])' + escapedName + '(["\'])', 'g');
                    content = content.replace(srcRegex, '$1' + f.content + '$2');

                    const urlRegex = new RegExp('url\\(["\']?' + escapedName + '["\']?\\)', 'g');
                    content = content.replace(urlRegex, 'url(' + f.content + ')');
                }
            });

            openApp(content, game.title, game.poster, gameId);
        } else {
            const js = entry.content.split('base64,')[1] ? atob(entry.content.split('base64,')[1]) : entry.content;
            const htmlWrapper = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + game.title + '</title></head><body><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
            openApp(htmlWrapper, game.title, game.poster, gameId);
        }
    }
}

function deleteCustomGame(gameId) {
    if (!confirm('Are you sure you want to delete this game?')) return;

    customGames = customGames.filter(g => g.id !== gameId);
    const gameIdx = GAMES.findIndex(g => g.id === gameId);
    if (gameIdx >= 0) GAMES.splice(gameIdx, 1);

    localStorage.setItem('ss-custom-games', JSON.stringify(customGames));
    renderPublishedGames();
}

async function toggleAuth() {
    if (currentUser) {
        if (confirm('Do you want to sign out?')) {
            if (supabaseClient) {
                await supabaseClient.auth.signOut();
            } else {
                syncStoredUser(null);
                updateAuthUI();
            }
            setCategory('all');
        }
    } else {
        showAuth();
    }
}

function showAuth() {
    document.getElementById('auth-overlay').style.display = 'flex';
}

function hideAuth() {
    document.getElementById('auth-overlay').style.display = 'none';
}

async function performLogin() {
    const email = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;

    if (!email || !password) {
        alert("Please enter both email/username and password.");
        return;
    }

    if (supabaseClient) {
        try {
            // Support both email and potential username-to-email mapping if desired
            // For now, we assume email as per app-v3 standard
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            
            hideAuth();
        } catch (err) {
            console.error('[Mini-Games] Auth Error:', err);
            alert(`Authentication failed: ${err.message}`);
        }
    } else {
        // Fallback for offline mode
        syncStoredUser({ name: email || 'Developer', id: 'ID-' + Math.floor(Math.random() * 1000), email });
        updateAuthUI();
        hideAuth();
    }

    if (currentCategory === 'store') setCategory('store');
}

function updateAuthUI() {
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    const storeNav = document.getElementById('nav-store');
    const leaderNav = document.getElementById('nav-leaderboard');

    if (currentUser) {
        const displayName = currentUser.name || currentUser.email || 'User';
        if (nameEl) nameEl.textContent = displayName.toUpperCase();
        if (avatarEl) {
            avatarEl.textContent = displayName.charAt(0).toUpperCase();
            avatarEl.style.background = '#a4d007';
        }
        if (storeNav) storeNav.classList.remove('locked');
        if (leaderNav) leaderNav.classList.remove('locked');
    } else {
        if (nameEl) nameEl.textContent = 'Sign In';
        if (avatarEl) {
            avatarEl.textContent = '?';
            avatarEl.style.background = '#66c0f4';
        }
        if (storeNav) storeNav.classList.add('locked');
        if (leaderNav) leaderNav.classList.add('locked');
    }
}

function setCategory(cat, skipPush = false) {
    vibrate(5);
    currentCategory = cat;
    syncCurrentCategoryGlobal();


    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navEl = document.getElementById(`nav-${cat}`);
    if (navEl) navEl.classList.add('active');

    document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
    const mobNavEl = document.getElementById(`mob-nav-${cat}`);
    if (mobNavEl) mobNavEl.classList.add('active');

    const hero = document.querySelector('.featured-hero');
    const library = document.getElementById('library-view');
    const store = document.getElementById('store-view');
    const publish = document.getElementById('publish-view');
    const detail = document.getElementById('detail-view');
    const leader = document.getElementById('leaderboard-view');
    const runner = document.getElementById('app-runner');
    const title = document.getElementById('library-title');
    const clearBtn = document.getElementById('clear-recent');

    if (library) library.style.display = 'none';
    if (store) store.style.display = 'none';
    if (publish) publish.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (leader) leader.style.display = 'none';
    if (runner) runner.style.display = 'none';
    document.body.style.overflow = 'auto';

    if (cat === 'store') {
        if (store) store.style.display = 'block';
        const msg = document.getElementById('store-locked-msg');
        const content = document.getElementById('store-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
    } else if (cat === 'publish') {
        if (publish) publish.style.display = 'block';
        const msg = document.getElementById('publish-locked-msg');
        const content = document.getElementById('publish-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
        if (currentUser) renderPublishedGames();
    } else if (cat === 'leaderboard') {
        if (leader) leader.style.display = 'block';
        const msg = document.getElementById('leader-locked-msg');
        const content = document.getElementById('leader-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
        if (currentUser) {
            renderLeaderboard();
            if (typeof window.renderGlobalLeaderboards === 'function') {
                window.renderGlobalLeaderboards();
            }
        }
    } else {
        if (library) library.style.display = 'block';
        if (hero) hero.style.display = (cat === 'all') ? 'flex' : 'none';

        let displayTitle = cat.toUpperCase();
        if (cat === 'all') displayTitle = 'ALL GAMES & UTILITIES';
        if (cat === 'games') displayTitle = 'GAMES';
        if (cat === 'utilities') displayTitle = 'UTILITIES';

        if (title) title.textContent = displayTitle;
        if (clearBtn) clearBtn.style.display = (cat === 'recent') ? 'block' : 'none';
    }

    if (!skipPush && !isNavigatingHistory) {
        history.pushState({ type: 'category', cat: cat }, '');
    }

    resetShellScrollPosition();
    renderLibrary();
}

function renderLibrary() {
    if (currentCategory === 'store') return;
    const grid = document.getElementById('game-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let filtered = [];
    if (currentCategory === 'all') filtered = GAMES;
    else if (currentCategory === 'games') filtered = GAMES.filter(g => g.type === 'game');
    else if (currentCategory === 'utilities') filtered = GAMES.filter(g => g.type === 'utility');
    else if (currentCategory === 'recent') {
        const history = readStoredArray('launch-history');
        filtered = history.map(id => GAMES.find(g => g.id === id)).filter(Boolean);
    }

    if (filtered.length === 0 && currentCategory === 'recent') {
        grid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; opacity: 0.4;">No recent activity recorded.</div>';
        return;
    }

    filtered.forEach(game => {
        const card = document.createElement('div');
        card.className = 'steam-card';
        card.onclick = () => showGameDetails(game.id);
        const posterUrl = (game.poster && !game.poster.includes('${')) ? game.poster : 'icon-512.png';
        card.innerHTML = `
            <div class="poster-wrapper"><img src="${posterUrl}"></div>
            <div class="card-info">
                <div class="card-title">${game.title}</div>
                <div class="card-tag">${game.tag}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function calculateRank(totalPoints) {
    const tiers = [
        { name: 'UNRANKED', min: 0, color: '#888' },
        { name: 'BRONZE', min: 100, color: '#cd7f32' },
        { name: 'SILVER', min: 500, color: '#c0c0c0' },
        { name: 'GOLD', min: 1500, color: '#ffd700' },
        { name: 'PLATINUM', min: 4000, color: '#e5e4e2' },
        { name: 'DIAMOND', min: 8000, color: '#b9f2ff' },
        { name: 'ELITE', min: 15000, color: '#a4d007' },
        { name: 'MYTHIC', min: 30000, color: '#ff00ff' }
    ];

    let currentTier = tiers[0];
    for (const tier of tiers) {
        if (totalPoints >= tier.min) currentTier = tier;
        else break;
    }

    if (totalPoints >= 50000) {
        const legendaryLevel = Math.floor((totalPoints - 50000) / 10000) + 1;
        return { name: `LEGENDARY ${legendaryLevel}`, color: '#ff7700', progress: 100 };
    }

    return currentTier;
}

function discoverStats(game) {
    let stats = [];
    const id = game.id;
    const engine = typeof LEADERBOARD_ENGINE !== 'undefined' ? LEADERBOARD_ENGINE : null;

    // Helper to add a stat if it's not already in the list
    const tryAddStat = (key, labelOverride = null) => {
        if (stats.length >= 3) return true;
        const lowerKey = key.toLowerCase();

        // Don't duplicate by label or key
        const label = labelOverride || (engine ? engine.formatLabel(key, id) : key.toUpperCase());
        
        // Don't duplicate by label OR key
        if (stats.find(s => s.key === key || s.label === label)) return false;
        
        const raw = localStorage.getItem(key);
        if (!raw) return false;

        const val = parseInt(raw);
        if (!isNaN(val)) {
            const unit = engine ? engine.getUnit(key) : '';
            stats.push({ key, label, val, unit });
            return true;
        }
        return false;
    };

    // 1. HIGH PRIORITY: Explicitly tracked keys from manifest
    (game.trackedStats || []).forEach(key => {
        if (stats.length >= 3) return;
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!raw) return;

        if (raw.startsWith('{')) {
            try {
                const data = JSON.parse(raw);
                Object.entries(data).forEach(([k, v]) => {
                    if (stats.length >= 3) return;
                    if (typeof v === 'number' || !isNaN(v)) {
                        const label = engine ? engine.formatLabel(k, id) : k.toUpperCase();
                        const unit = engine ? engine.getUnit(k) : '';
                        stats.push({ key: k, label, val: v, unit });
                    }
                });
            } catch (e) { }
        } else {
            tryAddStat(key);
        }
    });

    // 2. MEDIUM PRIORITY: Exhaustive Heuristic Discovery (Direct ID Matches)
    if (stats.length < 3) {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.includes(id)) {
                tryAddStat(key);
            }
            if (stats.length >= 3) break;
        }
    }

    // 3. LOW PRIORITY: Contextual Global Metrics (Only if they aren't explicitly prefixed for another game)
    if (stats.length < 3 && engine) {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            
            // SECURITY: If the key clearly belongs to another game (contains their ID), skip it
            const isOtherGameKey = GAMES.some(g => g.id !== id && key.toLowerCase().includes(g.id.toLowerCase()));
            if (isOtherGameKey) continue;

            // Check if this global key matches a dictionary entry and is "meaningful"
            if (engine.getMetric(key)) {
                tryAddStat(key);
            }
            if (stats.length >= 3) break;
        }
    }

    // 4. FALLBACKS: Only if we still have fewer than 3
    const placeholders = [
        { label: 'HIGH SCORE', val: '0', unit: 'PTS' },
        { label: 'PLAY TIME', val: '0', unit: 'MIN' },
        { label: 'GLOBAL RANK', val: 'UNRANKED', unit: '' }
    ];

    while (stats.length < 3) {
        const p = placeholders[stats.length] || { label: 'PENDING', val: '---', unit: '' };
        stats.push(p);
    }

    return stats.slice(0, 3);
}

async function renderLeaderboard() {
    const grid = document.getElementById('leader-grid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(320px, 1fr))';
    grid.style.gap = '25px';

    try {
        let totalAccumulatedScore = 0;
        const appsToRender = GAMES.filter(g => g.type === 'game' || (g.trackedStats && g.trackedStats.length > 0));

        for (const game of appsToRender) {
            const stats = discoverStats(game);
            
            // Integrate Supabase Telemetry: Fetch persistent personal best
            if (game.type === 'game' && typeof window.getPersonalBest === 'function') {
                try {
                    const pb = await window.getPersonalBest(game.id);
                    if (pb && pb.score) {
                        // Check if we already have a 'HIGH SCORE' or similar from local discovery
                        const existingHigh = stats.find(s => s.label.includes('SCORE'));
                        if (existingHigh) {
                            if (Number(pb.score) > Number(existingHigh.val)) {
                                existingHigh.val = pb.score;
                                existingHigh.unit = 'PTS (SYNCED)';
                            }
                        } else {
                            stats.unshift({ label: 'HIGH SCORE', val: pb.score, unit: 'PTS (SYNCED)' });
                        }
                    }
                } catch (e) {
                    console.warn(`[Arcade Launcher] Could not sync ${game.id} telemetry:`, e);
                }
            }

            if (stats.length === 0 && game.type !== 'game') continue;

            const highest = Math.max(0, ...stats.map(s => typeof s.val === 'number' ? s.val : (parseInt(s.val) || 0)));
            totalAccumulatedScore += highest;

            const card = document.createElement('div');
            card.style.cssText = `
                background: rgba(255,255,255,0.02);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transition: transform 0.3s, border-color 0.3s;
            `;

            let statsHtml = stats.length > 0 ? stats.map(s => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <span style="font-size: 0.7rem; font-weight: 800; opacity: 0.4; letter-spacing: 1.5px; text-transform: uppercase;">${s.label}</span>
                    <div style="text-align: right;">
                        <span style="font-weight: 900; font-size: 1.2rem; color: #fff;">${s.val}</span>
                        <span style="font-size: 0.6rem; opacity: 0.3; margin-left: 3px; font-weight: 800;">${s.unit}</span>
                    </div>
                </div>
            `).join('') : '<div style="padding: 20px 0; opacity: 0.3; font-size: 0.8rem; text-align: center;">No local data recorded yet</div>';

            const posterUrl = (game.poster && !game.poster.includes('${')) ? game.poster : 'icon-512.png';

            card.innerHTML = `
                <div style="height: 140px; position: relative; overflow: hidden;">
                    <img src="${posterUrl}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.5; filter: grayscale(0.5) brightness(0.6);">
                    <div style="position: absolute; inset: 0; background: linear-gradient(to top, #101822 10%, transparent 90%); padding: 25px; display: flex; align-items: flex-end;">
                        <h3 style="margin: 0; font-size: 1.6rem; letter-spacing: -1.5px; font-weight: 900; text-transform: uppercase;">${game.title}</h3>
                    </div>
                </div>
                <div style="padding: 25px;">
                    ${statsHtml}
                </div>`;
            grid.appendChild(card);
        }

        const userRank = calculateRank(totalAccumulatedScore);
        const rankTitleEl = document.querySelector('#leader-user-meta div:nth-child(2)');
        if (rankTitleEl) {
            rankTitleEl.textContent = userRank.name;
            rankTitleEl.style.color = userRank.color;
        }
    } catch (err) {
        console.error('Leaderboard render error:', err);
        grid.innerHTML = `<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: #ff3e3e;">Failed to generate smart rankings: ${err.message}</div>`;
    }
}

function recordLaunch(id) {
    let historyData = readStoredArray('launch-history');
    historyData = historyData.filter(item => item !== id);
    historyData.unshift(id);
    if (historyData.length > 8) historyData.pop();
    localStorage.setItem('launch-history', JSON.stringify(historyData));
}

function clearRecent() {
    localStorage.removeItem('launch-history');
    renderLibrary();
}

function showGameDetails(game, skipPush = false) {
    const library = document.getElementById('library-view');
    const detail = document.getElementById('detail-view');
    const runner = document.getElementById('app-runner');
    const hubBg = document.getElementById('hub-bg');

    if (runner) runner.style.display = 'none';
    document.body.style.overflow = 'auto';

    if (library) library.style.display = 'none';
    if (detail) {
        detail.style.display = 'block';
        setTimeout(() => detail.style.opacity = '1', 10);
    }

    const g = GAMES.find(x => x.id === game);
    if (g && hubBg) hubBg.style.backgroundImage = `url(${g.poster})`;

    const snake = document.getElementById('hub-snake');
    const basketball = document.getElementById('hub-basketball');
    const pinball = document.getElementById('hub-pinball');
    const calc = document.getElementById('hub-calc');

    if (snake) snake.style.display = (game === 'snake') ? 'block' : 'none';
    if (basketball) basketball.style.display = (game === 'basketball') ? 'block' : 'none';
    if (pinball) pinball.style.display = (game === 'pinball') ? 'block' : 'none';
    if (calc) calc.style.display = (game === 'calc') ? 'block' : 'none';

    resetShellScrollPosition('smooth');

    if (!skipPush && !isNavigatingHistory) {
        history.pushState({ type: 'detail', game: game }, '');
    }
}

function showLibrary() {
    const library = document.getElementById('library-view');
    const detail = document.getElementById('detail-view');

    if (detail) {
        detail.style.opacity = '0';
        setTimeout(() => {
            detail.style.display = 'none';
            if (library) library.style.display = 'block';
            resetShellScrollPosition();
            renderLibrary();
        }, 300);
    }
}

function toggleObstCount(mode) {
    const row = document.getElementById('snake-obst-count-row');
    if (row) row.style.display = (mode === 'none') ? 'none' : 'block';
}

function launchSnake() {
    recordLaunch('snake');
    const speed = document.getElementById('snake-speed').value;
    const grid = document.getElementById('snake-grid').value;
    const neon = document.getElementById('snake-neon').value;
    const obstacles = document.getElementById('snake-obstacles').value;
    const obstCount = document.getElementById('snake-obst-count').value;
    const wallwrap = document.getElementById('snake-wallwrap').checked ? '1' : '0';

    const url = `./snake-game.html?speed=${speed}&grid=${grid}&neon=${neon}&obstacles=${obstacles}&obstCount=${obstCount}&wallwrap=${wallwrap}&autostart=1`;
    openApp(url, 'Neon Snake', 'snake_game_poster_1778466261855.png', 'snake');
}

function launchBasketball() {
    recordLaunch('basketball');
    const mode = document.getElementById('hoops-mode').value;
    const physics = document.getElementById('hoops-physics').value;
    openApp(`./basketball-game.html?mode=${mode}&physics=${physics}`, 'Neon Hoops', 'basketball_game_poster.png', 'basketball');
}

function launchPinball() {
    recordLaunch('pinball');
    openApp(`./pinball-game.html`, 'Neon Pinball', 'pinball_poster_1778481948543.png', 'pinball');
}

function launchCalc() {
    recordLaunch('calc');
    openApp('./Calculator.html', 'Scientific Calc', 'calculator_tool_poster_1778466276736.png', 'calc');
}

function openApp(url, title, icon, appId, skipPush = false) {
    vibrate(15);
    const runner = document.getElementById('app-runner');
    const frame = document.getElementById('app-frame');
    const titleEl = document.getElementById('runner-title');
    const iconEl = document.getElementById('runner-icon');

    if (titleEl) titleEl.textContent = title;
    if (iconEl) iconEl.src = icon;

    // Detect if we are on Android
    const isAndroid = /Android/i.test(navigator.userAgent)
        || (window.Capacitor
            && typeof window.Capacitor.getPlatform === 'function'
            && window.Capacitor.getPlatform() === 'android');

    if (url.startsWith('data:') || url.startsWith('<!DOCTYPE') || url.startsWith('<html')) {
        const blob = new Blob([url], { type: 'text/html' });
        frame.src = URL.createObjectURL(blob);
    } else {
        frame.src = url;
    }

    // Signal Share Fitting Suite: Ensure all applications fit the screen on Android
    frame.onload = () => {
        try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            if (isAndroid) {
                doc.documentElement.classList.add('platform-android');
                doc.documentElement.classList.add('is-signal-app');
            }
        } catch (e) {
            console.warn('[App Runner] Could not inject fitting classes (Cross-origin or early load)', e);
        }
    };

    if (runner) runner.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (!skipPush && !isNavigatingHistory) {
        const stateData = { type: 'app', url, title, icon, appId };
        const current = history.state;

        if (current && current.type === 'app') {
            history.replaceState(stateData, '');
        } else {
            history.pushState(stateData, '');
        }
    }
}

function closeApp(skipPush = false) {
    vibrate(10);
    const runner = document.getElementById('app-runner');

    const frame = document.getElementById('app-frame');

    if (!runner || runner.style.display === 'none') return;

    runner.style.display = 'none';
    frame.src = '';
    document.body.style.overflow = 'auto';

    if (!skipPush && !isNavigatingHistory) {
        history.back();
    }
}

window.onpopstate = function (event) {
    isNavigatingHistory = true;

    const runner = document.getElementById('app-runner');
    if (runner) {
        if (event.state && event.state.type === 'app') {
            const s = event.state;
            openApp(s.url, s.title, s.icon, s.appId, true);
        } else {
            closeApp(true);
        }
    }

    if (event.state) {
        const s = event.state;
        if (s.type === 'category') setCategory(s.cat, true);
        else if (s.type === 'detail') showGameDetails(s.game, true);
    } else {
        setCategory('all', true);
    }
    isNavigatingHistory = false;
};

// Global exports for HTML
window.setCategory = setCategory;
window.showGameDetails = showGameDetails;
window.showLibrary = showLibrary;
window.launchSnake = launchSnake;
window.launchBasketball = launchBasketball;
window.launchPinball = launchPinball;
window.launchCalc = launchCalc;
window.closeApp = closeApp;
window.toggleAuth = toggleAuth;
window.performLogin = performLogin;
window.hideAuth = hideAuth;
window.showAuth = showAuth;
window.removeUploadedFile = removeUploadedFile;
window.publishCustomGame = publishCustomGame;
window.clearRecent = clearRecent;
window.toggleObstCount = toggleObstCount;

// Start the engine
document.addEventListener('DOMContentLoaded', init);
