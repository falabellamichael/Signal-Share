/**
 * Signal Share Mini Games & Tools System
 * Unified logic for Library, Workshop, and Store.
 * Supports Desktop and Android (Capacitor) environments.
 */

const GAMES = [
    { id: 'snake', title: 'Neon Snake', category: 'ARCADE', poster: 'snake_game_poster_1778466261855.png', tag: 'ARCADE • READY', type: 'game', trackedStats: ['snake-best', 'snake-food-total', 'snake-games-played'] },
    { id: 'basketball', title: 'Neon Hoops', category: 'ARCADE', poster: 'basketball_game_poster.png', tag: 'ARCADE • 3D', type: 'game', trackedStats: ['hoops-bests', 'hoops-total-points', 'hoops-sessions'] },
    { id: 'pinball', title: 'Neon Pinball', category: 'ARCADE', poster: 'neon_pinball_v2_poster.png', tag: 'ARCADE • NEW', type: 'game', trackedStats: ['pinball-pro-best', 'pinball-total-score', 'pinball-avg-score', 'pinball-sessions'] },
    { id: 'sudoku', title: 'Neon Sudoku', category: 'ARCADE', poster: 'neon_sudoku_poster.png', tag: 'ARCADE • PUZZLE', type: 'game', trackedStats: ['sudoku-best-time', 'sudoku-puzzles-solved'] },
    { id: 'calc', title: 'Scientific Calc', category: 'UTILITY', poster: 'calculator_tool_poster_1778466276736.png', tag: 'UTILITY', type: 'utility', trackedStats: [] }
];

const DEFAULT_GAME_POSTER = 'icon-512.png';
const STATIC_HUB_IDS = {
    snake: 'hub-snake',
    basketball: 'hub-basketball',
    pinball: 'hub-pinball',
    calc: 'hub-calc',
    sudoku: 'hub-sudoku'
};

function escapeHtml(value) {
    return `${value ?? ''}`.replace(/[&<>"']/g, (char) => {
        if (char === '&') return '&amp;';
        if (char === '<') return '&lt;';
        if (char === '>') return '&gt;';
        if (char === '"') return '&quot;';
        return '&#39;';
    });
}

function normalizeCategoryLabel(game) {
    const rawCategory = `${game?.category || ''}`.trim();
    if (rawCategory) return rawCategory.toUpperCase();
    return game?.type === 'utility' ? 'UTILITY' : 'ARCADE';
}

function resolveGamePoster(game) {
    const poster = `${game?.poster || ''}`.trim();
    return poster && !poster.includes('${') ? poster : DEFAULT_GAME_POSTER;
}

function buildGameTag(game) {
    const existingTag = `${game?.tag || ''}`.trim();
    if (existingTag) return existingTag.toUpperCase();

    const category = normalizeCategoryLabel(game);
    const status = game?.type === 'utility' ? 'UTILITY' : 'READY';
    return `${category} • ${status}`;
}

function buildHubBadges(game) {
    const category = normalizeCategoryLabel(game);
    const tagParts = buildGameTag(game).split('•').map((part) => part.trim()).filter(Boolean);
    const secondary = tagParts.length > 1 ? tagParts[1] : (game?.type === 'utility' ? 'TOOLKIT' : 'SINGLE PLAYER');
    const finalBadge = game?.files?.length ? 'WORKSHOP' : (game?.type === 'utility' ? 'UTILITY READY' : 'READY');
    return [category, secondary, finalBadge];
}

function buildHubDescription(game) {
    const description = `${game?.description || ''}`.trim();
    if (description) return description;
    if (game?.type === 'utility') {
        return 'A curated utility experience integrated into the mini-games shell. Launch instantly, keep your progress, and stay responsive on desktop and Android.';
    }
    return 'A polished arcade-ready experience built for the Signal Share launcher with optimized input handling, persistent progress, and responsive session controls.';
}

function buildHubFeatureItems(game) {
    const features = [];
    const typeLabel = game?.type === 'utility' ? 'Utility module routing' : 'Arcade session routing';
    features.push(typeLabel);

    if (game?.files?.length) {
        features.push(`${game.files.length} workshop assets bundled`);
    }

    const trackedCount = Array.isArray(game?.trackedStats) ? game.trackedStats.length : 0;
    if (trackedCount > 0) {
        features.push(`${trackedCount} telemetry stats discovered`);
    }

    const tagsRaw = `${game?.tags || ''}`.trim();
    if (tagsRaw) {
        tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 2).forEach((tag) => {
            features.push(`${tag} optimized`);
        });
    }

    if (features.length < 4) {
        features.push('Mobile viewport fitting enabled');
    }

    return features.slice(0, 4);
}

function getGameLaunchAction(game) {
    if (!game || !game.id) return null;
    if (game.id === 'snake') return launchSnake;
    if (game.id === 'basketball') return launchBasketball;
    if (game.id === 'pinball') return launchPinball;
    if (game.id === 'sudoku') return launchSudoku;
    if (game.id === 'calc') return launchCalc;
    return () => launchCustomGame(game.id);
}

function renderDynamicHub(game) {
    const dynamicHub = document.getElementById('hub-dynamic');
    if (!dynamicHub) return;
    if (!game) {
        dynamicHub.style.display = 'none';
        dynamicHub.innerHTML = '';
        return;
    }

    const posterUrl = resolveGamePoster(game);
    const badges = buildHubBadges(game);
    const statusColor = game.type === 'utility' ? 'var(--steam-light)' : '#a4d007';
    const statusText = game.files?.length ? 'STATUS: WORKSHOP READY' : (game.type === 'utility' ? 'STATUS: STANDBY' : 'STATUS: ONLINE');
    const sessionText = game.type === 'utility' ? 'Utility session prepared' : 'Arcade session prepared';
    const actionLabel = game.type === 'utility' ? 'Launch Utility' : 'Launch Game';
    const features = buildHubFeatureItems(game).map((item) => `
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 4px; height: 4px; background: var(--steam-light); border-radius: 50%;"></div>
            ${escapeHtml(item)}
        </div>
    `).join('');

    dynamicHub.innerHTML = `
        <div class="game-hub-header">
            <img src="${escapeHtml(posterUrl)}" class="hub-poster">
            <div>
                <h1 style="font-size: 4rem; margin: 0 0 10px 0; letter-spacing: -3px; font-weight: 900;">${escapeHtml(game.title || 'Untitled')}</h1>
                <div style="display: flex; gap: 10px; margin-bottom: 30px; flex-wrap: wrap;">
                    <span class="badge">${escapeHtml(badges[0])}</span>
                    <span class="badge">${escapeHtml(badges[1])}</span>
                    <span class="badge" style="color: var(--steam-light);">${escapeHtml(badges[2])}</span>
                </div>
                <p style="color: rgba(255,255,255,0.6); line-height: 1.8; font-size: 1.1rem; max-width: 680px;">${escapeHtml(buildHubDescription(game))}</p>
            </div>
        </div>
        <div class="play-bar">
            <div>
                <span style="font-size: 0.7rem; font-weight: 900; color: ${statusColor}; letter-spacing: 2px;">${statusText}</span>
                <div style="font-size: 1.2rem; font-weight: 700; margin-top: 4px;">${sessionText}</div>
            </div>
            <button class="play-btn" id="dynamic-launch-btn">${actionLabel}</button>
        </div>
        <h3 style="font-size: 0.7rem; letter-spacing: 2px; opacity: 0.3; margin-bottom: 20px; font-weight: 900;">AUTOMATED FEATURE PROFILE</h3>
        <div class="config-grid" style="color: rgba(255,255,255,0.8); font-size: 0.85rem; display: grid; gap: 12px;">
            ${features}
        </div>
    `;

    dynamicHub.style.display = 'block';
    const launchBtn = document.getElementById('dynamic-launch-btn');
    if (launchBtn) {
        launchBtn.onclick = () => {
            const action = getGameLaunchAction(game);
            if (typeof action === 'function') action();
        };
    }
}

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
function parseBridgeBoolean(value) {
    const normalized = `${value ?? ''}`.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return null;
}

function isLoopbackSiteOrigin() {
    const protocol = `${window.location?.protocol || ''}`.toLowerCase();
    const host = `${window.location?.hostname || ''}`.trim().toLowerCase();
    if (protocol === 'file:') return true;
    return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost');
}

function isPrivateSiteOrigin() {
    const host = `${window.location?.hostname || ''}`.trim().toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
    if (host === '::1' || host === '[::1]') return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
        const octets = host.split('.').map((value) => Number.parseInt(value, 10));
        if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
        const [a, b] = octets;
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
    }
    return host.endsWith('.local');
}

function isBridgeFeatureEnabled() {
    const explicitFlag = parseBridgeBoolean(
        localStorage.getItem('ss_bridge_enabled')
        ?? localStorage.getItem('signal-share-bridge-enabled')
    );
    if (explicitFlag !== null) return explicitFlag;

    const customBridgeUrl = `${localStorage.getItem('signal-share-bridge-url') || ''}`.trim();
    if (customBridgeUrl) return true;

    const bridgeSecret = `${localStorage.getItem('ss_bridge_secret') || ''}`.trim()
        || `${localStorage.getItem('signal-share-bridge-secret') || ''}`.trim();
    if (bridgeSecret) return true;

    return false;
}

function shouldAttemptBridgeRequests() {
    if (isNative) return isBridgeFeatureEnabled();
    if (isLoopbackSiteOrigin() || isPrivateSiteOrigin()) return true;
    return isBridgeFeatureEnabled();
}

function getLocalNetworkPermissionProbeUrls() {
    if (!shouldAttemptBridgeRequests()) return [];
    const urls = [
        'http://localhost:3000/api/llm/chat',
        'http://127.0.0.1:3000/api/llm/chat'
    ];
    const isSecureHostedPage = window.location.protocol === 'https:';
    if (!isSecureHostedPage || isNative) {
        urls.push('http://10.0.2.2:3000/api/llm/chat');
    }
    return urls;
}
let localNetworkPermissionProbePromise = null;
let permissionPromptHandlersBound = false;

function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
}

let customGames = readStoredArray('ss-custom-games');
let uploadedFiles = [];
const DEFAULT_CUSTOM_GAME_POSTER_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22%3E%3Crect fill=%22%23233c51%22 width=%22200%22 height=%22300%22/%3E%3C/svg%3E';
const WORKSHOP_GAMES_TABLE = 'workshop_games';
const MASTER_ADMIN_RPC_NAME = 'is_signal_share_master_admin';
let isCurrentMasterAdmin = false;
let workshopTileMode = 'library';
let workshopLastLibraryCategory = 'all';
let workshopEditActiveGameId = '';
let workshopEditActiveFileName = '';
let workshopEditToolsExpanded = false;
let workshopEditorManualHeight = 0;
let workshopEditorResizeSession = null;
let workshopEditorAutosizeRaf = 0;
const workshopEditDraftCache = new Map();
const workshopEditPendingFilesByGame = new Map();
const workshopEditCoverDraftByGame = new Map();

function isCurrentUserGameOwner(game) {
    if (!game || !currentUser) return false;
    const currentUserId = `${currentUser.id || ''}`.trim();
    const gameAuthorId = `${game.authorId || ''}`.trim();
    if (currentUserId && gameAuthorId) {
        return gameAuthorId === currentUserId;
    }
    const currentUserName = `${currentUser.name || ''}`.trim();
    const gameAuthor = `${game.author || ''}`.trim();
    return !!(currentUserName && gameAuthor && gameAuthor === currentUserName);
}

function isAiPublishedWorkshopGame(game) {
    if (!game || typeof game !== 'object') return false;
    const gameId = `${game.id || ''}`.trim().toLowerCase();
    const title = `${game.title || ''}`.trim().toLowerCase();
    const author = `${game.author || ''}`.trim().toLowerCase();
    const tags = `${game.tags || ''}`.trim().toLowerCase();
    const description = `${game.description || ''}`.trim().toLowerCase();

    if (/\bai\b/.test(author) || /\bassistant\b/.test(author) || /\bcompanion\b/.test(author) || /\bbot\b/.test(author)) return true;
    if (/(^|[,\s])ai([,\s]|$)/i.test(tags)) return true;
    if (description.includes('ai-generated workshop game')) return true;
    if (description.includes('generated when remote ai routing is unavailable')) return true;
    if (gameId.startsWith('ai-') || gameId.startsWith('ai_')) return true;
    if (title.startsWith('ai ')) return true;
    return false;
}

function canCurrentSessionEditWorkshopGame(game) {
    if (!game || !currentUser) return false;
    if (isCurrentMasterAdmin || isCurrentUserGameOwner(game)) return true;

    const currentUserId = `${currentUser.id || ''}`.trim();
    const gameAuthorId = `${game.authorId || ''}`.trim();
    if (currentUserId && gameAuthorId && gameAuthorId !== currentUserId) return false;

    return isAiPublishedWorkshopGame(game);
}

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
    if (isLoopbackBridgeUrl(url)) return 'loopback';
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
        for (const url of getLocalNetworkPermissionProbeUrls()) {
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
    if (shouldAttemptBridgeRequests()) {
        void probeLocalNetworkPermission().catch(() => { });
    }
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
            void refreshMasterAdminStatus().finally(() => {
                if (currentCategory === 'publish') renderPublishedGames();
            });
            void loadWorkshopGamesFromSupabase().finally(() => {
                if (currentCategory === 'publish') {
                    renderPublishedGames();
                } else {
                    renderLibrary();
                }
            });
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

    if (supabaseClient) {
        await refreshMasterAdminStatus();
        await loadWorkshopGamesFromSupabase();
    } else {
        loadCustomGames();
    }
    setupFileUpload();
    updateAuthUI();

    // Set initial state so back button works even on first load
    history.replaceState({ type: 'category', cat: 'all' }, '');
    renderLibrary();

    // Standardize Signal Share Suite UI - Adjust for different viewport contexts
    handleIframeContext();
    window.addEventListener('resize', queueWorkshopEditorAutosize, { passive: true });
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

function normalizeCustomGameRecord(game) {
    if (!game || typeof game !== 'object') return null;
    const id = typeof game.id === 'string' && game.id.trim() ? game.id.trim() : '';
    if (!id) return null;
    const category = typeof game.category === 'string' && game.category.trim()
        ? game.category.trim().toUpperCase()
        : 'GAME';
    const type = `${game.type || ''}`.trim().toLowerCase() === 'utility'
        ? 'utility'
        : (category.toLowerCase() === 'utility' ? 'utility' : 'game');
    const files = Array.isArray(game.files) ? game.files.filter((file) => file && typeof file === 'object') : [];
    const entryFile = typeof game.entryFile === 'string' && game.entryFile.trim()
        ? game.entryFile.trim()
        : (files[0]?.name || 'index.html');
    const trackedStats = Array.isArray(game.trackedStats)
        ? game.trackedStats.filter((value) => typeof value === 'string' && value.trim())
        : [];

    return {
        id,
        title: typeof game.title === 'string' && game.title.trim() ? game.title.trim() : 'Untitled Game',
        category,
        poster: typeof game.poster === 'string' && game.poster.trim() ? game.poster.trim() : DEFAULT_CUSTOM_GAME_POSTER_DATA_URL,
        tag: typeof game.tag === 'string' && game.tag.trim() ? game.tag.trim() : `${category} • CUSTOM`,
        type,
        description: typeof game.description === 'string' ? game.description.trim() : '',
        tags: typeof game.tags === 'string' ? game.tags.trim() : '',
        author: typeof game.author === 'string' && game.author.trim() ? game.author.trim() : 'Unknown',
        authorId: typeof game.authorId === 'string' && game.authorId.trim() ? game.authorId.trim() : null,
        files,
        entryFile,
        publishedAt: typeof game.publishedAt === 'string' && game.publishedAt.trim() ? game.publishedAt : new Date().toISOString(),
        trackedStats,
        isCustomGame: true
    };
}

function replaceCustomGames(nextGames) {
    const normalizedNextGames = (Array.isArray(nextGames) ? nextGames : [])
        .map(normalizeCustomGameRecord)
        .filter(Boolean);
    const nextById = new Map(normalizedNextGames.map((game) => [game.id, game]));

    for (let index = GAMES.length - 1; index >= 0; index -= 1) {
        const game = GAMES[index];
        if (!game || typeof game.id !== 'string') continue;
        if ((game.isCustomGame || game.id.startsWith('custom_')) && !nextById.has(game.id)) {
            GAMES.splice(index, 1);
        }
    }

    nextById.forEach((game, id) => {
        const existingIndex = GAMES.findIndex((entry) => entry.id === id);
        if (existingIndex >= 0) {
            GAMES[existingIndex] = game;
        } else {
            GAMES.push(game);
        }
    });

    customGames = normalizedNextGames;
    localStorage.setItem('ss-custom-games', JSON.stringify(customGames));
}

function mapWorkshopGameRowToLocalRecord(row) {
    if (!row || typeof row !== 'object') return null;
    return normalizeCustomGameRecord({
        id: row.id,
        title: row.title,
        category: row.category,
        poster: row.poster,
        tag: row.tag,
        type: row.game_type,
        description: row.description,
        tags: row.tags,
        author: row.author_name,
        authorId: row.author_id,
        files: Array.isArray(row.files) ? row.files : [],
        entryFile: row.entry_file,
        publishedAt: row.published_at,
        trackedStats: Array.isArray(row.tracked_stats) ? row.tracked_stats : []
    });
}

function buildWorkshopGameRow(game) {
    const normalized = normalizeCustomGameRecord(game);
    if (!normalized) return null;
    return {
        id: normalized.id,
        title: normalized.title,
        category: normalized.category,
        poster: normalized.poster,
        tag: normalized.tag,
        game_type: normalized.type,
        description: normalized.description,
        tags: normalized.tags,
        author_name: normalized.author,
        author_id: normalized.authorId,
        files: normalized.files,
        entry_file: normalized.entryFile,
        tracked_stats: normalized.trackedStats,
        published_at: normalized.publishedAt
    };
}

async function refreshMasterAdminStatus() {
    if (!supabaseClient || !currentUser?.id) {
        isCurrentMasterAdmin = false;
        return false;
    }

    try {
        const { data, error } = await supabaseClient.rpc(MASTER_ADMIN_RPC_NAME);
        if (error) {
            console.warn('[Mini-Games] Master admin check failed:', error);
            isCurrentMasterAdmin = false;
            return false;
        }
        isCurrentMasterAdmin = data === true;
        return isCurrentMasterAdmin;
    } catch (error) {
        console.warn('[Mini-Games] Master admin check threw:', error);
        isCurrentMasterAdmin = false;
        return false;
    }
}

async function loadWorkshopGamesFromSupabase() {
    const localGames = readStoredArray('ss-custom-games')
        .map(normalizeCustomGameRecord)
        .filter(Boolean);

    if (!supabaseClient) {
        replaceCustomGames(localGames);
        return { ok: false, source: 'local-only' };
    }

    try {
        const { data, error } = await supabaseClient
            .from(WORKSHOP_GAMES_TABLE)
            .select('*')
            .order('published_at', { ascending: false });

        if (error) {
            console.warn('[Mini-Games] Failed to load workshop games from Supabase:', error);
            replaceCustomGames(localGames);
            return { ok: false, source: 'local-fallback', error };
        }

        const remoteGames = (Array.isArray(data) ? data : [])
            .map(mapWorkshopGameRowToLocalRecord)
            .filter(Boolean);
        replaceCustomGames(remoteGames);
        return { ok: true, source: 'supabase', count: remoteGames.length };
    } catch (error) {
        console.warn('[Mini-Games] Workshop load threw:', error);
        replaceCustomGames(localGames);
        return { ok: false, source: 'local-fallback', error };
    }
}

function loadCustomGames() {
    replaceCustomGames(customGames);
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
    const thumbnail = document.getElementById('game-thumbnail').value || DEFAULT_CUSTOM_GAME_POSTER_DATA_URL;
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
        const publishResult = await publishProcessedGameFiles({
            processedFiles,
            title,
            category,
            description,
            thumbnail,
            tags
        });
        if (!publishResult.ok) {
            throw new Error(publishResult.message || publishResult.error || 'publish-failed');
        }

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
        alert(err?.message || 'Failed to process files. Please try again.');
    }
}

function inferFileTypeFromName(fileName) {
    const lowerName = `${fileName || ''}`.trim().toLowerCase();
    if (lowerName.endsWith('.html')) return 'text/html';
    if (lowerName.endsWith('.css')) return 'text/css';
    if (lowerName.endsWith('.js')) return 'text/javascript';
    if (lowerName.endsWith('.json')) return 'application/json';
    return 'text/plain';
}

function encodeTextAsDataUrl(text, mimeType = 'text/plain;charset=utf-8') {
    try {
        const input = `${text ?? ''}`;
        const bytes = new TextEncoder().encode(input);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return `data:${mimeType};base64,${btoa(binary)}`;
    } catch (_error) {
        return `${text ?? ''}`;
    }
}

function collectTrackedStatsFromFiles(processedFiles) {
    const allCode = processedFiles.map(f => `${f.content || ''}`).join(' ');
    const trackedStats = [];
    const statRegex = /localStorage\.(?:get|set)Item\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = statRegex.exec(allCode)) !== null) {
        const key = match[1];
        const lowerKey = key.toLowerCase();
        const keywords = ['score', 'best', 'level', 'stats', 'rank', 'xp', 'streak', 'win', 'lose', 'food', 'points', 'plays', 'time', 'likes', 'views', 'eng', 'rep', 'consecutive'];
        if (keywords.some(k => lowerKey.includes(k)) && !trackedStats.includes(key)) {
            trackedStats.push(key);
        }
    }
    return trackedStats;
}

async function publishProcessedGameFiles(options = {}) {
    if (!currentUser) {
        return { ok: false, error: 'auth-required', message: 'Please sign in to publish games.' };
    }

    const rawFiles = Array.isArray(options.processedFiles) ? options.processedFiles : [];
    if (rawFiles.length === 0) {
        return { ok: false, error: 'no-files', message: 'No game files were provided.' };
    }

    const processedFiles = rawFiles
        .map((file, index) => {
            if (!file || typeof file !== 'object') return null;
            const fallbackName = `file-${index + 1}.txt`;
            const rawName = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : fallbackName;
            const name = rawName.replace(/[/\\]+/g, '_');
            const type = typeof file.type === 'string' && file.type.trim() ? file.type.trim() : inferFileTypeFromName(name);
            let content = typeof file.content === 'string' ? file.content : '';
            if (!content) return null;
            if (!content.startsWith('data:')) {
                content = encodeTextAsDataUrl(content, type);
            }
            return { name, content, type };
        })
        .filter(Boolean);

    if (processedFiles.length === 0) {
        return { ok: false, error: 'invalid-files', message: 'Game files could not be processed.' };
    }

    const requestedExistingId = typeof options.existingGameId === 'string' ? options.existingGameId.trim() : '';
    const existingGame = requestedExistingId
        ? customGames.find((game) => game.id === requestedExistingId) || null
        : null;
    if (existingGame && !canCurrentSessionEditWorkshopGame(existingGame)) {
        return { ok: false, error: 'not-owner', message: 'Only your own or AI-published workshop games can be edited.' };
    }

    const title = typeof options.title === 'string' && options.title.trim()
        ? options.title.trim()
        : (existingGame?.title || 'Untitled Game');
    const category = typeof options.category === 'string' && options.category.trim()
        ? options.category.trim().toUpperCase()
        : (existingGame?.category || 'GAME');
    const description = typeof options.description === 'string' && options.description.trim()
        ? options.description.trim()
        : (existingGame?.description || '');
    const thumbnail = typeof options.thumbnail === 'string' && options.thumbnail.trim()
        ? options.thumbnail.trim()
        : (existingGame?.poster || DEFAULT_CUSTOM_GAME_POSTER_DATA_URL);
    const tags = typeof options.tags === 'string' && options.tags.trim()
        ? options.tags.trim()
        : (existingGame?.tags || '');

    const gameId = existingGame?.id || ('custom_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now());
    const entryFile = processedFiles.find(f => f.name.toLowerCase() === 'index.html')
        || processedFiles.find(f => f.name.toLowerCase().endsWith('.html'))
        || processedFiles.find((f) => f.name === existingGame?.entryFile)
        || processedFiles[0];
    const trackedStats = collectTrackedStatsFromFiles(processedFiles);

    const newGame = {
        id: gameId,
        title,
        category,
        poster: thumbnail,
        tag: `${category} • CUSTOM`,
        type: category.toLowerCase() === 'utility' ? 'utility' : 'game',
        description,
        tags,
        author: existingGame?.author || currentUser.name,
        authorId: existingGame?.authorId || currentUser.id || null,
        files: processedFiles,
        entryFile: entryFile.name,
        publishedAt: existingGame?.publishedAt || new Date().toISOString(),
        trackedStats,
        isCustomGame: true
    };

    if (supabaseClient && currentUser.id) {
        const row = buildWorkshopGameRow(newGame);
        if (!row) {
            return { ok: false, error: 'invalid-payload', message: 'Workshop payload could not be prepared.' };
        }

        try {
            const { data, error } = await supabaseClient
                .from(WORKSHOP_GAMES_TABLE)
                .upsert(row, { onConflict: 'id' })
                .select('*')
                .single();

            if (error) {
                console.error('[Mini-Games] Supabase workshop publish failed:', error);
                return { ok: false, error: 'supabase-save-failed', message: error.message || 'Supabase rejected the workshop publish.' };
            }

            const persistedGame = mapWorkshopGameRowToLocalRecord(data) || newGame;
            replaceCustomGames([
                ...customGames.filter((game) => game.id !== persistedGame.id),
                persistedGame
            ]);
            renderLibrary();
            if (currentCategory === 'publish') renderPublishedGames();
            return { ok: true, game: persistedGame, source: 'supabase', updated: !!existingGame };
        } catch (error) {
            console.error('[Mini-Games] Supabase workshop publish threw:', error);
            return { ok: false, error: 'supabase-save-failed', message: error?.message || 'Supabase workshop publish failed.' };
        }
    }

    replaceCustomGames([
        ...customGames.filter((game) => game.id !== newGame.id),
        newGame
    ]);
    renderLibrary();
    if (currentCategory === 'publish') renderPublishedGames();
    return { ok: true, game: newGame, source: 'local', updated: !!existingGame };
}

async function publishCustomGameFromAi(payload = {}) {
    if (!currentUser) {
        return { ok: false, error: 'auth-required', message: 'Sign in to publish games to the workshop.' };
    }

    const payloadMode = `${payload.mode || payload.action || payload.operation || ''}`.trim().toLowerCase();
    const wantsUpdate = payloadMode === 'update' || payloadMode === 'edit' || payloadMode === 'improve';

    const explicitIdCandidates = [
        payload.gameId,
        payload.id,
        payload.updateId,
        payload.game_id,
        payload.existingGameId
    ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

    let existingGameId = explicitIdCandidates.find((candidate) => customGames.some((game) => game.id === candidate)) || '';
    if (!existingGameId && wantsUpdate) {
        const titleHint = `${payload.updateTitle || payload.targetTitle || payload.title || payload.gameTitle || ''}`.trim().toLowerCase();
        if (titleHint) {
            const ownedMatch = customGames.find((game) => {
                if (!isCurrentUserGameOwner(game)) return false;
                return `${game.title || ''}`.trim().toLowerCase() === titleHint;
            });
            if (ownedMatch) existingGameId = ownedMatch.id;
        }
    }

    if (wantsUpdate && !existingGameId) {
        return { ok: false, error: 'missing-target-game', message: 'AI update needs a valid gameId (or exact title of one of your games).' };
    }

    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length === 0) {
        return { ok: false, error: 'no-files', message: 'No game files were provided by the AI response.' };
    }

    const publishResult = await publishProcessedGameFiles({
        processedFiles: files,
        title: payload.title,
        category: payload.category,
        description: payload.description,
        thumbnail: payload.thumbnail,
        tags: payload.tags,
        existingGameId
    });

    if (!publishResult.ok) {
        return { ok: false, error: publishResult.error || 'publish-failed', message: publishResult.message || 'Unable to publish the generated game.' };
    }

    return {
        ok: true,
        gameId: publishResult.game.id,
        title: publishResult.game.title,
        assetCount: publishResult.game.files.length,
        updated: publishResult.updated === true
    };
}

function renderPublishedGames() {
    const grid = document.getElementById('published-games-grid');
    const noMsg = document.getElementById('no-published-msg');
    const countEl = document.getElementById('workshop-count');

    if (!grid) return;

    const visibleGames = getWorkshopManageableGames();
    const countLabel = isCurrentMasterAdmin ? 'FILES AVAILABLE' : 'FILES PUBLISHED';
    if (countEl) countEl.textContent = visibleGames.length + ' ' + countLabel;

    grid.innerHTML = '';
    if (noMsg) noMsg.style.display = visibleGames.length === 0 ? 'block' : 'none';

    visibleGames.forEach(game => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; transition: all 0.3s; position: relative;';

        const desc = (game.description || '').substring(0, 80);
        const descSuffix = (game.description || '').length > 80 ? '...' : '';

        const posterUrl = resolveGamePoster(game);
        const gameTag = buildGameTag(game);
        card.innerHTML = `
            <div style="height: 160px; background: url('${posterUrl}') center/cover; position: relative; overflow: hidden;">
                <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(16, 24, 34, 0.9), transparent); display: flex; align-items: flex-end; padding: 15px;">
                    <span style="font-size: 0.6rem; background: rgba(102, 192, 244, 0.2); color: var(--steam-light); padding: 4px 8px; border-radius: 4px; font-weight: 800; letter-spacing: 1px;">${gameTag}</span>
                </div>
            </div>
            <div style="padding: 20px;">
                <h4 style="margin: 0 0 8px; font-size: 1rem; font-weight: 800; color: #fff;">${game.title}</h4>
                <p style="margin: 0 0 20px; font-size: 0.8rem; opacity: 0.5; line-height: 1.5; min-height: 2.4em;">${desc}${descSuffix}</p>
                <div style="display: flex; gap: 10px;">
                    <button class="play-btn" onclick="launchCustomGame('${game.id}')" style="flex: 1; font-size: 0.8rem; padding: 10px; margin: 0; letter-spacing: 1px;">LAUNCH</button>
                </div>
            </div>`;
        attachTileDeleteButton(card, game.id);
        grid.appendChild(card);
    });

    syncWorkshopEditOverlay();
}

function getWorkshopManageableGames() {
    return customGames
        .filter((game) => canCurrentSessionEditWorkshopGame(game))
        .sort((a, b) => {
            const aTime = Date.parse(a?.publishedAt || '') || 0;
            const bTime = Date.parse(b?.publishedAt || '') || 0;
            return bTime - aTime;
        });
}

function isWorkshopFileEditable(file) {
    if (!file || typeof file !== 'object') return false;
    const fileName = `${file.name || ''}`.trim().toLowerCase();
    const fileType = `${file.type || ''}`.trim().toLowerCase();
    if (/\.(html?|css|js|mjs|cjs|json|txt|md|svg|xml)$/i.test(fileName)) return true;
    if (fileType.startsWith('text/')) return true;
    if (fileType.includes('json')) return true;
    if (fileType.includes('javascript')) return true;
    if (fileType.includes('xml')) return true;
    if (fileType.includes('svg')) return true;
    return false;
}

function decodeBase64ToUtf8(base64) {
    try {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch (_error) {
        try {
            return atob(base64);
        } catch (_fallbackError) {
            return '';
        }
    }
}

function decodeWorkshopFileContent(file) {
    const rawContent = typeof file?.content === 'string' ? file.content : '';
    if (!rawContent) return '';
    if (!rawContent.startsWith('data:')) return rawContent;

    const base64Marker = 'base64,';
    const base64Index = rawContent.indexOf(base64Marker);
    if (base64Index >= 0) {
        const encoded = rawContent.slice(base64Index + base64Marker.length);
        return decodeBase64ToUtf8(encoded);
    }

    const commaIndex = rawContent.indexOf(',');
    if (commaIndex >= 0) {
        const encoded = rawContent.slice(commaIndex + 1);
        try {
            return decodeURIComponent(encoded);
        } catch (_error) {
            return encoded;
        }
    }

    return rawContent;
}

function normalizeWorkshopFileName(fileName, fallbackName = 'file.txt') {
    const rawName = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : fallbackName;
    return rawName.replace(/[/\\]+/g, '_');
}

function getWorkshopPendingFiles(gameId) {
    if (!gameId) return [];
    const files = workshopEditPendingFilesByGame.get(gameId);
    return Array.isArray(files) ? files : [];
}

function setWorkshopPendingFiles(gameId, files) {
    if (!gameId) return;
    const normalized = (Array.isArray(files) ? files : []).filter((file) => file && typeof file === 'object');
    if (normalized.length === 0) {
        workshopEditPendingFilesByGame.delete(gameId);
        return;
    }
    workshopEditPendingFilesByGame.set(gameId, normalized);
}

function getWorkshopCoverDraftValue(game) {
    if (!game || !game.id) return DEFAULT_CUSTOM_GAME_POSTER_DATA_URL;
    const draft = workshopEditCoverDraftByGame.get(game.id);
    if (typeof draft === 'string' && draft.trim()) return draft.trim();
    if (typeof game.poster === 'string' && game.poster.trim()) return game.poster.trim();
    return DEFAULT_CUSTOM_GAME_POSTER_DATA_URL;
}

function formatByteSize(size) {
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${Math.round(size)} B`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('file-read-failed'));
        reader.readAsDataURL(file);
    });
}

function updateWorkshopCoverPreview(coverUrl) {
    const coverPreview = document.getElementById('workshop-edit-cover-preview');
    if (!coverPreview) return;
    const normalized = typeof coverUrl === 'string' ? coverUrl.trim() : '';
    if (normalized) {
        coverPreview.src = normalized;
        coverPreview.classList.add('visible');
    } else {
        coverPreview.src = '';
        coverPreview.classList.remove('visible');
    }
}

function renderWorkshopEditPendingFiles(gameId) {
    const listEl = document.getElementById('workshop-edit-upload-list');
    if (!listEl) return;
    const pendingFiles = getWorkshopPendingFiles(gameId);
    listEl.innerHTML = '';
    if (pendingFiles.length === 0) {
        listEl.innerHTML = '<div class="workshop-edit-upload-meta">No additional files queued.</div>';
        return;
    }

    pendingFiles.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'workshop-edit-upload-item';
        const fileName = normalizeWorkshopFileName(file.name, 'file.txt');
        const fileSize = formatByteSize(Number(file.size) || 0);
        item.innerHTML = `
            <div style="min-width: 0;">
                <strong>${escapeHtml(fileName)}</strong>
                <div class="workshop-edit-upload-meta">${escapeHtml(file.type || inferFileTypeFromName(fileName))} • ${escapeHtml(fileSize)}</div>
            </div>
            <button type="button" class="workshop-edit-remove-file" aria-label="Remove ${escapeHtml(fileName)}" onclick="removeWorkshopEditPendingFile('${encodeURIComponent(fileName)}')">×</button>
        `;
        listEl.appendChild(item);
    });
}

function syncWorkshopEditToolsPanel() {
    const toolsPanel = document.getElementById('workshop-edit-tools-panel');
    const toolsToggle = document.getElementById('workshop-edit-tools-toggle');
    if (!toolsPanel || !toolsToggle) return;

    toolsPanel.hidden = !workshopEditToolsExpanded;
    toolsToggle.textContent = workshopEditToolsExpanded ? 'Hide Asset Tools' : 'Show Asset Tools';
    toolsToggle.setAttribute('aria-expanded', workshopEditToolsExpanded ? 'true' : 'false');
    queueWorkshopEditorAutosize();
}

function toggleWorkshopEditToolsPanel() {
    workshopEditToolsExpanded = !workshopEditToolsExpanded;
    syncWorkshopEditToolsPanel();
    queueWorkshopEditorAutosize();
}

function getWorkshopEditorMinHeight() {
    return window.innerWidth <= 860 ? 220 : 260;
}

function clampWorkshopEditorHeight(height) {
    const minHeight = getWorkshopEditorMinHeight();
    const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * (window.innerWidth <= 860 ? 0.72 : 0.82)));
    return Math.min(maxHeight, Math.max(minHeight, Math.floor(Number(height) || minHeight)));
}

function startWorkshopEditorResize(event) {
    if (!event || (typeof event.button === 'number' && event.button !== 0)) return;
    const editor = document.getElementById('workshop-edit-file-content');
    if (!editor || editor.disabled) return;
    event.preventDefault();

    workshopEditorResizeSession = {
        startY: event.clientY,
        startHeight: editor.getBoundingClientRect().height
    };

    const onMouseMove = (moveEvent) => {
        if (!workshopEditorResizeSession) return;
        const deltaY = moveEvent.clientY - workshopEditorResizeSession.startY;
        const nextHeight = clampWorkshopEditorHeight(workshopEditorResizeSession.startHeight + deltaY);
        workshopEditorManualHeight = nextHeight;
        editor.style.height = `${nextHeight}px`;
        editor.style.overflowY = editor.scrollHeight > nextHeight ? 'auto' : 'hidden';
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.body.classList.remove('workshop-editor-resizing');
        workshopEditorResizeSession = null;
        queueWorkshopEditorAutosize();
    };

    document.body.classList.add('workshop-editor-resizing');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp, { once: true });
}

function queueWorkshopEditorAutosize() {
    if (workshopEditorAutosizeRaf) return;
    workshopEditorAutosizeRaf = window.requestAnimationFrame(() => {
        workshopEditorAutosizeRaf = 0;
        autoSizeWorkshopEditor();
    });
}

function autoSizeWorkshopEditor() {
    const overlay = document.getElementById('workshop-edit-overlay');
    const editor = document.getElementById('workshop-edit-file-content');
    if (!overlay || !editor) return;
    if (overlay.hidden || editor.disabled) return;

    const minHeight = getWorkshopEditorMinHeight();
    const reservedBottomSpace = 130;
    const overlayRect = overlay.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const availableHeight = Math.max(minHeight, Math.floor(overlayRect.bottom - editorRect.top - reservedBottomSpace));

    editor.style.height = 'auto';
    const desiredHeight = Math.max(minHeight, editor.scrollHeight + 2);
    const nextHeight = Math.min(desiredHeight, availableHeight);
    let appliedHeight = Math.max(minHeight, nextHeight);

    if (workshopEditorManualHeight > 0) {
        workshopEditorManualHeight = clampWorkshopEditorHeight(workshopEditorManualHeight);
        appliedHeight = Math.max(appliedHeight, workshopEditorManualHeight);
    }

    editor.style.height = `${appliedHeight}px`;
    editor.style.overflowY = desiredHeight > appliedHeight ? 'auto' : 'hidden';
}

function refreshWorkshopEditMeta() {
    const metaEl = document.getElementById('workshop-edit-file-meta');
    if (!metaEl) return;
    const games = getWorkshopManageableGames();
    const activeGame = games.find((game) => game.id === workshopEditActiveGameId) || null;
    if (!activeGame) {
        metaEl.textContent = '';
        return;
    }

    const activeFile = (Array.isArray(activeGame.files) ? activeGame.files : []).find((file) => `${file?.name || ''}` === workshopEditActiveFileName) || null;
    const fileName = activeFile?.name || workshopEditActiveFileName || 'No file selected';
    const fileTypeLabel = activeFile ? (activeFile.type || inferFileTypeFromName(activeFile.name)) : 'n/a';
    const pendingCount = getWorkshopPendingFiles(activeGame.id).length;
    const pendingLabel = pendingCount > 0 ? `  •  ${pendingCount} file${pendingCount === 1 ? '' : 's'} queued` : '';
    metaEl.textContent = `${activeGame.title}  •  ${fileName}  •  ${fileTypeLabel}${pendingLabel}`;
}

function triggerWorkshopEditCoverFilePicker() {
    const input = document.getElementById('workshop-edit-cover-file');
    if (input) input.click();
}

function triggerWorkshopEditAddFilesPicker() {
    const input = document.getElementById('workshop-edit-add-files');
    if (input) input.click();
}

function handleWorkshopEditCoverInput() {
    if (!workshopEditActiveGameId) return;
    const coverInput = document.getElementById('workshop-edit-cover-url');
    if (!coverInput) return;
    const nextValue = `${coverInput.value || ''}`.trim();
    workshopEditCoverDraftByGame.set(workshopEditActiveGameId, nextValue || DEFAULT_CUSTOM_GAME_POSTER_DATA_URL);
    updateWorkshopCoverPreview(nextValue || DEFAULT_CUSTOM_GAME_POSTER_DATA_URL);
    setWorkshopEditStatus('Unsaved cover changes.');
}

async function handleWorkshopEditCoverFileChange(event) {
    if (!workshopEditActiveGameId) return;
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        workshopEditCoverDraftByGame.set(workshopEditActiveGameId, dataUrl);
        const coverInput = document.getElementById('workshop-edit-cover-url');
        if (coverInput) coverInput.value = dataUrl;
        updateWorkshopCoverPreview(dataUrl);
        setWorkshopEditStatus(`Queued cover image: ${file.name}`);
    } catch (error) {
        console.error('[Mini-Games] Failed to read cover image file:', error);
        setWorkshopEditStatus('Failed to read cover image file.', true);
    } finally {
        if (input) input.value = '';
    }
}

async function handleWorkshopEditAddFiles(event) {
    const input = event?.target;
    const files = Array.from(input?.files || []);
    if (!workshopEditActiveGameId || files.length === 0) return;
    const gameId = workshopEditActiveGameId;
    const activeGame = getWorkshopManageableGames().find((game) => game.id === gameId) || null;
    if (!activeGame) return;

    const pendingFiles = [...getWorkshopPendingFiles(gameId)];
    const existingFileMap = new Map((Array.isArray(activeGame.files) ? activeGame.files : []).map((file) => [normalizeWorkshopFileName(file?.name || ''), file]));
    const pendingMap = new Map(pendingFiles.map((file) => [normalizeWorkshopFileName(file?.name || ''), file]));

    let appliedCount = 0;
    for (const file of files) {
        const fileName = normalizeWorkshopFileName(file.name, `file-${Date.now()}.txt`);
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const nextRecord = {
                name: fileName,
                type: file.type || inferFileTypeFromName(fileName),
                content: dataUrl,
                size: file.size || 0
            };
            pendingMap.set(fileName, nextRecord);
            if (existingFileMap.has(fileName)) {
                setWorkshopEditStatus(`Replaced existing file "${fileName}" in pending changes.`);
            }
            appliedCount += 1;
        } catch (error) {
            console.error('[Mini-Games] Failed to read workshop file:', fileName, error);
        }
    }

    setWorkshopPendingFiles(gameId, Array.from(pendingMap.values()));
    renderWorkshopEditPendingFiles(gameId);
    refreshWorkshopEditMeta();

    if (appliedCount > 0) {
        setWorkshopEditStatus(`Queued ${appliedCount} file${appliedCount === 1 ? '' : 's'} for save.`);
    } else {
        setWorkshopEditStatus('No files were added.', true);
    }

    if (input) input.value = '';
}

function removeWorkshopEditPendingFile(encodedName) {
    const gameId = workshopEditActiveGameId;
    if (!gameId) return;
    const decodedName = decodeURIComponent(`${encodedName || ''}`);
    const nextFiles = getWorkshopPendingFiles(gameId).filter((file) => normalizeWorkshopFileName(file?.name || '') !== decodedName);
    setWorkshopPendingFiles(gameId, nextFiles);
    renderWorkshopEditPendingFiles(gameId);
    refreshWorkshopEditMeta();
    setWorkshopEditStatus(`Removed queued file "${decodedName}".`);
}

function setWorkshopEditStatus(message = '', isError = false) {
    const statusEl = document.getElementById('workshop-edit-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'rgba(255, 120, 120, 0.92)' : 'rgba(102, 192, 244, 0.92)';
}

function syncWorkshopModeToggleButtons() {
    const buttons = Array.from(document.querySelectorAll('.workshop-mode-btn[data-workshop-mode]'));
    buttons.forEach((button) => {
        const mode = `${button.getAttribute('data-workshop-mode') || ''}`.trim().toLowerCase();
        const isActive = mode === 'edit' ? workshopTileMode === 'edit' : workshopTileMode !== 'edit';
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function setWorkshopTileMode(nextMode) {
    workshopTileMode = `${nextMode || ''}`.trim().toLowerCase() === 'edit' ? 'edit' : 'library';
    if (workshopTileMode === 'edit') {
        if (currentCategory !== 'edit') {
            if (currentCategory && currentCategory !== 'edit') {
                workshopLastLibraryCategory = currentCategory;
            }
            setCategory('edit');
            return;
        }
    } else if (currentCategory === 'edit') {
        const fallbackCategory = workshopLastLibraryCategory && workshopLastLibraryCategory !== 'edit'
            ? workshopLastLibraryCategory
            : 'all';
        setCategory(fallbackCategory);
        return;
    }
    syncWorkshopEditOverlay();
}

function syncWorkshopEditOverlay() {
    syncWorkshopModeToggleButtons();
    syncWorkshopEditToolsPanel();

    const overlay = document.getElementById('workshop-edit-overlay');
    if (!overlay) return;

    const shouldShow = workshopTileMode === 'edit' && currentCategory === 'edit';
    overlay.hidden = !shouldShow;
    overlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    if (!shouldShow) return;

    const games = getWorkshopManageableGames();
    const gameSelect = document.getElementById('workshop-edit-game-select');
    const fileSelect = document.getElementById('workshop-edit-file-select');
    const editor = document.getElementById('workshop-edit-file-content');
    const saveButton = document.getElementById('workshop-edit-save-btn');
    const metaEl = document.getElementById('workshop-edit-file-meta');
    const coverInput = document.getElementById('workshop-edit-cover-url');
    const coverFileInput = document.getElementById('workshop-edit-cover-file');
    const addFilesInput = document.getElementById('workshop-edit-add-files');
    if (!gameSelect || !fileSelect || !editor || !saveButton || !metaEl || !coverInput || !coverFileInput || !addFilesInput) return;

    const disableEditorUi = (message = '') => {
        gameSelect.disabled = true;
        fileSelect.disabled = true;
        editor.value = '';
        editor.disabled = true;
        editor.style.height = '';
        editor.style.overflowY = 'hidden';
        saveButton.disabled = true;
        coverInput.value = '';
        coverInput.disabled = true;
        coverFileInput.disabled = true;
        addFilesInput.disabled = true;
        metaEl.textContent = '';
        updateWorkshopCoverPreview('');
        renderWorkshopEditPendingFiles('');
        if (message) setWorkshopEditStatus(message, true);
    };

    if (!currentUser) {
        workshopEditActiveGameId = '';
        workshopEditActiveFileName = '';
        gameSelect.innerHTML = '<option value="">Sign in required</option>';
        fileSelect.innerHTML = '<option value="">No files</option>';
        disableEditorUi('Sign in to access workshop file editing.');
        return;
    }

    if (games.length === 0) {
        workshopEditActiveGameId = '';
        workshopEditActiveFileName = '';
        gameSelect.innerHTML = '<option value="">No editable games</option>';
        fileSelect.innerHTML = '<option value="">No files</option>';
        disableEditorUi('No workshop games are available to edit yet.');
        return;
    }

    if (!games.some((game) => game.id === workshopEditActiveGameId)) {
        workshopEditActiveGameId = games[0].id;
    }

    gameSelect.innerHTML = '';
    games.forEach((game) => {
        const option = document.createElement('option');
        option.value = game.id;
        option.textContent = game.title || game.id;
        gameSelect.appendChild(option);
    });
    gameSelect.value = workshopEditActiveGameId;
    gameSelect.disabled = false;

    const activeGame = games.find((game) => game.id === workshopEditActiveGameId) || games[0];
    if (!activeGame) {
        setWorkshopEditStatus('Could not resolve selected game.', true);
        return;
    }

    const editableFiles = (Array.isArray(activeGame.files) ? activeGame.files : []).filter(isWorkshopFileEditable);
    const activeCover = getWorkshopCoverDraftValue(activeGame);
    coverInput.value = activeCover;
    coverInput.disabled = false;
    coverFileInput.disabled = false;
    addFilesInput.disabled = false;
    updateWorkshopCoverPreview(activeCover);
    renderWorkshopEditPendingFiles(activeGame.id);

    if (editableFiles.length === 0) {
        workshopEditActiveFileName = '';
        fileSelect.innerHTML = '<option value="">No editable files</option>';
        fileSelect.disabled = true;
        editor.value = '';
        editor.disabled = true;
        saveButton.disabled = true;
        metaEl.textContent = `${activeGame.title} has no text-based files available for inline editing.`;
        setWorkshopEditStatus('Add .html/.css/.js/.json/.txt files to edit in this panel.', true);
        return;
    }

    if (!editableFiles.some((file) => file.name === workshopEditActiveFileName)) {
        workshopEditActiveFileName = editableFiles[0].name;
    }

    fileSelect.innerHTML = '';
    editableFiles.forEach((file) => {
        const option = document.createElement('option');
        option.value = file.name;
        option.textContent = file.name;
        fileSelect.appendChild(option);
    });
    fileSelect.value = workshopEditActiveFileName;
    fileSelect.disabled = false;

    const activeFile = editableFiles.find((file) => file.name === workshopEditActiveFileName) || editableFiles[0];
    if (!activeFile) {
        setWorkshopEditStatus('Could not resolve selected file.', true);
        return;
    }

    const draftKey = `${activeGame.id}::${activeFile.name}`;
    const cachedDraft = workshopEditDraftCache.get(draftKey);
    editor.value = typeof cachedDraft === 'string' ? cachedDraft : decodeWorkshopFileContent(activeFile);
    editor.disabled = false;
    saveButton.disabled = false;
    const fileTypeLabel = activeFile.type || inferFileTypeFromName(activeFile.name);
    const pendingCount = getWorkshopPendingFiles(activeGame.id).length;
    const pendingLabel = pendingCount > 0 ? `  •  ${pendingCount} file${pendingCount === 1 ? '' : 's'} queued` : '';
    metaEl.textContent = `${activeGame.title}  •  ${activeFile.name}  •  ${fileTypeLabel}${pendingLabel}`;

    if (!cachedDraft) {
        setWorkshopEditStatus('Edit the file and click Save Changes.');
    }
    queueWorkshopEditorAutosize();
}

function handleWorkshopEditGameChange() {
    const gameSelect = document.getElementById('workshop-edit-game-select');
    if (!gameSelect) return;
    workshopEditActiveGameId = `${gameSelect.value || ''}`.trim();
    workshopEditActiveFileName = '';
    syncWorkshopEditOverlay();
}

function handleWorkshopEditFileChange() {
    const fileSelect = document.getElementById('workshop-edit-file-select');
    if (!fileSelect) return;
    workshopEditActiveFileName = `${fileSelect.value || ''}`.trim();
    syncWorkshopEditOverlay();
}

function handleWorkshopEditContentInput() {
    const editor = document.getElementById('workshop-edit-file-content');
    if (!editor || !workshopEditActiveGameId || !workshopEditActiveFileName) return;
    const draftKey = `${workshopEditActiveGameId}::${workshopEditActiveFileName}`;
    workshopEditDraftCache.set(draftKey, editor.value);
    setWorkshopEditStatus('Unsaved changes.');
    queueWorkshopEditorAutosize();
}

function revertWorkshopEditCurrentFile() {
    if (!workshopEditActiveGameId || !workshopEditActiveFileName) return;
    const draftKey = `${workshopEditActiveGameId}::${workshopEditActiveFileName}`;
    workshopEditDraftCache.delete(draftKey);
    syncWorkshopEditOverlay();
    setWorkshopEditStatus('File reset to last saved version.');
}

async function saveWorkshopEditPanel() {
    const games = getWorkshopManageableGames();
    const activeGame = games.find((game) => game.id === workshopEditActiveGameId) || null;
    if (!activeGame) {
        setWorkshopEditStatus('Select a game before saving.', true);
        return;
    }

    const editor = document.getElementById('workshop-edit-file-content');
    const saveButton = document.getElementById('workshop-edit-save-btn');
    const coverInput = document.getElementById('workshop-edit-cover-url');
    if (!editor || !saveButton || !coverInput) return;

    const fileName = `${workshopEditActiveFileName || ''}`.trim();
    const editableFiles = (Array.isArray(activeGame.files) ? activeGame.files : []).filter((file) => file && typeof file === 'object');
    const pendingFiles = getWorkshopPendingFiles(activeGame.id);

    const updatedFiles = editableFiles.map((file) => {
        if (!file || typeof file !== 'object') return file;
        if (!fileName || `${file.name || ''}` !== fileName) return file;
        const mimeType = typeof file.type === 'string' && file.type.trim() ? file.type.trim() : inferFileTypeFromName(file.name);
        return {
            ...file,
            type: mimeType,
            content: encodeTextAsDataUrl(editor.value, mimeType)
        };
    });

    const mergedByName = new Map();
    updatedFiles.forEach((file) => {
        if (!file || typeof file !== 'object') return;
        const name = normalizeWorkshopFileName(file.name, 'file.txt');
        mergedByName.set(name, {
            ...file,
            name
        });
    });
    pendingFiles.forEach((file) => {
        if (!file || typeof file !== 'object') return;
        const name = normalizeWorkshopFileName(file.name, 'file.txt');
        const type = file.type || inferFileTypeFromName(name);
        let content = typeof file.content === 'string' ? file.content : '';
        if (content && !content.startsWith('data:')) {
            content = encodeTextAsDataUrl(content, type);
        }
        if (!content) return;
        mergedByName.set(name, {
            name,
            type,
            content
        });
    });

    const finalFiles = Array.from(mergedByName.values());
    if (finalFiles.length === 0) {
        setWorkshopEditStatus('Add at least one file before saving.', true);
        return;
    }

    const normalizedCover = `${coverInput.value || ''}`.trim() || getWorkshopCoverDraftValue(activeGame);
    workshopEditCoverDraftByGame.set(activeGame.id, normalizedCover);

    setWorkshopEditStatus('Saving workshop changes...');
    saveButton.disabled = true;

    try {
        const result = await publishProcessedGameFiles({
            processedFiles: finalFiles,
            title: activeGame.title,
            category: activeGame.category,
            description: activeGame.description,
            thumbnail: normalizedCover,
            tags: activeGame.tags,
            existingGameId: activeGame.id
        });
        if (!result.ok) {
            throw new Error(result.message || 'Failed to save workshop changes.');
        }

        if (fileName) {
            const draftKey = `${activeGame.id}::${fileName}`;
            workshopEditDraftCache.delete(draftKey);
        }
        setWorkshopPendingFiles(activeGame.id, []);
        workshopEditCoverDraftByGame.set(activeGame.id, normalizedCover);

        renderPublishedGames();
        syncWorkshopEditOverlay();
        const savedTime = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        setWorkshopEditStatus(`Saved workshop changes at ${savedTime}.`);
    } catch (error) {
        console.error('[Mini-Games] Workshop edit save failed:', error);
        setWorkshopEditStatus(error?.message || 'Failed to save workshop changes.', true);
    } finally {
        saveButton.disabled = false;
    }
}

function attachTileDeleteButton(card, gameId) {
    if (!(card instanceof HTMLElement)) return;
    const customGame = customGames.find((game) => game.id === gameId) || null;
    if (!customGame) return;
    const canDelete = isCurrentMasterAdmin || isCurrentUserGameOwner(customGame);
    if (!canDelete) return;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'tile-delete-btn';
    deleteButton.textContent = '×';
    deleteButton.setAttribute('aria-label', `Delete ${customGame.title || 'game'}`);
    deleteButton.title = 'Delete game';
    deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void deleteCustomGame(gameId);
    });
    card.appendChild(deleteButton);
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

async function deleteCustomGame(gameId) {
    const targetGame = customGames.find((game) => game.id === gameId) || null;
    const canDelete = isCurrentMasterAdmin || isCurrentUserGameOwner(targetGame);
    if (!canDelete) {
        alert('Only the publisher or a master admin can delete this workshop game.');
        return;
    }

    if (!confirm('Are you sure you want to delete this game?')) return;

    if (supabaseClient) {
        const { error } = await supabaseClient
            .from(WORKSHOP_GAMES_TABLE)
            .delete()
            .eq('id', gameId);
        if (error) {
            console.error('[Mini-Games] Workshop delete failed:', error);
            alert(error.message || 'Failed to delete workshop game.');
            return;
        }
    }

    replaceCustomGames(customGames.filter((game) => game.id !== gameId));
    renderLibrary();
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
    const nextCategory = `${cat || ''}`.trim().toLowerCase() || 'all';
    if (nextCategory !== 'edit') {
        workshopLastLibraryCategory = nextCategory;
    }
    workshopTileMode = nextCategory === 'edit' ? 'edit' : 'library';
    currentCategory = nextCategory;
    syncCurrentCategoryGlobal();


    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNavCategory = nextCategory === 'edit' ? 'publish' : nextCategory;
    const navEl = document.getElementById(`nav-${activeNavCategory}`);
    if (navEl) navEl.classList.add('active');

    document.querySelectorAll('.mobile-nav-item').forEach(el => el.classList.remove('active'));
    const mobNavEl = document.getElementById(`mob-nav-${activeNavCategory}`);
    if (mobNavEl) mobNavEl.classList.add('active');

    const hero = document.querySelector('.featured-hero');
    const library = document.getElementById('library-view');
    const store = document.getElementById('store-view');
    const publish = document.getElementById('publish-view');
    const detail = document.getElementById('detail-view');
    const leader = document.getElementById('leaderboard-view');
    const workshopEditView = document.getElementById('workshop-edit-view');
    const runner = document.getElementById('app-runner');
    const title = document.getElementById('library-title');
    const clearBtn = document.getElementById('clear-recent');

    if (library) library.style.display = 'none';
    if (store) store.style.display = 'none';
    if (publish) publish.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (leader) leader.style.display = 'none';
    if (workshopEditView) workshopEditView.style.display = 'none';
    if (runner) runner.style.display = 'none';
    document.body.style.overflow = 'auto';

    if (nextCategory === 'store') {
        if (store) store.style.display = 'block';
        const msg = document.getElementById('store-locked-msg');
        const content = document.getElementById('store-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
    } else if (nextCategory === 'publish') {
        if (publish) publish.style.display = 'block';
        const msg = document.getElementById('publish-locked-msg');
        const content = document.getElementById('publish-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
        if (currentUser) renderPublishedGames();
    } else if (nextCategory === 'leaderboard') {
        if (leader) leader.style.display = 'block';
        const msg = document.getElementById('leader-locked-msg');
        const content = document.getElementById('leader-content');
        if (msg) msg.style.display = currentUser ? 'none' : 'block';
        if (content) content.style.display = currentUser ? 'block' : 'none';
        if (currentUser) {
            void renderLeaderboard();
            if (typeof window.renderGlobalLeaderboards === 'function') {
                void window.renderGlobalLeaderboards();
            }
        }
    } else if (nextCategory === 'edit') {
        if (workshopEditView) workshopEditView.style.display = 'block';
        if (title) title.textContent = 'WORKSHOP EDITOR';
        if (clearBtn) clearBtn.style.display = 'none';
    } else {
        if (library) library.style.display = 'block';
        if (hero) hero.style.display = (nextCategory === 'all') ? 'flex' : 'none';

        let displayTitle = nextCategory.toUpperCase();
        if (nextCategory === 'all') displayTitle = 'ALL GAMES & UTILITIES';
        if (nextCategory === 'games') displayTitle = 'GAMES';
        if (nextCategory === 'utilities') displayTitle = 'UTILITIES';

        if (title) title.textContent = displayTitle;
        if (clearBtn) clearBtn.style.display = (nextCategory === 'recent') ? 'block' : 'none';
        renderLibrary();
    }

    syncWorkshopEditOverlay();

    if (!skipPush && !isNavigatingHistory) {
        history.pushState({ type: 'category', cat: nextCategory }, '');
    }

    resetShellScrollPosition();
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
        const posterUrl = resolveGamePoster(game);
        const gameTag = buildGameTag(game);
        card.innerHTML = `
            <div class="poster-wrapper"><img src="${posterUrl}"></div>
            <div class="card-info">
                <div class="card-title">${game.title}</div>
                <div class="card-tag">${gameTag}</div>
            </div>
        `;
        attachTileDeleteButton(card, game.id);
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
    if (g && hubBg) hubBg.style.backgroundImage = `url(${resolveGamePoster(g)})`;

    Object.entries(STATIC_HUB_IDS).forEach(([id, hubId]) => {
        const hub = document.getElementById(hubId);
        if (hub) hub.style.display = (game === id) ? 'block' : 'none';
    });

    const dynamicHub = document.getElementById('hub-dynamic');
    if (dynamicHub) {
        const hasStaticHub = Object.prototype.hasOwnProperty.call(STATIC_HUB_IDS, game);
        if (hasStaticHub) {
            dynamicHub.style.display = 'none';
            dynamicHub.innerHTML = '';
        } else {
            renderDynamicHub(g);
        }
    }

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

function launchSudoku() {
    recordLaunch('sudoku');
    openApp(`./sudoku-game.html`, 'Neon Sudoku', 'neon_sudoku_poster.png', 'sudoku');
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

    // Signal Share Fitting Suite: Ensure all applications fit the screen
    frame.onload = () => {
        try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            
            // Mark as a Signal Share App for global CSS targeting
            doc.documentElement.classList.add('is-signal-app');
            
            if (isAndroid) {
                doc.documentElement.classList.add('platform-android');
            }
        } catch (e) {
            console.warn('[App Runner] Could not inject fitting classes (Cross-origin or early load)', e);
        }
    };

    if (runner) runner.style.display = 'flex';
    document.body.classList.add('runner-open');
    document.body.style.overflow = 'hidden';

    // Synchronize offsets to ensure runner respects the companion sidebar
    if (window.syncArcadeSidebarOffsets) {
        window.syncArcadeSidebarOffsets();
        // Run again after layout/paint so the companion width is fully measured.
        requestAnimationFrame(() => {
            window.syncArcadeSidebarOffsets();
        });
    }

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
    document.body.classList.remove('runner-open');
    document.body.style.overflow = 'auto';

    // Reset offsets when closing the runner
    if (window.syncArcadeSidebarOffsets) {
        window.syncArcadeSidebarOffsets();
    }

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
window.launchSudoku = launchSudoku;
window.launchCalc = launchCalc;
window.closeApp = closeApp;
window.toggleAuth = toggleAuth;
window.performLogin = performLogin;
window.hideAuth = hideAuth;
window.showAuth = showAuth;
window.removeUploadedFile = removeUploadedFile;
window.publishCustomGame = publishCustomGame;
window.publishCustomGameFromAi = publishCustomGameFromAi;
window.setWorkshopTileMode = setWorkshopTileMode;
window.handleWorkshopEditGameChange = handleWorkshopEditGameChange;
window.handleWorkshopEditFileChange = handleWorkshopEditFileChange;
window.handleWorkshopEditContentInput = handleWorkshopEditContentInput;
window.handleWorkshopEditCoverInput = handleWorkshopEditCoverInput;
window.triggerWorkshopEditCoverFilePicker = triggerWorkshopEditCoverFilePicker;
window.handleWorkshopEditCoverFileChange = handleWorkshopEditCoverFileChange;
window.triggerWorkshopEditAddFilesPicker = triggerWorkshopEditAddFilesPicker;
window.handleWorkshopEditAddFiles = handleWorkshopEditAddFiles;
window.removeWorkshopEditPendingFile = removeWorkshopEditPendingFile;
window.toggleWorkshopEditToolsPanel = toggleWorkshopEditToolsPanel;
window.startWorkshopEditorResize = startWorkshopEditorResize;
window.revertWorkshopEditCurrentFile = revertWorkshopEditCurrentFile;
window.saveWorkshopEditPanel = saveWorkshopEditPanel;
window.getWorkshopGamesForAi = function() {
    return customGames
        .filter((game) => canCurrentSessionEditWorkshopGame(game))
        .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        .slice(0, 5) // Drastically reduce memory pressure by only showing top 5 recent games
        .map((game) => {
            const editableFiles = (Array.isArray(game.files) ? game.files : [])
                .filter(isWorkshopFileEditable)
                .map(f => ({ name: f.name, type: f.type || inferFileTypeFromName(f.name) }));
            
            return {
                id: game.id,
                title: game.title,
                files: editableFiles // Only provide names/types, no content
            };
        });
};

/**
 * Applies a surgical file edit from the AI to the workshop editor state.
 * This version is optimized for command-based editing.
 */
window.applyAiFilePatch = async function(gameId, fileName, search, replace, options = {}) {
    console.log(`[AI Workshop] Applying surgical patch to ${fileName}`);
    const { save = false, silent = false } = options;

    const oldContent = (typeof window.getWorkshopFileContent === 'function') ? window.getWorkshopFileContent(gameId, fileName) : "";
    if (!oldContent) return { ok: false, message: "Original file content unavailable." };

    // 1. Line-by-Line Normalized Matching (High Precision)
    const fileLines = oldContent.split(/\r?\n/);
    const searchLines = search.trim().split(/\r?\n/).map(l => l.trim());
    const searchLen = searchLines.length;
    
    if (searchLen === 0) return { ok: false, message: "SEARCH block is empty." };

    let matchIdx = -1;
    const normalize = (s) => s.replace(/['"]/g, '"').replace(/\s+/g, ' ').trim();

    for (let i = 0; i <= fileLines.length - searchLen; i++) {
        let match = true;
        for (let j = 0; j < searchLen; j++) {
            if (normalize(fileLines[i + j]) !== normalize(searchLines[j])) {
                match = false;
                break;
            }
        }
        if (match) { matchIdx = i; break; }
    }

    if (matchIdx !== -1) {
        const lineEnding = oldContent.includes('\r\n') ? '\r\n' : '\n';
        const before = fileLines.slice(0, matchIdx);
        const after = fileLines.slice(matchIdx + searchLen);
        
        // Indentation Preservation
        const indent = fileLines[matchIdx].match(/^(\s*)/)?.[1] || "";
        let finalReplace = replace;
        if (replace.includes('\n') && !replace.startsWith(' ') && !replace.startsWith('\t')) {
            finalReplace = replace.split('\n').map(line => line.trim() ? indent + line : line).join('\n');
        }

        const newContent = [...before, finalReplace, ...after].join(lineEnding);
        return window.internalApplyWorkshopFileEdit(gameId, fileName, newContent, options);
    }

    return { 
        ok: false, 
        message: `Could not find exact code block in ${fileName}. Ensure SEARCH is a direct copy.` 
    };
};

window.internalApplyWorkshopFileEdit = async function(gameId, fileName, content, options = {}) {
    const { save = false, silent = false } = options;
    const games = getWorkshopManageableGames();
    const game = games.find(g => g.id === gameId);
    if (!game) return { ok: false, message: "Game not found." };

    const draftKey = `${gameId}::${fileName}`;
    workshopEditDraftCache.set(draftKey, content);

    if (workshopEditActiveGameId === gameId && (!workshopEditActiveFileName || workshopEditActiveFileName === fileName)) {
        workshopEditActiveFileName = fileName;
        const editor = document.getElementById('workshop-edit-file-content');
        if (editor) {
            editor.value = content;
            setWorkshopEditStatus('A.I. updated file.');
            queueWorkshopEditorAutosize();
        }
        syncWorkshopEditOverlay();
    }

    if (!silent && window.showFeedback) window.showFeedback(`Updated: ${fileName}`);

    if (save) {
        try {
            await saveWorkshopEditPanel();
            return { ok: true, message: `Updated and saved ${fileName}.`, saved: true };
        } catch (err) {
            return { ok: false, message: `Save failed: ${err.message}`, saved: false };
        }
    }

    return { ok: true, message: `Updated ${fileName} (Draft).`, saved: false };
};

/**
 * Retrieves the decoded text content of a workshop file.
 * Used by the AI to read existing code before editing.
 */
window.getWorkshopFileContent = function(gameId, fileName) {
    const game = customGames.find(g => g.id === gameId);
    if (!game || !canCurrentSessionEditWorkshopGame(game)) return null;

    const file = (Array.isArray(game.files) ? game.files : []).find(f => f.name === fileName);
    if (!file) return null;

    // Check draft cache first
    const draftKey = `${gameId}::${fileName}`;
    const cachedDraft = workshopEditDraftCache.get(draftKey);
    if (typeof cachedDraft === 'string') return cachedDraft;

    return decodeWorkshopFileContent(file);
};


window.getWorkshopEditorState = function() {
    if (typeof workshopEditActiveGameId === 'undefined') return null;
    return {
        activeGameId: workshopEditActiveGameId,
        activeFileName: workshopEditActiveFileName,
        activeFileContent: workshopEditActiveGameId && workshopEditActiveFileName ? window.getWorkshopFileContent(workshopEditActiveGameId, workshopEditActiveFileName) : null,
        isToolsExpanded: !!(typeof workshopEditToolsExpanded !== 'undefined' && workshopEditToolsExpanded)
    };
};
window.clearRecent = clearRecent;
window.toggleObstCount = toggleObstCount;

/**
 * Gathers stats for all games in the suite.
 * Used by the AI Companion to provide performance analysis.
 */
window.getAllGameStats = function() {
    if (typeof GAMES === 'undefined' || typeof discoverStats !== 'function') return {};
    const allStats = {};
    GAMES.forEach(game => {
        allStats[game.id] = {
            title: game.title,
            stats: discoverStats(game)
        };
    });
    return allStats;
};

// Start the engine
document.addEventListener('DOMContentLoaded', init);
