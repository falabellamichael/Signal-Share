import { toCleanString, isThenable, safeCall, formatPostBadge, formatPostMeta } from './shared-utils.js';

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "artist", "episode", "show"]);

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
 * Ensures correct song matching by using title/artist context when possible.
 */
export function resolveAppPreviewArtwork(post, options = {}) {
  if (!post) return "";
  const { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl } = options;

  // For YouTube, use video ID
  if (post.sourceKind === "youtube") {
    const videoId = resolveYouTubePreviewId(post, parseYouTubeUrl);
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
  }

  // For Spotify, ensure we're using the correct external ID/label that matches the displayed song
  if (post.sourceKind === "spotify") {
    const cleanTitle = toCleanString(post.title || "");
    const cleanCreator = toCleanString(post.creator || "");
    const externalId = toCleanString(post.externalId || "");
    const label = toCleanString(post.label || "");

    // Only call getSpotifyPreviewImageUrl if we have a reliable Spotify ID/label that matches the song data
    if (typeof getSpotifyPreviewImageUrl === "function" && externalId) {
      return getSpotifyPreviewImageUrl({ ...post, title: cleanTitle, creator: cleanCreator });
    }

    // Fallback to label-based search if no explicit ID
    if (label) {
      const lowerLabel = label.toLowerCase();
      if (lowerLabel.includes("spotify") || lowerLabel.match(/track|album|playlist/)) {
        return getSpotifyPreviewImageUrl({ ...post, title: cleanTitle, creator: cleanCreator });
      }
    }

    // If we can't match a reliable Spotify ID, return empty string to avoid wrong artwork
    if (cleanTitle || cleanCreator) {
      console.warn(`[Hero Preview] Cannot reliably resolve artwork for: "${cleanTitle}" by "${cleanCreator}". Check externalId/label.`);
      return "";
    }
    return "";
  }

  // For media uploads, try active player source first
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
  image.className = "hero-player-preview-image hero-player-large-artwork";
  image.alt = title ? `${title} preview` : "Playback preview";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "strict-origin-when-cross-origin";

  // Use a data attribute to keep track of the current artwork URL
  card.dataset.currentArtwork = typeof artworkUrl === "string" ? artworkUrl : "async";

  // Add inline styling for larger, more prominent artwork (covers most of the card)
  image.style.cssText =
    'max-width: 100%;' +
    'max-height: 58vh;' +
    'border-radius: 18px;' +
    'object-fit: cover;' +
    'display: block;'

  image.addEventListener("error", () => {
    // If the image fails to load (404), remove it.
    // This allows the CSS fallback background to show, and we could potentially
    // trigger a metadata retry here.
    image.remove();
    console.warn(`[Hero] Failed to load artwork: ${image.src}`);
  }, { once: true });


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
 * Simplified design: Only shows badge and minimal text.
 */
export function createPreviewCard({ badge = "", title = "", meta = "", note = "", artworkUrl = "" }) {
  const card = document.createElement("article");
  card.className = "hero-player-preview hero-player-preview-minimal";

  const copy = document.createElement("div");
  copy.className = "hero-player-preview-copy";

  if (badge) {
    const badgeNode = document.createElement("p");
    badgeNode.className = "hero-player-preview-badge hero-player-badge-compact";
    badgeNode.textContent = badge;
    // CRITICAL: Inline minimal compact styling
    badgeNode.style.cssText = 
      'font-size: 0.7rem; ' +
      'font-weight: 600; ' +
      'letter-spacing: 0.5px; ' +
      'text-transform: uppercase; ' +
      'padding: 4px 8px; ' +
      'border-radius: 4px; ' +
      'background: rgba(0,0,0,0.06); ' +
      'color: #333; ' +
      'margin-bottom: 2px;'
    copy.appendChild(badgeNode);
  }

  // Only show title/artist if there's no badge or it's an idle state (keep current behavior for device mode)
  if (title || meta) {
    const titleNode = document.createElement("p");
    titleNode.className = "hero-player-preview-title hero-player-text-fade";
    titleNode.textContent = `${title} · ${meta}`;
    // Add fade effect with smaller, lighter font
    titleNode.style.cssText = 
      'font-size: 0.75rem; ' +
      'color: #666; ' +
      'opacity: 0.8; ' +
      'padding-top: 4px;'
    copy.appendChild(titleNode);
  }

  card.appendChild(copy);
  attachArtwork(card, title, artworkUrl);
  return card;
}

/**
 * Creates a simplified companion/download card.
 */
export function createCompanionCard(options = {}) {
  const card = document.createElement("article");
  card.className = "hero-player-preview hero-player-companion-card";

  const badgeNode = document.createElement("p");
  badgeNode.className = "hero-player-preview-badge hero-player-badge-compact";
  badgeNode.textContent = "COMpanion Bridge";
  // Match compact badge styling
  badgeNode.style.cssText = 
    'font-size: 0.7rem; ' +
    'font-weight: 600; ' +
    'letter-spacing: 0.5px; ' +
    'text-transform: uppercase; ' +
    'padding: 4px 8px; ' +
    'border-radius: 4px; ' +
    'background: rgba(0,0,0,0.06); ' +
    'color: #333; ' +
    'margin-bottom: 2px;'
  card.appendChild(badgeNode);

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

/**
 * Creates a minimal standby/idle preview card - simplified design.
 */
function createPostStandbyPreview(post, options = {}) {
  if (!post) return null;
  const {
    getProfileSummaryForPost,
    formatKind,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
    isHardenedEnvironment,
    isYouTubeMode,
    isSpotifyActive,
  } = options;

  const providerLabel = post.sourceKind === "youtube"
    ? "YOUTUBE" 
    : post.sourceKind === "spotify"
      ? "SPOTIFY" 
      : "APPMEDIA";
  
  const badge = `${providerLabel} PREVIEW`;
  const artworkUrl = resolveAppPreviewArtwork(post, {
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });

  // Minimal card with just badge and status (no title/meta)
  const cardData = {
    badge: badge,
    title: "",
    meta: "",
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

/**
 * Handles Media-Toggle Mode (YouTube/Spotify toggle)
 * Attempts to fetch preview from both sources and shows the active one
 * Ensures correct song matching by passing title/creator context with post data
 */
function handleMediaToggleMode(options = {}) {
  const {
    post,
    matchedPost,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
    isYouTubeMode,
    isSpotifyActive,
  } = options;

  // Check for Spotify preview first (higher priority when in media toggle mode)
  if (isSpotifyActive && post?.sourceKind === "spotify") {
    const cleanTitle = toCleanString(post.title || "");
    const cleanCreator = toCleanString(post.creator || "");

    // Pass enriched post data with context for correct artwork matching
    const resolvedMetadata = resolveAppPreviewArtwork({
      ...post,
      title: cleanTitle,
      creator: cleanCreator,
    }, {
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });

    if (resolvedMetadata) {
      return createCardResult({
        badge: isYouTubeMode ? "SPOTIFY ACTIVE" : "NOW PLAYING",
        title: post?.title || matchedPost?.title || "",
        meta: matchedPost?.creator || post?.creator || "Signal Share",
        artworkUrl: resolvedMetadata,
      });
    }
  }

  // Check for YouTube preview (lower priority)
  if (isYouTubeMode || (post && post.sourceKind === "youtube")) {
    const cleanTitle = toCleanString(post.title || "");
    const cleanCreator = toCleanString(post.creator || "");

    const resolvedMetadata = resolveAppPreviewArtwork({
      ...post,
      title: cleanTitle,
      creator: cleanCreator,
    }, {
      parseYouTubeUrl,
      resolveActivePlayerSource,
    });

    if (resolvedMetadata) {
      return createCardResult({
        badge: isSpotifyActive ? "YOUTUBE ACTIVE" : "NOW PLAYING",
        title: post?.title || matchedPost?.title || "",
        meta: matchedPost?.creator || post?.creator || "Signal Share",
        artworkUrl: resolvedMetadata,
      });
    }
  }

  // Return idle state if no active source found
  const preferredSource = (isSpotifyActive && isYouTubeMode) ? "Both" : (isSpotifyActive ? "Spotify" : (isYouTubeMode ? "YouTube" : "Ready"));
  const idleTitle = preferredSource === "Both" 
    ? "Ready for YouTube or Spotify" 
    : `${preferredSource} Playback`;

  return createCardResult({
    badge: `TOGGLE MODE · ${preferredSource.toUpperCase()}`,
    title: post?.title || matchedPost?.title || idleTitle,
    meta: (post?.creator || matchedPost?.creator || "Signal Share"),
  });
}

/**
 * Main entry point for Media-Toggle Mode preview rendering
 */
export function renderMediaTogglePreview(options = {}) {
  const {
    stage,
    mode,
    post,
    fallbackMedia,
    nativeSnapshot,
    desktopSnapshot,
    getStandbyPreviewPost,
    state,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  } = options;

  if (!stage) return;

  // Determine active sources for toggle mode
  const isYouTubeMode = (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube");
  const isSpotifyActive = (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify");

  // For toggle mode, try to render from both sources
  if ((isYouTubeMode && isSpotifyActive) || window.SIGNAL_SHARE_HERO_PLAYER_CONFIG?.heroControlMode === "media") {
    const result = handleMediaToggleMode({
      post,
      desktopSnapshot,
      matchedPost: null,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
      isYouTubeMode,
      isSpotifyActive,
    });

    // Use the result if artwork/node is available
    if (result && result.node.firstElementChild) {
      setStageContent(stage, result.node, result.key);
      return;
    }

    // Fallback to idle state
    const preferredSource = (isSpotifyActive && isYouTubeMode) ? "Both" : (isSpotifyActive ? "Spotify" : (isYouTubeMode ? "YouTube" : "Ready"));
    commitCard(stage, {
      badge: `TOGGLE MODE · ${preferredSource.toUpperCase()}`,
      title: "Ready for playback",
      meta: "Start YouTube or Spotify to begin",
    });
    return;
  }

  // Standard rendering for non-toggle modes
  renderHeroStagePreview({
    stage,
    mode,
    post,
    fallbackMedia,
    nativeSnapshot,
    desktopSnapshot,
    getStandbyPreviewPost,
    state,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });
}

function canUseFallbackMedia(fallbackMedia) {
  return typeof HTMLMediaElement !== "undefined" && fallbackMedia instanceof HTMLMediaElement;
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
    state,
  } = options;

  if (!stage) return;

  // Detect YouTube or Spotify for Media-Toggle Mode
  const isYouTubeMode = (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube" || state?.systemMediaSource === "youtube")
    || window.SIGNAL_SHARE_HERO_PLAYER_CONFIG?.heroMediaSource === "youtube";
  const isSpotifyActive = (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify" || state?.systemMediaSource === "spotify")
    || window.SIGNAL_SHARE_HERO_PLAYER_CONFIG?.heroMediaSource === "spotify";
  const isFeedMode = state?.heroControlMode === "feed";
  const isHardenedEnvironment = (isFeedMode || state?.heroControlMode === "media");

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
    isHardenedEnvironment,
    isYouTubeMode,
    isSpotifyActive,
  };

  // Resolve current source filter
  const sourceFilter = (state?.heroControlSource || state?.heroMediaSource || "").toLowerCase();
  const isSourceLocked = sourceFilter === "youtube" || sourceFilter === "spotify";

  const standbyPost = (!post && typeof getStandbyPreviewPost === "function")
    ? safeCall(getStandbyPreviewPost, null)
    : null;



  if (mode === "device") {
    // Minimal device mode preview - just badge and status
    const playbackStatus = nativeSnapshot?.playbackState || "";
    const badge = nativeSnapshot?.active 
      ? `ON-DEVICE · ${playbackStatus.toUpperCase()}` 
      : "ON-DEVICE MEDIA";

    commitCard(stage, {
      badge: badge,
      title: nativeSnapshot?.title || matchedPost?.title || "",
      meta: nativeSnapshot?.meta || matchedPost?.creator || "",  // Keep only if needed for device mode
      artworkUrl: matchedPost ? resolveAppPreviewArtwork(matchedPost, previewOptions) : (nativeSnapshot?.artworkUri || "")
    });
    return;
  }

  if (mode === "desktop") {
    // Minimal desktop mode preview - just badge and status
    const playbackStatus = desktopSnapshot?.playbackState || "";
    const snapshotProvider = (desktopSnapshot?.sourceProvider || "").toLowerCase();
    
    let platformLabel = matchedPost ? formatPostBadge(matchedPost, formatKind, getSignalLabel) : "PC SYSTEM MEDIA";
    if (snapshotProvider === "youtube" || isYouTubeMode) {
      platformLabel = "YOUTUBE";
    } else if (snapshotProvider === "spotify" || isSpotifyActive) {
      platformLabel = "SPOTIFY";
    }

    let artworkUrl = desktopSnapshot.artworkUri || (matchedPost ? resolveAppPreviewArtwork(matchedPost, previewOptions) : "");

    const badge = matchedPost 
      ? platformLabel 
      : `${platformLabel} · ${playbackStatus.toUpperCase()}`;

    commitCard(stage, {
      badge: badge,
      title: desktopSnapshot.title || matchedPost?.title || "",
      meta: desktopSnapshot.meta || matchedPost?.creator || "",  // Keep creator only for metadata mode
      artworkUrl: artworkUrl
    });

    return;
  }

  if (options.showCompanionCard) {
    const card = createCompanionCard();
    setStageContent(stage, card, "companion-download");
    return;
  }



  if (!post) {
    const metadata = safeCall(getBrowserMediaMetadata, null);
    // Minimal fallback - just artwork with status badge (if available)
    commitStandbyOrFallback(stage, standbyPost, previewOptions, {
      badge: "NOW PLAYING",  // Show status
      title: "",
      meta: "",
      artworkUrl: metadata?.artworkUrl || fallbackMedia?.getAttribute("data-artwork") || ""
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
    commitCard(stage, {
      badge: "NOW PLAYING",
      title: "",
      meta: "",
      artworkUrl: artworkUrl,
      showMetadata: true
    });

    // Fetch metadata and update card when available
    externalMetadata.then(metadata => {
      if (metadata) {
        commitCard(stage, {
          badge: "NOW PLAYING",
          title: "",
          meta: "",
          artworkUrl: metadata?.artworkUrl || artworkUrl,
          showMetadata: true
        });
      }
    }).catch(() => {
      // Silently ignore errors, card already rendered with fallback
    });
    return;
  }

  commitCard(stage, {
    badge: "NOW PLAYING",
    title: "",
    meta: "",
    artworkUrl: resolvedMetadata?.artworkUrl || artworkUrl,
    showMetadata: true
  });
}
