/**
 * Hero Media Player Toggle Action Isolation Module [NEW]
 * Validates source isolation and provides routing logic for YouTube/Spotify actions
 */

export { hasActiveMediaInSource } from './_hero-media-player-toggle-state-validation.js';
export { applyToggleSourceFilter } from './src/heroes/fixed/_hero-media-player-toggle-source-filter.js';

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
  return {
    mode: toggleMode,
    source: mediaSource || heroControlSource || '',
    clearPreviousState: true,
    immediateRender: true
  };
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
  if (!activeSource || activeSource.toLowerCase() === 'all' || activeSource.toLowerCase() === '') {
    return { allowed: true, reason: 'no-source-lock' };
  }

  const activeSourceLower = activeSource.toLowerCase();
  
  // Check if target action matches active source
  const hasMatchingMedia = checkActiveMediaForSource(activeSourceLower, nativeSnapshot, desktopSnapshot);
  
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
 * Checks if there is actually active media in a given source
 */
export function checkActiveMediaForSource(source, nativeSnapshot, desktopSnapshot) {
  const snapshotToCheck = nativeSnapshot || desktopSnapshot;
  if (!snapshotToCheck) return false;
  
  // Helper to check if snapshot matches source
  const snapshotMatchesSource = (snapshot, preferredSource) => {
    if (!snapshot) return false;
    if (!preferredSource) return true; // Any source matches when not specified
  
    const provider = (snapshot.sourceProvider || '').toLowerCase();
    const appPkg = (snapshot.appPackage || '').toLowerCase();
    const title = (snapshot.title || '').toLowerCase();
    const meta = (snapshot.meta || '').toLowerCase();
  
    if (!preferredSource) return true;
    
    if (preferredSource === 'spotify') {
      return provider.includes('spotify') || 
             appPkg.includes('spotify') || 
             title.includes('spotify') || 
             meta.includes('spotify');
    } else if (preferredSource === 'youtube') {
      return provider.includes('youtube') || 
             appPkg.includes('youtube') || 
             appPkg.includes('ytmusic') || 
             title.includes('youtube') || 
             meta.includes('youtube') ||
             // Check for YouTube open URI ID
             /^[A-Za-z0-9_-]{11}$/.test(provider) ||
             /^[?&]v=([A-Za-z0-9_-]{11})$/.test(snapshot.openUri);
    }
  
    return false;
  };
  
  // Check native snapshot first
  if (snapshotMatchesSource(snapshotToCheck, source) && snapshotToCheck.active) {
    return true;
  }
  
  // Check desktop snapshot as fallback
  if (desktopSnapshot && snapshotMatchesSource(desktopSnapshot, source) && (desktopSnapshot.active || desktopSnapshot.title)) {
    return true;
  }
  
  return false;
}

/**
 * Gets available sources from current state
 */
export function getAvailableSources(state, nativeSnapshot, desktopSnapshot, post) {
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

/**
 * Gets all active media info including both native app and browser tab sources
 */
export function getAllActiveMediaInfo(options = {}) {
  const {
    post,
    state,
    nativeSnapshot,
    desktopSnapshot
  } = options;

  const activeMediaList = [];

  // Check post first (hosted videos/iframe)
  if (post?.sourceKind && !post.sourceKind.includes('hosted')) {
    activeMediaList.push({
      type: 'post',
      sourceKind: post.sourceKind,
      externalId: post.externalId,
      title: post.title,
      externalUrl: post.externalUrl
    });
  }

  // Check native snapshot (Spotify app on device)
  if (nativeSnapshot && nativeSnapshot.active) {
    const provider = (nativeSnapshot.sourceProvider || '').toLowerCase();
    const appPkg = (nativeSnapshot.appPackage || '').toLowerCase();
    const title = (nativeSnapshot.title || '').toLowerCase();

    const matchesSpotify = provider.includes('spotify') || 
                           appPkg.includes('spotify') || 
                           title.includes('spotify');
    
    const matchesYouTube = provider.includes('youtube') || 
                          provider === /^[A-Za-z0-9_-]{11}$/ || 
                          appPkg.includes('ytmusic') ||
                          title.includes('youtube');

    if (matchesSpotify) {
      activeMediaList.push({
        type: 'native-app',
        sourceKind: 'spotify',
        provider: 'spotify'
      });
    } else if (matchesYouTube) {
      activeMediaList.push({
        type: 'native-app',
        sourceKind: 'youtube',
        provider: 'youtube'
      });
    }
  }

  // Check desktop snapshot (Spotify app on Windows/macOS)
  if (desktopSnapshot && desktopSnapshot.active) {
    const provider = (desktopSnapshot.sourceProvider || '').toLowerCase();
    const appPkg = (desktopSnapshot.appPackage || '').toLowerCase();
    const title = (desktopSnapshot.title || '').toLowerCase();

    const matchesSpotify = provider.includes('spotify') || 
                           appPkg.includes('spotify') || 
                           title.includes('spotify');
    
    const matchesYouTube = provider.includes('youtube') || 
                          appPkg.includes('ytmusic') ||
                          title.includes('youtube');

    if (matchesSpotify) {
      activeMediaList.push({
        type: 'desktop-app',
        sourceKind: 'spotify',
        provider: 'spotify'
      });
    } else if (matchesYouTube) {
      activeMediaList.push({
        type: 'desktop-app',
        sourceKind: 'youtube',
        provider: 'youtube'
      });
    }
  }

  return activeMediaList;
}

/**
 * Creates filtered idle state result when no active media exists
 */
export function createZeroBleedThroughIdleResult(options = {}) {
  const { badge, title, meta } = options || {};
  
  return {
    badge: badge || 'MEDIA · READY',
    title: title || 'Ready for playback',
    meta: meta || 'Select a source and open media to begin',
  };
}

/**
 * Validates Media Toggle mode before rendering
 */
export function validateMediaToggleState(options = {}) {
  const {
    isYouTubeMode,
    isSpotifyActive,
    nativeSnapshot,
    desktopSnapshot,
    post,
  } = options;

  if (isYouTubeMode && post?.sourceKind === 'youtube') {
    return { needsIdleState: false };
  }

  if (isSpotifyActive && post?.sourceKind === 'spotify') {
    return { needsIdleState: false };
  }
  
  // When in YouTube mode, check for active YouTube media
  if (isYouTubeMode) {
    const hasActiveYouTube = checkActiveMediaForSource('youtube', nativeSnapshot, desktopSnapshot);
    
    if (!hasActiveYouTube) {
      console.log('[Hero Toggle] YouTube mode: No active YouTube media found - returning idle');
      return { 
        needsIdleState: true,
        sourceCheck: 'youtube',
        reason: 'no-active-youtube-media'
      };
    }
  }
  
  // When in Spotify mode, check for active Spotify media
  if (isSpotifyActive) {
    const hasActiveSpotify = checkActiveMediaForSource('spotify', nativeSnapshot, desktopSnapshot);
    
    if (!hasActiveSpotify) {
      console.log('[Hero Toggle] Spotify mode: No active Spotify media found - returning idle');
      return { 
        needsIdleState: true,
        sourceCheck: 'spotify',
        reason: 'no-active-spotify-media'
      };
    }
  }
  
  // Both sources active or no specific source checked
  if (isYouTubeMode && isSpotifyActive) {
    const hasBoth = !!(checkActiveMediaForSource('youtube', nativeSnapshot, desktopSnapshot) || 
                       checkActiveMediaForSource('spotify', nativeSnapshot, desktopSnapshot));
    
    if (!hasBoth) {
      console.log('[Hero Toggle] Both sources: No active media found - returning idle');
      return { 
        needsIdleState: true,
        sourceCheck: 'both',
        reason: 'no-active-media-in-either-source'
      };
    }
  }
  
  // All checks passed - proceed with normal rendering
  return { needsIdleState: false };
}

export default {
  handleMediaToggleAction,
  validatePlayPauseTarget,
  validateNavigationTarget,
  shouldProcessAction,
  checkActiveMediaForSource,
  getAvailableSources,
  getAllActiveMediaInfo,
  createZeroBleedThroughIdleResult,
  validateMediaToggleState
};
