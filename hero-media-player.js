import { renderHeroStagePreview, resolveAppPreviewArtwork } from "./hero-media-player-preview.js";
import { handleOpenMediaAction, handleOpenPhoneAction } from "./hero-media-player-actions.js";



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
    getExternalPreviewMetadata,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    getHeroPost,
    setHeroPost,
    playHeroMedia,
    stepHeroPlayer,
    getHeroPlayablePosts,
    resolveYouTubePreviewId,
    isNativeCapacitorApp,
    getCapacitorPlatform,
    openViewer,
    onStatusChange
  } = options;

  const NATIVE_ACTION_PLAY_PAUSE = "play_pause";
  const NATIVE_ACTION_NEXT = "next";
  const NATIVE_ACTION_PREVIOUS = "previous";
  const NATIVE_POLL_INTERVAL_MS = 1200;
  const DESKTOP_ACTION_PLAY_PAUSE = "play_pause";
  const DESKTOP_ACTION_NEXT = "next";
  const DESKTOP_ACTION_PREVIOUS = "previous";
  const DESKTOP_POLL_INTERVAL_MS = 800;
  const LOCAL_NETWORK_PROMPT_COOLDOWN_MS = 30000;
  const SNAPSHOT_INGEST_DELAY_MS = 2400;

  let listenersAttached = false;
  let nativeSnapshot = null;
  let nativePollTimerId = 0;
  let desktopSnapshot = null;
  let desktopPollTimerId = 0;
  let desktopSnapshotEndpoint = "";
  let desktopActionEndpoint = "";
  let desktopPollFailureCount = 0;
  let localNetworkPromptInFlight = false;
  let localNetworkPromptLastAttemptAt = 0;
  let pendingDesktopArtworkKey = "";
  let desktopSnapshotReadPromise = null;
  let lastDesktopSnapshotSignature = "";
  let desktopActionInFlight = false;
  let nativeActionInFlight = false;
  let lastDesktopActionAt = 0;
  let lastNativeActionAt = 0;
  let lastDesktopPollTime = 0;
  let lastNativePollTime = 0;
  let lastDesktopActionKey = "";
  let companionPromptDismissed = localStorage.getItem("ss_companion_dismissed") === "true";
  const DESKTOP_ACTION_COOLDOWN_MS = 280;
  const NATIVE_ACTION_COOLDOWN_MS = 280;
  const COMPANION_SETUP_SCRIPT = `@echo off
setlocal
title Signal Share Companion
color 0B

echo.
echo  --------------------------------------------------------
echo    SIGNAL SHARE COMPANION
echo    Secure Desktop Media Bridge
echo  --------------------------------------------------------
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% == 0 (
    color 0E
    echo  [!] WARNING: Running as Administrator is NOT recommended.
    echo  For better security, please run this script as a normal user.
    echo.
    choice /C YN /M "Do you want to continue as Admin anyway?"
    if errorlevel 2 exit /b 1
    color 0B
)

:: Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [!] ERROR: Node.js was not found.
    echo.
    echo  The companion requires Node.js to run. 
    echo  Please download it from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo  [1/2] Preparing components...
echo.
call npm install --no-audit --no-fund --quiet
if %errorlevel% neq 0 (
    color 0C
    echo  [!] ERROR: Failed to install components.
    echo.
    pause
    exit /b 1
)

echo.
echo  [2/2] Launching Secured Bridge...
echo.
echo  --------------------------------------------------------
echo    SUCCESS! The bridge is now active.
echo.
echo    SECURITY HARDENING ACTIVE:
echo    - Binding to 127.0.0.1 (Local loopback only)
echo    - CORS Whitelisting enabled
echo    - Rate limiting enabled
echo    - External port exposure disabled
echo.
echo    IMPORTANT: Keep this window open!
echo    If you close it, PC Media control will stop.
echo  --------------------------------------------------------
echo.

npm start
echo.
echo  The bridge has stopped.
pause`.trim();

  const COMPANION_SECURITY_README = `
# Signal Share Companion Security

The companion bridge is designed with several security layers to keep your PC safe.

## Active Safety Measures

1.  **Local Loopback Only**: The bridge binds only to 127.0.0.1. It is not accessible from other devices on your network or the internet.
2.  **CORS Protection**: Only requests from the official Signal Share domain or localhost are allowed.
3.  **Authentication Required**: Every action (Play, Pause, Skip) requires a local secret token stored in your browser.
4.  **Disabled URI Opening**: The ability to open arbitrary links is disabled by default to prevent malicious URL injection.
5.  **Rate Limiting**: Commands are rate-limited to prevent automated spamming of your system media controls.
6.  **No Admin Required**: The companion should never be run as an Administrator. It runs with your normal user permissions.
7.  **Port Safety**: The bridge port is not exposed through UPnP or firewall rules automatically.
8.  **Remote Sync Control**: Remote control via Supabase is disabled by default and requires explicit user activation.

`.trim();

  const desktopArtworkFallbackCache = new Map();
  const resolvedArtworkMap = new Map();
  const externalHeaderMetadataCache = new Map();
  const externalHeaderMetadataInFlight = new Map();

  function isThenable(value) {
    return Boolean(value && typeof value.then === "function");
  }

  function initializeSdkHooks() {
    // Spotify Web Playback SDK initialization
    if (typeof window !== "undefined") {
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log("[Spotify] Web Playback SDK is ready.");
        // If we have an active Spotify post, we could initialize a player here.
        // For now, we just ensure the callback exists and is logged.
      };

      // YouTube IFrame API initialization
      window.onYouTubeIframeAPIReady = () => {
        console.log("[YouTube] IFrame API is ready.");
      };
    }
    console.log("[Hero] SDK hooks initialized.");
  }



  function hasUi() {
    return Boolean(
      elements.heroPlayerHeader
      && elements.heroPlayerTitle
      && elements.heroPlayerCaption
      && elements.heroPlayerStatus
      && elements.heroPlayerStage
      && elements.heroPlayerPlayPauseButton
      && elements.heroPlayerOpenMediaButton
      && elements.heroPlayerPrevButton
      && elements.heroPlayerNextButton
      && elements.heroPlayerVolumeSlider
      && elements.heroPlayerVolumeValue
      && elements.heroPlayerOpenPhoneButton
      && document.getElementById("companionPromptOverlay")
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

  function getPreferredHeroControlSource() {
    const value = normalizeText(state.heroControlSource || state.heroMediaSource || state.systemMediaSource || "");
    return value === "youtube" || value === "spotify" ? value : "";
  }

  function getSystemMediaHeaderLabel() {
    const isPC = !isNativeCapacitorApp();
    if (isPC) {
      const meta = (desktopSnapshot?.meta || "").toLowerCase();
      if (meta.includes("bluetooth") || meta.includes("via bluetooth")) return "BLUETOOTH MEDIA";
      return "PC SYSTEM MEDIA";
    }
    return "ON-DEVICE MEDIA";
  }

  function cleanSnapshotTitle(value = "") {
    return cleanDisplayText(value) || "Now playing";
  }

  function cleanSnapshotCreator(snapshot = null, fallback = "") {
    const appPackage = cleanDisplayText(snapshot?.appPackage || "");
    let meta = sanitizeSnapshotMeta(snapshot?.meta || "", appPackage);
    meta = cleanDisplayText(meta);
    meta = meta.replace(/^(?:spotify|youtube|youtube music|chrome|edge|microsoft edge|firefox|opera)\s*(?:[-:|]\s*)?/i, "").trim();
    meta = meta.replace(/^(?:playing from|now playing on)\s+/i, "").trim();
    return meta || fallback;
  }

  function getPlaybackStatusLabel(value = "") {
    const stateValue = normalizePlaybackState(value);
    if (stateValue === "playing") return "Playing";
    if (stateValue === "paused") return "Paused";
    return "Ready";
  }

  function appendPreferredSourceToEndpoint(endpoint = "") {
    const preferredSource = getPreferredHeroControlSource();
    if (!preferredSource || !endpoint) return endpoint;

    try {
      const url = new URL(endpoint, window.location.href);
      url.searchParams.set("source", preferredSource);
      return url.toString();
    } catch {
      const separator = endpoint.includes("?") ? "&" : "?";
      return `${endpoint}${separator}source=${encodeURIComponent(preferredSource)}`;
    }
  }

  let bridgeDetected = false;

  function syncHeroControlSourceChange(source = "") {
    const normalized = normalizeText(source);
    const nextSource = normalized === "youtube" || normalized === "spotify" ? normalized : "";
    const previousSource = getPreferredHeroControlSource();

    state.heroControlSource = nextSource || "all";
    state.heroMediaSource = nextSource || "all";
    state.systemMediaSource = nextSource || "all";

    if (previousSource === nextSource) return;

    // Do NOT clear desktopSnapshotEndpoint here; keep the last working endpoint
    // to avoid unnecessary re-probing of the local network.
    // desktopSnapshotEndpoint = "";

    desktopActionEndpoint = "";
    desktopSnapshotReadPromise = null;
    lastDesktopSnapshotSignature = "none";
    lastDesktopPollTime = 0;

    if (canUseDesktopBridge()) {
      void refreshDesktopSnapshot({ force: true });
    }
    render();
  }

  function getHeroSourceFromElement(target) {
    if (!(target instanceof Element)) return "";
    const control = target.closest("[data-hero-control-source], [data-hero-source], [data-media-source], [data-source], button, [role='button']");
    if (!control) return "";

    const rawSource = control.getAttribute("data-hero-control-source")
      || control.getAttribute("data-hero-source")
      || control.getAttribute("data-media-source")
      || control.getAttribute("data-source")
      || control.getAttribute("aria-label")
      || control.textContent
      || "";

    const value = normalizeText(rawSource);
    if (value.includes("spotify")) return "spotify";
    if (value.includes("youtube") || value.includes("you tube")) return "youtube";
    return "";
  }

  function handleHeroSourceToggleClick(event) {
    const source = getHeroSourceFromElement(event.target);
    if (!source) return;
    syncHeroControlSourceChange(source);
  }

  function cleanDisplayText(value = "") {
    return `${value || ""}`.replace(/\s+/g, " ").trim();
  }

  function isExternalUrlPost(post = null) {
    return post?.sourceKind === "youtube" || post?.sourceKind === "spotify";
  }

  function getExternalProviderName(post = null) {
    if (post?.sourceKind === "youtube") return "YouTube";
    if (post?.sourceKind === "spotify") return "Spotify";
    return "App";
  }

  function firstCleanValue(...values) {
    for (const value of values) {
      const clean = cleanDisplayText(value);
      if (clean) return clean;
    }
    return "";
  }

  function getExternalPostMetadataCacheKey(post = null) {
    if (!isExternalUrlPost(post)) return "";
    return [
      post.sourceKind,
      post.externalId,
      post.externalUrl,
      post.originalUrl,
      post.embedUrl,
      post.mediaUrl,
      post.src,
      post.label,
      post.title,
    ].map(cleanDisplayText).join("|");
  }

  function inferSpotifyEntityTypeFromPost(post = null) {
    const values = [post?.label, post?.externalUrl, post?.originalUrl, post?.embedUrl, post?.mediaUrl, post?.src];
    for (const value of values) {
      const clean = cleanDisplayText(value).toLowerCase();
      const match = clean.match(/(?:spotify[:/]|open\.spotify\.com\/(?:intl-[a-z0-9-]+\/)?(?:embed\/)?)(track|album|playlist|artist|episode|show)/i);
      if (match?.[1]) return match[1].toLowerCase();
    }
    return "track";
  }

  function buildSpotifyCanonicalUrlFromPost(post = null) {
    const values = [post?.externalUrl, post?.originalUrl, post?.embedUrl, post?.mediaUrl, post?.src, post?.externalId];
    for (const rawValue of values) {
      const value = cleanDisplayText(rawValue);
      if (!value) continue;

      const uriMatch = value.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i);
      if (uriMatch) return `https://open.spotify.com/${uriMatch[1].toLowerCase()}/${uriMatch[2]}`;

      const urlMatch = value.match(/open\.spotify\.com\/(?:intl-[a-z0-9-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i);
      if (urlMatch) return `https://open.spotify.com/${urlMatch[1].toLowerCase()}/${urlMatch[2]}`;
    }

    const externalId = cleanDisplayText(post?.externalId).replace(/[/?#].*$/, "");
    if (/^[A-Za-z0-9]+$/.test(externalId)) {
      return `https://open.spotify.com/${inferSpotifyEntityTypeFromPost(post)}/${externalId}`;
    }
    return "";
  }

  function resolveYouTubeMetadataUrlFromPost(post = null) {
    const values = [post?.externalUrl, post?.originalUrl, post?.embedUrl, post?.mediaUrl, post?.src, post?.externalId, post?.label, post?.caption, post?.title];
    for (const value of values) {
      const clean = cleanDisplayText(value);
      if (!clean) continue;
      if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return `https://www.youtube.com/watch?v=${clean}`;
      if (typeof parseYouTubeUrl === "function") {
        try {
          const parsed = parseYouTubeUrl(clean);
          if (parsed?.externalId) return `https://www.youtube.com/watch?v=${parsed.externalId}`;
        } catch { }
      }
      const match = clean.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([a-zA-Z0-9_-]{11})/i);
      if (match?.[1]) return `https://www.youtube.com/watch?v=${match[1]}`;
    }
    return "";
  }

  function buildExternalMetadataSource(post = null) {
    if (!isExternalUrlPost(post)) return null;
    const sourceUrl = post.sourceKind === "spotify"
      ? buildSpotifyCanonicalUrlFromPost(post)
      : resolveYouTubeMetadataUrlFromPost(post);

    return {
      provider: post.sourceKind,
      title: cleanDisplayText(post.title),
      creator: cleanDisplayText(post.creator),
      externalId: cleanDisplayText(post.externalId),
      externalUrl: cleanDisplayText(post.externalUrl || sourceUrl),
      originalUrl: cleanDisplayText(post.originalUrl || post.externalUrl || sourceUrl),
      embedUrl: cleanDisplayText(post.embedUrl),
      mediaUrl: cleanDisplayText(post.mediaUrl),
      src: cleanDisplayText(post.src),
      label: cleanDisplayText(post.label),
      caption: cleanDisplayText(post.caption),
    };
  }

  function normalizeExternalMetadata(metadata = null) {
    if (!metadata || typeof metadata !== "object") return null;
    const title = firstCleanValue(metadata.title, metadata.name);
    const creator = firstCleanValue(metadata.creator, metadata.artist, metadata.author_name, metadata.authorName, metadata.channelTitle, metadata.ownerName);
    const thumbnailUrl = firstCleanValue(metadata.thumbnailUrl, metadata.thumbnail_url, metadata.artworkUrl, metadata.image);
    if (!title && !creator && !thumbnailUrl) return null;
    return { title, creator, thumbnailUrl };
  }

  async function fetchYouTubeOEmbedMetadata(post) {
    if (typeof window.fetch !== "function") return null;
    const watchUrl = resolveYouTubeMetadataUrlFromPost(post);
    if (!watchUrl) return null;
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const response = await window.fetch(endpoint, { method: "GET", cache: "force-cache" });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeExternalMetadata({
      title: data?.title,
      creator: data?.author_name,
      thumbnailUrl: data?.thumbnail_url,
    });
  }

  async function fetchSpotifyCatalogHeaderMetadata(post) {
    const sourceUrl = buildSpotifyCanonicalUrlFromPost(post);
    if (!sourceUrl || !state.supabase || state.backendMode !== "supabase" || !state.currentUser) return null;
    const functionName = window.SIGNAL_SHARE_CONFIG?.spotifyPreviewFunctionName?.trim?.() || "spotify-preview-metadata";
    if (!functionName) return null;
    const locale = (Array.isArray(navigator.languages) && navigator.languages[0]) || navigator.language || navigator.userLanguage || "";
    const marketMatch = `${locale}`.trim().match(/[-_]([A-Za-z]{2})$/);
    const market = marketMatch ? marketMatch[1].toUpperCase() : "US";
    const { data, error } = await state.supabase.functions.invoke(functionName, {
      body: { url: sourceUrl, market },
    });
    if (error || !data || data.error) return null;
    return normalizeExternalMetadata(data);
  }

  function getExternalHeaderFallback(post) {
    const providerName = getExternalProviderName(post);
    const directTitle = firstCleanValue(
      post?.mediaTitle,
      post?.externalTitle,
      post?.sourceTitle,
      post?.videoTitle,
      post?.trackTitle,
      post?.oembedTitle,
      post?.metadata?.title,
      post?.title,
      "Ready to play"
    );
    let directCreator = firstCleanValue(
      post?.mediaCreator,
      post?.externalCreator,
      post?.sourceCreator,
      post?.channelTitle,
      post?.author_name,
      post?.authorName,
      post?.artist,
      post?.artistName,
      post?.metadata?.creator,
      post?.metadata?.artist,
      post?.metadata?.author_name
    );

    let title = directTitle;
    if (post?.sourceKind === "spotify" && !directCreator) {
      const split = directTitle.match(/^(.{1,80}?)\s+-\s+(.+)$/);
      if (split?.[1] && split?.[2] && !/^(audio|music|post|song|spotify|track|untitled)$/i.test(split[1].trim())) {
        directCreator = split[1].trim();
        title = split[2].trim();
      }
    }

    return {
      providerName,
      title,
      creator: directCreator,
      caption: directCreator ? `${providerName} · ${directCreator}` : providerName,
    };
  }

  function requestExternalHeaderMetadata(post) {
    const key = getExternalPostMetadataCacheKey(post);
    if (!key || externalHeaderMetadataCache.has(key) || externalHeaderMetadataInFlight.has(key)) return;

    const source = buildExternalMetadataSource(post);
    const request = (async () => {
      let metadata = null;

      if (typeof getExternalPreviewMetadata === "function" && source) {
        try {
          metadata = normalizeExternalMetadata(await getExternalPreviewMetadata(source));
        } catch { }
      }

      if (!metadata && post?.sourceKind === "youtube") {
        try { metadata = await fetchYouTubeOEmbedMetadata(post); } catch { }
      }

      if (!metadata && post?.sourceKind === "spotify") {
        try { metadata = await fetchSpotifyCatalogHeaderMetadata(post); } catch { }
      }

      externalHeaderMetadataCache.set(key, metadata || null);
      return metadata || null;
    })();

    externalHeaderMetadataInFlight.set(key, request);
    request
      .then((metadata) => {
        if (metadata?.title || metadata?.creator) render();
      })
      .finally(() => {
        externalHeaderMetadataInFlight.delete(key);
      });
  }

  function getExternalHeaderDisplay(post = null) {
    const fallback = getExternalHeaderFallback(post);
    const key = getExternalPostMetadataCacheKey(post);
    const cached = key ? externalHeaderMetadataCache.get(key) : null;

    if (cached) {
      const title = cached.title || fallback.title;
      const creator = cached.creator || fallback.creator;
      return {
        ...fallback,
        title,
        creator,
        caption: creator ? `${fallback.providerName} · ${creator}` : fallback.caption,
      };
    }

    requestExternalHeaderMetadata(post);
    return fallback;
  }

  function isPreferredNowPlayingAppPackage(value = "") {
    const normalized = normalizeText(value);
    if (!normalized) return false;

    const preferredSource = getPreferredHeroControlSource();
    if (preferredSource === "spotify") return normalized.includes("spotify");
    if (preferredSource === "youtube") {
      return normalized.includes("youtube")
        || normalized.includes("ytmusic")
        || normalized.includes("youtube.music");
    }

    return normalized.includes("spotify")
      || normalized.includes("youtube")
      || normalized.includes("ytmusic")
      || normalized.includes("youtube.music");
  }

  function isPreferredNowPlayingUri(value = "") {
    const normalized = normalizeText(value);
    if (!normalized) return false;

    const preferredSource = getPreferredHeroControlSource();
    if (preferredSource === "spotify") {
      return normalized.startsWith("spotify:") || normalized.includes("open.spotify.com");
    }
    if (preferredSource === "youtube") {
      return normalized.startsWith("vnd.youtube:")
        || normalized.includes("youtube.com")
        || normalized.includes("music.youtube.com")
        || normalized.includes("youtu.be/");
    }

    return normalized.startsWith("spotify:")
      || normalized.includes("open.spotify.com")
      || normalized.startsWith("vnd.youtube:")
      || normalized.includes("youtube.com")
      || normalized.includes("music.youtube.com")
      || normalized.includes("youtu.be/");
  }

  function isPreferredNowPlayingSnapshot(snapshot = null) {
    if (!snapshot) return false;
    const preferredSource = getPreferredHeroControlSource();

    if (!preferredSource) {
      return isPreferredNowPlayingAppPackage(snapshot.appPackage)
        || isPreferredNowPlayingUri(snapshot.openUri);
    }

    const app = normalizeText(snapshot.appPackage);
    const uri = normalizeText(snapshot.openUri);
    const title = normalizeText(snapshot.title);
    const meta = normalizeText(snapshot.meta);
    const combined = `${app} ${uri} ${title} ${meta}`;

    if (preferredSource === "spotify") {
      if (combined.includes("youtube") || combined.includes("youtu.be")) return false;
      return combined.includes("spotify") || uri.includes("open.spotify.com") || uri.startsWith("spotify:");
    }

    if (preferredSource === "youtube") {
      if (combined.includes("spotify") || uri.includes("open.spotify.com")) return false;
      return combined.includes("youtube")
        || combined.includes("ytmusic")
        || uri.includes("youtu.be/")
        || /[a-zA-Z0-9_-]{11}/.test(snapshot?.openUri || "");
    }

    return false;
  }

  function hasSnapshotPlaybackContext(snapshot = null) {
    if (!snapshot) return false;
    if (snapshot.active) return true;
    if (normalizePlaybackState(snapshot.playbackState) !== "none") return true;
    if (typeof snapshot.title === "string" && snapshot.title.trim()) return true;
    if (typeof snapshot.meta === "string" && snapshot.meta.trim()) return true;
    if (typeof snapshot.openUri === "string" && snapshot.openUri.trim()) return true;
    return false;
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

  async function pollNativeSnapshot() {
    if (!hasNativeSnapshotBridge()) return null;
    const bridge = getNativeBridge();
    try {
      const source = getPreferredHeroControlSource();
      const payload = bridge.getNowPlayingSnapshot(source);
      if (typeof payload !== "string" || !payload.trim()) return null;
      const parsed = JSON.parse(payload);
      return normalizeNativeSnapshot(parsed);
    } catch {
      return null;
    }
  }

  function readNativeSnapshot() {
    if (!hasNativeSnapshotBridge()) return null;
    const bridge = getNativeBridge();
    try {
      const source = getPreferredHeroControlSource();
      const payload = bridge.getNowPlayingSnapshot(source);
      if (typeof payload !== "string" || !payload.trim()) return null;
      const parsed = JSON.parse(payload);
      return normalizeNativeSnapshot(parsed);
    } catch {
      return null;
    }
  }

  function refreshNativeSnapshot({ renderAfter = true } = {}) {
    if (!hasNativeSnapshotBridge()) return null;

    const now = Date.now();
    if (now - lastNativeActionAt < 2500) return nativeSnapshot;
    if (now - lastNativePollTime < NATIVE_POLL_INTERVAL_MS - 200) return nativeSnapshot;
    lastNativePollTime = now;

    const rawSnapshot = readNativeSnapshot();
    const nextSignature = getDesktopSnapshotSignature(rawSnapshot); // Use same signature logic
    const didChange = nextSignature !== (nativeSnapshot ? getDesktopSnapshotSignature(nativeSnapshot) : "none");

    nativeSnapshot = rawSnapshot;
    if (nativeSnapshot && nativeSnapshot.active && !nativeSnapshot.artworkUri) {
      hydrateDesktopSpotifyArtwork(nativeSnapshot, getControllablePlayerPost());
    }
    if (renderAfter && didChange) render();
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
    
    // If the user has manually toggled a specific source (Spotify/YouTube), 
    // we should prefer the native bridge for that mode even if nothing is currently playing,
    // so that pressing 'Play' can wake up the app.
    const preferredSource = getPreferredHeroControlSource();
    if (preferredSource && hasNativeActionBridge()) {
       // If we are in the feed and NOT currently playing a hosted video/audio,
       // we should let the selected system source take over.
       const hasLocalAppSession = Boolean(post)
         || getActivePlayerMediaElement() instanceof HTMLMediaElement
         || getFallbackPageMediaElement() instanceof HTMLMediaElement;
       if (!hasLocalAppSession) return true;
    }

    const preferredNativeSnapshot = isPreferredNowPlayingSnapshot(nativeSnapshot);
    if (preferredNativeSnapshot && hasSnapshotPlaybackContext(nativeSnapshot)) return true;
    
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

  function getTargetAddressSpaceForHostname(hostname = "") {
    const value = `${hostname || ""}`.trim().toLowerCase();
    if (!value) return "";

    // Browser Private Network Access treats localhost / 127.0.0.1 / ::1 as loopback.
    // Keep this distinct from LAN/private IPs so we do not create a target-address-space mismatch.
    if (value === "localhost" || value.endsWith(".localhost")) return "loopback";
    if (value === "::1" || value === "[::1]") return "loopback";
    if (value.endsWith(".local")) return "local";

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
      const octets = value.split(".").map((entry) => Number.parseInt(entry, 10));
      if (octets.some((entry) => Number.isNaN(entry) || entry < 0 || entry > 255)) return "";

      const [a, b] = octets;
      if (a === 127) return "loopback";
      if (a === 10) return "private";
      if (a === 169 && b === 254) return "private";
      if (a === 172 && b >= 16 && b <= 31) return "private";
      if (a === 192 && b === 168) return "private";
      return "";
    }

    const bracketedIpv6 = value.match(/^\[([0-9a-f:.]+)\]$/i);
    const ipv6 = (bracketedIpv6?.[1] || value).toLowerCase();

    if (!ipv6.includes(":")) return "";
    if (ipv6 === "::1") return "loopback";
    if (ipv6.startsWith("fe80:")) return "private";
    if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return "private";

    return "";
  }

  function withLocalNetworkFetchOptions(url, init = {}) {
    try {
      const resolved = new URL(url, window.location.href);
      const addressSpace = getTargetAddressSpaceForHostname(resolved.hostname);
      if (addressSpace !== "local" && addressSpace !== "private" && addressSpace !== "loopback") return init;

      const secret = localStorage.getItem("ss_bridge_secret");
      const headers = { ...init.headers };
      if (secret) {
        headers["X-Bridge-Secret"] = secret;
      }

      // Ensure we do NOT send 'target-address-space' as a header, as it's a restricted 
      // fetch option property, not a header. Sending it as a header triggers CORS failures.
      delete headers["target-address-space"];
      delete headers["Target-Address-Space"];

      return {
        ...init,
        headers,
        targetAddressSpace: addressSpace
      };
    } catch {
      return init;
    }
  }

  function isLocalNetworkAccessPromptEligible() {
    if (!window.isSecureContext) return false;
    const protocol = `${window.location.protocol || ""}`.toLowerCase();
    return protocol === "https:" || protocol === "http:" || protocol === "file:";
  }

  function getEndpointAddressSpace(url = "") {
    try {
      const resolved = new URL(url, window.location.href);
      return getTargetAddressSpaceForHostname(resolved.hostname);
    } catch {
      return "";
    }
  }

  function maybeTriggerLocalNetworkAccessPrompt(endpoint = "") {
    if (!endpoint) return;
    if (!isLocalNetworkAccessPromptEligible()) return;
    const addressSpace = getEndpointAddressSpace(endpoint);
    if (addressSpace !== "local" && addressSpace !== "private" && addressSpace !== "loopback") return;
    if (localNetworkPromptInFlight) return;

    const now = Date.now();
    if (now - localNetworkPromptLastAttemptAt < LOCAL_NETWORK_PROMPT_COOLDOWN_MS) return;
    localNetworkPromptLastAttemptAt = now;
    localNetworkPromptInFlight = true;

    window.fetch(endpoint, withLocalNetworkFetchOptions(endpoint, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
    }))
      .catch(() => null)
      .finally(() => {
        localNetworkPromptInFlight = false;
        window.setTimeout(() => {
          if (document.hidden || !canUseDesktopBridge()) return;
          refreshDesktopSnapshot();
        }, 900);
      });
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

    const protocol = `${window.location.protocol || ""}`.toLowerCase();
    const host = `${window.location.hostname || ""}`.trim().toLowerCase();
    const originAddressSpace = getTargetAddressSpaceForHostname(host);

    const isLoopbackOrigin = protocol === "file:"
      || !host
      || host === "localhost"
      || host.endsWith(".localhost")
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]";

    const isLocalOrigin = isLoopbackOrigin
      || originAddressSpace === "private"
      || originAddressSpace === "local"
      || originAddressSpace === "loopback";

    const isRemoteOrigin = !isLocalOrigin;

    // If a previous endpoint already worked, try it first.
    pushDesktopEndpointCandidate(candidates, desktopSnapshotEndpoint, seen);

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim()) {
      pushDesktopEndpointCandidate(candidates, window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim(), seen);
    }

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim()) {
      const baseUrl = window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim().replace(/\/+$/, "");
      pushDesktopEndpointCandidate(candidates, `${baseUrl}/api/system-media/current`, seen);
    }

    // If the page is already being served by the local Express server, same-origin
    // must be first. This avoids localhost -> 127.0.0.1 CORS/PNA errors.
    if (isLocalOrigin && protocol !== "file:") {
      try {
        pushDesktopEndpointCandidate(candidates, new URL("/api/system-media/current", window.location.href).toString(), seen);
      } catch {
        pushDesktopEndpointCandidate(candidates, "/api/system-media/current", seen);
      }
    }

    // GitHub Pages / remote origins should not keep hammering loopback forever unless
    // the user explicitly opens Media mode or configured an endpoint/base URL.
    if (isRemoteOrigin && desktopPollFailureCount > 3 && state.heroControlMode !== "media") {
      return candidates;
    }

    // Loopback fallbacks. Match the current hostname first to avoid cross-origin noise.
    if (host === "127.0.0.1") {
      pushDesktopEndpointCandidate(candidates, "http://127.0.0.1:3000/api/system-media/current", seen);
      pushDesktopEndpointCandidate(candidates, "http://localhost:3000/api/system-media/current", seen);
    } else {
      pushDesktopEndpointCandidate(candidates, "http://localhost:3000/api/system-media/current", seen);
      pushDesktopEndpointCandidate(candidates, "http://127.0.0.1:3000/api/system-media/current", seen);
    }

    return candidates.map(appendPreferredSourceToEndpoint);
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

    const genericPrefixPattern = /^(?:spotify[a-z0-9._!-]*|operasoftware\.[a-z0-9._!-]*|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?|bluetooth)\s*(?:[-:|]\s*)?/i;
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
      active: Boolean(raw.active) || Boolean(raw.title && raw.title.trim()),
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

  function getDesktopSnapshotSignature(snapshot = null) {
    if (!snapshot) return "none";
    return [
      normalizePlaybackState(snapshot.playbackState),
      normalizeText(snapshot.title),
      normalizeText(snapshot.meta),
      normalizeText(snapshot.appPackage),
      snapshot.active ? "active" : "idle",
      snapshot.available ? "available" : "unavailable",
    ].join("|");
  }

  function getSpotifyFallbackCandidates(snapshot, post) {
    const ranked = [];
    const seenIds = new Set();
    const snapshotTitle = normalizeText(snapshot?.title);
    const snapshotMeta = normalizeText(snapshot?.meta);
    const hasSnapshotText = Boolean(snapshotTitle || snapshotMeta);

    function scoreCandidate(candidate = {}) {
      const title = normalizeText(candidate.title);
      const creator = normalizeText(candidate.creator);
      let score = 0;

      if (snapshotTitle && title) {
        if (title === snapshotTitle) score += 12;
        else if (title.includes(snapshotTitle) || snapshotTitle.includes(title)) score += 8;
      }

      if (snapshotMeta) {
        if (creator && creator === snapshotMeta) score += 8;
        else if (creator && (creator.includes(snapshotMeta) || snapshotMeta.includes(creator))) score += 5;
        if (title && title.includes(snapshotMeta)) score += 2;
      }

      if (!hasSnapshotText) score += 1;
      return score;
    }

    const pushCandidate = (candidate, boost = 0) => {
      if (!candidate || candidate.sourceKind !== "spotify") return;
      const id = `${candidate.id || ""}`.trim() || `${candidate.externalId || candidate.embedUrl || candidate.externalUrl || ""}`.trim();
      if (!id || seenIds.has(id)) return;
      const score = scoreCandidate(candidate) + boost;
      if (hasSnapshotText && score <= 0) return;
      seenIds.add(id);
      ranked.push({ candidate, score });
    };

    pushCandidate(post, 3);
    pushCandidate(getControllablePlayerPost(), 2);
    pushCandidate(getStandbyPreviewPost(), 1);

    if (typeof getAllPosts === "function") {
      const posts = getAllPosts();
      if (Array.isArray(posts) && posts.length) {
        for (const entry of posts) pushCandidate(entry, 0);
      }
    }

    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.candidate);
  }

  async function hydrateDesktopSpotifyArtwork(snapshot, post) {
    if (!snapshot || snapshot.artworkUri) return;
    if (typeof getSpotifyPreviewImageUrl !== "function") return;
    const appPackage = normalizeText(snapshot.appPackage);
    const isSpotify = appPackage.includes("spotify");
    const isYouTube = appPackage.includes("youtube") || appPackage.includes("ytmusic");

    if (!isSpotify && !isYouTube) return;

    const snapshotKey = getDesktopSnapshotArtworkKey(snapshot);
    if (!snapshotKey || pendingDesktopArtworkKey === snapshotKey) return;

    const cachedArtwork = desktopArtworkFallbackCache.get(snapshotKey);
    if (cachedArtwork) {
      snapshot.artworkUri = cachedArtwork;
      return;
    }

    pendingDesktopArtworkKey = snapshotKey;

    if (isSpotify) {
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
    } else if (isYouTube) {
      const matched = findMatchedPost(snapshot);
      if (matched && matched.sourceKind === "youtube") {
        const videoId = typeof parseYouTubeUrl === "function" ? (parseYouTubeUrl(matched.externalId || matched.embedUrl || matched.src)?.externalId) : null;
        if (videoId) {
          const artworkUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          desktopArtworkFallbackCache.set(snapshotKey, artworkUrl);
          snapshot.artworkUri = artworkUrl;
          pendingDesktopArtworkKey = "";
          render();
          return;
        }
      }
    }

    pendingDesktopArtworkKey = "";
  }

  async function readDesktopSnapshotFromSupabase() {
    if (!state.supabase || !state.currentUser?.id) return null;
    try {
      const { data, error } = await state.supabase
        .from("system_media")
        .select("*")
        .eq("user_id", state.currentUser.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // If the data is more than 30 seconds old, consider it stale
      const updatedAt = new Date(data.updated_at).getTime();
      if (Date.now() - updatedAt > 30000) return null;

      return normalizeDesktopSnapshot({
        source: "supabase-sync",
        available: true,
        active: Boolean(data.title),
        playbackState: data.playback_state,
        title: data.title,
        meta: data.meta,
        artworkUri: data.artwork_uri,
        appPackage: data.app_package,
        deviceName: data.device_name,
      });
    } catch (error) {
      console.error("Failed to read desktop snapshot from Supabase:", error);
      return null;
    }
  }

  async function readDesktopSnapshot() {
    if (!canUseDesktopBridge()) return null;

    // Try local endpoints first for instant response
    const localSnapshot = await readDesktopSnapshotFromLocal();
    if (localSnapshot) return localSnapshot;

    // Fallback to Supabase sync for remote control
    if (state.supabase && state.currentUser?.id) {
      const supabaseSnapshot = await readDesktopSnapshotFromSupabase();
      if (supabaseSnapshot) {
        desktopSnapshotEndpoint = "supabase-sync";
        desktopActionEndpoint = "";
        return supabaseSnapshot;
      }
    }
    return null;
  }

  async function readDesktopSnapshotFromLocal() {
    let lastError = null;
    const endpoints = resolveDesktopSnapshotEndpoints();
    for (const endpoint of endpoints) {
      try {
        const response = await window.fetch(endpoint, withLocalNetworkFetchOptions(endpoint, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json",
          },
        }));
        if (!response.ok) throw new Error(`Desktop media endpoint returned ${response.status}.`);
        const payload = await response.json();
        desktopSnapshotEndpoint = endpoint;
        desktopActionEndpoint = deriveDesktopActionEndpoint(endpoint);
        return normalizeDesktopSnapshot(payload);
      } catch (error) {
        lastError = error;
      }
    }

    const permissionPromptEndpoint = endpoints.find((candidate) => {
      const addressSpace = getEndpointAddressSpace(candidate);
      return addressSpace === "local" || addressSpace === "private" || addressSpace === "loopback";
    });

    const isRemoteOrigin = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
    if (permissionPromptEndpoint && !isRemoteOrigin) maybeTriggerLocalNetworkAccessPrompt(permissionPromptEndpoint);

    return null;
  }



  function refreshDesktopSnapshot({ renderAfter = true, force = false } = {}) {
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      desktopSnapshotReadPromise = null;
      lastDesktopSnapshotSignature = "none";
      return Promise.resolve(null);
    }

    if (desktopSnapshotReadPromise) return desktopSnapshotReadPromise;

    const now = Date.now();
    const isMediaMode = state.heroControlMode === "media";

    if (!force && state.desktopBridgeSuspended && !isMediaMode) {
      if (now - lastDesktopPollTime < 60000) {
        return Promise.resolve(desktopSnapshot);
      }
    }

    let waitTime = DESKTOP_POLL_INTERVAL_MS;
    if (desktopPollFailureCount > 0) {
      waitTime = Math.min(30000, DESKTOP_POLL_INTERVAL_MS * Math.pow(1.5, Math.min(8, desktopPollFailureCount)));
    }

    // Media mode can retry sooner, but avoid hammering the Windows SMTC bridge.
    if (isMediaMode) waitTime = Math.min(1200, waitTime);

    if (!force && now - lastDesktopPollTime < waitTime) {
      return Promise.resolve(desktopSnapshot);
    }

    lastDesktopPollTime = now;

    desktopSnapshotReadPromise = readDesktopSnapshot()
      .then((snapshot) => {
        // Prevent optimistic state flicker: Ignore incoming snapshots if an action was just performed
        if (Date.now() - lastDesktopActionAt < SNAPSHOT_INGEST_DELAY_MS) {
          desktopSnapshotReadPromise = null;
          return desktopSnapshot;
        }

        const nextSignature = getDesktopSnapshotSignature(snapshot);
        const didChange = nextSignature !== lastDesktopSnapshotSignature;

        desktopSnapshot = snapshot;
        lastDesktopSnapshotSignature = nextSignature;
        desktopPollFailureCount = 0;
        state.desktopBridgeSuspended = false;
        if (snapshot?.available) bridgeDetected = true;

        if (snapshot && snapshot.active && !snapshot.artworkUri) {
          hydrateDesktopSpotifyArtwork(snapshot, getControllablePlayerPost());
        }

        if (renderAfter && didChange) {
          render();
          if (typeof onStatusChange === "function") {
            onStatusChange();
          }
        }
        return desktopSnapshot;
      })
      .catch(() => {
        const didChange = lastDesktopSnapshotSignature !== "none";
        desktopSnapshot = null;
        lastDesktopSnapshotSignature = "none";
        desktopPollFailureCount += 1;

        if (desktopPollFailureCount >= 5) {
          state.desktopBridgeSuspended = true;
        }

        const shouldWarn = !state.desktopBridgeSuspended
          && !isNativeCapacitorApp()
          && (desktopPollFailureCount % 30 === 1);

        if (shouldWarn) {
          console.warn("[Hero] Desktop media bridge not detected. Run the Signal-Share desktop bridge on your PC with: node server.js");
        }

        if (renderAfter && didChange) {
          render();
          if (typeof onStatusChange === "function") {
            onStatusChange();
          }
        }
        return null;
      })
      .finally(() => {
        desktopSnapshotReadPromise = null;
      });

    return desktopSnapshotReadPromise;
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
    const preferredDesktopSnapshot = isPreferredNowPlayingSnapshot(desktopSnapshot);
    if (preferredDesktopSnapshot && hasSnapshotPlaybackContext(desktopSnapshot)) return true;
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

  function findMatchedPost(snapshot) {
    if (!snapshot || !snapshot.active) return null;
    let title = normalizeText(snapshot.title);
    let meta = normalizeText(snapshot.meta);
    if (!title) return null;

    // Clean up common platform suffixes that interfere with matching
    title = title.replace(/\s*[-:|]\s*(youtube|spotify|ytmusic|chrome|edge|firefox|opera|browser)$/i, "").trim();
    title = title.replace(/\s*\(official (video|audio|music video|lyric video)\)$/i, "").trim();
    title = title.replace(/\s*\[official (video|audio|music video|lyric video)\]$/i, "").trim();

    const posts = typeof getAllPosts === "function" ? getAllPosts() : [];
    return posts.find((p) => {
      const pTitle = normalizeText(p.title);
      const pCreator = normalizeText(p.creator);

      // 1. Direct match (Cleaned)
      if (pTitle === title && (pCreator === meta || !meta)) return true;

      // 2. Contains match for longer titles
      if (pTitle.length > 5 && (pTitle.includes(title) || title.includes(pTitle))) {
        if (pCreator === meta || !meta || meta.includes(pCreator) || pCreator.includes(meta)) return true;
      }
      return false;
    }) || null;
  }

  function getLocalPlaybackState() {
    const mediaElement = getActivePlayerMediaElement() || getFallbackPageMediaElement();
    if (mediaElement instanceof HTMLMediaElement) return mediaElement.paused ? "paused" : "playing";
    if (state.playerPostId || state.heroPlayerPostId) return normalizePlaybackState(state.heroPlayerPlaybackState || "paused");
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
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { }
  }

  function syncMediaSession(dataOrPost, mode, fallbackMedia) {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;

    // Support both old (post, mode, fallbackMedia) and new ({ title, artist, artwork }) call signatures
    let title = "";
    let artist = "";
    let album = "";
    let artwork = [];
    let playbackState = "none";

    if (dataOrPost && typeof dataOrPost === "object" && !dataOrPost.id && (dataOrPost.title || dataOrPost.artist)) {
      // New signature: syncMediaSession({ title, artist, artwork })
      title = dataOrPost.title || "";
      artist = dataOrPost.artist || "";
      album = dataOrPost.album || "Signal Share";

      const rawArtwork = dataOrPost.artwork;
      if (rawArtwork) {
        if (typeof rawArtwork === "string" && rawArtwork.trim()) {
          artwork = [{ src: rawArtwork }];
        } else if (isThenable(rawArtwork)) {
          // It's a promise (e.g. from Spotify artwork resolution).
          // We can't use it synchronously in MediaMetadata, but we can
          // wait for it and re-sync once it resolves.
          rawArtwork.then(resolvedUrl => {
            if (typeof resolvedUrl !== "string" || !resolvedUrl.trim()) return;
            if (resolvedArtworkMap.get(title) === resolvedUrl) return;
            resolvedArtworkMap.set(title, resolvedUrl);
            syncMediaSession({ ...dataOrPost, artwork: resolvedUrl });
          }).catch(() => { });

          // Use a cached version if we have one from a previous resolution of this title
          const cached = resolvedArtworkMap.get(title);
          if (cached) artwork = [{ src: cached }];
          else artwork = []; // Don't pass the Promise object!
        } else if (Array.isArray(rawArtwork)) {
          artwork = rawArtwork;
        }
      }
      playbackState = getLocalPlaybackState();
    } else {
      // Old signature: syncMediaSession(post, mode, fallbackMedia)
      const post = dataOrPost;
      playbackState = mode === "device"
        ? normalizePlaybackState(nativeSnapshot?.playbackState)
        : mode === "desktop"
          ? normalizePlaybackState(desktopSnapshot?.playbackState)
          : getLocalPlaybackState();

      if (mode === "device" && nativeSnapshot) {
        title = nativeSnapshot.title || "Device media";
        artist = nativeSnapshot.meta || "Now playing on this device";
        album = "Device playback";
        if (nativeSnapshot.artworkUri) artwork = [{ src: nativeSnapshot.artworkUri }];
      } else if (mode === "desktop" && desktopSnapshot) {
        title = desktopSnapshot.title || "Desktop media";
        artist = desktopSnapshot.meta || "Now playing on this PC";
        album = "System media";
        if (desktopSnapshot.artworkUri) artwork = [{ src: desktopSnapshot.artworkUri }];
      } else if (post) {
        const creatorSummary = getProfileSummaryForPost(post);
        title = post.title || "Signal Share";
        artist = creatorSummary?.displayName ?? post.creator ?? "";
        album = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`;
        const resolvedArtwork = resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl });
        if (resolvedArtwork) artwork = [{ src: resolvedArtwork }];
      } else if (fallbackMedia instanceof HTMLMediaElement) {
        const metadata = getBrowserMediaMetadata();
        title = metadata?.title || fallbackMedia.getAttribute("title") || "Browser media";
        artist = metadata?.artist || "";
        album = metadata?.album || "This tab";
        if (metadata?.artworkUrl) artwork = [{ src: metadata.artworkUrl }];
      }
    }

    try { session.playbackState = playbackState; } catch { }

    const MetadataCtor = typeof window !== "undefined" ? window.MediaMetadata : null;
    if (typeof MetadataCtor === "function") {
      try {
        if (title || artist) {
          session.metadata = new MetadataCtor({ title, artist, album, artwork });
        } else {
          session.metadata = null;
        }
      } catch (err) {
        console.warn("[Hero] Failed to update MediaSession metadata:", err);
      }
    }

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

    const preferredSource = getPreferredHeroControlSource();

    // 1. Try to find a playable post that matches the preferred source (Spotify/YouTube)
    // This allows the Hero Stage to show a relevant preview (e.g. "Spotify Preview")
    // when the user has selected a platform but nothing is currently playing.
    if (preferredSource) {
      const posts = playableIds.map(id => getPostById(id));
      const platformMatch = posts.find(p => p && p.sourceKind === preferredSource);
      if (platformMatch) return platformMatch;
    }

    // 2. Prioritize the scroll-tracked active post if it's playable and visible
    if (state.activeFeedPostId && playableIds.includes(state.activeFeedPostId)) {
      return getPostById(state.activeFeedPostId);
    }

    return getPostById(playableIds[0]);
  }

  function toggleLocalPlayback(forcePlay) {
    const mediaElement = getActivePlayerMediaElement() || getFallbackPageMediaElement();
    if (mediaElement instanceof HTMLMediaElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : mediaElement.paused;
      if (shouldPlay) {
        const playResult = mediaElement.play();
        if (playResult && typeof playResult.catch === "function") playResult.catch(() => { });
        state.heroPlayerPlaybackState = "playing";
      } else {
        mediaElement.pause();
        state.heroPlayerPlaybackState = "paused";
      }
      return true;
    }

    const post = getControllablePlayerPost();
    const activeMedia = getActivePlayerMediaElement();
    if (post?.sourceKind === "youtube" && activeMedia instanceof HTMLIFrameElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : getLocalPlaybackState() !== "playing";
      postMessageToYouTubePlayer(activeMedia, shouldPlay ? "playVideo" : "pauseVideo");
      state.heroPlayerPlaybackState = shouldPlay ? "playing" : "paused";
      return true;
    }

    return false;
  }

  let isRefreshing = false;
  async function handleRefresh() {
    if (isRefreshing || !hasUi()) return;
    isRefreshing = true;

    // Visual feedback on the stage/status
    const prevStatus = elements.heroPlayerStatus.textContent;
    elements.heroPlayerStatus.textContent = "REFRESHING...";
    elements.heroPlayerRefreshButton?.classList.add("loading");

    try {
      // 1. Clear matched post cache temporarily to force a re-evaluation
      matchedPost = null;

      // 2. Force immediate poll of available bridges
      if (hasNativeSnapshotBridge()) {
        await pollNativeSnapshot();
      }
      if (canUseDesktopBridge()) {
        await pollDesktopSnapshot();
      }

      // 3. Android: Explicitly poke the native layer to broadcast state
      if (isNativeCapacitorApp()) {
        const bridge = getNativeBridge();
        if (bridge && typeof bridge.forceRefreshNowPlaying === "function") {
          bridge.forceRefreshNowPlaying();
        }
      }

      // 4. Re-render the UI
      render();

      if (typeof window.showNotification === "function") {
        window.showNotification({
          title: "Player Synchronized",
          body: "Media session state has been refreshed.",
          kind: "success"
        });
      }
    } catch (error) {
      console.error("[Hero] Refresh failed:", error);
    } finally {
      setTimeout(() => {
        isRefreshing = false;
        elements.heroPlayerRefreshButton?.classList.remove("loading");
        // Restore status if it hasn't been changed by a newer poll
        if (elements.heroPlayerStatus.textContent === "REFRESHING...") {
          elements.heroPlayerStatus.textContent = prevStatus;
        }
      }, 800);
    }
  }

  function performNativeAction(action) {
    if (!hasNativeActionBridge()) return false;

    const source = getPreferredHeroControlSource();
    console.log(`[Hero] Native Action: ${action} (Source: ${source})`);
    
    const now = Date.now();
    if (nativeActionInFlight && now - lastNativeActionAt < NATIVE_ACTION_COOLDOWN_MS) {
      return false;
    }

    const bridge = getNativeBridge();
    try {
      lastNativeActionAt = now;
      nativeActionInFlight = true;

      // Optimistic state update for Android to make Play/Pause feel instant
      if (action === NATIVE_ACTION_PLAY_PAUSE && nativeSnapshot) {
        const wasPlaying = nativeSnapshot.playbackState === "playing";
        nativeSnapshot.playbackState = wasPlaying ? "paused" : "playing";
        
        // Find play button and add a quick feedback class if it exists
        if (elements.heroPlayerPlayPauseButton) {
           elements.heroPlayerPlayPauseButton.classList.add('optimistic-pulse');
           setTimeout(() => elements.heroPlayerPlayPauseButton.classList.remove('optimistic-pulse'), 400);
        }
        
        render();
      }

      const success = bridge.performNowPlayingAction(action, source);

      window.setTimeout(() => {
        nativeActionInFlight = false;
        // Delay the poll slightly so native state has time to update
        if (Date.now() - lastNativeActionAt > 900) refreshNativeSnapshot();
      }, 1000);

      return Boolean(success);
    } catch {
      nativeActionInFlight = false;
      return false;
    }
  }

  function performDesktopAction(action, payload = {}) {
    if (!canUseDesktopBridge()) return Promise.resolve(false);

    const now = Date.now();
    const preferredSource = getPreferredHeroControlSource();
    const actionKey = `${preferredSource || "all"}|${action}|${JSON.stringify(payload || {})}`;

    if (desktopActionInFlight && actionKey === lastDesktopActionKey) return Promise.resolve(false);
    if (now - lastDesktopActionAt < DESKTOP_ACTION_COOLDOWN_MS && actionKey === lastDesktopActionKey) {
      return Promise.resolve(false);
    }

    lastDesktopActionAt = now;
    lastDesktopActionKey = actionKey;
    desktopActionInFlight = true;

    window.setTimeout(() => {
      if (lastDesktopActionKey === actionKey) desktopActionInFlight = false;
    }, DESKTOP_ACTION_COOLDOWN_MS);

    const isRemoteOrigin = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
    const isLocalEndpoint = desktopSnapshotEndpoint && desktopSnapshotEndpoint !== "supabase-sync" && !desktopSnapshotEndpoint.startsWith("/");

    if (desktopSnapshotEndpoint === "supabase-sync" || (isRemoteOrigin && !isLocalEndpoint && state.currentUser?.id)) {
      return performSupabaseDesktopAction(action, { preferredSource, ...payload });
    }

    const actionEndpoint = getDesktopActionEndpoint();
    if (!actionEndpoint) return Promise.resolve(false);

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const abortTimer = controller ? window.setTimeout(() => controller.abort(), 2200) : 0;

    return window.fetch(actionEndpoint, withLocalNetworkFetchOptions(actionEndpoint, {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      signal: controller?.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action,
        appPackage: desktopSnapshot?.appPackage || "",
        preferredSource,
        ...payload
      }),
    }))
      .then((response) => response.ok ? response.json().catch(() => ({ ok: true })) : { ok: false })
      .then((responsePayload) => {
        window.setTimeout(() => refreshDesktopSnapshot({ force: true }), 260);
        window.setTimeout(() => refreshDesktopSnapshot({ force: true }), 950);
        return Boolean(responsePayload?.ok);
      })
      .catch(() => false)
      .finally(() => {
        if (abortTimer) window.clearTimeout(abortTimer);
      });
  }

  async function performSupabaseDesktopAction(action, payload = {}) {
    const userId = state.currentUser?.id;
    if (!state.supabase || !userId) {
      console.warn("[Hero] Cannot send media action: Missing Supabase client or authenticated User ID.");
      return false;
    }

    try {
      const { error } = await state.supabase.from("system_media_actions").insert({
        user_id: userId,
        action: action,
        app_package: desktopSnapshot?.appPackage || "",
        payload: payload
      });

      if (error) {
        console.error("[Hero] Supabase media action error:", error.message, error.details);
        throw error;
      }
      return true;
    } catch (error) {
      console.error("[Hero] Failed to send media action via Supabase:", error);
      return false;
    }
  }

  function getEffectiveHeroMode(controllablePost) {
    if (state.heroControlMode === "feed") return "app";
    if (state.heroControlMode === "media") {
      // Prioritize whatever is actually active
      if (desktopSnapshot?.active) return "desktop";
      if (nativeSnapshot?.active) return "device";

      // If nothing is active, prefer desktop bridge if it seems healthy
      if (canUseDesktopBridge() && desktopPollFailureCount < 5) return "desktop";
      return "device";
    }

    // Auto mode
    if (shouldUseNativeMode(controllablePost)) return "device";
    if (shouldUseDesktopMode(controllablePost)) return "desktop";
    return "app";
  }

  function handlePlayPause(forcePlay) {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);
    console.log(`[Hero] handlePlayPause triggered. Mode: ${mode}, ForcePlay: ${forcePlay || "toggle"}`);

    if (mode === "app") {
      if (typeof playHeroMedia === "function") {
        playHeroMedia();
      } else {
        console.error("[Hero] playHeroMedia function is not provided in options.");
      }
      return;
    }

    if (mode === "device") {
      if (nativeSnapshot?.permissionRequired && hasNativeSettingsBridge()) {
        try { getNativeBridge().openNowPlayingAccessSettings(); } catch { }
        return;
      }

      const now = Date.now();
      if (now - lastNativeActionAt < NATIVE_ACTION_COOLDOWN_MS) {
        console.warn("[Hero] Native action throttled by cooldown.");
        return;
      }

      if (nativeSnapshot) {
        nativeSnapshot.playbackState = (nativeSnapshot.playbackState === "playing") ? "paused" : "playing";
        render();
      }
      performNativeAction(NATIVE_ACTION_PLAY_PAUSE);
      return;
    }

    if (mode === "desktop") {
      if (!isNativeCapacitorApp() && !desktopSnapshot && !companionPromptDismissed) {
        showCompanionPrompt();
        return;
      }

      const playbackStatus = normalizePlaybackState(desktopSnapshot?.playbackState);
      const nextPlaybackState = playbackStatus === "playing" ? "paused" : "playing";
      console.log(`[Hero] Desktop play/pause. Current: ${playbackStatus}, Next: ${nextPlaybackState}`);

      if (desktopSnapshot) {
        desktopSnapshot = {
          ...desktopSnapshot,
          active: true,
          playbackState: nextPlaybackState,
        };
        lastDesktopSnapshotSignature = getDesktopSnapshotSignature(desktopSnapshot);

        if (elements.heroPlayerPlayPauseButton) {
          elements.heroPlayerPlayPauseButton.classList.add('optimistic-pulse');
          setTimeout(() => elements.heroPlayerPlayPauseButton.classList.remove('optimistic-pulse'), 400);
        }

        render();
      }

      performDesktopAction(DESKTOP_ACTION_PLAY_PAUSE).then(success => {
        if (!success) {
          console.warn("[Hero] Desktop action failed or was throttled.");
        }
      });
      return;
    }

    if (getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      toggleLocalPlayback(forcePlay);
      render();
    }
  }

  function handlePrevious() {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    if (mode === "app") {
      const wasActive = state.heroPlayerPostId && state.heroPlayerElement && elements.heroPlayerStage.contains(state.heroPlayerElement);
      // Force preview update
      if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
      stepHeroPlayer(-1);
      if (!wasActive) state.heroPlayerPlaybackState = "paused";
      render();
      return;
    }

    if (mode === "device") {
      const now = Date.now();
      if (now - lastNativeActionAt < NATIVE_ACTION_COOLDOWN_MS) return;

      if (nativeSnapshot) {
        nativeSnapshot.playbackState = "playing"; // Optimistic
        render();
      }
      performNativeAction(NATIVE_ACTION_PREVIOUS);
      return;
    }

    if (mode === "desktop") {
      if (desktopSnapshot) {
        desktopSnapshot = { ...desktopSnapshot, active: true, playbackState: "playing" };
        lastDesktopSnapshotSignature = getDesktopSnapshotSignature(desktopSnapshot);
        render();
      }
      performDesktopAction(DESKTOP_ACTION_PREVIOUS);
      return;
    }

    if (getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      render();
      return;
    }

    if (ensureControllablePost()) {
      stepMiniPlayer(-1);
      state.heroPlayerPlaybackState = "paused";
      render();
    }
  }

  function handleNext() {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    if (mode === "app") {
      const wasActive = state.heroPlayerPostId && state.heroPlayerElement && elements.heroPlayerStage.contains(state.heroPlayerElement);
      // Force preview update
      if (elements.heroPlayerStage) delete elements.heroPlayerStage.dataset.heroPreviewKey;
      stepHeroPlayer(1);
      if (!wasActive) state.heroPlayerPlaybackState = "paused";
      render();
      return;
    }

    if (mode === "device") {
      const now = Date.now();
      if (now - lastNativeActionAt < NATIVE_ACTION_COOLDOWN_MS) return;

      if (nativeSnapshot) {
        nativeSnapshot.playbackState = "playing"; // Optimistic
        render();
      }
      performNativeAction(NATIVE_ACTION_NEXT);
      return;
    }

    if (mode === "desktop") {
      if (desktopSnapshot) {
        desktopSnapshot = { ...desktopSnapshot, active: true, playbackState: "playing" };
        lastDesktopSnapshotSignature = getDesktopSnapshotSignature(desktopSnapshot);
        render();
      }
      performDesktopAction(DESKTOP_ACTION_NEXT);
      return;
    }

    if (getFallbackPageMediaElement() instanceof HTMLMediaElement) {
      render();
      return;
    }

    if (ensureControllablePost()) {
      stepMiniPlayer(1);
      state.heroPlayerPlaybackState = "paused";
      render();
    }
  }

  function handleOpenPhone() {
    handleOpenPhoneAction(getControllablePlayerPost(), { isNativeCapacitorApp, state, openViewer, desktopSnapshot, performDesktopAction });
  }

  function handleOpenMedia() {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);
    let post = null;

    if (mode === "app") {
      post = controllablePost;
    } else if (mode === "desktop" && desktopSnapshot) {
      post = findMatchedPost(desktopSnapshot);
    } else if (mode === "device" && nativeSnapshot) {
      post = findMatchedPost(nativeSnapshot);
    }

    handleOpenMediaAction(post, { isNativeCapacitorApp, state, openViewer, desktopSnapshot, performDesktopAction, parseYouTubeUrl });
  }

  function handleVolumeInput(event) {
    const post = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(post);

    const rawValue = Number(event.target?.value);
    const volume = normalizePlayerVolume(rawValue / 100, state.playerVolume);

    state.playerVolume = volume;
    savePlayerVolume(state.playerVolume);

    if (mode === "device") {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.setNowPlayingVolume === "function") {
        bridge.setNowPlayingVolume(volume);
      }
    } else if (mode === "desktop" && desktopSnapshot?.available) {
      // Windows SMTC does not expose reliable app volume control here; avoid flooding the bridge with unsupported set_volume requests.
    } else if (mode === "app") {
      applyPlayerVolumeToActiveElement();
      const fallbackMedia = getFallbackPageMediaElement();
      if (!(getActivePlayerMediaElement() instanceof HTMLMediaElement) && fallbackMedia instanceof HTMLMediaElement) {
        try { fallbackMedia.volume = state.playerVolume; } catch { }
      }
    }
    render();
  }

  function renderStagePreview(mode, post, fallbackMedia) {
    renderHeroStagePreview(Object.assign({}, options, {
      stage: elements.heroPlayerStage,
      mode,
      post,
      fallbackMedia,
      nativeSnapshot,
      desktopSnapshot
    }));
  }
  function attachEventListeners() {
    if (listenersAttached || !hasUi()) return;
    listenersAttached = true;

    elements.heroPlayerPlayPauseButton.addEventListener("click", (event) => {
      handlePlayPause();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });

    elements.heroPlayerOpenMediaButton.addEventListener("click", (event) => {
      handleOpenMedia();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });

    elements.heroPlayerOpenPhoneButton.addEventListener("click", (event) => {
      handleOpenPhone();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });

    elements.heroPlayerRefreshButton?.addEventListener("click", (event) => {
      handleRefresh();
      if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    });

    // Android: Disable pull-to-refresh while interacting with the Hero Stage
    if (elements.heroPlayerStage && isNativeCapacitorApp()) {
      elements.heroPlayerStage.addEventListener("touchstart", () => {
        const bridge = getNativeBridge();
        if (bridge && typeof bridge.setPullToRefreshEnabled === "function") {
          bridge.setPullToRefreshEnabled(false);
        }
      }, { passive: true });

      const reEnableRefresh = () => {
        const bridge = getNativeBridge();
        if (bridge && typeof bridge.setPullToRefreshEnabled === "function") {
          bridge.setPullToRefreshEnabled(true);
        }
      };

      elements.heroPlayerStage.addEventListener("touchend", reEnableRefresh, { passive: true });
      elements.heroPlayerStage.addEventListener("touchcancel", reEnableRefresh, { passive: true });
    }

    document.getElementById("companionPromptYes")?.addEventListener("click", () => {
      handleCompanionResponse(true);
    });
    document.getElementById("companionPromptInstructions")?.addEventListener("click", () => {
      showSetupInstructions();
    });
    document.getElementById("companionPromptNo")?.addEventListener("click", () => {
      handleCompanionResponse(false);
    });

    document.getElementById("companionSetupClose")?.addEventListener("click", () => {
      hideSetupInstructions();
    });

    document.getElementById("companionDownloadLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadCompanion();
    });

    document.getElementById("companionSecurityLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadSecurityReadme();
    });

    document.getElementById("copySetupCommand")?.addEventListener("click", () => {
      const cmd = document.getElementById("setupCommand")?.textContent;
      if (cmd) {
        navigator.clipboard.writeText(cmd).then(() => {
          const btn = document.getElementById("copySetupCommand");
          if (btn) btn.textContent = "Copied!";
          setTimeout(() => { if (btn) btn.textContent = "Copy"; }, 2000);
        });
      }
    });

    elements.heroPlayerStage?.addEventListener("click", (e) => {
      if (e.target.closest(".hero-companion-download-btn")) {
        showSetupInstructions();
      }
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
    const heroPost = getHeroPost();
    const playablePosts = getHeroPlayablePosts();
    const playableCount = playablePosts.length;
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    const canStep = playableCount > 1;

    if (elements.heroPlayerPrevButton.disabled !== !canStep) {
      elements.heroPlayerPrevButton.disabled = !canStep;
    }
    if (elements.heroPlayerNextButton.disabled !== !canStep) {
      elements.heroPlayerNextButton.disabled = !canStep;
    }

    if (!hasNativeSnapshotBridge()) {
      nativeSnapshot = null;
      stopNativeSnapshotPolling();
    }
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      stopDesktopSnapshotPolling();
    }

    // When in Media mode, we don't treat the internal "Hero Active" state as valid
    // unless it's explicitly matching the system media (unlikely for manual toggle).
    const isHeroActive = mode === "app"
      && state.heroPlayerPostId
      && !!state.heroPlayerElement
      && elements.heroPlayerStage.contains(state.heroPlayerElement);

    const mediaElement = getActivePlayerMediaElement();
    const fallbackMedia = getFallbackPageMediaElement();
    const browserMetadata = getBrowserMediaMetadata();

    let playbackState = mode === "device"
      ? normalizePlaybackState(nativeSnapshot?.playbackState)
      : mode === "desktop"
        ? normalizePlaybackState(desktopSnapshot?.playbackState)
        : getLocalPlaybackState();

    // If we are in app mode but the actual player isn't in the stage yet,
    // it's effectively "paused" (showing a preview card).
    if (mode === "app" && !isHeroActive) {
      playbackState = "paused";
    }

    // LOCK HEADER: If we are actively playing a post in the hero player,
    // lock the header to that post's metadata regardless of filter changes.
    const isPlayingHeroPost = mode === "app" && isHeroActive && playbackState === "playing";
    const post = isPlayingHeroPost
      ? getPostById(state.heroPlayerPostId)
      : (mode === "app" ? getHeroPost() : controllablePost);

    const supportsVolume = (mode === "app" && (
      mediaElement instanceof HTMLMediaElement
      || fallbackMedia instanceof HTMLMediaElement
      || post?.sourceKind === "youtube"
    )) || (mode === "device" && isNativeCapacitorApp());

    const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
    const matchedPost = mode === "device" ? findMatchedPost(nativeSnapshot) : (mode === "desktop" ? findMatchedPost(desktopSnapshot) : null);

    const playbackStateLabel = (playbackState === "playing" ? "NOW PLAYING" : "PAUSED");
    let nextHeader = playbackStateLabel;
    let nextTitle = "";
    let nextCaption = "";
    let nextStatus = "";

    // For System Media Session (Windows OSD), we keep the original data even if UI is hardened
    let syncTitle = "";
    let syncArtist = "";
    let syncArtwork = "";

    const isYouTubeMode = (state?.heroControlSource === "youtube" || state?.heroMediaSource === "youtube" || state?.systemMediaSource === "youtube");
    const isSpotifyActive = (state?.heroControlSource === "spotify" || state?.heroMediaSource === "spotify" || state?.systemMediaSource === "spotify");
    const isFeedMode = state?.heroControlMode === "feed";
    const isHardenedEnvironment = (isFeedMode || state?.heroControlMode === "media");

    if (mode === "device") {
      const modeLabel = getSystemMediaHeaderLabel();
      if (nativeSnapshot?.permissionRequired) {
        nextTitle = "Enable device media access";
        nextCaption = "Allow notification access to control playback.";
        nextStatus = modeLabel;
      } else if (nativeSnapshot?.active) {
        nextTitle = cleanSnapshotTitle(nativeSnapshot.title);
        nextCaption = (matchedPost && matchedPost.creator) ? matchedPost.creator : cleanSnapshotCreator(nativeSnapshot, "Device playback");
        nextStatus = matchedPost ? "MATCHED FROM FEED" : modeLabel;
        if (matchedPost) nextHeader = "SYNCED";
        
        syncTitle = nextTitle;
        syncArtist = nextCaption;
        syncArtwork = nativeSnapshot.artworkUri || "";
      } else {
        nextTitle = "Device media idle";
        nextCaption = "Start playback in any media app.";
        nextStatus = modeLabel;
      }
    } else if (mode === "desktop") {
      const modeLabel = getSystemMediaHeaderLabel();
      if (desktopSnapshot?.active) {
        nextTitle = cleanSnapshotTitle(desktopSnapshot.title);
        nextCaption = cleanSnapshotCreator(desktopSnapshot, "Desktop playback");
        nextStatus = modeLabel;
        syncTitle = nextTitle;
        syncArtist = nextCaption;
        syncArtwork = desktopSnapshot.artworkUri || "";
      } else {
        const preferredSource = getPreferredHeroControlSource();
        nextTitle = preferredSource ? `${preferredSource.charAt(0).toUpperCase()}${preferredSource.slice(1)} media idle` : "PC media idle";
        nextCaption = preferredSource === "spotify"
          ? "Start Spotify playback on this PC."
          : preferredSource === "youtube"
            ? "Start YouTube playback in your browser."
            : "Start playback in YouTube, Spotify, or another desktop app.";
        nextStatus = modeLabel;
      }
    } else if (mode === "app" && !post && fallbackMedia instanceof HTMLMediaElement) {
      const modeLabel = "BROWSER MEDIA";
      const fallbackTitle = browserMetadata?.title || fallbackMedia.getAttribute("title") || "Now playing in this browser";
      const fallbackMeta = [browserMetadata?.artist, browserMetadata?.album].filter(Boolean).join(" · ");
      nextTitle = fallbackTitle;
      nextCaption = fallbackMeta || "Active browser media session";
      nextStatus = modeLabel;
    } else if (mode === "app" && !post) {
      nextTitle = "Ready to play";
      nextCaption = "";
      nextStatus = "APP MEDIA";
    } else {
      const providerName = getExternalProviderName(post);
      const modeLabel = `${providerName.toUpperCase()} PREVIEW`;

      if (isExternalUrlPost(post)) {
        const externalDisplay = getExternalHeaderDisplay(post);
        nextTitle = externalDisplay.title || "Ready to play";
        nextCaption = externalDisplay.caption || providerName;
      } else {
        const creatorSummary = getProfileSummaryForPost(post);
        const creatorName = creatorSummary?.displayName ?? post?.creator ?? "Member";
        nextTitle = post?.title || "Ready to play";
        nextCaption = post ? `${post.caption} · ${creatorName}` : "";
      }

      nextStatus = post ? `${formatKind(post.mediaKind)} · ${getSignalLabel(post)}` : modeLabel;
      if (!post) nextStatus = modeLabel;

      syncTitle = nextTitle;
      syncArtist = nextCaption;
    }

    // Only touch the DOM if values have changed
    if (elements.heroPlayerHeader.textContent !== nextHeader) elements.heroPlayerHeader.textContent = nextHeader;
    if (elements.heroPlayerTitle.textContent !== nextTitle) elements.heroPlayerTitle.textContent = nextTitle;
    if (elements.heroPlayerCaption.textContent !== nextCaption) elements.heroPlayerCaption.textContent = nextCaption;
    if (elements.heroPlayerStatus.textContent !== nextStatus) elements.heroPlayerStatus.textContent = nextStatus;

    const isSpotifySelected = post?.sourceKind === "spotify" || isSpotifyActive;
    const openMediaLabel = isSpotifySelected ? "Open Spotify" : (post?.sourceKind === "youtube" ? "Open YouTube" : "Open Media");
    if (elements.heroPlayerOpenMediaButton.textContent !== openMediaLabel) {
      elements.heroPlayerOpenMediaButton.textContent = openMediaLabel;
    }

    const playPauseLabel = playbackState === "playing" ? "Pause" : "Play";
    if (elements.heroPlayerPlayPauseButton.textContent !== playPauseLabel) {
      elements.heroPlayerPlayPauseButton.textContent = playPauseLabel;
    }

    const isPlayPauseDisabled = mode === "app" && !post;
    if (elements.heroPlayerPlayPauseButton.disabled !== isPlayPauseDisabled) {
      elements.heroPlayerPlayPauseButton.disabled = isPlayPauseDisabled;
    }

    const isAndroid = isNativeCapacitorApp() && getCapacitorPlatform() === "android";
    const specialActionLabel = isAndroid ? "Open PC" : "Open Phone";
    if (elements.heroPlayerOpenPhoneButton.textContent !== specialActionLabel) {
      elements.heroPlayerOpenPhoneButton.textContent = specialActionLabel;
    }

    // Show special action button if we are not already in that mode
    const showSpecialAction = isAndroid ? (mode !== "desktop") : (mode !== "device");

    if (elements.heroPlayerOpenPhoneButton.hidden !== !showSpecialAction) {
      elements.heroPlayerOpenPhoneButton.hidden = !showSpecialAction;
    }

    if (elements.heroPlayerVolumeSlider.disabled !== !supportsVolume) {
      elements.heroPlayerVolumeSlider.disabled = !supportsVolume;
    }
    if (elements.heroPlayerVolumeSlider.value !== String(volumePercent)) {
      elements.heroPlayerVolumeSlider.value = String(volumePercent);
    }
    const volumeText = supportsVolume ? `${volumePercent}%` : "--";
    if (elements.heroPlayerVolumeValue.textContent !== volumeText) {
      elements.heroPlayerVolumeValue.textContent = volumeText;
    }

    if (!isHeroActive) {
      renderHeroStagePreview(Object.assign({}, options, {
        stage: elements.heroPlayerStage,
        mode,
        post: mode === "app" ? post : null, // ONLY pass the feed post if we are in app mode
        fallbackMedia,
        desktopSnapshot,
        matchedPost,
        showCompanionCard: !isNativeCapacitorApp() && mode === "desktop" && !desktopSnapshot?.active,
        active: mode !== "app" // Treat media modes as "active" to show info/matched player
      }));
    }

    syncMediaSession({
      title: syncTitle || nextTitle,
      artist: syncArtist || nextCaption,
      artwork: syncArtwork || (post ? resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl }) : (browserMetadata?.artwork || "")),
    });
    if (typeof renderMiniPlayer === "function") renderMiniPlayer();
  }

  function subscribeToRemoteActions() {
    const userId = state.currentUser?.id;
    if (!state.supabase || !userId) return;

    // Real-time listener for remote media actions (Cross-device control)
    state.supabase
      .channel('remote-media-actions')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'system_media_actions',
        filter: `user_id=eq.${userId}` 
      }, payload => {
        const data = payload.new;
        if (!data) return;

        // If this is an 'open_uri' command targeted at this device type
        if (data.action === "open_uri" && data.payload?.uri) {
          if (isNativeCapacitorApp()) {
             const bridge = getNativeBridge();
             if (bridge && typeof bridge.openNowPlayingMediaApp === "function") {
               console.log("[Hero] Executing remote open command:", data.payload.uri);
               bridge.openNowPlayingMediaApp("", data.payload.uri, true);
             }
          }
        }
      })
      .subscribe();
  }

  function initialize() {
    attachEventListeners();
    initializeSdkHooks();
    subscribeToRemoteActions();
  }

  initialize();

  return {
    attachEventListeners,
    render,
    handlePlayPause,
    handleNext,
    handlePrevious,
    handleVolumeInput,
    setHeroControlSource: (source) => { syncHeroControlSourceChange(source); },
    openNowPlayingMediaApp: (packageName, uri) => {
      if (hasNativeActionBridge()) {
        try { getNativeBridge().openNowPlayingMediaApp(packageName, uri, true); return true; } catch { return false; }
      }
      if (canUseDesktopBridge()) {
        return performDesktopAction("open_uri", { uri });
      }
      return false;
    },
    getSnapshot: () => ({
      native: nativeSnapshot,
      desktop: desktopSnapshot,
      isBridgeDetected: bridgeDetected
    }),
    showCompanionPrompt,
    hideCompanionPrompt,
    handleCompanionResponse,
    performSupabaseDesktopAction,
    downloadCompanion,
    downloadSecurityReadme
  };

  function showCompanionPrompt() {
    const overlay = document.getElementById("companionPromptOverlay");
    if (overlay) overlay.hidden = false;
  }

  function hideCompanionPrompt() {
    const overlay = document.getElementById("companionPromptOverlay");
    if (overlay) overlay.hidden = true;
  }

  function handleCompanionResponse(accepted) {
    hideCompanionPrompt();
    if (accepted) {
      downloadCompanion();
    } else {
      companionPromptDismissed = true;
      localStorage.setItem("ss_companion_dismissed", "true");
      render();
    }
  }

  function downloadCompanion() {
    const blob = new Blob([COMPANION_SETUP_SCRIPT], { type: "application/x-bat" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "setup-companion.bat";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    companionPromptDismissed = true;
    localStorage.setItem("ss_companion_dismissed", "true");
    render();
  }

  function downloadSecurityReadme() {
    const blob = new Blob([COMPANION_SECURITY_README], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "COMPANION_SECURITY.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showSetupInstructions() {
    const overlay = document.getElementById("companionSetupOverlay");
    if (overlay) overlay.hidden = false;
  }

  function hideSetupInstructions() {
    const overlay = document.getElementById("companionSetupOverlay");
    if (overlay) overlay.hidden = true;
  }
}
