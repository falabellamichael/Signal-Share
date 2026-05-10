/**
 * Hero Media Player Actions
 * Isolated handler for specialized media operations like "Open Media" and "Open Phone".
 */

export function handleOpenMediaAction(post, context) {
  const { isNativeCapacitorApp, openViewer, desktopSnapshot, performDesktopAction, parseYouTubeUrl, state } = context;

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

export function handleOpenPhoneAction(post, context) {
  const { isNativeCapacitorApp, state, performDesktopAction, parseYouTubeUrl } = context;

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
  const bridge = window.NativeBridge;
  if (bridge && typeof bridge.openNowPlayingMediaApp === "function") {
    // If we have a specific post (either passed in or from state), try to open its URI
    const targetPost = post || (typeof context.getControllablePlayerPost === "function" ? context.getControllablePlayerPost() : null);

    if (targetPost) {
      // We have a post, so try to open it explicitly
      handleOpenMediaAction(targetPost, context);
      return;
    }

    // Otherwise, open the last active media app on the phone without an explicit URI
    bridge.openNowPlayingMediaApp("", "", false);
    return;
  }

  // Cross-Device Handoff: PC -> Phone (via Supabase)
  if (state.supabase && state.currentUser?.id && typeof context.performSupabaseDesktopAction === "function") {
    const targetPost = post || (typeof context.getControllablePlayerPost === "function" ? context.getControllablePlayerPost() : null);
    
    let uri = "";
    if (targetPost) {
      uri = targetPost.externalUrl || targetPost.embedUrl || targetPost.src;
    }

    // Fallback to source-specific landing pages if no post
    if (!uri) {
      const source = (state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "").toLowerCase();
      if (source === "spotify") uri = "spotify:";
      if (source === "youtube") uri = "https://www.youtube.com";
    }

    if (uri) {
      console.log(`[Hero] Sending remote open command to phone. URI: ${uri}`);
      context.performSupabaseDesktopAction("open_uri", { uri });
      
      if (typeof window.showNotification === "function") {
        window.showNotification({
          title: "Cross-device handoff",
          body: "Opening content on your phone...",
          kind: "info"
        });
      }
      return;
    }
  }

  // Final fallback: attempt local open
  const isSpotify = post?.sourceKind === "spotify";
  if (isSpotify) {
    const spotifyUri = "spotify:";
    if (typeof window.Capacitor !== "undefined" && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.openUrl({ url: spotifyUri });
    } else {
      window.open(spotifyUri, "_system");
    }
  } else {
    handleOpenMediaAction(post, context);
  }
}
