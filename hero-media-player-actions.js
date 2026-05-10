/**
 * Hero Media Player Actions
 * Isolated handler for specialized media operations like "Open Media", "Open Phone",
 * and System Media control (Play/Pause, Next, Previous).
 */

/**
 * Throttles high-frequency actions to prevent hardware/bridge flooding.
 * @param {Object} state The global app state
 * @param {string} actionName Descriptive name for logging
 * @param {number} cooldownLimit Threshold in milliseconds
 * @returns {boolean} True if throttled
 */
export function debounceAction(state, actionName, cooldownLimit = 500) {
  const now = Date.now();
  if (state._lastActionAt && (now - state._lastActionAt < cooldownLimit)) {
    console.warn(`[Hero] Action "${actionName}" is throttled.`);
    return true;
  }
  state._lastActionAt = now;
  return false;
}

const ActionCache = new Map();

/**
 * Simple memoization helper for expensive lookups or repeated calls within an action.
 */
export function memoGet(key, factory, ttl = 1000) {
  const now = Date.now();
  const entry = ActionCache.get(key);
  if (entry && (now - entry.timestamp < ttl)) return entry.value;
  const value = factory();
  ActionCache.set(key, { value, timestamp: now });
  return value;
}

export function handleOpenMediaAction(context) {
  const {
    isNativeCapacitorApp, openViewer, desktopSnapshot, nativeSnapshot,
    performDesktopAction, parseYouTubeUrl, state, findMatchedPost,
    getControllablePlayerPost, getEffectiveHeroMode, getNativeBridge
  } = context;

  if (debounceAction(state, "open_media", 800)) return;

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
  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
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
    const actAsYouTube = (prefersYouTube && (systemIsYouTube || !systemIsSpotify)) || (systemIsYouTube && !prefersSpotify);
    const actAsSpotify = (prefersSpotify && (systemIsSpotify || !systemIsYouTube)) || (systemIsSpotify && !prefersYouTube);

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

  // 1. Android Native App -> "Open PC" Action
  if (isNativeCapacitorApp()) {
    const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

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
    const source = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
    
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

export function handlePlayPauseAction(context, forcePlay) {
  const {
    state, elements, getControllablePlayerPost, heroMode,
    render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PLAY_PAUSE, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp,
    companionPromptDismissed, showCompanionPrompt, normalizePlaybackState,
    getDesktopSnapshotSignature, toggleLocalPlayback,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    playHeroMedia, getNativeBridge, target
  } = context;

  // 1. Context Resolution
  const mode = target === "mini" ? "app" : heroMode;
  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  
  // Memoized post resolution to minimize state lookups during rapid clicks
  const controllablePost = memoGet(`play_pause_post_${target}`, () => {
    const activeId = target === "mini" ? (state.activePlayerPostId || state.playerPostId) : (state.heroPlayerPostId || state.activePlayerPostId);
    const post = (activeId && typeof context.getPostById === "function") ? context.getPostById(activeId) : null;
    return post || getControllablePlayerPost();
  }, 50);

  // 2. Hardware-Friendly Throttling
  if (debounceAction(state, "play_pause", mode === "device" ? 500 : 400)) return;

  console.log(`[Hero] Play/Pause Action. Mode: ${mode}, Source: ${preferredSource}, Target: ${target}`);

  // 3. Local Priority: Control active website media elements (Videos/Audios)
  if (typeof toggleLocalPlayback === "function") {
    if (toggleLocalPlayback(forcePlay, { target })) {
      render();
      return;
    }
  }

  // 4. App Mode: Mount or resume the local player stage
  if (mode === "app") {
    if (target === "mini" && state.playerPostId) {
      const p = (typeof context.getPostById === "function") ? context.getPostById(state.playerPostId) : null;
      if (p && typeof context.mountPersistentPlayer === "function") {
        context.mountPersistentPlayer(elements.miniPlayerStage, p, "mini", { autoplay: true });
        state.miniPlayerPlaybackState = "playing";
      }
    } else if (typeof playHeroMedia === "function") {
      playHeroMedia();
    }
    render();
    return;
  }

  // 5. System Bridge: Desktop / Native Device Control
  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  
  // Parse session metadata for source isolation
  const app = (snapshot?.appPackage || "").toLowerCase();
  const meta = (snapshot?.meta || "").toLowerCase();
  const title = (snapshot?.title || "").toLowerCase();
  
  const isSpotify = app.includes("spotify") || meta.includes("spotify") || title.includes("spotify");
  const isYouTube = app.includes("youtube") || app.includes("ytmusic") || meta.includes("youtube") || title.includes("youtube") || title.includes("ytmusic");

  // Enforce the "Media Toggle" Source Isolation rules
  let sourceMismatch = false;
  if (preferredSource === "youtube" && isSpotify && !isYouTube) {
    sourceMismatch = true;
    console.log("[Hero] YouTube Mode active: Ignoring system Spotify session.");
  } else if (preferredSource === "spotify" && isYouTube && !isSpotify) {
    sourceMismatch = true;
    console.log("[Hero] Spotify Mode active: Ignoring system YouTube session.");
  }

  // Local Fallback: If system is idle or has wrong source, try to play the local post
  const isSystemIdle = !snapshot?.active || sourceMismatch;
  
  console.log(`[Hero] Play/Pause Trace: Active=${snapshot?.active}, Idle=${isSystemIdle}, Mismatch=${sourceMismatch}, Source=${preferredSource}, System=${app}|${title}`);

  if (isSystemIdle && controllablePost) {
    const isCompatible = (preferredSource === "all" || !preferredSource) 
      || (controllablePost.sourceKind === preferredSource)
      || (controllablePost.sourceKind === "hosted");

    if (isCompatible && typeof playHeroMedia === "function" && target !== "mini") {
      console.log(`[Hero] Redirecting to local ${controllablePost.sourceKind} player.`);
      playHeroMedia();
      render();
      return;
    }
  }

  // If mismatch detected and no local player could wake up, block the command
  if (sourceMismatch) {
    render();
    return;
  }

  // 6. Final Execution via Bridge
  if (mode === "desktop") {
    // If we don't have a snapshot yet, try a blind command if the bridge is likely available
    if (!desktopSnapshot) {
      if (!isNativeCapacitorApp() && !companionPromptDismissed) {
        if (typeof showCompanionPrompt === "function") showCompanionPrompt();
        return;
      }
      console.log("[Hero] Sending blind Play/Pause bridge command.");
      performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
      render();
      return;
    }
    
    // Optimistic UI update: predict next playback state
    const currentStatus = normalizePlaybackState(desktopSnapshot.playbackState);
    const nextStatus = (typeof forcePlay === "boolean") ? (forcePlay ? "playing" : "paused") : (currentStatus === "playing" ? "paused" : "playing");

    if (typeof setDesktopSnapshot === "function") {
      const updated = { ...desktopSnapshot, active: true, playbackState: nextStatus };
      setDesktopSnapshot(updated);
      if (typeof setDesktopSnapshotSignature === "function") setDesktopSnapshotSignature(getDesktopSnapshotSignature(updated));
    }
    performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
  } else if (mode === "device") {
    if (nativeSnapshot?.permissionRequired) {
      if (typeof getNativeBridge === "function") getNativeBridge()?.openNowPlayingAccessSettings();
      return;
    }
    
    if (!nativeSnapshot) {
      console.log("[Hero] Sending blind Play/Pause native command.");
      performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
      render();
      return;
    }

    const currentStatus = normalizePlaybackState(nativeSnapshot.playbackState);
    const nextStatus = (typeof forcePlay === "boolean") ? (forcePlay ? "playing" : "paused") : (currentStatus === "playing" ? "paused" : "playing");

    if (typeof setNativeSnapshot === "function") {
      setNativeSnapshot({ ...nativeSnapshot, active: true, playbackState: nextStatus });
    }
    performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
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
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target
  } = context;

  const mode = target === "mini" ? "app" : heroMode;

  // Identify the best post for this interaction
  const activePostId = target === "mini" ? (state.activePlayerPostId || state.playerPostId) : (state.heroPlayerPostId || state.activePlayerPostId);
  const activePost = (activePostId && typeof context.getPostById === "function") ? context.getPostById(activePostId) : null;
  const controllablePost = activePost || getControllablePlayerPost();

  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  
  if (debounceAction(state, "previous", 500)) return;

  console.log(`[Hero] handlePrevious. Mode: ${mode}, Source: ${preferredSource}, Target: ${target || 'default'}`);

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
    render();
    return;
  }

  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  const appPkg = (snapshot?.appPackage || "").toLowerCase();
  const metaText = (snapshot?.meta || "").toLowerCase();
  const titleText = (snapshot?.title || "").toLowerCase();
  
  const systemIsSpotify = appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
  const systemIsYouTube = appPkg.includes("youtube") || appPkg.includes("ytmusic") 
    || metaText.includes("youtube") || metaText.includes("ytmusic")
    || titleText.includes("youtube") || titleText.includes("ytmusic");

  // Source Isolation & Local Fallback
  // If in an app mode or system is idle, prioritize local player stepping
  const isSystemIdle = mode === "app" || (mode === "desktop" ? !desktopSnapshot?.active : !nativeSnapshot?.active);
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";

  if (isSystemIdle || (isSourceLocked && preferredSource === "youtube" && systemIsSpotify && !systemIsYouTube)) {
    if (controllablePost) {
      if (target === "mini") {
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(-1);
      } else {
        if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
      }
      return;
    }
    if (isSystemIdle) return; // Nothing to step
  }

  if (isSourceLocked && preferredSource === "spotify" && systemIsYouTube && !systemIsSpotify) return;

  if (mode === "desktop") {
    if (desktopSnapshot && typeof setDesktopSnapshot === "function") {
      const updated = { ...desktopSnapshot, active: true, playbackState: "playing" };
      setDesktopSnapshot(updated);
      if (typeof setDesktopSnapshotSignature === "function") setDesktopSnapshotSignature(getDesktopSnapshotSignature(updated));
    }
    performDesktopAction(DESKTOP_ACTION_PREVIOUS);
  } else if (mode === "device") {
    if (nativeSnapshot && typeof setNativeSnapshot === "function") {
      setNativeSnapshot({ ...nativeSnapshot, active: true, playbackState: "playing" });
    }
    performNativeAction(NATIVE_ACTION_PREVIOUS);
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
    ensureControllablePost, stepMiniPlayer, mountPersistentPlayer, target
  } = context;

  const mode = target === "mini" ? "app" : heroMode;

  // Identify the best post for this interaction
  const activePostId = target === "mini" ? (state.activePlayerPostId || state.playerPostId) : (state.heroPlayerPostId || state.activePlayerPostId);
  const activePost = (activePostId && typeof context.getPostById === "function") ? context.getPostById(activePostId) : null;
  const controllablePost = activePost || getControllablePlayerPost();

  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

  if (debounceAction(state, "next", 500)) return;

  console.log(`[Hero] handleNext. Mode: ${mode}, Source: ${preferredSource}, Target: ${target || 'default'}`);

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
    render();
    return;
  }

  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  const appPkg = (snapshot?.appPackage || "").toLowerCase();
  const metaText = (snapshot?.meta || "").toLowerCase();
  const titleText = (snapshot?.title || "").toLowerCase();
  const systemIsSpotify = appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
  const systemIsYouTube = appPkg.includes("youtube") || appPkg.includes("ytmusic") 
    || metaText.includes("youtube") || metaText.includes("ytmusic")
    || titleText.includes("youtube") || titleText.includes("ytmusic");

  // Source Isolation & Local Fallback
  // If in an app mode or system is idle, prioritize local player stepping
  const isSystemIdle = mode === "app" || (mode === "desktop" ? !desktopSnapshot?.active : !nativeSnapshot?.active);
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";

  if (isSystemIdle || (isSourceLocked && preferredSource === "youtube" && systemIsSpotify && !systemIsYouTube)) {
    if (controllablePost) {
      if (target === "mini") {
        if (typeof stepMiniPlayer === "function") stepMiniPlayer(1);
      } else {
        if (typeof stepHeroPlayer === "function") stepHeroPlayer(1);
      }
      return;
    }
    if (isSystemIdle) return; // Nothing to step
  }

  if (isSourceLocked && preferredSource === "spotify" && systemIsYouTube && !systemIsSpotify) return;

  if (mode === "desktop") {
    if (desktopSnapshot && typeof setDesktopSnapshot === "function") {
      const updated = { ...desktopSnapshot, active: true, playbackState: "playing" };
      setDesktopSnapshot(updated);
      if (typeof setDesktopSnapshotSignature === "function") setDesktopSnapshotSignature(getDesktopSnapshotSignature(updated));
    }
    performDesktopAction(DESKTOP_ACTION_NEXT);
  } else if (mode === "device") {
    if (nativeSnapshot && typeof setNativeSnapshot === "function") {
      setNativeSnapshot({ ...nativeSnapshot, active: true, playbackState: "playing" });
    }
    performNativeAction(NATIVE_ACTION_NEXT);
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

  const mode = target === "mini" ? "app" : getEffectiveHeroMode(getControllablePlayerPost());

  if (debounceAction(state, "volume", 100)) return;

  const rawValue = Number(event.target?.value);
  const volume = normalizePlayerVolume(rawValue / 100, state.playerVolume);

  state.playerVolume = volume;
  savePlayerVolume(state.playerVolume);

  if (mode === "device") {
    const bridge = getNativeBridge();
    if (bridge && typeof bridge.setNowPlayingVolume === "function") {
      bridge.setNowPlayingVolume(volume);
    }
  } else if (mode === "desktop") {
    // Unsupported
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

  if (debounceAction(state, "refresh", 1000)) return;

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
