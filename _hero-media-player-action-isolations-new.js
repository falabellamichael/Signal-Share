/**
 * CRITICAL FIX - New Toggle Action Isolation for Spotify App AND Browser Tabs
 * 
 * This module provides proper source filtering to ensure actions only affect:
 * 1. Spotify App (desktop/mobile)
 * 2. YouTube/Spotify in browser tabs
 */

import { hasActiveMediaInSource } from './_hero-media-player-toggle-state-validation.js';

/**
 * Gets all active media including native app AND browser tabs
 */
export function getAllActiveSources(options = {}) {
  const {
    state,
    post,
    nativeSnapshot,
    desktopSnapshot
  } = options;

  const sources = [];

  // Check post source (hosted iframe)
  if (post?.sourceKind && !post.sourceKind.includes('hosted')) {
    sources.push({
      type: 'post',
      kind: post.sourceKind,
      externalId: post.externalId,
      title: post.title
    });
  }

  // Check native snapshot (Spotify app on mobile)
  if (nativeSnapshot && nativeSnapshot.active) {
    const pkg = (nativeSnapshot.appPackage || '').toLowerCase();
    const prov = (nativeSnapshot.sourceProvider || '').toLowerCase();
    const title = (nativeSnapshot.title || '').toLowerCase();

    if (pkg.includes('spotify') || prov.includes('spotify') || title.includes('spotify')) {
      sources.push({ type: 'native-app', kind: 'spotify' });
    } else if (pkg.includes('ytmusic') || pkg.match(/^[A-Za-z0-9_-]{11}$/) || prov.includes('youtube')) {
      sources.push({ type: 'native-app', kind: 'youtube' });
    }
  }

  // Check desktop snapshot (Spotify app on Windows/macOS)
  if (desktopSnapshot && desktopSnapshot.active) {
    const pkg = (desktopSnapshot.appPackage || '').toLowerCase();
    const prov = (desktopSnapshot.sourceProvider || '').toLowerCase();
    const title = (desktopSnapshot.title || '').toLowerCase();

    if (pkg.includes('spotify') || prov.includes('spotify') || title.includes('spotify')) {
      sources.push({ type: 'desktop-app', kind: 'spotify' });
    } else if (pkg.includes('ytmusic') || prov.match(/^[A-Za-z0-9_-]{11}$/) || prov.includes('youtube')) {
      sources.push({ type: 'desktop-app', kind: 'youtube' });
    }
  }

  return sources;
}

/**
 * Plays/pauses only the active source from toggle
 */
export function handlePlayPauseWithIsolation(context, forcePlay) {
  const {
    state, elements, getControllablePlayerPost, render, nativeSnapshot, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp, companionPromptDismissed,
    toggleLocalPlayback, playHeroMedia, getActivePlayerMediaElement, refreshDesktopSnapshot, refreshNativeSnapshot,
    target
  } = context;

  // Get active source from toggle state
  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || "").toLowerCase();
  const prefersYouTube = preferredSource === 'youtube';
  const prefersSpotify = preferredSource === 'spotify';

  console.log(`[Hero] handlePlayPause. Toggle source: ${heroControlSource}, Prefers: ${prefersSpotify ? 'Spotify' : prefersYouTube ? 'YouTube' : 'Any'}`);

  // ==================== TOGGLE ISOLATION FOR APP & BROWSER TABS ====================
  
  // Get all active sources (both native app and browser tab)
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });

  console.log(`[Hero] Active sources detected: ${activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None'}`);

  // If in toggle mode with specific source preference
  if (prefersSpotify || prefersYouTube) {
    const targetKind = prefersSpotify ? 'spotify' : 'youtube';
    
    // Check if any active source matches the preferred kind
    const hasMatchingSource = activeSources.some(s => s.kind === targetKind);

    console.log(`[Hero] Toggle isolation: Targeting ${targetKind}, Has matching source: ${hasMatchingSource}`);

    // If NO matching source exists, return filtered idle state (zero bleed-through)
    if (!hasMatchingSource) {
      console.log(`[Hero] Play/Pause filtered - No ${targetKind} source active`);
      
      const parseYouTubeUrl = context.parseYouTubeUrl || (() => {});
      if (typeof render === 'function' && typeof elements.heroPlayerStage !== 'undefined') {
        render();
        elements.heroPlayerStage.dataset.safeHeroLocked = "true";
        context.renderHeroPlayerStage({ post: null, parseYouTubeUrl });
      }
      
      return; // Early return with filtered idle state
    }
  }

  // =========================== END TOGGLE ISOLATION =========================

  // Continue with normal play/pause logic...
  const isMediaMode = state.heroControlMode === "media";
  const mode = (state?.heroMode || "app");
  
  if (mode === "device" && !isNativeCapacitorApp) {
    if (!companionPromptDismissed && prefersSpotify) {
      // Show companion prompt for Spotify app access
      if (typeof context.showCompanionPrompt === 'function') {
        context.showCompanionPrompt();
      }
    } else if (desktopSnapshot?.active) {
      performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
    }
  }

  // Standard local play/pause logic...
  const shouldPlay = !state.heroPlayerPlaybackState || state.heroPlayerPlaybackState === "paused";
  
  if (target === "mini") state.miniPlayerPlaybackState = shouldPlay ? "playing" : "paused";
  else state.heroPlayerPlaybackState = shouldPlay ? "playing" : "paused";

  render();

  // Perform actual play/pause based on mode...
  const snapshot = desktopSnapshot || nativeSnapshot;
  
  if (snapshot?.active && prefersSpotify) {
    performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
  }

  refreshDesktopSnapshot({ force: true, renderAfter: true });
  refreshNativeSnapshot({ renderAfter: true });

  // Defensive check
  if (elements.heroPlayerStage) {
    elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  }
}

/**
 * Previous action with toggle isolation for Spotify app AND browser tabs
 */
export function handlePreviousWithIsolation(context) {
  const {
    state, elements, render, nativeSnapshot, desktopSnapshot, getControllablePlayerPost, heroMode, parseYouTubeUrl,
    stepHeroPlayer, stepMiniPlayer, mountPersistentPlayer, ensureControllablePost, refreshDesktopSnapshot, refreshNativeSnapshot,
    target
  } = context;

  const heroControlSource = state.heroControlSource;
  const prefersSpotify = heroControlSource?.toLowerCase() === 'spotify';
  const prefersYouTube = heroControlSource?.toLowerCase() === 'youtube';

  console.log(`[Hero] handlePrevious. Toggle source: ${heroControlSource}, Prefers: ${prefersSpotify ? 'Spotify' : prefersYouTube ? 'YouTube' : 'None'}`);

  // ==================== TOGGLE ISOLATION FOR APP & BROWSER TABS ====================
  
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  const targetKind = prefersSpotify ? 'spotify' : (prefersYouTube ? 'youtube' : null);

  console.log(`[Hero] Active sources: ${activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None'}`);

  if (targetKind && !activeSources.some(s => s.kind === targetKind)) {
    // No matching source - return filtered idle state
    console.log(`[Hero] Previous/Next filtered - No ${targetKind} source active`);
    
    const parseYouTubeUrl = context.parseYouTubeUrl || (() => {});
    if (elements.heroPlayerStage) {
      elements.heroPlayerStage.dataset.safeHeroLocked = "true";
      context.renderHeroPlayerStage({ post: null, parseYouTubeUrl });
    }
    return;
  }

  // Continue with normal previous logic...
  const wasPlaying = state.heroPlayerPlaybackState === "playing";
  
  if (target === "mini") stepMiniPlayer(-1);
  else stepHeroPlayer(-1);

  if (wasPlaying) {
    const post = getControllablePlayerPost();
    if (post && elements.miniPlayerStage?.appendChild) {
      mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: true });
    }
  }

  refreshDesktopSnapshot({ force: true, renderAfter: true });
  refreshNativeSnapshot({ renderAfter: true });

  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";

  // =========================== END TOGGLE ISOLATION =========================
}

/**
 * Next action with toggle isolation for Spotify app AND browser tabs
 */
export function handleNextWithIsolation(context) {
  const {
    state, elements, render, nativeSnapshot, desktopSnapshot, getControllablePlayerPost, heroMode, parseYouTubeUrl,
    stepHeroPlayer, stepMiniPlayer, mountPersistentPlayer, ensureControllablePost, refreshDesktopSnapshot, refreshNativeSnapshot,
    target
  } = context;

  const heroControlSource = state.heroControlSource;
  const prefersSpotify = heroControlSource?.toLowerCase() === 'spotify';
  const prefersYouTube = heroControlSource?.toLowerCase() === 'youtube';

  console.log(`[Hero] handleNext. Toggle source: ${heroControlSource}, Prefers: ${prefersSpotify ? 'Spotify' : prefersYouTube ? 'YouTube' : 'None'}`);

  // ==================== TOGGLE ISOLATION FOR APP & BROWSER TABS ====================
  
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  const targetKind = prefersSpotify ? 'spotify' : (prefersYouTube ? 'youtube' : null);

  console.log(`[Hero] Active sources: ${activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None'}`);

  if (targetKind && !activeSources.some(s => s.kind === targetKind)) {
    // No matching source - return filtered idle state
    console.log(`[Hero] Previous/Next filtered - No ${targetKind} source active`);
    
    const parseYouTubeUrl = context.parseYouTubeUrl || (() => {});
    if (elements.heroPlayerStage) {
      elements.heroPlayerStage.dataset.safeHeroLocked = "true";
      context.renderHeroPlayerStage({ post: null, parseYouTubeUrl });
    }
    return;
  }

  // Continue with normal next logic...
  const wasPlaying = state.heroPlayerPlaybackState === "playing";
  
  if (target === "mini") stepMiniPlayer(1);
  else stepHeroPlayer(1);

  if (wasPlaying) {
    const post = getControllablePlayerPost();
    if (post && elements.miniPlayerStage?.appendChild) {
      mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: true });
    }
  }

  refreshDesktopSnapshot({ force: true, renderAfter: true });
  refreshNativeSnapshot({ renderAfter: true });

  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";

  // =========================== END TOGGLE ISOLATION =========================
}

/**
 * Handles volume with toggle isolation for both Spotify app and browser tabs
 */
export function handleVolumeWithIsolation(context, event) {
  const { state, getControllablePlayerPost, applyPlayerVolumeToActiveElement, render, elements, getNativeBridge, isNativeCapacitorApp } = context;

  const heroControlSource = state.heroControlSource;
  const prefersSpotify = heroControlSource?.toLowerCase() === 'spotify';
  const prefersYouTube = heroControlSource?.toLowerCase() === 'youtube';

  // Get active sources for volume control
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot: context.nativeSnapshot, desktopSnapshot: context.desktopSnapshot });

  console.log(`[Hero] handleVolume. Toggle source: ${heroControlSource}, Active sources: ${activeSources.map(s => s.kind).join(', ') || 'None'}`);

  // Apply volume to active matching source
  if (prefersSpotify && activeSources.some(s => s.kind === 'spotify')) {
    if (isNativeCapacitorApp) {
      const bridge = getNativeBridge();
      if (bridge?.setNowPlayingVolume) {
        bridge.setNowPlayingVolume(state.playerVolume);
      }
    } else if (applyPlayerVolumeToActiveElement) {
      applyPlayerVolumeToActiveElement();
    }
  }

  // Apply to HTML5 elements for hosted videos/iframe tabs
  const activeMedia = state.heroPlayerElement || state.activePlayerElement;
  if (activeMedia?.volume !== undefined) {
    try {
      activeMedia.volume = state.playerVolume;
    } catch (e) {
      console.warn("Failed to set volume on media element");
    }
  }

  // Refresh UI
  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  
  if (typeof render === 'function') render();

  // =========================== END TOGGLE ISOLATION =========================
}
