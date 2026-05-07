/**
 * Resolves the YouTube video ID from a post's various URL fields.
 */
function resolveYouTubePreviewId(post, parseYouTubeUrl) {
  if (!post) return "";
  const candidates = [
    post.externalId,
    post.embedUrl,
    post.externalUrl,
    post.src,
    post.mediaUrl,
    post.label,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = `${candidate}`.trim();
    if (!value) continue;
    if (typeof parseYouTubeUrl === "function") {
      const parsed = parseYouTubeUrl(value);
      if (parsed?.externalId) return parsed.externalId;
    }
    const match = value.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([a-zA-Z0-9_-]{11})/i);
    if (match?.[1]) return match[1];
  }
  return "";
}

/**
 * Resolves the artwork URL for a post. 
 * Supports synchronous string returns (YouTube, images) and asynchronous Promises (Spotify).
 */
export function resolveAppPreviewArtwork(post, options = {}) {
  if (!post) return "";
  const { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl } = options;

  if (post.sourceKind === "youtube") {
    const videoId = resolveYouTubePreviewId(post, parseYouTubeUrl);
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
  }

  if (post.sourceKind === "spotify") {
    if (typeof getSpotifyPreviewImageUrl === "function") {
      return getSpotifyPreviewImageUrl(post); // Returns a Promise
    }
    return "";
  }

  if (post.mediaKind === "image") {
    if (typeof resolveActivePlayerSource === "function") {
      const resolved = resolveActivePlayerSource(post);
      if (resolved) return resolved;
    }
    if (typeof post.src === "string" && post.src.trim()) return post.src.trim();
    if (typeof post.mediaUrl === "string" && post.mediaUrl.trim()) return post.mediaUrl.trim();
  }
  return "";
}

/**
 * Constructs the DOM element for the preview card.
 * Handles both synchronous image sources and asynchronous Promises.
 */
function createPreviewCard({ badge, title, meta, note, artworkUrl }) {
  const card = document.createElement("article");
  card.className = "hero-player-preview";

  const copy = document.createElement("div");
  copy.className = "hero-player-preview-copy";

  if (badge) {
    const badgeNode = document.createElement("p");
    badgeNode.className = "hero-player-preview-badge";
    badgeNode.textContent = badge;
    copy.appendChild(badgeNode);
  }

  const titleNode = document.createElement("p");
  titleNode.className = "hero-player-preview-title";
  titleNode.textContent = title || "Ready to play";
  copy.appendChild(titleNode);

  if (meta) {
    const metaNode = document.createElement("p");
    metaNode.className = "hero-player-preview-meta";
    metaNode.textContent = meta;
    copy.appendChild(metaNode);
  }

  if (note) {
    const noteNode = document.createElement("p");
    noteNode.className = "hero-player-preview-note";
    noteNode.textContent = note;
    copy.appendChild(noteNode);
  }

  // Support for both synchronous URLs and async Promises (for Spotify)
  if (artworkUrl) {
    const image = document.createElement("img");
    image.className = "hero-player-preview-image";
    image.alt = title ? `${title} preview` : "Playback preview";
    image.loading = "lazy";
    image.referrerPolicy = "strict-origin-when-cross-origin";

    if (typeof artworkUrl === "string") {
      image.src = artworkUrl;
      card.appendChild(image);
    } else if (typeof artworkUrl.then === "function") {
      // It's a Promise: Inject when resolved.
      artworkUrl.then((url) => {
        if (url && typeof url === "string") {
          image.src = url;
          // Innovative Edge: Allows a CSS fade-in transition targeting `.is-loaded`
          image.onload = () => image.classList.add('is-loaded');
          card.insertBefore(image, copy);
        }
      }).catch(() => {
        // Silent catch to prevent console errors on failed remote loads
      });
    }
  }

  card.appendChild(copy);
  return card;
}

function renderActivePlayerStage(post, parseYouTubeUrl) {
  if (!post) return null;
  const videoId = resolveYouTubePreviewId(post, parseYouTubeUrl);
  const spotifyId = post.sourceKind === "spotify" ? (post.externalId || post.src?.match(/track\/([a-zA-Z0-9]+)/)?.[1]) : "";

  if (videoId || spotifyId) {
    const container = document.createElement("div");
    container.className = "hero-player-active-stage";
    container.style.cssText = "width: 100%; height: 100%; position: relative; border-radius: 12px; overflow: hidden; background: #000;";

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width: 100%; height: 100%; border: none;";
    iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";

    if (post.sourceKind === "youtube") {
      iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&modestbranding=1`;
      iframe.title = "YouTube player";
    } else {
      iframe.src = `https://open.spotify.com/embed/track/${spotifyId}?utm_source=generator&theme=0`;
      iframe.title = "Spotify player";
    }

    container.appendChild(iframe);
    return container;
  }
  return null;
}

function createPostStandbyPreview(post, options = {}) {
  if (!post) return null;
  const {
    getProfileSummaryForPost,
    formatKind,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  } = options;

  const creatorSummary = typeof getProfileSummaryForPost === "function" ? getProfileSummaryForPost(post) : null;
  const creatorName = creatorSummary?.displayName ?? post.creator ?? "Signal Share";
  const formatLabel = typeof formatKind === "function" ? formatKind(post.mediaKind) : "";
  const providerLabel = post.sourceKind === "youtube"
    ? "YouTube"
    : post.sourceKind === "spotify"
      ? "Spotify"
      : "";
  const meta = [creatorName, formatLabel, providerLabel].filter(Boolean).join(" · ");

  return createPreviewCard({
    badge: `Up Next · ${providerLabel || "App Media"}`,
    title: post.title || "Next playable post",
    meta,
    note: "Press Play to start playback.",
    artworkUrl: resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl }),
  });
}

export function renderHeroStagePreview(options = {}) {
  const {
    stage,
    mode,
    post,
    fallbackMedia,
    nativeSnapshot,
    desktopSnapshot,
    getStandbyPreviewPost,
    getProfileSummaryForPost,
    formatKind,
    getSignalLabel,
    formatTimestamp,
    getBrowserMediaMetadata,
    sanitizeSnapshotMeta,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
    matchedPost,
  } = options;

  if (!stage) return;
  stage.replaceChildren();

  const standbyPost = !post && typeof getStandbyPreviewPost === "function"
    ? getStandbyPreviewPost()
    : null;

  if (mode === "device") {
    if (nativeSnapshot?.permissionRequired) {
      stage.appendChild(createPreviewCard({
        badge: "Device media",
        title: "Enable access",
        meta: "Allow media access to control this device.",
        note: "Use Play to open settings.",
      }));
      return;
    }

    if (nativeSnapshot?.active) {
      if (matchedPost && (matchedPost.sourceKind === "youtube" || matchedPost.sourceKind === "spotify")) {
        const activeStage = renderActivePlayerStage(matchedPost, parseYouTubeUrl);
        if (activeStage) {
          stage.appendChild(activeStage);
          return;
        }
      }

      stage.appendChild(createPreviewCard({
        badge: "Device media",
        title: nativeSnapshot.title || "Now playing",
        meta: nativeSnapshot.meta || "Current device playback",
        note: nativeSnapshot.playbackState === "paused" ? "Paused" : "Playing",
        artworkUrl: nativeSnapshot.artworkUri || "",
      }));
      return;
    }

    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }

    stage.appendChild(createPreviewCard({
      badge: "Device media",
      title: "No active playback",
      meta: "Start a track in any media app on this device.",
    }));
    return;
  }

  if (mode === "desktop") {
    if (desktopSnapshot?.active) {
      if (matchedPost && (matchedPost.sourceKind === "youtube" || matchedPost.sourceKind === "spotify")) {
        const activeStage = renderActivePlayerStage(matchedPost, parseYouTubeUrl);
        if (activeStage) {
          stage.appendChild(activeStage);
          return;
        }
      }

      const resolvedArtwork = desktopSnapshot.artworkUri || "";
      stage.appendChild(createPreviewCard({
        badge: "PC system media",
        title: desktopSnapshot.title || "Now playing",
        meta: desktopSnapshot.meta || "Desktop playback",
        note: desktopSnapshot.playbackState === "paused" ? "Paused" : "Playing",
        artworkUrl: resolvedArtwork,
      }));
      return;
    }

    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }

    stage.appendChild(createPreviewCard({
      badge: "PC system media",
      title: "Waiting for playback",
      meta: "Start YouTube, Spotify, or another desktop app.",
    }));
    return;
  }

  if (!post && fallbackMedia instanceof HTMLMediaElement) {
    const metadata = typeof getBrowserMediaMetadata === "function" ? getBrowserMediaMetadata() : null;
    const fallbackTitle = metadata?.title || fallbackMedia.getAttribute("title") || "Browser playback";
    const fallbackMetaRaw = [metadata?.artist, metadata?.album].filter(Boolean).join(" · ");
    const fallbackMeta = typeof sanitizeSnapshotMeta === "function"
      ? sanitizeSnapshotMeta(fallbackMetaRaw, "")
      : fallbackMetaRaw;
    stage.appendChild(createPreviewCard({
      badge: "Browser media",
      title: fallbackTitle,
      meta: fallbackMeta || "Active browser media session",
      note: fallbackMedia.paused ? "Paused" : "Playing",
      artworkUrl: metadata?.artworkUrl || "",
    }));
    return;
  }

  if (!post) {
    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }
    stage.appendChild(createPreviewCard({
      badge: "Signal Share",
      title: "Ready for your signal",
      meta: "Select a track or video to start listening.",
      note: "Your media will appear here.",
    }));
    return;
  }

  const creatorSummary = typeof getProfileSummaryForPost === "function" ? getProfileSummaryForPost(post) : null;
  console.log("[HeroPreview] Rendering app mode for post:", post.id, "source:", post.sourceKind);

  // Dynamic Edge: If it's an active app post, render the REAL player in the Hero stage.
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") {
    const activeStage = renderActivePlayerStage(post, parseYouTubeUrl);
    if (activeStage) {
      stage.appendChild(activeStage);
      return;
    }
  }

  stage.appendChild(createPreviewCard({
    badge: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
    title: post.title || "Now playing",
    meta: `${creatorSummary?.displayName ?? post.creator ?? "Signal Share"} · ${formatTimestamp(post.createdAt)}`,
    artworkUrl: resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl }),
  }));
}
