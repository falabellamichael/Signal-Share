import { renderHeroStagePreview, resolveAppPreviewArtwork } from "./hero-media-player-preview.js";



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
    getHeroPost,
    setHeroPost,
    playHeroMedia,
    stepHeroPlayer,
    getHeroPlayablePosts,
    resolveYouTubePreviewId,
  } = options;

  const NATIVE_ACTION_PLAY_PAUSE = "play_pause";
  const NATIVE_ACTION_NEXT = "next";
  const NATIVE_ACTION_PREVIOUS = "previous";
  const NATIVE_POLL_INTERVAL_MS = 3000;
  const DESKTOP_ACTION_PLAY_PAUSE = "play_pause";
  const DESKTOP_ACTION_NEXT = "next";
  const DESKTOP_ACTION_PREVIOUS = "previous";
  const DESKTOP_POLL_INTERVAL_MS = 3000;
  const LOCAL_NETWORK_PROMPT_COOLDOWN_MS = 30000;

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
  const desktopArtworkFallbackCache = new Map();
  const resolvedArtworkMap = new Map();

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

  function isPreferredNowPlayingAppPackage(value = "") {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    return normalized.includes("spotify")
      || normalized.includes("youtube")
      || normalized.includes("ytmusic")
      || normalized.includes("youtube.music");
  }

  function isPreferredNowPlayingUri(value = "") {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    return normalized.startsWith("spotify:")
      || normalized.includes("open.spotify.com")
      || normalized.startsWith("vnd.youtube:")
      || normalized.includes("youtube.com")
      || normalized.includes("music.youtube.com")
      || normalized.includes("youtu.be/");
  }

  function isPreferredNowPlayingSnapshot(snapshot = null) {
    if (!snapshot) return false;
    return isPreferredNowPlayingAppPackage(snapshot.appPackage)
      || isPreferredNowPlayingUri(snapshot.openUri);
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
    if (nativeSnapshot && nativeSnapshot.active && !nativeSnapshot.artworkUri) {
      hydrateDesktopSpotifyArtwork(nativeSnapshot, getControllablePlayerPost());
    }
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
    if (value === "localhost" || value.endsWith(".localhost")) return "loopback";
    if (value.endsWith(".local")) return "local";
    if (value === "::1" || value === "[::1]") return "loopback";
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
      return {
        ...init,
        targetAddressSpace: addressSpace,
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
    pushDesktopEndpointCandidate(candidates, desktopSnapshotEndpoint, seen);

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim()) {
      pushDesktopEndpointCandidate(candidates, window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim(), seen);
    }

    if (typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL === "string" && window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim()) {
      const baseUrl = window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim().replace(/\/+$/, "");
      pushDesktopEndpointCandidate(candidates, `${baseUrl}/api/system-media/current`, seen);
    }

    // Only try localhost/loopback if we are actually local OR if we have reason to believe a bridge is there.
    // GitHub Pages / Remote Origins should not poll relative /api paths as they are guaranteed 404s.
    const isRemoteOrigin = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";

    // GitHub Pages / Remote Origins should not poll relative /api paths as they are guaranteed 404s.
    // We only try localhost/loopback if we have reason to believe a bridge is there or if in Media mode.
    if (isRemoteOrigin && desktopPollFailureCount > 3 && state.heroControlMode !== "media") {
       // On remote, if it's failing, don't even try loopback unless user is looking for it
       return candidates;
    }

    pushDesktopEndpointCandidate(candidates, "http://127.0.0.1:3000/api/system-media/current", seen);
    pushDesktopEndpointCandidate(candidates, "http://localhost:3000/api/system-media/current", seen);

    if (isLocalOrigin) {
      try {
        pushDesktopEndpointCandidate(candidates, new URL("/api/system-media/current", window.location.href).toString(), seen);
      } catch {
        pushDesktopEndpointCandidate(candidates, "/api/system-media/current", seen);
      }
    }

    if (!candidates.length && isLocalOrigin) {
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
      });
    } catch (error) {
      console.error("Failed to read desktop snapshot from Supabase:", error);
      return null;
    }
  }

  async function readDesktopSnapshot() {
    if (!canUseDesktopBridge()) return null;

    // Prioritize Supabase sync if configured and signed in
    if (state.supabase && state.currentUser?.id) {
      const supabaseSnapshot = await readDesktopSnapshotFromSupabase();
      if (supabaseSnapshot) {
        desktopSnapshotEndpoint = "supabase-sync";
        desktopActionEndpoint = "";
        return supabaseSnapshot;
      }
    }

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

    // If local polling failed and we haven't tried Supabase yet (though we usually do above),
    // try it as a last resort if it's potentially available.
    if (desktopSnapshotEndpoint !== "supabase-sync" && state.currentUser?.id) {
      const supabaseSnapshot = await readDesktopSnapshotFromSupabase();
      if (supabaseSnapshot) return supabaseSnapshot;
    }

    const permissionPromptEndpoint = endpoints.find((candidate) => {
      const addressSpace = getEndpointAddressSpace(candidate);
      return addressSpace === "local" || addressSpace === "private" || addressSpace === "loopback";
    });

    const isRemoteOrigin = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
    if (permissionPromptEndpoint && !isRemoteOrigin) maybeTriggerLocalNetworkAccessPrompt(permissionPromptEndpoint);

    throw lastError || new Error("Desktop media endpoint is unavailable.");
  }

  let lastDesktopPollTime = 0;

  function refreshDesktopSnapshot({ renderAfter = true } = {}) {
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      return Promise.resolve(null);
    }

    const now = Date.now();
    const isMediaMode = state.heroControlMode === "media";

    // If suspended due to too many failures, only retry every 60 seconds unless in Media mode
    if (state.desktopBridgeSuspended && !isMediaMode) {
      if (now - lastDesktopPollTime < 60000) {
        return Promise.resolve(desktopSnapshot);
      }
    }

    // Exponential back-off for failures
    let waitTime = DESKTOP_POLL_INTERVAL_MS;
    if (desktopPollFailureCount > 0) {
      waitTime = Math.min(30000, DESKTOP_POLL_INTERVAL_MS * Math.pow(1.5, Math.min(8, desktopPollFailureCount)));
    }

    // In Media mode, we poll at least every 10 seconds to detect the bridge coming online
    if (isMediaMode) waitTime = Math.min(10000, waitTime);

    if (now - lastDesktopPollTime < waitTime) {
      return Promise.resolve(desktopSnapshot);
    }

    lastDesktopPollTime = now;

    return readDesktopSnapshot()
      .then((snapshot) => {
        desktopSnapshot = snapshot;
        desktopPollFailureCount = 0;
        state.desktopBridgeSuspended = false;
        if (snapshot && snapshot.active && !snapshot.artworkUri) {
          hydrateDesktopSpotifyArtwork(snapshot, getControllablePlayerPost());
        }
        if (renderAfter) render();
        return desktopSnapshot;
      })
      .catch((error) => {
        desktopSnapshot = null;
        desktopPollFailureCount += 1;

        // Suspend frequent polling after 5 consecutive failures
        if (desktopPollFailureCount >= 5) {
          state.desktopBridgeSuspended = true;
        }

        if (desktopPollFailureCount % 10 === 1) {
           console.warn("[Hero] Desktop media bridge not detected. Ensure the companion app is running.");
        }

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
    const title = normalizeText(snapshot.title);
    const meta = normalizeText(snapshot.meta);
    if (!title) return null;

    const posts = typeof getAllPosts === "function" ? getAllPosts() : [];
    return posts.find((p) => {
      const pTitle = normalizeText(p.title);
      const pCreator = normalizeText(p.creator);
      if (pTitle === title && (pCreator === meta || !meta)) return true;
if (pTitle.length > 5 && (pTitle.includes(title) || title.includes(pTitle))) return true;
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
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
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
          }).catch(() => {});

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

    try { session.playbackState = playbackState; } catch {}

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

    // Prioritize the scroll-tracked active post if it's playable and visible
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
        if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
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

  function performDesktopAction(action, payload = {}) {
    if (!canUseDesktopBridge()) return Promise.resolve(false);
    
    // If the active snapshot came from Supabase, or we are on a remote origin without a local bridge endpoint yet,
    // use Supabase to sync the action.
    const isRemoteOrigin = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
    const isLocalEndpoint = desktopSnapshotEndpoint && desktopSnapshotEndpoint !== "supabase-sync" && !desktopSnapshotEndpoint.startsWith("/");

    if (desktopSnapshotEndpoint === "supabase-sync" || (isRemoteOrigin && !isLocalEndpoint && state.currentUser?.id)) {
      return performSupabaseDesktopAction(action, payload);
    }

    const actionEndpoint = getDesktopActionEndpoint();
    if (!actionEndpoint) return Promise.resolve(false);

    return window.fetch(actionEndpoint, withLocalNetworkFetchOptions(actionEndpoint, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action,
        appPackage: desktopSnapshot?.appPackage || "",
        ...payload
      }),
    }))
      .then((response) => response.ok ? response.json() : { ok: false })
      .then((payload) => {
        window.setTimeout(() => { refreshDesktopSnapshot(); }, 260);
        return Boolean(payload?.ok);
      })
      .catch(() => false);
  }

  async function performSupabaseDesktopAction(action, payload = {}) {
    if (!state.supabase || !state.currentUser?.id) return false;
    try {
      const { error } = await state.supabase.from("system_media_actions").insert({
        user_id: state.currentUser.id,
        action: action,
        app_package: desktopSnapshot?.appPackage || "",
        payload: payload
      });
      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Failed to send media action via Supabase:", error);
      return false;
    }
  }

  function getEffectiveHeroMode(controllablePost) {
    if (state.heroControlMode === "feed") return "app";
    if (state.heroControlMode === "media") {
      // If we have an active desktop snapshot, prioritize it
      if (desktopSnapshot?.active) return "desktop";
      // If we have an active native snapshot, prioritize it
      if (nativeSnapshot?.active) return "device";

      // Fallback preference
      if (canUseDesktopBridge() && desktopPollFailureCount < 5) return "desktop";
      return "device";
    }
    return shouldUseNativeMode(controllablePost) ? "device" : (shouldUseDesktopMode(controllablePost) ? "desktop" : "app");
  }

  function handlePlayPause(forcePlay) {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    if (mode === "app") {
      playHeroMedia();
      return;
    }

    const post = controllablePost;
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
      toggleLocalPlayback(true);
    }
    render();
  }

  function handlePrevious() {
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    if (mode === "app") {
      stepHeroPlayer(-1);
      return;
    }

    const post = controllablePost;
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
    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);

    if (mode === "app") {
      stepHeroPlayer(1);
      state.heroPlayerPlaybackState = "paused";
      render();
      return;
    }

    const post = controllablePost;
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
    if (mode === "app") {
      stepHeroPlayer(1);
    } else {
      stepMiniPlayer(1);
    }
    state.heroPlayerPlaybackState = "paused";
  }

  function handleVolumeInput(event) {
    const post = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(post);

    const rawValue = Number(event.target?.value);
    const volume = normalizePlayerVolume(rawValue / 100, state.playerVolume);

    state.playerVolume = volume;
    savePlayerVolume(state.playerVolume);

    if (mode === "desktop" && desktopSnapshot?.available) {
      performDesktopAction("set_volume", { volume: Math.round(volume * 100) });
    } else if (mode === "app") {
      applyPlayerVolumeToActiveElement();
      const fallbackMedia = getFallbackPageMediaElement();
      if (!(getActivePlayerMediaElement() instanceof HTMLMediaElement) && fallbackMedia instanceof HTMLMediaElement) {
        try { fallbackMedia.volume = state.playerVolume; } catch {}
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
    const canStep = playableCount > 1;
    const hasPost = Boolean(heroPost);

    elements.heroPlayerPrevButton.disabled = !canStep;
    elements.heroPlayerNextButton.disabled = !canStep;
    elements.heroPlayerPlayPauseButton.disabled = !hasPost;

    if (!hasNativeSnapshotBridge()) {
      nativeSnapshot = null;
      stopNativeSnapshotPolling();
    }
    if (!canUseDesktopBridge()) {
      desktopSnapshot = null;
      stopDesktopSnapshotPolling();
    }

    const controllablePost = getControllablePlayerPost();
    const mode = getEffectiveHeroMode(controllablePost);
    const post = mode === "app" ? getHeroPost() : controllablePost;
    const mediaElement = getActivePlayerMediaElement();
    const fallbackMedia = getFallbackPageMediaElement();
    const browserMetadata = getBrowserMediaMetadata();
    const playbackState = mode === "device"
      ? normalizePlaybackState(nativeSnapshot?.playbackState)
      : mode === "desktop"
        ? normalizePlaybackState(desktopSnapshot?.playbackState)
        : getLocalPlaybackState();
    const supportsPlayback = mode === "device"
      ? hasNativeActionBridge()
      : mode === "desktop"
        ? Boolean(desktopSnapshot?.available)
        : (playableCount > 0);
    const supportsVolume = (mode === "desktop" && desktopSnapshot?.available) || (mode === "app" && (
      mediaElement instanceof HTMLMediaElement
      || fallbackMedia instanceof HTMLMediaElement
      || post?.sourceKind === "youtube"
    ));
    const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
    const matchedPost = mode === "device" ? findMatchedPost(nativeSnapshot) : (mode === "desktop" ? findMatchedPost(desktopSnapshot) : null);
    const canBootstrapPlayback = !post
      && playableCount > 0
      && !(fallbackMedia instanceof HTMLMediaElement)
      && (
        mode === "app"
        || (mode === "desktop" && !desktopSnapshot?.active)
      );

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

    if (elements.heroModeFeed) elements.heroModeFeed.classList.toggle("is-active", state.heroControlMode === "feed");
    if (elements.heroModeMedia) elements.heroModeMedia.classList.toggle("is-active", state.heroControlMode === "media");

    elements.heroPlayerPlayPauseButton.textContent = playbackState === "playing" ? "Pause" : "Play";
    // We already set the disabled state at the top based on hasPost
    elements.heroPlayerPlayPauseButton.title = hasPost || canBootstrapPlayback
      ? ""
      : "No controllable playback session found.";

    elements.heroPlayerVolumeSlider.disabled = !supportsVolume;
    elements.heroPlayerVolumeSlider.value = `${volumePercent}`;
    elements.heroPlayerVolumeValue.textContent = supportsVolume ? `${volumePercent}%` : "--";

    const isHeroActive = state.heroPlayerPostId === post?.id && !!state.heroPlayerElement;
    if (!isHeroActive) {
      renderHeroStagePreview(Object.assign({}, options, {
        stage: elements.heroPlayerStage,
        mode,
        post,
        fallbackMedia,
        nativeSnapshot,
        desktopSnapshot,
        matchedPost,
        active: false // Force preview card for standby posts
      }));
    }
    syncMediaSession({
      title: elements.heroPlayerTitle.textContent,
      artist: elements.heroPlayerCaption.textContent,
      artwork: post ? resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource, getSpotifyPreviewImageUrl }) : (browserMetadata?.artwork || ""),
    });
    if (typeof renderMiniPlayer === "function") renderMiniPlayer();
  }

  function initialize() {
    attachEventListeners();
    initializeSdkHooks();
  }

  initialize();

  return {
    attachEventListeners,
    render,
    handlePlayPause,
    handleNext,
    handlePrevious,
    handleVolumeInput,
    openNowPlayingMediaApp: (packageName, uri) => {
      if (hasNativeActionBridge()) {
        try { getNativeBridge().openNowPlayingMediaApp(packageName, uri, true); return true; } catch { return false; }
      }
      if (canUseDesktopBridge()) {
        return performDesktopAction("open_uri", { uri });
      }
      return false;
    }
  };
}
