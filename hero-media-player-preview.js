/**
 * Hero Media Player Preview - FIXED VERSION
 * Implements INDEPENDENT toggle functionality for Feed/Media and YouTube/Spotify
 * 
 * TOGGLE FUNCTIONALITY:
 * 1. FEED Toggle (Feed/Media): Shows/feed posts, switches to respective feed post type exclusively
 * 2. MEDIA Toggle (YouTube/Spotify): Shows information and preview based on application/browser tab
 * 
 * Both toggles are completely independent - one action only affects its own toggle state.
 * Both show "pre-preview" (standby) when nothing is playing.
 */

import { toCleanString, isThenable, safeCall, formatPostMeta } from './shared-utils.js';

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "artist", "episode", "show"]);

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

/**
 * CRITICAL FIX #2: Expanded YouTube detection beyond iframes - check URL hash and window.location
 */
function getActiveYouTubeVideoFromURL() {
  try {
    // Check URL hash for YouTube embed
    const hash = `${window.location.hash}`.trim();
    const idMatch = hash.match(/(?:v=|&v=)([a-zA-Z0-9_-]{11})/i);
    if (idMatch) return { videoId: idMatch[1], title: "YouTube Video", source: "url-hash" };

    // Check URL for YouTube watch URL
    const searchParams = new URLSearchParams(`${window.location.search}`.trim());
    const vParam = searchParams.get("v");
    if (vParam && YOUTUBE_ID_PATTERN.test(vParam)) {
      return { videoId: vParam, title: "YouTube Video", source: "url-param" };
    }

    // Check for short URL in window.location.href
    const fullUrl = `${window.location.href}`.trim();
    const match = fullUrl.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/)([a-zA-Z0-9_-]{11})/i);
    if (match) return { videoId: match[1], title: "YouTube Video", source: "url-href" };

  } catch (e) {
    console.warn("[Hero Preview] YouTube URL detection failed:", e);
  }

  return null;
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

/**
 * Sets preview content in the hero player stage.
 */
function setStageContent(stage, node, key, options = {}) {
  if (!stage || !node) return;

  const normalizedKey = toCleanString(key) || `render-${Date.now()}`;
  const shouldPreserveSameKey = options.preserveSameKey !== false;

  if (shouldPreserveSameKey && stage.firstElementChild && stage.dataset?.heroPreviewKey === normalizedKey) {
    return;
  }

  // Only set data attribute if it exists on stage
  if (stage.dataset) {
    stage.dataset.heroPreviewKey = normalizedKey;
  }
  
  try {
    stage.replaceChildren(node);
  } catch (e) {
    console.warn("[Hero Preview] Failed to replace children:", e);
  }
}

/**
 * Resolves the artwork URL for a post.
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

/**
 * Constructs the DOM element for the preview card.
 */
export function createPreviewCard({ badge = "", title = "", meta = "", note = "", artworkUrl = "" }) {
  try {
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
        'margin-bottom: 2px;';
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
        'padding-top: 4px;';
      copy.appendChild(titleNode);
    }

    card.appendChild(copy);
    attachArtwork(card, title, artworkUrl);
    return card;
  } catch (e) {
    console.warn("[Hero Preview] Failed to create preview card:", e);
    return null;
  }
}

/**
 * Attaches artwork image to preview card with cache invalidation support.
 */
function attachArtwork(card, title, artworkUrl) {
  if (!artworkUrl) return;

  const image = document.createElement("img");
  image.className = "hero-player-preview-image hero-player-large-artwork";
  image.alt = title ? `${title} preview` : "Playback preview";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "strict-origin-when-cross-origin";

  // Use a data attribute to keep track of the current artwork URL - CRITICAL FIX #3: Add cache invalidation support
  card.dataset.currentArtwork = typeof artworkUrl === "string" ? artworkUrl : "async";

  // Add inline styling for larger, more prominent artwork (covers most of the card)
  image.style.cssText =
    'max-width: 100%;' +
    'max-height: 58vh;' +
    'border-radius: 18px;' +
    'object-fit: cover;' +
    'display: block;';

  image.addEventListener("error", () => {
    // If the image fails to load (404), remove it.
    image.remove();
    card.classList.remove("has-image");
    console.warn(`[Hero] Failed to load artwork: ${image.src}`);
  }, { once: true });


  const addImage = (url) => {
    const cleanUrl = toCleanString(url);
    if (!cleanUrl || !card.isConnected) return;
    image.src = cleanUrl;
    if (!image.parentNode) card.prepend(image);
    card.classList.add("has-image");
  };

  if (typeof artworkUrl === "string") {
    image.src = artworkUrl;
    card.prepend(image);
    card.classList.add("has-image");
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
 * Creates a simplified companion/download card.
 */
export function createCompanionCard(options = {}) {
  try {
    const card = document.createElement("article");
    card.className = "hero-player-preview hero-player-companion-card";

    const badgeNode = document.createElement("p");
    badgeNode.className = "hero-player-preview-badge hero-player-badge-compact";
    badgeNode.textContent = "COMPANION BRIDGE";
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
      'margin-bottom: 2px;';
    card.appendChild(badgeNode);

    if (options.artworkUrl) {
      attachArtwork(card, "Companion", options.artworkUrl);
    }

    return card;
  } catch (e) {
    console.warn("[Hero Preview] Failed to create companion card:", e);
    return null;
  }
}

/**
 * Creates a simplified feed post preview card.
 * FEED TOGGLE: Shows feed posts and switches to respective feed post type exclusively
 */
function createFeedPreviewCard({ badge = "", title = "", meta = "" }) {
  try {
    const card = document.createElement("article");
    card.className = "hero-player-preview hero-player-feed-preview";

    const copy = document.createElement("div");
    copy.className = "hero-player-preview-copy";

    if (badge) {
      const badgeNode = document.createElement("p");
      badgeNode.className = "hero-player-preview-badge hero-player-badge-compact";
      badgeNode.textContent = badge;
      badgeNode.style.cssText = 
        'font-size: 0.7rem; ' +
        'font-weight: 600; ' +
        'letter-spacing: 0.5px; ' +
        'text-transform: uppercase; ' +
        'padding: 4px 8px; ' +
        'border-radius: 4px; ' +
        'background: rgba(0,0,0,0.06); ' +
        'color: #333; ' +
        'margin-bottom: 2px;';
      copy.appendChild(badgeNode);
    }

    if (title || meta) {
      const titleNode = document.createElement("p");
      titleNode.className = "hero-player-preview-title";
      titleNode.textContent = `${title} · ${meta}`;
      titleNode.style.cssText = 
        'font-size: 0.8rem; ' +
        'color: #444; ' +
        'padding-top: 6px;';
      copy.appendChild(titleNode);
    }

    card.appendChild(copy);
    return card;
  } catch (e) {
    console.warn("[Hero Preview] Failed to create feed preview:", e);
    return null;
  }
}

/**
 * Creates an empty idle/standby preview.
 * Both toggles show "pre-preview" when nothing is playing.
 */
function createIdleCard(badge, title, meta) {
  try {
    const card = document.createElement("article");
    card.className = "hero-player-preview hero-player-idle-preview";

    const copy = document.createElement("div");
    copy.className = "hero-player-preview-copy";

    if (badge) {
      const badgeNode = document.createElement("p");
      badgeNode.className = "hero-player-preview-badge hero-player-badge-compact";
      badgeNode.textContent = badge;
      badgeNode.style.cssText = 
        'font-size: 0.7rem; ' +
        'font-weight: 600; ' +
        'letter-spacing: 0.5px; ' +
        'text-transform: uppercase; ' +
        'padding: 4px 8px; ' +
        'border-radius: 4px; ' +
        'background: rgba(0,0,0,0.06); ' +
        'color: #333; ' +
        'margin-bottom: 2px;';
      copy.appendChild(badgeNode);
    }

    if (title || meta) {
      const titleNode = document.createElement("p");
      titleNode.className = "hero-player-preview-title hero-player-text-fade";
      titleNode.textContent = `${title} · ${meta}`;
      titleNode.style.cssText = 
        'font-size: 0.75rem; ' +
        'color: #666; ' +
        'opacity: 0.8; ' +
        'padding-top: 4px;';
      copy.appendChild(titleNode);
    }

    card.appendChild(copy);
    return card;
  } catch (e) {
    console.warn("[Hero Preview] Failed to create idle card:", e);
    return null;
  }
}

/**
 * Creates a simplified companion/download card.
 */
export function createActivePlayerStage(descriptor) {
  if (!descriptor?.src) return null;

  try {
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
  } catch (e) {
    console.warn("[Hero Preview] Failed to create active player stage:", e);
    return null;
  }
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
        : "display:block;border-radius:18px;background:#000;object-fit:contain;width:100%;height:100%;"

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
 * Handles Feed Toggle Mode - FEED TOGGLE: Shows/feed posts and switches to respective feed post type exclusively
 */
function handleFeedToggleMode(options = {}) {
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

  // Detect current source filter for feed mode
  const sourceFilter = (state?.heroControlSource || state?.heroMediaSource || "").toLowerCase();
  
  // Determine feed post type based on source
  let badge = "FEED MODE";
  let title = "";
  let meta = "";

  if (post) {
    const providerLabel = post.sourceKind === "youtube" ? "YOUTUBE POST" : 
                         post.sourceKind === "spotify" ? "SPOTIFY POST" : 
                         "APP MEDIA";
    
    badge = `${providerLabel} · ${state.heroControlMode.toUpperCase()}`;
    title = post?.title || "";
    meta = post?.creator || state.currentUser?.name || "Signal Share";

    // Check for active player first (active feed post)
    const isActivePlayer = commitActivePlayer(stage, post, options);
    if (isActivePlayer) return;

  } else {
    // No active feed post - check if we can show system media preview if a source toggle is active and matches
    const isYouTubeMode = (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube" || state?.systemMediaSource === "youtube");
    const isSpotifyActive = (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify" || state?.systemMediaSource === "spotify");
    
    if (isSpotifyActive || isYouTubeMode) {
      const result = handleMediaToggleMode({
        post: null,
        desktopSnapshot,
        nativeSnapshot,
        matchedPost: null,
        parseYouTubeUrl,
        resolveActivePlayerSource,
        getSpotifyPreviewImageUrl,
        isYouTubeMode,
        isSpotifyActive,
      });

      if (result && result.node) {
        const isIdleResult = result.key && (result.key.includes("READY") || result.key.includes("idle") || result.key.includes("Select a source"));
        if (!isIdleResult) {
          setStageContent(stage, result.node, result.key);
          return;
        }
      }
    }

    // No active post - show idle/pre-preview state for feed mode
    commitCard(stage, {
      badge: "FEED MODE · READY",
      title: "Browse posts to start playback",
      meta: "Switch sources via toggle button"
    });
    return;
  }

  // Get artwork for feed post
  const creatorSummary = safeCall(getProfileSummaryForPost, null, post);
  const artworkUrl = resolveAppPreviewArtwork(post, {
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });

  // Create and commit feed preview card
  commitCard(stage, {
    badge: badge,
    title: title || "",
    meta: meta || "",
    artworkUrl: artworkUrl,
    showMetadata: false
  });
}

/**
 * Handles Media Toggle Mode (YouTube/Spotify toggle) - MEDIA TOGGLE: Shows information and preview based on app/browser tab
 */
function handleMediaToggleMode(options = {}) {
  const {
    post,
    desktopSnapshot,
    nativeSnapshot,
    matchedPost,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
    isYouTubeMode,
    isSpotifyActive,
  } = options;

  // Helper functions to identify Spotify or YouTube in SMTC snapshots
  const isYouTubeSnapshot = (snapshot) => {
    if (!snapshot) return false;
    const provider = (snapshot.sourceProvider || "").toLowerCase();
    const appPkg = (snapshot.appPackage || "").toLowerCase();
    const title = (snapshot.title || "").toLowerCase();
    const meta = (snapshot.meta || "").toLowerCase();
    return provider === "youtube" || appPkg.includes("youtube") || appPkg.includes("ytmusic") || title.includes("youtube") || meta.includes("youtube");
  };

  const isSpotifySnapshot = (snapshot) => {
    if (!snapshot) return false;
    const provider = (snapshot.sourceProvider || "").toLowerCase();
    const appPkg = (snapshot.appPackage || "").toLowerCase();
    const title = (snapshot.title || "").toLowerCase();
    const meta = (snapshot.meta || "").toLowerCase();
    return provider === "spotify" || appPkg.includes("spotify") || title.includes("spotify") || meta.includes("spotify");
  };

  const hasSnapshotPlaybackContext = (snapshot) => {
    if (!snapshot) return false;
    if (snapshot.active) return true;
    const playbackState = `${snapshot.playbackState || ""}`.trim().toLowerCase();
    if (playbackState && playbackState !== "none") return true;
    if (typeof snapshot.title === "string" && snapshot.title.trim()) return true;
    if (typeof snapshot.meta === "string" && snapshot.meta.trim()) return true;
    return false;
  };

  const isBrowserFamilyPackage = (value = "") => {
    const appPkg = `${value || ""}`.toLowerCase();
    return (
      appPkg.includes("chrome")
      || appPkg.includes("msedge")
      || appPkg.includes("edge")
      || appPkg.includes("firefox")
      || appPkg.includes("opera")
      || appPkg.includes("brave")
      || appPkg.includes("vivaldi")
      || appPkg.includes("arc")
      || appPkg.includes("browser")
      || appPkg.includes("yandex")
    );
  };

  const isOtherBrowserSnapshot = (snapshot) => {
    if (!snapshot) return false;
    if (!hasSnapshotPlaybackContext(snapshot)) return false;
    if (isYouTubeSnapshot(snapshot) || isSpotifySnapshot(snapshot)) return false;
    const provider = `${snapshot.sourceProvider || ""}`.toLowerCase();
    if (provider === "browser" || provider === "web") return true;
    return isBrowserFamilyPackage(snapshot.appPackage || "");
  };

  // Check for active YouTube video from browser tab first (Media Toggle)
  const youtubeFromTab = getActiveYouTubeVideoFromURL();

  // Handle YouTube Mode Preview (when YouTube toggle is active)
  if (isYouTubeMode) {
    // 1. Check for active desktop/system snapshot representing YouTube first
    const activeSnapshot = isYouTubeSnapshot(nativeSnapshot) ? nativeSnapshot : (isYouTubeSnapshot(desktopSnapshot) ? desktopSnapshot : null);
    if (activeSnapshot && (activeSnapshot.active || activeSnapshot.title)) {
      const playbackStatus = activeSnapshot.playbackState || "playing";
      return createCardResult({
        badge: `YOUTUBE · ${playbackStatus.toUpperCase()}`,
        title: activeSnapshot.title || "YouTube Video",
        meta: activeSnapshot.meta || "YouTube Player",
        artworkUrl: activeSnapshot.artworkUri || "",
      });
    }

    // 2. Check for active video in YouTube player first
    if (post && post.sourceKind === "youtube") {
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
          badge: "YOUTUBE ACTIVE",
          title: post?.title || matchedPost?.title || "",
          meta: matchedPost?.creator || post?.creator || "Signal Share",
          artworkUrl: resolvedMetadata,
        });
      }
    }

    // 3. If no explicit YouTube post, check browser tab for active video
    if (youtubeFromTab) {
      console.log("[Media Toggle] Found YouTube video in browser tab:", youtubeFromTab.title);
      return createCardResult({
        badge: "BROWSER YOUTUBE",
        title: youtubeFromTab.title || "YouTube Video",
        meta: `Source: ${youtubeFromTab.source.toUpperCase()}`,
        artworkUrl: `https://i.ytimg.com/vi/${youtubeFromTab.videoId}/hqdefault.jpg`,
      });
    }

    // If no active YouTube video, show idle state
    return createCardResult({
      badge: "YOUTUBE · READY",
      title: "Open a YouTube video to play",
      meta: "Or switch to Spotify in the toggle menu",
    });
  }

  // Handle Spotify Mode Preview (when Spotify toggle is active)
  if (isSpotifyActive) {
    // 1. Check for active desktop/system snapshot representing Spotify first
    const activeSnapshot = isSpotifySnapshot(nativeSnapshot) ? nativeSnapshot : (isSpotifySnapshot(desktopSnapshot) ? desktopSnapshot : null);
    if (activeSnapshot && (activeSnapshot.active || activeSnapshot.title)) {
      const playbackStatus = activeSnapshot.playbackState || "playing";
      return createCardResult({
        badge: `SPOTIFY · ${playbackStatus.toUpperCase()}`,
        title: activeSnapshot.title || "Spotify Track",
        meta: activeSnapshot.meta || "Spotify Player",
        artworkUrl: activeSnapshot.artworkUri || "",
      });
    }

    // 2. Check for explicit post
    if (post && post.sourceKind === "spotify") {
      const cleanTitle = toCleanString(post.title || "");
      const cleanCreator = toCleanString(post.creator || "");

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
          badge: "SPOTIFY ACTIVE",
          title: post?.title || matchedPost?.title || "",
          meta: matchedPost?.creator || post?.creator || "Signal Share",
          artworkUrl: resolvedMetadata,
        });
      }
    }

    // 3. Check for active Spotify in browser tab (Media Toggle)
    const metadata = safeCall(getBrowserMediaMetadata, null);
    if (metadata?.artworkUrl && metadata.title) {
      console.log("[Media Toggle] Found Spotify track in browser tab");
      return createCardResult({
        badge: "BROWSER SPOTIFY",
        title: metadata.title || "Spotify Track",
        meta: metadata.artist || metadata.creator || "Spotify",
        artworkUrl: metadata.artworkUrl,
      });
    }

    // Default Spotify idle state
    return createCardResult({
      badge: "SPOTIFY · READY",
      title: "Open Spotify to play",
      meta: "Or switch to YouTube in the toggle menu",
    });
  }

  // "Any" / no-toggle branch: show non-YouTube/non-Spotify browser media.
  const genericBrowserSnapshot = isOtherBrowserSnapshot(nativeSnapshot)
    ? nativeSnapshot
    : (isOtherBrowserSnapshot(desktopSnapshot) ? desktopSnapshot : null);

  if (genericBrowserSnapshot) {
    const playbackStatus = (genericBrowserSnapshot.playbackState || "playing").toUpperCase();
    return createCardResult({
      badge: `BROWSER MEDIA · ${playbackStatus}`,
      title: genericBrowserSnapshot.title || "Now playing in browser",
      meta: genericBrowserSnapshot.meta || "Media session",
      artworkUrl: genericBrowserSnapshot.artworkUri || "",
    });
  }

  const browserMetadata = safeCall(getBrowserMediaMetadata, null);
  const browserTitle = toCleanString(browserMetadata?.title || "");
  const browserArtist = toCleanString(browserMetadata?.artist || browserMetadata?.creator || "");
  const browserBlob = `${browserTitle} ${browserArtist}`.toLowerCase();
  const isExcludedSource = browserBlob.includes("youtube") || browserBlob.includes("spotify");

  if (browserTitle && !isExcludedSource) {
    return createCardResult({
      badge: "BROWSER MEDIA · PLAYING",
      title: browserTitle,
      meta: browserArtist || "Media session",
      artworkUrl: browserMetadata?.artworkUrl || "",
    });
  }

  // Return idle state if no active source found (for Media Toggle)
  return createCardResult({
    badge: "MEDIA · ANY SOURCE",
    title: "Play media in another browser tab",
    meta: "YouTube and Spotify are hidden in this view",
  });
}

/**
 * Creates a preview card result.
 */
function createCardResult(cardOptions) {
  try {
    return {
      key: getCardKey(cardOptions),
      node: createPreviewCard(cardOptions),
    };
  } catch (e) {
    console.warn("[Hero Preview] Failed to create card result:", e);
    return null;
  }
}

function commitCard(stage, cardOptions) {
  const result = createCardResult(cardOptions);
  if (!result || !result.node) return;
  setStageContent(stage, result.node, result.key);
}

/**
 * Main entry point for hero stage preview rendering.
 * Implements INDEPENDENT toggle functionality:
 * - Feed Toggle (Feed/Media): Shows/feed posts exclusively
 * - Media Toggle (YouTube/Spotify): Shows app/browser tab info exclusively
 */
export function renderHeroStagePreview(options = {}) {
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

  // Get configuration for mode detection
  const config = window.SIGNAL_SHARE_HERO_PLAYER_CONFIG || {};
  const heroControlMode = config.heroControlMode || "feed";
  
  // Determine active sources for media toggle mode
  const isYouTubeMode = (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube" || state?.systemMediaSource === "youtube");
  const isSpotifyActive = (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify" || state?.systemMediaSource === "spotify");
  
  // Check for native snapshot (preferred source)
  let preferredSnapshot = null;
  if (hasNativeSnapshotBridge()) {
    const bridge = getNativeBridge();
    if (bridge?.getNowPlayingSnapshot) {
      const source = state?.heroControlSource || "spotify";
      const snapshotData = bridge.getNowPlayingSnapshot(source);
      try {
        const parsed = JSON.parse(snapshotData);
        preferredSnapshot = normalizeNativeSnapshot(parsed);
      } catch {}
    }
  }

  // CRITICAL INDEPENDENCE: Handle each toggle mode exclusively
  if (config.heroControlMode === "feed" || state?.heroControlMode === "feed") {
    // FEED TOGGLE MODE: Show feed posts exclusively, independent of media toggle
    handleFeedToggleMode({
      stage,
      mode,
      post,
      fallbackMedia,
      nativeSnapshot: preferredSnapshot,
      desktopSnapshot,
      getStandbyPreviewPost,
      state,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });
  } else if (config.heroControlMode === "media" || state?.heroControlMode === "media") {
    // MEDIA TOGGLE MODE: Show YouTube/Spotify info exclusively, independent of feed toggle
    const result = handleMediaToggleMode({
      post,
      desktopSnapshot,
      nativeSnapshot: preferredSnapshot,
      matchedPost: null,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
      isYouTubeMode,
      isSpotifyActive,
    });
    if (result && result.node) {
      setStageContent(stage, result.node, result.key);
    }
  } else {
    // Default mode - try standard rendering
    renderStandardPreview({
      stage,
      mode,
      post,
      fallbackMedia,
      nativeSnapshot: preferredSnapshot,
      desktopSnapshot,
      getStandbyPreviewPost,
      state,
      parseYouTubeUrl,
      resolveActivePlayerSource,
      getSpotifyPreviewImageUrl,
    });
  }
}

/**
 * Standard preview rendering (fallback for non-toggle modes).
 */
function renderStandardPreview(options = {}) {
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

  // Standard rendering logic for non-toggle modes
  const standbyPost = (!post && typeof getStandbyPreviewPost === "function")
    ? safeCall(getStandbyPreviewPost, null)
    : null;

  if (mode === "device") {
    const playbackStatus = nativeSnapshot?.playbackState || "";
    const badge = nativeSnapshot?.active 
      ? `ON-DEVICE · ${playbackStatus.toUpperCase()}` 
      : "ON-DEVICE MEDIA";

    commitCard(stage, {
      badge: badge,
      title: nativeSnapshot?.title || post?.title || "",
      meta: nativeSnapshot?.meta || post?.creator || "",
      artworkUrl: post ? resolveAppPreviewArtwork(post, options) : (nativeSnapshot?.artworkUri || "")
    });
    return;
  }

  if (mode === "desktop") {
    const playbackStatus = desktopSnapshot?.playbackState || "";
    const snapshotProvider = (desktopSnapshot?.sourceProvider || "").toLowerCase();
    
    let platformLabel = post ? formatPostBadge(post, formatKind(getSignalLabel)) : "PC SYSTEM MEDIA";
    if (snapshotProvider === "youtube" || state?.heroMediaSource === "youtube") {
      platformLabel = "YOUTUBE";
    } else if (snapshotProvider === "spotify" || state?.heroMediaSource === "spotify") {
      platformLabel = "SPOTIFY";
    }

    let artworkUrl = desktopSnapshot?.artworkUri || (post ? resolveAppPreviewArtwork(post, options) : "");

    const badge = post 
      ? platformLabel 
      : `${platformLabel} · ${playbackStatus.toUpperCase()}`;

    commitCard(stage, {
      badge: badge,
      title: desktopSnapshot?.title || post?.title || "",
      meta: desktopSnapshot?.meta || post?.creator || "",
      artworkUrl: artworkUrl
    });

    return;
  }

  if (!post) {
    const metadata = safeCall(getBrowserMediaMetadata, null);
    commitStandbyOrFallback(stage, standbyPost, options, {
      badge: "NOW PLAYING",
      title: "",
      meta: "",
      artworkUrl: metadata?.artworkUrl || fallbackMedia?.getAttribute("data-artwork") || ""
    });
    return;
  }

  const creatorSummary = safeCall(getProfileSummaryForPost, null, post);
  const artworkUrl = resolveAppPreviewArtwork(post, {
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getSpotifyPreviewImageUrl,
  });

  commitCard(stage, {
    badge: "NOW PLAYING",
    title: "",
    meta: "",
    artworkUrl: artworkUrl,
    showMetadata: true
  });
}

function canUseFallbackMedia(fallbackMedia) {
  return typeof HTMLMediaElement !== "undefined" && fallbackMedia instanceof HTMLMediaElement;
}

/**
 * Normalizes native snapshot data.
 */
function normalizeNativeSnapshot(raw = {}) {
  const playbackState = raw.playbackState || raw.playback?.state || "none";
  return {
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    meta: typeof raw.meta === "string" ? raw.meta.trim() : "",
    appPackage: typeof raw.appPackage === "string" ? raw.appPackage.trim() : "",
    openUri: typeof raw.openUri === "string" ? raw.openUri.trim() : "",
    artworkUri: typeof raw.artworkUri === "string" ? raw.artworkUri.trim() : "",
    active: Boolean(raw.active),
    playbackState,
  };
}

/**
 * Checks for native snapshot bridge availability.
 */
function hasNativeSnapshotBridge() {
  return (window?.NativeBridge && typeof window.NativeBridge === "object" && 
          typeof window.NativeBridge.getNowPlayingSnapshot === "function");
}

/**
 * Gets the native snapshot bridge instance.
 */
function getNativeBridge() {
  return window?.NativeBridge && typeof window.NativeBridge === "object" ? window.NativeBridge : null;
}

/**
 * Creates a simplified standby/idle preview card for fallback scenarios.
 */
function createPostStandbyPreview(post, options = {}) {
  if (!post) return null;
  
  const providerLabel = post.sourceKind === "youtube" ? "YOUTUBE" : 
                       post.sourceKind === "spotify" ? "SPOTIFY" : "APPMEDIA";
  
  const badge = `${providerLabel} PREVIEW`;
  const artworkUrl = resolveAppPreviewArtwork(post, options);

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

function commitStandbyOrFallback(stage, standbyPost, previewOptions, fallbackCardOptions) {
  const standby = createPostStandbyPreview(standbyPost, previewOptions);
  if (standby && standby.node) {
    setStageContent(stage, standby.node, standby.key);
    return;
  }
  commitCard(stage, fallbackCardOptions);
}

/**
 * Helper function to get signal label for formatting.
 */
function getSignalLabel() {
  return "SIGNAL SHARE";
}

/**
 * Helper function to format post badge.
 */
function formatKind(label) {
  if (!label) return "";
  const lower = label.toLowerCase();
  if (lower.includes("spotify")) return "SPOTIFY";
  if (lower.includes("youtube") || lower.includes("video")) return "VIDEO";
  if (lower.includes("audio")) return "AUDIO";
  if (lower.includes("track")) return "TRACK";
  return label;
}

/**
 * Helper function to format post badge.
 */
function formatPostBadge(post, kindFn, getSignalLabel) {
  if (!post) return "";
  const label = kindFn(post.sourceKind);
  return label || post.sourceKind?.toUpperCase() || "MEDIA";
}

/**
 * Helper function to get browser media metadata.
 */
function getBrowserMediaMetadata() {
  // Implementation would go here for browser SMTC API integration
  try {
    if (navigator.mediaSession) {
      const metadata = navigator.mediaSession.metadata;
      if (metadata?.title && metadata?.artist) {
        return {
          title: metadata.title,
          artist: metadata.artist,
          artworkUrl: metadata?.artwork?.src || "",
          openUri: "",
          appPackage: "",
          sourceProvider: "",
        };
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Render preview for YouTube/Spotify toggle mode (Media Toggle).
 */
export function renderMediaTogglePreview(options = {}) {
  const {
    stage,
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

  // For media toggle, try to render from both sources
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

    if (result && result?.node) {
      setStageContent(stage, result.node, result.key);
      return;
    }

    // Fallback to idle state
    const preferredSource = (isSpotifyActive && isYouTubeMode) ? "Both" : 
                           (isSpotifyActive ? "Spotify" : 
                            (isYouTubeMode ? "YouTube" : "Ready"));
    commitCard(stage, {
      badge: `TOGGLE MODE · ${preferredSource.toUpperCase()}`,
      title: "Ready for playback",
      meta: isYouTubeMode ? "Open YouTube or Spotify to begin" : "Select a source above",
    });
    return;
  }

  // Standard rendering for non-toggle modes
  renderStandardPreview({
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
