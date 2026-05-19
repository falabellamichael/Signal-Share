/**
 * Hero Media Player Actions
 * Isolated handler for specialized media operations like "Open Media", "Open Phone",
 * and System Media control (Play/Pause, Next, Previous).
 */
import { debounce, memoGet } from './shared-utils.js';

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
  // We prioritize heroControlSource as the canonical media player toggle.
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
        return;
      }
      targetUrl = "spotify:";
    }
  }

  if (!targetUrl) {
    console.error("handleOpenMediaAction: Could not resolve target URL.", { post, desktopSnapshot });
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
  const { isNativeCapacitorApp, state, performDesktopAction, getControllablePlayerPost } = context;
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

  return;
}

export async function handlePlayPauseAction(context, forcePlay) {
  const {
    state, elements, getControllablePlayerPost, heroMode,
    render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PLAY_PAUSE, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp,
    companionPromptDismissed, showCompanionPrompt,
    toggleLocalPlayback, playHeroMedia, getNativeBridge, target,
    getActivePlayerMediaElement, normalizePlaybackState
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

  // FIX FOR MEDIA TOGGLE MODE: Always use bridge when in media mode, regardless of source lock state
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

    // FIX FOR MEDIA TOGGLE MODE: If we're in media mode, check if anything is playing on system regardless of source lock
    const isMediaModeActive = isBridgeMode && snapshot?.playbackState !== "none";
    
    // Determine if the *system* should be controlling playback: it must be playing, and either we are not locked OR the lock matches what's playing.
    // For bridge mode (media toggle), we check if system has any activity
    const isPlayingOnSystem = snapshot?.playbackState === "playing" && (!isSourceLocked || sourceMatchesLock || isMediaModeActive);
    shouldPlay = (typeof forcePlay === "boolean") ? forcePlay : !isPlayingOnSystem;
  }

  console.log(`[Hero] Intent: ${shouldPlay ? "PLAY" : "PAUSE"} (Mode: ${mode}, Locked: ${preferredSource || 'none'}, Bridge Mode: ${isBridgeMode})`);

  // 4. OPTIMISTIC STATE UPDATE & INSTANT RENDER
  const nextState = shouldPlay ? "playing" : "paused";
  if (target === "mini") state.miniPlayerPlaybackState = nextState;
  else state.heroPlayerPlaybackState = nextState;

  render();

  // 5. COMMAND DISPATCH
  let handledLocally = false;

  // FIX: Always enable bridge command for Media Toggle Mode when in media mode
  const isBridgeActiveForMediaMode = isMediaMode && mode === "desktop" || isMediaMode && mode === "device";

  // A. Local Website Elements (Hosted videos, YouTube/Spotify Iframes)
  if (typeof toggleLocalPlayback === "function") {
    handledLocally = toggleLocalPlayback(shouldPlay, { target });
  }

  // B. Local Player Activation (If nothing was playing locally but user pressed Play)
  if (!handledLocally && shouldPlay && mode === "app") {
    if (target === "mini" && state.playerPostId) {
      const p = (typeof context.getPostById === "function") ? context.getPostById(state.playerPostId) : null;
      if (p && typeof context.mountPersistentPlayer === "function") {
        context.mountPersistentPlayer(elements.miniPlayerStage, p, "mini", { autoplay: true });
        handledLocally = true;
      }
    } else if (typeof playHeroMedia === "function") {
      playHeroMedia(shouldPlay);
      handledLocally = true;
    }
  }

  // C. Bridge Commands
  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  


  if (sendToBridge) {
    try {
      if (mode === "desktop") {
        if (!isNativeCapacitorApp() && !companionPromptDismissed && !desktopSnapshot) {
          if (shouldPlay && typeof showCompanionPrompt === "function") showCompanionPrompt();
        } else {
          await performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
        }
      } else if (mode === "device") {
        if (nativeSnapshot?.permissionRequired) {
          if (shouldPlay && typeof getNativeBridge === "function") getNativeBridge()?.openNowPlayingAccessSettings();
        } else {
          performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
        }
      }

      // Refresh immediately after bridge action to show updated state
      if (typeof refreshDesktopSnapshot === "function") refreshDesktopSnapshot({ force: true, renderAfter: true });
      if (typeof refreshNativeSnapshot === "function") refreshNativeSnapshot({ renderAfter: true });
    } catch (error) {
      console.warn("[Hero] Bridge action failed:", error);
    }

    // Final Measure: If we are 'Pausing' on the bridge, ensure local is also stopped
    if (!shouldPlay && typeof toggleLocalPlayback === "function") {
      toggleLocalPlayback(false, { target });
    }
  }

  render();
}





export function handlePreviousAction(context) {
  const {
    state, elements, render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PREVIOUS, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PREVIOUS,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, heroMode,
    getDesktopSnapshotSignature, stepHeroPlayer,
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target,
    isNativeCapacitorApp
  } = context;

  if (debounce("previous", 500)) return;

  const now = Date.now();
  state._mediaActionLockoutUntil = now + 0;

  // Mode Resolution
  const isFeedMode = state.heroControlMode === "feed";
  const isMediaMode = state.heroControlMode === "media";
  const mode = target === "mini" ? "app" : (isFeedMode ? "app" : (isMediaMode ? (isNativeCapacitorApp() ? "device" : "desktop") : heroMode));

  console.log(`[Hero] handlePrevious. Mode: ${mode}, Target: ${target || 'hero'}`);

  if (mode === "app") {
    if (target === "mini") {
      if (typeof ensureControllablePost === "function" && ensureControllablePost()) {
        const wasPlaying = state.miniPlayerPlaybackState === "playing";
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(-1);
        const post = getControllablePlayerPost();
        if (post && typeof mountPersistentPlayer === "function") {
          mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: wasPlaying });
        }
      }
    } else {
      if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
      if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
    }
  } else {
    // System state check with Source Isolation
    // FIX FOR MEDIA TOGGLE MODE: Add heroControlSource from context for consistency
    const hcSource = context.heroControlSource || state.heroControlSource;
    const preferredSource = (hcSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
    const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";
    
    // FIX FOR MEDIA TOGGLE MODE: Always use bridge when in media mode, regardless of source lock state
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
    // FIX FOR MEDIA TOGGLE MODE: When in media toggle mode, always send to bridge regardless of source lock state
    const shouldSendToBridge = isSourceLocked || systemIsSpotify || systemIsYouTube || isMediaMode || mode === "desktop" || mode === "device";

    if (!shouldSendToBridge) {
      // Fallback to local feed stepping
      if (target === "mini") {
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(-1);
      } else {
        if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
      }
    } else {
      // FIX FOR MEDIA TOGGLE MODE: Always send to bridge when in media mode, regardless of source lock state
      if (shouldSendToBridge) {
        const isDesktop = true;
        if (isDesktop) performDesktopAction(DESKTOP_ACTION_PREVIOUS);
        else performNativeAction(NATIVE_ACTION_PREVIOUS);
      }

      // Refresh immediately after bridge action
      if (typeof refreshDesktopSnapshot === "function") refreshDesktopSnapshot({ force: true, renderAfter: true });
      if (typeof refreshNativeSnapshot === "function") refreshNativeSnapshot({ renderAfter: true });
    }
  }

  render();
}


export function handleNextAction(context) {
  const {
    state, elements, render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_NEXT, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_NEXT,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, heroMode,
    getDesktopSnapshotSignature, stepHeroPlayer,
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target,
    isNativeCapacitorApp
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
  
  // FIX FOR MEDIA TOGGLE MODE: Always use bridge when in media mode
  const isBridgeMode = isSourceLocked || isMediaMode;
  const mode = target === "mini" ? "app" : (isFeedMode ? "app" : (isMediaMode ? (isNativeCapacitorApp() ? "device" : "desktop") : heroMode));

  console.log(`[Hero] handleNext. Mode: ${mode}, Target: ${target || 'hero'}`);

  if (mode === "app") {
    if (target === "mini") {
      if (typeof ensureControllablePost === "function" && ensureControllablePost()) {
        const wasPlaying = state.miniPlayerPlaybackState === "playing";
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(1);
        const post = getControllablePlayerPost();
        if (post && typeof mountPersistentPlayer === "function") {
          mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: wasPlaying });
        }
      }
    } else {
      if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
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
    // FIX FOR MEDIA TOGGLE MODE: When in media toggle mode, always send to bridge regardless of source lock state
    const shouldSendToBridge = isSourceLocked || systemIsSpotify || systemIsYouTube || isMediaMode || mode === "desktop" || mode === "device";

    if (!shouldSendToBridge) {
      // Fallback to local feed stepping
      if (target === "mini") {
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(1);
      } else {
        if (typeof stepHeroPlayer === "function") stepHeroPlayer(1);
      }
    } else {
      // FIX FOR MEDIA TOGGLE MODE: Always send to bridge when in media mode, regardless of source lock state
      if (shouldSendToBridge) {
        const isDesktop = true;
        if (isDesktop) performDesktopAction(DESKTOP_ACTION_NEXT);
        else performNativeAction(NATIVE_ACTION_NEXT);
      }

      // Refresh immediately after bridge action
      if (typeof refreshDesktopSnapshot === "function") refreshDesktopSnapshot({ force: true, renderAfter: true });
      if (typeof refreshNativeSnapshot === "function") refreshNativeSnapshot({ renderAfter: true });
    }
  }

  render();
}


export function handleVolumeAction(context, event) {
  const {
    state, getControllablePlayerPost, getEffectiveHeroMode,
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

  // FIX FOR MEDIA TOGGLE MODE: Volume handled by native bridge when in media mode
  const nativeBridge = getNativeBridge();
  if (isBridgeMode && nativeBridge && typeof nativeBridge.setNowPlayingVolume === "function") {
    nativeBridge.setNowPlayingVolume(volume);
  } else if (mode === "app") {
    if (typeof applyPlayerVolumeToActiveElement === "function") applyPlayerVolumeToActiveElement();
    const fallbackMedia = getFallbackPageMediaElement();
    if (!(getActivePlayerMediaElement() instanceof HTMLMediaElement) && fallbackMedia instanceof HTMLMediaElement) {
      try { fallbackMedia.volume = state.playerVolume; } catch { }
    }
  }
  render();
}

/**
 * Hard-refreshes the current media player and system status.
 * For local videos: calls .load() and .play()
 * For YouTube/Spotify: re-mounts the player stage to fix stuck streams.
 * Also forces a refresh of system media snapshots.
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

  // 1. Force the Stage to re-render by clearing its internal preview cache key
  if (elements.heroPlayerStage) {
    delete elements.heroPlayerStage.dataset.heroPreviewKey;
  }

  // 2. Check for local HTML5 media elements (Hosted Feed videos)
  const activeMedia = state.heroPlayerElement || state.activePlayerElement;
  const isHtml5 = activeMedia instanceof HTMLMediaElement || (activeMedia && activeMedia.querySelector("video, audio"));

  if (isHtml5) {
    try {
      const el = activeMedia instanceof HTMLMediaElement ? activeMedia : activeMedia.querySelector("video, audio");
      el.pause();
      el.currentTime = 0;
      el.load();
      // No .play() here to satisfy "stay on the previews not play it"
    } catch (e) {
      console.warn("[Hero] Local media refresh failed:", e);
    }
  }

  // 3. Always attempt to destroy the active player instance if it exists.
  // This effectively resets YouTube/Spotify back to their preview card state
  // and ensures any background audio or stuck iframes are cleared.
  if (typeof destroyActivePlayer === "function") {
    destroyActivePlayer();
  }

  // 4. Update the global playback state to reflect that we are now 'idle' locally
  state.heroPlayerPlaybackState = "none";
  state.miniPlayerPlaybackState = "none";

  // 5. System Snapshot Refresh
  if (typeof hasNativeSnapshotBridge === "function" && hasNativeSnapshotBridge()) {
    if (typeof refreshNativeSnapshot === "function") refreshNativeSnapshot({ renderAfter: false });
  }
  if (typeof canUseDesktopBridge === "function" && canUseDesktopBridge()) {
    if (typeof refreshDesktopSnapshot === "function") refreshDesktopSnapshot({ renderAfter: false, force: true });
  }

  // 6. Android: Explicitly poke the native layer to broadcast state
  if (isNativeCapacitorApp && isNativeCapacitorApp()) {
    if (typeof getNativeBridge === "function") {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.forceRefreshNowPlaying === "function") {
        bridge.forceRefreshNowPlaying();
      }
    }
  }

  // 7. Re-render the UI
  render();

  if (typeof window.showNotification === "function") {
    window.showNotification({
      title: "Player Synchronized",
      body: "Media session state has been refreshed.",
      kind: "success"
    });
  }
}
