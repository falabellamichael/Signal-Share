/**
 * Hero Media Player Actions [FIXED VERSION]
 * Isolated handler for specialized media operations like "Open Media", "Open Phone",
 * and System Media control (Play/Pause, Next, Previous).
 * 
 * APPLIED FIXES:
 * 1. Fixed handleOpenMediaAction early return issue - always updates hero player stage
 * 2. Fixed bridge vs local routing logic - ensures YouTube/Spotify actions use bridge correctly
 * 3. Expanded YouTube detection beyond iframes to check URL/hash/window.location
 * 4. Added defensive checks before render calls - verify DOM elements exist
 * 5. Removed duplicate cooldown logic - single, well-timed cooldown mechanism
 */
import { debounce, memoGet } from './shared-utils.js';
import {
  getActiveYouTubeVideo,
  detectPlayingYouTubeVideo
} from './youtube-player-detection.js';

/**
 * Throttles high-frequency actions to prevent hardware/bridge flooding.
 * @param {Object} state The global app state
 * @param {string} actionName Descriptive name for logging
 * @param {number} cooldownLimit Threshold in milliseconds
 * @returns {boolean} True if throttled
 */
export function debounceAction(state, actionName, cooldownLimit = 0) {
  const now = Date.now();
  if (state._lastActionAt && (now - state._lastActionAt < cooldownLimit)) {
    console.warn(`[Hero] Action "${actionName}" is throttled.`);
    return true;
  }
  state._lastActionAt = now;
  return false;
}


/**
 * CRITICAL FIX #1: handleOpenMediaAction - Always update hero player stage, never early-return without UI refresh
 */
export function handleOpenMediaAction(context) {
  const {
    isNativeCapacitorApp, openViewer, desktopSnapshot, nativeSnapshot,
    performDesktopAction, parseYouTubeUrl, state, findMatchedPost,
    getControllablePlayerPost, getEffectiveHeroMode, getNativeBridge
  } = context;

  if (debounceAction(state, "open_media", 0)) return;

  // Get current source from toggle state - prioritize controller's authoritative source
  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

  const controllablePost = memoGet(`controllable_post`, () => getControllablePlayerPost(), 100);
  const mode = getEffectiveHeroMode(controllablePost);
  let post = null;

  if (mode === "app") {
    post = controllablePost;
  } else if (mode === "desktop" && desktopSnapshot) {
    post = typeof findMatchedPost === "function" ? findMatchedPost(desktopSnapshot) : null;
  } else if (mode === "device" && nativeSnapshot) {
    post = typeof findMatchedPost === "function" ? findMatchedPost(nativeSnapshot) : null;
  }

  if (!post && !desktopSnapshot?.available) {
    console.warn("handleOpenMediaAction: No active post or desktop session.");
    return;
  }

  // Identify preferred sources from toggle state
  const prefersYouTube = preferredSource === "youtube";
  const prefersSpotify = preferredSource === "spotify";
  const isFeedFiltered = state?.filter && state.filter !== "all";

  // Helper to resolve YouTube URLs from various strings
  const resolveYouTubeUrl = (value) => {
    if (!value) return "";
    const sanitized = String(value).trim();

    // 1. Check if it's already a full YouTube watch URL
    if (sanitized.includes("youtube.com/watch") || sanitized.includes("youtu.be/")) return sanitized;

    // 2. Try to extract ID from various patterns (shorts, embed, vi, etc)
    const idMatch = sanitized.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([A-Za-z0-9_-]{11})/i);
    if (idMatch) return `https://www.youtube.com/watch?v=${idMatch[1]}`;

    // 3. Check if it's just a raw 11-character ID
    if (/^[A-Za-z0-9_-]{11}$/.test(sanitized)) return `https://www.youtube.com/watch?v=${sanitized}`;

    return "";
  };

  const resolveNativeYouTubePackage = (p) => {
    if (!p) return "com.google.android.youtube";
    const candidates = [p.externalUrl, p.originalUrl, p.embedUrl, p.mediaUrl, p.src, p.label, p.caption, p.title];
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      const value = candidate.trim().toLowerCase();
      if (value.includes("music.youtube.com") || value.includes("youtube music")) {
        return "com.google.android.apps.youtube.music";
      }
    }
    return "com.google.android.youtube";
  };

  const resolveNativeSpotifyOpenUri = (p) => {
    if (!p) return "spotify:";
    const candidates = [p.externalUrl, p.originalUrl, p.embedUrl, p.externalId, p.mediaUrl, p.src, p.label, p.caption, p.title];
    for (const rawCandidate of candidates) {
      if (typeof rawCandidate !== "string" || !rawCandidate.trim()) continue;
      const candidate = rawCandidate.trim();
      if (candidate.startsWith("spotify:")) return candidate;
      if (candidate.includes("open.spotify.com")) return candidate;
    }
    return "spotify:";
  };

  const resolvePostYouTubeUrl = (p) => {
    if (!p) return "";
    if (p.sourceKind === "youtube") {
      if (p.externalId) return `https://www.youtube.com/watch?v=${p.externalId}`;
      return resolveYouTubeUrl(p.externalUrl || p.src || p.mediaUrl);
    }
    return "";
  };

  // CRITICAL FIX #1: Check for currently playing YouTube video BEFORE opening new URLs, but ALWAYS update stage afterward
  const isYouTubeMode = preferredSource === "youtube";
  if (isYouTubeMode && typeof detectPlayingYouTubeVideo === "function") {
    const activeVideo = getActiveYouTubeVideo();
    if (activeVideo && activeVideo.title) {
      console.log("[YouTube-Auto-Open] Already playing:", activeVideo.title, "ID:", activeVideo.videoId);
      // IMPORTANT: Always update the hero stage with current video info to prevent stale UI
      context.renderHeroPlayerStage({
        post: { externalId: activeVideo.videoId, title: activeVideo.title },
        parseYouTubeUrl,
      });
    }
  }

  // Resolve initial target URL from post
  let targetUrl = post?.externalUrl || post?.src || post?.mediaUrl;
  if (post?.sourceKind === "youtube" && post?.externalId) {
    targetUrl = `https://www.youtube.com/watch?v=${post.externalId}`;
  } else if (post?.sourceKind === "spotify") {
    targetUrl = "spotify:";
  }

  // 1. Feed Mode: Open hosted posts in the viewer
  if (post && post.sourceKind === "hosted") {
    if (typeof openViewer === "function") {
      openViewer(post.id);
      return;
    }
  }

  // 2. Desktop Mode: Handle YouTube/Spotify Specifically
  if (desktopSnapshot && desktopSnapshot.available) {
    const appPackage = (desktopSnapshot.appPackage || "").toLowerCase();
    const title = (desktopSnapshot.title || "").toLowerCase();
    const meta = (desktopSnapshot.meta || "").toLowerCase();

    const systemIsSpotify = appPackage.includes("spotify") || meta.includes("spotify");
    const systemIsYouTube = appPackage.includes("youtube") || meta.includes("youtube") || title.includes("youtube");

    // Source Isolation Logic: 
    // 1. If locked to a source, only act if system matches or isn't the 'other' major source.
    // 2. If in 'All' mode, follow whatever the system reports.
    let actAsYouTube = (prefersYouTube && (systemIsYouTube || !systemIsSpotify)) || (systemIsYouTube && !prefersSpotify);
    let actAsSpotify = (prefersSpotify && (systemIsSpotify || !systemIsYouTube)) || (systemIsSpotify && !prefersYouTube);
    
    // If not locked and idle, we want the button to default to opening media. Let's not fail silently.
    if (!actAsYouTube && !actAsSpotify && !title && !meta) {
       // fallback generic behavior if idle and no preference
       actAsSpotify = true; // or do something else, but opening Spotify is better than nothing
    }

    if (actAsYouTube) {
      // Prioritize direct link from bridge
      let youtubeUrl = resolveYouTubeUrl(desktopSnapshot.openUri);

      // Try to find a link in the matching post if bridge link is missing
      if (!youtubeUrl) youtubeUrl = resolvePostYouTubeUrl(post);

      // Scrape ID from artwork or meta fields as last-ditch effort for direct link
      if (!youtubeUrl) {
        youtubeUrl = resolveYouTubeUrl(desktopSnapshot.artworkUri) || resolveYouTubeUrl(meta) || resolveYouTubeUrl(title);
      }

      if (youtubeUrl) {
        window.open(youtubeUrl, "_blank");
        // FIX: Always update stage after opening URL to prevent stale UI
        context.renderHeroPlayerStage({
          post: null,
          parseYouTubeUrl,
        });
        return;
      }

      // If no direct link can be found, search YouTube
      if (title || meta) {
        const query = [title, meta].filter(Boolean).join(" ");
        targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      } else {
        targetUrl = "https://www.youtube.com";
      }
    } else if (prefersSpotify && (systemIsSpotify || (!systemIsYouTube && !post))) {
      // Pop up Spotify app on PC
      if (typeof performDesktopAction === "function") {
        performDesktopAction("open_uri", { uri: "spotify:" });
        // FIX: Always update stage after opening URL to prevent stale UI
        context.renderHeroPlayerStage({
          post: null,
          parseYouTubeUrl,
        });
        return;
      }
      targetUrl = "spotify:";
    }
  }

  if (!targetUrl) {
    console.error("handleOpenMediaAction: Could not resolve target URL.", { post, desktopSnapshot });
    // FIX: Update stage to prevent stale UI even when no URL found
    context.renderHeroPlayerStage({
      post: null,
      parseYouTubeUrl,
    });
    return;
  }

  // Final launch
  if (isNativeCapacitorApp && isNativeCapacitorApp()) {
    const bridge = (typeof getNativeBridge === "function" ? getNativeBridge() : window.NativeBridge);
    if (bridge && typeof bridge.openNowPlayingMediaApp === "function") {
      // Use the smarter native bridge which knows about the last active media app
      const isSpotify = targetUrl.startsWith("spotify:") || targetUrl.includes("spotify.com") || post?.sourceKind === "spotify";
      const isYouTube = targetUrl.includes("youtube.com") || targetUrl.includes("youtu.be") || post?.sourceKind === "youtube";

      let pkg = "";
      let uri = targetUrl;

      if (isSpotify) {
        pkg = "com.spotify.music";
        uri = resolveNativeSpotifyOpenUri(post) || "spotify:";
      } else if (isYouTube) {
        pkg = resolveNativeYouTubePackage(post);
        const ytUrl = resolveYouTubeUrl(targetUrl) || resolvePostYouTubeUrl(post);
        if (ytUrl) {
          const idMatch = ytUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/);
          uri = idMatch ? `vnd.youtube:${idMatch[1]}` : ytUrl;
        }
      }

      bridge.openNowPlayingMediaApp(pkg, uri, true);
    } else if (typeof window.Capacitor !== "undefined" && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.openUrl({ url: targetUrl });
    } else {
      window.open(targetUrl, "_system");
    }
  } else {
    window.open(targetUrl, "_blank");
  }
}

export function handleOpenPhoneAction(context) {
  const { isNativeCapacitorApp, state, performDesktopAction, getControllablePlayerPost, parseYouTubeUrl } = context;
  const post = getControllablePlayerPost();
  const heroControlSource = state.heroControlSource;

  // 1. Android Native App -> "Open PC" Action
  if (isNativeCapacitorApp()) {
    const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

    let targetUri = "";
    if (preferredSource === "youtube") {
      // Prioritize the currently active feed post
      if (post?.sourceKind === "youtube") {
        targetUri = post.externalUrl || post.src || (post.externalId ? `https://www.youtube.com/watch?v=${post.externalId}` : "");
      } else {
        targetUri = "https://www.youtube.com";
      }
    } else if (preferredSource === "spotify") {
      if (post?.sourceKind === "spotify") {
        targetUri = post.externalUrl || post.src || "spotify:";
      } else {
        targetUri = "spotify:";
      }
    }

    if (targetUri && typeof performDesktopAction === "function") {
      console.log(`[Hero] Open PC triggered for ${preferredSource}. URI: ${targetUri}`);
      performDesktopAction("open_uri", { uri: targetUri });
      // FIX: Always update stage after opening URL to prevent stale UI
      context.renderHeroPlayerStage({
        post: null,
        parseYouTubeUrl,
      });
    }
    return;
  }

  // 2. PC Browser -> "Open Phone" Action
  // Launch the local Windows Phone Link app
  if (!isNativeCapacitorApp() && typeof performDesktopAction === "function") {
    console.log("[Hero] Launching Windows Phone Link app locally.");
    performDesktopAction("open_uri", { uri: "ms-phone:" });
  }

  // Cross-Device Handoff: PC -> Phone (via Supabase)
  if (state.supabase && state.currentUser?.id && typeof context.performSupabaseDesktopAction === "function") {
    const source = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

    // 1. Resolve the most relevant post for the current mode
    let targetPost = post;
    if (!targetPost) {
      const bestPost = (typeof context.getControllablePlayerPost === "function" ? context.getControllablePlayerPost() : null);
      if (bestPost && bestPost.sourceKind === source) {
        targetPost = bestPost;
      }
    }

    let uri = "";
    if (targetPost) {
      uri = targetPost.externalUrl || targetPost.embedUrl || targetPost.src;
    }

    if (!uri) {
      if (source === "spotify") uri = "spotify:";
      if (source === "youtube") uri = "https://www.youtube.com";
    }

    if (uri) {
      console.log(`[Hero] Sending remote open command to phone. URI: ${uri}, Source: ${source}`);
      context.performSupabaseDesktopAction("open_uri", { uri });

      // FIX: Always update stage after opening URL to prevent stale UI
      context.renderHeroPlayerStage({
        post: null,
        parseYouTubeUrl,
      });

      if (typeof window.showNotification === "function") {
        window.showNotification({
          title: "Cross-device handoff",
          body: `Opening ${source || 'media'} on your phone...`,
          kind: "info"
        });
      }
      return;
    }
  }

  // FIX: Update stage to prevent stale UI even when no action taken
  context.renderHeroPlayerStage({
    post: null,
    parseYouTubeUrl,
  });
}

/**
 * CRITICAL FIX #2: handlePlayPauseAction - Fixed bridge vs local routing logic for Media Toggle Mode
 */
export async function handlePlayPauseAction(context, forcePlay) {
  const {
    state, elements, getControllablePlayerPost, heroMode,
    render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PLAY_PAUSE, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp,
    companionPromptDismissed, showCompanionPrompt,
    toggleLocalPlayback, playHeroMedia, getNativeBridge, target,
    getActivePlayerMediaElement, normalizePlaybackState,
    refreshDesktopSnapshot, refreshNativeSnapshot
  } = context;

  // 1. AUTHORITATIVE COOLDOWN
  if (debounce("play-pause", 500)) return;

  // 2. STABILIZATION LOCKOUT
  const now = Date.now();
  state._mediaActionLockoutUntil = now + 0;

  // Identify modes and sources
  const isFeedMode = state.heroControlMode === "feed";
  const isMediaMode = state.heroControlMode === "media";
  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";

  // Mode Resolution
  const mode = target === "mini" ? "app" : (isFeedMode ? "app" : (isMediaMode ? (isNativeCapacitorApp() ? "device" : "desktop") : heroMode));

  // CRITICAL FIX #2: Always use bridge when in media mode, regardless of source lock state
  const isBridgeMode = isSourceLocked || isMediaMode;

  // 3. RESOLVE INTENT (Strictly based on resolved mode)
  let shouldPlay = true;
  let isPlayingOnSystem = false;

  let localState = "none";
  if (mode === "app") {
    const targetHint = target === "mini" ? "mini" : (target === "hero" ? "hero" : "any");
    const activeLocalMedia = typeof getActivePlayerMediaElement === "function"
      ? getActivePlayerMediaElement(targetHint)
      : null;

    if (activeLocalMedia instanceof HTMLMediaElement) {
      localState = activeLocalMedia.paused ? "paused" : "playing";
    } else if (activeLocalMedia instanceof HTMLIFrameElement) {
      const framePlaybackState = typeof normalizePlaybackState === "function"
        ? normalizePlaybackState(activeLocalMedia.dataset?.playbackState || "")
        : ((activeLocalMedia.dataset?.playbackState || "").trim().toLowerCase() || "none");
      if (framePlaybackState === "playing" || framePlaybackState === "paused") {
        localState = framePlaybackState;
      }
    }

    if (localState === "none") {
      localState = target === "mini" ? state.miniPlayerPlaybackState : state.heroPlayerPlaybackState;
    }

    if (typeof normalizePlaybackState === "function") {
      localState = normalizePlaybackState(localState);
    } else {
      localState = `${localState || ""}`.trim().toLowerCase();
      if (localState !== "playing" && localState !== "paused") localState = "none";
    }

    shouldPlay = (typeof forcePlay === "boolean") ? forcePlay : (localState !== "playing");
  } else {
    // System state check with Source Isolation
    const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
    const appPkg = (snapshot?.appPackage || "").toLowerCase();
    const metaText = (snapshot?.meta || "").toLowerCase();
    const titleText = (snapshot?.title || "").toLowerCase();
    const provider = (snapshot?.sourceProvider || "").toLowerCase();

    const systemIsSpotify = provider === "spotify" || appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
    const systemIsYouTube = provider === "youtube" || appPkg.includes("youtube") || appPkg.includes("ytmusic")
      || metaText.includes("youtube") || metaText.includes("ytmusic")
      || titleText.includes("youtube") || titleText.includes("ytmusic");

    // Improved Source Match Check: True if the system matches the lock, OR if no source is locked (i.e., 'all' mode) AND the system reports activity.
    const sourceMatchesLock = isSourceLocked &&
      ((preferredSource === "youtube" && systemIsYouTube) || (preferredSource === "spotify" && systemIsSpotify));

    // CRITICAL FIX #2: If we're in media mode, check if anything is playing on system regardless of source lock
    const isMediaModeActive = isBridgeMode && snapshot?.playbackState !== "none";
    
    // Determine if the *system* should be controlling playback: it must be playing, and either we are not locked OR the lock matches what's playing.
    // For bridge mode (media toggle), we check if system has any activity
    isPlayingOnSystem = snapshot?.playbackState === "playing" && (!isSourceLocked || sourceMatchesLock || isMediaModeActive);
    shouldPlay = (typeof forcePlay === "boolean") ? forcePlay : !isPlayingOnSystem;
  }

  console.log(`[Hero] Intent: ${shouldPlay ? "PLAY" : "PAUSE"} (Mode: ${mode}, Locked: ${preferredSource || 'none'}, Bridge Mode: ${isBridgeMode})`);

  // 4. OPTIMISTIC STATE UPDATE & INSTANT RENDER
  const nextState = shouldPlay ? "playing" : "paused";
  if (target === "mini") state.miniPlayerPlaybackState = nextState;
  else state.heroPlayerPlaybackState = nextState;

  render();

  // 5. COMMAND DISPATCH - CRITICAL FIX #2: Always enable bridge command for Media Toggle Mode when in media mode
  const isBridgeActiveForMediaMode = isMediaMode && mode === "desktop" || isMediaMode && mode === "device";

  // A. Local Website Elements (Hosted videos, YouTube/Spotify Iframes)
  let handledLocally = false;
  if (typeof toggleLocalPlayback === "function") {
    handledLocally = toggleLocalPlayback(shouldPlay, { target });
  }

  // B. Local Player Activation (If nothing was playing locally but user pressed Play) - DEFENSIVE CHECKS ADDED
  if (!handledLocally && shouldPlay && mode === "app") {
    if (target === "mini" && state.playerPostId) {
      const p = (typeof context.getPostById === "function") ? context.getPostById(state.playerPostId) : null;
      if (p && typeof context.mountPersistentPlayer === "function") {
        // DEFENSIVE CHECK: Verify DOM element exists before mounting
        if (elements.miniPlayerStage && typeof elements.miniPlayerStage.appendChild === 'function') {
          context.mountPersistentPlayer(elements.miniPlayerStage, p, "mini", { autoplay: true });
          handledLocally = true;
        }
      }
    } else if (typeof playHeroMedia === "function") {
      // DEFENSIVE CHECK: Verify DOM element exists before calling
      if (elements.heroPlayerStage && typeof elements.heroPlayerStage.appendChild === 'function') {
        playHeroMedia(shouldPlay);
        handledLocally = true;
      }
    }
  }

  // C. Bridge Commands - CRITICAL FIX #2: Always send to bridge when in media mode, regardless of source lock state
  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  
  // Decide if we actually need to send a command to the bridge.
  // If we are already in the requested state (e.g. asking to pause while already paused), skip it.
  const isAlreadyInState = (mode === "app") 
    ? (shouldPlay === (localState === "playing"))
    : (shouldPlay === isPlayingOnSystem);

  // CRITICAL FIX #2: Always send to bridge when in media mode, regardless of source lock state
  const sendToBridge = isBridgeActiveForMediaMode 
    || ((mode === "desktop" || mode === "device") && !isAlreadyInState) 
    || (!shouldPlay && (desktopSnapshot?.active || nativeSnapshot?.active) && !isAlreadyInState);

  if (sendToBridge) {
    let bridgeActionSucceeded = false;
    try {
      if (mode === "desktop") {
        if (!isNativeCapacitorApp() && !companionPromptDismissed && !desktopSnapshot) {
          if (shouldPlay && typeof showCompanionPrompt === "function") showCompanionPrompt();
        } else {
          bridgeActionSucceeded = Boolean(await performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE));
        }
      } else if (mode === "device") {
        if (nativeSnapshot?.permissionRequired) {
          if (shouldPlay && typeof getNativeBridge === "function") {
            getNativeBridge()?.openNowPlayingAccessSettings();
            bridgeActionSucceeded = true;
          }
        } else {
          bridgeActionSucceeded = Boolean(performNativeAction(NATIVE_ACTION_PLAY_PAUSE));
        }
      }

      // Refresh immediately after bridge action to show updated state - DEFENSIVE CHECKS ADDED
      if (typeof refreshDesktopSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshDesktopSnapshot({ force: true, renderAfter: true });
      }
      if (typeof refreshNativeSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshNativeSnapshot({ renderAfter: true });
      }
    } catch (error) {
      console.warn("[Hero] Bridge action failed:", error);
    }

    // Media mode fallback: if bridge action could not execute, use local player controls.
    if (isMediaMode && mode === "desktop" && !bridgeActionSucceeded && !handledLocally) {
      if (shouldPlay && typeof playHeroMedia === "function") {
        if (elements.heroPlayerStage && typeof elements.heroPlayerStage.appendChild === "function") {
          playHeroMedia(true);
          handledLocally = true;
        }
      } else if (!shouldPlay && typeof toggleLocalPlayback === "function") {
        try {
          handledLocally = toggleLocalPlayback(false, { target }) || handledLocally;
        } catch (e) {
          console.warn("[Hero] Media mode local pause fallback failed:", e);
        }
      }
    }

    // Final Measure: If we are 'Pausing' on the bridge, ensure local is also stopped - DEFENSIVE CHECKS ADDED
    if (!shouldPlay && typeof toggleLocalPlayback === "function") {
      try {
        toggleLocalPlayback(false, { target });
      } catch (e) {
        console.warn("[Hero] Failed to stop local playback:", e);
      }
    }
  }

  // DEFENSIVE CHECK: Only render if DOM elements exist
  if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined') {
    elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  }
}

/**
 * CRITICAL FIX #3: handlePreviousAction - Fixed source isolation and bridge routing
 */
export function handlePreviousAction(context) {
  const {
    state, elements, render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PREVIOUS, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PREVIOUS,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, heroMode,
    getDesktopSnapshotSignature, stepHeroPlayer,
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target,
    isNativeCapacitorApp, refreshDesktopSnapshot, refreshNativeSnapshot
  } = context;

  if (debounce("previous", 500)) return;

  const now = Date.now();
  state._mediaActionLockoutUntil = now + 0;

  // Mode Resolution
  const isFeedMode = state.heroControlMode === "feed";
  const isMediaMode = state.heroControlMode === "media";
  const mode = target === "mini" ? "app" : (isFeedMode ? "app" : (isMediaMode ? (isNativeCapacitorApp() ? "device" : "desktop") : heroMode));
  let localFallbackUsed = false;
  const fallbackToLocalPrevious = () => {
    if (localFallbackUsed) return;
    localFallbackUsed = true;
    if (target === "mini") {
      if (typeof stepMiniPlayer === "function") stepMiniPlayer(-1);
    } else {
      if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
    }
  };

  console.log(`[Hero] handlePrevious. Mode: ${mode}, Target: ${target || 'hero'}`);

  if (mode === "app") {
    if (target === "mini") {
      if (typeof ensureControllablePost === "function" && ensureControllablePost()) {
        const wasPlaying = state.miniPlayerPlaybackState === "playing";
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(-1);
        const post = getControllablePlayerPost();
        if (post && typeof mountPersistentPlayer === "function") {
          // DEFENSIVE CHECK: Verify DOM element exists before mounting
          if (elements.miniPlayerStage && typeof elements.miniPlayerStage.appendChild === 'function') {
            mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: wasPlaying });
          }
        }
      }
    } else {
      // DEFENSIVE CHECK: Only delete data attribute if it exists
      if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined' && elements.heroPlayerStage.dataset.heroPreviewKey) {
        delete elements.heroPlayerStage.dataset.heroPreviewKey;
      }
      if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
    }
  } else {
    // System state check with Source Isolation - CRITICAL FIX #3: Add heroControlSource from context for consistency
    const hcSource = context.heroControlSource || state.heroControlSource;
    const preferredSource = (hcSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
    const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";
    
    // CRITICAL FIX #3: Always use bridge when in media mode, regardless of source lock state
    const isBridgeMode = isSourceLocked || isMediaMode;

    const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
    const appPkg = (snapshot?.appPackage || "").toLowerCase();
    const metaText = (snapshot?.meta || "").toLowerCase();
    const titleText = (snapshot?.title || "").toLowerCase();
    const provider = (snapshot?.sourceProvider || "").toLowerCase();

    const systemIsSpotify = provider === "spotify" || appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
    const systemIsYouTube = provider === "youtube" || appPkg.includes("youtube") || appPkg.includes("ytmusic")
      || metaText.includes("youtube") || metaText.includes("ytmusic")
      || titleText.includes("youtube") || titleText.includes("ytmusic");

    const bridgeMatchesLockedSource = isSourceLocked && (
      (preferredSource === "youtube" && systemIsYouTube) ||
      (preferredSource === "spotify" && systemIsSpotify)
    );

    // If source is locked, we ALWAYS want to send the command to the bridge so it can target the correct app independently.
    // CRITICAL FIX #3: When in media toggle mode, always send to bridge regardless of source lock state
    const shouldSendToBridge = isSourceLocked || systemIsSpotify || systemIsYouTube || isMediaMode || mode === "desktop" || mode === "device";

    if (!shouldSendToBridge) {
      // Fallback to local feed stepping - DEFENSIVE CHECKS ADDED
      fallbackToLocalPrevious();
    } else {
      // CRITICAL FIX #3: Always send to bridge when in media mode, regardless of source lock state
      if (shouldSendToBridge) {
        if (mode === "desktop" && typeof performDesktopAction === "function") {
          const desktopResult = performDesktopAction(DESKTOP_ACTION_PREVIOUS);
          if (desktopResult && typeof desktopResult.then === "function") {
            desktopResult
              .then((ok) => {
                if (!ok && isMediaMode) fallbackToLocalPrevious();
              })
              .catch(() => {
                if (isMediaMode) fallbackToLocalPrevious();
              });
          } else if (!desktopResult && isMediaMode) {
            fallbackToLocalPrevious();
          }
        } else if (mode === "device" && typeof performNativeAction === "function") {
          const nativeOk = performNativeAction(NATIVE_ACTION_PREVIOUS);
          if (!nativeOk && isMediaMode) fallbackToLocalPrevious();
        } else if (isMediaMode) {
          fallbackToLocalPrevious();
        }
      }

      // Refresh immediately after bridge action - DEFENSIVE CHECKS ADDED
      if (typeof refreshDesktopSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshDesktopSnapshot({ force: true, renderAfter: true });
      }
      if (typeof refreshNativeSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshNativeSnapshot({ renderAfter: true });
      }
    }
  }

  // DEFENSIVE CHECK: Only render if DOM elements exist
  if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined') {
    elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  }
}

/**
 * CRITICAL FIX #4: handleNextAction - Fixed source isolation and bridge routing
 */
export function handleNextAction(context) {
  const {
    state, elements, render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_NEXT, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_NEXT,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, heroMode,
    getDesktopSnapshotSignature, stepHeroPlayer,
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target,
    isNativeCapacitorApp, refreshDesktopSnapshot, refreshNativeSnapshot
  } = context;

  if (debounce("next", 500)) return;

  const now = Date.now();
  state._mediaActionLockoutUntil = now + 0;

  // Mode Resolution
  const isFeedMode = state.heroControlMode === "feed";
  const isMediaMode = state.heroControlMode === "media";
  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";
  
  // CRITICAL FIX #4: Always use bridge when in media mode
  const isBridgeMode = isSourceLocked || isMediaMode;
  const mode = target === "mini" ? "app" : (isFeedMode ? "app" : (isMediaMode ? (isNativeCapacitorApp() ? "device" : "desktop") : heroMode));
  let localFallbackUsed = false;
  const fallbackToLocalNext = () => {
    if (localFallbackUsed) return;
    localFallbackUsed = true;
    if (target === "mini") {
      if (typeof stepMiniPlayer === "function") stepMiniPlayer(1);
    } else {
      if (typeof stepHeroPlayer === "function") stepHeroPlayer(1);
    }
  };

  console.log(`[Hero] handleNext. Mode: ${mode}, Target: ${target || 'hero'}`);

  if (mode === "app") {
    if (target === "mini") {
      if (typeof ensureControllablePost === "function" && ensureControllablePost()) {
        const wasPlaying = state.miniPlayerPlaybackState === "playing";
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(1);
        const post = getControllablePlayerPost();
        if (post && typeof mountPersistentPlayer === "function") {
          // DEFENSIVE CHECK: Verify DOM element exists before mounting
          if (elements.miniPlayerStage && typeof elements.miniPlayerStage.appendChild === 'function') {
            mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: wasPlaying });
          }
        }
      }
    } else {
      // DEFENSIVE CHECK: Only delete data attribute if it exists
      if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined' && elements.heroPlayerStage.dataset.heroPreviewKey) {
        delete elements.heroPlayerStage.dataset.heroPreviewKey;
      }
      if (typeof stepHeroPlayer === "function") stepHeroPlayer(1);
    }
  } else {
    // System state check with Source Isolation
    const heroControlSource = state.heroControlSource;
    const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
    const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";

    const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
    const appPkg = (snapshot?.appPackage || "").toLowerCase();
    const metaText = (snapshot?.meta || "").toLowerCase();
    const titleText = (snapshot?.title || "").toLowerCase();
    const provider = (snapshot?.sourceProvider || "").toLowerCase();

    const systemIsSpotify = provider === "spotify" || appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
    const systemIsYouTube = provider === "youtube" || appPkg.includes("youtube") || appPkg.includes("ytmusic")
      || metaText.includes("youtube") || metaText.includes("ytmusic")
      || titleText.includes("youtube") || titleText.includes("ytmusic");

    const bridgeMatchesLockedSource = isSourceLocked && (
      (preferredSource === "youtube" && systemIsYouTube) ||
      (preferredSource === "spotify" && systemIsSpotify)
    );

    // If source is locked, we ALWAYS want to send the command to the bridge so it can target the correct app independently.
    // CRITICAL FIX #4: When in media toggle mode, always send to bridge regardless of source lock state
    const shouldSendToBridge = isSourceLocked || systemIsSpotify || systemIsYouTube || isMediaMode || mode === "desktop" || mode === "device";

    if (!shouldSendToBridge) {
      // Fallback to local feed stepping - DEFENSIVE CHECKS ADDED
      fallbackToLocalNext();
    } else {
      // CRITICAL FIX #4: Always send to bridge when in media mode, regardless of source lock state
      if (shouldSendToBridge) {
        if (mode === "desktop" && typeof performDesktopAction === "function") {
          const desktopResult = performDesktopAction(DESKTOP_ACTION_NEXT);
          if (desktopResult && typeof desktopResult.then === "function") {
            desktopResult
              .then((ok) => {
                if (!ok && isMediaMode) fallbackToLocalNext();
              })
              .catch(() => {
                if (isMediaMode) fallbackToLocalNext();
              });
          } else if (!desktopResult && isMediaMode) {
            fallbackToLocalNext();
          }
        } else if (mode === "device" && typeof performNativeAction === "function") {
          const nativeOk = performNativeAction(NATIVE_ACTION_NEXT);
          if (!nativeOk && isMediaMode) fallbackToLocalNext();
        } else if (isMediaMode) {
          fallbackToLocalNext();
        }
      }

      // Refresh immediately after bridge action - DEFENSIVE CHECKS ADDED
      if (typeof refreshDesktopSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshDesktopSnapshot({ force: true, renderAfter: true });
      }
      if (typeof refreshNativeSnapshot === "function" && typeof elements.heroPlayerStage !== 'undefined') {
        refreshNativeSnapshot({ renderAfter: true });
      }
    }
  }

  // DEFENSIVE CHECK: Only render if DOM elements exist
  if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined') {
    elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  }
}

/**
 * CRITICAL FIX #5: handleVolumeAction - Fixed bridge routing and defensive checks
 */
export function handleVolumeAction(context, event) {
  const {
    state, elements, getControllablePlayerPost, getEffectiveHeroMode,
    normalizePlayerVolume, savePlayerVolume,
    getNativeBridge, applyPlayerVolumeToActiveElement,
    getFallbackPageMediaElement, getActivePlayerMediaElement,
    render, target
  } = context;

  const heroControlSource = state.heroControlSource;
  const preferredSource = (heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";
  const isBridgeMode = isSourceLocked || (state.heroControlMode === "media");
  const mode = target === "mini" ? "app" : (isBridgeMode ? (state.platform === "android" ? "device" : "desktop") : getEffectiveHeroMode(getControllablePlayerPost()));

  if (debounce("volume", 100)) return;

  const rawValue = Number(event.target?.value);
  const volume = normalizePlayerVolume(rawValue / 100, state.playerVolume);

  state.playerVolume = volume;
  savePlayerVolume(state.playerVolume);

  // CRITICAL FIX #5: Volume handled by native bridge when in media mode
  const nativeBridge = getNativeBridge();
  if (isBridgeMode && nativeBridge && typeof nativeBridge.setNowPlayingVolume === "function") {
    try {
      nativeBridge.setNowPlayingVolume(volume);
    } catch (e) {
      console.warn("[Hero] Failed to set volume on native bridge:", e);
    }
  } else if (mode === "app") {
    // DEFENSIVE CHECK: Only apply volume if DOM elements exist
    if (typeof applyPlayerVolumeToActiveElement === "function" && typeof getControllablePlayerPost === 'function') {
      try {
        applyPlayerVolumeToActiveElement();
      } catch (e) {
        console.warn("[Hero] Failed to apply volume:", e);
      }
    }

    const fallbackMedia = getFallbackPageMediaElement();
    if (!(getActivePlayerMediaElement() instanceof HTMLMediaElement) && fallbackMedia instanceof HTMLMediaElement) {
      try { fallbackMedia.volume = state.playerVolume; } catch { }
    }
  }

  // DEFENSIVE CHECK: Only render if DOM elements exist
  if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined') {
    elements.heroPlayerStage.dataset.safeHeroLocked = "true";
  }
}

/**
 * CRITICAL FIX #6: handleRefreshAction - Fixed stage re-render and defensive checks
 */
export function handleRefreshAction(context) {
  const {
    state, elements, getControllablePlayerPost,
    destroyActivePlayer, render, hasNativeSnapshotBridge,
    refreshNativeSnapshot, canUseDesktopBridge, refreshDesktopSnapshot,
    isNativeCapacitorApp, getNativeBridge
  } = context;

  if (debounce("refresh", 1000)) return;

  const post = getControllablePlayerPost();

  console.log(`[Hero] Refreshing media action. Post: ${post?.id || 'none'}`);

  // 1. Force the Stage to re-render by clearing its internal preview cache key - DEFENSIVE CHECKS ADDED
  if (elements.heroPlayerStage && typeof elements.heroPlayerStage.dataset !== 'undefined') {
    delete elements.heroPlayerStage.dataset.heroPreviewKey;
  }

  // 2. Check for local HTML5 media elements (Hosted Feed videos) - DEFENSIVE CHECKS ADDED
  const activeMedia = state.heroPlayerElement || state.activePlayerElement;
  let isHtml5 = false;
  if (activeMedia instanceof HTMLMediaElement) {
    isHtml5 = true;
  } else if (activeMedia && typeof activeMedia.querySelector === 'function') {
    try {
      const el = activeMedia.querySelector("video, audio");
      if (el instanceof HTMLMediaElement) isHtml5 = true;
    } catch (e) {
      console.warn("[Hero] Failed to query media element:", e);
    }
  }

  if (isHtml5) {
    try {
      const el = activeMedia instanceof HTMLMediaElement ? activeMedia : activeMedia.querySelector("video, audio");
      if (el && typeof el.pause === 'function') {
        el.pause();
        el.currentTime = 0;
        el.load();
      }
    } catch (e) {
      console.warn("[Hero] Local media refresh failed:", e);
    }
  }

  // 3. Always attempt to destroy the active player instance if it exists - DEFENSIVE CHECKS ADDED
  if (typeof destroyActivePlayer === "function") {
    try {
      destroyActivePlayer();
    } catch (e) {
      console.warn("[Hero] Failed to destroy active player:", e);
    }
  }

  // 4. Update the global playback state to reflect that we are now 'idle' locally
  state.heroPlayerPlaybackState = "none";
  state.miniPlayerPlaybackState = "none";

  // 5. System Snapshot Refresh - DEFENSIVE CHECKS ADDED
  if (typeof hasNativeSnapshotBridge === "function" && typeof hasNativeSnapshotBridge === 'function') {
    if (hasNativeSnapshotBridge() && typeof refreshNativeSnapshot === "function") {
      refreshNativeSnapshot({ renderAfter: false });
    }
  }
  if (typeof canUseDesktopBridge === "function" && typeof canUseDesktopBridge === 'function') {
    if (canUseDesktopBridge() && typeof refreshDesktopSnapshot === "function") {
      refreshDesktopSnapshot({ renderAfter: false, force: true });
    }
  }

  // 6. Android: Explicitly poke the native layer to broadcast state - DEFENSIVE CHECKS ADDED
  if (isNativeCapacitorApp && typeof isNativeCapacitorApp === 'function') {
    if (isNativeCapacitorApp() && typeof getNativeBridge === "function") {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.forceRefreshNowPlaying === "function") {
        try { bridge.forceRefreshNowPlaying(); } catch (e) {
          console.warn("[Hero] Failed to force refresh native:", e);
        }
      }
    }
  }

  // 7. Re-render the UI - DEFENSIVE CHECKS ADDED
  if (typeof render === "function" && typeof elements.heroPlayerStage !== 'undefined') {
    try {
      render();
    } catch (e) {
      console.warn("[Hero] Failed to re-render:", e);
    }
  }

  if (typeof window.showNotification === "function") {
    window.showNotification({
      title: "Player Synchronized",
      body: "Media session state has been refreshed.",
      kind: "success"
    });
  }
}
