import { 
  createSupabaseClient, 
  loadPostsFromSupabase, 
  loadLikedPostsFromSupabase, 
  publishPostToSupabase, 
  compressImageFile, 
  uploadFileToSupabase, 
  uploadMessageAttachment, 
  deleteHostedPost, 
  normalizeSupabasePost, 
  parseYouTubeUrl, 
  openDatabase, 
  loadPostsFromDatabase, 
  savePostToDatabase, 
  deletePostFromDatabase, 
  setApiContext,
  loadUserPreferences,
  normalizeUserPreferences,
  loadSavedPosts,
  loadPlayerPosition,
  loadPlayerVolume
} from './api-v3.js';



// Ban Helper Functions

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
    tags: ["poster", "branding", "campaign"],
    createdAt: "2026-04-19T19:35:00.000Z",
    mediaKind: "image",
    src: createDemoGraphic({
      title: "Quiet Launch",
      subtitle: "campaign poster",
      palette: ["#2a9d8f", "#264653", "#f6efe3"],
    }),
    likes: 27,
    isLocal: false,
  },
  {
    id: "demo-night-drive",
    creator: "Rae Sol",
    title: "Night Drive Mix",
    caption:
      "A late edit of the opening cue. Upload your own audio to turn this prototype into a working listening feed.",
    tags: ["audio", "mix", "score"],
    createdAt: "2026-04-22T08:05:00.000Z",
    mediaKind: "audio",
    src: "",
    likes: 11,
    isLocal: false,
  },
];

const DB_NAME = "signal-share-db";
const DB_VERSION = 1;
const STORE_NAME = "posts";
const MAX_IMAGE_FILE_SIZE = 50 * 1024 * 1024 * 1024;
const MAX_VIDEO_FILE_SIZE = 50 * 1024 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MESSAGE_NOTIFICATION_TITLE = "New message";
const FEED_POSTS_PER_PAGE = 9;
const POST_MODERATION_ERROR = "This post contains blocked language and cannot be published.";
const LIKED_POSTS_KEY = "signal-share-liked";
const POST_LIKES_TABLE = "post_likes";
const SAVED_POSTS_KEY = "signal-share-saved";
const CREATOR_NAME_KEY = "signal-share-creator";
const PLAYER_POSITION_KEY = "signal-share-player-position";
const PLAYER_VOLUME_KEY = "signal-share-player-volume";
const USER_PREFERENCES_KEY = "signal-share-preferences";
const CURRENT_TERMS_VERSION = "2026-04-28";
const CURRENT_PRIVACY_VERSION = "2026-04-28";
const EXTERNAL_PROVIDERS = ["youtube", "spotify"];
const DEFAULT_PLAYER_VOLUME = 1;
const DEFAULT_AUTH_REDIRECT_URL = "https://falabellamichael.github.io/Signal-Share/";
const DEFAULT_BLOCKED_TERMS = Object.freeze([
  "asshole", "beaner", "bitch", "chink", "cunt", "fag", "faggot", "fuck", "gook", "kike", "motherfucker", "nigga", "nigger", "paki", "raghead", "retard", "shit", "slut", "spic", "tranny", "wetback", "whore",
]);
const DEFAULT_SITE_SETTINGS = Object.freeze({
  shellWidth: 1200,
  sectionGap: 24,
  surfaceRadius: 32,
  mediaFit: "cover",
});
const DEFAULT_USER_PREFERENCES = Object.freeze({
  theme: "sunset",
  density: "airy",
  statusBarStrip: true,
  notificationHideSender: false,
  notificationHideBody: false,
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

// Bridge to app-ui-v3.js
window.DEFAULT_USER_PREFERENCES = DEFAULT_USER_PREFERENCES;
window.THEME_VALUES = THEME_VALUES;
window.USER_PREFERENCES_KEY = USER_PREFERENCES_KEY;
window.SAVED_POSTS_KEY = SAVED_POSTS_KEY;
window.DEMO_POSTS = DEMO_POSTS;
window.MAX_IMAGE_FILE_SIZE = MAX_IMAGE_FILE_SIZE;
window.MAX_VIDEO_FILE_SIZE = MAX_VIDEO_FILE_SIZE;
window.LIKED_POSTS_KEY = LIKED_POSTS_KEY;
window.DEFAULT_PLAYER_VOLUME = DEFAULT_PLAYER_VOLUME;
window.PLAYER_POSITION_KEY = PLAYER_POSITION_KEY;
window.PLAYER_VOLUME_KEY = PLAYER_VOLUME_KEY;
window.THEME_OPTIONS = THEME_OPTIONS;

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
const externalPreviewCache = new Map();

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
    viewerPostId: null,
    viewerAttachment: null,
    miniPlayerUrl: "",
    viewerUrl: "",
    returnFocusElement: null,
    profileReturnFocusElement: null,
  };
}
const state = window[globalStateKey];
window.state = state; // Also expose as window.state for backward compatibility and cross-module access

const elements = {
  siteHeader: document.querySelector(".site-header"),
  postForm: document.querySelector("#postForm"),
  creatorInput: document.querySelector("#creatorInput"),
  titleInput: document.querySelector("#titleInput"),
  captionInput: document.querySelector("#captionInput"),
  tagsInput: document.querySelector("#tagsInput"),
  externalUrlInput: document.querySelector("#externalUrlInput"),
  mediaInput: document.querySelector("#mediaInput"),
  dropzone: document.querySelector("#dropzone"),
  previewShell: document.querySelector("#previewShell"),
  formFeedback: document.querySelector("#formFeedback"),
  resetFormButton: document.querySelector("#resetFormButton"),
  sourceHelp: document.querySelector("#sourceHelp"),
  settingsToggleButton: document.querySelector("#settingsToggleButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  notificationsLauncherButton: document.querySelector("#notificationBell"),
  notificationsPanel: document.querySelector("#notificationsPanel"),
  notificationsBackdrop: document.querySelector("#notificationsBackdrop"),
  notificationsCloseButton: document.querySelector("#notificationsCloseButton"),
  clearNotificationsButton: document.querySelector("#clearNotificationsButton"),
  notificationsList: document.querySelector("#notificationsList"),
  notificationsEmptyState: document.querySelector("#notificationsEmptyState"),
  keyboardShortcutsButton: document.querySelector("#keyboardShortcutsButton"),
  settingsMainPage: document.querySelector("#settingsMainPage"),
  settingsShortcutsPage: document.querySelector("#settingsShortcutsPage"),
  shortcutsList: document.querySelector("#shortcutsList"),
  themePicker: document.querySelector("#themePicker"),
  themePickerButton: document.querySelector("#themePickerButton"),
  themePickerMenu: document.querySelector("#themePickerMenu"),
  themePickerPreview: document.querySelector("#themePickerPreview"),
  themePickerLabel: document.querySelector("#themePickerLabel"),
  themePickerDescription: document.querySelector("#themePickerDescription"),
  densitySelect: document.querySelector("#densitySelect"),
  motionSelect: document.querySelector("#motionSelect"),
  statusBarStripToggle: document.querySelector("#statusBarStripToggle"),
  notificationHideSenderToggle: document.querySelector("#notificationHideSenderToggle"),
  notificationHideBodyToggle: document.querySelector("#notificationHideBodyToggle"),
  resetPlayerPositionButton: document.querySelector("#resetPlayerPositionButton"),
  resetPreferencesButton: document.querySelector("#resetPreferencesButton"),
  messagesNavLink: document.querySelector("#messagesNavLink"),
  profileNavLink: document.querySelector("#profileNavLink"),
  profileNavAvatar: document.querySelector("#profileNavAvatar"),

  adminBanLauncherButton: document.querySelector("#adminBanLauncherButton"),
  adminBanPanel: document.querySelector("#adminBanPanel"),
  adminBanCloseButton: document.querySelector("#adminBanCloseButton"),
  adminBanRefreshButton: document.querySelector("#adminBanRefreshButton"),
  adminBanSearchInput: document.querySelector("#adminBanSearchInput"),
  adminBanList: document.querySelector("#adminBanList"),
  adminBanEmpty: document.querySelector("#adminBanEmpty"),
  adminBanFeedback: document.querySelector("#adminBanFeedback"),
  messengerLauncherButton: document.querySelector("#messengerLauncherButton"),
  messengerSection: document.querySelector("#messages"),
  messengerMinimizeButton: document.querySelector("#messengerMinimizeButton"),
  messengerExpandButton: document.querySelector("#messengerExpandButton"),
  messengerHideButton: document.querySelector("#messengerHideButton"),
  messengerStatusPill: document.querySelector("#messengerStatusPill"),
  messengerStatusCopy: document.querySelector("#messengerStatusCopy"),
  profileDisplayNameInput: document.querySelector("#profileDisplayNameInput"),
  saveProfileButton: document.querySelector("#saveProfileButton"),
  profileFeedback: document.querySelector("#profileFeedback"),
  peopleSearchInput: document.querySelector("#peopleSearchInput"),
  peopleList: document.querySelector("#peopleList"),
  peopleEmpty: document.querySelector("#peopleEmpty"),
  conversationSearchInput: document.querySelector("#conversationSearchInput"),
  conversationList: document.querySelector("#conversationList"),
  conversationEmpty: document.querySelector("#conversationEmpty"),
  activeThreadLabel: document.querySelector("#activeThreadLabel"),
  activeThreadMeta: document.querySelector("#activeThreadMeta"),
  messageList: document.querySelector("#messageList"),
  messageEmpty: document.querySelector("#messageEmpty"),
  messageForm: document.querySelector("#messageForm"),
  messageInput: document.querySelector("#messageInput"),
  messageAttachmentInput: document.querySelector("#messageAttachmentInput"),
  messageAttachmentPreview: document.querySelector("#messageAttachmentPreview"),
  messageEmojiPanel: document.querySelector("#messageEmojiPanel"),
  messageEmojiButton: document.querySelector("#messageEmojiButton"),
  messageAttachButton: document.querySelector("#messageAttachButton"),
  messageAttachmentClearButton: document.querySelector("#messageAttachmentClearButton"),
  sendMessageButton: document.querySelector("#sendMessageButton"),
  messengerFeedback: document.querySelector("#messengerFeedback"),
  authForm: document.querySelector("#authForm"),
  authDisplayNameInput: document.querySelector("#authDisplayNameInput"),
  authEmailInput: document.querySelector("#authEmailInput"),
  authPasswordInput: document.querySelector("#authPasswordInput"),
  authTermsCheckbox: document.querySelector("#authTermsCheckbox"),
  signInButton: document.querySelector("#signInButton"),
  signUpButton: document.querySelector("#signUpButton"),
  signOutButton: document.querySelector("#signOutButton"),
  openOwnProfileButton: document.querySelector("#openOwnProfileButton"),
  resendActivationButton: document.querySelector("#resendActivationButton"),
  authAccount: document.querySelector("#authAccount"),
  accountEmail: document.querySelector("#accountEmail"),
  accountMeta: document.querySelector("#accountMeta"),
  authFeedback: document.querySelector("#authFeedback"),
  adminEditor: document.querySelector("#adminEditor"),
  adminSettingsForm: document.querySelector("#adminSettingsForm"),
  layoutWidthInput: document.querySelector("#layoutWidthInput"),
  layoutWidthValue: document.querySelector("#layoutWidthValue"),
  layoutGapInput: document.querySelector("#layoutGapInput"),
  layoutGapValue: document.querySelector("#layoutGapValue"),
  layoutRadiusInput: document.querySelector("#layoutRadiusInput"),
  layoutRadiusValue: document.querySelector("#layoutRadiusValue"),
  mediaFitSelect: document.querySelector("#mediaFitSelect"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  adminSettingsFeedback: document.querySelector("#adminSettingsFeedback"),
  authStatusPill: document.querySelector("#authStatusPill"),
  authStatusCopy: document.querySelector("#authStatusCopy"),
  authHint: document.querySelector("#authHint"),
  activationPanel: document.querySelector("#activationPanel"),
  activationTitle: document.querySelector("#activationTitle"),
  activationMessage: document.querySelector("#activationMessage"),
  feedGrid: document.querySelector("#feedGrid"),
  feedCardTemplate: document.querySelector("#feedCardTemplate"),
  filterRow: document.querySelector("#filterRow"),
  tagCloud: document.querySelector("#tagCloud"),
  emptyState: document.querySelector("#emptyState"),
  sortSelect: document.querySelector("#sortSelect"),
  searchInput: document.querySelector("#searchInput"),
  statsPanel: document.querySelector("#statsPanel"),
  spotlightCard: document.querySelector("#spotlightCard"),
  creatorBoard: document.querySelector("#creatorBoard"),
  viewer: document.querySelector("#viewer"),
  profileView: document.querySelector("#profileView"),
  feedPagination: document.querySelector("#feedPagination"),
  viewerStage: document.querySelector("#viewerStage"),
  viewerCloseButton: document.querySelector("#viewerCloseButton"),
  viewerCollapseButton: document.querySelector("#viewerCollapseButton"),
  viewerKind: document.querySelector("#viewerKind"),
  viewerTitle: document.querySelector("#viewerTitle"),
  viewerCaption: document.querySelector("#viewerCaption"),
  viewerCreator: document.querySelector("#viewerCreator"),
  viewerTime: document.querySelector("#viewerTime"),
  viewerTags: document.querySelector("#viewerTags"),
  viewerPrevButton: document.querySelector("#viewerPrevButton"),
  viewerNextButton: document.querySelector("#viewerNextButton"),
  profileCloseButton: document.querySelector("#profileCloseButton"),
  profileBadge: document.querySelector("#profileBadge"),
  profileTitle: document.querySelector("#profileTitle"),
  profileMeta: document.querySelector("#profileMeta"),
  profileStats: document.querySelector("#profileStats"),
  profileFeedGrid: document.querySelector("#profileFeedGrid"),
  profileFeedPagination: document.querySelector("#profileFeedPagination"),
  profileEmpty: document.querySelector("#profileEmpty"),
  miniPlayer: document.querySelector("#miniPlayer"),
  miniPlayerHead: document.querySelector("#miniPlayerHead"),
  miniPlayerStage: document.querySelector("#miniPlayerStage"),
  miniPlayerVolume: document.querySelector("#miniPlayerVolume"),
  miniPlayerVolumeSlider: document.querySelector("#miniPlayerVolumeSlider"),
  miniPlayerVolumeValue: document.querySelector("#miniPlayerVolumeValue"),
  miniPlayerKind: document.querySelector("#miniPlayerKind"),
  miniPlayerTitle: document.querySelector("#miniPlayerTitle"),
  miniPlayerDetail: document.querySelector("#miniPlayerDetail"),
  miniPlayerCaption: document.querySelector("#miniPlayerCaption"),
  miniPlayerCreator: document.querySelector("#miniPlayerCreator"),
  miniPlayerTime: document.querySelector("#miniPlayerTime"),
  miniPlayerTags: document.querySelector("#miniPlayerTags"),
  miniExpandButton: document.querySelector("#miniExpandButton"),
  miniCloseButton: document.querySelector("#miniCloseButton"),
  miniPrevButton: document.querySelector("#miniPrevButton"),
  miniNextButton: document.querySelector("#miniNextButton"),
};

window.__SIGNAL_SHARE_ELEMENTS__ = elements;

registerSiteServiceWorker();

// Global guard to ensure side-effects only run once
if (!window.__SIGNAL_SHARE_INITIALIZED__) {
  window.__SIGNAL_SHARE_INITIALIZED__ = true;
  
  window.isMessagingEnabled = isMessagingEnabled;
  window.canPublishToLiveFeed = canPublishToLiveFeed;
  window.isUserBanned = isUserBanned;
  window.isCurrentUserBanned = isCurrentUserBanned;
  window.isUserBlocked = isUserBlocked;
  window.canAccessAdminBanPanel = canAccessAdminBanPanel;
  window.formatBackendError = formatBackendError;
  window.getMediaKind = getMediaKind;
  window.showFeedback = showFeedback;
  window.render = render;
  window.normalizeUserPreferences = normalizeUserPreferences;
  window.applyUserPreferences = applyUserPreferences;
  window.saveUserPreferences = saveUserPreferences;
  window.renderSettingsPanel = renderSettingsPanel;
  window.showOverlay = showOverlay;
  window.hideOverlay = hideOverlay;

  // Initialize API context to break circular dependency
  setApiContext({
    state,
    APP_CONFIG,
    POST_LIKES_TABLE,
    DB_NAME,
    DB_VERSION,
    STORE_NAME
  });

  initialize().catch((error) => {
    console.error("App initialization failed:", error);
    showFeedback("The site could not start correctly. Reload and try again.", true);
  });
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

function canUseBrowserNotifications() {
  return "Notification" in window && window.isSecureContext;
}

function isNativeCapacitorApp() {
  if (!window.Capacitor) return false;
  if (typeof window.Capacitor.isNativePlatform === "function") return window.Capacitor.isNativePlatform();
  if (typeof window.Capacitor.getPlatform === "function") return window.Capacitor.getPlatform() !== "web";
  return false;
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
  void Notification.requestPermission().catch(() => {});
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
  } catch (_error) {}
  try {
    await push.addListener("registration", (token) => {
      nativePushToken = token.value ?? "";
      if (nativePushToken && state.currentUser) {
        void registerNativePushToken(nativePushToken).catch((error) => console.error("Native push token could not be saved", error));
      }
    });
    await push.addListener("registrationError", (error) => console.error("Native push registration failed", error));
    await push.addListener("pushNotificationReceived", (notification) => {
      if (notification?.data?.type === "direct-message") {
        playIncomingMessageSound();
        if (isMessagingEnabled(state)) void refreshMessengerState({ preserveActiveThread: true });
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
  } catch (_error) {}
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
  // DEBUG OVERLAY
  const debugOverlay = document.createElement("div");
  debugOverlay.id = "debug-overlay";
  debugOverlay.style.cssText = "position:fixed;top:0;left:0;z-index:999999;background:rgba(255,0,0,0.8);color:white;font-size:12px;padding:4px;pointer-events:none;font-family:monospace;line-height:1.2;white-space:pre;";
  document.body.appendChild(debugOverlay);
  window.updateDebugOverlay = (text) => { debugOverlay.textContent = text; };

  applySiteSettings(state.siteSettings);
  applyUserPreferences(state.preferences);
  updateViewportMetrics();

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
  if (state.currentUser && isMessagingEnabled(state)) void safelyEnsurePushNotificationRegistration({ prompt: shouldPromptForPushNotificationsOnNativeApp() });
  state.lastScrollY = window.scrollY;
  syncMobileHeaderVisibility();
  updateActiveFilterChip();
  updateSourceHelp("none");
  render();
}

function attachEventListeners() {
  if (state.listenersAttached) return;
  state.listenersAttached = true;
  elements.dropzone.addEventListener("click", () => elements.mediaInput.click());
  elements.dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); elements.mediaInput.click(); } });
  ["dragenter", "dragover"].forEach((eventName) => { elements.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropzone.classList.add("is-dragover"); }); });
  ["dragleave", "drop"].forEach((eventName) => { elements.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropzone.classList.remove("is-dragover"); }); });
  elements.dropzone.addEventListener("drop", (event) => { const [file] = Array.from(event.dataTransfer?.files ?? []); if (file) handleSelectedFile(file); });
  elements.mediaInput.addEventListener("change", (event) => { const [file] = Array.from(event.target.files ?? []); if (file) handleSelectedFile(file); });
  elements.externalUrlInput.addEventListener("input", handleExternalUrlInput);
  elements.settingsToggleButton.addEventListener("click", toggleSettingsPanel);
  elements.settingsBackdrop.addEventListener("click", closeSettingsPanel);
  elements.settingsCloseButton.addEventListener("click", closeSettingsPanel);
  window.addEventListener("click", handleWindowClick);
  // Listeners for bell button are now handled inline in index.html to prevent conflicts
  if (elements.keyboardShortcutsButton) elements.keyboardShortcutsButton.addEventListener("click", () => window.showSettingsPage && window.showSettingsPage('shortcuts'));
  if (elements.notificationsBackdrop) elements.notificationsBackdrop.addEventListener("click", closeNotificationsPanel);
  if (elements.notificationsCloseButton) elements.notificationsCloseButton.addEventListener("click", closeNotificationsPanel);
  if (elements.clearNotificationsButton) elements.clearNotificationsButton.addEventListener("click", () => {
    if (window.notifications) window.notifications.clearHistory();
    renderNotificationsHistory();
  });
  elements.themePickerButton?.addEventListener("click", toggleThemePicker);
  elements.themePickerMenu?.addEventListener("click", handleThemeOptionClick);
  elements.densitySelect.addEventListener("change", handleDensityChange);
  elements.motionSelect.addEventListener("change", handleMotionChange);
  elements.statusBarStripToggle.addEventListener("change", handleStatusBarStripToggle);
  elements.notificationHideSenderToggle.addEventListener("change", handleNotificationHideSenderToggle);
  elements.notificationHideBodyToggle.addEventListener("change", handleNotificationHideBodyToggle);
  elements.resetPlayerPositionButton.addEventListener("click", resetPlayerDockPosition);
  elements.resetPreferencesButton.addEventListener("click", resetUserPreferences);
  elements.messagesNavLink.addEventListener("click", handleMessagesNavClick);
  elements.adminBanLauncherButton.addEventListener("click", handleAdminBanLauncherClick);
  elements.adminBanCloseButton.addEventListener("click", closeAdminBanPanel);
  elements.adminBanRefreshButton.addEventListener("click", () => void refreshAdminBanState());
  elements.adminBanSearchInput.addEventListener("input", (event) => { state.adminBanSearch = normalizeMessengerListSearch(event.target.value); renderAdminBanPanel(); });
  elements.messengerLauncherButton.addEventListener("click", handleMessengerLauncherClick);
  elements.messengerMinimizeButton.addEventListener("click", handleMessengerMinimizeClick);
  elements.messengerExpandButton.addEventListener("click", toggleMessengerExpansion);
  elements.messengerHideButton.addEventListener("click", closeMessengerDock);
  elements.saveProfileButton.addEventListener("click", handleProfileSave);
  elements.peopleSearchInput.addEventListener("input", (event) => { state.peopleSearch = normalizeMessengerListSearch(event.target.value); renderMessenger(); });
  elements.conversationSearchInput.addEventListener("input", (event) => { state.conversationSearch = normalizeMessengerListSearch(event.target.value); renderMessenger(); });
  elements.messageForm.addEventListener("submit", handleMessageSubmit);
  elements.messageInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { handleMessageSubmit(event); } });
  elements.messageEmojiButton.addEventListener("click", toggleMessageEmojiPicker);
  elements.messageEmojiPanel.addEventListener("click", handleMessageEmojiPanelClick);
  elements.messageAttachButton.addEventListener("click", () => { closeMessageEmojiPicker(); elements.messageAttachmentInput.click(); });
  elements.messageAttachmentInput.addEventListener("change", handleMessageAttachmentInputChange);
  elements.messageAttachmentClearButton.addEventListener("click", clearMessageAttachmentSelection);
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
  elements.postForm.addEventListener("submit", handleFormSubmit);
  elements.resetFormButton.addEventListener("click", resetComposer);
  elements.creatorInput.addEventListener("change", rememberCreatorInput);
  elements.authForm.addEventListener("submit", handleSignInSubmit);
  elements.signUpButton.addEventListener("click", handleSignUpClick);
  elements.signOutButton.addEventListener("click", handleSignOutClick);
  elements.openOwnProfileButton.addEventListener("click", openOwnProfile);

  if (elements.profileNavLink) elements.profileNavLink.addEventListener("click", (event) => { event.preventDefault(); openOwnProfile(event); });
  elements.resendActivationButton.addEventListener("click", handleResendActivationClick);
  elements.adminSettingsForm.addEventListener("submit", handleAdminSettingsSubmit);
  elements.layoutWidthInput.addEventListener("input", handleAdminSettingsInput);
  elements.layoutGapInput.addEventListener("input", handleAdminSettingsInput);
  elements.layoutRadiusInput.addEventListener("input", handleAdminSettingsInput);
  elements.mediaFitSelect.addEventListener("change", handleAdminSettingsInput);
  elements.resetSettingsButton.addEventListener("click", handleAdminSettingsReset);
  elements.filterRow.addEventListener("click", (event) => { const chip = event.target.closest("[data-filter]"); if (!chip) return; state.filter = chip.dataset.filter; resetFeedPagination(); updateActiveFilterChip(); render(); });
  elements.tagCloud.addEventListener("click", (event) => { const chip = event.target.closest("[data-tag]"); if (!chip) return; const currentSearch = elements.searchInput.value.trim(); const tag = chip.dataset.tag; elements.searchInput.value = currentSearch === tag ? "" : tag; state.search = elements.searchInput.value.trim().toLowerCase(); resetFeedPagination(); render(); });
  elements.sortSelect.addEventListener("change", (event) => { state.sort = event.target.value; resetFeedPagination(); render(); });
  elements.searchInput.addEventListener("input", (event) => { state.search = event.target.value.trim().toLowerCase(); resetFeedPagination(); render(); });
  elements.viewer.addEventListener("click", (event) => { if (event.target.closest("[data-close-viewer]")) closeViewer(); });
  elements.profileView.addEventListener("click", (event) => { if (event.target.closest("[data-close-profile]")) closeProfile(); });
  elements.viewerCloseButton.addEventListener("click", closeViewer);
  elements.profileCloseButton.addEventListener("click", closeProfile);
  elements.viewerCollapseButton.addEventListener("click", collapseViewerToPlayer);
  elements.viewerPrevButton.addEventListener("click", () => stepViewer(-1));
  elements.viewerNextButton.addEventListener("click", () => stepViewer(1));
  elements.miniExpandButton.addEventListener("click", expandMiniPlayer);
  elements.miniCloseButton.addEventListener("click", closeMiniPlayer);
  elements.miniPrevButton.addEventListener("click", () => stepMiniPlayer(-1));
  elements.miniNextButton.addEventListener("click", () => stepMiniPlayer(1));
  elements.miniPlayerStage.addEventListener("click", handleMiniPlayerStageClick);
  elements.miniPlayerVolumeSlider.addEventListener("input", handleMiniPlayerVolumeInput);
  elements.miniPlayerHead.addEventListener("pointerdown", beginMiniPlayerDrag);
  window.addEventListener("pointermove", handleMiniPlayerDrag);
  window.addEventListener("pointerup", endMiniPlayerDrag);
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("scroll", handleWindowScroll, { passive: true });
  window.visualViewport?.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("scroll", handleViewportResize);
  document.addEventListener("keydown", (event) => {
  if (state.themePickerOpen && event.key === "Escape") { closeThemePicker(); return; }
  if (state.settingsPanelOpen && event.key === "Escape") { closeSettingsPanel(); return; }
    if (state.notificationsPanelOpen && event.key === "Escape") { closeNotificationsPanel(); return; }
    if (state.keyboardShortcutsPanelOpen && event.key === "Escape") { closeKeyboardShortcutsPanel(); return; }
    if (state.adminBanPanelOpen && event.key === "Escape") { closeAdminBanPanel(); return; }
    if (state.messageEmojiPickerOpen && event.key === "Escape") { closeMessageEmojiPicker({ restoreFocus: true }); return; }
    if (state.activeProfileKey && event.key === "Escape") { closeProfile(); return; }
    if ((state.messengerExpanded || state.messengerOpen) && event.key === "Escape" && !elements.viewer.classList.contains("is-open") && !elements.profileView.classList.contains("is-open")) {
      if (state.messengerExpanded) collapseMessengerDock(); else closeMessengerDock();
      return;
    }
    if (!elements.viewer.classList.contains("is-open")) return;
    if (event.key === "Escape") closeViewer();
    if (event.key === "ArrowLeft") stepViewer(-1);
    if (event.key === "ArrowRight") stepViewer(1);
  });
  // Notification Interactivity
  document.addEventListener("signal:notificationClick", (event) => {
    const notification = event.detail;
    if (!notification || !notification.data) return;
    
    closeNotificationsPanel();
    
    if (notification.data.type === "message" && notification.data.threadId) {
      void openMessengerThreadFromNotification(notification.data.threadId);
    } else if (notification.data.type === "post" && notification.data.postId) {
      void openViewer(notification.data.postId);
    }
  });
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
    void safelyEnsurePushNotificationRegistration({ prompt: shouldPromptForPushNotificationsOnNativeApp() });
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


// handleSelectedFile and handleExternalUrlInput moved to app-ui-v3.js

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

function render() {
  cleanupObjectUrls();
  state.visiblePostIds = getVisiblePosts().map((post) => post.id);
  
  // Call modularized UI functions
  renderStats();
  renderAccountState();
  renderMessenger();
  renderSettingsPanel();
  renderNotificationsPanel();
  renderAdminEditor();
  renderAdminBanPanel();
  renderTagCloud();
  renderOverview();
  renderFeed();
  renderMiniPlayer();
  renderViewer();
  renderProfileView();
  syncSourceHelp();
  updateComposerAccess();
}
// Logic moved to app-ui-v3.js

// Admin Ban UI rendering moved to app-ui-v3.js

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

function handleAdminBanLauncherClick() {
  if (!canAccessAdminBanPanel(state)) return;
  state.adminBanPanelOpen = true; state.messengerOpen = false; state.messengerExpanded = false; state.messageEmojiPickerOpen = false;
  render(); void refreshAdminBanState(); window.requestAnimationFrame(() => elements.adminBanSearchInput.focus());
}

function closeAdminBanPanel(options = {}) {
  const { restoreFocus = true } = options; if (!state.adminBanPanelOpen) return;
  state.adminBanPanelOpen = false; state.pendingBanUserId = ""; renderAdminBanPanel(); if (restoreFocus) elements.adminBanLauncherButton.focus();
}

// Messenger UI rendering moved to app-ui-v3.js

function showProfileFeedback(message, isError = false) { elements.profileFeedback.textContent = message; elements.profileFeedback.classList.toggle("is-error", isError); }
function showMessengerFeedback(message, isError = false) { elements.messengerFeedback.textContent = message; elements.messengerFeedback.classList.toggle("is-error", isError); }
// Messenger UI actions and logic moved to app-ui-v3.js
function getDefaultProfileName() {
  const accountName = state.profileRecord?.displayName?.trim() || state.currentUser?.user_metadata?.display_name?.trim() || state.currentUser?.user_metadata?.full_name?.trim() || state.currentUser?.user_metadata?.name?.trim();
  if (accountName) return accountName.slice(0, 40);
  const remembered = localStorage.getItem(CREATOR_NAME_KEY)?.trim(); if (remembered) return remembered.slice(0, 40);
  const email = state.currentUser?.email ?? ""; const localPart = email.split("@")[0] ?? "Member"; const prettyName = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return prettyName ? prettyName.slice(0, 40) : "Member";
}
function formatDisplayNameFromEmail(email = "") { const localPart = String(email ?? "").trim().split("@")[0] ?? ""; const prettyName = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); return prettyName ? prettyName.slice(0, 40) : ""; }
function resolveMemberDisplayName(profile, fallback = "Member") { if (!profile || typeof profile !== "object") return fallback; const displayName = String(profile.displayName ?? "").trim(); if (displayName && !normalizeEmailForMatch(displayName).includes("@")) return displayName.slice(0, 40); const prettyEmailName = formatDisplayNameFromEmail(profile.email); return prettyEmailName || (displayName ? displayName.slice(0, 40) : fallback); }
function syncComposerCreatorWithAccount() { const shouldLockToAccount = state.backendMode === "supabase" && Boolean(state.currentUser); if (shouldLockToAccount) elements.creatorInput.value = getDefaultProfileName(); elements.creatorInput.readOnly = shouldLockToAccount; }
function normalizeProfile(row) { 
  return { 
    id: row.id, 
    email: row.email, 
    displayName: row.display_name, 
    notificationHideSender: Boolean(row.notification_hide_sender),
    notificationHideBody: Boolean(row.notification_hide_body),
    createdAt: row.created_at, 
    updatedAt: row.updated_at 
  }; 
}
function normalizeUserBlock(row) { return { blockerId: row.blocker_id, blockedId: row.blocked_id, createdAt: row.created_at }; }
function normalizeUserBan(row) { return { bannedId: row.banned_id, bannedBy: row.banned_by, reason: row.reason ?? "", createdAt: row.created_at }; }
function normalizeDirectThread(row) { return { id: row.id, userOneId: row.user_one_id, userTwoId: row.user_two_id, createdAt: row.created_at, updatedAt: row.updated_at }; }
function normalizeMessage(row) { return { id: row.id, threadId: row.thread_id, senderId: row.sender_id, body: row.body ?? "", attachmentUrl: row.attachment_url ?? "", attachmentFilePath: row.attachment_file_path ?? "", attachmentName: row.attachment_name ?? "", attachmentType: row.attachment_type ?? "", attachmentSize: Number(row.attachment_size ?? 0), attachmentKind: row.attachment_kind ?? "", createdAt: row.created_at }; }
function getThreadPartnerId(thread) { if (!thread || !state.currentUser) return ""; return thread.userOneId === state.currentUser.id ? thread.userTwoId : thread.userOneId; }
function getThreadPartnerProfile(thread) { const partnerId = getThreadPartnerId(thread); return state.availableProfiles.find((profile) => profile.id === partnerId) ?? null; }
function normalizeMessengerListSearch(value) { return String(value ?? "").trim().toLowerCase(); }
function getFilteredPeopleProfiles() { const query = state.peopleSearch; if (!query) return state.availableProfiles; return state.availableProfiles.filter((profile) => { const haystack = [resolveMemberDisplayName(profile, ""), profile.displayName, profile.email, formatDisplayNameFromEmail(profile.email)].map((v) => String(v ?? "").toLowerCase()).join(" "); return haystack.includes(query); }); }
function getFilteredConversationThreads() { const query = state.conversationSearch; if (!query) return state.directThreads; return state.directThreads.filter((thread) => { const partner = getThreadPartnerProfile(thread); const haystack = [resolveMemberDisplayName(partner, ""), partner?.displayName, partner?.email, formatDisplayNameFromEmail(partner?.email)].map((v) => String(v ?? "").toLowerCase()).join(" "); return haystack.includes(query); }); }

function isThreadBlocked(thread) { if (!thread) return false; const partnerId = getThreadPartnerId(thread); return isUserBlocked(state, partnerId) || isUserBanned(state, partnerId); }
function getActiveThread() { return state.directThreads.find((thread) => thread.id === state.activeThreadId) ?? null; }
function sortThreads(threads) { return [...threads].sort((l, r) => new Date(r.updatedAt).getTime() - new Date(l.updatedAt).getTime()); }
function mergeThread(thread) { if (isThreadBlocked(thread)) return; const others = state.directThreads.filter((item) => item.id !== thread.id); state.directThreads = sortThreads([thread, ...others]); }
function mergeActiveMessage(message) { if (message.threadId !== state.activeThreadId) return; if (state.activeMessages.some((item) => item.id === message.id)) return; state.activeMessages = [...state.activeMessages, message].sort((l, r) => new Date(l.createdAt).getTime() - new Date(r.createdAt).getTime()); }
function canonicalizeThreadPair(l, r) { return [l, r].sort((a, b) => a.localeCompare(b)); }

async function syncCurrentProfileToSupabase(displayNameOverride = "") {
  const rawDisplayName = (displayNameOverride || state.profileRecord?.displayName || getDefaultProfileName()).trim().slice(0, 40);
  if (rawDisplayName.length < 2) throw new Error("Use a display name with at least 2 characters.");
  
  // Prepare payload
  const payload = { 
    id: state.currentUser.id, 
    email: getCurrentUserEmail(), 
    display_name: rawDisplayName
  };
  
  // Only add privacy columns if they are likely to exist or we want to try
  // We'll use a try-catch for the specific columns if they fail
  try {
    const fullPayload = {
      ...payload,
      notification_hide_sender: state.preferences.notificationHideSender,
      notification_hide_body: state.preferences.notificationHideBody
    };
    const { data, error } = await state.supabase.from("profiles").upsert(fullPayload, { onConflict: "id" }).select().single();
    if (error) {
      // If error suggests missing columns, fallback to basic payload
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
      // Sync DB preferences to local state
      updateUserPreferences({
        ...state.preferences,
        notificationHideSender: profile.notificationHideSender,
        notificationHideBody: profile.notificationHideBody
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

async function refreshMessengerState(options = {}) {
  const { preserveActiveThread = true, force = false } = options;
  if (!isMessagingEnabled(state)) { clearMessengerState(); renderMessenger(); return; }
  state.messengerBusy++;
  try {
    let ownProfile = await loadOwnProfileFromSupabase(); if (!ownProfile) ownProfile = await syncCurrentProfileToSupabase(getDefaultProfileName());
    const allSettled = Promise.allSettled ? Promise.allSettled.bind(Promise) : function(promises) { return Promise.all(promises.map(p => p.then(value => ({status: 'fulfilled', value}), reason => ({status: 'rejected', reason})))); };
    const [profilesResult, threadsResult, blocksResult, bansResult] = await allSettled([loadProfilesFromSupabase(), loadDirectThreadsFromSupabase(), loadBlockedUsersFromSupabase(), loadUserBansFromSupabase()]);
    if (profilesResult.status !== "fulfilled") throw profilesResult.reason; if (threadsResult.status !== "fulfilled") throw threadsResult.reason;
    let blocks = [], blockingAvailable = true; if (blocksResult.status === "fulfilled") blocks = blocksResult.value; else if (isBlockingBackendUnavailable(blocksResult.reason)) blockingAvailable = false; else throw blocksResult.reason;
    let bans = [], banningAvailable = true; if (bansResult.status === "fulfilled") bans = bansResult.value; else if (isBanningBackendUnavailable(bansResult.reason)) banningAvailable = false; else throw bansResult.reason;
    state.profileRecord = ownProfile; state.blockingAvailable = blockingAvailable; state.banningAvailable = banningAvailable; state.blockedUserIds = blocks.map((b) => b.blockedId); state.bannedUserIds = bans.map((b) => b.bannedId); state.availableProfiles = profilesResult.value.filter((p) => p.id !== state.currentUser.id); state.directThreads = sortThreads(threadsResult.value.filter((t) => !isThreadBlocked(t)));
    if (!preserveActiveThread || !state.directThreads.some((t) => t.id === state.activeThreadId)) state.activeThreadId = state.directThreads[0]?.id ?? null;
    if (state.activeThreadId) state.activeMessages = await loadMessagesFromSupabase(state.activeThreadId); else state.activeMessages = [];
    subscribeMessagingChannels({ force }); state.messengerError = "";
  } catch (error) { console.error("Messenger state could not be loaded", error); state.profileRecord = null; state.availableProfiles = []; state.blockedUserIds = []; state.bannedUserIds = []; state.blockingAvailable = true; state.banningAvailable = true; state.directThreads = []; state.activeThreadId = null; state.activeMessages = []; state.messengerError = formatBackendError(error) || "Messenger could not load for this account."; }
  finally { state.messengerBusy = Math.max(0, state.messengerBusy - 1); renderMessenger(); }
}

function unsubscribeMessagingChannels() {
  if (messengerRealtime) messengerRealtime.stop();
  if (state.threadsChannel) { state.threadsChannel.unsubscribe(); state.threadsChannel = null; }
  if (state.messagesChannel) { state.messagesChannel.unsubscribe(); state.messagesChannel = null; }
  if (state.likesChannel) { state.likesChannel.unsubscribe(); state.likesChannel = null; }
  try { state.supabase.removeAllChannels(); } catch (_error) {}
}



let isMessagingSubscribing = false;
let messengerRealtime = null;

async function subscribeMessagingChannels(options = {}) {
  const { force = false } = options;
  if (isMessagingSubscribing || (!force && state.threadsChannel && state.messagesChannel) || !isMessagingEnabled(state)) {
    if (!isMessagingEnabled(state)) unsubscribeMessagingChannels();
    return;
  }
  try {
    isMessagingSubscribing = true;
    unsubscribeMessagingChannels();
    
    // Initialize the new dedicated Realtime system
    if (!messengerRealtime) {
      messengerRealtime = new MessengerRealtime(state);
    }
    messengerRealtime.init();
    
    // Explicitly set the reference so the rest of the app knows we're live
    state.messagesChannel = messengerRealtime.channel;
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
      const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
      if (likedPost && likedPost.authorId === state.currentUser.id && window.notifications) {
        // Prevent spam by using a stable composite ID (one notification per person per post)
        const notificationId = `like-${like.post_id}-${like.user_id}`;
        const message = `Someone liked your post: ${likedPost.title || "Untitled"}`;
        
        window.notifications.success(message, "New Like!", { 
          id: notificationId,
          silent: isMobile // On mobile, add to history silently (no banner)
        });
      }
    }).subscribe();

  } catch (error) {
    console.error("[Messenger] Fatal Subscription Error:", error);
  } finally {
    isMessagingSubscribing = false;
  }
}


// Expose helpers globally for MessengerRealtime
// UI assignments moved to app-ui-v3.js

// Messenger logic moved to app-ui-v3.js

function updateComposerAccess() {
  const liveLocked = state.backendMode === "supabase" && !canPublishToLiveFeed(state);
  const lockedMessage = isCurrentUserBanned(state) ? "This account is banned from publishing to the live feed." : "Sign in with an activated account to publish to the live feed.";
  elements.postForm.querySelectorAll("input, textarea, button").forEach((element) => { if (element.id === "resetFormButton") { element.disabled = false; return; } element.disabled = liveLocked; });
  elements.dropzone.tabIndex = liveLocked ? -1 : 0; elements.dropzone.setAttribute("aria-disabled", liveLocked ? "true" : "false"); elements.dropzone.classList.toggle("is-disabled", liveLocked);
  if (liveLocked) { if (elements.formFeedback.textContent !== lockedMessage || !elements.formFeedback.classList.contains("is-error")) showFeedback(lockedMessage, true); return; }
  if (elements.formFeedback.textContent === lockedMessage) showFeedback("");
}

function setStatusPill(text, tone) { elements.authStatusPill.textContent = text; elements.authStatusPill.classList.remove("is-live", "is-warning"); if (tone === "live") elements.authStatusPill.classList.add("is-live"); if (tone === "warning") elements.authStatusPill.classList.add("is-warning"); }
function showAuthFeedback(message, isError = false) { elements.authFeedback.textContent = message; elements.authFeedback.classList.toggle("is-error", isError); }

// Preferences UI logic moved to app-ui-v3.js

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
function persistScopedPostIds(baseKey, ids, scope = getPersonalStateScope()) { const normalizedIds = Array.isArray(ids) ? ids.filter((v) => typeof v === "string" && v.trim()) : []; try { localStorage.setItem(getScopedStorageKey(baseKey, scope), JSON.stringify(normalizedIds)); if (scope === "guest") localStorage.removeItem(baseKey); } catch {} }

async function refreshLikedPostsState() {
  if (state.supabase && state.backendMode === "supabase" && state.currentUser) { try { state.likedPosts = await loadLikedPostsFromSupabase(); return; } catch (error) { console.error("Like state could not be loaded from Supabase", error); } }
  state.likedPosts = loadLikedPosts();
}

function isAdminRestrictedUploadKind(mediaKind) { return mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"; }
function canCurrentUserUploadMediaKind(mediaKind) { if (state.backendMode !== "supabase") return true; if (!isAdminRestrictedUploadKind(mediaKind)) return true; return isCurrentUserAdmin(); }
function getRestrictedUploadMessage(mediaKind) { if (mediaKind === "image") return "Only admin accounts can publish uploaded images to the live feed. YouTube and Spotify links stay open."; if (mediaKind === "video") return "Only admin accounts can publish uploaded videos to the live feed. YouTube links stay available to everyone."; if (mediaKind === "audio") return "Only admin accounts can publish uploaded audio to the live feed. Spotify and YouTube links stay open."; return "Only admin accounts can publish that upload type to the live feed."; }

function syncSourceHelp() { if (state.previewExternal?.provider) { updateSourceHelp(state.previewExternal.provider); return; } if (state.selectedFile) { updateSourceHelp("upload"); return; } if (elements.externalUrlInput.value.trim() && !state.previewExternal) { updateSourceHelp("invalid"); return; } updateSourceHelp("none"); }
function canDeletePost(post) { if (!post) return false; if (post.isLocal) return true; if (state.backendMode !== "supabase" || !state.currentUser) return false; return isCurrentUserAdmin() || post.authorId === state.currentUser.id; }
function getAuthRedirectUrl() { if (APP_CONFIG.authRedirectUrl) { try { return new URL(APP_CONFIG.authRedirectUrl).toString(); } catch (error) { console.warn("Configured auth redirect URL is invalid", error); } } if (/^https?:$/.test(window.location.protocol)) return new URL(window.location.pathname, window.location.origin).toString(); return DEFAULT_AUTH_REDIRECT_URL; }

function normalizeModerationText(value) { return String(value ?? "").toLowerCase().normalize("NFKC").replace(/['\u2019]+/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function getActiveBlockedTerms() { return [...DEFAULT_BLOCKED_TERMS]; }
function normalizePostModerationText(value) { return String(value ?? "").toLowerCase().normalize("NFKC").split("'").join("").split("’").join("").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function normalizePostModerationTextSafe(value) { const curlyApostrophe = String.fromCharCode(8217); return String(value ?? "").toLowerCase().normalize("NFKC").split("'").join("").split(curlyApostrophe).join("").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function findBlockedPostTerm({ creator = "", title = "", caption = "", tags = [] }) { const normalizedPostText = normalizePostModerationTextSafe([creator, title, caption, ...(Array.isArray(tags) ? tags : [])].join(" ")); if (!normalizedPostText) return ""; const haystack = ` ${normalizedPostText} `; return getActiveBlockedTerms().find((term) => { const normalizedTerm = normalizePostModerationTextSafe(term); return normalizedTerm && haystack.includes(` ${normalizedTerm} `); }) ?? ""; }
function isPostModerationError(error) { const message = formatBackendError(error).toLowerCase(); return message.includes("blocked language"); }
function getSiteSettingsPayload() { return { id: "global", shell_width: state.siteSettings.shellWidth, section_gap: state.siteSettings.sectionGap, surface_radius: state.siteSettings.surfaceRadius, media_fit: state.siteSettings.mediaFit, updated_at: new Date().toISOString() }; }
function normalizeSiteSettings(row = {}) { return { shellWidth: clampNumber(row.shell_width, 960, 1440, DEFAULT_SITE_SETTINGS.shellWidth), sectionGap: clampNumber(row.section_gap, 16, 40, DEFAULT_SITE_SETTINGS.sectionGap), surfaceRadius: clampNumber(row.surface_radius, 22, 44, DEFAULT_SITE_SETTINGS.surfaceRadius), mediaFit: row.media_fit === "contain" ? "contain" : DEFAULT_SITE_SETTINGS.mediaFit }; }
function clampNumber(value, min, max, fallback) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(max, Math.max(min, Math.round(numeric))); }

function normalizePlayerVolume(value, fallback = DEFAULT_PLAYER_VOLUME) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(1, Math.max(0, numeric)); }
// Moved to api-v3.js
function savePlayerVolume(volume) { try { localStorage.setItem(PLAYER_VOLUME_KEY, `${normalizePlayerVolume(volume)}`); } catch {} }
function savePlayerPosition(position) { try { if (!position) { localStorage.removeItem(PLAYER_POSITION_KEY); return; } localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })); } catch {} }
// Geometry helpers moved to app-ui-v3.js

// Viewport logic moved to app-ui-v3.js
// Settings applier moved to app-ui-v3.js
async function loadSiteSettingsFromSupabase() { const { data, error } = await state.supabase.from("site_settings").select("*").eq("id", "global").maybeSingle(); if (error) throw error; return data ? normalizeSiteSettings(data) : { ...DEFAULT_SITE_SETTINGS }; }
// Settings handlers moved to app-ui-v3.js
// Final UI rendering logic moved to app-ui-v3.js

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
function showFeedback(message, isError = false) { elements.formFeedback.textContent = message; elements.formFeedback.classList.toggle("is-error", isError); }
function resetComposer() { elements.postForm.reset(); clearSelectedMedia(); state.previewExternal = null; hydrateRememberedCreator(); updateSourceHelp("none"); showFeedback(""); }
function loadLikedPosts() { return loadScopedPostIds(LIKED_POSTS_KEY); }
// Moved to api-v3.js
function resolvePostSource(post) { if (post.src) return post.src; if (post.blob) { const url = URL.createObjectURL(post.blob); state.generatedUrls.push(url); return url; } return ""; }
function cleanupObjectUrls() { state.generatedUrls.forEach((url) => URL.revokeObjectURL(url)); state.generatedUrls = []; }
function getLikeCount(post) { if (canUseLiveLikesForPost(post)) return post.likes; return post.likes + (state.likedPosts.includes(post.id) ? 1 : 0); }
function formatKind(kind) { return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} post`; }
function getSignalLabel(post) { if (isFreshFeedPost(post)) return "Fresh in feed"; const likes = getLikeCount(post); if (likes >= 20) return "High signal"; if (likes >= 10) return "Building momentum"; return "Live on feed"; }
function isFreshFeedPost(post) { if (!post) return false; return isPostFromToday(post) || post.id === getLatestPostedPostId(); }
function isPostFromToday(post) { const postDate = new Date(post.createdAt); if (Number.isNaN(postDate.getTime())) return false; const today = new Date(); return postDate.getFullYear() === today.getFullYear() && postDate.getMonth() === today.getMonth() && postDate.getDate() === today.getDate(); }
function getLatestPostedPostId() { const posts = getAllPosts(); if (!posts.length) return ""; let latestPost = posts[0], latestTime = new Date(latestPost.createdAt).getTime(); for (const candidate of posts.slice(1)) { const candidateTime = new Date(candidate.createdAt).getTime(); if (!Number.isNaN(candidateTime) && (Number.isNaN(latestTime) || candidateTime > latestTime)) { latestPost = candidate; latestTime = candidateTime; } } return latestPost?.id ?? ""; }
function formatTimestamp(iso) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)); }
function formatFileSize(size) { if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function parseTags(raw) { return raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 6); }
function getMediaKind(type) { if (type.startsWith("image/")) return "image"; if (type.startsWith("video/")) return "video"; return "audio"; }
function clearSelectedMedia(options = {}) { const { preserveFeedback = false } = options; state.selectedFile = null; elements.mediaInput.value = ""; clearPreviewOnly(); if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ""; } if (!preserveFeedback) elements.formFeedback.classList.remove("is-error"); }
function clearViewerMedia() { elements.viewerStage.replaceChildren(); if (state.viewerUrl) { URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = ""; } }
function clearMiniPlayerMedia() { elements.miniPlayerStage.replaceChildren(); }
function resolveViewerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = URL.createObjectURL(post.blob); return state.viewerUrl; } return ""; }
function resolveActivePlayerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.activePlayerUrl) URL.revokeObjectURL(state.activePlayerUrl); state.activePlayerUrl = URL.createObjectURL(post.blob); return state.activePlayerUrl; } return ""; }

function destroyActivePlayer() {
  if (state.activePlayerElement instanceof HTMLElement) {
    const media = state.activePlayerElement.matches("video, audio") ? state.activePlayerElement : state.activePlayerElement.querySelector("video, audio");
    if (media instanceof HTMLMediaElement) { media.pause(); media.removeAttribute("src"); media.load(); }
    if (state.activePlayerElement instanceof HTMLIFrameElement) state.activePlayerElement.src = "about:blank";
    state.activePlayerElement.remove();
  }
  if (state.activePlayerUrl) { URL.revokeObjectURL(state.activePlayerUrl); state.activePlayerUrl = ""; }
  state.activePlayerElement = null; state.activePlayerPostId = null;
}

function compareByNewest(l, r) { return new Date(r.createdAt).getTime() - new Date(l.createdAt).getTime(); }
function getSpotlightPost(posts) { return [...posts].sort((l, r) => getLikeCount(r) - getLikeCount(l) || compareByNewest(l, r))[0]; }
function getPostById(id) { return getAllPosts().find((p) => p.id === id) ?? null; }
function isPostSaved(id) { return state.savedPosts.includes(id); }
function hydrateRememberedCreator() { const remembered = localStorage.getItem(CREATOR_NAME_KEY); if (remembered) elements.creatorInput.value = remembered; }
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
    // Aggressive YouTube detection: check ALL fields for a hint of YouTube (Syncing logic from MainActivity)
    const fields = [post.externalUrl, post.embedUrl, post.externalId, post.mediaUrl, post.src, post.label, post.caption, post.title].join(" ");
    const isYouTubeHint = post.sourceKind === "youtube" || fields.toLowerCase().includes("youtu") || fields.toLowerCase().includes("vnd.youtube");
    
    // Check if embedUrl is actually valid for YouTube
    const hasValidEmbed = typeof post.embedUrl === "string" && post.embedUrl.includes("youtube.com/embed/");
    
    if (isYouTubeHint && (!post.externalId || !hasValidEmbed)) {
      const repaired = parseYouTubeUrl(post.externalUrl || post.embedUrl || post.externalId || post.src || post.mediaUrl || post.label || post.caption || post.title || "");
      if (repaired) {
        return {
          ...post,
          externalId: repaired.externalId,
          embedUrl: repaired.embedUrl,
          src: repaired.embedUrl, // Sync src for player compatibility
          sourceKind: "youtube",
          mediaKind: "video",
          provider: "youtube"
        };
      }
    }
    return post;
  });
}

// parseYouTubeUrl is now imported from api-v3.js to ensure consistency across the app

function parseSpotifyUrl(raw) {
  let url; try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^open\./, "").replace(/^play\./, ""); if (host !== "spotify.com") return null;
  const segments = url.pathname.split("/").filter(Boolean); const allowed = ["track", "album", "playlist", "artist", "episode", "show"]; const [type, id] = segments;
  if (!allowed.includes(type) || !id) return null;
  return { provider: "spotify", mediaKind: "audio", externalId: id, embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`, originalUrl: raw, label: `Spotify ${type}` };
}

function formatProviderName(p) { return p.charAt(0).toUpperCase() + p.slice(1); }
function isHostedPostingEnabled() { return Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey && window.supabase); }

function getAppConfig() {
  const config = window.SIGNAL_SHARE_CONFIG ?? {};
  return {
    supabaseUrl: config.supabaseUrl?.trim() ?? "", supabaseAnonKey: config.supabaseAnonKey?.trim() ?? "", authRedirectUrl: config.authRedirectUrl?.trim() ?? "", postsTable: config.postsTable?.trim() || "posts", storageBucket: config.storageBucket?.trim() || "media", webPushPublicKey: config.webPushPublicKey?.trim() ?? "", notificationFunctionName: config.notificationFunctionName?.trim() || "send-message-notification", spotifyPreviewFunctionName: config.spotifyPreviewFunctionName?.trim() || "spotify-preview-metadata", adminEmails: Array.isArray(config.adminEmails) ? config.adminEmails.map((e) => normalizeEmailForMatch(e)).filter(Boolean) : [],
  };
}


function updatePostLikeCount(id, delta) { state.userPosts = state.userPosts.map((p) => p.id === id ? { ...p, likes: Math.max(0, (p.likes ?? 0) + delta) } : p); }



function createDemoGraphic({ title, subtitle, palette }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${palette[0]}" /><stop offset="52%" stop-color="${palette[1]}" /><stop offset="100%" stop-color="${palette[2]}" /></linearGradient></defs><rect width="1200" height="900" rx="50" fill="url(#bg)" /><circle cx="920" cy="180" r="140" fill="rgba(255,255,255,0.22)" /><circle cx="340" cy="660" r="210" fill="rgba(255,255,255,0.14)" /><rect x="92" y="92" width="1016" height="716" rx="34" fill="rgba(15,23,32,0.12)" stroke="rgba(255,255,255,0.35)" /><text x="124" y="300" fill="white" font-size="132" font-family="Georgia, serif">${title}</text><text x="126" y="386" fill="rgba(255,255,255,0.82)" font-size="40" font-family="Arial, sans-serif">${subtitle}</text><text x="126" y="734" fill="rgba(255,255,255,0.7)" font-size="32" font-family="Arial, sans-serif">Signal Share demo post</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}



function ensureOverlay() {
  let overlay = document.getElementById('ban-overlay');
  if (!overlay) {
    overlay = document.createElement('div'); overlay.id = 'ban-overlay'; overlay.className = 'ban-overlay';
    overlay.innerHTML = `<div style="position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 9999999; display: flex; align-items: center; justify-content: center; color: white; text-align: center; flex-direction: column;"><h2 style="font-size: 2rem; margin-bottom: 1rem;">You have been banned</h2><p style="font-size: 1.2rem; color: #ccc;">Sorry, you cannot use this app.</p></div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function showOverlay() { const overlay = ensureOverlay(); overlay.style.display = 'flex'; }
function hideOverlay() { const overlay = document.getElementById('ban-overlay'); if (overlay) overlay.style.display = 'none'; }
