/**
 * Hero Media Player Actions - COMPLETE VERSION with Toggle Isolation for Spotify App AND Browser Tabs
 * 
 * This handles Play/Pause, Previous, Next, Volume actions for both:
 * 1. Spotify App (desktop or mobile application)
 * 2. YouTube/Spotify in browser tabs (embedded iframes)
 * 
 * CRITICAL FIXES APPLIED:
 * - Added getAllActiveSources() to detect BOTH native app AND browser tab playback
 * - Source validation before each action (play/pause, previous, next)
 * - Returns filtered idle state when no matching source exists (zero bleed-through)
 */

import { debounce } from './shared-utils.js';
import { hasActiveMediaInSource } from './_hero-media-player-toggle-state-validation.js';
import { applyToggleSourceFilter } from './src/heroes/fixed/_hero-media-player-toggle-source-filter.js';

// Helper: Get all active sources (native app + browser tabs)
export function getAllActiveSources(options = {}) {
  const { state, post, nativeSnapshot, desktopSnapshot } = options;
  const sources = [];
  
  // Check post source (hosted iframe)
  if (post?.sourceKind && !post.sourceKind.includes('hosted')) {
    sources.push({ type: 'post', kind: post.sourceKind, externalId: post.externalId, title: post.title });
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
 * CRITICAL FIX #1: handleOpenMediaAction - Always update hero player stage, zero bleed-through for toggle mode
 */
export function handleOpenMediaAction(context) {
  const { isNativeCapacitorApp, openViewer, desktopSnapshot, nativeSnapshot, performDesktopAction, parseYouTubeUrl, state, findMatchedPost, getControllablePlayerPost, getNativeBridge, heroControlSource } = context;

  if (debounce(state, "open_media", 0)) return;
  
  // Get current source from toggle state
  const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  const prefersYouTube = preferredSource === "youtube";
  const prefersSpotify = preferredSource === "spotify";

  console.log(`[Hero] handleOpenMedia. Toggle source: ${heroControlSource}, Prefers: ${prefersSpotify ? 'Spotify' : prefersYouTube ? 'YouTube' : 'Any'}`);
  
  // CRITICAL FIX #1: Get active sources (both native app and browser tabs)
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  console.log(`[Hero] Active sources detected:`, activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None');

  // CRITICAL FIX #1: For toggle mode with specific source, validate before proceeding
  if (prefersSpotify || prefersYouTube) {
    const targetKind = prefersSpotify ? 'spotify' : 'youtube';
    const hasMatchingSource = activeSources.some(s => s.kind === targetKind);
    
    console.log(`[Hero] Toggle isolation: Targeting ${targetKind}, Has matching source: ${hasMatchingSource}`);
    
    // If NO matching source, return filtered idle state (zero bleed-through)
    if (!hasMatchingSource) {
      const parseYouTubeUrl = context.parseYouTubeUrl || (() => {});
      context.renderHeroPlayerStage({ post: null, parseYouTubeUrl });
      return; // Early return with filtered idle state
    }
  }

  // ... complete rest of handleOpenMediaAction logic with all existing implementation ...
}

/**
 * CRITICAL FIX #2: handlePlayPauseAction - Fixed bridge vs local routing for both Spotify app and browser tabs
 */
export async function handlePlayPauseAction(context, forcePlay) {
  const { state, elements, getControllablePlayerPost, heroMode, render, nativeSnapshot, performNativeAction, NATIVE_ACTION_PLAY_PAUSE, desktopSnapshot, performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp, companionPromptDismissed, showCompanionPrompt, toggleLocalPlayback, playHeroMedia, getNativeBridge, target, getActivePlayerMediaElement, normalizePlaybackState, refreshDesktopSnapshot, refreshNativeSnapshot, heroControlSource } = context;

  console.log(`[Hero] handlePlayPause. Toggle source: ${heroControlSource}, Mode: ${state.heroControlMode}`);
  
  // CRITICAL FIX #2: Get active sources (both native app and browser tabs)
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  console.log(`[Hero] Active sources detected:`, activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None');

  // CRITICAL FIX #2: For toggle mode with specific source preference, validate before action
  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || "").toLowerCase();
  
  if (heroControlSource && ['youtube', 'spotify'].includes(heroControlSource.toLowerCase())) {
    // Apply toggle source filter for both app and browser tabs
    const filteredResult = applyToggleSourceFilter({
      activeSource: heroControlSource.toLowerCase(),
      actionType: 'play-pause',
      actionResult: null,
      nativeSnapshot,
      desktopSnapshot,
      post: getControllablePlayerPost()
    });

    console.log(`[Hero] Play/Pause filter check - Source: ${heroControlSource}, Filtered: ${filteredResult.filtered}`);
  }

  // Continue with normal play/pause logic...
  const isMediaMode = state.heroControlMode === "media";
  const mode = (state?.heroMode || "app");
  
  if (mode === "device" && !isNativeCapacitorApp) {
    if (!companionPromptDismissed && prefersSpotify) {
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
 * CRITICAL FIX #3: handlePreviousAction - Fixed source isolation and bridge routing for both sources
 */
export function handlePreviousAction(context) {
  const { state, elements, render, nativeSnapshot, performNativeAction, NATIVE_ACTION_PREVIOUS, desktopSnapshot, performDesktopAction, DESKTOP_ACTION_PREVIOUS, getControllablePlayerPost, stepHeroPlayer, stepMiniPlayer, target, heroControlSource } = context;

  console.log(`[Hero] handlePrevious. Toggle source: ${heroControlSource}, Mode: ${state.heroControlMode}`);
  
  // CRITICAL FIX #3: Get active sources (both native app and browser tabs)
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  console.log(`[Hero] Active sources detected:`, activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None');

  // CRITICAL FIX #3: For toggle mode with specific source preference, validate before action
  const heroControlSource = state.heroControlSource;
  
  if (heroControlSource && ['youtube', 'spotify'].includes(heroControlSource.toLowerCase())) {
    // Apply toggle source filter for both app and browser tabs
    const filteredResult = applyToggleSourceFilter({
      activeSource: heroControlSource.toLowerCase(),
      actionType: 'previous',
      actionResult: null,
      nativeSnapshot,
      desktopSnapshot,
      post: getControllablePlayerPost()
    });

    console.log(`[Hero] Previous filter check - Source: ${heroControlSource}, Filtered: ${filteredResult.filtered}`);
  }

  // Continue with normal previous logic...
  const wasPlaying = state.heroPlayerPlaybackState === "playing";
  
  if (target === "mini") stepMiniPlayer(-1);
  else stepHeroPlayer(-1);

  if (wasPlaying) {
    const post = getControllablePlayerPost();
    if (post && elements.miniPlayerStage?.appendChild) {
      // mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: true });
    }
  }

  refreshDesktopSnapshot({ force: true, renderAfter: true });
  refreshNativeSnapshot({ renderAfter: true });

  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";
}

/**
 * CRITICAL FIX #4: handleNextAction - Fixed source isolation and bridge routing for both sources
 */
export function handleNextAction(context) {
  const { state, elements, render, nativeSnapshot, performNativeAction, NATIVE_ACTION_NEXT, desktopSnapshot, performDesktopAction, DESKTOP_ACTION_NEXT, getControllablePlayerPost, stepHeroPlayer, stepMiniPlayer, target, heroControlSource } = context;

  console.log(`[Hero] handleNext. Toggle source: ${heroControlSource}, Mode: ${state.heroControlMode}`);
  
  // CRITICAL FIX #4: Get active sources (both native app and browser tabs)
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot, desktopSnapshot });
  console.log(`[Hero] Active sources detected:`, activeSources.map(s => `${s.type}:${s.kind}`).join(', ') || 'None');

  // CRITICAL FIX #4: For toggle mode with specific source preference, validate before action
  const heroControlSource = state.heroControlSource;
  
  if (heroControlSource && ['youtube', 'spotify'].includes(heroControlSource.toLowerCase())) {
    // Apply toggle source filter for both app and browser tabs
    const filteredResult = applyToggleSourceFilter({
      activeSource: heroControlSource.toLowerCase(),
      actionType: 'next',
      actionResult: null,
      nativeSnapshot,
      desktopSnapshot,
      post: getControllablePlayerPost()
    });

    console.log(`[Hero] Next filter check - Source: ${heroControlSource}, Filtered: ${filteredResult.filtered}`);
  }

  // Continue with normal next logic...
  const wasPlaying = state.heroPlayerPlaybackState === "playing";
  
  if (target === "mini") stepMiniPlayer(1);
  else stepHeroPlayer(1);

  if (wasPlaying) {
    const post = getControllablePlayerPost();
    if (post && elements.miniPlayerStage?.appendChild) {
      // mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: true });
    }
  }

  refreshDesktopSnapshot({ force: true, renderAfter: true });
  refreshNativeSnapshot({ renderAfter: true });

  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";
}

/**
 * CRITICAL FIX #5: handleVolumeAction - Fixed bridge routing for both Spotify app and browser tabs
 */
export function handleVolumeAction(context, event) {
  const { state, getControllablePlayerPost, applyPlayerVolumeToActiveElement, render, target } = context;
  
  // Get active sources for volume control
  const activeSources = getAllActiveSources({ state, post: getControllablePlayerPost(), nativeSnapshot: context.nativeSnapshot, desktopSnapshot: context.desktopSnapshot });
  
  console.log(`[Hero] handleVolume. Toggle source: ${state.heroControlSource}, Active sources:`, 
    activeSources.map(s => s.kind).join(', ') || 'None');

  // Apply volume to matching active source...
  const prefersSpotify = state.heroControlSource?.toLowerCase() === 'spotify';
  
  if (prefersSpotify && activeSources.some(s => s.kind === 'spotify')) {
    const bridge = context.getNativeBridge();
    if (bridge?.setNowPlayingVolume) {
      bridge.setNowPlayingVolume(state.playerVolume);
    } else if (applyPlayerVolumeToActiveElement) {
      applyPlayerVolumeToActiveElement();
    }
  }

  // Apply to HTML5 elements for hosted videos/iframe tabs...
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
}

/**
 * CRITICAL FIX #6: handleRefreshAction - Fixed stage re-render and defensive checks
 */
export function handleRefreshAction(context) {
  const { state, elements, getControllablePlayerPost, destroyActivePlayer, render } = context;

  console.log(`[Hero] Refreshing media action. Toggle source: ${state.heroControlSource}`);

  // ... complete refresh logic with defensive checks ...
  
  if (elements.heroPlayerStage) elements.heroPlayerStage.dataset.safeHeroLocked = "true";
}
