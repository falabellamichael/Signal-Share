export function createHeroMediaPlayerController(options) {
  const {
    state,
    elements,
    getControllablePlayerPost,
    getActivePlayerMediaElement,
    getPlayableVisiblePostIds,
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
    return window.location.protocol === "http:"
      || window.location.protocol === "https:"
      || window.location.protocol === "file:";
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

    const locationHost = `${window.location.hostname || ""}`.trim().toLowerCase();
    const shouldTryLoopback = window.location.protocol === "file:"
      || (window.location.protocol === "http:" && locationHost !== "localhost" && locationHost !== "127.0.0.1");
    if (shouldTryLoopback) {
      pushDesktopEndpointCandidate(candidates, "http://127.0.0.1:3000/api/system-media/current", seen);
      pushDesktopEndpointCandidate(candidates, "http://localhost:3000/api/system-media/current", seen);
    }

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

  function normalizeDesktopSnapshot(raw = {}) {
    const playbackState = normalizePlaybackState(raw.playbackState || (raw.active ? "playing" : "none"));
    return {
      source: `${raw.source || "windows-smtc"}`.trim(),
      available: Boolean(raw.available),
      active: Boolean(raw.active),
      permissionRequired: false,
      title: typeof raw.title === "string" ? raw.title.trim() : "",
      meta: typeof raw.meta === "string" ? raw.meta.trim() : "",
      appPackage: typeof raw.appPackage === "string" ? raw.appPackage.trim() : "",
      openUri: typeof raw.openUri === "string" ? raw.openUri.trim() : "",
      artworkUri: typeof raw.artworkUri === "string" ? raw.artworkUri.trim() : "",
      playbackState,
    };
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
    const playableIds = getPlayableVisiblePostIds();
    if (!playableIds.length) return false;
    state.playerPostId = playableIds[0];
    state.heroPlayerPlaybackState = "paused";
    renderMiniPlayer();
    return true;
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
      body: JSON.stringify({ action }),
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
    if (shouldUseDesktopMode(post) && desktopSnapshot?.active) {
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
      state.miniPlayerExpanded = true;
      renderMiniPlayer();
    }
    toggleLocalPlayback(forcePlay);
    render();
  }

  function handlePrevious() {
    const post = getControllablePlayerPost();
    if (shouldUseNativeMode(post)) {
      performNativeAction(NATIVE_ACTION_PREVIOUS);
      return;
    }
    if (shouldUseDesktopMode(post) && desktopSnapshot?.active) {
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
    if (shouldUseDesktopMode(post) && desktopSnapshot?.active) {
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
    if (shouldUseDesktopMode(post) && desktopSnapshot?.active) return;
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

  function createPreviewCard({ badge, title, meta, note, artworkUrl = "" }) {
    const card = document.createElement("div");
    card.className = "hero-player-preview";

    if (artworkUrl) {
      const image = document.createElement("img");
      image.className = "hero-player-preview-image";
      image.alt = title ? `${title} artwork` : "Now playing artwork";
      image.loading = "lazy";
      image.referrerPolicy = "strict-origin-when-cross-origin";
      image.src = artworkUrl;
      card.appendChild(image);
    }

    const overlay = document.createElement("div");
    overlay.className = "hero-player-preview-overlay";
    const badgeNode = document.createElement("span");
    badgeNode.className = "hero-player-preview-badge";
    badgeNode.textContent = badge;
    const titleNode = document.createElement("strong");
    titleNode.className = "hero-player-preview-title";
    titleNode.textContent = title;
    const metaNode = document.createElement("p");
    metaNode.className = "hero-player-preview-meta";
    metaNode.textContent = meta;
    overlay.append(badgeNode, titleNode, metaNode);
    if (note) {
      const noteNode = document.createElement("p");
      noteNode.className = "hero-player-preview-note";
      noteNode.textContent = note;
      overlay.appendChild(noteNode);
    }
    card.appendChild(overlay);
    return card;
  }

  function resolveAppPreviewArtwork(post) {
    if (!post) return "";
    if (post.sourceKind === "youtube") {
      const parsed = parseYouTubeUrl?.(
        post.externalUrl
        || post.embedUrl
        || post.originalUrl
        || post.label
        || ""
      );
      const videoId = post.externalId || parsed?.externalId || "";
      return videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "";
    }
    if (post.mediaKind === "image") return resolveActivePlayerSource(post) || "";
    return "";
  }

  function renderStagePreview(mode, post, fallbackMedia) {
    elements.heroPlayerStage.replaceChildren();
    if (mode === "device") {
      if (nativeSnapshot?.permissionRequired) {
        elements.heroPlayerStage.appendChild(
          createPreviewCard({
            badge: "Device media",
            title: "Permission required",
            meta: "Enable notification access to control device playback.",
            note: "Press Play to open access settings.",
          })
        );
        return;
      }
      if (nativeSnapshot?.active) {
        elements.heroPlayerStage.appendChild(
          createPreviewCard({
            badge: "Device media",
            title: nativeSnapshot.title || "Now playing",
            meta: nativeSnapshot.meta || "Current device playback",
            note: nativeSnapshot.playbackState === "paused" ? "Paused" : "Playing",
            artworkUrl: nativeSnapshot.artworkUri || "",
          })
        );
        return;
      }
      elements.heroPlayerStage.appendChild(
        createPreviewCard({
          badge: "Device media",
          title: "No active session",
          meta: "Start playback in any media app on this device.",
        })
      );
      return;
    }

    if (mode === "desktop") {
      if (desktopSnapshot?.active) {
        elements.heroPlayerStage.appendChild(
          createPreviewCard({
            badge: "PC system media",
            title: desktopSnapshot.title || "Now playing",
            meta: desktopSnapshot.meta || "Current desktop playback",
            note: desktopSnapshot.playbackState === "paused" ? "Paused" : "Playing",
            artworkUrl: desktopSnapshot.artworkUri || "",
          })
        );
        return;
      }
      elements.heroPlayerStage.appendChild(
        createPreviewCard({
          badge: "PC system media",
          title: "Waiting for playback",
          meta: "Start playback in YouTube, Spotify, or another desktop media app.",
        })
      );
      return;
    }

    if (!post && fallbackMedia instanceof HTMLMediaElement) {
      const metadata = getBrowserMediaMetadata();
      const metadataTitle = metadata?.title || fallbackMedia.getAttribute("title") || "";
      const metadataMeta = [metadata?.artist, metadata?.album].filter(Boolean).join(" · ");
      if (fallbackMedia instanceof HTMLVideoElement && fallbackMedia.currentSrc) {
        const previewVideo = document.createElement("video");
        previewVideo.className = "hero-player-preview-video";
        previewVideo.dataset.heroPreview = "true";
        previewVideo.muted = true;
        previewVideo.loop = true;
        previewVideo.autoplay = true;
        previewVideo.playsInline = true;
        previewVideo.preload = "metadata";
        previewVideo.src = fallbackMedia.currentSrc;
        elements.heroPlayerStage.appendChild(previewVideo);
      }
      const note = fallbackMedia.paused ? "Paused" : "Playing";
      const fallbackCard = createPreviewCard({
        badge: "PC media",
        title: metadataTitle || "Now playing in this browser",
        meta: metadataMeta || "Controlling active browser playback",
        note,
        artworkUrl: metadata?.artworkUrl || "",
      });
      if (fallbackMedia instanceof HTMLVideoElement && fallbackMedia.currentSrc) {
        fallbackCard.classList.add("is-overlay-only");
      }
      elements.heroPlayerStage.appendChild(fallbackCard);
      return;
    }

    if (!post) {
      elements.heroPlayerStage.appendChild(
        createPreviewCard({
          badge: "App media",
          title: "",
          meta: "",
        })
      );
      return;
    }

    const creatorSummary = getProfileSummaryForPost(post);
    const previewArtwork = resolveAppPreviewArtwork(post);
    const previewMeta = `${creatorSummary?.displayName ?? post.creator} · ${formatTimestamp(post.createdAt)}`;

    if (post.mediaKind === "video") {
      const source = resolveActivePlayerSource(post);
      if (source) {
        const video = document.createElement("video");
        video.className = "hero-player-preview-video";
        video.dataset.heroPreview = "true";
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = source;
        elements.heroPlayerStage.appendChild(video);
      }
      const overlay = createPreviewCard({
        badge: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
        title: post.title,
        meta: previewMeta,
        note: "Preview",
      });
      overlay.classList.add("is-overlay-only");
      elements.heroPlayerStage.appendChild(overlay);
      return;
    }

    elements.heroPlayerStage.appendChild(
      createPreviewCard({
        badge: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
        title: post.title,
        meta: previewMeta,
        note: post.sourceKind === "spotify" ? "Control playback with Spotify in the docked player." : "",
        artworkUrl: previewArtwork,
      })
    );
  }

  function attachEventListeners() {
    if (listenersAttached || !hasUi()) return;
    listenersAttached = true;

    elements.heroPlayerPlayPauseButton.addEventListener("click", () => { handlePlayPause(); });
    elements.heroPlayerPrevButton.addEventListener("click", handlePrevious);
    elements.heroPlayerNextButton.addEventListener("click", handleNext);
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
        ? Boolean(desktopSnapshot?.active)
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
        ? Boolean(desktopSnapshot?.active)
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
