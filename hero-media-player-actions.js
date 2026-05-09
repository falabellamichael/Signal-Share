/**
 * Hero Media Player Actions
 * Isolated handler for specialized media operations like "Open Media" and "Open Phone".
 */

export function handleOpenMediaAction(post, context) {
  const { isNativeCapacitorApp, openViewer, desktopSnapshot, performDesktopAction } = context;

  if (!post && !desktopSnapshot?.available) {
    console.warn("handleOpenMediaAction: No active post or desktop session.");
    return;
  }

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

    const isSpotify = appPackage.includes("spotify") || meta.includes("spotify") || (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify" || state?.systemMediaSource === "spotify");
    const isYouTube = appPackage.includes("youtube") || meta.includes("youtube") || title.includes("youtube") || (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube" || state?.systemMediaSource === "youtube");

    if (isSpotify) {
      // Pop up the Spotify App on PC using open_uri with "spotify:"
      if (typeof performDesktopAction === "function") {
        performDesktopAction("open_uri", { uri: "spotify:" });
        return;
      }
      targetUrl = "spotify:";
    }

    if (isYouTube) {
      let youtubeUrl = desktopSnapshot.openUri;

      // If openUri is missing, try to extract the Video ID from artwork or meta fields
      if (!youtubeUrl) {
        if (desktopSnapshot.artworkUri) {
          const idMatch = desktopSnapshot.artworkUri.match(/\/vi\/([a-zA-Z0-9_-]{11})\//);
          if (idMatch) youtubeUrl = `https://www.youtube.com/watch?v=${idMatch[1]}`;
        }
        
        if (!youtubeUrl && meta) {
          // Sometimes the ID is in the "album" or "artist" field on SMTC
          const idMatch = meta.match(/([a-zA-Z0-9_-]{11})/);
          if (idMatch) youtubeUrl = `https://www.youtube.com/watch?v=${idMatch[1]}`;
        }
      }

      if (youtubeUrl) {
        window.open(youtubeUrl, "_blank");
        return;
      }
      
      // If we still have no URL but we have a matching post, it's handled by the fallback below
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
