/**
 * Hero Media Player Toggle Source Filter - POST-ACTION VALIDATION
 * Applies source filtering after action logic to filter actions for Spotify App AND Browser Tabs
 */

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
 * Filters action result based on toggle source preference
 * Returns filtered idle state if action doesn't match preferred source
 */
export function applyToggleSourceFilter(options = {}) {
  const {
    activeSource, // 'youtube' | 'spotify' from toggle state
    actionType, // 'play-pause' | 'previous' | 'next'
    actionResult, // Original action result
    nativeSnapshot,
    desktopSnapshot,
    post
  } = options;

  // If no source is locked (not in media toggle mode), return original result
  if (!activeSource || activeSource === 'all') {
    return {
      ...actionResult,
      filtered: false,
      applyToggleFiltering: false
    };
  }

  // Get all active media info
  const activeMedia = getAllActiveMediaInfo({
    post,
    state: options.state || {},
    nativeSnapshot,
    desktopSnapshot
  });

  // Check if any active media matches the preferred source type
  const prefersYouTube = activeSource === 'youtube';
  const prefersSpotify = activeSource === 'spotify';

  // If NO matching active media exists for preferred source, filter to idle state
  const hasMatchingActiveMedia = activeMedia.some(media => {
    if (!prefersYouTube && !prefersSpotify) return false;
    
    return media.sourceKind === activeSource;
  });

  // CRITICAL: If no matching active media, return filtered idle state
  if (!hasMatchingActiveMedia) {
    const preferredSourceName = prefersYouTube ? 'YOUTUBE' : 'SPOTIFY';
    console.log(`[Hero Toggle] Source filter applied - ${activeSource} has no active media`);
    
    return {
      ok: true,
      filtered: true,
      filteredForSource: true,
      onlyShowActiveSource: true,
      targetSource: activeSource,
      badge: `TOGGLE · ${preferredSourceName}`,
      title: "Ready for playback",
      meta: prefersYouTube 
        ? "Open YouTube or Spotify to begin" 
        : "Open YouTube or Spotify to begin",
      sourceProvider: null,
      appPackage: "",
      active: false,
      playbackState: "none",
      artworkUri: "",
      openUri: ""
    };
  }

  // Has matching active media - return original result with toggle filter flag
  return {
    ...actionResult,
    filtered: true,
    filteredForSource: true,
    applyToggleFiltering: true,
    targetSource: activeSource,
    activeMediaCount: activeMedia.length
  };
}

/**
 * Main handler for toggle action filtering - to be called at END of action handlers
 */
export function handleToggleActionFilter(options = {}) {
  const {
    context, // Full action context with all dependencies
    activeSource, // 'youtube' | 'spotify' from toggle state
    actionType, // 'play-pause' | 'previous' | 'next'
    actionResult // Result of normal action processing
  } = options;

  // Get heroControlSource from state if not provided in options
  const heroControlSource = context.state.heroControlSource;
  
  // If no source locked, skip filtering (not in media toggle mode)
  if (!heroControlSource || !['youtube', 'spotify'].includes(heroControlSource.toLowerCase())) {
    return actionResult;
  }

  // Apply source filter
  const filteredResult = applyToggleSourceFilter({
    activeSource: heroControlSource.toLowerCase(),
    actionType,
    actionResult,
    nativeSnapshot: context.nativeSnapshot || context.state?.nativeSnapshot,
    desktopSnapshot: context.desktopSnapshot || context.state?.desktopSnapshot,
    post: context.post || context.getControllablePlayerPost?.() ? context.getControllablePlayerPost() : null
  });

  // If filtered and no active media, return filtered idle result immediately
  if (filteredResult.filtered && filteredResult.targetSource) {
    console.log(`[Hero] Action filtered - source: ${filteredResult.targetSource}, no matching active media`);
    
    // Re-render with filtered idle state
    const parseYouTubeUrl = context.parseYouTubeUrl || (() => {});
    if (typeof context.renderHeroPlayerStage === 'function') {
      context.renderHeroPlayerStage({
        post: null,
        parseYouTubeUrl
      });
    }
    
    return filteredResult;
  }

  // Not filtered - continue with normal flow
  return actionResult;
}

/**
 * Validates that action should be applied to the specific source type
 */
export function validateActionForSource(options = {}) {
  const {
    activeSource,
    nativeSnapshot,
    desktopSnapshot,
    post,
    heroPlayerPlaybackState,
    miniPlayerPlaybackState
  } = options;

  if (!activeSource) return true; // Not in toggle mode

  // Check native app playback state
  const hasNativeSpotifyActive = nativeSnapshot?.active && 
                                 (nativeSnapshot.sourceProvider?.toLowerCase().includes('spotify') ||
                                  nativeSnapshot.appPackage?.toLowerCase().includes('spotify') ||
                                  nativeSnapshot.title?.toLowerCase().includes('spotify'));

  const hasNativeYouTubeActive = nativeSnapshot?.active &&
                                 (nativeSnapshot.sourceProvider?.toLowerCase().includes('youtube') ||
                                  nativeSnapshot.appPackage?.toLowerCase().includes('ytmusic') ||
                                  nativeSnapshot.title?.toLowerCase().includes('youtube'));

  // Check desktop app playback state
  const hasDesktopSpotifyActive = desktopSnapshot?.active &&
                                  (desktopSnapshot.sourceProvider?.toLowerCase().includes('spotify') ||
                                   desktopSnapshot.appPackage?.toLowerCase().includes('spotify') ||
                                   desktopSnapshot.title?.toLowerCase().includes('spotify'));

  const hasDesktopYouTubeActive = desktopSnapshot?.active &&
                                 (desktopSnapshot.sourceProvider?.toLowerCase().includes('youtube') ||
                                  desktopSnapshot.appPackage?.toLowerCase().includes('ytmusic') ||
                                  desktopSnapshot.title?.toLowerCase().includes('youtube'));

  // Check if browser tab is playing (hero player state)
  const hasBrowserSpotifyPlaying = heroPlayerPlaybackState === 'playing' &&
                                   (desktopSnapshot?.sourceProvider?.toLowerCase().includes('spotify') ||
                                    desktopSnapshot.appPackage?.toLowerCase().includes('spotify'));

  const hasBrowserYouTubePlaying = heroPlayerPlaybackState === 'playing' &&
                                  (desktopSnapshot?.sourceProvider?.toLowerCase().includes('youtube') ||
                                   desktopSnapshot.appPackage?.toLowerCase().includes('ytmusic'));

  // If source matches preferred type, allow action through
  if (activeSource === 'spotify') {
    return hasNativeSpotifyActive || hasDesktopSpotifyActive || hasBrowserSpotifyPlaying;
  }

  // For youtube
  return hasNativeYouTubeActive || hasDesktopYouTubeActive || hasBrowserYouTubePlaying;
}
