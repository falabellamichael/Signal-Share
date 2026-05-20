/**
 * Hero Media Player Toggle State Validation - FIXED MODULE
 * Zero bleed-through validation for Media Toggle mode (YouTube/Spotify)
 * 
 * FIXES:
 * 1. hasActiveMediaInSource() - checks if media source is valid
 * 2. validateMediaToggleState() - validates toggle state to prevent bleed-through
 * 3. createZeroBleedThroughIdleResult() - creates proper idle result for transitions
 */

/**
 * Checks if there's active media in the source (YouTube/Spotify)
 * Returns: true if valid active media exists, false otherwise
 */
export function hasActiveMediaInSource(options = {}) {
  const {
    isYouTubeMode,
    isSpotifyActive,
    post,
    state
  } = options;

  // Check YouTube mode
  if (isYouTubeMode) {
    if (post && post.sourceKind === "youtube") return true;
    if (state?.heroControlSource === "youtube" || 
        state?.heroMediaSource === "youtube") return true;
  }

  // Check Spotify active
  if (isSpotifyActive) {
    if (post && post.sourceKind === "spotify") return true;
    if (state?.heroControlSource === "spotify" || 
        state?.heroMediaSource === "spotify") return true;
  }

  return false;
}

/**
 * Validates toggle state to prevent bleed-through when switching from Media Toggle mode
 * to no-toggle or feed mode. Returns validation result with needsIdleState flag.
 * 
 * FIX: Always validates before rendering, prevents previous session info from showing
 */
export function validateMediaToggleState(options = {}) {
  const {
    isYouTubeMode,
    isSpotifyActive,
    nativeSnapshot,
    desktopSnapshot,
    post,
    state
  } = options;

  // CRITICAL: Check if we're transitioning OUT of Media Toggle mode
  const isTransitioningOutOfToggle = (state?.heroControlMode === "feed" || 
                                      state?.heroMediaSource === null) &&
                                     (isYouTubeMode || isSpotifyActive);

  // Check if validation requires idle state (bleed-through prevention)
  let needsIdleState = false;

  if (isTransitioningOutOfToggle) {
    const hasYouTubeSnapshot = (nativeSnapshot?.sourceProvider === "youtube" ||
                                nativeSnapshot?.appPackage?.toLowerCase().includes("youtube") ||
                                nativeSnapshot?.title?.toLowerCase().includes("youtube"));

    const hasSpotifySnapshot = (nativeSnapshot?.sourceProvider === "spotify" ||
                                 nativeSnapshot?.appPackage?.toLowerCase().includes("spotify") ||
                                 nativeSnapshot?.title?.toLowerCase().includes("spotify"));

    // If we have an active snapshot from YouTube/Spotify, needs idle state before transition
    if ((hasYouTubeSnapshot || hasSpotifySnapshot) && post === null) {
      needsIdleState = true;
    }

    // Also check desktop snapshot for system media playback
    if (isTransitioningOutOfToggle && desktopSnapshot?.active) {
      const provider = (desktopSnapshot.sourceProvider || "").toLowerCase();
      const title = (desktopSnapshot.title || "").toLowerCase();
      
      if ((provider === "youtube" || provider === "spotify") || 
          title.includes("youtube") || title.includes("spotify")) {
        needsIdleState = true;
      }
    }

    // If source is being switched off (null/undefined), requires idle
    if (state?.heroControlSource === null || state?.heroMediaSource === "") {
      needsIdleState = true;
    }
  }

  return {
    valid: !needsIdleState,
    needsIdleState,
    toggleMode: isYouTubeMode || isSpotifyActive ? "media" : "feed",
    validationTimestamp: Date.now()
  };
}

/**
 * Creates zero bleed-through idle result for Media Toggle mode transitions
 * Returns proper idle state with badge/title/meta that prevents previous session info from showing
 * 
 * FIXES: hasActiveMediaInSource(), validateMediaToggleState(), createZeroBleedThroughIdleResult()
 */
export function createZeroBleedThroughIdleResult(options = {}) {
  const {
    toggleMode,
    badgePrefix = "READY",
    isYouTubeMode = false,
    isSpotifyActive = false,
    legacySourceMode = false
  } = options;

  let idleBadge;
  let idleTitle;
  let idleMeta;

  if (toggleMode === "media") {
    // Media Toggle mode idle states
    const preferredSource = isYouTubeMode ? "YouTube" : 
                           (isSpotifyActive ? "Spotify" : "Ready");
    
    idleBadge = `TOGGLE MODE · ${preferredSource.toUpperCase()}`;
    idleTitle = "Ready for playback";
    idleMeta = legacySourceMode 
      ? "Select a source above" 
      : `Open YouTube or Spotify to begin`;
  } else {
    // Default/legacy idle state
    idleBadge = badgePrefix;
    idleTitle = "Browse posts to start playback";
    idleMeta = "Switch sources via toggle button";
  }

  return {
    key: `idle|zero-bleed-through|${Date.now()}`,
    badge: idleBadge,
    title: idleTitle,
    meta: idleMeta,
    sourceProvider: null,
    appPackage: "",
    active: false,
    playbackState: "none",
    artworkUri: "",
    openUri: ""
  };
}

/**
 * Legacy function name alias for backward compatibility
 */
export const createIdleResult = createZeroBleedThroughIdleResult;
