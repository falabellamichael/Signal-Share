const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "artist", "episode", "show"]);

function toCleanString(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : `${value}`.trim();
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

function safeCall(fn, fallback, ...args) {
  if (typeof fn !== "function") return fallback;
  try {
    const result = fn(...args);
    return result == null ? fallback : result;
  } catch (_error) {
    return fallback;
  }
}

function getPostCandidateValues(post) {
  if (!post) return [];
  return [
    post.externalId,
    post.embedUrl,
    post.externalUrl,
    post.src,
    post.mediaUrl,
    post.label,
    post.caption,
    post.title,
  ]
    .map(toCleanString)
    .filter(Boolean);
}

/**
 * Resolves the YouTube video ID from a post's various URL fields.
 */
export function resolveYouTubePreviewId(post, parseYouTubeUrl) {
  if (!post) return "";

  for (const value of getPostCandidateValues(post)) {
    if (YOUTUBE_ID_PATTERN.test(value)) return value;

    if (typeof parseYouTubeUrl === "function") {
      const parsed = safeCall(parseYouTubeUrl, null, value);
      if (parsed?.externalId && YOUTUBE_ID_PATTERN.test(parsed.externalId)) {
        return parsed.externalId;
      }
    }

    const match = value.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([a-zA-Z0-9_-]{11})/i);
    if (match?.[1]) return match[1];
  }

  return "";
}

function resolveSpotifyPreview(post) {
  if (!post || post.sourceKind !== "spotify") return null;

  const idFromExternalId = toCleanString(post.externalId);
  const label = toCleanString(post.label).toLowerCase();
  const labelType = Array.from(SPOTIFY_TYPES).find((type) => label.includes(type));

  if (idFromExternalId) {
    return { type: labelType || "track", id: idFromExternalId };
  }

  for (const value of getPostCandidateValues(post)) {
    const uriMatch = value.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i);
    if (uriMatch) {
      return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
    }

    const urlMatch = value.match(/open\.spotify\.com\/(?:intl-[a-z0-9-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i);
    if (urlMatch) {
      return { type: urlMatch[1].toLowerCase(), id: urlMatch[2] };
    }
  }

  return null;
}

function createYouTubeEmbedSource(videoId, options = {}) {
  if (!videoId) return "";
  const params = new URLSearchParams({
    autoplay: options.autoplay ? "1" : "0",
    controls: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
    origin: window.location.origin,
  });
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function createSpotifyEmbedSource(spotifyPreview, options = {}) {
  if (!spotifyPreview?.id) return "";
  const type = SPOTIFY_TYPES.has(spotifyPreview.type) ? spotifyPreview.type : "track";
  const autoplay = options.autoplay ? "&autoplay=1" : "";
  return `https://open.spotify.com/embed/${type}/${spotifyPreview.id}?utm_source=generator&theme=0${autoplay}`;
}

export function createActivePlayerDescriptor(post, parseYouTubeUrl, options = {}) {
  if (!post) return null;

  if (post.sourceKind === "youtube") {
    const videoId = resolveYouTubePreviewId(post, parseYouTubeUrl);
    const src = createYouTubeEmbedSource(videoId, options);
    return src ? { provider: "youtube", src, title: "YouTube player" } : null;
  }

  if (post.sourceKind === "spotify") {
    const spotifyPreview = resolveSpotifyPreview(post);
    const src = createSpotifyEmbedSource(spotifyPreview, options);
    return src ? { provider: "spotify", src, title: "Spotify player" } : null;
  }

  return null;
}

function getArtworkCacheKey(artworkUrl) {
  if (typeof artworkUrl === "string") return artworkUrl;
  if (isThenable(artworkUrl)) return "async-artwork";
  return "";
}

function getCardKey({ badge = "", title = "", meta = "", note = "", artworkUrl = "" }) {
  return ["card", badge, title, meta, note, getArtworkCacheKey(artworkUrl)].map(toCleanString).join("|");
}

function setStageContent(stage, node, key, options = {}) {
  if (!stage || !node) return;
  const normalizedKey = toCleanString(key) || `render-${Date.now()}`;
  const shouldPreserveSameKey = options.preserveSameKey !== false;

  if (shouldPreserveSameKey && stage.dataset.heroPreviewKey === normalizedKey && stage.firstElementChild) {
    return;
  }

  stage.dataset.heroPreviewKey = normalizedKey;
  stage.replaceChildren(node);
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
    return typeof getSpotifyPreviewImageUrl === "function" ? getSpotifyPreviewImageUrl(post) : "";
  }

  if (post.mediaKind === "image") {
    const resolved = safeCall(resolveActivePlayerSource, "", post);
    if (resolved) return resolved;

    const src = toCleanString(post.src);
    if (src) return src;

    const mediaUrl = toCleanString(post.mediaUrl);
    if (mediaUrl) return mediaUrl;
  }

  return "";
}

function attachArtwork(card, title, artworkUrl) {
  if (!artworkUrl) return;

  const image = document.createElement("img");
  image.className = "hero-player-preview-image";
  image.alt = title ? `${title} preview` : "Playback preview";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "strict-origin-when-cross-origin";
  image.addEventListener("error", () => image.remove(), { once: true });

  const addImage = (url) => {
    const cleanUrl = toCleanString(url);
    if (!cleanUrl || !card.isConnected) return;
    image.src = cleanUrl;
    if (!image.parentNode) card.prepend(image);
  };

  if (typeof artworkUrl === "string") {
    image.src = artworkUrl;
    card.prepend(image);
    return;
  }

  if (isThenable(artworkUrl)) {
    const requestToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    card.dataset.artworkRequestToken = requestToken;
    artworkUrl
      .then((url) => {
        if (card.dataset.artworkRequestToken !== requestToken) return;
        addImage(url);
      })
      .catch(() => { });
  }
}

/**
 * Constructs the DOM element for the preview card.
 * Handles both synchronous image sources and asynchronous Promises.
 */
export function createPreviewCard({ badge = "", title = "", meta = "", note = "", artworkUrl = "" }) {
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

  if (title) {
    const titleNode = document.createElement("p");
    titleNode.className = "hero-player-preview-title";
    titleNode.textContent = title;
    copy.appendChild(titleNode);
  }

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

  card.appendChild(copy);
  attachArtwork(card, title, artworkUrl);
  return card;
}

/**
 * Creates a card specifically for downloading the companion app.
 */
export function createCompanionCard(options = {}) {
  const card = document.createElement("article");
  card.className = "hero-player-preview hero-player-companion-card";

  const copy = document.createElement("div");
  copy.className = "hero-player-preview-copy";

  const badge = document.createElement("p");
  badge.className = "hero-player-preview-badge";
  badge.textContent = "Optional Companion";
  copy.appendChild(badge);

  const title = document.createElement("p");
  title.className = "hero-player-preview-title";
  title.textContent = "Control your PC media";
  copy.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "hero-player-preview-meta";
  meta.textContent = "Download the desktop bridge to sync YouTube and Spotify from this PC.";
  copy.appendChild(meta);

  const action = document.createElement("div");
  action.className = "hero-player-preview-actions";
  action.style.display = "grid";
  action.style.gap = "10px";
  action.style.justifyItems = "center";

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "button button-primary hero-companion-download-btn";
  downloadBtn.textContent = "Download Now";
  downloadBtn.type = "button";

  const securityActions = document.createElement("p");
  securityActions.className = "hero-player-preview-note";
  securityActions.style.marginTop = "8px";
  securityActions.style.fontSize = "0.75rem";
  securityActions.style.opacity = "0.8";

  const downloadSecurity = document.createElement("a");
  downloadSecurity.href = "#";
  downloadSecurity.id = "companionSecurityLinkCard";
  downloadSecurity.style.textDecoration = "underline";
  downloadSecurity.style.color = "inherit";
  downloadSecurity.textContent = "download safety measures HERE";
  downloadSecurity.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.heroMediaPlayerController && typeof window.heroMediaPlayerController.downloadSecurityReadme === "function") {
      window.heroMediaPlayerController.downloadSecurityReadme();
    }
  });

  const securitySeparator = document.createTextNode(" or ");

  const viewSecurity = document.createElement("a");
  viewSecurity.href = "security.html";
  viewSecurity.target = "_blank";
  viewSecurity.style.textDecoration = "underline";
  viewSecurity.style.color = "inherit";
  viewSecurity.textContent = "read in browser HERE";
  viewSecurity.addEventListener("click", (e) => { e.stopPropagation(); });

  securityActions.appendChild(downloadSecurity);
  securityActions.appendChild(securitySeparator);
  securityActions.appendChild(viewSecurity);

  action.appendChild(downloadBtn);
  action.appendChild(securityActions);
  copy.appendChild(action);

  card.appendChild(copy);

  // Optional: Add a graphic or icon if artworkUrl is provided
  if (options.artworkUrl) {
    attachArtwork(card, "Companion", options.artworkUrl);
  }

  return card;
}

export function createActivePlayerStage(descriptor) {
  if (!descriptor?.src) return null;

  const container = document.createElement("div");
  container.className = "hero-player-active-stage";
  container.dataset.provider = descriptor.provider || "external";

  const iframe = document.createElement("iframe");
  iframe.className = "hero-player-active-frame";
  iframe.src = descriptor.src;
  iframe.title = descriptor.title || "External media player";
  iframe.loading = "eager";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";

  container.appendChild(iframe);
  return container;
}

function commitActivePlayer(stage, post, options) {
  const { parseYouTubeUrl, resolveActivePlayerSource, autoplay } = options;
  const descriptor = createActivePlayerDescriptor(post, parseYouTubeUrl, { autoplay });

  if (descriptor) {
    const key = `active-player|${descriptor.provider}|${descriptor.src}`;
    if (stage.dataset.heroPreviewKey === key && stage.querySelector(".hero-player-active-frame")) {
      return true;
    }
    const activeStage = createActivePlayerStage(descriptor);
    if (!activeStage) return false;
    setStageContent(stage, activeStage, key);
    return true;
  }

  if (post && (post.mediaKind === "video" || post.mediaKind === "audio")) {
    const src = safeCall(resolveActivePlayerSource, "", post);
    if (!src) return false;

    const key = `active-player|upload|${post.id || "no-id"}|${src}`;
    if (stage.dataset.heroPreviewKey === key && stage.querySelector("video, audio")) {
      return true;
    }

    const node = document.createElement(post.mediaKind === "audio" ? "audio" : "video");
    node.src = src;
    node.controls = true;
    node.playsInline = true;
    node.style.cssText =
      post.mediaKind === "audio"
        ? "display:block;width:100%;height:80px;background:transparent;margin:10px 0;"
        : "display:block;border-radius:18px;background:#000;object-fit:contain;width:100%;height:100%;";

    // For local audio, we want the stage itself to be smaller
    if (post.mediaKind === "audio") {
      stage.style.aspectRatio = "auto";
      stage.style.height = "auto";
      stage.style.minHeight = "0";
    } else {
      stage.style.aspectRatio = "16/9";
      stage.style.height = "";
    }

    setStageContent(stage, node, key);
    return true;
  }

  return false;
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

  const creatorSummary = safeCall(getProfileSummaryForPost, null, post);
  const creatorName = creatorSummary?.displayName ?? post.creator ?? "Signal Share";
  const formatLabel = safeCall(formatKind, "", post.mediaKind);
  const providerLabel = post.sourceKind === "youtube"
    ? "YouTube"
    : post.sourceKind === "spotify"
      ? "Spotify"
      : "";
  const meta = [creatorName, formatLabel, providerLabel].filter(Boolean).join(" · ");
  const artworkUrl = resolveAppPreviewArtwork(post, {
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });

  const isYouTube = post.sourceKind === "youtube";
  const cardData = {
    badge: isYouTube ? "" : `UP NEXT · ${providerLabel || "App Media"}`,
    title: isYouTube ? "" : (post.title || "Next playable post"),
    meta: isYouTube ? "" : meta,
    note: isYouTube ? "" : "Press Play to start playback.",
    artworkUrl,
  };

  return {
    key: getCardKey(cardData),
    node: createPreviewCard(cardData),
  };
}

function createCardResult(cardOptions) {
  return {
    key: getCardKey(cardOptions),
    node: createPreviewCard(cardOptions),
  };
}

function commitCard(stage, cardOptions) {
  const result = createCardResult(cardOptions);
  setStageContent(stage, result.node, result.key);
}

function commitStandbyOrFallback(stage, standbyPost, previewOptions, fallbackCardOptions) {
  const standby = createPostStandbyPreview(standbyPost, previewOptions);
  if (standby) {
    setStageContent(stage, standby.node, standby.key);
    return;
  }
  commitCard(stage, fallbackCardOptions);
}

function canUseFallbackMedia(fallbackMedia) {
  return typeof HTMLMediaElement !== "undefined" && fallbackMedia instanceof HTMLMediaElement;
}

function formatPostBadge(post, formatKind, getSignalLabel) {
  const kind = safeCall(formatKind, post?.mediaKind ? `${post.mediaKind} post` : "Media post", post?.mediaKind || "media");
  const signal = safeCall(getSignalLabel, "Live on feed", post);
  return [kind, signal].filter(Boolean).join(" / ");
}

function formatPostMeta(post, creatorSummary) {
  return creatorSummary?.displayName ?? post?.creator ?? "";
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
    externalMetadata,
  } = options;

  if (!stage) return;

  // When the direct hero player owns the stage, do not let the normal preview render
  // snap it back to the latest feed item after Next/Previous or Play.
  if (stage.dataset.safeHeroLocked === "true") {
    const lockedPostId = stage.dataset.safeHeroPostId || "";
    const incomingPostId = post?.id || matchedPost?.id || "";
    if (!incomingPostId || incomingPostId !== lockedPostId) return;
    if (stage.dataset.safeHeroKey && stage.firstElementChild) return;
  }

  const previewOptions = {
    getProfileSummaryForPost,
    formatKind,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  };

  const standbyPost = !post && typeof getStandbyPreviewPost === "function"
    ? safeCall(getStandbyPreviewPost, null)
    : null;

  if (mode === "device") {
    if (nativeSnapshot?.permissionRequired) {
      commitCard(stage, {
        badge: "ON-DEVICE MEDIA",
        title: "Enable access",
        meta: "Allow media access to control this device.",
        note: "Use Play to open settings.",
      });
      return;
    }

    if (nativeSnapshot?.active) {
      const creatorSummary = matchedPost ? safeCall(getProfileSummaryForPost, null, matchedPost) : null;
      const artworkUrl = matchedPost ? resolveAppPreviewArtwork(matchedPost, previewOptions) : (nativeSnapshot.artworkUri || "");

      const isYouTube = matchedPost?.sourceKind === "youtube" || (nativeSnapshot?.appPackage && nativeSnapshot.appPackage.toLowerCase().includes("youtube"));
      commitCard(stage, {
        badge: isYouTube ? "" : (matchedPost ? formatPostBadge(matchedPost, formatKind, getSignalLabel) : "ON-DEVICE MEDIA"),
        title: isYouTube ? "" : (nativeSnapshot.title || matchedPost?.title || "Now playing"),
        meta: isYouTube ? "" : (nativeSnapshot.meta || (matchedPost ? formatPostMeta(matchedPost, creatorSummary, formatTimestamp) : "Current device playback")),
        note: isYouTube ? "" : (nativeSnapshot.playbackState === "paused" ? "Paused" : "Playing"),
        artworkUrl: artworkUrl,
      });
      return;
    }

    commitStandbyOrFallback(stage, standbyPost, previewOptions, {
      badge: "ON-DEVICE MEDIA",
      title: "No active playback",
      meta: "Start a track in any media app on this device.",
    });
    return;
  }

  if (mode === "desktop") {
    if (desktopSnapshot?.active) {
      const creatorSummary = matchedPost ? safeCall(getProfileSummaryForPost, null, matchedPost) : null;
      const artworkUrl = matchedPost ? resolveAppPreviewArtwork(matchedPost, previewOptions) : (desktopSnapshot.artworkUri || "");

      const isYouTube = matchedPost?.sourceKind === "youtube" || (desktopSnapshot?.appPackage && desktopSnapshot.appPackage.toLowerCase().includes("youtube"));
      commitCard(stage, {
        badge: isYouTube ? "" : (matchedPost ? formatPostBadge(matchedPost, formatKind, getSignalLabel) : "PC SYSTEM MEDIA"),
        title: isYouTube ? "" : (desktopSnapshot.title || matchedPost?.title || "Now playing"),
        meta: isYouTube ? "" : (desktopSnapshot.meta || (matchedPost ? formatPostMeta(matchedPost, creatorSummary, formatTimestamp) : "Desktop playback")),
        note: isYouTube ? "" : (desktopSnapshot.playbackState === "paused" ? "Paused" : "Playing"),
        artworkUrl: artworkUrl,
      });
      return;
    }

    if (options.showCompanionCard) {
      const card = createCompanionCard();
      setStageContent(stage, card, "companion-download");
      return;
    }

    commitStandbyOrFallback(stage, standbyPost, previewOptions, {
      badge: "PC SYSTEM MEDIA",
      title: "Waiting for playback",
      meta: "Start YouTube, Spotify, or another desktop app.",
    });
    return;
  }

  if (!post && canUseFallbackMedia(fallbackMedia)) {
    const metadata = safeCall(getBrowserMediaMetadata, null);
    const fallbackTitle = metadata?.title || fallbackMedia.getAttribute("title") || "Browser playback";
    const fallbackMetaRaw = [metadata?.artist, metadata?.album].filter(Boolean).join(" · ");
    const fallbackMeta = typeof sanitizeSnapshotMeta === "function"
      ? safeCall(sanitizeSnapshotMeta, fallbackMetaRaw, fallbackMetaRaw, "")
      : fallbackMetaRaw;

    commitCard(stage, {
      badge: "",
      title: fallbackTitle,
      meta: metadata?.artist || "Active media",
      note: "",
      artworkUrl: metadata?.artworkUrl || "",
    });
    return;
  }

  if (!post) {
    commitStandbyOrFallback(stage, standbyPost, previewOptions, {
      badge: "",
      title: "Ready",
      meta: "Select media to begin",
      note: "",
    });
    return;
  }

  // Always use static preview cards for hero mode
  // if (options.active && commitActivePlayer(stage, post, previewOptions)) return;

  const creatorSummary = safeCall(getProfileSummaryForPost, null, post);
  const artworkUrl = resolveAppPreviewArtwork(post, {
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });

  // Handle async metadata resolution for preview card
  let resolvedMetadata = externalMetadata;
  if (externalMetadata instanceof Promise) {
    const isYouTube = post?.sourceKind === "youtube";
    // Render initial card with fallback while metadata loads
    commitCard(stage, {
      badge: "",
      title: isYouTube ? "" : (post.title || "Now playing"),
      meta: isYouTube ? "" : formatPostMeta(post, creatorSummary),
      artworkUrl: artworkUrl,
    });

    // Fetch metadata and update card when available
    externalMetadata.then(metadata => {
      if (metadata) {
        const isYouTube = post?.sourceKind === "youtube";
        commitCard(stage, {
          badge: "",
          title: isYouTube ? "" : (metadata?.title || post.title || "Now playing"),
          meta: isYouTube ? "" : (metadata.creator || ""),
          artworkUrl: metadata?.artworkUrl || artworkUrl,
        });
      }
    }).catch(() => {
      // Silently ignore errors, card already rendered with fallback
    });
    return;
  }

  const isYouTube = post?.sourceKind === "youtube";
  commitCard(stage, {
    badge: "",
    title: isYouTube ? "" : (resolvedMetadata?.title || post.title || "Now playing"),
    meta: isYouTube ? "" : (resolvedMetadata?.creator || formatPostMeta(post, creatorSummary)),
    artworkUrl: resolvedMetadata?.artworkUrl || artworkUrl,
  });
}
