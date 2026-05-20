/**
 * Hero Media Player Actions - Complete Rewrite
 * Handles all media control actions: play/pause, next/prev, volume, open phone
 * 
 * ARCHITECTURE:
 * - Unified action handlers for all playback controls
 * - Supports both native snapshot bridge (capacitor) and desktop snapshot bridge
 * - Integrates with feed mode vs media mode toggle system
 * - Handles volume persistence and sync
 * - Cross-platform compatibility (web, mobile, desktop)
 */

import { toCleanString, isThenable } from './shared-utils.js';

/**
 * Constants for timing and configuration
 */
const NATIVE_POLL_INTERVAL_MS = 3000;          // Native bridge polling interval
const DESKTOP_POLL_INTERVAL_MS = 2000;         // Desktop snapshot polling interval
const LOCAL_NETWORK_PROMPT_COOLDOWN_MS = 30_000;
const VOLUME_CHANGE_COOLDOWN_MS = 1000;        // Prevent rapid volume changes

/**
 * Global state for preventing race conditions
 */
let lastActionAt = 0;
let desktopPollTimerId = null;
let nativePollTimerId = null;
let localNetworkPromptInFlight = false;
let lastVolumeChangedAt = 0;

/**
 * Main actions object - returns all action handler functions
 */
export function getHeroMediaActions(options) {
  const {
    state,
    elements,
    getControllablePlayerPost,
    getActivePlayerMediaElement,
    getPlayableVisiblePostIds,
    getAllPosts,
    getPostById,
    getProfileSummaryForPost,
    formatKind,
    getSignalLabel,
    formatTimestamp,
    normalizePlayerVolume,
    savePlayerVolume,
    applyPlayerVolumeToActiveElement,
    stepMiniPlayer,
    renderMiniPlayer,
    postMessageToYouTubePlayer,
    getSpotifyPreviewImageUrl,
    getExternalPreviewMetadata,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getHeroPost,
    setHeroPost,
    playHeroMedia,
    stepHeroPlayer,
    getHeroPlayablePosts,
    resolveYouTubePreviewId,
    isNativeCapacitorApp,
    getCapacitorPlatform,
    openViewer,
    mountPersistentPlayer,
    destroyActivePlayer,
    onStatusChange,
  } = options;

  /**
   * Get the currently active post (hero post or fallback)
   */
  function getActivePost() {
    const heroPost = getHeroPost();
    if (heroPost) return heroPost;
    
    // Fallback to mini player post if exists
    const miniPlayer = elements?.miniPlayer?.firstElementChild?.closest('[data-hero-post-id]');
    if (miniPlayer && typeof miniPlayer.dataset.heroPostId === 'string') {
      return getPostById(miniPlayer.dataset.heroPostId);
    }
    
    return null;
  }

  /**
   * Get the active player source (youtube, spotify, or local)
   */
  function getActivePlayerSource() {
    const preferred = state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource;
    if (preferred === 'youtube') return 'youtube';
    if (preferred === 'spotify') return 'spotify';
    if (typeof resolveActivePlayerSource === 'function') {
      try {
        const src = resolveActivePlayerSource('', getActivePost());
        if (src && (src.includes('youtube') || src.includes('spotify'))) {
          return src.includes('youtube') ? 'youtube' : 'spotify';
        }
      } catch (e) {}
    }
    return 'local';
  }

  /**
   * Determine the preferred control source
   */
  function getPreferredHeroControlSource() {
    const val = toCleanString(state?.heroMediaSource || state?.heroControlSource || state?.systemMediaSource || '');
    if (val === 'youtube' || val === 'spotify') return val;
    return '';
  }

  /**
   * Get the desktop snapshot bridge status
   */
  function getDesktopBridgeStatus() {
    const isPC = !isNativeCapacitorApp();
    
    // Check for native snapshot bridge first
    if (window.NativeBridge && typeof window.NativeBridge.getNowPlayingSnapshot === 'function') {
      return { available: true, type: 'native', platform: getCapacitorPlatform() || 'unknown' };
    }
    
    // Check for desktop snapshot endpoint
    const endpoint = state?.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT || 
                     window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT;
    
    if (endpoint) {
      return { 
        available: true, 
        type: 'desktop', 
        endpoint,
        isPC: typeof window.location.protocol === 'http:' || typeof window.location.protocol === 'https:'
      };
    }
    
    return { available: false, type: 'none' };
  }

  /**
   * Get native snapshot from bridge if available
   */
  function getNativeSnapshot() {
    const bridge = window.NativeBridge;
    if (!bridge || !bridge.getNowPlayingSnapshot) return null;
    
    try {
      const source = getPreferredHeroControlSource();
      const payload = bridge.getNowPlayingSnapshot(source);
      if (typeof payload !== 'string' || !payload.trim()) return null;
      
      const parsed = JSON.parse(payload);
      return normalizeNativeSnapshot(parsed);
    } catch (e) {
      console.warn('[Hero Actions] Native snapshot parse error:', e);
      return null;
    }
  }

  /**
   * Normalize native snapshot from bridge response
   */
  function normalizeNativeSnapshot(raw = {}) {
    const playbackState = resolvePlaybackState(raw);
    
    return {
      title: toCleanString(raw.title),
      meta: sanitizeMeta(raw.meta, raw.appPackage),
      appPackage: toCleanString(raw.appPackage),
      openUri: toCleanString(raw.openUri),
      artworkUri: toCleanString(raw.artworkUri),
      active: Boolean(raw.active) || Boolean(toCleanString(raw.title)),
      permissionRequired: Boolean(raw.permissionRequired),
      playbackState,
    };
  }

  /**
   * Resolve playback state from various possible fields
   */
  function resolvePlaybackState(raw = {}) {
    const candidates = [
      raw?.playbackState,
      raw?.playback_state,
      raw?.playback?.state,
      raw?.playback?.status,
      raw?.state,
    ];

    for (const candidate of candidates) {
      const normalized = toCleanString(candidate);
      if (normalized === 'playing') return 'playing';
      if (normalized === 'paused') return 'paused';
    }
    
    // Fallback: active means something is being shown
    return Boolean(raw.active) ? 'playing' : 'none';
  }

  /**
   * Sanitize snapshot meta by removing app prefix
   */
  function sanitizeMeta(rawMeta = '', appPackage = '') {
    let meta = toCleanString(rawMeta).replace(/\s+/g, ' ').trim();
    if (!meta) return '';
    
    // Remove app package prefix
    const pkgVariants = getPackageVariants(appPackage);
    for (const variant of pkgVariants) {
      const escaped = variant.replace(/[.*+?^${}()|[\\]\\.]/g, '\\$&');
      const pattern = new RegExp(`^${escaped}\\s*(?:[-:|]\\s*)?`, 'i');
      const stripped = meta.replace(pattern, '').trim();
      if (stripped && stripped !== meta) {
        meta = stripped;
        break;
      }
    }
    
    // Remove generic prefixes
    const genericPattern = /^(?:spotify|youtube|operasoftware|chrome|edge|firefox|brave|vivaldi|arc|yandex|bluetooth|phone link)\s*(?:[-:|]\\s*)?/i;
    meta = toCleanString(meta.replace(genericPattern, '')).trim();
    
    return meta;
  }

  /**
   * Get all package variants for matching
   */
  function getPackageVariants(appPackage = '') {
    const value = toCleanString(appPackage);
    if (!value) return [];
    
    const variants = new Set();
    variants.add(value);
    variants.add(value.replace(/!.*$/, ''));
    variants.add(value.replace(/\.\d+$/, ''));
    variants.add(value.replace(/\.exe$/i, ''));
    variants.add(value.replace(/_[a-z0-9]+$/i, ''));
    
    return Array.from(variants)
      .map(e => e.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  /**
   * Get desktop snapshot via fetch if needed
   */
  async function getDesktopSnapshot() {
    const bridge = getDesktopBridgeStatus();
    if (!bridge.available || !bridge.type || bridge.type !== 'desktop') return null;
    
    try {
      const endpoint = bridge.endpoint || '/api/system-media/current';
      const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET') || 
                     localStorage.getItem('ss_bridge_secret');
      
      const headers = secret ? { 'X-Bridge-Secret': secret } : {};
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        cache: 'no-store',
        credentials: 'omit',
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return normalizeDesktopSnapshot(data);
    } catch (e) {
      console.warn('[Hero Actions] Desktop snapshot fetch error:', e);
      return null;
    }
  }

  /**
   * Normalize desktop snapshot from API response
   */
  function normalizeDesktopSnapshot(raw = {}) {
    const appPackage = toCleanString(raw.appPackage || raw.source || '');
    const playbackState = resolvePlaybackState(raw);
    
    return {
      source: toCleanString(raw.source || 'windows-smtc'),
      available: Boolean(raw.available),
      active: Boolean(raw.active) || Boolean(toCleanString(raw.title)),
      title: toCleanString(raw.title),
      meta: sanitizeMeta(raw.meta, appPackage),
      appPackage,
      openUri: toCleanString(raw.openUri),
      artworkUri: toCleanString(raw.artworkUri),
      playbackState,
      sourceProvider: toCleanString(raw.sourceProvider),
    };
  }

  /**
   * Check if snapshot represents preferred media source
   */
  function isPreferredSnapshot(snapshot = null) {
    const preferred = getPreferredHeroControlSource();
    
    if (!preferred) {
      // No preference - check for any valid snapshot
      return Boolean(snapshot?.active || snapshot?.title || snapshot?.meta);
    }
    
    if (snapshot?.sourceProvider === preferred) return true;
    
    const source = toCleanString(snapshot?.sourceProvider) || '';
    const app = toCleanString(snapshot?.appPackage) || '';
    const title = toCleanString(snapshot?.title) || '';
    const meta = toCleanString(snapshot?.meta) || '';
    const combined = `${app} ${title} ${meta}`;
    
    if (preferred === 'spotify') {
      return !combined.includes('youtube') && 
             (combined.includes('spotify') || source.includes('spotify') || app.includes('spotify'));
    }
    
    if (preferred === 'youtube') {
      return !combined.includes('spotify') && 
             (combined.includes('youtube') || combined.includes('ytmusic') || 
              source.includes('youtube') || app.includes('youtube'));
    }
    
    return false;
  }

  /**
   * Check if desktop bridge is available
   */
  function hasDesktopBridge() {
    const endpoint = state?.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT || 
                    window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT;
    
    if (endpoint) return true;
    
    const protocol = typeof window.location.protocol === 'string' ? window.location.protocol : '';
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    
    const host = toCleanString(window.location.hostname || '');
    const isLoopback = !host || host === 'localhost' || host.endsWith('.localhost') || 
                      host === '127.0.0.1' || host === '::1';
    
    if (isLoopback) return true;
    
    // Check for stored bridge secret
    const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET') ||
                   localStorage.getItem('ss_bridge_secret');
    if (secret) return true;
    
    return false;
  }

  /**
   * Refresh snapshot (native or desktop)
   */
  async function refreshSnapshot({ force = false, immediate = false } = {}) {
    const now = Date.now();
    
    // Respect volume cooldown and action lockout
    if (!immediate && now - lastVolumeChangedAt < VOLUME_CHANGE_COOLDOWN_MS) return null;
    if (state?._mediaActionLockoutUntil && now < state._mediaActionLockoutUntil) return getDesktopSnapshot();
    
    // Try native bridge first (for capacitor apps)
    const nativeSnapshot = getNativeSnapshot();
    if (nativeSnapshot && (force || !desktopPollTimerId)) {
      if (!nativeSnapshot.active && isThenable(nativeSnapshot.title)) {
        console.log('[Hero Actions] Native snapshot title is still loading...');
      } else {
        console.log('[Hero Actions] Native snapshot refreshed:', nativeSnapshot);
        return nativeSnapshot;
      }
    }
    
    // Try desktop bridge if needed
    const desktopSnapshot = await getDesktopSnapshot();
    if (desktopSnapshot && (force || !nativePollTimerId)) {
      console.log('[Hero Actions] Desktop snapshot refreshed:', desktopSnapshot);
      return desktopSnapshot;
    }
    
    return null;
  }

  /**
   * Start polling for snapshot updates
   */
  function startSnapshotPolling() {
    // Stop existing timers
    stopSnapshotPolling();
    
    const preferred = getPreferredHeroControlSource();
    if (!preferred) return;
    
    const refreshNow = async () => {
      const snapshot = await refreshSnapshot({ force: true });
      if (snapshot) renderAfterRefresh(snapshot);
    };
    
    // Initial refresh
    refreshNow();
    
    // Start native polling for capacitor apps
    if (isNativeCapacitorApp()) {
      nativePollTimerId = setInterval(() => {
        const snapshot = getNativeSnapshot();
        if (snapshot && isPreferredSnapshot(snapshot) && !nativePollTimerId % 10 === 0) { // Throttle renders
          renderAfterRefresh(snapshot);
        }
      }, NATIVE_POLL_INTERVAL_MS);
    }
    
    // Start desktop polling for web
    else if (!isNativeCapacitorApp()) {
      const refreshNow = async () => {
        const snapshot = await getDesktopSnapshot();
        if (snapshot && isPreferredSnapshot(snapshot)) {
          renderAfterRefresh(snapshot);
        }
      };
      
      refreshNow();
      
      desktopPollTimerId = setInterval(() => {
        // Throttle polling to avoid excessive renders
        if (!desktopPollTimerId % 5 === 0) return;
        
        const snapshot = getDesktopSnapshot();
        if (snapshot && isPreferredSnapshot(snapshot)) {
          renderAfterRefresh(snapshot);
        }
      }, DESKTOP_POLL_INTERVAL_MS);
    }
    
    console.log('[Hero Actions] Snapshot polling started');
  }

  /**
   * Stop polling for snapshot updates
   */
  function stopSnapshotPolling() {
    if (nativePollTimerId) {
      clearInterval(nativePollTimerId);
      nativePollTimerId = null;
    }
    
    if (desktopPollTimerId) {
      clearInterval(desktopPollTimerId);
      desktopPollTimerId = null;
    }
    
    console.log('[Hero Actions] Snapshot polling stopped');
  }

  /**
   * Render after snapshot refresh
   */
  function renderAfterRefresh(snapshot) {
    try {
      if (elements?.heroPlayerTitle && elements?.heroPlayerCaption) {
        let title = snapshot?.title || 'Now Playing';
        let caption = snapshot?.meta || getPreferredHeroControlSource() || '';
        
        if (!caption && elements?.heroPlayerStatus) {
          const status = normalizePlaybackState(snapshot?.playbackState);
          caption = status !== 'none' ? status : 'Ready';
        }
        
        if (elements?.heroPlayerTitle) elements.heroPlayerTitle.textContent = title;
        if (elements?.heroPlayerCaption) elements.heroPlayerCaption.textContent = caption;
      }
      
      // Trigger status change handler if exists
      if (typeof onStatusChange === 'function') {
        onStatusChange(snapshot);
      }
    } catch (e) {
      console.error('[Hero Actions] Render after refresh error:', e);
    }
  }

  /**
   * Normalize playback state for display
   */
  function normalizePlaybackState(value = '') {
    const normalized = toCleanString(value).trim().toLowerCase();
    if (normalized === 'playing') return 'playing';
    if (normalized === 'paused') return 'paused';
    if (normalized === 'none') return 'none';
    return Boolean(value) ? 'playing' : 'none';
  }

  /**
   * Handle play/pause action
   */
  async function handlePlayPauseAction(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Play/Pause action triggered');
    lastActionAt = Date.now();
    
    // Mark action complete to prevent lockout
    markMediaActionComplete();
    
    // Get current playback state
    const activePost = getActivePost();
    if (!activePost) {
      console.log('[Hero Actions] No active post found for play/pause');
      return;
    }
    
    const preferred = getPreferredHeroControlSource();
    let sourceUrl = '';
    
    // Determine action based on source
    if (preferred === 'spotify') {
      // Spotify: use embed URL from post or resolve from external ID
      if (activePost?.sourceKind === 'spotify') {
        try {
          const id = activePost.externalId || activePost.label;
          if (id) {
            sourceUrl = `https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0`;
          }
        } catch (e) {
          console.warn('[Hero Actions] Spotify play/pause error:', e);
        }
      }
    } 
    else if (preferred === 'youtube') {
      // YouTube: use embed URL with auto-detection
      const videoId = resolveYouTubePreviewId(activePost, parseYouTubeUrl);
      if (videoId) {
        sourceUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&playsinline=1`;
      }
    } 
    else {
      // Local: use resolved player source
      try {
        const src = resolveActivePlayerSource('', activePost);
        if (src) sourceUrl = src;
      } catch (e) {}
    }
    
    // If we have a source URL, mount or update the persistent player
    if (sourceUrl) {
      try {
        await playHeroMedia({ post: activePost, autoplay: !force, skipRender });
        
        // Check playback state after mounting
        const snapshot = await getNativeSnapshot() || await getDesktopSnapshot();
        if (snapshot && elements?.heroPlayerStatus) {
          elements.heroPlayerStatus.textContent = normalizePlaybackState(snapshot.playbackState);
        }
      } catch (e) {
        console.error('[Hero Actions] Play action error:', e);
      }
      
      return;
    }
    
    // Fallback: try desktop bridge actions if available
    const bridge = getDesktopBridgeStatus();
    if (bridge.available && bridge.endpoint) {
      try {
        const endpoint = bridge.endpoint + '/api/system-media/action?command=play_pause';
        const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET');
        
        await fetch(endpoint, {
          method: 'POST',
          headers: secret ? { 'X-Bridge-Secret': secret } : {},
        });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Desktop bridge play/pause error:', e);
      }
    }
    
    // Fallback: try YouTube IFrame API if available
    else if (window.YT && window.YT.Player) {
      try {
        const player = window.YT.Player;
        await new Promise(r => setTimeout(r, 200));
        
        if (player?.playVideo) {
          await player.playVideo();
        } else if (player?.pauseVideo) {
          await player.pauseVideo();
        }
      } catch (e) {}
    }
    
    console.log('[Hero Actions] Play/pause fallback applied');
  }

  /**
   * Handle previous track action
   */
  async function handlePreviousAction(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Previous track action triggered');
    lastActionAt = Date.now();
    
    // Mark action complete
    markMediaActionComplete();
    
    // Get active post to determine source
    const activePost = getActivePost();
    if (!activePost) {
      console.log('[Hero Actions] No active post for previous');
      return;
    }
    
    const preferred = getPreferredHeroControlSource();
    let actionEndpoint = '';
    
    // Build action endpoint based on source
    if (preferred === 'spotify') {
      actionEndpoint = `https://open.spotify.com/embed/track/${activePost.externalId}?action=previous`;
    } 
    else if (preferred === 'youtube') {
      const videoId = resolveYouTubePreviewId(activePost, parseYouTubeUrl);
      if (videoId) {
        actionEndpoint = `https://www.youtube.com/embed/${videoId}?action=prev&loop=false`;
      }
    } 
    else {
      // Desktop bridge action
      const bridge = getDesktopBridgeStatus();
      if (bridge.available && bridge.endpoint) {
        actionEndpoint = bridge.endpoint + '/api/system-media/action?command=previous';
      }
    }
    
    // Execute action based on source
    if (actionEndpoint.includes('spotify')) {
      // Spotify: previous track via fetch (Spotify embed doesn't support this directly)
      try {
        await fetch(actionEndpoint + '&autoplay=0', { method: 'GET' });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Spotify previous error:', e);
      }
    } 
    else if (actionEndpoint.includes('youtube')) {
      // YouTube: seek to previous video via API endpoint
      try {
        await fetch(actionEndpoint, { method: 'GET' });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] YouTube previous error:', e);
      }
    } 
    else if (actionEndpoint && actionEndpoint.includes('/api/system-media/action')) {
      // Desktop bridge: send previous command
      try {
        const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET');
        
        await fetch(actionEndpoint, {
          method: 'GET',
          headers: secret ? { 'X-Bridge-Secret': secret } : {},
        });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Desktop bridge previous error:', e);
      }
    }
    
    // Fallback: YouTube IFrame API
    else if (window.YT && window.YT.Player) {
      try {
        await new Promise(r => setTimeout(r, 200));
        const player = window.YT.Player;
        // Previous is tricky with IFrame API - need to seek backwards
        const currentTime = player.getPlayerState()?.data?.current_time || 0;
        if (player.seekTo) {
          await player.seekTo(currentTime - 10, true); // Seek back 10 seconds
        }
      } catch (e) {}
    }
    
    console.log('[Hero Actions] Previous track action complete');
  }

  /**
   * Handle next track action
   */
  async function handleNextAction(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Next track action triggered');
    lastActionAt = Date.now();
    
    // Mark action complete
    markMediaActionComplete();
    
    // Get active post to determine source
    const activePost = getActivePost();
    if (!activePost) {
      console.log('[Hero Actions] No active post for next');
      return;
    }
    
    const preferred = getPreferredHeroControlSource();
    let actionEndpoint = '';
    
    // Build action endpoint based on source
    if (preferred === 'spotify') {
      actionEndpoint = `https://open.spotify.com/embed/track/${activePost.externalId}?action=next`;
    } 
    else if (preferred === 'youtube') {
      const videoId = resolveYouTubePreviewId(activePost, parseYouTubeUrl);
      if (videoId) {
        actionEndpoint = `https://www.youtube.com/embed/${videoId}?action=next&loop=false`;
      }
    } 
    else {
      // Desktop bridge action
      const bridge = getDesktopBridgeStatus();
      if (bridge.available && bridge.endpoint) {
        actionEndpoint = bridge.endpoint + '/api/system-media/action?command=next';
      }
    }
    
    // Execute action based on source
    if (actionEndpoint.includes('spotify')) {
      try {
        await fetch(actionEndpoint + '&autoplay=1', { method: 'GET' });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Spotify next error:', e);
      }
    } 
    else if (actionEndpoint.includes('youtube')) {
      try {
        // YouTube: load next video via API endpoint
        await fetch(actionEndpoint, { method: 'GET' });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] YouTube next error:', e);
      }
    } 
    else if (actionEndpoint && actionEndpoint.includes('/api/system-media/action')) {
      // Desktop bridge: send next command
      try {
        const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET');
        
        await fetch(actionEndpoint, {
          method: 'GET',
          headers: secret ? { 'X-Bridge-Secret': secret } : {},
        });
        
        // Poll for state change
        if (!skipRender) await new Promise(r => setTimeout(r, 500));
        const snapshot = await refreshSnapshot();
        renderAfterRefresh(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Desktop bridge next error:', e);
      }
    }
    
    // Fallback: YouTube IFrame API
    else if (window.YT && window.YT.Player) {
      try {
        await new Promise(r => setTimeout(r, 200));
        const player = window.YT.Player;
        
        // Get current video data and seek forward
        const currentTime = player.getPlayerState()?.data?.current_time || 0;
        const duration = player.getPlayerState()?.data?.duration || 10;
        
        if (player.seekTo) {
          await player.seekTo(currentTime + duration * 0.8, true); // Seek forward 80% of duration
        }
      } catch (e) {}
    }
    
    console.log('[Hero Actions] Next track action complete');
  }

  /**
   * Handle volume adjustment
   */
  async function handleVolumeAction(options = {}) {
    const { value, force = false, skipRender = false } = options;
    
    if (!value && typeof value !== 'number') {
      console.warn('[Hero Actions] Volume action requires a value parameter');
      return;
    }
    
    console.log(`[Hero Actions] Volume action triggered: ${value}`);
    lastActionAt = Date.now();
    
    // Respect cooldown to prevent rapid volume changes
    const now = Date.now();
    if (now - lastVolumeChangedAt < VOLUME_CHANGE_COOLDOWN_MS) {
      console.log('[Hero Actions] Volume change on cooldown, skipping');
      return;
    }
    
    // Update state
    if (typeof normalizePlayerVolume === 'function') {
      const normalized = normalizePlayerVolume(value);
      state.volume = normalized;
    }
    
    // Save volume to persistent storage
    if (typeof savePlayerVolume === 'function') {
      try {
        await savePlayerVolume(normalized || value);
      } catch (e) {
        console.warn('[Hero Actions] Volume save error:', e);
      }
    }
    
    // Apply volume to active element
    if (typeof applyPlayerVolumeToActiveElement === 'function') {
      try {
        await applyPlayerVolumeToActiveElement();
      } catch (e) {
        console.warn('[Hero Actions] Volume apply error:', e);
      }
    }
    
    // Update UI display
    if (elements?.heroPlayerVolumeValue && !skipRender) {
      elements.heroPlayerVolumeValue.textContent = Math.round(value || 0);
    }
    
    lastVolumeChangedAt = now;
    
    console.log(`[Hero Actions] Volume updated to ${value}`);
  }

  /**
   * Mark media action complete (prevents lockout)
   */
  function markMediaActionComplete() {
    const now = Date.now();
    state._mediaActionLockoutUntil = Math.min(now + 100, now + 500); // Short lockout for debouncing
    desktopPollTimerId = null; // Stop pending desktop fetch
    localNetworkPromptInFlight = false;
    
    console.log('[Hero Actions] Media action marked complete');
  }

  /**
   * Handle open phone action (Phone Link integration)
   */
  async function handleOpenPhoneAction(options = {}) {
    const { force = false } = options;
    
    console.log('[Hero Actions] Open Phone action triggered');
    lastActionAt = Date.now();
    markMediaActionComplete();
    
    // Check for native phone link bridge first
    const bridge = window.NativeBridge;
    if (bridge && typeof bridge.openNowPlayingMediaApp === 'function') {
      try {
        await bridge.openNowPlayingMediaApp('phone-link');
        console.log('[Hero Actions] Phone Link opened via Native Bridge');
        return;
      } catch (e) {
        console.error('[Hero Actions] Phone link native bridge error:', e);
      }
    }
    
    // Fallback: Try desktop bridge endpoint
    const desktopSnapshotEndpoint = state?.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT || 
                                    window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT;
    
    if (desktopSnapshotEndpoint) {
      try {
        const actionEndpoint = desktopSnapshotEndpoint + '/api/system-media/action?command=open_phone';
        const secret = localStorage.getItem('SIGNAL_SHARE_BRIDGE_SECRET');
        
        await fetch(actionEndpoint, {
          method: 'POST',
          headers: secret ? { 'X-Bridge-Secret': secret } : {},
        });
        
        console.log('[Hero Actions] Phone link opened via Desktop Bridge');
        return;
      } catch (e) {
        console.error('[Hero Actions] Desktop bridge phone link error:', e);
      }
    }
    
    // Fallback: Try Capacitor custom URL scheme
    if (isNativeCapacitorApp()) {
      try {
        const platforms = {
          android: 'com.android.phone',
          ios: 'tel://',
        };
        
        const platform = getCapacitorPlatform();
        if (platform && platforms[platform]) {
          window.location.href = `open-app://${platforms[platform]}?launch=phone-link`;
        }
      } catch (e) {}
    }
    
    console.log('[Hero Actions] Phone link action complete');
  }

  /**
   * Handle refresh action (force refresh playback state)
   */
  async function handleRefreshAction(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Refresh action triggered');
    lastActionAt = Date.now();
    
    // Mark action complete
    markMediaActionComplete();
    
    // Force refresh snapshot
    const snapshot = await refreshSnapshot({ force: true });
    
    // Render with new snapshot
    if (snapshot && !skipRender) {
      renderAfterRefresh(snapshot);
    }
    
    console.log('[Hero Actions] Refresh action complete');
  }

  /**
   * Handle open media action (open current post in full viewer)
   */
  async function handleOpenMediaAction(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Open Media action triggered');
    lastActionAt = Date.now();
    markMediaActionComplete();
    
    // Get active post
    const activePost = getActivePost();
    if (!activePost) {
      console.log('[Hero Actions] No active post to open in media viewer');
      return;
    }
    
    // Open in full screen viewer
    if (typeof openViewer === 'function') {
      try {
        await openViewer(activePost, force);
        console.log('[Hero Actions] Media opened in viewer');
        return;
      } catch (e) {
        console.error('[Hero Actions] Open media error:', e);
      }
    }
    
    // Fallback: Mount persistent player for current post
    if (typeof mountPersistentPlayer === 'function') {
      try {
        await mountPersistentPlayer(activePost, force);
        console.log('[Hero Actions] Media mounted as persistent player');
        return;
      } catch (e) {
        console.error('[Hero Actions] Mount persistent player error:', e);
      }
    }
    
    // Fallback: Try to play hero media directly
    if (typeof playHeroMedia === 'function') {
      try {
        await playHeroMedia({ post: activePost, force });
        console.log('[Hero Actions] Media played via hero player');
        return;
      } catch (e) {
        console.error('[Hero Actions] Play hero media error:', e);
      }
    }
    
    console.log('[Hero Actions] Open media action complete');
  }

  /**
   * Handle destroy active player (cleanup when switching sources)
   */
  async function handleDestroyActivePlayer(options = {}) {
    const { force = false, skipRender = false } = options;
    
    console.log('[Hero Actions] Destroy active player action triggered');
    lastActionAt = Date.now();
    
    // Mark action complete
    markMediaActionComplete();
    
    // Destroy active player
    if (typeof destroyActivePlayer === 'function') {
      try {
        await destroyActivePlayer(force);
        console.log('[Hero Actions] Active player destroyed');
        return;
      } catch (e) {
        console.error('[Hero Actions] Destroy active player error:', e);
      }
    }
    
    // Clean up any YouTube IFrame API instance
    if (window.YT && window.YT.Player) {
      try {
        const player = window.YT.Player;
        if (player && typeof player.destroy === 'function') {
          await player.destroy();
          console.log('[Hero Actions] YouTube player destroyed');
        }
      } catch (e) {}
    }
    
    console.log('[Hero Actions] Destroy active player complete');
  }

  /**
   * Handle post message to YouTube player
   */
  function handleMessageToYouTubePlayer(options = {}) {
    const { type, data } = options;
    
    console.log(`[Hero Actions] YouTube player message: ${type}`, data);
    
    if (typeof postMessageToYouTubePlayer === 'function') {
      try {
        postMessageToYouTubePlayer(type, data);
        return true;
      } catch (e) {
        console.error('[Hero Actions] YouTube player message error:', e);
        return false;
      }
    }
    
    return false;
  }

  /**
   * Handle status change notification
   */
  function handleStatusChange(options = {}) {
    const { snapshot, post, source } = options;
    
    console.log('[Hero Actions] Status change:', snapshot?.title, source || 'unknown');
    
    // Call the main controller's onStatusChange if exists
    if (typeof onStatusChange === 'function') {
      try {
        onStatusChange(snapshot);
      } catch (e) {
        console.error('[Hero Actions] Status change handler error:', e);
      }
    }
    
    // Update UI elements with new state
    if (elements?.heroPlayerTitle && snapshot?.title) {
      elements.heroPlayerTitle.textContent = snapshot.title;
    }
    
    if (elements?.heroPlayerCaption && snapshot?.meta) {
      elements.heroPlayerCaption.textContent = snapshot.meta || getPreferredHeroControlSource();
    }
    
    if (elements?.heroPlayerStatus) {
      const state = normalizePlaybackState(snapshot?.playbackState);
      elements.heroPlayerStatus.textContent = 
        state === 'playing' ? 'Playing' : 
        state === 'paused' ? 'Paused' : 'Ready';
    }
    
    // Trigger stepHeroPlayer if it exists (for progress bar updates)
    if (typeof stepHeroPlayer === 'function') {
      try {
        stepHeroPlayer(snapshot || post);
      } catch (e) {}
    }
  }

  /**
   * Handle mini player step/update
   */
  function handleMiniPlayerStep(options = {}) {
    const { index, post } = options;
    
    console.log('[Hero Actions] Mini player step:', index, post?.title);
    
    if (typeof stepMiniPlayer === 'function') {
      try {
        stepMiniPlayer(index, post);
      } catch (e) {}
    }
  }

  /**
   * Handle mini player render/update
   */
  function handleMiniPlayerRender(options = {}) {
    const { index, post, stage } = options;
    
    console.log('[Hero Actions] Mini player render:', index, post?.title);
    
    if (typeof renderMiniPlayer === 'function') {
      try {
        renderMiniPlayer(index, post, stage);
      } catch (e) {}
    }
  }

  /**
   * Step hero player to next position
   */
  async function stepHeroPlayer(options = {}) {
    const { type = 'next', index = null, skipRender = false } = options;
    
    console.log('[Hero Actions] Step hero player:', type, index);
    
    // Mark action complete
    markMediaActionComplete();
    
    // Get playable posts
    if (typeof getHeroPlayablePosts === 'function') {
      try {
        const posts = await getHeroPlayablePosts();
        
        if (!Array.isArray(posts) || !posts.length) return;
        
        const currentPostIndex = posts.findIndex(p => p.id === state?.heroPostId);
        let newIndex;
        
        if (type === 'next') {
          newIndex = (currentPostIndex + 1) % posts.length;
        } else if (type === 'prev') {
          newIndex = (currentPostIndex - 1 + posts.length) % posts.length;
        } else if (typeof index === 'number') {
          newIndex = index;
        }
        
        const nextPost = posts[newIndex];
        
        // Update state
        state.heroPostId = nextPost.id;
        state._mediaActionLockoutUntil = Date.now() + 200;
        
        console.log('[Hero Actions] Stepped to post:', nextPost.title);
        
        if (!skipRender && typeof stepHeroPlayer === 'function') {
          await stepHeroPlayer(nextPost, force);
        }
      } catch (e) {
        console.error('[Hero Actions] Step hero player error:', e);
      }
    }
  }

  /**
   * Return all action handlers
   */
  return {
    handlePlayPauseAction,
    handleNextAction,
    handlePreviousAction,
    handleVolumeAction,
    handleRefreshAction,
    handleOpenMediaAction,
    handleDestroyActivePlayer,
    handleOpenPhoneAction,
    handleMessageToYouTubePlayer,
    handleStatusChange,
    handleMiniPlayerStep,
    handleMiniPlayerRender,
    stepHeroPlayer,
    
    // Helper functions
    getActivePost,
    getActivePlayerSource,
    getPreferredHeroControlSource,
    getDesktopBridgeStatus,
    getNativeSnapshot,
    normalizePlaybackState,
    hasDesktopBridge,
  };
}

/**
 * Default export for easier importing
 */
export default getHeroMediaActions;
