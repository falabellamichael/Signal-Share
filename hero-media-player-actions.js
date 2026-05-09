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

    const isSpotify = appPackage.includes("spotify") || meta.includes("spotify");
    const isYouTube = appPackage.includes("youtube") || meta.includes("youtube") || title.includes("youtube");

    if (isSpotify) {
      // Pop up the Spotify App on PC using open_uri with "spotify:"
      if (typeof performDesktopAction === "function") {
        performDesktopAction("open_uri", { uri: "spotify:" });
        return;
      }
      targetUrl = "spotify:";
    }

    if (isYouTube) {
      if (desktopSnapshot.openUri) {
        window.open(desktopSnapshot.openUri, "_blank");
        return;
      }
      // If we don't have a URL, at least try to search for the title
      if (title) {
        targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`;
      }
    }
  }

  if (!targetUrl) {
    console.error("handleOpenMediaAction: Could not resolve target URL.");
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
