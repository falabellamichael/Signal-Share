import { createSupabaseClient, loadPostsFromSupabase, loadLikedPostsFromSupabase, publishPostToSupabase, compressImageFile, uploadFileToSupabase, uploadMessageAttachment, deleteHostedPost, normalizeSupabasePost, parseYouTubeUrl, openDatabase, loadPostsFromDatabase, savePostToDatabase, deletePostFromDatabase, setApiContext } from './api-v3.js';
import { createAppUi } from './app-v3-ui.js?v=1.2';
import {
  getMessageAttachmentKind, isPlayablePost, formatTimestamp, 
  formatFileSize, formatKind, formatProviderName,
  formatPostBadge, formatPostMeta,
  clampNumber, parseTags, getMediaKind, compareByNewest,
  getLatestPostedPostId
} from './shared-utils.js';

// Ban Helper Functions

const AI_COMPANION_ID = "ai-companion";
const AI_COMPANION_PROFILE = Object.freeze({
  id: AI_COMPANION_ID,
  email: "ai@signal.share",
  displayName: "AI Companion",
  isAi: true,
  createdAt: new Date("2026-05-01").toISOString()
});

/**
 * Reads a File as a data URL.
 * Kept local to avoid hard dependency on a specific shared-utils export set.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Check if current user is banned
 * @param {object} state - The application state
 * @returns {boolean} True if user is banned, false otherwise
 */
function isCurrentUserBanned(state) {
  try {
    return state.currentUserBanned || false;
  } catch (error) {
    console.error("Error in isCurrentUserBanned:", error);
    return false;
  }
}

/**
 * Check if a specific user is banned
 * @param {object} state - The application state
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user is banned, false otherwise
 */
function isUserBanned(state, userId) {
  try {
    if (!Array.isArray(state.bannedUserIds)) {
      return false;
    }
    return state.bannedUserIds.includes(userId);
  } catch (error) {
    console.error("Error in isUserBanned:", error);
    return false;
  }
}

/**
 * Check if messaging is enabled
 * @param {object} state - The application state
 * @returns {boolean} True if messaging is enabled, false otherwise
 */
function isMessagingEnabled(state) {
  return state.backendMode === "supabase" && Boolean(state.currentUser);
}

/**
 * Check if user can publish to live feed
 * @param {object} state - The application state
 * @returns {boolean} True if user can publish, false otherwise
 */
function canPublishToLiveFeed(state) {
  return Boolean(state.currentUser) && !isCurrentUserBanned(state);
}

/**
 * Check if user is blocked
 * @param {object} state - The application state
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user is blocked, false otherwise
 */
function isUserBlocked(state, userId) {
  return Array.isArray(state.blockedUserIds) && state.blockedUserIds.includes(userId);
}

/**
 * Check if user can access admin ban panel
 * @param {object} state - The application state
 * @returns {boolean} True if user has admin privileges
 */
function canAccessAdminBanPanel(state) {
  return Boolean(state.currentUser) && isCurrentUserAdmin();
}

const DEMO_POSTS = [
  {
    id: "demo-studio-light",
    creator: "Mara Vale",
    title: "Studio Light Test",
    caption:
      "Blocking color and reflection before the final portrait session. Clean gradients always read better on skin.",
    tags: ["portrait", "lighting", "studio"],
    createdAt: "2026-04-16T14:22:00.000Z",
    mediaKind: "image",
    src: createDemoGraphic({
      title: "Studio Light Test",
      subtitle: "portrait study",
      palette: ["#f4a261", "#ee6c4d", "#13212b"],
    }),
    likes: 18,
    isLocal: false,
  },
  {
    id: "demo-quiet-launch",
    creator: "Ivo Chen",
    title: "Quiet Launch Poster",
    caption:
      "Campaign art with a softer edge. Testing a calmer type treatment against high-contrast shapes.",
    tags: ["poster", "graphics", "minimal"],
    createdAt: "2026-04-15T09:45:00.000Z",
    mediaKind: "image",
    src: createDemoGraphic({
      title: "Quiet Launch Poster",
      subtitle: "campaign series 01",
      palette: ["#2a9d8f", "#264653", "#e9c46a"],
    }),
    likes: 12,
    isLocal: false,
  },
  {
    id: "demo-morning-glitch",
    creator: "Zora Moss",
    title: "Morning Glitch",
    caption:
      "A quick video study of analog artifacts captured from a failed tape transfer. The sync issues became the best part.",
    tags: ["video", "analog", "experimental"],
    createdAt: "2026-04-14T07:12:00.000Z",
    mediaKind: "video",
    src: "https://vjs.zencdn.net/v/oceans.mp4",
    likes: 31,
    isLocal: false,
  },
  {
    id: "demo-beat-drift",
    creator: "Kael Thorne",
    title: "Beat Drift (Rough Mix)",
    caption:
      "Late night session track. Focusing on the low-end swing and some subtle fm synthesis textures.",
    tags: ["audio", "beats", "lo-fi"],
    createdAt: "2026-04-13T23:55:00.000Z",
    mediaKind: "audio",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    likes: 24,
    isLocal: false,
  },
  {
    id: "demo-urban-echo",
    creator: "Leo Banks",
    title: "Urban Echoes",
    caption: "Street photography series capturing the blue hour in the city. High contrast, sharp edges, long shadows.",
    tags: ["street", "bluehour", "city"],
    createdAt: "2026-04-12T18:30:00.000Z",
    mediaKind: "image",
    src: createDemoGraphic({
      title: "Urban Echoes",
      subtitle: "street series 04",
      palette: ["#1d3557", "#457b9d", "#a8dadc"],
    }),
    likes: 45,
    isLocal: false,
  }
];

const DB_NAME = "signal-share-db";
const DB_VERSION = 1;
const STORE_NAME = "posts";

const MAX_IMAGE_FILE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_FILE_SIZE = 15 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MESSAGE_NOTIFICATION_TITLE = "Signal Share";
const FEED_POSTS_PER_PAGE = 12;

const POST_MODERATION_ERROR = "Content blocked. Please revise your text to meet community standards.";

const LIKED_POSTS_KEY = "signal-share-liked";
const POST_LIKES_TABLE = "post_likes";
const SAVED_POSTS_KEY = "signal-share-saved";
const CREATOR_NAME_KEY = "signal-share-creator-name";
const PLAYER_POSITION_KEY = "signal-share-player-pos";
const PLAYER_VOLUME_KEY = "signal-share-player-vol";
const USER_PREFERENCES_KEY = "signal-share-prefs";

const CURRENT_TERMS_VERSION = "2026-05-07";
const CURRENT_PRIVACY_VERSION = "2026-05-07";

const EXTERNAL_PROVIDERS = Object.freeze(["youtube", "spotify"]);
const DEFAULT_PLAYER_VOLUME = 0.8;
const DEFAULT_AUTH_REDIRECT_URL = "https://falabellamichael.github.io/Signal-Share/";

const DEFAULT_BLOCKED_TERMS = Object.freeze([
  "scam", "spam", "fraud", "phish", "buy cheap", "guaranteed win",
  "cryptocurrency", "nft whitelist", "airdrop", "ponzi"
]);

const DEFAULT_SITE_SETTINGS = Object.freeze({
  shellWidth: 1200,
  sectionGap: 24,
  surfaceRadius: 32,
  mediaFit: "cover"
});

const DEFAULT_USER_PREFERENCES = Object.freeze({
  theme: "sunset",
  density: "airy",
  motion: "full",
  statusBarStrip: true,
  notificationHideSender: false,
  notificationHideBody: false,
  showEmail: false
});

const THEME_OPTIONS = Object.freeze([
  { value: "sunset", label: "Sunset", description: "Warm default" },
  { value: "midnight", label: "Midnight", description: "Dark mode" },
  { value: "gallery", label: "Gallery", description: "Neutral light" },
  { value: "aurora", label: "Aurora", description: "Cool studio" },
  { value: "contrast", label: "High Contrast", description: "Blackout with sharp signal colors" },
  { value: "ember", label: "Ember Red", description: "Deep red companion glow" },
]);

const THEME_VALUES = new Set(THEME_OPTIONS.map((option) => option.value));

function getAppConfig() {
  const config = window.SIGNAL_SHARE_CONFIG ?? {};
  return {
    supabaseUrl: config.supabaseUrl?.trim() ?? "",
    supabaseAnonKey: config.supabaseAnonKey?.trim() ?? "",
    authRedirectUrl: config.authRedirectUrl?.trim() ?? "",
    postsTable: config.postsTable?.trim() || "posts",
    storageBucket: config.storageBucket?.trim() || "media",
    webPushPublicKey: config.webPushPublicKey?.trim() ?? "",
    notificationFunctionName: config.notificationFunctionName?.trim() || "send-message-notification",
    spotifyPreviewFunctionName: config.spotifyPreviewFunctionName?.trim() || "spotify-preview-metadata",
    adminEmails: Array.isArray(config.adminEmails) ? config.adminEmails.map((e) => normalizeEmailForMatch(e)).filter(Boolean) : [],
  };
}

const APP_CONFIG = getAppConfig();

let messageChimeAudioContext = null;
let serviceWorkerRegistrationPromise = null;
let nativePushListenersAttached = false;
let nativePushToken = "";
let pushRegistrationSyncPromise = null;
let pendingNotificationThreadId = "";
let messengerLifecycleListenersAttached = false;
let messengerCatchUpPromise = null;
let lastMessengerCatchUpAt = 0;
let nativeBackHandlerAttached = false;
let permissionBootstrapBound = false;
let localNetworkPermissionProbePromise = null;
const externalPreviewCache = new Map();
function getLocalNetworkPermissionProbeUrls() {
  if (!shouldAttemptBridgeRequests()) return [];
  const urls = [
    "http://localhost:3000/api/llm/chat",
    "http://127.0.0.1:3000/api/llm/chat",
  ];
  const isSecureHostedPage = window.location.protocol === "https:";
  if (!isSecureHostedPage || isNativeCapacitorApp()) {
    urls.push("http://10.0.2.2:3000/api/llm/chat");
  }
  return urls;
}

// Ensure state is shared across multiple instances of app.js (e.g. if loaded with/without query strings)
const globalStateKey = "__SIGNAL_SHARE_STATE__";
if (!window[globalStateKey]) {
  window[globalStateKey] = {
    db: null,
    supabase: null,
    backendMode: "local",
    backendError: "",
    currentUser: null,
    authRestoring: false,
    pendingActivationEmail: "",
    profileRecord: null,
    userPosts: [],
    availableProfiles: [],
    blockedUserIds: [],
    bannedUserIds: [],
    currentUserBanned: false,
    blockingAvailable: true,
    banningAvailable: true,
    peopleSearch: "",
    adminBanSearch: "",
    conversationSearch: "",
    directThreads: [],
    activeThreadId: null,
    activeMessages: [],
    activeProfileKey: "",
    threadsChannel: null,
    messagesChannel: null,
    likesChannel: null,
    messengerBusy: 0,
    messengerError: "",
    listenersAttached: false,
    lastMessageSubmitTime: 0,
    messengerOpen: false,
    messengerExpanded: false,
    mobileHeaderHidden: false,
    lastScrollY: 0,
    settingsPanelOpen: false,
    themePickerOpen: false,
    notificationsPanelOpen: false,
    settingsActivePage: "main",
    keyboardShortcutsPanelOpen: false,
    adminBanPanelOpen: false,
    adminBanBusy: false,
    adminBanFeedback: "",
    adminBanFeedbackIsError: false,
    pendingBlockUserId: "",
    pendingBanUserId: "",
    pendingDeleteThreadId: "",
    feedPage: 1,
    profileFeedPage: 1,
    messageAttachmentFile: null,
    messageAttachmentPreviewUrl: "",
    messageEmojiPickerOpen: false,
    lastIncomingMessageSoundAt: 0,
    filter: "all",
    sort: "newest",
    search: "",
    selectedFile: null,
    previewUrl: "",
    previewExternal: null,
    preferences: loadUserPreferences(),
    siteSettings: { ...DEFAULT_SITE_SETTINGS },
    likedPosts: [],
    savedPosts: loadSavedPosts(),
    playerPosition: loadPlayerPosition(),
    playerVolume: loadPlayerVolume(),
    playerDrag: null,
    generatedUrls: [],
    visiblePostIds: [],
    playerPostId: null,
    miniPlayerExpanded: false,
    activePlayerPostId: null,
    activePlayerElement: null,
    activePlayerUrl: "",
    heroPlayerPlaybackState: "none",
    miniPlayerPlaybackState: "none",
    viewerPostId: null,
    viewerAttachment: null,
    viewerZoom: 1.0,
    miniPlayerUrl: "",
    heroControlMode: "feed",
    desktopBridgeSuspended: false,
    viewerUrl: "",
    heroControlSource: "all",
    lastHeroControlSource: "youtube",
    returnFocusElement: null,
    profileReturnFocusElement: null,
    activeFeedPostId: null,
    heroPlayerPostId: null,
    heroPlayerElement: null,
  };
}
const state = window[globalStateKey];
window.state = state; // Also expose as window.state for backward compatibility and cross-module access

setApiContext({
  state,
  APP_CONFIG,
  POST_LIKES_TABLE,
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
});

registerSiteServiceWorker();

function canUseBrowserNotifications() {
  return "Notification" in window && window.isSecureContext;
}

function isNativeCapacitorApp() {
  if (!window.Capacitor) return false;
  if (typeof window.Capacitor.isNativePlatform === "function") return window.Capacitor.isNativePlatform();
  if (typeof window.Capacitor.getPlatform === "function") return window.Capacitor.getPlatform() !== "web";
  return false;
}

function parseBridgeBoolean(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

function isLoopbackSiteOrigin() {
  const protocol = `${window.location?.protocol || ""}`.toLowerCase();
  const host = `${window.location?.hostname || ""}`.trim().toLowerCase();
  if (protocol === "file:") return true;
  return !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

function isPrivateSiteOrigin() {
  const host = `${window.location?.hostname || ""}`.trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "[::1]") return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map((value) => Number.parseInt(value, 10));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return host.endsWith(".local");
}

function isBridgeFeatureEnabled() {
  const explicitFlag = parseBridgeBoolean(
    localStorage.getItem("ss_bridge_enabled")
    ?? localStorage.getItem("signal-share-bridge-enabled")
  );
  if (explicitFlag !== null) return explicitFlag;

  const customBridgeUrl = `${localStorage.getItem("signal-share-bridge-url") || ""}`.trim();
  if (customBridgeUrl) return true;

  const bridgeSecret = `${localStorage.getItem("ss_bridge_secret") || ""}`.trim()
    || `${localStorage.getItem("signal-share-bridge-secret") || ""}`.trim();
  if (bridgeSecret) return true;

  const configuredSystemEndpoint = typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT === "string"
    && window.SIGNAL_SHARE_SYSTEM_MEDIA_ENDPOINT.trim();
  const configuredSystemBaseUrl = typeof window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL === "string"
    && window.SIGNAL_SHARE_SYSTEM_MEDIA_BASE_URL.trim();
  if (configuredSystemEndpoint || configuredSystemBaseUrl) return true;

  return false;
}

function getBridgeSecretValue() {
  const primary = `${localStorage.getItem("ss_bridge_secret") || ""}`.trim();
  if (primary) return primary;
  return `${localStorage.getItem("signal-share-bridge-secret") || ""}`.trim();
}

function resolvePreferredBridgeModel() {
  const saved = `${localStorage.getItem("arcade-chat-model") || ""}`.trim();
  if (saved && saved.toLowerCase() !== "auto") return saved;

  const modelSelect = document.getElementById("chat-model-select");
  if (!modelSelect) return "";

  const values = Array.from(modelSelect.options || [])
    .map((option) => `${option.value || ""}`.trim())
    .filter(Boolean);

  const lightweight = values.find((value) => {
    const normalized = value.toLowerCase();
    if (normalized === "auto" || normalized.includes("embedding")) return false;
    return normalized.includes("1.5b") || normalized.includes("e2b");
  });

  return lightweight || "";
}

function normalizeBridgeBaseUrl(value = "") {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol, window.location.href);
    const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    return normalized
      .replace(/\/api\/llm\/chat$/i, "")
      .replace(/\/api\/llm\/models$/i, "")
      .replace(/\/api\/system-media\/current$/i, "")
      .replace(/\/api\/system-media\/action$/i, "");
  } catch {
    return "";
  }
}

function shouldAttemptBridgeRequests() {
  if (isNativeCapacitorApp()) return isBridgeFeatureEnabled();
  if (isLoopbackSiteOrigin() || isPrivateSiteOrigin()) return true;
  return isBridgeFeatureEnabled();
}

function registerSiteServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext || isNativeCapacitorApp()) {
    return;
  }

  window.addEventListener("load", () => {
    serviceWorkerRegistrationPromise = navigator.serviceWorker
      .register("./service-worker.js")
      .catch((error) => {
        console.error("Service worker registration failed", error);
        return null;
      });
  });
}

function getCapacitorPlatform() {
  return window.Capacitor?.getPlatform?.() ?? "web";
}

function getNativePushNotificationsPlugin() {
  return window.Capacitor?.Plugins?.PushNotifications ?? null;
}

function getNativeAppPlugin() {
  return window.Capacitor?.Plugins?.App ?? null;
}

function supportsNativePushNotifications() {
  return isNativeCapacitorApp() && getCapacitorPlatform() === "android" && Boolean(getNativePushNotificationsPlugin());
}

function supportsWebPushNotifications() {
  return !isNativeCapacitorApp() && "PushManager" in window && window.isSecureContext && Boolean(APP_CONFIG.webPushPublicKey);
}

function trimNotificationText(value, maxLength = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function maybeRequestMessageNotificationPermission() {
  if (!canUseBrowserNotifications() || Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => { });
}

function shouldPromptForPushNotifications() {
  if (supportsNativePushNotifications()) return true;
  return canUseBrowserNotifications() && Notification.permission === "default";
}

function isLoopbackBridgeUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
  } catch (_error) {
    return false;
  }
}

function getBridgeTargetAddressSpace(url) {
  if (isLoopbackBridgeUrl(url)) return "loopback";
  try {
    const parsed = new URL(url, window.location.href);
    const host = `${parsed.hostname || ""}`.trim().toLowerCase();
    if (!host) return "";
    if (host.startsWith("10.") || host.startsWith("192.168.") || host === "10.0.2.2") return "private";
    const octets = host.split(".").map((value) => Number.parseInt(value, 10));
    if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return "private";
      if (octets[0] === 169 && octets[1] === 254) return "private";
    }
    if (host.endsWith(".local")) return "private";
  } catch (_error) {
    return "";
  }
  return "";
}

async function probeLocalNetworkPermission() {
  if (!window.isSecureContext) return false;
  if (localNetworkPermissionProbePromise) return localNetworkPermissionProbePromise;

  localNetworkPermissionProbePromise = (async () => {
    for (const url of getLocalNetworkPermissionProbeUrls()) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      const targetAddressSpace = getBridgeTargetAddressSpace(url);
      try {
        await fetch(url, {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
          ...(targetAddressSpace ? { targetAddressSpace } : {})
        });
        return true;
      } catch (_error) {
        // Ignore individual probe failures; we only need to trigger permission checks.
      } finally {
        clearTimeout(timeout);
      }
    }
    return false;
  })();

  try {
    return await localNetworkPermissionProbePromise;
  } finally {
    localNetworkPermissionProbePromise = null;
  }
}

function requestSiteAndAppPermissions({ fromUserGesture = false } = {}) {
  if (state.currentUser && isMessagingEnabled(state)) {
    void safelyEnsurePushNotificationRegistration({ prompt: fromUserGesture || shouldPromptForPushNotifications() });
  } else if (fromUserGesture && canUseBrowserNotifications() && Notification.permission === "default") {
    void Notification.requestPermission().catch(() => { });
  }

  if (shouldAttemptBridgeRequests()) {
    void probeLocalNetworkPermission().catch(() => { });
  }
}

function bindPermissionBootstrapHandlers() {
  if (permissionBootstrapBound) return;
  permissionBootstrapBound = true;

  const promptFromGesture = () => requestSiteAndAppPermissions({ fromUserGesture: true });
  window.addEventListener("pointerdown", promptFromGesture, { passive: true, once: true });
  window.addEventListener("keydown", promptFromGesture, { once: true });
}

function base64UrlToUint8Array(value) {
  const normalized = `${value}`.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const encoded = normalized + padding;
  const decoded = atob(encoded);
  const buffer = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    buffer[index] = decoded.charCodeAt(index);
  }
  return buffer;
}

async function openMessengerThreadFromNotification(threadId = "") {
  openMessengerDock({ expanded: !isMobileMessengerViewport(), focusPrimaryControl: false });
  if (!threadId) return;
  if (!isMessagingEnabled(state)) {
    pendingNotificationThreadId = threadId;
    return;
  }
  if (!state.directThreads.some((thread) => thread.id === threadId)) {
    await refreshMessengerState({ preserveActiveThread: false });
  }
  if (state.directThreads.some((thread) => thread.id === threadId)) {
    pendingNotificationThreadId = "";
    await openExistingThread(threadId);
  }
}

async function flushPendingNotificationThread() {
  if (!pendingNotificationThreadId || !isMessagingEnabled(state)) return;
  const threadId = pendingNotificationThreadId;
  pendingNotificationThreadId = "";
  await openMessengerThreadFromNotification(threadId);
}

async function handleIncomingAppUrl(urlString = "") {
  if (!urlString) return;
  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch (_error) {
    return;
  }
  const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
  const accessToken = hashParams.get("access_token") || parsedUrl.searchParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") || parsedUrl.searchParams.get("refresh_token");
  const authError = hashParams.get("error_description") || parsedUrl.searchParams.get("error_description");
  if (authError) {
    showAuthFeedback(decodeURIComponent(authError), true);
    return;
  }
  if (state.supabase && accessToken && refreshToken) {
    const { error } = await state.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.error("Auth session could not be restored from incoming app URL", error);
      showAuthFeedback(error.message || "Verification link could not be completed in the app.", true);
      return;
    }
    state.pendingActivationEmail = "";
    render();
    return;
  }
  if (parsedUrl.protocol === "signalshare:" && parsedUrl.host === "messages") {
    const threadId = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    await openMessengerThreadFromNotification(threadId);
    return;
  }
  if (parsedUrl.protocol === "signalshare:" && parsedUrl.host === "feed") {
    openFeedFromAppUrl({ creator: parsedUrl.searchParams.get("creator") || "" });
    return;
  }
  const hash = parsedUrl.hash.replace(/^#/, "");
  if (hash === "feed") {
    openFeedFromAppUrl();
    return;
  }
  if (hash === "messages") {
    await openMessengerThreadFromNotification("");
    return;
  }
  if (hash.startsWith("messages/")) {
    const threadId = decodeURIComponent(hash.slice("messages/".length));
    await openMessengerThreadFromNotification(threadId);
  }
}

function openFeedFromAppUrl(options = {}) {
  const { creator = "" } = options;
  closeMessageEmojiPicker({ restoreFocus: false });
  if (state.messengerOpen) closeMessengerDock({ restoreFocus: false });
  if (state.settingsPanelOpen) closeSettingsPanel({ restoreFocus: false });
  if (state.notificationsPanelOpen) closeNotificationsPanel({ restoreFocus: false });
  if (state.keyboardShortcutsPanelOpen) closeKeyboardShortcutsPanel({ restoreFocus: false });
  if (state.activeProfileKey) closeProfile({ restoreFocus: false });
  if (state.viewerPostId || state.viewerAttachment) closeViewer({ restoreFocus: false });
  if (window.location.hash !== "#feed") history.replaceState(null, "", "#feed");
  setMobileHeaderHidden(false);
  requestAnimationFrame(() => {
    elements.feedGrid?.closest("#feed")?.scrollIntoView({ block: "start", behavior: "auto" });
    if (creator) {
      const profileKey = getProfileKeyForCreator(creator);
      if (profileKey) openProfileByKey(profileKey, null);
    }
  });
}

function handleServiceWorkerMessage(event) {
  const message = event.data;
  if (!message || message.type !== "open-messenger") return;
  void openMessengerThreadFromNotification(message.threadId);
}

function getMessageNotificationFunctionName() {
  return APP_CONFIG.notificationFunctionName || "send-message-notification";
}

function getSpotifyPreviewFunctionName() {
  return APP_CONFIG.spotifyPreviewFunctionName || "spotify-preview-metadata";
}

async function triggerMessageNotificationDispatch(messageId) {
  if (!state.supabase || state.backendMode !== "supabase" || !state.currentUser || !messageId) return null;
  try {
    const { data, error } = await state.supabase.functions.invoke(getMessageNotificationFunctionName(), {
      body: { messageId },
    });
    if (error) throw error;
    return data ?? null;
  } catch (error) {
    console.error("Message notification dispatch failed", error);
    return { error: error instanceof Error ? error.message : "Message notification dispatch failed.", sent: 0 };
  }
}

async function registerWebPushSubscription(subscription) {
  if (!state.supabase || !state.currentUser || !subscription) return;
  const serializedKeys = subscription.toJSON().keys ?? {};
  const { error } = await state.supabase.rpc("register_push_subscription", {
    subscription_platform: "web",
    subscription_endpoint: subscription.endpoint,
    subscription_p256dh: serializedKeys.p256dh ?? null,
    subscription_auth: serializedKeys.auth ?? null,
    subscription_device_token: null,
    subscription_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

async function unregisterWebPushSubscription() {
  if (!state.supabase || !state.currentUser || !supportsWebPushNotifications()) return;
  const registration = await getSiteServiceWorkerRegistration();
  const subscription = await registration?.pushManager?.getSubscription?.();
  if (!subscription) return;
  const { error } = await state.supabase.rpc("unregister_push_subscription", {
    subscription_platform: "web",
    subscription_endpoint: subscription.endpoint,
    subscription_device_token: null,
  });
  if (error) throw error;
}

async function ensureWebPushNotificationRegistration({ prompt = false } = {}) {
  if (!state.supabase || !state.currentUser || !supportsWebPushNotifications()) return;
  let permission = Notification.permission;
  if (permission === "default" && prompt) permission = await Notification.requestPermission().catch(() => "default");
  if (permission !== "granted") return;
  const registration = await getSiteServiceWorkerRegistration();
  if (!registration?.pushManager) return;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(APP_CONFIG.webPushPublicKey),
    });
  }
  await registerWebPushSubscription(subscription);
}

async function registerNativePushToken(token) {
  if (!state.supabase || !state.currentUser || !token) return;
  const { error } = await state.supabase.rpc("register_push_subscription", {
    subscription_platform: "android",
    subscription_endpoint: null,
    subscription_p256dh: null,
    subscription_auth: null,
    subscription_device_token: token,
    subscription_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

async function unregisterNativePushToken() {
  if (!state.supabase || !state.currentUser || !nativePushToken) return;
  const { error } = await state.supabase.rpc("unregister_push_subscription", {
    subscription_platform: "android",
    subscription_endpoint: null,
    subscription_device_token: nativePushToken,
  });
  if (error) throw error;
}

async function initializeNativePushNotifications() {
  const push = getNativePushNotificationsPlugin();
  if (!supportsNativePushNotifications() || !push || nativePushListenersAttached) return;
  try {
    await push.createChannel?.({ id: "messages_alerts", name: "Messages", description: "Direct Messenger notifications", importance: 5, visibility: 1, sound: "default" });
  } catch (_error) { }
  try {
    await push.addListener("registration", (token) => {
      nativePushToken = token.value ?? "";
      if (nativePushToken && state.currentUser) {
        void registerNativePushToken(nativePushToken).catch((error) => console.error("Native push token could not be saved", error));
      }
    });
    await push.addListener("registrationError", (error) => console.error("Native push registration failed", error));
    await push.addListener("pushNotificationReceived", (notification) => {
      // If app is already active/focused, MessengerRealtime should handle the notification banner and chime.
      // We skip processing here to avoid double-processing and double-sound while app is open.
      if (document.visibilityState === "visible") return;

      if (notification?.data?.type === "direct-message") {
        const messageId = String(notification?.data?.messageId ?? "").trim();
        
        // De-duplicate: If we already saw this message (e.g. via Realtime), skip.
        if (messageId && window.notifications && window.notifications.hasSeenId(messageId)) return;

        if (window.notifications && typeof window.notifications.add === "function") {
          const threadId = notification?.data?.threadId ?? "";
          const title = trimNotificationText(notification?.title || notification?.data?.title || "New message", 80) || "New message";
          const body = trimNotificationText(notification?.body || notification?.data?.body || "New direct message", 160) || "New direct message";
          
          const didAdd = window.notifications.add({
            id: messageId || `native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            type: "info",
            title,
            message: body,
            threadId,
            data: { type: "message", threadId },
            silent: true,
          });

          // Only play sound and refresh if this is actually a new message to us.
          if (didAdd) {
            playIncomingMessageSound();
            if (isMessagingEnabled(state)) void refreshMessengerState({ preserveActiveThread: true });
          }
        }
      }
    });
    await push.addListener("pushNotificationActionPerformed", (action) => {
      const threadId = action.notification?.data?.threadId ?? "";
      void openMessengerThreadFromNotification(threadId);
    });
  } catch (error) {
    nativePushListenersAttached = false;
    throw error;
  }
  nativePushListenersAttached = true;
  try {
    const permission = await push.checkPermissions();
    if (permission.receive === "granted") await push.register();
  } catch (_error) { }
}

async function safelyInitializeNativePushNotifications() {
  try { await initializeNativePushNotifications(); } catch (error) { console.error("Native push listeners could not be initialized", error); }
}

async function catchUpMessengerState({ force = false } = {}) {
  if (!isMessagingEnabled(state)) return;
  if (messengerCatchUpPromise) { await messengerCatchUpPromise; return; }
  const now = Date.now();
  if (!force && now - lastMessengerCatchUpAt < 1500) return;
  lastMessengerCatchUpAt = now;
  messengerCatchUpPromise = (async () => {
    await refreshMessengerState({ preserveActiveThread: true, force: true });
    await flushPendingNotificationThread();
    if (window.notifications && state.supabase && state.currentUser?.id) {
      await window.notifications.syncWithSupabase(state.supabase, state.currentUser.id);
    }
  })();
  try { await messengerCatchUpPromise; } finally { messengerCatchUpPromise = null; }
}

async function initializeMessengerLifecycleSync() {
  if (messengerLifecycleListenersAttached) return;
  // Use global flag for these listeners as well
  if (!window.__SIGNAL_SHARE_GLOBAL_LISTENERS__) {
    window.__SIGNAL_SHARE_GLOBAL_LISTENERS__ = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void catchUpMessengerState();
    });
  }
  window.addEventListener("focus", () => void catchUpMessengerState());
  const app = getNativeAppPlugin();
  if (isNativeCapacitorApp() && app?.addListener) {
    try {
      await app.addListener("appStateChange", (stateChange) => { if (stateChange?.isActive) void catchUpMessengerState(); });
      await app.addListener("resume", () => void catchUpMessengerState());
      await app.addListener("appUrlOpen", (event) => { void handleIncomingAppUrl(event?.url ?? "").catch((error) => console.error("Incoming app URL could not be handled", error)); });
      if (typeof app.getLaunchUrl === "function") {
        const launchUrl = await app.getLaunchUrl();
        if (launchUrl?.url) await handleIncomingAppUrl(launchUrl.url);
      }
    } catch (error) { console.error("Native app lifecycle listeners could not be initialized", error); }
  }
  messengerLifecycleListenersAttached = true;
  // Periodic connectivity watchdog to rescue stale WebSockets on mobile
  setInterval(() => {
    if (state.messengerOpen && !state.messengerBusy) {
      void catchUpMessengerState();
    }
  }, 45000);
}

async function safelyInitializeMessengerLifecycleSync() {
  try { await initializeMessengerLifecycleSync(); } catch (error) { console.error("Messenger lifecycle sync could not be initialized", error); }
}

function handleAndroidBackNavigation() {
  if (state.messageEmojiPickerOpen) { closeMessageEmojiPicker({ restoreFocus: false }); return true; }
  if (state.activeProfileKey) { closeProfile({ restoreFocus: false }); return true; }
  if (state.viewerPostId || state.viewerAttachment) { closeViewer({ restoreFocus: false }); return true; }
  if (state.settingsPanelOpen) { closeSettingsPanel(); return true; }
  if (state.notificationsPanelOpen) { closeNotificationsPanel(); return true; }
  if (state.keyboardShortcutsPanelOpen) { closeKeyboardShortcutsPanel(); return true; }
  if (state.messengerOpen) { closeMessengerDock(); return true; }
  return false;
}

async function initializeNativeBackHandling() {
  const app = getNativeAppPlugin();
  if (!isNativeCapacitorApp() || getCapacitorPlatform() !== "android" || !app?.addListener || nativeBackHandlerAttached) return;
  await app.addListener("backButton", ({ canGoBack }) => {
    if (handleAndroidBackNavigation()) return;
    if (canGoBack && window.history.length > 1) { window.history.back(); return; }
    void app.exitApp?.();
  });
  nativeBackHandlerAttached = true;
}

async function safelyInitializeNativeBackHandling() {
  try { await initializeNativeBackHandling(); } catch (error) { console.error("Native back handling could not be initialized", error); }
}

async function safelyEnsurePushNotificationRegistration({ prompt = false } = {}) {
  try { await ensurePushNotificationRegistration({ prompt }); } catch (error) { console.error("Push notification registration failed", error); }
}

async function safelyUnlinkPushNotificationRegistration() {
  try { await unlinkPushNotificationRegistration(); } catch (error) { console.error("Push notification cleanup failed", error); }
}

function shouldPromptForPushNotificationsOnNativeApp() {
  return supportsNativePushNotifications();
}

async function ensureNativePushNotificationRegistration({ prompt = false } = {}) {
  const push = getNativePushNotificationsPlugin();
  if (!supportsNativePushNotifications() || !push) return;
  await initializeNativePushNotifications();
  let permission = await push.checkPermissions();
  if (permission.receive === "prompt" && prompt) permission = await push.requestPermissions();
  if (permission.receive !== "granted") return;
  await push.register();
  if (nativePushToken && state.currentUser) await registerNativePushToken(nativePushToken);
}

async function ensurePushNotificationRegistration({ prompt = false } = {}) {
  if (!state.currentUser || !isMessagingEnabled(state)) return;
  if (pushRegistrationSyncPromise) { await pushRegistrationSyncPromise; return; }
  pushRegistrationSyncPromise = (async () => {
    if (supportsNativePushNotifications()) { await ensureNativePushNotificationRegistration({ prompt }); return; }
    if (supportsWebPushNotifications()) { await ensureWebPushNotificationRegistration({ prompt }); return; }
    if (prompt) maybeRequestMessageNotificationPermission();
  })();
  try { await pushRegistrationSyncPromise; } finally { pushRegistrationSyncPromise = null; }
}

async function unlinkPushNotificationRegistration() {
  try {
    if (supportsNativePushNotifications()) { await unregisterNativePushToken(); return; }
    if (supportsWebPushNotifications()) await unregisterWebPushSubscription();
  } catch (error) { console.error("Push subscription cleanup failed", error); }
}

function formatBackendError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const parts = [];
    if (error.message) parts.push(error.message);
    if (error.details) parts.push(error.details);
    if (error.hint) parts.push(error.hint);
    if (error.code) parts.push(`Code: ${error.code}`);
    if (parts.length) return parts.join(" ");
  }
  return "Supabase setup failed during startup.";
}

function isBlockingBackendUnavailable(error) {
  const details = formatBackendError(error).toLowerCase();
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "42P01" || code === "42501" || details.includes("user_blocks") || details.includes("permission denied for table user_blocks") || details.includes("relation \"public.user_blocks\" does not exist") || details.includes("relation \"user_blocks\" does not exist");
}

function isBanningBackendUnavailable(error) {
  const details = formatBackendError(error).toLowerCase();
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "42P01" || code === "42501" || details.includes("user_bans") || details.includes("permission denied for table user_bans") || details.includes("relation \"public.user_bans\" does not exist") || details.includes("relation \"user_bans\" does not exist");
}

async function initialize() {
  // SCOPE PLATFORM FOR CSS
  try {
    const platform = getCapacitorPlatform();
    document.documentElement.classList.add(`platform-${platform}`);
    if (isNativeCapacitorApp()) {
      document.documentElement.classList.add('is-native');
    }
  } catch (error) {
    console.error("Platform class injection failed", error);
  }

  // DEBUG OVERLAY PERMANENTLY DISABLED
  window.updateDebugOverlay = (text) => { };

  applySiteSettings(state.siteSettings);
  applyUserPreferences(state.preferences);
  updateViewportMetrics();
  bindPermissionBootstrapHandlers();
  requestSiteAndAppPermissions({ fromUserGesture: false });

  if (isHostedPostingEnabled()) {
    try {
      state.supabase = createSupabaseClient();
      state.backendMode = "supabase";
      state.backendError = "";
      state.authRestoring = true;
      state.userPosts = await loadPostsFromSupabase();
      state.userPosts = healPosts(state.userPosts);
      try {
        state.siteSettings = await loadSiteSettingsFromSupabase();
        applySiteSettings(state.siteSettings);
      } catch (settingsError) { console.error("Site settings could not be loaded", settingsError); }
      const { data: { session } } = await state.supabase.auth.getSession();
      state.currentUser = session?.user ?? null;
      state.authRestoring = false;
      await refreshCurrentUserBanState();
      if (isMessagingEnabled(state)) {
        await refreshMessengerState();
        await flushPendingNotificationThread();
        if (window.notifications) {
          await window.notifications.syncWithSupabase(state.supabase, state.currentUser.id);
        }
      }
      bindAuthStateListener();
    } catch (error) {
      console.error("Supabase is unavailable", error);
      state.backendError = formatBackendError(error);
      showFeedback("Hosted posting setup failed. Falling back to local browser storage.", true);
      state.supabase = null;
      state.backendMode = "local";
    }
  }

  if (state.backendMode === "local") {
    try {
      state.db = await openDatabase();
      state.userPosts = await loadPostsFromDatabase();
      state.userPosts = healPosts(state.userPosts);
    } catch (error) {
      console.error("IndexedDB is unavailable", error);
      state.db = null;
      state.userPosts = [];
      showFeedback("Running in session mode. Uploads will disappear after refresh.", true);
    }
  }

  await refreshLikedPostsState();
  elements.viewer.removeAttribute("hidden");
  hydrateRememberedCreator();
  attachEventListeners();
  void safelyInitializeMessengerLifecycleSync();
  void safelyInitializeNativeBackHandling();
  void safelyInitializeNativePushNotifications();
  if (state.currentUser && isMessagingEnabled(state)) void safelyEnsurePushNotificationRegistration({ prompt: shouldPromptForPushNotifications() });
  state.lastScrollY = window.scrollY;
  syncMobileHeaderVisibility();
  updateActiveFilterChip();
  updateSourceHelp("none");
  render();
}


function bindAuthStateListener() {
  state.supabase.auth.onAuthStateChange((event, session) => void handleAuthStateChange(event, session));
}

async function handleAuthStateChange(event, session) {
  const previousUser = state.currentUser;
  state.currentUser = session?.user ?? null;
  state.authRestoring = false;
  if (!state.currentUser) {
    state.currentUserBanned = false;
    state.bannedUserIds = [];
    state.adminBanPanelOpen = false;
  } else {
    await refreshCurrentUserBanState();
  }
  if (event === "INITIAL_SESSION") {
    await refreshLikedPostsState();
    if (isMessagingEnabled(state)) {
      await refreshMessengerState({ preserveActiveThread: true });
      await flushPendingNotificationThread();
      if (window.notifications) await window.notifications.syncWithSupabase(state.supabase, state.currentUser.id);
    } else { clearMessengerState(); }
    render();
    return;
  }
  if (event === "SIGNED_IN") {
    state.pendingActivationEmail = "";
    showAuthFeedback("Signed in successfully.");
    if (window.notifications && state.currentUser) {
      void window.notifications.syncWithSupabase(state.supabase, state.currentUser.id);
    }
  }
  if (event === "SIGNED_OUT") { state.pendingActivationEmail = ""; if (previousUser) showAuthFeedback("Signed out."); }
  await refreshLikedPostsState();
  if (isMessagingEnabled(state)) {
    await refreshMessengerState({ preserveActiveThread: event !== "SIGNED_OUT" });
    await flushPendingNotificationThread();
    void safelyEnsurePushNotificationRegistration({ prompt: shouldPromptForPushNotifications() });
  } else { clearMessengerState(); }
  render();
}

async function handleSignInSubmit(event) {
  event.preventDefault();
  if (state.backendMode !== "supabase" || !state.supabase) { showAuthFeedback("Supabase is not configured for login in this build.", true); return; }
  const email = elements.authEmailInput.value.trim();
  const password = elements.authPasswordInput.value;
  if (!email || !password) { showAuthFeedback("Enter both email and password to sign in.", true); return; }
  const { error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) { showAuthFeedback(error.message, true); return; }
  state.pendingActivationEmail = "";
  showAuthFeedback("Signed in.");
}

async function handleSignUpClick() {
  if (state.backendMode !== "supabase" || !state.supabase) { showAuthFeedback("Supabase is not configured for account creation in this build.", true); return; }
  const displayName = elements.authDisplayNameInput.value.trim();
  const email = elements.authEmailInput.value.trim();
  const password = elements.authPasswordInput.value;
  const acceptedTerms = elements.authTermsCheckbox.checked;
  if (!displayName || !email || !password) { showAuthFeedback("Enter an account name, email, and password before creating an account.", true); return; }
  if (displayName.length < 2) { showAuthFeedback("Use an account name with at least 2 characters.", true); return; }
  if (password.length < 8) { showAuthFeedback("Use a password with at least 8 characters.", true); return; }
  if (!acceptedTerms) { showAuthFeedback("Accept the Terms and Privacy Policy before creating a new account.", true); return; }
  const acceptedAt = new Date().toISOString();
  const { data, error } = await state.supabase.auth.signUp({
    email, password, options: { emailRedirectTo: getAuthRedirectUrl(), data: { display_name: displayName, terms_version: CURRENT_TERMS_VERSION, terms_accepted_at: acceptedAt, privacy_version: CURRENT_PRIVACY_VERSION, privacy_accepted_at: acceptedAt } },
  });
  if (error) { showAuthFeedback(error.message, true); return; }
  state.pendingActivationEmail = data.user?.email ?? email;
  if (data.session?.user) state.currentUser = data.session.user;
  elements.authPasswordInput.value = "";
  elements.authTermsCheckbox.checked = false;
  showAuthFeedback(data.session ? "Account created and signed in." : `Account created. Check ${state.pendingActivationEmail} for the activation email.`);
  render();
}

async function handleSignOutClick() {
  if (!state.supabase) return;
  await safelyUnlinkPushNotificationRegistration();
  const { error } = await state.supabase.auth.signOut();
  if (error) { showAuthFeedback(error.message, true); return; }
  state.currentUser = null;
  state.currentUserBanned = false;
  state.bannedUserIds = [];
  state.adminBanPanelOpen = false;
  state.pendingActivationEmail = "";
  render();
}

async function handleResendActivationClick() {
  if (!state.supabase) return;
  const email = state.pendingActivationEmail || state.currentUser?.email || elements.authEmailInput.value.trim();
  if (!email) { showAuthFeedback("Enter the account email first so the activation email can be resent.", true); return; }
  const { error } = await state.supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: getAuthRedirectUrl() } });
  if (error) { showAuthFeedback(error.message, true); return; }
  state.pendingActivationEmail = email;
  showAuthFeedback(`Activation email resent to ${email}.`);
  render();
}

function handleSelectedFile(file) {
  if (!/^image\/|^video\/|^audio\//.test(file.type)) { clearSelectedMedia(); showFeedback("Only image, video, or audio uploads are supported.", true); return; }
  const mediaKind = getMediaKind(file.type);
  const sizeLimit = mediaKind === "image" ? MAX_IMAGE_FILE_SIZE : MAX_VIDEO_FILE_SIZE;
  if (file.size > sizeLimit) { clearSelectedMedia(); showFeedback(`Choose a ${mediaKind} smaller than ${mediaKind === "image" ? "50 MB" : "15 MB"}.`, true); return; }
  if (!canCurrentUserUploadMediaKind(mediaKind)) { clearSelectedMedia(); showFeedback(getRestrictedUploadMessage(mediaKind), true); return; }
  if (elements.externalUrlInput.value.trim()) { elements.externalUrlInput.value = ""; state.previewExternal = null; }
  state.selectedFile = file;
  updateSourceHelp("upload");
  showFeedback(`${file.name} is ready to publish.`);
  renderPreview(file);
}

function handleExternalUrlInput(event) {
  const rawUrl = event.target.value.trim();
  if (!rawUrl) { state.previewExternal = null; if (!state.selectedFile) { clearPreviewOnly(); updateSourceHelp("none"); } return; }
  const parsed = parseExternalMediaUrl(rawUrl);
  if (!parsed) { state.previewExternal = null; if (!state.selectedFile) clearPreviewOnly(); updateSourceHelp("invalid"); showFeedback("Only YouTube and Spotify links are supported for external media.", true); return; }
  clearSelectedMedia({ preserveFeedback: true });
  state.previewExternal = parsed;
  updateSourceHelp(parsed.provider);
  renderExternalPreview(parsed);
  showFeedback(`${formatProviderName(parsed.provider)} link is ready to publish.`);
}

async function handleFormSubmit(event) {
  event.preventDefault();
  if (state.backendMode === "supabase" && !canPublishToLiveFeed(state)) {
    const message = isCurrentUserBanned(state) ? "This account is banned from publishing to the live feed." : "Sign in with an activated account before publishing to the live feed.";
    showFeedback(message, true);
    showAuthFeedback(isCurrentUserBanned(state) ? "This account is banned from posting and Direct Messenger." : "Sign in first, then confirm your email if activation is required.", true);
    return;
  }
  const creator = state.backendMode === "supabase" && state.currentUser ? getDefaultProfileName() : elements.creatorInput.value.trim();
  const title = elements.titleInput.value.trim();
  const caption = elements.captionInput.value.trim();
  const tags = parseTags(elements.tagsInput.value);
  const parsedExternal = parseExternalMediaUrl(elements.externalUrlInput.value.trim());
  if (!creator || !title || !caption) { showFeedback("Creator, title, and caption are required.", true); return; }
  if (!state.selectedFile && !parsedExternal) { showFeedback("Add either an uploaded file or a YouTube / Spotify link.", true); return; }
  if (elements.externalUrlInput.value.trim() && !parsedExternal) { showFeedback("That external link is not a supported YouTube or Spotify URL.", true); return; }
  if (findBlockedPostTerm({ creator, title, caption, tags })) { showFeedback(POST_MODERATION_ERROR, true); return; }
  if (state.selectedFile) { const mediaKind = getMediaKind(state.selectedFile.type); if (!canCurrentUserUploadMediaKind(mediaKind)) { showFeedback(getRestrictedUploadMessage(mediaKind), true); return; } }
  const basePost = { id: `user-${crypto.randomUUID()}`, creator, title, caption, tags, likes: 0, createdAt: new Date().toISOString() };
  try {
    let post;
    if (parsedExternal) post = buildExternalPost(basePost, parsedExternal); else post = buildUploadPost(basePost, state.selectedFile);
    if (state.backendMode === "supabase") {
      const insertedPost = await publishPostToSupabase(post, (percentage) => {
        showFeedback(`Uploading: ${percentage}%...`);
      });
      state.userPosts = [insertedPost, ...state.userPosts];
    }
    else if (state.db) { await savePostToDatabase(post); state.userPosts = await loadPostsFromDatabase(); }
    else { state.userPosts = [post, ...state.userPosts]; }
    rememberCreator(basePost.creator);
    resetFeedPagination();
    render();
    resetComposer();
    showFeedback(state.backendMode === "supabase" ? "Post published to the live feed." : state.db ? "Post published to your local feed." : "Post published for this session. Refreshing the page will remove it.");
  } catch (error) {
    console.error("Failed to save post", error);
    if (isPostModerationError(error)) { showFeedback(POST_MODERATION_ERROR, true); return; }
    const details = formatBackendError(error);
    if (state.backendMode === "supabase" && details) { showFeedback(`The post could not be saved. ${details}`, true); return; }
    showFeedback("The post could not be saved. Try another file.", true);
  }
}

function clearMessengerState() {
  unsubscribeMessagingChannels();
  state.profileRecord = null; state.availableProfiles = []; state.blockedUserIds = []; state.bannedUserIds = []; state.blockingAvailable = true; state.banningAvailable = true; state.peopleSearch = ""; state.adminBanSearch = ""; state.conversationSearch = ""; state.directThreads = []; state.activeThreadId = null; state.activeMessages = []; state.pendingBlockUserId = ""; state.pendingBanUserId = ""; state.pendingDeleteThreadId = ""; state.adminBanPanelOpen = false; state.adminBanBusy = false; state.adminBanFeedback = ""; state.adminBanFeedbackIsError = false; state.messengerBusy = 0; state.messengerError = "";
  state.listenersAttached = false;
  state.lastMessageSubmitTime = 0;
  clearMessageAttachmentSelection({ preserveFeedback: true });
}

async function refreshAdminBanState() {
  if (!canAccessAdminBanPanel(state)) { renderAdminBanPanel(); return; }
  state.adminBanBusy = true; state.adminBanFeedback = ""; state.adminBanFeedbackIsError = false; renderAdminBanPanel();
  try {
    const [profilesResult, bansResult] = await Promise.allSettled([loadProfilesFromSupabase(), loadUserBansFromSupabase()]);
    if (profilesResult.status !== "fulfilled") throw profilesResult.reason;
    let bans = []; state.banningAvailable = true;
    if (bansResult.status === "fulfilled") bans = bansResult.value;
    else if (isBanningBackendUnavailable(bansResult.reason)) { state.banningAvailable = false; state.bannedUserIds = []; state.adminBanFeedback = "Run the latest Supabase schema to enable account bans."; state.adminBanFeedbackIsError = true; }
    else throw bansResult.reason;
    state.availableProfiles = profilesResult.value.filter((profile) => profile.id !== state.currentUser.id);
    if (state.banningAvailable) state.bannedUserIds = bans.map((ban) => ban.bannedId);
  } catch (error) { console.error("Admin ban state could not be loaded", error); state.adminBanFeedback = "Ban controls could not be loaded."; state.adminBanFeedbackIsError = true; }
  finally { state.adminBanBusy = false; renderAdminBanPanel(); }
}

async function toggleUserBan(profile) {
  if (!canAccessAdminBanPanel(state) || !profile?.id || !state.currentUser) { showAdminBanFeedback("Only live admin accounts can ban members.", true); return; }
  if (!state.banningAvailable) { showAdminBanFeedback("Run the latest Supabase schema to enable account bans.", true); return; }
  const displayName = resolveMemberDisplayName(profile); const banned = isUserBanned(state, profile.id);
  try {
    state.adminBanBusy = true; state.pendingBanUserId = ""; renderAdminBanPanel();
    if (banned) { const { error } = await state.supabase.from("user_bans").delete().eq("banned_id", profile.id); if (error) throw error; }
    else { const { error } = await state.supabase.from("user_bans").insert({ banned_id: profile.id, banned_by: state.currentUser.id }); if (error && error.code !== "23505") throw error; }
    const successMessage = `${displayName} is ${banned ? "unbanned" : "banned"}.`; await refreshAdminBanState(); state.adminBanFeedback = successMessage; state.adminBanFeedbackIsError = false; renderAdminBanPanel();
    if (isMessagingEnabled(state)) await refreshMessengerState({ preserveActiveThread: true });
  } catch (error) { console.error("User ban update failed", error); state.adminBanBusy = false; const details = formatBackendError(error); showAdminBanFeedback(details ? `That member could not be ${banned ? "unbanned" : "banned"}. ${details}` : `That member could not be ${banned ? "unbanned" : "banned"}.`, true); }
}

async function toggleProfileBlock(profile) {
  if (!isMessagingEnabled(state) || !profile?.id || !state.currentUser) { showMessengerFeedback("Sign in with an activated account before blocking members.", true); return; }
  if (!state.blockingAvailable) { showMessengerFeedback("Blocking needs the latest Supabase messenger schema.", true); return; }
  const displayName = resolveMemberDisplayName(profile); const blocked = isUserBlocked(state, profile.id);
  try {
    state.messengerBusy++; state.pendingBlockUserId = ""; state.pendingDeleteThreadId = ""; renderMessenger();
    if (blocked) { const { error } = await state.supabase.from("user_blocks").delete().eq("blocker_id", state.currentUser.id).eq("blocked_id", profile.id); if (error) throw error; }
    else { const { error } = await state.supabase.from("user_blocks").insert({ blocker_id: state.currentUser.id, blocked_id: profile.id }); if (error && error.code !== "23505") throw error; }
    await refreshMessengerState({ preserveActiveThread: true }); showMessengerFeedback(`${displayName} is ${blocked ? "unblocked" : "blocked"}.`);
  } catch (error) { console.error("Member block update failed", error); state.messengerBusy = Math.max(0, state.messengerBusy - 1); const details = formatBackendError(error); showMessengerFeedback(details ? `That member could not be ${blocked ? "unblocked" : "blocked"}. ${details}` : `That member could not be ${blocked ? "unblocked" : "blocked"}.`, true); renderMessenger(); }
}

function getDefaultProfileName() {
  const accountName = state.profileRecord?.displayName?.trim() || state.currentUser?.user_metadata?.display_name?.trim() || state.currentUser?.user_metadata?.full_name?.trim() || state.currentUser?.user_metadata?.name?.trim();
  if (accountName) return accountName.slice(0, 40);
  const remembered = localStorage.getItem(CREATOR_NAME_KEY)?.trim(); if (remembered) return remembered.slice(0, 40);
  const prettyName = formatDisplayNameFromEmail(state.currentUser?.email || "");
  return prettyName || "Member";
}

function formatDisplayNameFromEmail(email = "") { 
  const localPart = String(email ?? "").trim().split("@")[0] ?? ""; 
  const prettyName = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); 
  return prettyName ? prettyName.slice(0, 40) : ""; 
}

function resolveMemberDisplayName(profile, fallback = "Member") { 
  if (!profile || typeof profile !== "object") return fallback; 
  const displayName = String(profile.displayName ?? "").trim(); 
  if (displayName && !normalizeEmailForMatch(displayName).includes("@")) return displayName.slice(0, 40); 
  const prettyEmailName = formatDisplayNameFromEmail(profile.email); 
  return prettyEmailName || (displayName ? displayName.slice(0, 40) : fallback); 
}
function normalizeProfile(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    theme: typeof row.theme === "string" ? row.theme : "",
    density: typeof row.density === "string" ? row.density : "",
    motion: typeof row.motion === "string" ? row.motion : "",
    statusBarStrip: typeof row.status_bar_strip === "boolean" ? row.status_bar_strip : null,
    notificationHideSender: Boolean(row.notification_hide_sender),
    notificationHideBody: Boolean(row.notification_hide_body),
    showEmail: typeof row.show_email === "boolean" ? row.show_email : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function normalizeUserBlock(row) { return { blockerId: row.blocker_id, blockedId: row.blocked_id, createdAt: row.created_at }; }
function normalizeUserBan(row) { return { bannedId: row.banned_id, bannedBy: row.banned_by, reason: row.reason ?? "", createdAt: row.created_at }; }
function normalizeDirectThread(row) { return { id: row.id, userOneId: row.user_one_id, userTwoId: row.user_two_id, createdAt: row.created_at, updatedAt: row.updated_at }; }
function normalizeMessage(row) { return { id: row.id, threadId: row.thread_id, senderId: row.sender_id, body: row.body ?? "", attachmentUrl: row.attachment_url ?? "", attachmentFilePath: row.attachment_file_path ?? "", attachmentName: row.attachment_name ?? "", attachmentType: row.attachment_type ?? "", attachmentSize: Number(row.attachment_size ?? 0), attachmentKind: row.attachment_kind ?? "", createdAt: row.created_at }; }
function getThreadPartnerId(thread) { if (!thread || !state.currentUser) return ""; return thread.userOneId === state.currentUser.id ? thread.userTwoId : thread.userOneId; }
function getThreadPartnerProfile(thread) { 
  const partnerId = getThreadPartnerId(thread); 
  if (partnerId === AI_COMPANION_ID) return AI_COMPANION_PROFILE;
  return state.availableProfiles.find((profile) => profile.id === partnerId) ?? null; 
}
function normalizeMessengerListSearch(value) { return String(value ?? "").trim().toLowerCase(); }
function getFilteredPeopleProfiles() { 
  const query = state.peopleSearch; 
  let profiles = [AI_COMPANION_PROFILE, ...state.availableProfiles];
  if (!query) return profiles; 
  return profiles.filter((profile) => { 
    const haystack = [resolveMemberDisplayName(profile, ""), profile.displayName, profile.email, formatDisplayNameFromEmail(profile.email)].map((v) => String(v ?? "").toLowerCase()).join(" "); 
    return haystack.includes(query); 
  }); 
}
function getFilteredConversationThreads() { const query = state.conversationSearch; if (!query) return state.directThreads; return state.directThreads.filter((thread) => { const partner = getThreadPartnerProfile(thread); const haystack = [resolveMemberDisplayName(partner, ""), partner?.displayName, partner?.email, formatDisplayNameFromEmail(partner?.email)].map((v) => String(v ?? "").toLowerCase()).join(" "); return haystack.includes(query); }); }

function isThreadBlocked(thread) { if (!thread) return false; const partnerId = getThreadPartnerId(thread); return isUserBlocked(state, partnerId) || isUserBanned(state, partnerId); }
function getActiveThread() { return state.directThreads.find((thread) => thread.id === state.activeThreadId) ?? null; }
function sortThreads(threads) { return [...threads].sort((l, r) => new Date(r.updatedAt).getTime() - new Date(l.updatedAt).getTime()); }
function mergeThread(thread) { if (isThreadBlocked(thread)) return; const others = state.directThreads.filter((item) => item.id !== thread.id); state.directThreads = sortThreads([thread, ...others]); }
function mergeActiveMessage(message) { 
  if (message.threadId !== state.activeThreadId) return; 
  const existingIdx = state.activeMessages.findIndex((item) => item.id === message.id);
  if (existingIdx >= 0) {
    const existingMessage = state.activeMessages[existingIdx];
    if (
      isBlobUrl(existingMessage?.attachmentUrl) &&
      existingMessage.attachmentUrl !== message.attachmentUrl
    ) {
      revokeBlobUrl(existingMessage.attachmentUrl);
    }
    state.activeMessages[existingIdx] = { ...state.activeMessages[existingIdx], ...message };
  } else {
    state.activeMessages = [...state.activeMessages, message].sort((l, r) => new Date(l.createdAt).getTime() - new Date(r.createdAt).getTime()); 
  }
}
function canonicalizeThreadPair(l, r) { return [l, r].sort((a, b) => a.localeCompare(b)); }

async function syncCurrentProfileToSupabase(displayNameOverride = "") {
  const rawDisplayName = (displayNameOverride || state.profileRecord?.displayName || getDefaultProfileName()).trim().slice(0, 40);
  if (rawDisplayName.length < 2) throw new Error("Use a display name with at least 2 characters.");

  const payload = {
    id: state.currentUser.id,
    email: getCurrentUserEmail(),
    display_name: rawDisplayName
  };

  try {
    const fullPayload = {
      ...payload,
      theme: state.preferences.theme, density: state.preferences.density, motion: state.preferences.motion, status_bar_strip: state.preferences.statusBarStrip, notification_hide_sender: state.preferences.notificationHideSender,
      notification_hide_body: state.preferences.notificationHideBody, show_email: state.preferences.showEmail
    };
    const { data, error } = await state.supabase.from("profiles").upsert(fullPayload, { onConflict: "id" }).select().single();
    if (error) {
      if (error.message?.includes("column") || error.code === "PGRST204" || error.code === "42703") {
        console.warn("[Profiles] Privacy columns missing, falling back to basic sync");
        const { data: fallbackData, error: fallbackError } = await state.supabase.from("profiles").upsert(payload, { onConflict: "id" }).select().single();
        if (fallbackError) throw fallbackError;
        return finalizeProfileSync(fallbackData);
      }
      throw error;
    }
    return finalizeProfileSync(data);
  } catch (error) {
    throw error;
  }
}

function finalizeProfileSync(data) {
  const profile = normalizeProfile(data);
  state.profileRecord = profile;
  rememberCreator(profile.displayName);
  if (elements.creatorInput) elements.creatorInput.value = profile.displayName;
  return profile;
}

async function loadOwnProfileFromSupabase() { const { data, error } = await state.supabase.from("profiles").select("*").eq("id", state.currentUser.id).maybeSingle(); if (error) throw error; return data ? normalizeProfile(data) : null; }
async function loadProfilesFromSupabase() { const { data, error } = await state.supabase.from("profiles").select("*").order("display_name", { ascending: true }); if (error) throw error; return data.map(normalizeProfile); }
async function loadBlockedUsersFromSupabase() { const { data, error } = await state.supabase.from("user_blocks").select("*").eq("blocker_id", state.currentUser.id); if (error) throw error; return data.map(normalizeUserBlock); }
async function loadUserBansFromSupabase() { const { data, error } = await state.supabase.from("user_bans").select("*").order("created_at", { ascending: false }); if (error) throw error; return data.map(normalizeUserBan); }
async function loadCurrentUserBanFromSupabase() { if (!state.supabase || !state.currentUser) return null; const { data, error } = await state.supabase.from("user_bans").select("*").eq("banned_id", state.currentUser.id).maybeSingle(); if (error) throw error; return data ? normalizeUserBan(data) : null; }

async function refreshCurrentUserBanState() {
  state.currentUserBanned = false;
  if (!state.supabase || state.backendMode !== "supabase" || !state.currentUser) { hideOverlay(); return; }
  try {
    const profile = await loadOwnProfileFromSupabase();
    if (profile) {
      state.profileRecord = profile;
      updateUserPreferences({
        ...state.preferences,
        theme: profile.theme || state.preferences.theme,
        density: profile.density || state.preferences.density,
        motion: profile.motion || state.preferences.motion,
        statusBarStrip: typeof profile.statusBarStrip === "boolean" ? profile.statusBarStrip : state.preferences.statusBarStrip,
        notificationHideSender: profile.notificationHideSender,
        notificationHideBody: profile.notificationHideBody,
        showEmail: typeof profile.showEmail === "boolean" ? profile.showEmail : state.preferences.showEmail
      });
    }
    state.currentUserBanned = Boolean(await loadCurrentUserBanFromSupabase());
    if (state.currentUserBanned) { state.adminBanPanelOpen = false; state.messengerOpen = false; state.messengerExpanded = false; state.activeThreadId = null; state.activeMessages = []; showAuthFeedback("This account has been banned from posting and Direct Messenger.", true); showOverlay(); }
    else { hideOverlay(); }
  } catch (error) { if (isBanningBackendUnavailable(error)) { state.banningAvailable = false; console.warn("Account ban checks are unavailable on the current Supabase schema.", error); return; } throw error; }
}

async function loadDirectThreadsFromSupabase() { const userId = state.currentUser.id; const { data, error } = await state.supabase.from("direct_threads").select("*").or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).order("updated_at", { ascending: false }); if (error) throw error; return data.map(normalizeDirectThread); }
async function loadMessagesFromSupabase(threadId) { const { data, error } = await state.supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true }); if (error) throw error; return data.map(normalizeMessage); }
async function loadThreadAttachmentPaths(threadId) { const { data, error } = await state.supabase.from("messages").select("attachment_file_path").eq("thread_id", threadId).not("attachment_file_path", "is", null); if (error) throw error; return data.map((row) => row.attachment_file_path).filter((path) => typeof path === "string" && path.trim()); }

function getAiMessagesStorageKey() {
  if (!state.currentUser?.id) return "";
  return `ai-messages-${state.currentUser.id}`;
}

function sanitizeAiMessageForStorage(message) {
  if (!message || typeof message !== "object") return null;
  const next = { ...message };
  if (next.isThinking) return null;
  if (typeof next.attachmentUrl === "string" && /^blob:/i.test(next.attachmentUrl.trim())) {
    next.attachmentUrl = "";
  }
  if (next.attachmentUrl === null) next.attachmentUrl = "";
  if (!next.createdAt) next.createdAt = new Date().toISOString();
  return next;
}

function sanitizeAiMessagesForStorage(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(sanitizeAiMessageForStorage)
    .filter((entry) => entry && typeof entry === "object");
}

function isBlobUrl(value) {
  return typeof value === "string" && /^blob:/i.test(value.trim());
}

function revokeBlobUrl(value) {
  if (!isBlobUrl(value)) return;
  try {
    URL.revokeObjectURL(value);
  } catch (_error) { }
}

function loadAiMessagesLocally() {
  const storageKey = getAiMessagesStorageKey();
  if (!storageKey) return [];
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeAiMessagesForStorage(parsed);
    const normalizedRaw = JSON.stringify(sanitized);
    if (normalizedRaw !== raw) {
      localStorage.setItem(storageKey, normalizedRaw);
    }
    return sanitized;
  } catch (error) {
    console.warn("AI local message cache was invalid and has been reset.", error);
    localStorage.removeItem(storageKey);
    return [];
  }
}

async function refreshMessengerState(options = {}) {
  const { preserveActiveThread = true, force = false } = options;
  if (!isMessagingEnabled(state)) { clearMessengerState(); renderMessenger(); return; }
  state.messengerBusy++;
  try {
    let ownProfile = await loadOwnProfileFromSupabase(); if (!ownProfile) ownProfile = await syncCurrentProfileToSupabase(getDefaultProfileName());
    const allSettled = Promise.allSettled ? Promise.allSettled.bind(Promise) : function (promises) { return Promise.all(promises.map(p => p.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })))); };
    const [profilesResult, threadsResult, blocksResult, bansResult] = await allSettled([loadProfilesFromSupabase(), loadDirectThreadsFromSupabase(), loadBlockedUsersFromSupabase(), loadUserBansFromSupabase()]);
    if (profilesResult.status !== "fulfilled") throw profilesResult.reason; if (threadsResult.status !== "fulfilled") throw threadsResult.reason;
    let blocks = [], blockingAvailable = true; if (blocksResult.status === "fulfilled") blocks = blocksResult.value; else if (isBlockingBackendUnavailable(blocksResult.reason)) blockingAvailable = false; else throw blocksResult.reason;
    let bans = [], banningAvailable = true; if (bansResult.status === "fulfilled") bans = bansResult.value; else if (isBanningBackendUnavailable(bansResult.reason)) banningAvailable = false; else throw bansResult.reason;
    state.profileRecord = ownProfile; state.blockingAvailable = blockingAvailable; state.banningAvailable = banningAvailable; state.blockedUserIds = blocks.map((b) => b.blockedId); state.bannedUserIds = bans.map((b) => b.bannedId); state.availableProfiles = profilesResult.value.filter((p) => p.id !== state.currentUser.id); 
    
    // Inject AI thread if it has history
    const aiHistory = loadAiMessagesLocally();
    let threads = threadsResult.value.filter((t) => !isThreadBlocked(t));
    if (aiHistory.length > 0) {
      const lastMsg = aiHistory.slice(-1)[0];
      threads.push({
        id: "thread-ai-companion",
        userOneId: state.currentUser.id,
        userTwoId: AI_COMPANION_ID,
        createdAt: new Date("2026-05-01").toISOString(),
        updatedAt: lastMsg.createdAt || new Date().toISOString(),
        isAi: true,
        lastMessageBody: lastMsg.body
      });
    }
    state.directThreads = sortThreads(threads);
    
    if (!preserveActiveThread || !state.directThreads.some((t) => t.id === state.activeThreadId)) state.activeThreadId = state.directThreads[0]?.id ?? null;
    if (state.activeThreadId) {
      if (state.activeThreadId === "thread-ai-companion") {
        state.activeMessages = loadAiMessagesLocally();
      } else {
        state.activeMessages = await loadMessagesFromSupabase(state.activeThreadId);
      }
    } else {
      state.activeMessages = [];
    }
    subscribeMessagingChannels(); state.messengerError = "";
  } catch (error) { console.error("Messenger state could not be loaded", error); state.profileRecord = null; state.availableProfiles = []; state.blockedUserIds = []; state.bannedUserIds = []; state.blockingAvailable = true; state.banningAvailable = true; state.directThreads = []; state.activeThreadId = null; state.activeMessages = []; state.messengerError = formatBackendError(error) || "Messenger could not load for this account."; }
  finally { state.messengerBusy = Math.max(0, state.messengerBusy - 1); renderMessenger(); }
}

function unsubscribeMessagingChannels() {
  if (messengerRealtime) messengerRealtime.stop();
  if (state.threadsChannel) { state.threadsChannel.unsubscribe(); state.threadsChannel = null; }
  if (state.messagesChannel) { state.messagesChannel.unsubscribe(); state.messagesChannel = null; }
  if (state.likesChannel) { state.likesChannel.unsubscribe(); state.likesChannel = null; }
}

let isMessagingSubscribing = false;
let messengerRealtime = null;

async function subscribeMessagingChannels(options = {}) {
  const { force = false } = options;
  const realtimeReadyOrConnecting = Boolean(messengerRealtime && (messengerRealtime.isConnecting || messengerRealtime.channel));
  const hasLiveSubscriptions = Boolean(state.threadsChannel || state.likesChannel || state.messagesChannel || realtimeReadyOrConnecting);

  if (isMessagingSubscribing || (!force && hasLiveSubscriptions) || !isMessagingEnabled(state)) {
    if (!isMessagingEnabled(state)) unsubscribeMessagingChannels();
    return;
  }
  try {
    isMessagingSubscribing = true;
    if (force) unsubscribeMessagingChannels();

    if (!messengerRealtime && window.MessengerRealtime) {
      messengerRealtime = new window.MessengerRealtime(state);
    }
    
    if (messengerRealtime) {
      messengerRealtime.init();
      if (messengerRealtime.channel) state.messagesChannel = messengerRealtime.channel;
      
      console.log("[Messenger] Realtime system initialized.");
      const sessionHash = messengerRealtime.sessionHash;

      state.threadsChannel = state.supabase.channel(`direct-threads-${state.currentUser.id}-${sessionHash}`);
      state.threadsChannel.on("postgres_changes", { event: "*", schema: "public", table: "direct_threads" }, () => void refreshMessengerState({ preserveActiveThread: true }))
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void refreshMessengerState({ preserveActiveThread: true }));

      if (state.blockingAvailable) {
        state.threadsChannel.on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, () => void refreshMessengerState({ preserveActiveThread: true }));
      }

      if (state.banningAvailable) {
        state.threadsChannel.on("postgres_changes", { event: "*", schema: "public", table: "user_bans" }, () => void refreshCurrentUserBanState().then(() => {
          if (canAccessAdminBanPanel(state)) void refreshAdminBanState();
          if (isMessagingEnabled(state)) void refreshMessengerState({ preserveActiveThread: true });
          else { clearMessengerState(); render(); }
        }));
      }
      state.threadsChannel.subscribe();

      state.likesChannel = state.supabase.channel(`likes-${state.currentUser.id}-${sessionHash}`).on("postgres_changes", { event: "INSERT", schema: "public", table: POST_LIKES_TABLE }, (payload) => {
        const like = payload.new;
        if (like.user_id === state.currentUser.id) return;
        const likedPost = state.userPosts.find((p) => p.id === like.post_id);
        const isMobile = !!window.Capacitor && typeof window.Capacitor.getPlatform === "function" && window.Capacitor.getPlatform() !== "web";
        if (likedPost && likedPost.authorId === state.currentUser.id && window.notifications) {
          const notificationId = `like-${like.post_id}-${like.user_id}`;
          const message = `Someone liked your post: ${likedPost.title || "Untitled"}`;

          window.notifications.success(message, "New Like!", {
            id: notificationId,
            silent: isMobile
          });
        }
      }).subscribe();
    } else {
      console.warn("[Messenger] MessengerRealtime class not found. Realtime messaging will be unavailable.");
    }

  } catch (error) {
    console.error("[Messenger] Fatal Subscription Error:", error);
  } finally {
    isMessagingSubscribing = false;
  }
}

window.playIncomingMessageSound = playIncomingMessageSound;
window.mergeActiveMessage = mergeActiveMessage;
window.refreshMessengerState = refreshMessengerState;

function playIncomingMessageSound() {
  const now = Date.now(); if (now - state.lastIncomingMessageSoundAt < 700) return; state.lastIncomingMessageSoundAt = now;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext; if (!AudioContextCtor) return;
  try {
    if (!messageChimeAudioContext) messageChimeAudioContext = new AudioContextCtor();
    const ctx = messageChimeAudioContext; if (ctx.state === "suspended") void ctx.resume().catch(() => { });
    const startAt = ctx.currentTime + 0.01; const oscillator = ctx.createOscillator(); const gainNode = ctx.createGain();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(740, startAt); oscillator.frequency.exponentialRampToValueAtTime(980, startAt + 0.08);
    gainNode.gain.setValueAtTime(0.0001, startAt); gainNode.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02); gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
    oscillator.connect(gainNode); gainNode.connect(ctx.destination); oscillator.start(startAt); oscillator.stop(startAt + 0.2);
  } catch (_error) { }
}

async function handleProfileSave() {
  if (state.messengerBusy || !isMessagingEnabled(state)) {
    if (!state.messengerBusy) showProfileFeedback("Sign in with an activated account before editing your messaging profile.", true);
    return;
  }
  try {
    state.messengerBusy++;
    renderMessenger();
    const profile = await syncCurrentProfileToSupabase(elements.profileDisplayNameInput.value);
    state.profileRecord = profile;
    showProfileFeedback("Display name saved.");
    state.messengerError = "";
    void refreshMessengerState({ preserveActiveThread: true });
  } catch (error) {
    console.error("Profile save failed", error);
    showProfileFeedback(error instanceof Error ? error.message : "Profile could not be saved.", true);
  } finally {
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    renderMessenger();
  }
}

async function openExistingThread(threadId) {
  if (state.messengerBusy) return;
  state.pendingBlockUserId = "";
  state.pendingDeleteThreadId = "";
  state.activeThreadId = threadId;

  if (window.notifications && typeof window.notifications.markThreadAsRead === "function") {
    window.notifications.markThreadAsRead(threadId);
  }

  if (threadId === "thread-ai-companion") {
    state.activeMessages = loadAiMessagesLocally();
    clearMessageAttachmentSelection({ preserveFeedback: true });
    renderMessenger();
    return;
  }

  if (!isMessagingEnabled(state)) {
    renderMessenger();
    return;
  }
  try {
    state.messengerBusy++;
    renderMessenger();
    state.activeMessages = await loadMessagesFromSupabase(threadId);
    clearMessageAttachmentSelection({ preserveFeedback: true });
    showMessengerFeedback("");
  } catch (error) {
    console.error("Messages could not be loaded", error);
    showMessengerFeedback("This conversation could not be opened right now.", true);
  } finally {
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    renderMessenger();
  }
}

async function deleteConversation(threadId) {
  if (state.messengerBusy || !isMessagingEnabled(state) || !threadId || !state.currentUser) return;
  const deletedWasActive = threadId === state.activeThreadId;
  try {
    state.messengerBusy++;
    renderMessenger();

    if (threadId === "thread-ai-companion") {
      const storageKey = getAiMessagesStorageKey();
      if (storageKey) localStorage.removeItem(storageKey);
      state.pendingDeleteThreadId = "";
      if (deletedWasActive) {
        state.activeThreadId = null;
        state.activeMessages = [];
      }
      await refreshMessengerState({ preserveActiveThread: !deletedWasActive });
      return;
    }

    const attachmentPaths = await loadThreadAttachmentPaths(threadId);
    if (attachmentPaths.length > 0) {
      const { error: storageError } = await state.supabase.storage.from(APP_CONFIG.storageBucket).remove(attachmentPaths);
      if (storageError) console.warn("Conversation attachments could not be removed from storage", storageError);
    }
    const { data: deletedThread, error } = await state.supabase.from("direct_threads").delete().eq("id", threadId).select("id").maybeSingle();
    if (error) throw error;
    if (!deletedThread) throw new Error("Conversation delete is blocked by the current Supabase thread policy.");
    state.pendingDeleteThreadId = "";
    if (deletedWasActive) {
      state.activeThreadId = null;
      state.activeMessages = [];
    }
    await refreshMessengerState({ preserveActiveThread: !deletedWasActive });
  } catch (error) {
    console.error("Conversation delete failed", error);
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    const details = formatBackendError(error);
    showMessengerFeedback(details ? `The conversation could not be deleted. ${details}` : "The conversation could not be deleted.", true);
    renderMessenger();
  } finally {
    if (state.messengerBusy > 0) {
      state.messengerBusy = Math.max(0, state.messengerBusy - 1);
      renderMessenger();
    }
  }
}

async function openOrCreateThread(partnerId) {
  if (state.messengerBusy || !isMessagingEnabled(state)) {
    if (!state.messengerBusy) showMessengerFeedback("Sign in with an activated account before starting a conversation.", true);
    return;
  }

  // AI Companion Interception
  if (partnerId === AI_COMPANION_ID) {
    state.messengerBusy++;
    renderMessenger();
    try {
      const aiThread = {
        id: "thread-ai-companion",
        userOneId: state.currentUser.id,
        userTwoId: AI_COMPANION_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isAi: true
      };
      
      // Check if we already have it in state
      if (!state.directThreads.some(t => t.id === aiThread.id)) {
        state.directThreads = sortThreads([aiThread, ...state.directThreads]);
      }
      
      state.activeThreadId = aiThread.id;
      
      // Load from localStorage for persistence
      state.activeMessages = loadAiMessagesLocally();
      
      clearMessageAttachmentSelection({ preserveFeedback: true });
      showMessengerFeedback("");
    } finally {
      state.messengerBusy = Math.max(0, state.messengerBusy - 1);
      renderMessenger();
    }
    return;
  }

  if (isUserBlocked(state, partnerId)) { showMessengerFeedback("Unblock this member before starting a conversation.", true); return; }
  if (isUserBanned(state, partnerId)) { showMessengerFeedback("This member is banned from Direct Messenger.", true); return; }
  try {
    state.messengerBusy++;
    renderMessenger();
    const [userOneId, userTwoId] = canonicalizeThreadPair(state.currentUser.id, partnerId);
    const { data: existingThread, error: existingError } = await state.supabase.from("direct_threads").select("*").eq("user_one_id", userOneId).eq("user_two_id", userTwoId).maybeSingle();
    if (existingError) throw existingError;
    let thread = existingThread ? normalizeDirectThread(existingThread) : null;
    if (!thread) {
      const { data: insertedThread, error: insertError } = await state.supabase.from("direct_threads").insert({ user_one_id: userOneId, user_two_id: userTwoId }).select().single();
      if (insertError) {
        if (insertError.code === "23505") {
          const { data: duplicateThread, error: duplicateError } = await state.supabase.from("direct_threads").select("*").eq("user_one_id", userOneId).eq("user_two_id", userTwoId).single();
          if (duplicateError) throw duplicateError;
          thread = normalizeDirectThread(duplicateThread);
        } else throw insertError;
      } else thread = normalizeDirectThread(insertedThread);
    }
    mergeThread(thread);
    state.activeThreadId = thread.id;

    if (window.notifications && typeof window.notifications.markThreadAsRead === "function") {
      window.notifications.markThreadAsRead(thread.id);
    }

    state.activeMessages = await loadMessagesFromSupabase(thread.id);
    clearMessageAttachmentSelection({ preserveFeedback: true });
    showMessengerFeedback("");
  } catch (error) {
    console.error("Conversation could not be started", error);
    showMessengerFeedback("That conversation could not be opened right now.", true);
  } finally {
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    renderMessenger();
  }
}

async function handleMessageSubmit(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (state.messengerBusy || !isMessagingEnabled(state) || !state.activeThreadId) return;

  if (window.__SIGNAL_MESSENGER_SUBMITTING__) return;

  const now = Date.now();
  const body = elements.messageInput.value.trim();
  const attachmentFile = state.messageAttachmentFile;

  if (!attachmentFile && body && body === window.__SIGNAL_LAST_SUBMITTED_BODY__ && now - (window.__SIGNAL_LAST_SUBMITTED_AT__ || 0) < 3000) {
    console.warn("Duplicate message content detected within lockout window");
    return;
  }

  if (now - state.lastMessageSubmitTime < 1000) {
    return;
  }

  if (!body && !attachmentFile) {
    showMessengerFeedback("Write a message or attach a file before sending it.", true);
    return;
  }

  window.__SIGNAL_MESSENGER_SUBMITTING__ = true;
  window.__SIGNAL_LAST_SUBMITTED_BODY__ = body;
  window.__SIGNAL_LAST_SUBMITTED_AT__ = now;
  state.lastMessageSubmitTime = now;
  state.messengerBusy++;

  elements.messageInput.value = "";
  elements.messageInput.disabled = true;
  elements.sendMessageButton.disabled = true;
  renderMessenger();

  if (body.length > MAX_MESSAGE_LENGTH) {
    showMessengerFeedback(`Keep messages under ${MAX_MESSAGE_LENGTH} characters.`, true);
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    window.__SIGNAL_MESSENGER_SUBMITTING__ = false;
    elements.messageInput.value = body;
    elements.messageInput.disabled = false;
    elements.sendMessageButton.disabled = false;
    renderMessenger();
    return;
  }

  // AI Interception
  const activeThread = getActiveThread();
  if (activeThread?.isAi) {
    try {
      const userMessage = {
        id: crypto.randomUUID(),
        threadId: state.activeThreadId,
        senderId: state.currentUser.id,
        body,
        createdAt: new Date().toISOString(),
        attachmentUrl: null,
        attachmentKind: attachmentFile ? getMessageAttachmentKind(attachmentFile.type) : null,
        attachmentName: attachmentFile ? attachmentFile.name : null,
        attachmentType: attachmentFile ? attachmentFile.type : null,
        attachmentSize: attachmentFile ? attachmentFile.size : 0,
      };

      const directSteamTarget = window.SignalShareAiCore?.parseDirectSteamCommand?.(body) || "";
      const directDuckDuckGoQuery = window.SignalShareAiCore?.parseDuckDuckGoCommand?.(body) || "";

      if (directSteamTarget || directDuckDuckGoQuery) {
        mergeActiveMessage(userMessage);
        saveAiMessagesLocally();

        state.messageAttachmentFile = null;
        state.messageAttachmentPreviewUrl = "";
        renderMessenger();

        let aiReply = "";
        if (directSteamTarget) {
          const steamPlan = window.SignalShareAiCore?.buildSteamLaunchPlan?.(directSteamTarget) || null;
          if (steamPlan?.type === "run" && steamPlan.uri) {
            window.location.href = steamPlan.uri;
            aiReply = `🎮 [Steam Protocol]: Launching ${steamPlan.key.toUpperCase()} via Steam now.`;
          } else {
            const searchUrl = steamPlan?.searchUrl || `https://store.steampowered.com/search/?term=${encodeURIComponent(directSteamTarget)}`;
            window.open(searchUrl, "_blank", "noopener,noreferrer");
            aiReply = `🎮 [Steam Protocol]: I couldn't find a direct app ID for "${directSteamTarget}", so I opened Steam search.`;
          }
        } else {
          const query = directDuckDuckGoQuery.trim();
          if (query) {
            const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
            window.open(url, "_blank", "noopener,noreferrer");
            aiReply = `🔎 [Search Protocol]: Searching DuckDuckGo for "${query}".`;
          } else {
            aiReply = "🔎 [Search Protocol]: Tell me what you want to search on DuckDuckGo.";
          }
        }

        const directAiMessage = {
          id: crypto.randomUUID(),
          threadId: state.activeThreadId,
          senderId: AI_COMPANION_ID,
          body: aiReply,
          createdAt: new Date().toISOString()
        };
        mergeActiveMessage(directAiMessage);
        saveAiMessagesLocally();
        renderMessenger();
        playIncomingMessageSound();
        showMessengerFeedback("");
        return;
      }

      // Prepare attachment for LLM if present
      let aiAttachment = null;
      if (attachmentFile) {
        try {
          aiAttachment = {
            data: await readFileAsDataURL(attachmentFile),
            type: getMessageAttachmentKind(attachmentFile.type),
            name: attachmentFile.name
          };
          if (aiAttachment?.data) {
            userMessage.attachmentUrl = aiAttachment.data;
          }
        } catch (err) {
          console.error("Failed to read AI attachment", err);
        }
      }

      // Prepare history for LLM (excluding current message)
      const history = window.SignalShareAiCore
        ? window.SignalShareAiCore.normalizeHistory(state.activeMessages, {
            aiSenderId: AI_COMPANION_ID,
            currentMessageId: userMessage.id
          })
        : state.activeMessages
            .filter(m => !m.isThinking && m.id !== userMessage.id)
            .map(m => ({
              role: m.senderId === AI_COMPANION_ID ? "assistant" : "user",
              content: `${m.body || ""}`.trim().slice(0, 900)
            }))
            .filter((row) => row.content.length > 0)
            .slice(-18);

      mergeActiveMessage(userMessage);
      saveAiMessagesLocally();
      
      // Clear attachment state since it's now in the message
      state.messageAttachmentFile = null;
      state.messageAttachmentPreviewUrl = "";
      
      renderMessenger();

      // Add thinking indicator
      const thinkingId = `thinking-${crypto.randomUUID()}`;
      const thinkingMsg = {
        id: thinkingId,
        threadId: state.activeThreadId,
        senderId: AI_COMPANION_ID,
        body: "Thinking...",
        isThinking: true,
        createdAt: new Date().toISOString()
      };
      state.activeMessages.push(thinkingMsg);
      renderMessenger();
      
      // Refresh media state so AI has latest context from system bridges
      if (window.heroMediaPlayerController) {
        try {
          if (typeof window.heroMediaPlayerController.refreshDesktopSnapshot === 'function') {
             await window.heroMediaPlayerController.refreshDesktopSnapshot({ force: true, renderAfter: false });
          }
          if (typeof window.heroMediaPlayerController.refreshNativeSnapshot === 'function') {
             await window.heroMediaPlayerController.refreshNativeSnapshot({ renderAfter: false });
          }
        } catch (e) { console.warn("Failed to refresh media context for AI", e); }
      }

      // Call LLM
      const pageContext = document.title || 'Signal Share';
      const pageText = document.body.innerText.substring(0, 600);
      const sharedAiContext = window.SignalShareAiCore
        ? window.SignalShareAiCore.buildCompanionContext({
            surface: "main",
            pageTitle: document.title || "",
            pageUrl: window.location.href,
            currentCategory: state.messengerOpen ? "messenger" : "feed",
            visibleText: pageText,
            attachment: aiAttachment
          })
        : "";
      const fullContext = `${pageContext} (Visible text: ${pageText})${sharedAiContext ? `\n\n${sharedAiContext}` : ""}`;
      if (!shouldAttemptBridgeRequests()) {
        // User explicitly requested an AI response. Enable bridge attempts for this browser profile.
        localStorage.setItem("ss_bridge_enabled", "1");
      }

      let aiResponse;
      try {
        aiResponse = await callLocalAI(body, history, fullContext, aiAttachment);
      } finally {
        // ALWAYS remove thinking indicator before rendering the response or error
        state.activeMessages = state.activeMessages.filter(m => m.id !== thinkingId);
      }
      
      const aiMessage = {
        id: crypto.randomUUID(),
        threadId: state.activeThreadId,
        senderId: AI_COMPANION_ID,
        body: aiResponse,
        createdAt: new Date().toISOString()
      };
      mergeActiveMessage(aiMessage);
      saveAiMessagesLocally();

      // Process Arcade Protocol actions if present in response
      if (aiResponse && aiResponse.includes('[ARCADE:')) {
        const arcadeMatch = aiResponse.match(/\[ARCADE:\s*([^\]]+)\]/);
        if (arcadeMatch && typeof window.executeArcadeAction === 'function') {
            const action = arcadeMatch[1].trim().toLowerCase();
            window.executeArcadeAction(action);
        }
      }

      renderMessenger();
      playIncomingMessageSound();
      
      showMessengerFeedback("");
    } catch (error) {
      console.error("AI response failed", error);
      showMessengerFeedback("AI Companion is currently offline.", true);
    } finally {
      window.__SIGNAL_MESSENGER_SUBMITTING__ = false;
      state.messengerBusy = Math.max(0, state.messengerBusy - 1);
      elements.messageInput.disabled = false;
      elements.sendMessageButton.disabled = false;
      renderMessenger();
    }
    return;
  }

  try {
    const messageId = crypto.randomUUID();
    const optimisticAttachmentUrl = (() => {
      if (!attachmentFile) return null;
      try {
        return URL.createObjectURL(attachmentFile);
      } catch (_error) {
        return state.messageAttachmentPreviewUrl || null;
      }
    })();

    const optimisticMessage = {
      id: messageId,
      threadId: state.activeThreadId,
      senderId: state.currentUser.id,
      body: body || null,
      createdAt: new Date().toISOString(),
      attachmentKind: attachmentFile ? getMessageAttachmentKind(attachmentFile.type) : null,
      attachmentName: attachmentFile ? attachmentFile.name : null,
      attachmentType: attachmentFile ? attachmentFile.type : null,
      attachmentSize: attachmentFile ? attachmentFile.size : 0,
      attachmentUrl: optimisticAttachmentUrl,
    };
    mergeActiveMessage(optimisticMessage);
    renderMessenger();

    let attachmentPayload = {};
    if (attachmentFile) {
      attachmentPayload = await uploadMessageAttachment(state.activeThreadId, messageId, attachmentFile, (percentage) => {
        showMessengerFeedback(`Uploading attachment: ${percentage}%...`);
      });
    }

    const { data, error } = await state.supabase
      .from("messages")
      .insert({
        id: messageId,
        thread_id: state.activeThreadId,
        sender_id: state.currentUser.id,
        body: body || null,
        ...attachmentPayload,
      });

    if (error) throw error;

    if (state.messagesChannel) {
      const recipientId = getThreadPartnerId(state.directThreads.find(t => t.id === state.activeThreadId));
      const targetChannelName = `messenger_live_${recipientId.slice(0, 8)}`;

      const tempChannel = state.supabase.channel(targetChannelName);
      tempChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          tempChannel.send({
            type: "broadcast",
            event: "new-message",
            payload: {
              payload: {
                id: messageId,
                thread_id: state.activeThreadId,
                sender_id: state.currentUser.id,
                body: body || null,
                created_at: new Date().toISOString(),
                ...attachmentPayload
              }
            }
          }).then(() => {
            setTimeout(() => tempChannel.unsubscribe(), 5000);
          });
        }
      });
    }

    const notificationDispatch = await triggerMessageNotificationDispatch(messageId);
    if (notificationDispatch && notificationDispatch.skipped !== true && Number(notificationDispatch.sent ?? 0) === 0) {
      console.warn("Message notification was not confirmed by any target", notificationDispatch);
    }

    const activeThread = getActiveThread();
    if (activeThread) mergeThread({ ...activeThread, updatedAt: new Date().toISOString() });

    clearMessageAttachmentSelection({ preserveFeedback: true });
    showMessengerFeedback("");
  } catch (error) {
    console.error("Message send failed", error);
    showMessengerFeedback("The message could not be sent.", true);
  } finally {
    window.__SIGNAL_MESSENGER_SUBMITTING__ = false;
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    renderMessenger();
  }
}

async function callLocalAI(text, history = [], pageContext = "", attachment = null) {
  const bridgeRequestsEnabled = shouldAttemptBridgeRequests();
  const isLocalOrigin = isLoopbackSiteOrigin() || isPrivateSiteOrigin();
  const configuredLlmEndpoint = typeof window.SIGNAL_SHARE_LLM_ENDPOINT === "string"
    ? window.SIGNAL_SHARE_LLM_ENDPOINT.trim()
    : "";
  const host = `${window.location.hostname || ""}`.trim().toLowerCase();
  const protocol = `${window.location.protocol || ""}`.toLowerCase();
  const isSecureHostedPage = protocol === "https:";
  const isGithubPagesOrigin = host.includes("github.io");
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    if (typeof candidate !== "string") return;
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  const configuredBridgeBase = normalizeBridgeBaseUrl(localStorage.getItem("signal-share-bridge-url") || "");
  const lastWorkingBridgeBase = normalizeBridgeBaseUrl(localStorage.getItem("ss_bridge_last_working_base") || "");
  const pushBridgeBaseCandidate = (baseUrl) => {
    const normalizedBase = normalizeBridgeBaseUrl(baseUrl);
    if (!normalizedBase) return;
    pushCandidate(`${normalizedBase}/api/llm/chat`);
  };

  pushCandidate(configuredLlmEndpoint);
  pushBridgeBaseCandidate(lastWorkingBridgeBase);
  pushBridgeBaseCandidate(configuredBridgeBase);

  if (bridgeRequestsEnabled || isLocalOrigin || configuredLlmEndpoint) {
    if (isLocalOrigin && protocol !== "file:") {
      try {
        pushCandidate(new URL("/api/llm/chat", window.location.href).toString());
      } catch {
        pushCandidate("/api/llm/chat");
      }
    } else if (!isGithubPagesOrigin) {
      pushCandidate(window.location.origin + "/api/llm/chat");
      pushCandidate("/api/llm/chat");
    }
  }

  if (bridgeRequestsEnabled) {
    if (host === "127.0.0.1") {
      pushCandidate("http://127.0.0.1:3000/api/llm/chat");
      pushCandidate("http://localhost:3000/api/llm/chat");
    } else {
      pushCandidate("http://localhost:3000/api/llm/chat");
      pushCandidate("http://127.0.0.1:3000/api/llm/chat");
    }
    if (!isSecureHostedPage || isNativeCapacitorApp()) {
      pushCandidate("http://10.0.2.2:3000/api/llm/chat");
    }
  }

  if (candidates.length === 0) {
    return getGlobalProtocolOfflineResponse(text);
  }

  let abortController = null;
  let stopRequested = false;
  window.stopMessengerAi = () => {
    stopRequested = true;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  const secret = getBridgeSecretValue();
  const preferredModel = resolvePreferredBridgeModel();

  for (const url of candidates) {
    try {
      const targetAddressSpace = getBridgeTargetAddressSpace(url);
      const isRelative = url.startsWith("/") || !/^https?:\/\//i.test(url);
      
      // Skip relative paths on GitHub Pages as they will always 404/405
      if (isRelative && isGithubPagesOrigin) {
          continue;
      }
      if (isGithubPagesOrigin && /^https?:\/\/[^/]*github\.io\/api\/llm\/chat/i.test(url)) {
        continue;
      }

      abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        if (abortController) abortController.abort();
      }, 90000);
      
      const headers = { 
        "Content-Type": "application/json"
      };
      if (secret) headers["X-Bridge-Secret"] = secret;

      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: headers,
          ...(targetAddressSpace ? { targetAddressSpace } : {}),
          signal: abortController.signal,
          cache: "no-store",
          credentials: "omit",
          body: JSON.stringify({ 
            message: text, 
            ...(preferredModel ? { model: preferredModel } : {}),
            history: history,
            pageContext: pageContext || "Signal Share",
            attachment: attachment // Pass through the attachment for multimodal support
          })
        });
      } finally {
        clearTimeout(timeoutId);
      }
      
      if (response.ok) {
        const data = await response.json();
        return data.reply || "I'm having trouble thinking right now.";
      }
    } catch (err) {
      if (stopRequested) {
        return "🛑 [Signal Protocol] AI request stopped.";
      }
      console.debug(`[AI Messenger] Endpoint failed ${url}:`, err);
    }
  }

  // Final Fallback: Internal Global Protocol
  console.log('[AI Messenger] All endpoints failed. Switching to Global Protocol Offline mode.');
  return getGlobalProtocolOfflineResponse(text);
}

/**
 * Lightweight client-side fallback for general site support when offline.
 */
function getGlobalProtocolOfflineResponse(text) {
    const query = (text || "").toLowerCase();
    
    const responses = {
        "hello": "Hello! I'm the Signal Share protocol assistant. My primary logic core is currently offline, but I can still help you with site basics.",
        "hi": "Hi there! I'm running on emergency protocol. How can I help you navigate the platform today?",
        "help": "I can help you with: \n- **Feed**: How to post and view media.\n- **Messenger**: Sending direct messages.\n- **Account**: Signing in and profile settings.\n- **Media**: Using the Hero Player.\nWhat do you need help with?",
        "post": "To post media, use the **Publish Post** section in the sidebar. You can drop images, videos, or audio files there. Note: You need to be signed in to publish to the live feed.",
        "feed": "The live feed shows the latest posts from all members. You can filter by 'All', 'Image', 'Video', or 'Audio' using the sort controls at the top.",
        "messenger": "You can start a private conversation with any member by clicking 'Message' on their profile. Your conversations sync live across all your devices.",
        "profile": "Click on your name in the account section to view your profile. You can change your display name and view your own posts there.",
        "hero": "The Hero Media Player at the top handles all your media playback. It supports YouTube, Spotify, and direct file uploads. You can control it using the floating play bar.",
        "player": "The Hero Media Player at the top handles all your media playback. It supports YouTube, Spotify, and direct file uploads. You can control it using the floating play bar.",
        "who": "I am the Signal Share A.I. Companion. I'm currently running in 'Offline Protocol' mode because I can't reach my primary brain.",
        "error": "If you're seeing errors, make sure you have a stable internet connection. If you're running locally, ensure the Bridge server is active on port 3000.",
        "offline": "I'm in offline mode because the local bridge server is unreachable. Please check if your backend is running."
    };

    // Keyword matching
    for (const key in responses) {
        if (query.includes(key)) return `📶 [Signal Protocol] ${responses[key]}`;
    }

    return "📶 [Signal Protocol] I'm currently operating in offline mode and don't have a specific response for that. Try asking about 'help', 'posting', 'messenger', or 'the player'.";
}

function saveAiMessagesLocally() {
  const storageKey = getAiMessagesStorageKey();
  if (!storageKey) return;
  const sanitized = sanitizeAiMessagesForStorage(state.activeMessages);
  try {
    localStorage.setItem(storageKey, JSON.stringify(sanitized));
  } catch (error) {
    console.warn("AI local message cache exceeded limits; retrying without attachment payloads.", error);
    try {
      const fallback = sanitized.map((message) => ({ ...message, attachmentUrl: "" }));
      localStorage.setItem(storageKey, JSON.stringify(fallback));
    } catch (finalError) {
      console.warn("AI local message cache could not be saved.", finalError);
    }
  }
}

function formatMessageTimestamp(isoString) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(isoString)); }

function loadUserPreferences() {
  try { return normalizeUserPreferences(JSON.parse(localStorage.getItem(USER_PREFERENCES_KEY) ?? "{}")); } catch { return { ...DEFAULT_USER_PREFERENCES }; }
}

function normalizeUserPreferences(raw = {}) {
  const theme = THEME_VALUES.has(raw.theme) ? raw.theme : DEFAULT_USER_PREFERENCES.theme;
  const density = ["airy", "compact"].includes(raw.density) ? raw.density : DEFAULT_USER_PREFERENCES.density;
  const motion = ["full", "calm"].includes(raw.motion) ? raw.motion : DEFAULT_USER_PREFERENCES.motion;
  const statusBarStrip = typeof raw.statusBarStrip === "boolean" ? raw.statusBarStrip : DEFAULT_USER_PREFERENCES.statusBarStrip;
  const notificationHideSender = typeof raw.notificationHideSender === "boolean" ? raw.notificationHideSender : DEFAULT_USER_PREFERENCES.notificationHideSender;
  const notificationHideBody = typeof raw.notificationHideBody === "boolean" ? raw.notificationHideBody : DEFAULT_USER_PREFERENCES.notificationHideBody;
  const showEmail = typeof raw.showEmail === "boolean" ? raw.showEmail : DEFAULT_USER_PREFERENCES.showEmail;
  return { theme, density, motion, statusBarStrip, notificationHideSender, notificationHideBody, showEmail };
}

function saveUserPreferences() { try { localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(state.preferences)); } catch { } }

function updateUserPreferences(nextPreferences) {
  state.preferences = normalizeUserPreferences(nextPreferences);
  applyUserPreferences(state.preferences);
  saveUserPreferences();
  if (state.supabase && state.currentUser) {
    void syncCurrentProfileToSupabase().catch(err => {
      console.error("[Preferences] Sync failed:", err);
      if (window.notifications) {
        window.notifications.error("Failed to sync privacy settings to database. You may need to add columns to your 'profiles' table.", "Sync Error");
      }
    });
  }
  renderSettingsPanel();
}

function isCurrentUserActivated() { if (!state.currentUser) return false; return Boolean(state.currentUser.email_confirmed_at || state.currentUser.confirmed_at); }
function getCurrentUserEmail() { return state.currentUser?.email?.trim().toLowerCase() ?? ""; }

function normalizeEmailForMatch(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase(); if (!normalized || !normalized.includes("@")) return normalized;
  const [localPart, domainPart] = normalized.split("@"); if (!localPart || !domainPart) return normalized;
  if (domainPart === "gmail.com" || domainPart === "googlemail.com") { const localWithoutAlias = localPart.split("+")[0].replace(/\./g, ""); return `${localWithoutAlias}@gmail.com`; }
  return normalized;
}

function getCurrentUserEmailCandidates() {
  if (!state.currentUser) return [];
  const candidates = new Set(); const addEmail = (v) => { if (typeof v === "string") { const n = normalizeEmailForMatch(v); if (n) candidates.add(n); } };
  addEmail(state.currentUser.email); addEmail(state.currentUser.new_email);
  if (state.currentUser.user_metadata) addEmail(state.currentUser.user_metadata.email);
  if (Array.isArray(state.currentUser.identities)) state.currentUser.identities.forEach((i) => { if (i?.identity_data) addEmail(i.identity_data.email); else if (i?.email) addEmail(i.email); });
  return Array.from(candidates);
}

function isCurrentUserAdmin() { const emails = getCurrentUserEmailCandidates(); return emails.some((email) => APP_CONFIG.adminEmails.includes(email)); }
function canRevealMemberEmails() { return isCurrentUserAdmin(); }
function canUseLiveLikesForPost(post) { return Boolean(state.supabase && state.backendMode === "supabase" && state.currentUser && post && !post.isLocal); }
function getPersonalStateScope() { return state.currentUser?.id ? `user:${state.currentUser.id}` : "guest"; }
function getScopedStorageKey(baseKey, scope = getPersonalStateScope()) { return `${baseKey}:${scope}`; }
function parseStoredPostIds(rawValue) { try { const parsed = JSON.parse(rawValue ?? "[]"); return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string" && v.trim()) : []; } catch { return []; } }
function loadScopedPostIds(baseKey, scope = getPersonalStateScope()) { const scoped = parseStoredPostIds(localStorage.getItem(getScopedStorageKey(baseKey, scope))); if (scoped.length || scope !== "guest") return scoped; return parseStoredPostIds(localStorage.getItem(baseKey)); }
function persistScopedPostIds(baseKey, ids, scope = getPersonalStateScope()) { const normalizedIds = Array.isArray(ids) ? ids.filter((v) => typeof v === "string" && v.trim()) : []; try { localStorage.setItem(getScopedStorageKey(baseKey, scope), JSON.stringify(normalizedIds)); if (scope === "guest") localStorage.removeItem(baseKey); } catch { } }

async function refreshLikedPostsState() {
  if (state.supabase && state.backendMode === "supabase" && state.currentUser) { try { state.likedPosts = await loadLikedPostsFromSupabase(); return; } catch (error) { console.error("Like state could not be loaded from Supabase", error); } }
  state.likedPosts = loadLikedPosts();
}

function canCurrentUserUploadMediaKind(mediaKind) { 
  if (state.backendMode !== "supabase") return true; 
  if (!["image", "video", "audio"].includes(mediaKind)) return true; 
  return isCurrentUserAdmin(); 
}

function getRestrictedUploadMessage(mediaKind) { 
  if (mediaKind === "image") return "Only admin accounts can publish uploaded images to the live feed. YouTube and Spotify links stay open."; 
  if (mediaKind === "video") return "Only admin accounts can publish uploaded videos to the live feed. YouTube links stay available to everyone."; 
  if (mediaKind === "audio") return "Only admin accounts can publish uploaded audio to the live feed. Spotify and YouTube links stay open."; 
  return "Only admin accounts can publish that upload type to the live feed."; 
}

function canDeletePost(post) { if (!post) return false; if (post.isLocal) return true; if (state.backendMode !== "supabase" || !state.currentUser) return false; return isCurrentUserAdmin() || post.authorId === state.currentUser.id; }
function getAuthRedirectUrl() { if (APP_CONFIG.authRedirectUrl) { try { return new URL(APP_CONFIG.authRedirectUrl).toString(); } catch (error) { console.warn("Configured auth redirect URL is invalid", error); } } if (/^https?:$/.test(window.location.protocol)) return new URL(window.location.pathname, window.location.origin).toString(); return DEFAULT_AUTH_REDIRECT_URL; }

function normalizeModerationText(value) { 
  const curlyApostrophe = String.fromCharCode(8217);
  return String(value ?? "").toLowerCase().normalize("NFKC").split("'").join("").split(curlyApostrophe).join("").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); 
}

function getActiveBlockedTerms() { return [...DEFAULT_BLOCKED_TERMS]; }

function findBlockedPostTerm({ creator = "", title = "", caption = "", tags = [] }) { 
  const normalizedPostText = normalizeModerationText([creator, title, caption, ...(Array.isArray(tags) ? tags : [])].join(" ")); 
  if (!normalizedPostText) return ""; 
  const haystack = ` ${normalizedPostText} `; 
  return getActiveBlockedTerms().find((term) => { 
    const normalizedTerm = normalizeModerationText(term); 
    return normalizedTerm && haystack.includes(` ${normalizedTerm} `); 
  }) ?? ""; 
}

function isPostModerationError(error) { 
  const message = formatBackendError(error).toLowerCase(); 
  return message.includes("blocked language"); 
}
function getSiteSettingsPayload() { return { id: "global", shell_width: state.siteSettings.shellWidth, section_gap: state.siteSettings.sectionGap, surface_radius: state.siteSettings.surfaceRadius, media_fit: state.siteSettings.mediaFit, updated_at: new Date().toISOString() }; }
function normalizeSiteSettings(row = {}) { return { shellWidth: clampNumber(row.shell_width, 960, 1440, DEFAULT_SITE_SETTINGS.shellWidth), sectionGap: clampNumber(row.section_gap, 16, 40, DEFAULT_SITE_SETTINGS.sectionGap), surfaceRadius: clampNumber(row.surface_radius, 22, 44, DEFAULT_SITE_SETTINGS.surfaceRadius), mediaFit: row.media_fit === "contain" ? "contain" : DEFAULT_SITE_SETTINGS.mediaFit }; }

function loadPlayerPosition() {
  try {
    const raw = localStorage.getItem(PLAYER_POSITION_KEY); if (!raw) return null; const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object") return null;
    const x = Number(parsed.x); const y = Number(parsed.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  } catch { return null; }
}

function normalizePlayerVolume(value, fallback = DEFAULT_PLAYER_VOLUME) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(1, Math.max(0, numeric)); }
function loadPlayerVolume() { try { const raw = localStorage.getItem(PLAYER_VOLUME_KEY); if (!raw) return DEFAULT_PLAYER_VOLUME; return normalizePlayerVolume(raw); } catch { return DEFAULT_PLAYER_VOLUME; } }
function savePlayerVolume(volume) { try { localStorage.setItem(PLAYER_VOLUME_KEY, `${normalizePlayerVolume(volume)}`); } catch { } }
function savePlayerPosition(position) { try { if (!position) { localStorage.removeItem(PLAYER_POSITION_KEY); return; } localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })); } catch { } }
function getPlayerViewportPadding() { return window.innerWidth <= 760 ? 12 : 20; }
function clampPlayerPosition(position) { if (!position) return null; const padding = getPlayerViewportPadding(); const width = elements.miniPlayer.offsetWidth || Math.min(360, Math.max(240, window.innerWidth - padding * 2)); const height = elements.miniPlayer.offsetHeight || 280; const maxX = Math.max(padding, window.innerWidth - width - padding); const maxY = Math.max(padding, window.innerHeight - height - padding); return { x: Math.min(maxX, Math.max(padding, Math.round(position.x))), y: Math.min(maxY, Math.max(padding, Math.round(position.y))) }; }

async function loadSiteSettingsFromSupabase() { const { data, error } = await state.supabase.from("site_settings").select("*").eq("id", "global").maybeSingle(); if (error) throw error; return data ? normalizeSiteSettings(data) : { ...DEFAULT_SITE_SETTINGS }; }
async function handleAdminSettingsSubmit(event) { event.preventDefault(); if (state.backendMode !== "supabase" || !state.supabase || !isCurrentUserAdmin()) { elements.adminSettingsFeedback.textContent = "Only live admin accounts can save site settings."; elements.adminSettingsFeedback.classList.add("is-error"); return; } const { error } = await state.supabase.from("site_settings").upsert(getSiteSettingsPayload()); if (error) { console.error("Failed to save site settings", error); elements.adminSettingsFeedback.textContent = "The layout settings could not be saved."; elements.adminSettingsFeedback.classList.add("is-error"); return; } elements.adminSettingsFeedback.textContent = "Layout settings saved for the live site."; elements.adminSettingsFeedback.classList.remove("is-error"); }

function getAllPosts() { if (state.backendMode === "local" && state.userPosts.length === 0) return [...DEMO_POSTS]; return [...state.userPosts]; }
function getVisiblePosts() {
  const query = state.search;
  const all = healPosts(getAllPosts());
  const posts = all.filter((post) => {
    const matchesFilter = state.filter === "all" || state.filter === post.mediaKind || (state.filter === "saved" && isPostSaved(post.id));
    if (!matchesFilter) return false;
    if (!query) return true;
    const haystack = [post.title, post.caption, post.creator, post.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  return sortPosts(posts);
}

function getKnownProfiles() { return [state.profileRecord, ...state.availableProfiles].filter(Boolean); }
function getKnownProfileById(userId) { if (!userId) return null; return getKnownProfiles().find((profile) => profile.id === userId) ?? null; }
function getProfileKeyForUser(userId) { return userId ? `member:${userId}` : ""; }
function getProfileKeyForCreator(creator) { return creator ? `creator:${creator.trim().toLowerCase()}` : ""; }
function getProfileKeyForPost(post) { if (!post) return ""; return post.authorId ? getProfileKeyForUser(post.authorId) : getProfileKeyForCreator(post.creator); }
function getOwnProfileKey() { if (state.currentUser?.id) return getProfileKeyForUser(state.currentUser.id); const displayName = state.profileRecord?.displayName || getDefaultProfileName(); return getProfileKeyForCreator(displayName); }

function getProfileSummaryForPost(post) {
  if (!post) return null; const knownProfile = post.authorId ? getKnownProfileById(post.authorId) : null; const profileKey = getProfileKeyForPost(post); if (!profileKey) return null;
  return { key: profileKey, userId: post.authorId || knownProfile?.id || "", displayName: knownProfile?.displayName || post.creator || "Member", email: knownProfile?.email || "", createdAt: knownProfile?.createdAt || post.createdAt };
}

function getPostsForProfileKey(profileKey) { if (!profileKey) return []; return sortPosts(getAllPosts().filter((post) => getProfileKeyForPost(post) === profileKey)); }

function getProfileSummaryByKey(profileKey) {
  if (!profileKey) return null;
  const isSelf = profileKey === getOwnProfileKey();
  if (profileKey.startsWith("member:")) {
    const userId = profileKey.slice("member:".length); const knownProfile = getKnownProfileById(userId); const posts = getPostsForProfileKey(profileKey); const fallbackPost = posts[0] ?? null; if (!knownProfile && !fallbackPost && !isSelf) return null;
    return { key: profileKey, userId, displayName: knownProfile?.displayName || fallbackPost?.creator || (isSelf ? (state.profileRecord?.displayName || "You") : "Member"), email: knownProfile?.email || (isSelf ? state.currentUser?.email : ""), createdAt: knownProfile?.createdAt || fallbackPost?.createdAt || new Date().toISOString() };
  }
  const posts = getPostsForProfileKey(profileKey); const fallbackPost = posts[0] ?? null; if (!fallbackPost && !isSelf) return null;
  return { key: profileKey, userId: "", displayName: fallbackPost?.creator || (isSelf ? (state.profileRecord?.displayName || getDefaultProfileName()) : "Member"), email: "", createdAt: fallbackPost?.createdAt || new Date().toISOString() };
}

function getProfileBoardEntries(posts) {
  const board = new Map();
  posts.forEach((post) => {
    const summary = getProfileSummaryForPost(post); if (!summary) return;
    const current = board.get(summary.key) ?? { summary, posts: 0, likes: 0 };
    current.summary = { ...current.summary, ...summary }; current.posts += 1; current.likes += getLikeCount(post); board.set(summary.key, current);
  });
  return Array.from(board.values()).sort((l, r) => r.likes - l.likes || r.posts - l.posts || l.summary.displayName.localeCompare(r.summary.displayName));
}

function sortPosts(posts) { return posts.sort((l, r) => { if (state.sort === "popular") return getLikeCount(r) - getLikeCount(l) || compareByNewest(l, r); const lTime = new Date(l.createdAt).getTime(); const rTime = new Date(r.createdAt).getTime(); return state.sort === "oldest" ? lTime - rTime : rTime - lTime; }); }



async function deletePost(postId) {
  const post = getPostById(postId); if (!post || !canDeletePost(post)) { showFeedback("You do not have permission to delete that post.", true); return; }
  if (state.backendMode === "supabase" && state.supabase && !post.isLocal) { try { await deleteHostedPost(post); state.userPosts = state.userPosts.filter((item) => item.id !== postId); } catch (error) { console.error("Failed to delete hosted post", error); showFeedback("The post could not be deleted from the live feed.", true); return; } }
  else if (state.db) { await deletePostFromDatabase(postId); state.userPosts = await loadPostsFromDatabase(); }
  else { state.userPosts = state.userPosts.filter((p) => p.id !== postId); }
  state.likedPosts = state.likedPosts.filter((id) => id !== postId); state.savedPosts = state.savedPosts.filter((id) => id !== postId); persistScopedPostIds(LIKED_POSTS_KEY, state.likedPosts); localStorage.setItem(SAVED_POSTS_KEY, JSON.stringify(state.savedPosts)); render(); showFeedback(state.backendMode === "supabase" && state.supabase && !post.isLocal ? "Post deleted from the live feed." : "Post deleted.");
}

async function toggleLike(postId) {
  const post = getPostById(postId); if (!post) return; const hasLiked = state.likedPosts.includes(postId);
  if (canUseLiveLikesForPost(post)) {
    try {
      if (hasLiked) { const { error } = await state.supabase.from(POST_LIKES_TABLE).delete().eq("post_id", postId).eq("user_id", state.currentUser.id); if (error) throw error; state.likedPosts = state.likedPosts.filter((id) => id !== postId); updatePostLikeCount(postId, -1); }
      else { const { error } = await state.supabase.from(POST_LIKES_TABLE).insert({ post_id: postId, user_id: state.currentUser.id }); if (error) { if (error.code !== "23505") throw error; } else { updatePostLikeCount(postId, 1); } if (!state.likedPosts.includes(postId)) state.likedPosts = [...state.likedPosts, postId]; }
    } catch (error) { console.error("Like update failed", error); showFeedback("The like could not be updated right now.", true); await refreshLikedPostsState(); render(); return; }
    render(); return;
  }
  if (hasLiked) state.likedPosts = state.likedPosts.filter((id) => id !== postId); else state.likedPosts = [...state.likedPosts, postId]; persistScopedPostIds(LIKED_POSTS_KEY, state.likedPosts); render();
}

function toggleSave(postId) { if (isPostSaved(postId)) state.savedPosts = state.savedPosts.filter((id) => id !== postId); else state.savedPosts = [...state.savedPosts, postId]; localStorage.setItem(SAVED_POSTS_KEY, JSON.stringify(state.savedPosts)); render(); }
function loadLikedPosts() { return loadScopedPostIds(LIKED_POSTS_KEY); }
function loadSavedPosts() { try { return JSON.parse(localStorage.getItem(SAVED_POSTS_KEY) ?? "[]"); } catch { return []; } }
function resolvePostSource(post) { if (post.src) return post.src; if (post.blob) { const url = URL.createObjectURL(post.blob); state.generatedUrls.push(url); return url; } return ""; }
function cleanupObjectUrls() { state.generatedUrls.forEach((url) => URL.revokeObjectURL(url)); state.generatedUrls = []; }
function getLikeCount(post) { if (canUseLiveLikesForPost(post)) return post.likes; return post.likes + (state.likedPosts.includes(post.id) ? 1 : 0); }

function getSignalLabel(post) { if (isFreshFeedPost(post)) return "Fresh in feed"; const likes = getLikeCount(post); if (likes >= 20) return "High signal"; if (likes >= 10) return "Building momentum"; return "Live on feed"; }
function isFreshFeedPost(post) { if (!post) return false; return isPostFromToday(post) || post.id === getLatestPostedPostId(getAllPosts()); }
function isPostFromToday(post) { const postDate = new Date(post.createdAt); if (Number.isNaN(postDate.getTime())) return false; const today = new Date(); return postDate.getFullYear() === today.getFullYear() && postDate.getMonth() === today.getMonth() && postDate.getDate() === today.getDate(); }

function resolveViewerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = URL.createObjectURL(post.blob); return state.viewerUrl; } return ""; }
function resolveActivePlayerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.activePlayerUrl) URL.revokeObjectURL(state.activePlayerUrl); state.activePlayerUrl = URL.createObjectURL(post.blob); return state.activePlayerUrl; } return ""; }

function getSpotlightPost(posts) { return [...posts].sort((l, r) => getLikeCount(r) - getLikeCount(l) || compareByNewest(l, r))[0]; }
function getPostById(id) { return getAllPosts().find((p) => p.id === id) ?? null; }
function isPostSaved(id) { return state.savedPosts.includes(id); }
function rememberCreatorInput() { rememberCreator(elements.creatorInput.value.trim()); }
function rememberCreator(name) { if (!name) localStorage.removeItem(CREATOR_NAME_KEY); else localStorage.setItem(CREATOR_NAME_KEY, name); }
function buildUploadPost(base, file) { return { ...base, mediaKind: getMediaKind(file.type), sourceKind: "upload", isLocal: true, fileName: file.name, fileType: file.type, fileSize: file.size, blob: file }; }
function buildExternalPost(base, parsed) { return { ...base, mediaKind: parsed.mediaKind, sourceKind: parsed.provider, provider: parsed.provider, src: parsed.embedUrl, mediaUrl: parsed.embedUrl, externalUrl: parsed.originalUrl, embedUrl: parsed.embedUrl, externalId: parsed.externalId, label: parsed.label, isLocal: state.backendMode !== "supabase" }; }

function parseExternalMediaUrl(raw) {
  if (!raw) return null;
  const youtube = parseYouTubeUrl(raw); if (youtube) return youtube;
  const spotify = parseSpotifyUrl(raw); if (spotify) return spotify;
  return null;
}

function healPosts(posts) {
  if (!Array.isArray(posts)) return posts;
  return posts.map(post => {
    if (!post) return post;
    const fields = [post.externalUrl, post.embedUrl, post.externalId, post.mediaUrl, post.src, post.label, post.caption, post.title].join(" ");
    const isYouTubeHint = post.sourceKind === "youtube" || fields.toLowerCase().includes("youtu") || fields.toLowerCase().includes("vnd.youtube");
    const hasValidEmbed = typeof post.embedUrl === "string" && post.embedUrl.includes("youtube.com/embed/");

    if (isYouTubeHint && (!post.externalId || !hasValidEmbed)) {
      const repairCandidates = [post.externalUrl, post.embedUrl, post.externalId, post.src, post.mediaUrl, post.label, post.caption, post.title];
      let repaired = null;
      for (const candidate of repairCandidates) {
        if (typeof candidate !== "string" || !candidate.trim()) continue;
        repaired = parseYouTubeUrl(candidate);
        if (repaired) break;
      }
      if (repaired) {
        return {
          ...post,
          externalId: repaired.externalId,
          embedUrl: repaired.embedUrl,
          src: repaired.embedUrl,
          sourceKind: "youtube",
          mediaKind: "video",
          provider: "youtube"
        };
      }
    }
    return post;
  });
}

function parseSpotifyUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  const spotifyUriMatch = value.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i);
  if (spotifyUriMatch) {
    const type = spotifyUriMatch[1].toLowerCase();
    const externalId = spotifyUriMatch[2];
    return {
      provider: "spotify",
      mediaKind: "audio",
      externalId,
      embedUrl: `https://open.spotify.com/embed/${type}/${externalId}?utm_source=generator`,
      originalUrl: raw,
      label: `Spotify ${type}`,
    };
  }

  let url;
  try { url = new URL(value.includes("://") ? value : `https://${value}`); } catch { return null; }

  const host = url.hostname
    .replace(/^www\./i, "")
    .replace(/^open\./i, "")
    .replace(/^play\./i, "")
    .toLowerCase();
  if (host !== "spotify.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] && /^intl-[a-z]{2,5}$/i.test(segments[0])) segments.shift();
  if (segments[0] === "embed") segments.shift();

  const allowed = ["track", "album", "playlist", "artist", "episode", "show"];
  const type = `${segments[0] || ""}`.toLowerCase();
  const id = `${segments[1] || ""}`.trim().replace(/[/?#].*$/, "");
  if (!allowed.includes(type) || !id) return null;

  return {
    provider: "spotify",
    mediaKind: "audio",
    externalId: id,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`,
    originalUrl: raw,
    label: `Spotify ${type}`,
  };
}


function isHostedPostingEnabled() { return Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey && window.supabase); }

function updatePostLikeCount(id, delta) { state.userPosts = state.userPosts.map((p) => p.id === id ? { ...p, likes: Math.max(0, (p.likes ?? 0) + delta) } : p); }

function createDemoGraphic({ title, subtitle, palette }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${palette[0]}" /><stop offset="52%" stop-color="${palette[1]}" /><stop offset="100%" stop-color="${palette[2]}" /></linearGradient></defs><rect width="1200" height="900" rx="50" fill="url(#bg)" /><circle cx="920" cy="180" r="140" fill="rgba(255,255,255,0.22)" /><circle cx="340" cy="660" r="210" fill="rgba(255,255,255,0.14)" /><rect x="92" y="92" width="1016" height="716" rx="34" fill="rgba(15,23,32,0.12)" stroke="rgba(255,255,255,0.35)" /><text x="124" y="300" fill="white" font-size="132" font-family="Georgia, serif">${title}</text><text x="126" y="386" fill="rgba(255,255,255,0.82)" font-size="40" font-family="Arial, sans-serif">${subtitle}</text><text x="126" y="734" fill="rgba(255,255,255,0.7)" font-size="32" font-family="Arial, sans-serif">Signal Share demo post</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const {
  elements, attachEventListeners, render, renderStats, renderAccountState,
  setMessengerStatus, renderMessengerDock, syncMessengerDockScrollState, renderMessenger, focusMessengerPrimaryControl,
  openMessengerDock, collapseMessengerDock, closeMessengerDock, toggleMessengerExpansion, handleMessengerLauncherClick,
  handleMessagesNavClick, handleMessengerMinimizeClick, handleExpandedMessengerOutsideClick, renderAdminBanPanel, renderAdminBanList,
  getFilteredAdminBanProfiles, showAdminBanFeedback, handleAdminBanLauncherClick, closeAdminBanPanel, renderPeopleList,
  renderConversationList, renderActiveThread, showProfileFeedback, showMessengerFeedback, renderMessageEmojiPanel,
  toggleMessageEmojiPicker, closeMessageEmojiPicker, handleMessageEmojiPanelClick, insertEmojiIntoMessage, handleMessageAttachmentInputChange,
  handleMessageAttachmentSelection, clearMessageAttachmentSelection, renderMessageAttachmentPreview, getMessageSenderLabel, createMessageAttachmentPreviewNode,
  createMessageAttachmentNode, createMessageAttachmentTrigger, openMessageAttachmentViewer, createMessageFileNode,
  formatAttachmentTypeLabel, syncComposerCreatorWithAccount, updateComposerAccess, setStatusPill, showAuthFeedback,
  applyUserPreferences, openSettingsPanel, closeSettingsPanel, toggleSettingsPanel, renderSettingsPanel,
  openNotificationsPanel, closeNotificationsPanel, openKeyboardShortcutsPanel, closeKeyboardShortcutsPanel, renderKeyboardShortcuts, handleThemeOptionClick, handleDensityChange,
  handleMotionChange, handleStatusBarStripToggle, handleNotificationHideSenderToggle, handleNotificationHideBodyToggle, resetPlayerDockPosition,
  resetPlayerVolume, resetUserPreferences, syncSourceHelp, applyMiniPlayerPosition, beginMiniPlayerDrag,
  handleMiniPlayerDrag, endMiniPlayerDrag, handleViewportResize, isMobileHeaderViewport, isMobileMessengerViewport,
  isTouchCompactViewport, isLandscapeViewport, resolveMessengerExpandedState, syncMobileMessengerMode, updateViewportMetrics,
  setMobileHeaderHidden, syncMobileHeaderVisibility, handleWindowScroll, applySiteSettings, handleAdminSettingsInput,
  handleAdminSettingsReset, updateAdminSettingsValues, renderAdminEditor, renderTagCloud, renderOverview,
  renderFeed, createFeedCard, getFeedPageCount, clampFeedPage, getCurrentFeedPagePosts,
  resetFeedPagination, renderFeedPagination, syncOverlayBodyState, syncProfileNavAvatar, getProfileInitials,
  renderSpotlight, renderCreatorBoard, renderCardMedia, renderSpotlightMedia, renderViewerMedia,
  renderViewerAttachmentMedia, renderMiniPlayerMedia, getActivePlayerMediaElement, getControllablePlayerPost, resolveExternalEmbedSource,
  buildPersistentPlayerSource, postMessageToYouTubePlayer, syncPlayerVolumeFromMediaElement, attachPersistentPlayerMediaListeners, applyPlayerVolumeToActiveElement,
  mountPersistentPlayer, createPersistentPlayer, applyPersistentPlayerVariant, appendMedia, renderExternalMedia,
  createExternalPreviewStage, applyExternalPreviewMetadata, formatExternalPreviewBadge, deriveSpotifyCreatorFromSourceTitle, isGenericSpotifyCreatorFallback,
  loadPreviewImageCandidates, loadSpotifyPreviewImage, getExternalPreviewMetadata, getSpotifyPreviewMetadata, fetchSpotifyPreviewCatalogMetadata,
  fetchSpotifyPreviewOEmbedMetadata, getSpotifyPreviewImageUrl, getSpotifyPreviewMarket, resolveYouTubePreviewCandidates, getYouTubePreviewMetadata,
  resolveYouTubePreviewSourceUrl, resolveSpotifyPreviewSourceUrl, renderMiniPlayerVolumeControl, renderMiniPlayer, renderViewer,
  renderProfileView, openOwnProfile, openProfileByKey, closeProfile, openViewer,
  closeViewer, stepViewer, openMiniPlayer, expandMiniPlayer, collapseViewerToPlayer,
  closeMiniPlayer, handleMiniPlayerStageClick, handleMiniPlayerVolumeInput, getPlayableVisiblePostIds, stepMiniPlayer,
  renderPreview, renderExternalPreview, clearPreviewOnly, updateSourceHelp, updateActiveFilterChip,
  showFeedback, resetComposer, clearSelectedMedia, clearViewerMedia, clearMiniPlayerMedia,
  destroyActivePlayer, hydrateRememberedCreator, ensureOverlay, showOverlay, hideOverlay,
  heroMediaPlayerController,
} = createAppUi({
  state, createSupabaseClient, loadPostsFromSupabase, loadLikedPostsFromSupabase, publishPostToSupabase,
  compressImageFile, uploadFileToSupabase, uploadMessageAttachment, deleteHostedPost, normalizeSupabasePost,
  parseYouTubeUrl, openDatabase, loadPostsFromDatabase, savePostToDatabase, deletePostFromDatabase,
  setApiContext, DEMO_POSTS, DB_NAME, DB_VERSION, STORE_NAME,
  MAX_IMAGE_FILE_SIZE, MAX_VIDEO_FILE_SIZE, MAX_MESSAGE_LENGTH, DEFAULT_MESSAGE_NOTIFICATION_TITLE, FEED_POSTS_PER_PAGE,
  POST_MODERATION_ERROR, LIKED_POSTS_KEY, POST_LIKES_TABLE, SAVED_POSTS_KEY, CREATOR_NAME_KEY,
  PLAYER_POSITION_KEY, PLAYER_VOLUME_KEY, USER_PREFERENCES_KEY, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION,
  EXTERNAL_PROVIDERS, DEFAULT_PLAYER_VOLUME, DEFAULT_AUTH_REDIRECT_URL, DEFAULT_BLOCKED_TERMS, DEFAULT_SITE_SETTINGS,
  DEFAULT_USER_PREFERENCES, THEME_OPTIONS, APP_CONFIG, externalPreviewCache, isCurrentUserBanned, isUserBanned,
  isMessagingEnabled, canPublishToLiveFeed, isUserBlocked, canAccessAdminBanPanel, registerSiteServiceWorker,
  canUseBrowserNotifications, isNativeCapacitorApp, getCapacitorPlatform, getNativePushNotificationsPlugin, getNativeAppPlugin,
  supportsNativePushNotifications, supportsWebPushNotifications, trimNotificationText, maybeRequestMessageNotificationPermission, base64UrlToUint8Array,
  openMessengerThreadFromNotification, flushPendingNotificationThread, handleIncomingAppUrl, openFeedFromAppUrl, handleServiceWorkerMessage,
  getMessageNotificationFunctionName, getSpotifyPreviewFunctionName, triggerMessageNotificationDispatch, registerWebPushSubscription, unregisterWebPushSubscription,
  ensureWebPushNotificationRegistration, registerNativePushToken, unregisterNativePushToken, initializeNativePushNotifications, safelyInitializeNativePushNotifications,
  catchUpMessengerState, initializeMessengerLifecycleSync, safelyInitializeMessengerLifecycleSync, handleAndroidBackNavigation, initializeNativeBackHandling,
  safelyInitializeNativeBackHandling, safelyEnsurePushNotificationRegistration, safelyUnlinkPushNotificationRegistration, shouldPromptForPushNotificationsOnNativeApp, ensureNativePushNotificationRegistration,
  ensurePushNotificationRegistration, unlinkPushNotificationRegistration, formatBackendError, isBlockingBackendUnavailable, isBanningBackendUnavailable,
  initialize, bindAuthStateListener, handleAuthStateChange, handleSignInSubmit, handleSignUpClick,
  handleSignOutClick, handleResendActivationClick, handleSelectedFile, handleExternalUrlInput, handleFormSubmit,
  clearMessengerState, refreshAdminBanState, toggleUserBan, toggleProfileBlock, getDefaultProfileName,
  formatDisplayNameFromEmail, resolveMemberDisplayName, normalizeProfile, normalizeUserBlock, normalizeUserBan,
  normalizeDirectThread, normalizeMessage, getThreadPartnerId, getThreadPartnerProfile, normalizeMessengerListSearch,
  getFilteredPeopleProfiles, getFilteredConversationThreads, isThreadBlocked, getActiveThread, sortThreads,
  mergeThread, mergeActiveMessage, canonicalizeThreadPair, syncCurrentProfileToSupabase, finalizeProfileSync,
  loadOwnProfileFromSupabase, loadProfilesFromSupabase, loadBlockedUsersFromSupabase, loadUserBansFromSupabase, loadCurrentUserBanFromSupabase,
  refreshCurrentUserBanState, loadDirectThreadsFromSupabase, loadMessagesFromSupabase, loadThreadAttachmentPaths, refreshMessengerState,
  unsubscribeMessagingChannels, subscribeMessagingChannels, playIncomingMessageSound, handleProfileSave, openExistingThread,
  deleteConversation, openOrCreateThread, handleMessageSubmit, formatMessageTimestamp, loadUserPreferences,
  normalizeUserPreferences, saveUserPreferences, updateUserPreferences, isCurrentUserActivated, getCurrentUserEmail,
  normalizeEmailForMatch, getCurrentUserEmailCandidates, isCurrentUserAdmin, canRevealMemberEmails, canUseLiveLikesForPost,
  getPersonalStateScope, getScopedStorageKey, parseStoredPostIds, loadScopedPostIds, persistScopedPostIds,
  refreshLikedPostsState, canCurrentUserUploadMediaKind, getRestrictedUploadMessage, canDeletePost,
  getAuthRedirectUrl, normalizeModerationText, getActiveBlockedTerms,
  findBlockedPostTerm, isPostModerationError, getSiteSettingsPayload, normalizeSiteSettings, clampNumber,
  loadPlayerPosition, normalizePlayerVolume, loadPlayerVolume, savePlayerVolume, savePlayerPosition,
  getPlayerViewportPadding, clampPlayerPosition, loadSiteSettingsFromSupabase, handleAdminSettingsSubmit, getAllPosts,
  getVisiblePosts, getKnownProfiles, getKnownProfileById, getProfileKeyForUser, getProfileKeyForCreator,
  getProfileKeyForPost, getOwnProfileKey, getProfileSummaryForPost, getPostsForProfileKey, getProfileSummaryByKey,
  getProfileBoardEntries, sortPosts, isPlayablePost, deletePost, toggleLike,
  toggleSave, loadLikedPosts, loadSavedPosts, resolvePostSource, cleanupObjectUrls,
  getLikeCount, formatKind, getSignalLabel, isFreshFeedPost, isPostFromToday,
  getLatestPostedPostId, formatTimestamp, formatFileSize, parseTags, getMediaKind,
  getMessageAttachmentKind, formatPostBadge, formatPostMeta,
  resolveViewerSource, resolveActivePlayerSource, compareByNewest, getSpotlightPost, getPostById,
  isPostSaved, rememberCreatorInput, rememberCreator, buildUploadPost, buildExternalPost,
  parseExternalMediaUrl, healPosts, parseSpotifyUrl, formatProviderName, isHostedPostingEnabled,
  getAppConfig, updatePostLikeCount, createDemoGraphic,
});

// Expose core functions and state for AI Companion integration
window.state = state;
window.render = render;
window.setFilter = (filter) => { state.filter = filter; render(); };
window.setSort = (sort) => { state.sort = sort; render(); };
window.openMessengerDock = openMessengerDock;
window.closeMessengerDock = closeMessengerDock;
window.triggerSearch = (query) => { state.search = query; render(); };
window.clearSearch = () => { state.search = ""; render(); };
window.navigateToGames = (cat) => { window.location.href = 'mini-games.html#' + cat; };

window.renderActiveThread = renderActiveThread;
window.heroMediaPlayerController = heroMediaPlayerController;
window.publishPostToSupabase = publishPostToSupabase;
window.buildUploadPost = buildUploadPost;
window.buildExternalPost = buildExternalPost;
window.getMediaKind = getMediaKind;
window.showFeedback = showFeedback;
window.resetComposer = resetComposer;
window.parseExternalMediaUrl = parseExternalMediaUrl;
window.getDefaultProfileName = getDefaultProfileName;

if (!window.__SIGNAL_SHARE_INITIALIZED__) {
  window.__SIGNAL_SHARE_INITIALIZED__ = true;
  initialize().catch((error) => {
    console.error("App initialization failed:", error);
    showFeedback("The site could not start correctly. Reload and try again.", true);
  });
}

// Spotify Web Playback SDK Callback
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log("Spotify Web Playback SDK is ready.");
};
