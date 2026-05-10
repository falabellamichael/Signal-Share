/**
 * Hero Media Player Actions
 * Isolated handler for specialized media operations like "Open Media", "Open Phone",
 * and System Media control (Play/Pause, Next, Previous).
 */

export function handleOpenMediaAction(context) {
  const {
    isNativeCapacitorApp, openViewer, desktopSnapshot, nativeSnapshot,
    performDesktopAction, parseYouTubeUrl, state, findMatchedPost,
    getControllablePlayerPost, getEffectiveHeroMode
  } = context;

  const controllablePost = getControllablePlayerPost();
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
    NATIVE_ACTION_PLAY_PAUSE, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PLAY_PAUSE, isNativeCapacitorApp,
    companionPromptDismissed, showCompanionPrompt, normalizePlaybackState,
    getDesktopSnapshotSignature, toggleLocalPlayback,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    playHeroMedia, getNativeBridge, target
  } = context;

  const mode = target === "mini" ? "app" : heroMode;

  // Resolve the most relevant post for the current target.
  // Priority: explicitly active player post, then general controllable post.
  const activePostId = target === "mini" ? (state.activePlayerPostId || state.playerPostId) : (state.heroPlayerPostId || state.activePlayerPostId);
  const activePost = (activePostId && typeof context.getPostById === "function") ? context.getPostById(activePostId) : null;
  const controllablePost = activePost || getControllablePlayerPost();

  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

  console.log(`[Hero] handlePlayPause. Mode: ${mode}, Source: ${preferredSource}, Target: ${target || 'default'}, Post: ${controllablePost?.id || 'none'}`);

  // 1. Cooldown Protection
  const now = Date.now();
  const cooldownLimit = (mode === "device" ? NATIVE_ACTION_COOLDOWN_MS : 500) || 500;
  if (state._lastPlayPauseAt && (now - state._lastPlayPauseAt < cooldownLimit)) {
    console.warn("[Hero] Action throttled.");
    return;
  }
  state._lastPlayPauseAt = now;

  // 2. High Priority: Local Player control
  if (typeof toggleLocalPlayback === "function") {
    const handled = toggleLocalPlayback(forcePlay, { target });
    if (handled) {
      render();
      return;
    }
  }

  // 3. App Mode: Initial Mount
  if (mode === "app") {
    if (target !== "mini" && typeof playHeroMedia === "function") {
      playHeroMedia();
    } else if (target === "mini" && state.playerPostId) {
      const post = (typeof context.getPostById === "function") ? context.getPostById(state.playerPostId) : null;
      if (post && typeof context.mountPersistentPlayer === "function") {
        context.mountPersistentPlayer(elements.miniPlayerStage, post, "mini", { autoplay: true });
        state.miniPlayerPlaybackState = "playing";
      }
    }
    render();
    return;
  }

  // 4. System Source Isolation
  const snapshot = mode === "desktop" ? desktopSnapshot : (mode === "device" ? nativeSnapshot : null);
  const appPkg = (snapshot?.appPackage || "").toLowerCase();
  const metaText = (snapshot?.meta || "").toLowerCase();
  const titleText = (snapshot?.title || "").toLowerCase();
  
  const systemIsSpotify = appPkg.includes("spotify") || metaText.includes("spotify") || titleText.includes("spotify");
  const systemIsYouTube = appPkg.includes("youtube") || appPkg.includes("ytmusic") 
    || metaText.includes("youtube") || metaText.includes("ytmusic")
    || titleText.includes("youtube") || titleText.includes("ytmusic");

  let isWrongSystemSource = false;

  // Only isolate sources if the user has explicitly selected a source and we are in a media-centric mode
  const isSourceLocked = preferredSource === "youtube" || preferredSource === "spotify";

  if (isSourceLocked) {
    if (preferredSource === "youtube" && systemIsSpotify && !systemIsYouTube) {
      isWrongSystemSource = true;
      console.log(`[Hero] YouTube mode active: Ignoring Spotify session (${appPkg}).`);
    } else if (preferredSource === "spotify" && systemIsYouTube && !systemIsSpotify) {
      isWrongSystemSource = true;
      console.log(`[Hero] Spotify mode active: Ignoring YouTube session (${titleText}).`);
    }
  }

  const isSystemActive = !isWrongSystemSource && (mode === "desktop" ? Boolean(desktopSnapshot?.active) : Boolean(nativeSnapshot?.active));
  console.log(`[Hero] Play/Pause Trace: Source=${preferredSource}, SystemIsYT=${systemIsYouTube}, SystemIsSpotify=${systemIsSpotify}, Active=${isSystemActive}`);

  // 5. Local Redirection: If system is wrong or idle, but we have a matching local video
  if (isWrongSystemSource || !isSystemActive) {
    // If locked to a source, allow local redirection to that source OR any hosted feed content.
    // Also ALLOW any post if it was explicitly selected by the user (target is mini).
    const isCompatibleLocalPost = (preferredSource === "all") || (target === "mini") || (controllablePost?.sourceKind === preferredSource) || (controllablePost?.sourceKind === "hosted");

    if (controllablePost && isCompatibleLocalPost) {
      if (target !== "mini" && typeof playHeroMedia === "function") {
        console.log(`[Hero] Redirecting to local ${controllablePost.sourceKind} player.`);
        playHeroMedia();
        render();
        return;
      }
    }
  }

  if (isWrongSystemSource) {
    render();
    return;
  }


  // 6. Bridge Commands
  if (mode === "desktop") {
    if (!isNativeCapacitorApp() && !desktopSnapshot && !companionPromptDismissed) {
      if (typeof showCompanionPrompt === "function") showCompanionPrompt();
      return;
    }

    const playbackStatus = normalizePlaybackState(desktopSnapshot?.playbackState);
    const nextPlaybackState = (typeof forcePlay === "boolean") ? (forcePlay ? "playing" : "paused") : (playbackStatus === "playing" ? "paused" : "playing");

    if (desktopSnapshot && typeof setDesktopSnapshot === "function") {
      const updated = { ...desktopSnapshot, active: true, playbackState: nextPlaybackState };
      setDesktopSnapshot(updated);
      if (typeof setDesktopSnapshotSignature === "function" && typeof getDesktopSnapshotSignature === "function") {
        setDesktopSnapshotSignature(getDesktopSnapshotSignature(updated));
      }
    }
    performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
  } else if (mode === "device") {
    if (nativeSnapshot?.permissionRequired && typeof context.getNativeBridge === "function") {
      try { context.getNativeBridge().openNowPlayingAccessSettings(); } catch { }
      return;
    }
    const playbackStatus = normalizePlaybackState(nativeSnapshot?.playbackState);
    const nextPlaybackState = (typeof forcePlay === "boolean") ? (forcePlay ? "playing" : "paused") : (playbackStatus === "playing" ? "paused" : "playing");
    if (nativeSnapshot && typeof setNativeSnapshot === "function") {
      setNativeSnapshot({ ...nativeSnapshot, active: true, playbackState: nextPlaybackState });
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
  
  console.log(`[Hero] handlePrevious. Mode: ${mode}, Source: ${preferredSource}, Target: ${target || 'default'}`);

  // Cooldown to prevent double-skipping glitches
  const now = Date.now();
  if (state._lastStepAt && (now - state._lastStepAt < 500)) {
    console.warn("[Hero] Step throttled.");
    return;
  }
  state._lastStepAt = now;

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
  const systemIsSpotify = appPkg.includes("spotify") || metaText.includes("spotify");
  const systemIsYouTube = appPkg.includes("youtube") || metaText.includes("youtube") || titleText.includes("youtube");

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

  console.log(`[Hero] handleNext. Mode: ${mode}, Source: ${preferredSource}, Target: ${target || 'default'}`);

  // Cooldown to prevent double-skipping glitches
  const now = Date.now();
  if (state._lastStepAt && (now - state._lastStepAt < 500)) {
    console.warn("[Hero] Step throttled.");
    return;
  }
  state._lastStepAt = now;

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
  const systemIsSpotify = appPkg.includes("spotify") || metaText.includes("spotify");
  const systemIsYouTube = appPkg.includes("youtube") || metaText.includes("youtube") || titleText.includes("youtube");

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
