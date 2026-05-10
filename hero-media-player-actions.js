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
  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
  const prefersYouTube = preferredSource === "youtube";
  const prefersSpotify = preferredSource === "spotify";

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

    const isSpotify = appPackage.includes("spotify") || meta.includes("spotify") || prefersSpotify;
    const isYouTube = appPackage.includes("youtube") || meta.includes("youtube") || title.includes("youtube") || prefersYouTube;

    if (isYouTube) {
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
    } else if (isSpotify && !prefersYouTube) {
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
  if (isNativeCapacitorApp()) {
    const bridge = window.NativeBridge;
    if (bridge && typeof bridge.openNowPlayingMediaApp === "function") {
      // Use the smarter native bridge which knows about the last active media app
      const isSpotify = targetUrl.startsWith("spotify:") || targetUrl.includes("spotify.com");
      const isYouTube = targetUrl.includes("youtube.com") || targetUrl.includes("youtu.be");
      
      const pkg = isSpotify ? "com.spotify.music" : (isYouTube ? "com.google.android.youtube" : "");
      bridge.openNowPlayingMediaApp(pkg, targetUrl, true);
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
    getDesktopSnapshotSignature, toggleLocalPlayback, getFallbackPageMediaElement,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    playHeroMedia, getNativeBridge
  } = context;

  const mode = heroMode;
  const controllablePost = getControllablePlayerPost();
  const preferredSource = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();

  console.log(`[Hero] handlePlayPause (Locked). Mode: ${mode}, Source: ${preferredSource}`);

  // 1. App Mode (Website Player Only)
  if (mode === "app") {
    const isHeroActive = state.heroPlayerPostId
      && !!state.heroPlayerElement
      && elements.heroPlayerStage.contains(state.heroPlayerElement);

    if (isHeroActive) {
      if (typeof toggleLocalPlayback === "function") toggleLocalPlayback(forcePlay);
    } else if (typeof playHeroMedia === "function") {
      playHeroMedia();
    }
    render();
    return;
  }

  // 2. System Media Modes (Locked to Bridge/Native)
  const isSystemActive = mode === "desktop" ? Boolean(desktopSnapshot?.active) : Boolean(nativeSnapshot?.active);

  // If the system media is idle but we have a matching preview, "Wake up" that specific content
  if (!isSystemActive && controllablePost && controllablePost.sourceKind === preferredSource) {
      const url = controllablePost.externalUrl || controllablePost.embedUrl || controllablePost.src || (controllablePost.externalId ? `https://www.youtube.com/watch?v=${controllablePost.externalId}` : "");

      if (url) {
          if (isNativeCapacitorApp()) {
              const bridge = getNativeBridge();
              if (bridge && typeof bridge.openNowPlayingMediaApp === "function") {
                  const pkg = preferredSource === "spotify" ? "com.spotify.music" : "com.google.android.youtube";
                  bridge.openNowPlayingMediaApp(pkg, url, true);
                  return;
              }
          } else {
              window.open(url, "_blank");
              return;
          }
      }
  }

  if (mode === "desktop") {
    if (!isNativeCapacitorApp() && !desktopSnapshot && !companionPromptDismissed) {
      if (typeof showCompanionPrompt === "function") showCompanionPrompt();
      return;
    }

    const playbackStatus = normalizePlaybackState(desktopSnapshot?.playbackState);
    const nextPlaybackState = playbackStatus === "playing" ? "paused" : "playing";

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

    const now = Date.now();
    if (now - (context.lastNativeActionAt || 0) < NATIVE_ACTION_COOLDOWN_MS) return;

    const playbackStatus = normalizePlaybackState(nativeSnapshot?.playbackState);
    const nextPlaybackState = playbackStatus === "playing" ? "paused" : "playing";

    if (nativeSnapshot && typeof setNativeSnapshot === "function") {
      setNativeSnapshot({ ...nativeSnapshot, active: true, playbackState: nextPlaybackState });
    }

    performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
  }

  render();
}

export function handlePreviousAction(context) {
  const {
    render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_PREVIOUS, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_PREVIOUS,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, getEffectiveHeroMode,
    getDesktopSnapshotSignature, stepHeroPlayer, elements
  } = context;

  const mode = getEffectiveHeroMode(getControllablePlayerPost());
  console.log(`[Hero] handlePrevious (Locked). Mode: ${mode}`);

  if (mode === "app") {
    if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
    if (typeof stepHeroPlayer === "function") stepHeroPlayer(-1);
  } else if (mode === "desktop") {
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
    render, nativeSnapshot, performNativeAction,
    NATIVE_ACTION_NEXT, NATIVE_ACTION_COOLDOWN_MS, desktopSnapshot,
    performDesktopAction, DESKTOP_ACTION_NEXT,
    setDesktopSnapshot, setNativeSnapshot, setDesktopSnapshotSignature,
    getControllablePlayerPost, getEffectiveHeroMode,
    getDesktopSnapshotSignature, stepHeroPlayer, elements
  } = context;

  const mode = getEffectiveHeroMode(getControllablePlayerPost());
  console.log(`[Hero] handleNext (Locked). Mode: ${mode}`);

  if (mode === "app") {
    if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
    if (typeof stepHeroPlayer === "function") stepHeroPlayer(1);
  } else if (mode === "desktop") {
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
    render
  } = context;

  const mode = getEffectiveHeroMode(getControllablePlayerPost());

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
