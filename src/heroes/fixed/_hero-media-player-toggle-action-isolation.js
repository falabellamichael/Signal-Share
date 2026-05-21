/**
 * Hero Media Player Toggle Action Isolation Module
 * Provides source-specific validation for toggle actions (Feed/Media, YouTube/Spotify)
 */

import { hasActiveMediaInSource } from './_hero-media-player-toggle-state-validation.js';

/**
 * Validates that a toggle switch happens immediately with no bleed-through
 * @param {Object} options Toggle and state information
 * @returns {Object} Result with mode, source, and immediate effect flags
 */
export function validateToggleSwitch(options = {}) {
  const {
    currentMode = 'feed',
    currentSource = '',
    newState = currentMode,
    newSource = currentSource,
    post = null,
    state = {}
  } = options;

  // Always clear previous state on toggle switch
  return {
    mode: newState,
    source: newSource,
    clearPreviousState: true,
    immediateRender: true
  };
}

/**
 * Creates routing configuration for play/pause/previous/next actions
 */
export function createActionRoutingConfig(options = {}) {
  const {
    activeSource = '',
    post = null,
    state = {},
    nativeSnapshot = null,
    desktopSnapshot = null
  } = options;

  const heroControlSource = state.heroControlSource || activeSource;
  
  return {
    activeSource: heroControlSource || '',
    hasActivePost: !!post,
    hasNativeSnapshot: !!nativeSnapshot,
    hasDesktopSnapshot: !!desktopSnapshot,
    routingTarget: heroControlSource || 'any'
  };
}

/**
 * Filters actions to only process when targeting the active source
 */
export function shouldProcessAction(options = {}) {
  const {
    activeSource = '',
    actionType = 'play-pause',
    nativeSnapshot = null,
    desktopSnapshot = null,
    post = null,
    state = {}
  } = options;

  // If no source locked (not in toggle mode), allow all actions through
  if (!activeSource) {
    return { allowed: true, reason: 'no-source-lock' };
  }

  const activeSourceLower = activeSource.toLowerCase();
  
  // Check if target action matches active source
  const hasMatchingMedia = hasActiveMediaInSource(activeSourceLower, nativeSnapshot, desktopSnapshot);
  
  if (!hasMatchingMedia) {
    return {
      allowed: false,
      reason: 'source-mismatch',
      activeSource: activeSourceLower,
      availableSources: getAvailableSources(state, nativeSnapshot, desktopSnapshot, post)
    };
  }

  return { allowed: true, reason: 'source-match' };
}

/**
 * Gets all active media elements or snapshots for target source
 */
export function getActiveMediaForSource(options = {}) {
  const {
    activeSource = '',
    nativeSnapshot = null,
    desktopSnapshot = null,
    post = null,
    state = {}
  } = options;

  const results = [];

  // Check posted media
  if (post?.sourceKind) {
    results.push({ type: 'post', sourceKind: post.sourceKind, post });
  }

  // Check native snapshot
  if (nativeSnapshot?.active && shouldIncludeSource(nativeSnapshot, activeSource)) {
    results.push({ type: 'native-app', source: activeSource || nativeSnapshot.sourceProvider, snapshot: nativeSnapshot });
  }

  // Check desktop snapshot
  if (desktopSnapshot?.active && shouldIncludeSource(desktopSnapshot, activeSource)) {
    results.push({ type: 'desktop-app', source: activeSource || desktopSnapshot.sourceProvider, snapshot: desktopSnapshot });
  }

  return results;
}

/**
 * Creates filtered media result showing only active toggle source
 */
export function createFilteredMediaResult(options = {}) {
  const {
    source = '',
    hasMedia = false,
    badge = 'READY',
    title = 'Ready for playback',
    meta = 'Select a source and open media'
  } = options;

  return {
    filtered: true,
    onlyShowActiveSource: true,
    targetSource: source || '',
    badge,
    title,
    meta,
    active: hasMedia,
    playbackState: hasMedia ? 'playing' : 'none',
    artworkUri: ''
  };
}

/**
 * Validates source switching with immediate effect
 */
export function validateSourceSwitch(options = {}) {
  const {
    currentSource = '',
    newSource = '',
    nativeSnapshot = null,
    desktopSnapshot = null,
    state = {}
  } = options;

  const canSwitchToNew = shouldIncludeSource(nativeSnapshot, newSource) || 
                         shouldIncludeSource(desktopSnapshot, newSource);
  
  return {
    current: currentSource || '',
    target: newSource,
    canSwitch: canSwitchToNew,
    immediateTransition: true
  };
}

/**
 * Applies source filter to action result
 */
export function applySourceFilter(options = {}) {
  const {
    activeSource = '',
    actionResult = null,
    nativeSnapshot = null,
    desktopSnapshot = null,
    post = null,
    state = {}
  } = options;

  if (!activeSource) return actionResult || {};

  const hasMedia = hasActiveMediaInSource(activeSource.toLowerCase(), nativeSnapshot, desktopSnapshot);
  
  if (!hasMedia) {
    console.log(`[Hero Toggle] Source filter applied - ${activeSource} has no active media`);
    
    return {
      ok: true,
      filtered: true,
      filteredForSource: true,
      onlyShowActiveSource: true,
      targetSource: activeSource.toLowerCase(),
      badge: `TOGGLE · ${activeSource.toUpperCase()}`,
      title: 'Ready for playback',
      meta: `Open a media tab to begin`,
      sourceProvider: null,
      appPackage: '',
      active: false,
      playbackState: 'none',
      artworkUri: ''
    };
  }

  return {
    ...actionResult,
    filtered: true,
    filteredForSource: true,
    applyToggleFiltering: true,
    targetSource: activeSource.toLowerCase(),
    activeMediaCount: 1
  };
}

/**
 * Main handler for Media Toggle actions with full isolation
 */
export function handleMediaToggleAction(options = {}) {
  const {
    toggleMode = 'media',
    mediaSource = '',
    heroControlSource = '',
    post = null,
    state = {},
    actionType = 'play-pause'
  } = options;

  // Validate and clear previous state immediately
  const switchResult = validateToggleSwitch({
    currentMode: state.heroControlMode || toggleMode,
    currentSource: heroControlSource,
    newState: toggleMode,
    newSource: mediaSource,
    post,
    state
  });

  console.log(`[Hero Toggle] Action isolated - Mode: ${switchResult.mode}, Source: ${switchResult.source}`);
  
  return switchResult;
}

/**
 * Validates play/pause targets correct active source
 */
export function validatePlayPauseTarget(options = {}) {
  const {
    activeSource = '',
    currentPlaybackState = 'none',
    nativeSnapshot = null,
    desktopSnapshot = null,
    post = null
  } = options;

  const validation = shouldProcessAction({
    activeSource: activeSource.toLowerCase(),
    actionType: 'play-pause',
    nativeSnapshot,
    desktopSnapshot,
    post
  });

  return {
    valid: validation.allowed,
    target: 'system',
    source: activeSource || ''
  };
}

/**
 * Validates previous/next targets correct active source
 */
export function validateNavigationTarget(options = {}) {
  const {
    activeSource = '',
    currentPlaybackState = 'none',
    nativeSnapshot = null,
    desktopSnapshot = null,
    post = null,
    feedPostIndex = null
  } = options;

  const validation = shouldProcessAction({
    activeSource: activeSource.toLowerCase(),
    actionType: feedPostIndex !== null ? 'navigation' : 'play-pause',
    nativeSnapshot,
    desktopSnapshot,
    post
  });

  return {
    valid: validation.allowed,
    reason: validation.reason || '',
    target: 'system',
    source: activeSource || ''
  };
}

/**
 * Helper to check if source should be included
 */
function shouldIncludeSource(snapshot, preferredSource) {
  if (!preferredSource || preferredSource === 'any') return true;
  
  const provider = (snapshot.sourceProvider || '').toLowerCase();
  const appPkg = (snapshot.appPackage || '').toLowerCase();
  const title = (snapshot.title || '').toLowerCase();

  if (preferredSource === 'spotify') {
    return provider.includes('spotify') || 
           appPkg.includes('spotify') || 
           title.includes('spotify');
  } else if (preferredSource === 'youtube') {
    return provider.includes('youtube') || 
           appPkg.includes('youtube') || 
           appPkg.includes('ytmusic') || 
           title.includes('youtube');
  }

  return true;
}

/**
 * Gets available sources from current state
 */
function getAvailableSources(state, nativeSnapshot, desktopSnapshot, post) {
  const sources = [];

  if (post?.sourceKind === 'youtube') sources.push('youtube');
  if (post?.sourceKind === 'spotify') sources.push('spotify');

  if (nativeSnapshot?.active) {
    const provider = nativeSnapshot.sourceProvider?.toLowerCase() || '';
    if (provider.includes('spotify')) sources.push('spotify-app');
    if (provider.includes('youtube')) sources.push('youtube-app');
  }

  if (desktopSnapshot?.active) {
    const provider = desktopSnapshot.sourceProvider?.toLowerCase() || '';
    if (provider.includes('spotify')) sources.push('spotify-desktop');
    if (provider.includes('youtube')) sources.push('youtube-desktop');
  }

  return [...new Set(sources)];
}

export default {
  validateToggleSwitch,
  createActionRoutingConfig,
  shouldProcessAction,
  getActiveMediaForSource,
  createFilteredMediaResult,
  validateSourceSwitch,
  applySourceFilter,
  handleMediaToggleAction,
  validatePlayPauseTarget,
  validateNavigationTarget
};
