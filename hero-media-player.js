export function createHeroMediaPlayerController(options) {
  const {
    state,
    elements,
    getControllablePlayerPost,
    getActivePlayerMediaElement,
    getPlayableVisiblePostIds,
    getAllPosts,
    getPostById,
    getProfileSummaryForPost,
    formatKind,
    getSignalLabel,
    formatTimestamp,
    normalizePlayerVolume,
    savePlayerVolume,
    applyPlayerVolumeToActiveElement,
    stepMiniPlayer,
    renderMiniPlayer,
    postMessageToYouTubePlayer,
    getSpotifyPreviewImageUrl,
    parseYouTubeUrl,
    resolveActivePlayerSource,
  } = options;

  const NATIVE_ACTION_PLAY_PAUSE = "play_pause";
  const NATIVE_ACTION_NEXT = "next";
  const NATIVE_ACTION_PREVIOUS = "previous";
  const NATIVE_POLL_INTERVAL_MS = 3000;
  const DESKTOP_ACTION_PLAY_PAUSE = "play_pause";
  const DESKTOP_ACTION_NEXT = "next";
  const DESKTOP_ACTION_PREVIOUS = "previous";
  const DESKTOP_POLL_INTERVAL_MS = 3000;

  let listenersAttached = false;
  let nativeSnapshot = null;
  let nativePollTimerId = 0;
  let desktopSnapshot = null;
  let desktopPollTimerId = 0;
  let desktopSnapshotEndpoint = "";
  let desktopActionEndpoint = "";
  let desktopPollFailureCount = 0;
  let pendingDesktopArtworkKey = "";
  const desktopArtworkFallbackCache = new Map();

  function hasUi() {
    return Boolean(
      elements.heroPlayerTitle
      && elements.heroPlayerCaption
      && elements.heroPlayerStatus
      && elements.heroPlayerStage
      && elements.heroPlayerPlayPauseButton
      && elements.heroPlayerPrevButton
      && elements.heroPlayerNextButton
      && elements.heroPlayerVolumeSlider
      && elements.heroPlayerVolumeValue
    );
  }

  function normalizePlaybackState(value) {
    const normalized = `${value || ""}`.trim().toLowerCase();
    if (normalized === "playing") return "playing";
    if (normalized === "paused") return "paused";
    return "none";
  }

  function normalizeText(value = "") {
    return `${value || ""}`.trim().toLowerCase();
  }

  function getNativeBridge() {
    return window.NativeBridge && typeof window.NativeBridge === "object" ? window.NativeBridge : null;
  }

  function hasNativeSnapshotBridge() {
    const bridge = getNativeBridge();
    return Boolean(bridge && typeof bridge.getNowPlayingSnapshot === "function");
  }

  function hasNativeActionBridge() {
    const bridge = getNativeBridge();
    return Boolean(bridge && typeof bridge.performNowPlayingAction === "function");
  }

  function hasNativeOpenBridge() {
    const bridge = getNativeBridge();
    return Boolean(bridge && typeof bridge.openNowPlayingMediaApp === "function");
  }

  function hasNativeSettingsBridge() {
    const bridge = getNativeBridge();
    return Boolean(bridge && typeof bridge.openNowPlayingAccessSettings === "function");
  }

  function normalizeNativeSnapshot(raw = {}) {
    const playbackState = normalizePlaybackState(raw.playbackState || (raw.active ? "playing" : "none"));
    return {
      title: typeof raw.title === "string" ? raw.title.trim() : "",
      meta: typeof raw.meta === "string" ? raw.meta.trim() : "",
      appPackage: typeof raw.appPackage === "string" ? raw.appPackage.trim() : "",
      openUri: typeof raw.openUri === "string" ? raw.openUri.trim() : "",
      artworkUri: typeof raw.artworkUri === "string" ? raw.artworkUri.trim() : "",
      active: Boolean(raw.active),
      permissionRequired: Boolean(raw.permissionRequired),
      playbackState,
    };
  }

  function readNativeSnapshot() {
    if (!hasNativeSnapshotBridge()) return null;
    const bridge = getNativeBridge();
    try {
      const payload = bridge.getNowPlayingSnapshot();
      if (typeof payload !== "string" || !payload.trim()) return null;
      const parsed = JSON.parse(payload);
      return normalizeNativeSnapshot(parsed);
    } catch {
      return null;
    }
  }

  function refreshNativeSnapshot({ renderAfter = true } = {}) {
    nativeSnapshot = readNativeSnapshot();
    if (renderAfter) render();
    return nativeSnapshot;
  }

  function startNativeSnapshotPolling() {
    if (nativePollTimerId || !hasNativeSnapshotBridge()) return;
    refreshNativeSnapshot({ renderAfter: false });
    nativePollTimerId = window.setInterval(() => {
      if (document.hidden) return;
      refreshNativeSnapshot();
    }, NATIVE_POLL_INTERVAL_MS);
  }

  function stopNativeSnapshotPolling() {
    if (!nativePollTimerId) return;
    window.clearInterval(nativePollTimerId);
    nativePollTimerId = 0;
  }

  function shouldUseNativeMode(post) {
    if (!nativeSnapshot) return false;
    const hasAppPlaybackSession = Boolean(post)
      || getActivePlayerMediaElement() instanceof HTMLMediaElement
      || getFallbackPageMediaElement() instanceof HTMLMediaElement;
    const canBootstrapAppPlayback = !post && getPlayableVisiblePostIds().length > 0;
    if (hasAppPlaybackSession || canBootstrapAppPlayback) return false;
    if (nativeSnapshot.permissionRequired) return true;
    if (nativeSnapshot.active) return true;
    if (!post && hasNativeActionBridge()) return true;
    return false;
  }

  function canUseDesktopBridge() {
    if (hasNativeSnapshotBridge()) return false;
    if (typeof window.fetch !== "function") return false;
    const configuredEndpoint = typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string"
      && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim();
    const configuredBaseUrl = typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL === "string"
      && window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim();
    if (configuredEndpoint || configuredBaseUrl) return true;

    const protocol = `${window.location.protocol || ""}`.toLowerCase();
    if (protocol === "file:") return true;
    return protocol === "http:" || protocol === "https:";
  }

  function pushDesktopEndpointCandidate(candidates, candidate, seen) {
    if (typeof candidate !== "string") return;
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  }

  function getDesktopSnapshotEndpoint() {
    if (desktopSnapshotEndpoint) return desktopSnapshotEndpoint;
    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim()) {
      return window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim();
    }
    return "/api/system-media/current";
  }

  function resolveDesktopSnapshotEndpoints() {
    const candidates = [];
    const seen = new Set();
    pushDesktopEndpointCandidate(candidates, desktopSnapshotEndpoint, seen);

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim()) {
      pushDesktopEndpointCandidate(candidates, window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim(), seen);
    }

    try {
      pushDesktopEndpointCandidate(candidates, new URL("/api/system-media/current", window.location.href).toString(), seen);
    } catch {
      pushDesktopEndpointCandidate(candidates, "/api/system-media/current", seen);
    }

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim()) {
      const baseUrl = window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim().replace(/\/+$/, "");
      pushDesktopEndpointCandidate(candidates, `${baseUrl}/api/system-media/current`, seen);
    }

    // Always try loopback candidates so desktop control still works when the app
    // UI runs on a different localhost port than the Node media bridge.
    pushDesktopEndpointCandidate(candidates, "http://127.0.0.1:3000/api/system-media/current", seen);
    pushDesktopEndpointCandidate(candidates, "http://localhost:3000/api/system-media/current", seen);

    if (!candidates.length) {
      pushDesktopEndpointCandidate(candidates, "/api/system-media/current", seen);
    }
    return candidates;
  }

  function deriveDesktopActionEndpoint(snapshotEndpoint) {
    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ACTION_ENDPOINT === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_ACTION_ENDPOINT.trim()) {
      return window.SIGNAL_SHARE_SYSTEM_MEDIA_ACTION_ENDPOINT.trim();
    }
    if (!snapshotEndpoint) return "/api/system-media/action";
    try {
      const url = new URL(snapshotEndpoint, window.location.href);
      url.pathname = url.pathname.replace(/\/current$/i, "/action");
      return url.toString();
    } catch {
      if (snapshotEndpoint.endsWith("/current")) {
        return `${snapshotEndpoint.slice(0, -"/current".length)}/action`;
      }
      return "/api/system-media/action";
    }
  }

  function getDesktopActionEndpoint() {
    if (desktopActionEndpoint) return desktopActionEndpoint;
    return deriveDesktopActionEndpoint(getDesktopSnapshotEndpoint());
  }

  function escapeRegex(value = "") {
    return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getAppPackageVariants(appPackage = "") {
    const value = `${appPackage || ""}`.trim();
    if (!value) return [];
    const variants = new Set();
    variants.add(value);
    variants.add(value.replace(/!.*$/, ""));
    variants.add(value.replace(/\.\d+$/, ""));
    variants.add(value.replace(/\.exe$/i, ""));
    variants.add(value.replace(/_[a-z0-9]+$/i, ""));
    return Array.from(variants)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  function sanitizeSnapshotMeta(rawMeta = "", appPackage = "") {
    let meta = `${rawMeta || ""}`.replace(/\s+/g, " ").trim();
    if (!meta) return "";

    for (const variant of getAppPackageVariants(appPackage)) {
      const prefixPattern = new RegExp(`^${escapeRegex(variant)}\\s*(?:[-:|]\\s*)?`, "i");
      const stripped = meta.replace(prefixPattern, "").trim();
      if (stripped && stripped !== meta) {
        meta = stripped;
        break;
      }
    }

    const genericPrefixPattern = /^(?:spotify[a-z0-9._!-]*|operasoftware\.[a-z0-9._!-]*|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?)\s*(?:[-:|]\s*)?/i;
    const genericStripped = meta.replace(genericPrefixPattern, "").trim();
    if (genericStripped) meta = genericStripped;

    return meta;
  }

  function normalizeDesktopSnapshot(raw = {}) {
    const appPackage = typeof raw.appPackage === "string" ? raw.appPackage.trim() : "";
    const playbackState = normalizePlaybackState(raw.playbackState || (raw.active ? "playing" : "none"));
    return {
      source: `${raw.source || "windows-smtc"}`.trim(),
      available: Boolean(raw.available),
      active: Boolean(raw.active),
      permissionRequired: false,
      title: typeof raw.title === "string" ? raw.title.trim() : "",
      meta: sanitizeSnapshotMeta(raw.meta, appPackage),
      appPackage,
      openUri: typeof raw.openUri === "string" ? raw.openUri.trim() : "",
      artworkUri: typeof raw.artworkUri === "string" ? raw.artworkUri.trim() : "",
      playbackState,
    };
  }

  function getDesktopSnapshotArtworkKey(snapshot = {}) {
    const app = normalizeText(snapshot.appPackage);
    const title = normalizeText(snapshot.title);
    const meta = normalizeText(snapshot.meta);
    if (!app && !title && !meta) return "";
    return `${app}|${title}|${meta}`;
  }

  function getSpotifyFallbackCandidates(snapshot, post) {
    const candidates = [];
    const seenIds = new Set();
    const snapshotTitle = normalizeText(snapshot?.title);
    const snapshotMeta = normalizeText(snapshot?.meta);

    const pushCandidate = (candidate) => {
      if (!candidate || candidate.sourceKind !== "spotify") return;
      const id = `${candidate.id || ""}`.trim() || `${candidate.externalId || candidate.embedUrl || candidate.externalUrl || ""}`.trim();
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);
      candidates.push(candidate);
    };

    pushCandidate(post);
    pushCandidate(getControllablePlayerPost());
    pushCandidate(getStandbyPreviewPost());

    if (typeof getAllPosts === "function") {
      const posts = getAllPosts();
      if (Array.isArray(posts) && posts.length) {
        const scored = posts
          .filter((entry) => entry?.sourceKind === "spotify")
          .map((entry) => {
            const title = normalizeText(entry.title);
            let score = 0;
            if (snapshotTitle && title === snapshotTitle) score += 6;
            if (snapshotTitle && (title.includes(snapshotTitle) || snapshotTitle.includes(title))) score += 4;
            if (snapshotMeta && title.includes(snapshotMeta)) score += 3;
            if (snapshotMeta && normalizeText(entry.creator).includes(snapshotMeta)) score += 2;
            return { entry, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);

        for (const item of scored) pushCandidate(item.entry);
      }
    }

    return candidates;
  }

  async function hydrateDesktopSpotifyArtwork(snapshot, post) {
    if (!snapshot || snapshot.artworkUri) return;
    if (typeof getSpotifyPreviewImageUrl !== "function") return;
    const appPackage = normalizeText(snapshot.appPackage);
    if (!appPackage.includes("spotify")) return;

    const snapshotKey = getDesktopSnapshotArtworkKey(snapshot);
    if (!snapshotKey || pendingDesktopArtworkKey === snapshotKey) return;

    const cachedArtwork = desktopArtworkFallbackCache.get(snapshotKey);
    if (cachedArtwork) {
      snapshot.artworkUri = cachedArtwork;
      render();
      return;
    }

    pendingDesktopArtworkKey = snapshotKey;
    const candidates = getSpotifyFallbackCandidates(snapshot, post);
    for (const candidate of candidates) {
      const source = {
        provider: "spotify",
        title: candidate.title || "",
        externalId: candidate.externalId || "",
        externalUrl: candidate.externalUrl || "",
        originalUrl: candidate.externalUrl || "",
        embedUrl: candidate.embedUrl || "",
        label: candidate.label || "",
      };
      const artworkUrl = await getSpotifyPreviewImageUrl(source).catch(() => "");
      if (artworkUrl && getDesktopSnapshotArtworkKey(snapshot) === snapshotKey) {
        desktopArtworkFallbackCache.set(snapshotKey, artworkUrl);
        snapshot.artworkUri = artworkUrl;
        pendingDesktopArtworkKey = "";
        render();
        return;
      }
    }

    pendingDesktopArtworkKey = "";
  }

  async function readDesktopSnapshot() {
    if (!canUseDesktopBridge()) return null;
    let lastError = null;
    const endpoints = resolveDesktopSnapshotEndpoints();
    for (const endpoint of endpoints) {
      try {
        const response = await window.fetch(endpoint, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) throw new Error(`Desktop media endpoint returned ${response.status}.`);
        const payload = await response.json();
        desktopSnapshotEndpoint = endpoint;
        desktopActionEndpoint = deriveDesktopActionEndpoint(endpoint);
        return normalizeDesktopSnapshot(payload);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Desktop media endpoint is unavailable.");
  }

  function refreshDesktopSnapshot({ renderAfter = true } = {}) {
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      return Promise.resolve(null);
    }
    return readDesktopSnapshot()
      .then((snapshot) => {
        desktopSnapshot = snapshot;
        desktopPollFailureCount = 0;
        if (renderAfter) render();
        return desktopSnapshot;
      })
      .catch(() => {
        desktopSnapshot = null;
        desktopPollFailureCount += 1;
        if (renderAfter) render();
        return null;
      });
  }

  function startDesktopSnapshotPolling() {
    if (desktopPollTimerId || !canUseDesktopBridge()) return;
    refreshDesktopSnapshot({ renderAfter: false });
    desktopPollTimerId = window.setInterval(() => {
      if (document.hidden) return;
      refreshDesktopSnapshot();
    }, DESKTOP_POLL_INTERVAL_MS);
  }

  function stopDesktopSnapshotPolling() {
    if (!desktopPollTimerId) return;
    window.clearInterval(desktopPollTimerId);
    desktopPollTimerId = 0;
  }

  function shouldUseDesktopMode(post) {
    if (!desktopSnapshot) return false;
    if (desktopSnapshot.active) return true;
    if (!post && desktopSnapshot.available) return true;
    return false;
  }

  function getFallbackPageMediaElement() {
    const activeMedia = getActivePlayerMediaElement();
    const candidates = Array.from(document.querySelectorAll("audio, video"));
    let firstCandidate = null;
    for (const element of candidates) {
      if (!(element instanceof HTMLMediaElement)) continue;
      if (element === activeMedia) continue;
      if (element.dataset?.heroPreview === "true") continue;
      if (!element.currentSrc && !element.src) continue;
      if (!firstCandidate) firstCandidate = element;
      if (!element.paused && !element.ended) return element;
    }
    return firstCandidate;
  }

  function getBrowserMediaMetadata() {
    if (!("mediaSession" in navigator)) return null;
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) return null;
    const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
    const artist = typeof metadata.artist === "string" ? metadata.artist.trim() : "";
    const album = typeof metadata.album === "string" ? metadata.album.trim() : "";
    let artworkUrl = "";
    for (const artwork of Array.from(metadata.artwork || [])) {
      const candidate = typeof artwork?.src === "string" ? artwork.src.trim() : "";
      if (candidate) {
        artworkUrl = candidate;
        break;
      }
    }
    if (!title && !artist && !album && !artworkUrl) return null;
    return {
      title,
      artist,
      album,
      artworkUrl,
    };
  }

  function getLocalPlaybackState() {
    const mediaElement = getActivePlayerMediaElement() || getFallbackPageMediaElement();
    if (mediaElement instanceof HTMLMediaElement) return mediaElement.paused ? "paused" : "playing";
    if (state.playerPostId) return normalizePlaybackState(state.heroPlayerPlaybackState || "paused");
    return "none";
  }

  function supportsLocalProgrammaticPlayback(post) {
    if (getActivePlayerMediaElement() instanceof HTMLMediaElement) return true;
    if (getFallbackPageMediaElement() instanceof HTMLMediaElement) return true;
    if (!post) return false;
    if (post.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) return true;
    return false;
  }

  function setMediaSessionHandler(action, handler) {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setActionHandler !== "function") return;
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }

  function syncMediaSession(post, mode, fallbackMedia) {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const playbackState = mode === "device"
      ? normalizePlaybackState(nativeSnapshot?.playbackState)
      : mode === "desktop"
        ? normalizePlaybackState(desktopSnapshot?.playbackState)
        : (post || fallbackMedia ? getLocalPlaybackState() : "none");
    try { session.playbackState = playbackState; } catch {}

    const MetadataCtor = typeof window !== "undefined" ? window.MediaMetadata : null;
    if (typeof MetadataCtor !== "function") return;

    try {
      if (mode === "device" && nativeSnapshot) {
        session.metadata = new MetadataCtor({
          title: nativeSnapshot.title || "Device media",
          artist: nativeSnapshot.meta || "Now playing on this device",
          album: "Device playback",
        });
      } else if (mode === "desktop" && desktopSnapshot) {
        session.metadata = new MetadataCtor({
          title: desktopSnapshot.title || "Desktop media",
          artist: desktopSnapshot.meta || "Now playing on this PC",
          album: "System media",
          artwork: desktopSnapshot.artworkUri ? [{ src: desktopSnapshot.artworkUri }] : [],
        });
      } else if (post) {
        const creatorSummary = getProfileSummaryForPost(post);
        session.metadata = new MetadataCtor({
          title: post.title || "Signal Share",
          artist: creatorSummary?.displayName ?? post.creator ?? "",
          album: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
        });
      } else if (fallbackMedia instanceof HTMLMediaElement) {
        if (!session.metadata) {
          const metadata = getBrowserMediaMetadata();
          session.metadata = new MetadataCtor({
            title: metadata?.title || fallbackMedia.getAttribute("title") || "Browser media",
            artist: metadata?.artist || "",
            album: metadata?.album || "This tab",
            artwork: metadata?.artworkUrl ? [{ src: metadata.artworkUrl }] : [],
          });
        }
      } else {
        session.metadata = null;
      }
    } catch {}

    setMediaSessionHandler("play", () => { handlePlayPause(true); });
    setMediaSessionHandler("pause", () => { handlePlayPause(false); });
    setMediaSessionHandler("previoustrack", handlePrevious);
    setMediaSessionHandler("nexttrack", handleNext);
  }

  function ensureControllablePost() {
    if (state.playerPostId && getControllablePlayerPost()) return true;
    const previewPost = getStandbyPreviewPost();
    if (!previewPost) return false;
    state.playerPostId = previewPost.id;
    state.heroPlayerPlaybackState = "paused";
    renderMiniPlayer();
    return true;
  }

  function getStandbyPreviewPost() {
    const playableIds = getPlayableVisiblePostIds();
    if (!playableIds.length) return null;
    if (typeof getPostById !== "function") return null;

    // Prioritize the scroll-tracked active post if it's playable and visible
    if (state.activeFeedPostId && playableIds.includes(state.activeFeedPostId)) {
      return getPostById(state.activeFeedPostId);
    }

    return getPostById(playableIds[0]);
  }

  function resolveYouTubePreviewId(post) {
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
      const match = value.match(/(?:v=|embed\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  function resolveAppPreviewArtwork(post) {
    if (!post) return "";
    if (post.sourceKind === "youtube") {
      const videoId = resolveYouTubePreviewId(post);
      return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
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

  function createPreviewCard({ badge, title, meta, note, artworkUrl }) {
    const card = document.createElement("article");
    card.className = "hero-player-preview";

    if (artworkUrl) {
      const image = document.createElement("img");
      image.className = "hero-player-preview-image";
      image.src = artworkUrl;
      image.alt = title ? `${title} preview` : "Playback preview";
      image.loading = "lazy";
      image.referrerPolicy = "strict-origin-when-cross-origin";
      card.appendChild(image);
    }

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

    card.appendChild(copy);
    return card;
  }

  function createPostStandbyPreview(post) {
    if (!post) return null;
    const creatorSummary = getProfileSummaryForPost(post);
    const creatorName = creatorSummary?.displayName ?? post.creator ?? "Signal Share";
    const formatLabel = formatKind(post.mediaKind);
    const providerLabel = post.sourceKind === "youtube"
      ? "YouTube"
      : post.sourceKind === "spotify"
        ? "Spotify"
        : "";
    const meta = [creatorName, formatLabel, providerLabel].filter(Boolean).join(" · ");
    return createPreviewCard({
      badge: "Preview on load",
      title: post.title || "Next playable post",
      meta,
      note: "Press Play to load this item.",
      artworkUrl: resolveAppPreviewArtwork(post),
    });
  }

  function toggleLocalPlayback(forcePlay) {
    const mediaElement = getActivePlayerMediaElement() || getFallbackPageMediaElement();
    if (mediaElement instanceof HTMLMediaElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : mediaElement.paused;
      if (shouldPlay) {
        const playResult = mediaElement.play();
        if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
        state.heroPlayerPlaybackState = "playing";
      } else {
        mediaElement.pause();
        state.heroPlayerPlaybackState = "paused";
      }
      return true;
    }

    const post = getControllablePlayerPost();
    if (post?.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : getLocalPlaybackState() !== "playing";
      postMessageToYouTubePlayer(state.activePlayerElement, shouldPlay ? "playVideo" : "pauseVideo");
      state.heroPlayerPlaybackState = shouldPlay ? "playing" : "paused";
      return true;
    }

    return false;
  }

  function performNativeAction(action) {
    if (!hasNativeActionBridge()) return false;
    const bridge = getNativeBridge();
    try {
      const success = bridge.performNowPlayingAction(action);
      window.setTimeout(() => { refreshNativeSnapshot(); }, 220);
      return Boolean(success);
    } catch {
      return false;
    }
  }

  function performDesktopAction(action) {
    if (!canUseDesktopBridge()) return Promise.resolve(false);
    return window.fetch(getDesktopActionEndpoint(), {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action,
        appPackage: desktopSnapshot?.appPackage || "",
      }),
    })
      .then((response) => response.ok ? response.json() : { ok: false })
      .then((payload) => {
        window.setTimeout(() => { refreshDesktopSnapshot(); }, 260);
        return Boolean(payload?.ok);
      })
      .catch(() => false);
  }

  function handlePlayPause(forcePlay) {
    const post = getControllablePlayerPost();
    if (shouldUseNativeMode(post)) {
      if (nativeSnapshot?.permissionRequired && hasNativeSettingsBridge()) {
        try { getNativeBridge().openNowPlayingAccessSettings(); } catch {}
        return;
      }
      performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
      return;
    }
    if (shouldUseDesktopMode(post) && desktopSnapshot?.available) {
      performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE);
      return;
    }

    if (!post && getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      toggleLocalPlayback(forcePlay);
      render();
      return;
    }

    const hadControllablePost = Boolean(post);
    if (!ensureControllablePost()) {
      render();
      return;
    }
    if (!hadControllablePost) {
      state.miniPlayerExpanded = false;
      renderMiniPlayer();
    }
    if (typeof forcePlay === "boolean") {
      toggleLocalPlayback(forcePlay);
    } else {
      // Hero Play opens/selects media, but startup remains paused until mini-player Play is pressed.
      toggleLocalPlayback(false);
      state.heroPlayerPlaybackState = "paused";
    }
    render();
  }

  function handlePrevious() {
    const post = getControllablePlayerPost();
    if (shouldUseNativeMode(post)) {
      performNativeAction(NATIVE_ACTION_PREVIOUS);
      return;
    }
    if (shouldUseDesktopMode(post) && desktopSnapshot?.available) {
      performDesktopAction(DESKTOP_ACTION_PREVIOUS);
      return;
    }

    if (!post && getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      render();
      return;
    }

    if (!ensureControllablePost()) {
      render();
      return;
    }
    stepMiniPlayer(-1);
    state.heroPlayerPlaybackState = "paused";
  }

  function handleNext() {
    const post = getControllablePlayerPost();
    if (shouldUseNativeMode(post)) {
      performNativeAction(NATIVE_ACTION_NEXT);
      return;
    }
    if (shouldUseDesktopMode(post) && desktopSnapshot?.available) {
      performDesktopAction(DESKTOP_ACTION_NEXT);
      return;
    }

    if (!post && getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      render();
      return;
    }

    if (!ensureControllablePost()) {
      render();
      return;
    }
    stepMiniPlayer(1);
    state.heroPlayerPlaybackState = "paused";
  }

  function handleVolumeInput(event) {
    const post = getControllablePlayerPost();
    if (shouldUseNativeMode(post)) return;
    if (shouldUseDesktopMode(post) && desktopSnapshot?.available) return;
    const rawValue = Number(event.target?.value);
    state.playerVolume = normalizePlayerVolume(rawValue / 100, state.playerVolume);
    savePlayerVolume(state.playerVolume);
    applyPlayerVolumeToActiveElement();
    const fallbackMedia = getFallbackPageMediaElement();
    if (!(getActivePlayerMediaElement() instanceof HTMLMediaElement) && fallbackMedia instanceof HTMLMediaElement) {
      try { fallbackMedia.volume = state.playerVolume; } catch {}
    }
    render();
  }

  function renderStagePreview(mode, post, fallbackMedia) {
    const stage = elements.heroPlayerStage;
    if (!stage) return;
    stage.replaceChildren();

    const standbyPost = !post ? getStandbyPreviewPost() : null;

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
        stage.appendChild(createPreviewCard({
          badge: "Device media",
          title: nativeSnapshot.title || "Now playing",
          meta: nativeSnapshot.meta || "Current device playback",
          note: nativeSnapshot.playbackState === "paused" ? "Paused" : "Playing",
          artworkUrl: nativeSnapshot.artworkUri || "",
        }));
        return;
      }

      const standbyCard = createPostStandbyPreview(standbyPost);
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
        const snapshotArtworkKey = getDesktopSnapshotArtworkKey(desktopSnapshot);
        if (desktopSnapshot.artworkUri && snapshotArtworkKey) {
          desktopArtworkFallbackCache.set(snapshotArtworkKey, desktopSnapshot.artworkUri);
        }
        if (!desktopSnapshot.artworkUri) {
          void hydrateDesktopSpotifyArtwork(desktopSnapshot, post);
        }
        const resolvedArtwork = desktopSnapshot.artworkUri || (snapshotArtworkKey ? desktopArtworkFallbackCache.get(snapshotArtworkKey) || "" : "");
        stage.appendChild(createPreviewCard({
          badge: "PC system media",
          title: desktopSnapshot.title || "Now playing",
          meta: desktopSnapshot.meta || "Desktop playback",
          note: desktopSnapshot.playbackState === "paused" ? "Paused" : "Playing",
          artworkUrl: resolvedArtwork,
        }));
        return;
      }

      const standbyCard = createPostStandbyPreview(standbyPost);
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
      const metadata = getBrowserMediaMetadata();
      const fallbackTitle = metadata?.title || fallbackMedia.getAttribute("title") || "Browser playback";
      const fallbackMetaRaw = [metadata?.artist, metadata?.album].filter(Boolean).join(" · ");
      const fallbackMeta = sanitizeSnapshotMeta(fallbackMetaRaw, "");
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
      const standbyCard = createPostStandbyPreview(standbyPost);
      if (standbyCard) {
        stage.appendChild(standbyCard);
        return;
      }
      stage.appendChild(createPreviewCard({
        badge: "App media",
        title: "Ready to play",
        meta: "Choose any playable card to begin.",
      }));
      return;
    }

    const creatorSummary = getProfileSummaryForPost(post);
    stage.appendChild(createPreviewCard({
      badge: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
      title: post.title || "Now playing",
      meta: `${creatorSummary?.displayName ?? post.creator ?? "Signal Share"} · ${formatTimestamp(post.createdAt)}`,
      artworkUrl: resolveAppPreviewArtwork(post),
    }));
  }

  function attachEventListeners() {
    if (listenersAttached || !hasUi()) return;
    listenersAttached = true;

    elements.heroPlayerPlayPauseButton.addEventListener("click", (event) => {
      handlePlayPause();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });
    elements.heroPlayerPrevButton.addEventListener("click", (event) => {
      handlePrevious();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });
    elements.heroPlayerNextButton.addEventListener("click", (event) => {
      handleNext();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });
    elements.heroPlayerVolumeSlider.addEventListener("input", handleVolumeInput);

    window.addEventListener("signal:nativeBridgeReady", () => {
      startNativeSnapshotPolling();
      refreshNativeSnapshot();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (hasNativeSnapshotBridge()) {
        startNativeSnapshotPolling();
        refreshNativeSnapshot();
      }
      if (canUseDesktopBridge()) {
        startDesktopSnapshotPolling();
        refreshDesktopSnapshot();
      }
    });

    if (hasNativeSnapshotBridge()) {
      startNativeSnapshotPolling();
    }
    if (canUseDesktopBridge()) {
      startDesktopSnapshotPolling();
    }
  }

  function render() {
    if (!hasUi()) return;
    if (!hasNativeSnapshotBridge()) {
      nativeSnapshot = null;
      stopNativeSnapshotPolling();
    }
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      stopDesktopSnapshotPolling();
    }

    const post = getControllablePlayerPost();
    const mediaElement = getActivePlayerMediaElement();
    const fallbackMedia = getFallbackPageMediaElement();
    const browserMetadata = getBrowserMediaMetadata();
    const mode = shouldUseNativeMode(post) ? "device" : (shouldUseDesktopMode(post) ? "desktop" : "app");
    const playbackState = mode === "device"
      ? normalizePlaybackState(nativeSnapshot?.playbackState)
      : mode === "desktop"
        ? normalizePlaybackState(desktopSnapshot?.playbackState)
        : getLocalPlaybackState();
    const supportsPlayback = mode === "device"
      ? hasNativeActionBridge()
      : mode === "desktop"
        ? Boolean(desktopSnapshot?.available)
        : supportsLocalProgrammaticPlayback(post);
    const supportsVolume = mode === "app" && (
      mediaElement instanceof HTMLMediaElement
      || fallbackMedia instanceof HTMLMediaElement
      || post?.sourceKind === "youtube"
    );
    const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
    const playableCount = getPlayableVisiblePostIds().length;
    const canBootstrapPlayback = !post
      && playableCount > 0
      && !(fallbackMedia instanceof HTMLMediaElement)
      && (
        mode === "app"
        || (mode === "desktop" && !desktopSnapshot?.active)
      );
    const canStep = mode === "device"
      ? hasNativeActionBridge()
      : mode === "desktop"
        ? Boolean(desktopSnapshot?.available)
        : (!(fallbackMedia instanceof HTMLMediaElement) && playableCount > 1);

    if (mode === "device") {
      if (nativeSnapshot?.permissionRequired) {
        elements.heroPlayerTitle.textContent = "Enable device media access";
        elements.heroPlayerCaption.textContent = "Allow notification access so this panel can control what is playing on your device.";
        elements.heroPlayerStatus.textContent = "Device system media";
      } else if (nativeSnapshot?.active) {
        elements.heroPlayerTitle.textContent = nativeSnapshot.title || "Now playing";
        elements.heroPlayerCaption.textContent = nativeSnapshot.meta || "Device playback";
        elements.heroPlayerStatus.textContent = "Device system media";
      } else {
        elements.heroPlayerTitle.textContent = "Device media idle";
        elements.heroPlayerCaption.textContent = "Start playback in any media app to control it here.";
        elements.heroPlayerStatus.textContent = "Device system media";
      }
    } else if (mode === "desktop") {
      if (desktopSnapshot?.active) {
        elements.heroPlayerTitle.textContent = desktopSnapshot.title || "Now playing";
        elements.heroPlayerCaption.textContent = desktopSnapshot.meta || "Desktop playback";
        elements.heroPlayerStatus.textContent = "PC system media";
      } else {
        elements.heroPlayerTitle.textContent = "PC media idle";
        elements.heroPlayerCaption.textContent = "Start playback in YouTube, Spotify, or another desktop app.";
        elements.heroPlayerStatus.textContent = "PC system media";
      }
    } else if (!post && fallbackMedia instanceof HTMLMediaElement) {
      const fallbackTitle = browserMetadata?.title || fallbackMedia.getAttribute("title") || "Now playing in this browser";
      const fallbackMeta = [browserMetadata?.artist, browserMetadata?.album].filter(Boolean).join(" · ");
      elements.heroPlayerTitle.textContent = fallbackTitle;
      elements.heroPlayerCaption.textContent = fallbackMeta || "Active browser media session";
      elements.heroPlayerStatus.textContent = fallbackMedia.paused ? "Paused in browser session" : "Playing in browser session";
    } else if (!post) {
      elements.heroPlayerTitle.textContent = "Ready to play";
      elements.heroPlayerCaption.textContent = "";
      elements.heroPlayerStatus.textContent = "App media standby";
    } else {
      const creatorSummary = getProfileSummaryForPost(post);
      elements.heroPlayerTitle.textContent = post.title;
      elements.heroPlayerCaption.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`;
      elements.heroPlayerStatus.textContent = `${creatorSummary?.displayName ?? post.creator} · ${formatTimestamp(post.createdAt)}`;
    }

    elements.heroPlayerPlayPauseButton.textContent = playbackState === "playing" ? "Pause" : "Play";
    elements.heroPlayerPlayPauseButton.disabled = !(supportsPlayback || canBootstrapPlayback);
    elements.heroPlayerPlayPauseButton.title = supportsPlayback || canBootstrapPlayback
      ? ""
      : "No controllable playback session found.";

    elements.heroPlayerPrevButton.disabled = !canStep;
    elements.heroPlayerNextButton.disabled = !canStep;

    elements.heroPlayerVolumeSlider.disabled = !supportsVolume;
    elements.heroPlayerVolumeSlider.value = `${volumePercent}`;
    elements.heroPlayerVolumeValue.textContent = supportsVolume ? `${volumePercent}%` : "--";

    renderStagePreview(mode, post, fallbackMedia);
    syncMediaSession(post, mode, fallbackMedia);
  }

  return {
    attachEventListeners,
    render,
  };
}
