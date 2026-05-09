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
  const normalizeText = (value = "") => `${value || ""}`.trim().toLowerCase();
  const preferredSource = normalizeText(state?.heroControlSource || state?.heroMediaSource || state?.systemMediaSource || "");
  const prefersYouTube = preferredSource === "youtube";
  const prefersSpotify = preferredSource === "spotify";

  const resolveYouTubeUrl = (value) => {
    if (!value) return "";
    const sanitized = String(value).trim();

    if (typeof parseYouTubeUrl === "function") {
      const parsed = parseYouTubeUrl(sanitized);
      if (parsed?.externalId) return `https://www.youtube.com/watch?v=${parsed.externalId}`;
      if (parsed?.originalUrl) return parsed.originalUrl;
      if (parsed?.embedUrl) return parsed.embedUrl;
    }
    const idMatch = sanitized.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([A-Za-z0-9_-]{11})/i);
    if (idMatch) return `https://www.youtube.com/watch?v=${idMatch[1]}`;
    if (/^[A-Za-z0-9_-]{11}$/.test(sanitized)) return `https://www.youtube.com/watch?v=${sanitized}`;
    return sanitized.startsWith("http") ? sanitized : "";
  };

  const resolvePostYouTubeUrl = (postValue) => {
    if (!postValue) return "";
    if (postValue?.sourceKind === "youtube") {
      if (postValue.externalId) return `https://www.youtube.com/watch?v=${postValue.externalId}`;
      return resolveYouTubeUrl(postValue.externalUrl || postValue.src || postValue.mediaUrl);
    }
    return "";
  };

  // Resolve the primary target URL fallback
  let targetUrl = post?.externalUrl || post?.src;
  if (post?.sourceKind === "youtube" && post?.externalId) {
    targetUrl = `https://www.youtube.com/watch?v=${post.externalId}`;
  } else if (post?.sourceKind === "spotify") {
    targetUrl = "spotify:"; // Prioritize app URI for Spotify
  }

  // 1. "Feed Mode": If we have a Signal Share hosted post, open it in the viewer
  if (post && post.sourceKind === "hosted") {
    if (typeof openViewer === "function") {
      openViewer(post.id);
      return;
    }
  }

  // 2. "Desktop Mode": If we are controlling a PC, handle YouTube/Spotify specifically
  if (desktopSnapshot && desktopSnapshot.available) {
    const appPackage = (desktopSnapshot.appPackage || "").toLowerCase();
    const title = (desktopSnapshot.title || "").toLowerCase();
    const meta = (desktopSnapshot.meta || "").toLowerCase();

    const isSpotify = appPackage.includes("spotify") || meta.includes("spotify") || prefersSpotify;
    const isYouTube = appPackage.includes("youtube") || meta.includes("youtube") || title.includes("youtube") || prefersYouTube;
    const wantSpotify = prefersSpotify || (!isYouTube && isSpotify);
    const wantYouTube = prefersYouTube || isYouTube;

    if (wantSpotify && !wantYouTube) {
      // Pop up the Spotify App on PC using open_uri with "spotify:"
      if (typeof performDesktopAction === "function") {
        performDesktopAction("open_uri", { uri: "spotify:" });
        return;
      }
      targetUrl = "spotify:";
    }

    if (wantYouTube) {
      let youtubeUrl = resolveYouTubeUrl(desktopSnapshot.openUri) || resolvePostYouTubeUrl(post);

      // If we still do not have a direct YouTube URL, use snapshot artwork / metadata heuristics.
      if (!youtubeUrl && desktopSnapshot.artworkUri) {
        youtubeUrl = resolveYouTubeUrl(desktopSnapshot.artworkUri);
      }
      if (!youtubeUrl && desktopSnapshot.meta) {
        youtubeUrl = resolveYouTubeUrl(desktopSnapshot.meta);
      }
      if (!youtubeUrl && desktopSnapshot.title) {
        youtubeUrl = resolveYouTubeUrl(desktopSnapshot.title);
      }

      if (youtubeUrl) {
        window.open(youtubeUrl, "_blank");
        return;
      }

      // If we still have no URL, last resort for YouTube is a search on YouTube
      if (title || meta) {
        const query = [title, meta].filter(Boolean).join(" ");
        targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      }
    }
  }

  if (!targetUrl) {
    // If we still have no URL but we have a post, try its own properties
    targetUrl = post?.externalUrl || post?.src || post?.mediaUrl;
  }

  if (!targetUrl) {
    console.error("handleOpenMediaAction: Could not resolve target URL.", {
      post,
      desktopSnapshot,
      isYouTube: (desktopSnapshot?.appPackage || "").toLowerCase().includes("youtube") || (desktopSnapshot?.title || "").toLowerCase().includes("youtube")
    });
    return;
  }

  if (isNativeCapacitorApp()) {
    if (typeof window.Capacitor !== "undefined" && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.openUrl({ url: targetUrl });
    } else {
      window.open(targetUrl, "_system");
    }
  } else {
    window.open(targetUrl, "_blank");
  }
}

export function handleOpenPhoneAction(post, context) {
  const { isNativeCapacitorApp } = context;

  if (!isNativeCapacitorApp()) return;

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
