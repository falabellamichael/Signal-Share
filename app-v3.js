import { createSupabaseClient, loadPostsFromSupabase, loadLikedPostsFromSupabase, publishPostToSupabase, compressImageFile, uploadFileToSupabase, uploadMessageAttachment, deleteHostedPost, normalizeSupabasePost, openDatabase, loadPostsFromDatabase, savePostToDatabase, deletePostFromDatabase, setApiContext } from './api-v3.js';



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
  motion: "full",
  statusBarStrip: true,
  notificationHideSender: false,
  notificationHideBody: false,
});
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
  notificationsLauncherButton: document.querySelector("#notificationsLauncherButton"),
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
  themeGrid: document.querySelector("#themeGrid"),
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

registerSiteServiceWorker();

// Global guard to ensure side-effects only run once
if (!window.__SIGNAL_SHARE_INITIALIZED__) {
  window.__SIGNAL_SHARE_INITIALIZED__ = true;
  
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

async function getSiteServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
  try {
    return await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("Service worker is not ready", error);
    return null;
  }
}

function getIncomingMessageNotificationTitle() {
  return DEFAULT_MESSAGE_NOTIFICATION_TITLE;
}

function shouldShowIncomingMessageNotification() {
  return document.hidden || !document.hasFocus();
}

async function showIncomingMessageNotification(message) {
  if (!canUseBrowserNotifications() || Notification.permission !== "granted") return;
  const notificationTitle = getIncomingMessageNotificationTitle();
  const notificationUrl = `${window.location.origin}${window.location.pathname}#messages`;
  const options = {
    icon: "./icons/icon-192.png?v=2",
    badge: "./icons/icon-192.png?v=2",
    tag: `message-${message.id}`,
    renotify: true,
    vibrate: [120, 50, 120],
    data: { url: notificationUrl, threadId: message.threadId },
  };
  try {
    const registration = await getSiteServiceWorkerRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(notificationTitle, options);
      return;
    }
  } catch (error) {
    console.error("Service worker notification failed", error);
  }
  try {
    new Notification(notificationTitle, options);
  } catch (error) {
    console.error("Browser notification failed", error);
  }
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
  
  if (elements.notificationsLauncherButton) elements.notificationsLauncherButton.addEventListener("click", toggleNotificationsPanel);
  if (elements.keyboardShortcutsButton) elements.keyboardShortcutsButton.addEventListener("click", () => window.showSettingsPage && window.showSettingsPage('shortcuts'));
  if (elements.notificationsBackdrop) elements.notificationsBackdrop.addEventListener("click", closeNotificationsPanel);
  if (elements.notificationsCloseButton) elements.notificationsCloseButton.addEventListener("click", closeNotificationsPanel);
  if (elements.clearNotificationsButton) elements.clearNotificationsButton.addEventListener("click", () => {
    if (window.notifications) window.notifications.clearHistory();
    renderNotificationsHistory();
  });
  elements.themeGrid.addEventListener("click", handleThemeOptionClick);
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
  document.addEventListener("click", handleExpandedMessengerOutsideClick);
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
    } else { clearMessengerState(); }
    render();
    return;
  }
  if (event === "SIGNED_IN") { state.pendingActivationEmail = ""; showAuthFeedback("Signed in successfully."); }
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

function render() {
  cleanupObjectUrls();
  state.visiblePostIds = getVisiblePosts().map((post) => post.id);
  renderStats();
  renderAccountState();
  renderMessenger();
  renderSettingsPanel();
  if (window.renderNotificationsPanel) window.renderNotificationsPanel();
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

function renderStats() {
  const posts = getAllPosts();
  const creators = new Set(posts.map((post) => getProfileKeyForPost(post)).filter(Boolean));
  const stats = { posts: posts.length, creators: creators.size };
  Object.entries(stats).forEach(([key, value]) => { const target = elements.statsPanel.querySelector(`[data-stat="${key}"]`); if (target) target.textContent = String(value); });
}

function renderAccountState() {
  syncProfileNavAvatar();
  const isLiveMode = state.backendMode === "supabase";
  const isSignedIn = Boolean(state.currentUser);
  const isActivated = isCurrentUserActivated();
  const pendingEmail = state.pendingActivationEmail || elements.authEmailInput.value.trim();
  elements.authForm.hidden = isSignedIn || !isLiveMode;
  elements.authAccount.hidden = !isSignedIn || !isLiveMode;
  elements.activationPanel.hidden = !isLiveMode || (!pendingEmail && (isSignedIn ? isActivated : true));
  if (!isLiveMode) {
    if (state.backendError) { setStatusPill("Setup failed", "warning"); elements.authStatusCopy.textContent = state.backendError; elements.authHint.textContent = "Supabase config is present, but startup failed. Rerun the SQL schema and confirm the live config file is deployed."; }
    else { setStatusPill("Local mode", ""); elements.authStatusCopy.textContent = "Connect Supabase to enable login and live posting."; elements.authHint.textContent = "You can still test the site locally without an account."; }
    elements.authForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
    elements.activationPanel.hidden = true;
    elements.authAccount.hidden = true;
    syncComposerCreatorWithAccount();
    return;
  }
  if (state.authRestoring) {
    setStatusPill("Restoring session", "warning"); elements.authStatusCopy.textContent = "Restoring your login session..."; elements.authHint.textContent = "This can take a moment on mobile after refresh.";
    elements.authForm.hidden = true; elements.authAccount.hidden = true; elements.activationPanel.hidden = true;
    syncComposerCreatorWithAccount();
    return;
  }
  elements.authForm.querySelectorAll("input, button").forEach((element) => { element.disabled = false; });
  if (!isSignedIn) {
    setStatusPill(pendingEmail ? "Activation pending" : "Signed out", pendingEmail ? "warning" : "");
    elements.authStatusCopy.textContent = pendingEmail ? `Activation email sent to ${pendingEmail}.` : "Sign in to publish to the shared feed.";
    elements.authHint.textContent = "Create an account once, confirm your email, then come back here to post live.";
    if (pendingEmail) { elements.activationTitle.textContent = "Check your inbox"; elements.activationMessage.textContent = `Open the activation email sent to ${pendingEmail}, then sign in here after confirming.`; }
    syncComposerCreatorWithAccount();
    return;
  }
  elements.accountEmail.textContent = state.currentUser.email ?? "Signed in";
  elements.accountMeta.textContent = isActivated ? (isCurrentUserAdmin() ? "Your account is active with admin privileges, including visual uploads and feed deletion." : "Your account is active and can publish YouTube and Spotify links.") : "Your account is signed in but still needs email activation.";
  elements.openOwnProfileButton.disabled = !getOwnProfileKey();
  if (isCurrentUserBanned(state)) {
    setStatusPill("Account banned", "warning"); elements.accountMeta.textContent = "This account is banned from posting and Direct Messenger."; elements.authStatusCopy.textContent = "Admin moderation has disabled this account."; elements.authHint.textContent = "You can still sign out, but publishing and messaging are unavailable.";
    elements.activationPanel.hidden = true;
  } else if (isActivated) {
    setStatusPill("Live account", "live"); elements.authStatusCopy.textContent = isCurrentUserAdmin() ? "Posting is active on the shared feed with full upload access." : "Posting is active on the shared feed for YouTube and Spotify links."; elements.authHint.textContent = isCurrentUserAdmin() ? "Uploads now publish to Supabase instead of only this browser." : "Uploaded images, videos, and audio are admin-only. YouTube and Spotify links are open to you.";
    elements.activationPanel.hidden = true;
  } else {
    setStatusPill("Awaiting activation", "warning"); elements.authStatusCopy.textContent = "Confirm your email before live posting is enabled."; elements.authHint.textContent = "Use the activation email from Supabase, then refresh this page.";
    elements.activationPanel.hidden = false; elements.activationTitle.textContent = "Activation still required"; elements.activationMessage.textContent = `Confirm ${state.currentUser.email ?? "your email"} to unlock live posting.`;
  }
  syncComposerCreatorWithAccount();
}

function clearMessengerState() {
  unsubscribeMessagingChannels();
  state.profileRecord = null; state.availableProfiles = []; state.blockedUserIds = []; state.bannedUserIds = []; state.blockingAvailable = true; state.banningAvailable = true; state.peopleSearch = ""; state.adminBanSearch = ""; state.conversationSearch = ""; state.directThreads = []; state.activeThreadId = null; state.activeMessages = []; state.pendingBlockUserId = ""; state.pendingBanUserId = ""; state.pendingDeleteThreadId = ""; state.adminBanPanelOpen = false; state.adminBanBusy = false; state.adminBanFeedback = ""; state.adminBanFeedbackIsError = false;  state.messengerBusy = 0; state.messengerError = "";
  state.listenersAttached = false;
  state.lastMessageSubmitTime = 0;
  clearMessageAttachmentSelection({ preserveFeedback: true });
}

function setMessengerStatus(text, tone = "") {
  elements.messengerStatusPill.textContent = text;
  elements.messengerStatusPill.classList.remove("is-live", "is-warning");
  if (tone === "live") elements.messengerStatusPill.classList.add("is-live");
  if (tone === "warning") elements.messengerStatusPill.classList.add("is-warning");
}

function renderMessengerDock() {
  const isMobileMessenger = isMobileMessengerViewport();
  elements.messengerLauncherButton.classList.toggle("is-hidden", state.messengerOpen);
  elements.messengerLauncherButton.setAttribute("aria-expanded", state.messengerOpen ? "true" : "false");
  elements.messengerSection.classList.toggle("is-open", state.messengerOpen);
  elements.messengerSection.classList.toggle("is-expanded", state.messengerExpanded);
  elements.messengerSection.setAttribute("aria-hidden", state.messengerOpen ? "false" : "true");
  elements.messengerSection.setAttribute("aria-expanded", state.messengerExpanded ? "true" : "false");
  elements.messengerExpandButton.hidden = isMobileMessenger;
  elements.messengerExpandButton.disabled = isMobileMessenger;
  elements.messengerExpandButton.setAttribute("aria-expanded", state.messengerExpanded ? "true" : "false");
  elements.messengerExpandButton.setAttribute("aria-label", state.messengerExpanded ? "Collapse Direct Messenger" : "Expand Direct Messenger");
  elements.messengerExpandButton.classList.toggle("is-collapsing", state.messengerExpanded);
  elements.messagesNavLink.setAttribute("aria-expanded", state.messengerOpen ? "true" : "false");
}

function syncMessengerDockScrollState() {
  if (!state.messengerExpanded) return;
  window.requestAnimationFrame(() => { if (!state.messengerExpanded) return; elements.messengerSection.scrollTop = 0; elements.messengerSection.scrollLeft = 0; });
}

function renderMessenger() {
  const isLiveMode = state.backendMode === "supabase";
  const isSignedIn = Boolean(state.currentUser);
  const isActivated = isCurrentUserActivated();
  const isReady = isMessagingEnabled(state);
  renderMessengerDock();
  syncMessengerDockScrollState();
  elements.profileDisplayNameInput.disabled = !isReady || state.messengerBusy;
  elements.saveProfileButton.disabled = !isReady || state.messengerBusy;
  elements.peopleSearchInput.disabled = !isReady;
  elements.conversationSearchInput.disabled = !isReady;
  if (document.activeElement !== elements.peopleSearchInput) elements.peopleSearchInput.value = state.peopleSearch;
  if (document.activeElement !== elements.conversationSearchInput) elements.conversationSearchInput.value = state.conversationSearch;
  elements.messageInput.disabled = !isReady || !state.activeThreadId || state.messengerBusy;
  elements.messageAttachmentInput.disabled = !isReady || !state.activeThreadId || state.messengerBusy;
  elements.messageEmojiButton.disabled = !isReady || !state.activeThreadId || state.messengerBusy;
  elements.messageAttachButton.disabled = !isReady || !state.activeThreadId || state.messengerBusy;
  elements.messageAttachmentClearButton.disabled = !isReady || state.messengerBusy;
  elements.sendMessageButton.disabled = !isReady || !state.activeThreadId || state.messengerBusy;
  if (elements.messageEmojiButton.disabled) state.messageEmojiPickerOpen = false;
  renderMessageEmojiPanel();
  renderMessageAttachmentPreview();
  if (!isLiveMode) { setMessengerStatus("Offline", "warning"); elements.messengerStatusCopy.textContent = "Messenger needs Supabase, signed-in accounts, and the chat tables enabled."; }
  else if (!isSignedIn) { setMessengerStatus("Signed out", "warning"); elements.messengerStatusCopy.textContent = "Sign in to message other members."; }
  else if (!isActivated) { setMessengerStatus("Activation required", "warning"); elements.messengerStatusCopy.textContent = "Confirm your email before live messaging is enabled."; }
  else if (isCurrentUserBanned(state)) { setMessengerStatus("Account banned", "warning"); elements.messengerStatusCopy.textContent = "Direct Messenger is disabled for this account."; }
  else if (state.messengerError) { setMessengerStatus("Sync issue: " + state.messengerError, "warning"); elements.messengerStatusCopy.textContent = state.messengerError; }
  else if (state.messengerBusy && state.directThreads.length === 0) { setMessengerStatus("Loading", "warning"); elements.messengerStatusCopy.textContent = "Preparing your inbox and member directory."; }
  else { setMessengerStatus("Live inbox", "live"); elements.messengerStatusCopy.textContent = "Direct messages sync live while you stay signed in."; }
  if (document.activeElement !== elements.profileDisplayNameInput) elements.profileDisplayNameInput.value = state.profileRecord?.displayName ?? getDefaultProfileName();
  renderPeopleList(isReady);
  renderConversationList(isReady);
  renderActiveThread(isReady);
}

function focusMessengerPrimaryControl() {
  if (!elements.messageInput.disabled && state.activeThreadId) { elements.messageInput.focus(); return; }
  if (!elements.profileDisplayNameInput.disabled) { elements.profileDisplayNameInput.focus(); return; }
  if (!elements.messengerExpandButton.hidden && !elements.messengerExpandButton.disabled) { elements.messengerExpandButton.focus(); return; }
  if (!elements.messengerMinimizeButton.disabled) { elements.messengerMinimizeButton.focus(); return; }
  elements.messengerExpandButton.focus();
}

function openMessengerDock({ expanded = false, focusPrimaryControl = false } = {}) {
  if (window.notifications) window.notifications.setUnreadCount(0);
  const nextExpanded = resolveMessengerExpandedState(expanded);
  if (!state.messengerOpen || state.messengerExpanded !== nextExpanded) { state.messengerOpen = true; state.messengerExpanded = nextExpanded; renderMessenger(); }
  if (focusPrimaryControl) focusMessengerPrimaryControl();
}

function collapseMessengerDock() {
  if (!state.messengerOpen || !state.messengerExpanded) return;
  state.messengerExpanded = false; renderMessenger();
  if (!elements.messengerExpandButton.hidden && !elements.messengerExpandButton.disabled) elements.messengerExpandButton.focus(); else elements.messengerMinimizeButton.focus();
}

function closeMessengerDock(options = {}) {
  const { restoreFocus = true } = options;
  if (!state.messengerOpen) return;
  state.messengerOpen = false; state.messengerExpanded = false; state.messageEmojiPickerOpen = false;
  renderMessenger();
  if (restoreFocus) elements.messengerLauncherButton.focus();
}

function toggleMessengerExpansion() {
  if (isMobileMessengerViewport()) { openMessengerDock({ focusPrimaryControl: true }); return; }
  if (!state.messengerOpen) { openMessengerDock({ expanded: true, focusPrimaryControl: true }); return; }
  if (state.messengerExpanded) { collapseMessengerDock(); return; }
  openMessengerDock({ expanded: true, focusPrimaryControl: true });
}

function handleMessengerLauncherClick() {
  void ensurePushNotificationRegistration({ prompt: true });
  void refreshMessengerState({ preserveActiveThread: true, force: true });
  openMessengerDock({ expanded: false, focusPrimaryControl: true });
}

function handleMessagesNavClick(event) {
  event.preventDefault(); void ensurePushNotificationRegistration({ prompt: true }); void refreshMessengerState({ preserveActiveThread: true, force: true }); openMessengerDock({ expanded: false, focusPrimaryControl: true });
}

function handleMessengerMinimizeClick() {
  if (isMobileMessengerViewport() || state.messengerExpanded) closeMessengerDock(); else closeMessengerDock();
}

function handleExpandedMessengerOutsideClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !document.contains(target)) return;
  if (state.messageEmojiPickerOpen && !target.closest("#messageEmojiPanel") && !target.closest("#messageEmojiButton")) closeMessageEmojiPicker();
  if (state.adminBanPanelOpen && !target.closest("#adminBanPanel") && !target.closest("#adminBanLauncherButton")) closeAdminBanPanel({ restoreFocus: false });
  if (!state.messengerExpanded) return;
  if (target.closest("#messages") || target.closest("#messengerLauncherButton") || target.closest("#messagesNavLink") || target.closest("#settingsPanel") || target.closest("#notificationsPanel") || target.closest("#keyboardShortcutsPanel") || target.closest("#viewer")) return;
  collapseMessengerDock();
}

function renderAdminBanPanel() {
  const canAccess = canAccessAdminBanPanel(state);
  if (!canAccess) {
    state.adminBanPanelOpen = false; elements.adminBanLauncherButton.hidden = true; elements.adminBanPanel.hidden = true; elements.adminBanPanel.classList.remove("is-open"); elements.adminBanPanel.setAttribute("aria-hidden", "true"); elements.adminBanLauncherButton.setAttribute("aria-expanded", "false"); return;
  }
  elements.adminBanLauncherButton.hidden = false; elements.adminBanLauncherButton.classList.toggle("is-hidden", state.adminBanPanelOpen); elements.adminBanLauncherButton.setAttribute("aria-expanded", state.adminBanPanelOpen ? "true" : "false"); elements.adminBanPanel.hidden = !state.adminBanPanelOpen; elements.adminBanPanel.classList.toggle("is-open", state.adminBanPanelOpen); elements.adminBanPanel.setAttribute("aria-hidden", state.adminBanPanelOpen ? "false" : "true"); elements.adminBanSearchInput.disabled = state.adminBanBusy || !state.banningAvailable; elements.adminBanRefreshButton.disabled = state.adminBanBusy; elements.adminBanCloseButton.disabled = state.adminBanBusy;
  if (document.activeElement !== elements.adminBanSearchInput) elements.adminBanSearchInput.value = state.adminBanSearch;
  elements.adminBanFeedback.textContent = state.adminBanFeedback; elements.adminBanFeedback.classList.toggle("is-error", state.adminBanFeedbackIsError);
  renderAdminBanList();
}

function renderAdminBanList() {
  elements.adminBanList.innerHTML = "";
  if (!state.banningAvailable) { elements.adminBanEmpty.hidden = false; elements.adminBanEmpty.textContent = "Run the latest Supabase schema to enable account bans."; return; }
  const profiles = getFilteredAdminBanProfiles();
  if (state.availableProfiles.length === 0) { elements.adminBanEmpty.hidden = false; elements.adminBanEmpty.textContent = state.adminBanBusy ? "Loading members..." : "No members are available to ban yet."; return; }
  if (profiles.length === 0) { elements.adminBanEmpty.hidden = false; elements.adminBanEmpty.textContent = "No members match this search."; return; }
  elements.adminBanEmpty.hidden = true;
  profiles.forEach((profile) => {
    const displayName = resolveMemberDisplayName(profile); const banned = isUserBanned(state, profile.id); const item = document.createElement("div"); item.className = "admin-ban-item"; if (banned) item.classList.add("is-banned");
    const row = document.createElement("div"); row.className = "admin-ban-row"; const copy = document.createElement("div"); copy.className = "admin-ban-member";
    const name = document.createElement("strong"); name.textContent = displayName; const meta = document.createElement("span"); meta.textContent = banned ? `${profile.email} - Banned` : profile.email;
    copy.append(name, meta); const actionButton = document.createElement("button"); actionButton.type = "button"; actionButton.className = banned ? "button button-secondary admin-ban-unban" : "button admin-ban-action"; actionButton.textContent = banned ? "Unban" : "Ban"; actionButton.disabled = state.adminBanBusy; actionButton.addEventListener("click", (event) => { event.stopPropagation(); state.pendingBanUserId = state.pendingBanUserId === profile.id ? "" : profile.id; renderAdminBanPanel(); });
    row.append(copy, actionButton); item.appendChild(row);
    if (state.pendingBanUserId === profile.id) {
      const prompt = document.createElement("div"); prompt.className = "admin-ban-prompt conversation-delete-prompt";
      const promptLabel = document.createElement("span"); promptLabel.textContent = banned ? `Unban ${displayName}?` : `Ban ${displayName}?`;
      const promptActions = document.createElement("div"); promptActions.className = "admin-ban-prompt-actions conversation-delete-actions";
      const confirmButton = document.createElement("button"); confirmButton.type = "button"; confirmButton.className = "button conversation-delete-confirm"; confirmButton.textContent = "Yes"; confirmButton.disabled = state.adminBanBusy; confirmButton.addEventListener("click", (event) => { event.stopPropagation(); void toggleUserBan(profile); });
      const cancelButton = document.createElement("button"); cancelButton.type = "button"; cancelButton.className = "button button-secondary conversation-delete-cancel"; cancelButton.textContent = "No"; cancelButton.disabled = state.adminBanBusy; cancelButton.addEventListener("click", (event) => { event.stopPropagation(); state.pendingBanUserId = ""; renderAdminBanPanel(); });
      promptActions.append(confirmButton, cancelButton); prompt.append(promptLabel, promptActions); item.appendChild(prompt);
    }
    elements.adminBanList.appendChild(item);
  });
}

function getFilteredAdminBanProfiles() {
  const query = state.adminBanSearch;
  const profiles = state.availableProfiles.filter((profile) => profile.id !== state.currentUser?.id);
  if (!query) return profiles;
  return profiles.filter((profile) => { const haystack = [resolveMemberDisplayName(profile), profile.email, isUserBanned(state, profile.id) ? "banned" : "active"].join(" ").toLowerCase(); return haystack.includes(query); });
}

function showAdminBanFeedback(message, isError = false) { state.adminBanFeedback = message; state.adminBanFeedbackIsError = isError; renderAdminBanPanel(); }

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

let lastPeopleRenderKey = "";
function renderPeopleList(isReady) {
  const currentKey = `${isReady}-${state.availableProfiles.length}-${state.peopleSearch}-${state.messengerBusy}-${state.blockedUserIds.length}-${state.bannedUserIds.length}-${state.pendingBlockUserId}`;
  if (currentKey === lastPeopleRenderKey) return;
  lastPeopleRenderKey = currentKey;
  elements.peopleList.innerHTML = ""; const canRevealEmails = canRevealMemberEmails(); const visibleProfiles = getFilteredPeopleProfiles();
  if (!isReady) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "Sign in with an activated account to see other members."; return; }
  if (state.availableProfiles.length === 0) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "No other members are visible yet. Another signed-in user needs to join first."; return; }
  if (visibleProfiles.length === 0) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "No people match this search."; return; }
  elements.peopleEmpty.hidden = true;
  visibleProfiles.forEach((profile) => {
    const displayName = resolveMemberDisplayName(profile); const blocked = isUserBlocked(state, profile.id); const banned = isUserBanned(state, profile.id); const item = document.createElement("div"); item.className = "person-item"; const row = document.createElement("div"); row.className = "person-row"; const button = document.createElement("button"); button.type = "button"; button.className = "person-button"; if (blocked || banned) button.classList.add("is-blocked"); button.disabled = blocked || banned || state.messengerBusy;
    const name = document.createElement("strong"); name.textContent = displayName; const meta = document.createElement("span"); meta.textContent = canRevealEmails ? profile.email : "Member"; const action = document.createElement("span"); action.className = "person-action"; action.textContent = banned ? "Banned" : (blocked ? "Blocked" : "Message");
    button.append(name, meta, action); button.addEventListener("click", () => { state.pendingBlockUserId = ""; void openOrCreateThread(profile.id); });
    const blockButton = document.createElement("button"); blockButton.type = "button"; blockButton.className = "person-block-button"; if (blocked) blockButton.classList.add("is-blocked"); blockButton.setAttribute("aria-label", `${blocked ? "Unblock" : "Block"} ${displayName}`); blockButton.title = state.blockingAvailable ? `${blocked ? "Unblock" : "Block"} ${displayName}` : "Blocking needs the latest Supabase messenger schema."; blockButton.disabled = state.messengerBusy || !state.blockingAvailable || banned; blockButton.innerHTML = '<svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" stroke-width="1.75"></circle><path d="M8.5 15.5 15.5 8.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.75"></path></svg>'; blockButton.addEventListener("click", (event) => { event.stopPropagation(); state.pendingDeleteThreadId = ""; state.pendingBlockUserId = state.pendingBlockUserId === profile.id ? "" : profile.id; renderMessenger(); });
    row.append(button, blockButton); item.appendChild(row);
    if (state.pendingBlockUserId === profile.id) {
      const prompt = document.createElement("div"); prompt.className = "person-block-prompt conversation-delete-prompt";
      const promptLabel = document.createElement("span"); promptLabel.textContent = blocked ? `Unblock ${displayName}?` : `Block ${displayName}?`;
      const promptActions = document.createElement("div"); promptActions.className = "person-block-actions conversation-delete-actions";
      const confirmButton = document.createElement("button"); confirmButton.type = "button"; confirmButton.className = "button person-block-confirm conversation-delete-confirm"; confirmButton.textContent = "Yes"; confirmButton.disabled = state.messengerBusy; confirmButton.addEventListener("click", () => void toggleProfileBlock(profile));
      const cancelButton = document.createElement("button"); cancelButton.type = "button"; cancelButton.className = "button button-secondary person-block-cancel conversation-delete-cancel"; cancelButton.textContent = "No"; cancelButton.disabled = state.messengerBusy; cancelButton.addEventListener("click", () => { state.pendingBlockUserId = ""; renderMessenger(); });
      promptActions.append(confirmButton, cancelButton); prompt.append(promptLabel, promptActions); item.appendChild(prompt);
    }
    elements.peopleList.appendChild(item);
  });
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

let lastConversationRenderKey = "";
function renderConversationList(isReady) {
  const threadsHash = state.directThreads.map(t => `${t.id}-${t.lastMessageBody?.slice(0, 10)}`).join("|");
  const currentKey = `${isReady}-${state.activeThreadId}-${state.conversationSearch}-${state.messengerBusy}-${state.pendingDeleteThreadId}-${threadsHash}`;
  if (currentKey === lastConversationRenderKey) return;
  lastConversationRenderKey = currentKey;
  elements.conversationList.innerHTML = ""; const visibleThreads = getFilteredConversationThreads();
  if (!isReady) { elements.conversationEmpty.hidden = false; elements.conversationEmpty.textContent = "Your inbox appears here after you sign in."; return; }
  if (state.directThreads.length === 0) { elements.conversationEmpty.hidden = false; elements.conversationEmpty.textContent = "Start a new conversation from the member list."; return; }
  if (visibleThreads.length === 0) { elements.conversationEmpty.hidden = false; elements.conversationEmpty.textContent = "No conversations match this search."; return; }
  elements.conversationEmpty.hidden = true;
  visibleThreads.forEach((thread) => {
    const partner = getThreadPartnerProfile(thread); const item = document.createElement("div"); item.className = "conversation-item"; const row = document.createElement("div"); row.className = "conversation-row"; const button = document.createElement("button"); button.type = "button"; button.className = "conversation-button"; if (thread.id === state.activeThreadId) button.classList.add("is-active");
    const name = document.createElement("strong"); name.textContent = resolveMemberDisplayName(partner, "Unknown member"); const meta = document.createElement("span"); meta.textContent = `Updated ${formatMessageTimestamp(thread.updatedAt)}`;
    button.append(name, meta); button.addEventListener("click", () => { state.pendingBlockUserId = ""; state.pendingDeleteThreadId = ""; void openExistingThread(thread.id); });
    const deleteButton = document.createElement("button"); deleteButton.type = "button"; deleteButton.className = "conversation-delete-button"; deleteButton.textContent = "x"; deleteButton.setAttribute("aria-label", `Delete conversation with ${resolveMemberDisplayName(partner, "member")}`); deleteButton.disabled = state.messengerBusy; deleteButton.addEventListener("click", (event) => { event.stopPropagation(); state.pendingBlockUserId = ""; state.pendingDeleteThreadId = state.pendingDeleteThreadId === thread.id ? "" : thread.id; renderMessenger(); });
    row.append(button, deleteButton); item.appendChild(row);
    if (state.pendingDeleteThreadId === thread.id) {
      const prompt = document.createElement("div"); prompt.className = "conversation-delete-prompt";
      const promptLabel = document.createElement("span"); promptLabel.textContent = "Delete Conversation?";
      const promptActions = document.createElement("div"); promptActions.className = "conversation-delete-actions";
      const confirmButton = document.createElement("button"); confirmButton.type = "button"; confirmButton.className = "button conversation-delete-confirm"; confirmButton.textContent = "Yes"; confirmButton.disabled = state.messengerBusy; confirmButton.addEventListener("click", () => void deleteConversation(thread.id));
      const cancelButton = document.createElement("button"); cancelButton.type = "button"; cancelButton.className = "button button-secondary conversation-delete-cancel"; cancelButton.textContent = "No"; cancelButton.disabled = state.messengerBusy; cancelButton.addEventListener("click", () => { state.pendingDeleteThreadId = ""; renderMessenger(); });
      promptActions.append(confirmButton, cancelButton); prompt.append(promptLabel, promptActions); item.appendChild(prompt);
    }
    elements.conversationList.appendChild(item);
  });
}

function renderActiveThread(isReady) {
  const activeThread = getActiveThread();
  const partner = activeThread ? getThreadPartnerProfile(activeThread) : null;
  
  if (!isReady) {
    elements.activeThreadLabel.textContent = "Sign in to open inbox";
    elements.activeThreadMeta.textContent = "Live messaging is available only for activated accounts.";
    elements.messageList.innerHTML = "";
    elements.messageEmpty.hidden = false;
    elements.messageEmpty.textContent = "Messaging stays disabled until you sign in and confirm your email.";
    return;
  }
  
  if (!activeThread) {
    elements.activeThreadLabel.textContent = "Choose a member";
    elements.activeThreadMeta.textContent = "Start a direct conversation from the member list.";
    elements.messageList.innerHTML = "";
    elements.messageEmpty.hidden = false;
    elements.messageEmpty.textContent = "Open a conversation to start messaging.";
    return;
  }

  elements.activeThreadLabel.textContent = resolveMemberDisplayName(partner, "Unknown member");
  elements.activeThreadMeta.textContent = "Live direct message";

  if (state.activeMessages.length === 0) {
    elements.messageList.innerHTML = "";
    elements.messageEmpty.hidden = false;
    elements.messageEmpty.textContent = "No messages yet. Send the first one.";
    return;
  }

  elements.messageEmpty.hidden = true;
  
  // Surgical update: Only append messages that aren't already in the DOM
  const existingRows = Array.from(elements.messageList.querySelectorAll(".message-row"));
  const existingIds = new Set(existingRows.map(row => row.dataset.id).filter(Boolean));

  // If the thread has changed entirely, or the list is empty, clear it once
  if (elements.messageList.dataset.currentThreadId !== activeThread.id) {
    elements.messageList.innerHTML = "";
    elements.messageList.dataset.currentThreadId = activeThread.id;
    existingIds.clear();
  }

  state.activeMessages.forEach((message) => {
    if (existingIds.has(message.id)) return;

    const row = document.createElement("div");
    row.className = "message-row";
    row.dataset.id = message.id; // Store ID for idempotency
    if (message.senderId === state.currentUser?.id) row.classList.add("is-self");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    const senderLabel = getMessageSenderLabel(message, partner);

    if (message.attachmentUrl) bubble.appendChild(createMessageAttachmentNode(message, senderLabel));

    const body = document.createElement("p");
    body.textContent = message.body ?? "";
    body.hidden = !message.body;

    const meta = document.createElement("span");
    meta.textContent = `${senderLabel} / ${formatMessageTimestamp(message.createdAt)}`;

    bubble.append(body, meta);
    row.appendChild(bubble);
    elements.messageList.appendChild(row);
    
    // Auto-scroll on new message
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  });
}

function showProfileFeedback(message, isError = false) { elements.profileFeedback.textContent = message; elements.profileFeedback.classList.toggle("is-error", isError); }
function showMessengerFeedback(message, isError = false) { elements.messengerFeedback.textContent = message; elements.messengerFeedback.classList.toggle("is-error", isError); }
function renderMessageEmojiPanel() { const isOpen = state.messageEmojiPickerOpen && !elements.messageEmojiButton.disabled; elements.messageEmojiPanel.hidden = !isOpen; elements.messageEmojiButton.setAttribute("aria-expanded", isOpen ? "true" : "false"); elements.messageForm.classList.toggle("is-emoji-open", isOpen); elements.messengerSection.classList.toggle("is-emoji-picker-open", isOpen); }
function toggleMessageEmojiPicker() { if (elements.messageEmojiButton.disabled) return; state.messageEmojiPickerOpen = !state.messageEmojiPickerOpen; renderMessageEmojiPanel(); if (!state.messageEmojiPickerOpen) elements.messageInput.focus(); }
function closeMessageEmojiPicker(options = {}) { const { restoreFocus = false } = options; if (!state.messageEmojiPickerOpen) return; state.messageEmojiPickerOpen = false; renderMessageEmojiPanel(); if (restoreFocus && !elements.messageInput.disabled) elements.messageInput.focus(); }
function handleMessageEmojiPanelClick(event) { const button = event.target instanceof Element ? event.target.closest("[data-emoji]") : null; if (!(button instanceof HTMLButtonElement)) return; insertEmojiIntoMessage(button.dataset.emoji ?? ""); }
function insertEmojiIntoMessage(emoji) { if (!emoji || elements.messageInput.disabled) return; const start = elements.messageInput.selectionStart ?? elements.messageInput.value.length; const end = elements.messageInput.selectionEnd ?? start; const currentValue = elements.messageInput.value; elements.messageInput.value = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`; const caretPosition = start + emoji.length; elements.messageInput.focus(); elements.messageInput.setSelectionRange(caretPosition, caretPosition); closeMessageEmojiPicker(); }
function handleMessageAttachmentInputChange(event) { const [file] = Array.from(event.target.files ?? []); if (!file) { clearMessageAttachmentSelection(); return; } handleMessageAttachmentSelection(file); }
function handleMessageAttachmentSelection(file) { 
  const kind = getMessageAttachmentKind(file.type);
  const sizeLimit = kind === "image" ? MAX_IMAGE_FILE_SIZE : MAX_VIDEO_FILE_SIZE;
  if (file.size > sizeLimit) { showMessengerFeedback(`Choose an attachment smaller than ${kind === "image" ? "50 MB" : "15 MB"}.`, true); clearMessageAttachmentSelection({ preserveFeedback: true }); return; } 
  clearMessageAttachmentSelection({ preserveFeedback: true }); 
  state.messageAttachmentFile = file; 
  if (kind !== "file") state.messageAttachmentPreviewUrl = URL.createObjectURL(file); 
  showMessengerFeedback(`${file.name} is ready to send.`); 
  renderMessageAttachmentPreview(); 
}
function clearMessageAttachmentSelection(options = {}) { const { preserveFeedback = false } = options; if (state.messageAttachmentPreviewUrl) { URL.revokeObjectURL(state.messageAttachmentPreviewUrl); state.messageAttachmentPreviewUrl = ""; } state.messageAttachmentFile = null; elements.messageAttachmentInput.value = ""; elements.messageAttachmentPreview.hidden = true; elements.messageAttachmentPreview.replaceChildren(); elements.messageAttachmentClearButton.hidden = true; if (!preserveFeedback && elements.messengerFeedback.textContent.includes("ready to send")) showMessengerFeedback(""); }
function renderMessageAttachmentPreview() { elements.messageAttachmentPreview.replaceChildren(); const file = state.messageAttachmentFile; const hasAttachment = Boolean(file); elements.messageAttachmentPreview.hidden = !hasAttachment; elements.messageAttachmentClearButton.hidden = !hasAttachment; if (!file) return; const card = document.createElement("div"); card.className = "message-attachment-card is-preview"; card.appendChild(createMessageAttachmentPreviewNode(file)); elements.messageAttachmentPreview.appendChild(card); }
function getMessageSenderLabel(message, partner) { if (message.senderId === state.currentUser?.id) return "You"; return resolveMemberDisplayName(partner, "Member"); }
function createMessageAttachmentPreviewNode(file) {
  const kind = getMessageAttachmentKind(file.type);
  if (kind === "image") { const image = document.createElement("img"); image.className = "message-attachment-media"; image.src = state.messageAttachmentPreviewUrl; image.alt = file.name; return image; }
  if (kind === "video") { const video = document.createElement("video"); video.className = "message-attachment-media"; video.src = state.messageAttachmentPreviewUrl; video.controls = true; video.preload = "metadata"; video.playsInline = true; return video; }
  if (kind === "audio") { const audio = document.createElement("audio"); audio.className = "message-attachment-audio"; audio.src = state.messageAttachmentPreviewUrl; audio.controls = true; audio.preload = "metadata"; return audio; }
  return createMessageFileNode({ attachmentName: file.name, attachmentType: file.type, attachmentSize: file.size, attachmentUrl: "" });
}
function createMessageAttachmentNode(message, senderLabel) {
  const kind = message.attachmentKind ?? "file";
  if (kind === "image") return createMessageAttachmentTrigger(message, senderLabel, "image");
  if (kind === "video") return createMessageAttachmentTrigger(message, senderLabel, "video");
  if (kind === "audio") { const audio = document.createElement("audio"); audio.className = "message-attachment-audio"; audio.src = message.attachmentUrl; audio.controls = true; audio.preload = "metadata"; return audio; }
  return createMessageFileNode(message);
}
function createMessageAttachmentTrigger(message, senderLabel, kind) {
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "message-attachment-trigger"; trigger.setAttribute("aria-label", `Open ${kind}`); trigger.title = `Open ${kind}`; trigger.addEventListener("click", () => openMessageAttachmentViewer(message, senderLabel, trigger));
  if (kind === "image") { const image = document.createElement("img"); image.className = "message-attachment-media"; image.src = message.attachmentUrl; image.alt = message.attachmentName || "Shared image"; image.loading = "lazy"; trigger.appendChild(image); return trigger; }
  const video = document.createElement("video"); video.className = "message-attachment-media"; video.src = message.attachmentUrl; video.preload = "metadata"; video.playsInline = true; video.muted = true; video.setAttribute("aria-hidden", "true"); trigger.appendChild(video);
  const badge = document.createElement("span"); badge.className = "message-attachment-open-label"; badge.textContent = "Open video"; trigger.appendChild(badge); return trigger;
}
function openMessageAttachmentViewer(message, senderLabel, returnFocusElement) {
  const kind = message.attachmentKind ?? ""; if ((kind !== "image" && kind !== "video") || !message.attachmentUrl) return;
  if (state.activeProfileKey) closeProfile({ restoreFocus: false });
  state.viewerPostId = null; state.viewerAttachment = { kind, url: message.attachmentUrl, title: message.attachmentName || (kind === "video" ? "Shared video" : "Shared image"), caption: message.body?.trim() || "Shared in Direct Messenger.", creator: senderLabel || "Member", createdAt: message.createdAt };
  state.returnFocusElement = returnFocusElement ?? document.activeElement; renderViewer(); elements.viewerCloseButton.focus();
}
function createMessageFileNode(message) {
  const link = document.createElement("a"); link.className = "message-file"; if (message.attachmentUrl) { link.href = message.attachmentUrl; link.target = "_blank"; link.rel = "noreferrer"; }
  const title = document.createElement("strong"); title.textContent = message.attachmentName || "Attached file";
  const meta = document.createElement("span"); const fileParts = []; if (message.attachmentType) fileParts.push(formatAttachmentTypeLabel(message.attachmentType)); if (Number.isFinite(message.attachmentSize) && message.attachmentSize > 0) fileParts.push(formatFileSize(message.attachmentSize)); meta.textContent = fileParts.join(" / ") || "Open file";
  link.append(title, meta); return link;
}
function getMessageAttachmentKind(type = "") { if (type.startsWith("image/")) return "image"; if (type.startsWith("video/")) return "video"; if (type.startsWith("audio/")) return "audio"; return "file"; }
function formatAttachmentTypeLabel(type = "") { if (!type) return "File"; const [major, minor] = type.split("/"); if (!minor) return major.charAt(0).toUpperCase() + major.slice(1); return `${major.charAt(0).toUpperCase() + major.slice(1)} ${minor.toUpperCase()}`; }
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
  const payload = { 
    id: state.currentUser.id, 
    email: getCurrentUserEmail(), 
    display_name: rawDisplayName,
    notification_hide_sender: state.preferences.notificationHideSender,
    notification_hide_body: state.preferences.notificationHideBody
  };
  const { data, error } = await state.supabase.from("profiles").upsert(payload, { onConflict: "id" }).select().single();
  if (error) throw error;
  const profile = normalizeProfile(data); state.profileRecord = profile; rememberCreator(profile.displayName); elements.creatorInput.value = profile.displayName; return profile;
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

/**
 * Messenger Realtime System (v1)
 * Handles live message notifications and badge updates.
 */
class MessengerRealtime {
  constructor(appState) {
    this.state = appState;
    this.channel = null;
    this.sessionHash = Math.random().toString(36).substring(2, 10);
  }

  init() {
    if (!this.state.supabase || !this.state.currentUser) return;
    this.stop(); 
    const userId = this.state.currentUser.id;
    const channelName = `messenger_live_${userId.slice(0, 8)}`;
    console.log("[Realtime] Connecting to:", channelName);
    this.channel = this.state.supabase.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        this.handleNewMessage(payload.new);
      })
      .subscribe((status, err) => {
        console.log("[Realtime] Status:", status);
        if (err || status === "CHANNEL_ERROR") {
          console.error("[Realtime] Error encountered. Retrying in 3s...", err);
          setTimeout(() => this.init(), 3000);
        }
      });
  }

  handleNewMessage(rawData) {
    const state = this.state;
    const message = this.normalize(rawData);
    if (message.senderId === state.currentUser?.id) return;
    if (state.blockedUserIds?.includes(message.senderId)) return;
    if (state.bannedUserIds?.includes(message.senderId)) return;

    if (window.playIncomingMessageSound) window.playIncomingMessageSound();

    if (window.notifications) {
      const senderProfile = (state.availableProfiles || []).find(p => p.id === message.senderId);
      let senderName = senderProfile ? (senderProfile.displayName || "Member") : "Member";
      let messageBody = message.body || "Sent an attachment";
      if (state.preferences?.notificationHideSender) senderName = "Someone";
      if (state.preferences?.notificationHideBody) messageBody = "New message";

      window.notifications.info(messageBody, `${senderName} sent a message`);
      const isActiveThread = message.threadId === state.activeThreadId;
      if (!state.messengerOpen || !isActiveThread) {
        window.notifications.incrementUnreadCount();
      }
    }

    if (message.threadId === state.activeThreadId && window.mergeActiveMessage) {
      window.mergeActiveMessage(message);
      if (window.renderActiveThread) window.renderActiveThread(true);
    }
  }

  stop() { if (this.channel) { this.channel.unsubscribe(); this.channel = null; } }

  normalize(row) {
    return {
      id: row.id,
      threadId: row.thread_id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
      attachmentKind: row.attachment_kind,
      attachmentName: row.attachment_name,
      attachmentUrl: row.attachment_file_path
    };
  }
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
    
    // Keep reference for compatibility
    state.messagesChannel = messengerRealtime.channel;
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
      if (likedPost && likedPost.authorId === state.currentUser.id && window.notifications) {
        window.notifications.success(`Someone liked your post: ${likedPost.title || "Untitled"}`, "New Like!");
        window.notifications.incrementUnreadCount();
      }
    }).subscribe();

  } catch (error) {
    console.error("[Messenger] Fatal Subscription Error:", error);
  } finally {
    isMessagingSubscribing = false;
  }
}

// Expose helpers for the new MessengerRealtime system
window.playIncomingMessageSound = playIncomingMessageSound;
window.mergeActiveMessage = mergeActiveMessage;
window.renderActiveThread = renderActiveThread;

function playIncomingMessageSound() {
  const now = Date.now(); if (now - state.lastIncomingMessageSoundAt < 700) return; state.lastIncomingMessageSoundAt = now;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext; if (!AudioContextCtor) return;
  try {
    if (!messageChimeAudioContext) messageChimeAudioContext = new AudioContextCtor();
    const ctx = messageChimeAudioContext; if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const startAt = ctx.currentTime + 0.01; const oscillator = ctx.createOscillator(); const gainNode = ctx.createGain();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(740, startAt); oscillator.frequency.exponentialRampToValueAtTime(980, startAt + 0.08);
    gainNode.gain.setValueAtTime(0.0001, startAt); gainNode.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02); gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
    oscillator.connect(gainNode); gainNode.connect(ctx.destination); oscillator.start(startAt); oscillator.stop(startAt + 0.2);
  } catch (_error) {}
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
  
  // 1. Synchronous state lock
  if (state.messengerBusy || !isMessagingEnabled(state) || !state.activeThreadId) return;

  // 2. Global window-level lock (extra safety for hybrid/mobile environments)
  if (window.__SIGNAL_MESSENGER_SUBMITTING__) return;

  const now = Date.now();
  const body = elements.messageInput.value.trim();
  const attachmentFile = state.messageAttachmentFile;

  // 3. 3-second content-based idempotency guard (prevents rapid double-sends of same text)
  if (!attachmentFile && body && body === window.__SIGNAL_LAST_SUBMITTED_BODY__ && now - (window.__SIGNAL_LAST_SUBMITTED_AT__ || 0) < 3000) {
    console.warn("Duplicate message content detected within lockout window");
    return;
  }

  // 4. Time-based debounce
  if (now - state.lastMessageSubmitTime < 1000) {
    return;
  }

  if (!body && !attachmentFile) {
    showMessengerFeedback("Write a message or attach a file before sending it.", true);
    return;
  }

  // 5. LOCK IMMEDIATELY AND SYNCHRONOUSLY
  window.__SIGNAL_MESSENGER_SUBMITTING__ = true;
  window.__SIGNAL_LAST_SUBMITTED_BODY__ = body;
  window.__SIGNAL_LAST_SUBMITTED_AT__ = now;
  state.lastMessageSubmitTime = now;
  state.messengerBusy++;
  
  // Disable UI immediately
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

  try {
    const messageId = crypto.randomUUID();
    
    // 6. PRE-FLIGHT OPTIMISTIC UI: Merge and render immediately before network requests
    // This makes the UI respond instantly. The subsequent insert and Realtime echos
    // will update this message in place because they share the same messageId.
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
      attachmentUrl: state.messageAttachmentPreviewUrl || null, // Temporary preview URL
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

    // 7. BROADCAST INSTANTLY to the other user
    if (state.messagesChannel) {
      const recipientId = getThreadPartnerId(state.directThreads.find(t => t.id === state.activeThreadId));
      const targetChannelName = `realtime-messages-${recipientId.slice(0, 8)}`;
      
      // We send a direct broadcast to the recipient's specific channel
      state.supabase.channel(targetChannelName).send({
        type: 'broadcast',
        event: 'new-message',
        payload: {
          id: messageId,
          thread_id: state.activeThreadId,
          sender_id: state.currentUser.id,
          body: body || null,
          ...attachmentPayload,
          created_at: new Date().toISOString()
        }
      });
      console.log(`[Messenger] Instant broadcast sent to ${targetChannelName}`);
    }

    const { data: insertedData, error: insertError } = await state.supabase
      .from("messages")
      .select()
      .eq("id", messageId)
      .single();

    if (insertError) throw insertError;

    // Manually merge for the sender to ensure immediate UI feedback and 
    // handle potential Realtime latency/disconnects on mobile.
    // mergeActiveMessage's ID check will prevent duplication if the Realtime echo also fires.
    if (data) {
      mergeActiveMessage(normalizeMessage(data));
      renderMessenger();
    }

    // While we manually merged above for instant feedback, the Realtime listener 
    // remains active to receive messages from other participants.

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
    // If it failed, we could restore the body here if we wanted, but for now just show error
    showMessengerFeedback("The message could not be sent.", true);
  } finally {
    window.__SIGNAL_MESSENGER_SUBMITTING__ = false;
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    renderMessenger();
  }
}

function formatMessageTimestamp(isoString) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(isoString)); }

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

function loadUserPreferences() {
  try { return normalizeUserPreferences(JSON.parse(localStorage.getItem(USER_PREFERENCES_KEY) ?? "{}")); } catch { return { ...DEFAULT_USER_PREFERENCES }; }
}

function normalizeUserPreferences(raw = {}) {
  const theme = ["sunset", "midnight", "gallery", "aurora"].includes(raw.theme) ? raw.theme : DEFAULT_USER_PREFERENCES.theme;
  const density = ["airy", "compact"].includes(raw.density) ? raw.density : DEFAULT_USER_PREFERENCES.density;
  const motion = ["full", "calm"].includes(raw.motion) ? raw.motion : DEFAULT_USER_PREFERENCES.motion;
  const statusBarStrip = typeof raw.statusBarStrip === "boolean" ? raw.statusBarStrip : DEFAULT_USER_PREFERENCES.statusBarStrip;
  const notificationHideSender = typeof raw.notificationHideSender === "boolean" ? raw.notificationHideSender : DEFAULT_USER_PREFERENCES.notificationHideSender;
  const notificationHideBody = typeof raw.notificationHideBody === "boolean" ? raw.notificationHideBody : DEFAULT_USER_PREFERENCES.notificationHideBody;
  return { theme, density, motion, statusBarStrip, notificationHideSender, notificationHideBody };
}

function saveUserPreferences() { try { localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(state.preferences)); } catch {} }

function applyUserPreferences(preferences) {
  document.body.dataset.theme = preferences.theme; document.body.dataset.density = preferences.density; document.body.dataset.motion = preferences.motion; document.documentElement.dataset.statusBarStrip = preferences.statusBarStrip ? "on" : "off"; document.documentElement.style.scrollBehavior = preferences.motion === "calm" ? "auto" : "smooth";
}

function openSettingsPanel() { state.settingsPanelOpen = true; state.settingsActivePage = "main"; setMobileHeaderHidden(false); renderSettingsPanel(); requestAnimationFrame(() => elements.settingsCloseButton?.focus?.()); }
function closeSettingsPanel(options = {}) { const { restoreFocus = true } = options; if (!state.settingsPanelOpen) return; state.settingsPanelOpen = false; renderSettingsPanel(); if (restoreFocus) elements.settingsToggleButton.focus(); }
function toggleSettingsPanel(event) { if (event) { event.preventDefault(); event.stopPropagation(); } if (state.settingsPanelOpen) closeSettingsPanel(); else openSettingsPanel(); }

window.showSettingsPage = function(page) {
  state.settingsActivePage = page;
  renderSettingsPanel();
  if (page === 'shortcuts') {
    renderKeyboardShortcuts();
  }
};

function renderSettingsPanel() {
  if (!elements.settingsPanel) return;
  
  const isOpen = state.settingsPanelOpen;
  elements.settingsPanel.hidden = !isOpen;
  elements.settingsPanel.classList.toggle("is-open", isOpen);
  elements.settingsPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  elements.settingsToggleButton.setAttribute("aria-expanded", isOpen ? "true" : "false");

  if (isOpen) {
    const isMain = state.settingsActivePage === 'main';
    if (elements.settingsMainPage) elements.settingsMainPage.style.display = isMain ? 'block' : 'none';
    if (elements.settingsShortcutsPage) elements.settingsShortcutsPage.style.display = isMain ? 'none' : 'block';
    
    if (isMain) {
      if (elements.densitySelect) elements.densitySelect.value = state.preferences.density;
      if (elements.motionSelect) elements.motionSelect.value = state.preferences.motion;
      if (elements.statusBarStripToggle) elements.statusBarStripToggle.checked = state.preferences.statusBarStrip;
      if (elements.notificationHideSenderToggle) elements.notificationHideSenderToggle.checked = state.preferences.notificationHideSender;
      if (elements.notificationHideBodyToggle) elements.notificationHideBodyToggle.checked = state.preferences.notificationHideBody;
      if (elements.themeGrid) {
        elements.themeGrid.querySelectorAll("[data-theme-option]").forEach((button) => {
          const isActive = button.dataset.themeOption === state.preferences.theme;
          button.classList.toggle("is-active", isActive);
          button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
      }
    }
  }
}

function openNotificationsPanel() { 
  state.notificationsPanelOpen = true; 
  setMobileHeaderHidden(false); 
  if (window.notifications) window.notifications.setUnreadCount(0);
  render();
  if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  requestAnimationFrame(() => elements.notificationsCloseButton?.focus?.()); 
}
function closeNotificationsPanel(options = {}) { 
  const { restoreFocus = true } = options; 
  if (!state.notificationsPanelOpen) return; 
  state.notificationsPanelOpen = false; 
  render(); 
  if (restoreFocus && elements.notificationsLauncherButton) elements.notificationsLauncherButton.focus(); 
}
function toggleNotificationsPanel(event) { 
  if (event) { event.preventDefault(); event.stopPropagation(); } 
  if (state.notificationsPanelOpen) closeNotificationsPanel(); else openNotificationsPanel(); 
}

function renderKeyboardShortcuts() {
  if (!elements.shortcutsList) return;
  const shortcuts = window.keyboardBindings ? window.keyboardBindings.getShortcuts() : [];
  elements.shortcutsList.innerHTML = "";
  
  shortcuts.forEach(([key, info]) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "12px 16px";
    item.style.background = "var(--surface, rgba(255, 250, 242, 0.5))";
    item.style.borderRadius = "12px";
    item.style.border = "1px solid var(--line, rgba(19, 33, 43, 0.1))";
    
    item.innerHTML = `
      <span style="font-size: 0.95rem; font-weight: 500; color: var(--text, #13212b);">${info.description}</span>
      <kbd style="
        background: #fff;
        color: #081017;
        padding: 4px 10px;
        border-radius: 8px;
        border: 1px solid var(--line, rgba(19, 33, 43, 0.2));
        border-bottom: 3px solid var(--line, rgba(19, 33, 43, 0.3));
        font-family: inherit;
        font-weight: 700;
        font-size: 0.8rem;
        min-width: 32px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      ">${key}</kbd>
    `;
    elements.shortcutsList.appendChild(item);
  });
}

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
function handleThemeOptionClick(event) { const button = event.target.closest("[data-theme-option]"); if (!button) return; updateUserPreferences({ ...state.preferences, theme: button.dataset.themeOption }); }
function handleDensityChange(event) { updateUserPreferences({ ...state.preferences, density: event.target.value }); }
function handleMotionChange(event) { updateUserPreferences({ ...state.preferences, motion: event.target.value }); }
function handleStatusBarStripToggle(event) { updateUserPreferences({ ...state.preferences, statusBarStrip: event.target.checked }); }
function handleNotificationHideSenderToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideSender: event.target.checked }); }
function handleNotificationHideBodyToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideBody: event.target.checked }); }
function resetPlayerDockPosition() { state.playerPosition = null; savePlayerPosition(null); applyMiniPlayerPosition(); }
function resetPlayerVolume() { state.playerVolume = DEFAULT_PLAYER_VOLUME; savePlayerVolume(DEFAULT_PLAYER_VOLUME); applyPlayerVolumeToActiveElement(); renderMiniPlayerVolumeControl(); }
function resetUserPreferences() { updateUserPreferences({ ...DEFAULT_USER_PREFERENCES }); resetPlayerDockPosition(); resetPlayerVolume(); }

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

function loadPlayerPosition() {
  try {
    const raw = localStorage.getItem(PLAYER_POSITION_KEY); if (!raw) return null; const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== "object") return null;
    const x = Number(parsed.x); const y = Number(parsed.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.round(x), y: Math.round(y) };
  } catch { return null; }
}

function normalizePlayerVolume(value, fallback = DEFAULT_PLAYER_VOLUME) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(1, Math.max(0, numeric)); }
function loadPlayerVolume() { try { const raw = localStorage.getItem(PLAYER_VOLUME_KEY); if (!raw) return DEFAULT_PLAYER_VOLUME; return normalizePlayerVolume(raw); } catch { return DEFAULT_PLAYER_VOLUME; } }
function savePlayerVolume(volume) { try { localStorage.setItem(PLAYER_VOLUME_KEY, `${normalizePlayerVolume(volume)}`); } catch {} }
function savePlayerPosition(position) { try { if (!position) { localStorage.removeItem(PLAYER_POSITION_KEY); return; } localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })); } catch {} }
function getPlayerViewportPadding() { return window.innerWidth <= 760 ? 12 : 20; }
function clampPlayerPosition(position) { if (!position) return null; const padding = getPlayerViewportPadding(); const width = elements.miniPlayer.offsetWidth || Math.min(360, Math.max(240, window.innerWidth - padding * 2)); const height = elements.miniPlayer.offsetHeight || 280; const maxX = Math.max(padding, window.innerWidth - width - padding); const maxY = Math.max(padding, window.innerHeight - height - padding); return { x: Math.min(maxX, Math.max(padding, Math.round(position.x))), y: Math.min(maxY, Math.max(padding, Math.round(position.y))) }; }

function applyMiniPlayerPosition() {
  if (!state.playerPosition) { elements.miniPlayer.style.left = ""; elements.miniPlayer.style.top = ""; elements.miniPlayer.style.right = ""; elements.miniPlayer.style.bottom = ""; return; }
  const nextPosition = clampPlayerPosition(state.playerPosition); state.playerPosition = nextPosition; savePlayerPosition(nextPosition);
  elements.miniPlayer.style.left = `${nextPosition.x}px`; elements.miniPlayer.style.top = `${nextPosition.y}px`; elements.miniPlayer.style.right = "auto"; elements.miniPlayer.style.bottom = "auto";
}

function beginMiniPlayerDrag(event) {
  const target = event.target instanceof Element ? event.target : null; if (!state.playerPostId || target?.closest("button")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const rect = elements.miniPlayer.getBoundingClientRect(); const defaultPosition = { x: rect.left, y: rect.top };
  state.playerPosition = clampPlayerPosition(state.playerPosition ?? defaultPosition);
  state.playerDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  elements.miniPlayer.classList.add("is-dragging"); applyMiniPlayerPosition();
  if (typeof elements.miniPlayerHead.setPointerCapture === "function") { try { elements.miniPlayerHead.setPointerCapture(event.pointerId); } catch {} }
  event.preventDefault();
}

function handleMiniPlayerDrag(event) { if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; state.playerPosition = clampPlayerPosition({ x: event.clientX - state.playerDrag.offsetX, y: event.clientY - state.playerDrag.offsetY }); applyMiniPlayerPosition(); }
function endMiniPlayerDrag(event) { if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; if (typeof elements.miniPlayerHead.releasePointerCapture === "function") { try { elements.miniPlayerHead.releasePointerCapture(event.pointerId); } catch {} } state.playerDrag = null; elements.miniPlayer.classList.remove("is-dragging"); savePlayerPosition(state.playerPosition); }

function handleViewportResize() { updateViewportMetrics(); syncMobileHeaderVisibility(); syncMobileMessengerMode(); if (!state.playerPostId || !state.playerPosition) return; applyMiniPlayerPosition(); }
function isMobileHeaderViewport() { return isTouchCompactViewport(); }
function isMobileMessengerViewport() { return isTouchCompactViewport(); }
function isTouchCompactViewport() { const touchCapable = window.matchMedia("(hover: none) and (pointer: coarse)").matches || navigator.maxTouchPoints > 0; return touchCapable && (window.innerWidth <= 760 || window.innerHeight <= 600); }
function isLandscapeViewport() { return window.innerWidth > window.innerHeight; }
function resolveMessengerExpandedState(expanded) { if (isMobileMessengerViewport()) return isLandscapeViewport(); return expanded; }
function syncMobileMessengerMode() { if (!state.messengerOpen || !isMobileMessengerViewport()) return; const nextExpanded = isLandscapeViewport(); if (state.messengerExpanded === nextExpanded) return; state.messengerExpanded = nextExpanded; renderMessenger(); }

function updateViewportMetrics() {
  const root = document.documentElement; const viewport = window.visualViewport; const offsetTop = viewport ? Math.max(0, Math.round(viewport.offsetTop)) : 0; const visibleHeight = viewport ? Math.round(viewport.height) : window.innerHeight; const offsetBottom = viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
  root.style.setProperty("--viewport-offset-top", `${offsetTop}px`); root.style.setProperty("--viewport-offset-bottom", `${offsetBottom}px`); root.style.setProperty("--viewport-visible-height", `${visibleHeight}px`);
}

function setMobileHeaderHidden(hidden) { state.mobileHeaderHidden = hidden; elements.siteHeader.classList.toggle("is-hidden", hidden); }
function syncMobileHeaderVisibility() { if (!isMobileHeaderViewport()) { setMobileHeaderHidden(false); state.lastScrollY = window.scrollY; return; } if (state.settingsPanelOpen || window.scrollY <= 24) setMobileHeaderHidden(false); state.lastScrollY = window.scrollY; }
function handleWindowScroll() { if (!isMobileHeaderViewport()) return; const currentScrollY = window.scrollY; if (state.settingsPanelOpen || currentScrollY <= 24) { setMobileHeaderHidden(false); state.lastScrollY = currentScrollY; return; } const delta = currentScrollY - state.lastScrollY; if (Math.abs(delta) < 8) { state.lastScrollY = currentScrollY; return; } if (delta > 0) setMobileHeaderHidden(true); else setMobileHeaderHidden(false); state.lastScrollY = currentScrollY; }
function applySiteSettings(settings) { const root = document.documentElement; root.style.setProperty("--shell-max-width", `${settings.shellWidth}px`); root.style.setProperty("--section-gap", `${settings.sectionGap}px`); root.style.setProperty("--radius-xl", `${settings.surfaceRadius}px`); root.style.setProperty("--radius-lg", `${Math.max(18, settings.surfaceRadius - 8)}px`); root.style.setProperty("--radius-md", `${Math.max(14, settings.surfaceRadius - 14)}px`); root.style.setProperty("--feed-media-fit", settings.mediaFit); }
async function loadSiteSettingsFromSupabase() { const { data, error } = await state.supabase.from("site_settings").select("*").eq("id", "global").maybeSingle(); if (error) throw error; return data ? normalizeSiteSettings(data) : { ...DEFAULT_SITE_SETTINGS }; }
function handleAdminSettingsInput() { state.siteSettings = { shellWidth: clampNumber(elements.layoutWidthInput.value, 960, 1440, DEFAULT_SITE_SETTINGS.shellWidth), sectionGap: clampNumber(elements.layoutGapInput.value, 16, 40, DEFAULT_SITE_SETTINGS.sectionGap), surfaceRadius: clampNumber(elements.layoutRadiusInput.value, 22, 44, DEFAULT_SITE_SETTINGS.surfaceRadius), mediaFit: elements.mediaFitSelect.value === "contain" ? "contain" : "cover" }; applySiteSettings(state.siteSettings); updateAdminSettingsValues(); }
function handleAdminSettingsReset() { state.siteSettings = { ...DEFAULT_SITE_SETTINGS }; applySiteSettings(state.siteSettings); renderAdminEditor(); elements.adminSettingsFeedback.textContent = "Defaults restored locally. Save to publish them."; elements.adminSettingsFeedback.classList.remove("is-error"); }
async function handleAdminSettingsSubmit(event) { event.preventDefault(); if (state.backendMode !== "supabase" || !state.supabase || !isCurrentUserAdmin()) { elements.adminSettingsFeedback.textContent = "Only live admin accounts can save site settings."; elements.adminSettingsFeedback.classList.add("is-error"); return; } const { error } = await state.supabase.from("site_settings").upsert(getSiteSettingsPayload()); if (error) { console.error("Failed to save site settings", error); elements.adminSettingsFeedback.textContent = "The layout settings could not be saved."; elements.adminSettingsFeedback.classList.add("is-error"); return; } elements.adminSettingsFeedback.textContent = "Layout settings saved for the live site."; elements.adminSettingsFeedback.classList.remove("is-error"); }
function updateAdminSettingsValues() { elements.layoutWidthValue.textContent = `${state.siteSettings.shellWidth}px`; elements.layoutGapValue.textContent = `${state.siteSettings.sectionGap}px`; elements.layoutRadiusValue.textContent = `${state.siteSettings.surfaceRadius}px`; }
function renderAdminEditor() { const showAdminEditor = state.backendMode === "supabase" && isCurrentUserActivated() && isCurrentUserAdmin(); elements.adminEditor.hidden = !showAdminEditor; if (!showAdminEditor) return; elements.layoutWidthInput.value = String(state.siteSettings.shellWidth); elements.layoutGapInput.value = String(state.siteSettings.sectionGap); elements.layoutRadiusInput.value = String(state.siteSettings.surfaceRadius); elements.mediaFitSelect.value = state.siteSettings.mediaFit; updateAdminSettingsValues(); }
function renderTagCloud() { const posts = getVisiblePosts(); const tagCounts = new Map(); posts.forEach((post) => { post.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)); }); const tags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8); elements.tagCloud.innerHTML = ""; tags.forEach(([tag, count]) => { const button = document.createElement("button"); button.type = "button"; button.className = "tag-chip"; button.dataset.tag = tag; button.textContent = `#${tag} ${count}`; if (state.search === tag.toLowerCase()) button.classList.add("is-active"); elements.tagCloud.appendChild(button); }); }
function renderOverview() { const posts = getVisiblePosts(); renderSpotlight(posts); renderCreatorBoard(posts); }
function renderFeed() { elements.feedGrid.innerHTML = ""; const posts = getVisiblePosts(); const pagePosts = getCurrentFeedPagePosts(posts); pagePosts.forEach((post) => elements.feedGrid.appendChild(createFeedCard(post))); elements.emptyState.hidden = posts.length !== 0; renderFeedPagination(posts); }

function createFeedCard(post) {
  const fragment = elements.feedCardTemplate.content.cloneNode(true); const mediaContainer = fragment.querySelector(".card-media"); const kind = fragment.querySelector(".card-kind"); const signal = fragment.querySelector(".card-signal"); const title = fragment.querySelector(".card-title"); const caption = fragment.querySelector(".card-caption"); const creator = fragment.querySelector(".card-creator"); const time = fragment.querySelector(".card-time"); const tags = fragment.querySelector(".card-tags"); const openButton = fragment.querySelector(".open-button"); const saveButton = fragment.querySelector(".save-button"); const likeButton = fragment.querySelector(".like-button"); const deleteButton = fragment.querySelector(".delete-button"); const creatorSummary = getProfileSummaryForPost(post);
  kind.textContent = formatKind(post.mediaKind); signal.textContent = getSignalLabel(post); title.textContent = post.title; caption.textContent = post.caption; creator.textContent = creatorSummary?.displayName ?? post.creator; time.textContent = formatTimestamp(post.createdAt); likeButton.textContent = `${getLikeCount(post)} likes`; saveButton.textContent = isPostSaved(post.id) ? "Saved" : "Save"; saveButton.setAttribute("aria-pressed", isPostSaved(post.id) ? "true" : "false"); saveButton.classList.toggle("is-saved", isPostSaved(post.id)); openButton.textContent = isPlayablePost(post) ? "Play" : "Open";
  const isLiked = state.likedPosts.includes(post.id); likeButton.setAttribute("aria-pressed", isLiked ? "true" : "false"); if (isLiked) likeButton.classList.add("is-liked");
  if (creatorSummary) creator.addEventListener("click", (event) => openProfileByKey(creatorSummary.key, event.currentTarget));
  openButton.addEventListener("click", (event) => { if (isPlayablePost(post)) openMiniPlayer(post.id, event.currentTarget); else openViewer(post.id, event.currentTarget); });
  saveButton.addEventListener("click", () => toggleSave(post.id)); likeButton.addEventListener("click", () => void toggleLike(post.id));
  if (canDeletePost(post)) { deleteButton.hidden = false; deleteButton.addEventListener("click", () => deletePost(post.id)); }
  post.tags.forEach((tag) => { const pill = document.createElement("span"); pill.className = "tag-pill"; pill.textContent = `#${tag}`; tags.appendChild(pill); });
  renderCardMedia(mediaContainer, post); return fragment;
}

function getAllPosts() { if (state.backendMode === "local" && state.userPosts.length === 0) return [...DEMO_POSTS]; return [...state.userPosts]; }
function getVisiblePosts() { const query = state.search; const posts = getAllPosts().filter((post) => { const matchesFilter = state.filter === "all" || state.filter === post.mediaKind || (state.filter === "saved" && isPostSaved(post.id)); if (!matchesFilter) return false; if (!query) return true; const haystack = [post.title, post.caption, post.creator, post.tags.join(" ")].join(" ").toLowerCase(); return haystack.includes(query); }); return sortPosts(posts); }
function getFeedPageCount(totalPosts) { return Math.max(1, Math.ceil(totalPosts / FEED_POSTS_PER_PAGE)); }
function clampFeedPage(totalPosts) { state.feedPage = Math.min(Math.max(1, state.feedPage), getFeedPageCount(totalPosts)); }
function getCurrentFeedPagePosts(posts) { clampFeedPage(posts.length); const startIndex = (state.feedPage - 1) * FEED_POSTS_PER_PAGE; return posts.slice(startIndex, startIndex + FEED_POSTS_PER_PAGE); }
function resetFeedPagination() { state.feedPage = 1; }

function renderFeedPagination(posts) {
  const totalPosts = posts.length; const pageCount = getFeedPageCount(totalPosts); const showPagination = totalPosts > FEED_POSTS_PER_PAGE;
  elements.feedPagination.hidden = !showPagination; elements.feedPagination.innerHTML = ""; if (!showPagination) return;
  const startIndex = (state.feedPage - 1) * FEED_POSTS_PER_PAGE + 1; const endIndex = Math.min(totalPosts, state.feedPage * FEED_POSTS_PER_PAGE);
  const summary = document.createElement("p"); summary.className = "feed-pagination-summary"; summary.textContent = `Showing ${startIndex}-${endIndex} of ${totalPosts} posts`;
  const controls = document.createElement("div"); controls.className = "feed-pagination-controls";
  const previousButton = document.createElement("button"); previousButton.type = "button"; previousButton.className = "feed-page-button"; previousButton.textContent = "Previous"; previousButton.disabled = state.feedPage === 1; previousButton.addEventListener("click", () => { if (state.feedPage > 1) { state.feedPage -= 1; render(); } });
  const nextButton = document.createElement("button"); nextButton.type = "button"; nextButton.className = "feed-page-button"; nextButton.textContent = "Next"; nextButton.disabled = state.feedPage === pageCount; nextButton.addEventListener("click", () => { if (state.feedPage < pageCount) { state.feedPage += 1; render(); } });
  controls.appendChild(previousButton);
  for (let page = 1; page <= pageCount; page += 1) {
    const pageButton = document.createElement("button"); pageButton.type = "button"; pageButton.className = "feed-page-button"; pageButton.textContent = String(page); pageButton.setAttribute("aria-label", `Go to page ${page}`); pageButton.setAttribute("aria-pressed", page === state.feedPage ? "true" : "false"); if (page === state.feedPage) pageButton.classList.add("is-active"); pageButton.addEventListener("click", () => { if (state.feedPage !== page) { state.feedPage = page; render(); } }); controls.appendChild(pageButton);
  }
  controls.appendChild(nextButton); elements.feedPagination.append(summary, controls);
}

function syncOverlayBodyState() { document.body.classList.toggle("viewer-open", Boolean(state.viewerPostId || state.viewerAttachment || state.activeProfileKey)); }
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

function syncProfileNavAvatar() {
  if (!elements.profileNavAvatar || !elements.profileNavLink) return;
  const profileKey = getOwnProfileKey();
  if (profileKey) {
    elements.profileNavLink.style.display = "";
    const summary = getProfileSummaryByKey(profileKey);
    elements.profileNavAvatar.textContent = getProfileInitials(summary?.displayName || getDefaultProfileName());
  } else {
    elements.profileNavLink.style.display = "none";
  }
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

function getProfileInitials(name) { const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean); if (parts.length === 0) return "SS"; if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase(); return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join(""); }
function sortPosts(posts) { return posts.sort((l, r) => { if (state.sort === "popular") return getLikeCount(r) - getLikeCount(l) || compareByNewest(l, r); const lTime = new Date(l.createdAt).getTime(); const rTime = new Date(r.createdAt).getTime(); return state.sort === "oldest" ? lTime - rTime : rTime - lTime; }); }

function renderSpotlight(posts) {
  elements.spotlightCard.innerHTML = ""; if (posts.length === 0) { const empty = document.createElement("div"); empty.className = "spotlight-empty"; empty.innerHTML = "<p class=\"eyebrow\">Spotlight</p><h3>No active spotlight</h3><p>Change the filter or publish a new post to refresh the board.</p>"; elements.spotlightCard.appendChild(empty); return; }
  const post = getSpotlightPost(posts); const creatorSummary = getProfileSummaryForPost(post); const copy = document.createElement("div"); copy.className = "spotlight-copy";
  const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = "Spotlight"; const title = document.createElement("h3"); title.className = "spotlight-title"; title.textContent = post.title; const caption = document.createElement("p"); caption.className = "spotlight-caption"; caption.textContent = post.caption;
  const meta = document.createElement("div"); meta.className = "spotlight-meta"; const creator = document.createElement("button"); creator.type = "button"; creator.className = "profile-trigger"; creator.textContent = creatorSummary?.displayName ?? post.creator; if (creatorSummary) creator.addEventListener("click", (event) => openProfileByKey(creatorSummary.key, event.currentTarget));
  const info = document.createElement("span"); info.textContent = `${formatKind(post.mediaKind)} / ${getLikeCount(post)} likes`; meta.append(creator, info);
  const actions = document.createElement("div"); actions.className = "spotlight-actions"; const openButton = document.createElement("button"); openButton.className = "button button-primary"; openButton.type = "button"; openButton.textContent = isPlayablePost(post) ? "Open player" : "Open spotlight"; openButton.addEventListener("click", (event) => { if (isPlayablePost(post)) openMiniPlayer(post.id, event.currentTarget); else openViewer(post.id, event.currentTarget); });
  const saveButton = document.createElement("button"); saveButton.className = "button button-secondary"; saveButton.type = "button"; saveButton.textContent = isPostSaved(post.id) ? "Saved locally" : "Save post"; saveButton.addEventListener("click", () => toggleSave(post.id)); actions.append(openButton, saveButton); copy.append(eyebrow, title, caption, meta, actions);
  const media = document.createElement("div"); media.className = "spotlight-media"; renderSpotlightMedia(media, post); elements.spotlightCard.append(copy, media);
}

function renderCreatorBoard(posts) {
  elements.creatorBoard.innerHTML = ""; const ranked = getProfileBoardEntries(posts).slice(0, 4); if (ranked.length === 0) { elements.creatorBoard.textContent = "No creators match the current feed."; return; }
  ranked.forEach((entry, index) => {
    const row = document.createElement("button"); row.type = "button"; row.className = "board-row board-button"; row.addEventListener("click", (event) => openProfileByKey(entry.summary.key, event.currentTarget));
    const rank = document.createElement("span"); rank.className = "board-rank"; rank.textContent = String(index + 1).padStart(2, "0"); const details = document.createElement("div"); details.className = "board-details"; const creator = document.createElement("strong"); creator.textContent = entry.summary.displayName; const meta = document.createElement("span"); meta.textContent = `${entry.posts} post${entry.posts === 1 ? "" : "s"} / ${entry.likes} likes`;
    details.append(creator, meta); row.append(rank, details); elements.creatorBoard.appendChild(row);
  });
}

function renderCardMedia(container, post) { appendMedia(container, post, { variant: "card" }); }
function renderSpotlightMedia(container, post) { appendMedia(container, post, { variant: "spotlight" }); }
function renderViewerMedia(container, post) { if (isPlayablePost(post)) mountPersistentPlayer(container, post, "viewer"); else appendMedia(container, post, { variant: "viewer", sourceResolver: resolveViewerSource }); }
function renderViewerAttachmentMedia(container, attachment) { if (!attachment?.url || !attachment?.kind) return; if (attachment.kind === "image") { const image = document.createElement("img"); image.className = "viewer-media"; image.loading = "eager"; image.alt = attachment.title || "Shared image"; image.src = attachment.url; container.appendChild(image); return; } const video = document.createElement("video"); video.className = "viewer-media"; video.controls = true; video.preload = "metadata"; video.playsInline = true; video.src = attachment.url; container.appendChild(video); }
function renderMiniPlayerMedia(container, post) { mountPersistentPlayer(container, post, "mini"); }

function isPlayablePost(post) { if (!post) return false; return post.mediaKind === "video" || post.mediaKind === "audio" || post.sourceKind === "youtube" || post.sourceKind === "spotify"; }
function getActivePlayerMediaElement() { if (!(state.activePlayerElement instanceof HTMLElement)) return null; if (state.activePlayerElement instanceof HTMLMediaElement) return state.activePlayerElement; const mediaElement = state.activePlayerElement.querySelector("video, audio"); return mediaElement instanceof HTMLMediaElement ? mediaElement : null; }
function getControllablePlayerPost() { return getPostById(state.activePlayerPostId || state.playerPostId); }

function buildPersistentPlayerSource(post) {
  const source = typeof post?.embedUrl === "string" ? post.embedUrl : ""; if (post?.sourceKind !== "youtube" || !source) return source;
  try { const url = new URL(source, window.location.origin); url.searchParams.set("enablejsapi", "1"); url.searchParams.set("playsinline", "1"); if (window.location.origin && window.location.origin !== "null") url.searchParams.set("origin", window.location.origin); return url.toString(); }
  catch { const separator = source.includes("?") ? "&" : "?"; return `${source}${separator}enablejsapi=1&playsinline=1`; }
}

function postMessageToYouTubePlayer(frame, func, args = []) { if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return; frame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*"); }
function syncPlayerVolumeFromMediaElement(event) { const mediaElement = event?.target; if (!(mediaElement instanceof HTMLMediaElement)) return; state.playerVolume = normalizePlayerVolume(mediaElement.muted ? 0 : mediaElement.volume, state.playerVolume); savePlayerVolume(state.playerVolume); renderMiniPlayerVolumeControl(); }
function attachPersistentPlayerMediaListeners(mediaElement) { if (!(mediaElement instanceof HTMLMediaElement)) return; mediaElement.addEventListener("volumechange", syncPlayerVolumeFromMediaElement); }

function applyPlayerVolumeToActiveElement() {
  const mediaElement = getActivePlayerMediaElement(); if (mediaElement instanceof HTMLMediaElement) { const nextVolume = normalizePlayerVolume(state.playerVolume); mediaElement.volume = nextVolume; mediaElement.muted = nextVolume === 0; return true; }
  const post = getControllablePlayerPost(); if (post?.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) { const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100); postMessageToYouTubePlayer(state.activePlayerElement, "setVolume", [volumePercent]); postMessageToYouTubePlayer(state.activePlayerElement, volumePercent === 0 ? "mute" : "unMute"); return true; }
  return false;
}

function mountPersistentPlayer(container, post, variant) {
  if (state.activePlayerPostId !== post.id || !state.activePlayerElement) { destroyActivePlayer(); state.activePlayerElement = createPersistentPlayer(post); state.activePlayerPostId = post.id; }
  applyPersistentPlayerVariant(post, variant); applyPlayerVolumeToActiveElement(); if (container.firstElementChild !== state.activePlayerElement) container.replaceChildren(state.activePlayerElement);
}

function createPersistentPlayer(post) {
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") {
    const frame = document.createElement("iframe"); frame.src = buildPersistentPlayerSource(post); frame.title = `${post.title} player`; frame.loading = "lazy"; frame.width = "100%"; frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.setAttribute("allowfullscreen", ""); frame.addEventListener("load", () => { if (state.activePlayerElement === frame) applyPlayerVolumeToActiveElement(); }); return frame;
  }
  if (post.mediaKind === "video") { const video = document.createElement("video"); video.controls = true; video.preload = "metadata"; video.playsInline = true; video.src = resolveActivePlayerSource(post); attachPersistentPlayerMediaListeners(video); return video; }
  const shell = document.createElement("div"); const audioStage = document.createElement("div"); audioStage.dataset.audioStage = "true"; const label = document.createElement("span"); label.textContent = "Audio drop"; const title = document.createElement("strong"); title.textContent = post.title; const audio = document.createElement("audio"); audio.dataset.audioPlayer = "true"; audio.controls = true; audio.preload = "metadata"; audio.src = resolveActivePlayerSource(post); attachPersistentPlayerMediaListeners(audio); audioStage.append(label, title); shell.append(audioStage, audio); return shell;
}

function applyPersistentPlayerVariant(post, variant) {
  if (!state.activePlayerElement) return;
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") { state.activePlayerElement.className = variant === "viewer" ? (post.sourceKind === "youtube" ? "viewer-embed viewer-youtube" : "viewer-embed viewer-spotify") : (post.sourceKind === "youtube" ? "mini-player-embed mini-youtube" : "mini-player-embed mini-spotify"); state.activePlayerElement.height = post.sourceKind === "youtube" ? (variant === "viewer" ? "100%" : "192") : (variant === "viewer" ? "440" : "152"); return; }
  if (post.mediaKind === "video") { state.activePlayerElement.className = variant === "viewer" ? "viewer-media" : "mini-player-media"; return; }
  const audioStage = state.activePlayerElement.querySelector("[data-audio-stage]"); const audio = state.activePlayerElement.querySelector("[data-audio-player]");
  if (audioStage) audioStage.className = variant === "viewer" ? "audio-stage audio-stage-viewer" : "audio-stage audio-stage-mini";
  if (audio) audio.className = variant === "viewer" ? "viewer-audio" : "mini-player-audio";
}

function appendMedia(container, post, options = {}) {
  const { variant = "card", sourceResolver = resolvePostSource } = options; const source = sourceResolver(post);
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") { renderExternalMedia(container, post, variant); return; }
  if (post.mediaKind === "image") { const image = document.createElement("img"); image.loading = variant === "viewer" ? "eager" : "lazy"; image.alt = post.title; image.src = source; image.className = variant === "viewer" ? "viewer-media" : (variant === "mini" ? "mini-player-media" : ""); container.appendChild(image); return; }
  if (post.mediaKind === "video") { const video = document.createElement("video"); video.controls = true; video.preload = "metadata"; video.src = source; if (variant === "viewer") video.className = "viewer-media"; if (variant === "mini") video.className = "mini-player-media"; container.appendChild(video); return; }
  const audioStage = document.createElement("div"); audioStage.className = variant === "viewer" ? "audio-stage audio-stage-viewer" : (variant === "mini" ? "audio-stage audio-stage-mini" : "audio-stage"); const label = document.createElement("span"); label.textContent = variant === "spotlight" ? "Audio spotlight" : "Audio drop"; const title = document.createElement("strong"); title.textContent = post.title; audioStage.append(label, title); container.appendChild(audioStage);
  if (source) { const audio = document.createElement("audio"); audio.controls = true; audio.preload = "metadata"; audio.src = source; if (variant === "viewer") audio.className = "viewer-audio"; if (variant === "mini") audio.className = "mini-player-audio"; container.appendChild(audio); }
}

function renderExternalMedia(container, post, variant) {
  if (variant === "viewer") { const frame = document.createElement("iframe"); frame.className = post.sourceKind === "youtube" ? "viewer-embed viewer-youtube" : "viewer-embed viewer-spotify"; frame.src = post.embedUrl; frame.title = `${post.title} player`; frame.loading = "lazy"; frame.width = "100%"; frame.height = post.sourceKind === "youtube" ? "100%" : "440"; frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.setAttribute("allowfullscreen", ""); container.appendChild(frame); return; }
  if (variant === "mini") { const frame = document.createElement("iframe"); frame.className = post.sourceKind === "youtube" ? "mini-player-embed mini-youtube" : "mini-player-embed mini-spotify"; frame.src = post.embedUrl; frame.title = `${post.title} player`; frame.loading = "lazy"; frame.width = "100%"; frame.height = post.sourceKind === "youtube" ? "192" : "152"; frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.setAttribute("allowfullscreen", ""); container.appendChild(frame); return; }
  container.appendChild(createExternalPreviewStage({ provider: post.sourceKind, title: post.title, creator: post.creator, externalId: post.externalId ?? "", externalUrl: post.externalUrl ?? "", embedUrl: post.embedUrl ?? "" }, { variant, note: post.sourceKind === "youtube" ? "Video preview opens in the docked player." : "Music preview opens in the docked player." }));
}

function createExternalPreviewStage(source, options = {}) {
  const { variant = "card", note = "" } = options; const stage = document.createElement("div"); stage.className = `external-preview-card external-preview-card-${variant} external-preview-card-${source.provider}`;
  const image = document.createElement("img"); image.className = "external-preview-image"; image.alt = `${source.title} preview`; image.loading = variant === "spotlight" ? "eager" : "lazy"; image.referrerPolicy = "strict-origin-when-cross-origin";
  const overlay = document.createElement("div"); overlay.className = "external-preview-overlay"; const badge = document.createElement("span"); badge.className = "external-preview-badge"; badge.textContent = formatProviderName(source.provider); const title = document.createElement("strong"); title.className = "external-preview-title"; title.textContent = source.title; const description = document.createElement("p"); description.className = "external-preview-copy"; description.textContent = note || source.creator || "External media preview";
  overlay.append(badge, title, description); stage.append(image, overlay);
  if (source.provider === "youtube") { void applyExternalPreviewMetadata(stage, image, title, badge, source); loadPreviewImageCandidates(stage, image, resolveYouTubePreviewCandidates(source)); }
  else if (source.provider === "spotify") { 
    badge.textContent = "Loading Artist...";
    void applyExternalPreviewMetadata(stage, image, title, badge, source); 
  }
  return stage;
}

async function applyExternalPreviewMetadata(stage, image, titleElement, badgeElement, source) {
  const metadata = await getExternalPreviewMetadata(source); if (!stage.isConnected) return;
  const providerName = formatProviderName(source.provider);
  if (!metadata || metadata.error) {
    badgeElement.textContent = `${metadata?.error || "Error"} • ${providerName}`;
    return;
  }
  if (typeof metadata.title === "string" && metadata.title.trim()) { const previewTitle = metadata.title.trim(); titleElement.textContent = previewTitle; image.alt = `${previewTitle} preview`; }
  if (typeof metadata.creator === "string" && metadata.creator.trim()) {
    badgeElement.textContent = `${metadata.creator.trim()} • ${providerName}`;
  } else {
    badgeElement.textContent = providerName;
  }
  if (source.provider === "spotify" && typeof metadata.thumbnailUrl === "string" && metadata.thumbnailUrl.trim()) loadPreviewImageCandidates(stage, image, [metadata.thumbnailUrl.trim()]);
}

function loadPreviewImageCandidates(stage, image, candidates) {
  const urls = candidates.filter(Boolean); if (!urls.length) return;
  let index = 0; const tryNext = () => { if (index >= urls.length) { image.removeAttribute("src"); return; } const nextUrl = urls[index]; index += 1; image.onload = () => { stage.classList.add("has-image"); image.onload = null; image.onerror = null; }; image.onerror = () => { stage.classList.remove("has-image"); tryNext(); }; image.src = nextUrl; };
  tryNext();
}

async function loadSpotifyPreviewImage(stage, image, source) { const thumbnailUrl = await getSpotifyPreviewImageUrl(source); if (!stage.isConnected || !thumbnailUrl) return; loadPreviewImageCandidates(stage, image, [thumbnailUrl]); }
async function getExternalPreviewMetadata(source) { if (source.provider === "spotify") return getSpotifyPreviewMetadata(source); if (source.provider === "youtube") return getYouTubePreviewMetadata(source); return null; }

async function getSpotifyPreviewMetadata(source) {
  const sourceUrl = resolveSpotifyPreviewSourceUrl(source); if (!sourceUrl) return null;
  const cacheKey = `spotify:preview:v9:${sourceUrl}`; const cached = externalPreviewCache.get(cacheKey); if (cached && !(cached instanceof Promise)) return cached; if (cached instanceof Promise) return cached;
  const request = Promise.all([fetchSpotifyPreviewCatalogMetadata(source, sourceUrl), fetchSpotifyPreviewOEmbedMetadata(sourceUrl)]).then(([cat, oem]) => { 
    // Even if cat has an error, we try to use oem as a fallback
    const metadata = { 
      title: cat?.title || oem?.title || "", 
      creator: cat?.creator || oem?.creator || "", 
      thumbnailUrl: cat?.thumbnailUrl || oem?.thumbnailUrl || "",
      error: cat?.error && !oem?.title ? cat.error : null // Only show error if BOTH failed
    }; 
    const hasMetadata = Boolean(metadata.title || metadata.creator || metadata.thumbnailUrl); 
    return hasMetadata ? metadata : (metadata.error ? metadata : null); 
  }).then(result => {
    externalPreviewCache.set(cacheKey, result);
    return result;
  }).catch(() => { 
    externalPreviewCache.set(cacheKey, null); 
    return null; 
  });
  externalPreviewCache.set(cacheKey, request); return request;
}

async function fetchSpotifyPreviewCatalogMetadata(source, sourceUrl) { 
  if (!state.supabase || state.backendMode !== "supabase" || !state.currentUser) return { error: "Not Signed In" }; 
  const functionName = getSpotifyPreviewFunctionName(); 
  if (!functionName) return { error: "Config Missing" }; 
  try { 
    const { data, error } = await state.supabase.functions.invoke(functionName, { body: { url: sourceUrl, market: getSpotifyPreviewMarket() } }); 
    if (error) {
      console.error("[Spotify] Edge Function Error:", error);
      let msg = "API Error";
      if (error instanceof Error) msg = error.message;
      else if (typeof error === "object" && error.message) msg = error.message;
      return { error: msg };
    }
    if (!data || data.error) return { error: data?.error || "Empty Response" }; 
    return { title: typeof data.title === "string" ? data.title.trim() : "", creator: typeof data.creator === "string" ? data.creator.trim() : "", thumbnailUrl: typeof data.thumbnailUrl === "string" ? data.thumbnailUrl.trim() : "" }; 
  } catch (err) { return { error: "Network Error" }; } 
}
async function fetchSpotifyPreviewOEmbedMetadata(sourceUrl) { 
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(sourceUrl)}`).catch(() => null); 
  if (!response?.ok) return null; 
  const payload = await response.json().catch(() => null); 
  if (!payload || typeof payload !== "object") return null; 
  let creator = typeof payload.author_name === "string" ? payload.author_name.trim() : "";
  if (!creator && typeof payload.title === "string") {
    const title = payload.title.trim();
    const match = title.match(/^(.+?) - (?:song|album|playlist|artist) by (.+?)(?: \| Spotify)?$/i) || title.match(/^(.+?) by (.+?)(?: \| Spotify)?$/i);
    if (match && match[2]) creator = match[2].trim();
  }
  return { 
    title: typeof payload.title === "string" ? payload.title.trim() : "", 
    creator: creator, 
    thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url.trim() : "" 
  }; 
}
async function getSpotifyPreviewImageUrl(source) { const metadata = await getSpotifyPreviewMetadata(source); return typeof metadata?.thumbnailUrl === "string" ? metadata.thumbnailUrl : ""; }
function getSpotifyPreviewMarket() { const locale = (Array.isArray(navigator.languages) && navigator.languages[0]) || navigator.language || navigator.userLanguage || ""; const match = `${locale}`.trim().match(/[-_]([A-Za-z]{2})$/); return match ? match[1].toUpperCase() : "US"; }
function resolveYouTubePreviewCandidates(source) { const externalId = source.externalId || parseYouTubeUrl(source.externalUrl || source.embedUrl || source.originalUrl || "")?.externalId || ""; if (!externalId) return []; return [`https://i.ytimg.com/vi/${externalId}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${externalId}/sddefault.jpg`, `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`, `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`]; }

async function getYouTubePreviewMetadata(source) {
  const sourceUrl = resolveYouTubePreviewSourceUrl(source); if (!sourceUrl) return null;
  const cacheKey = `youtube:oembed:${sourceUrl}`; const cached = externalPreviewCache.get(cacheKey); if (cached && !(cached instanceof Promise)) return cached; if (cached instanceof Promise) return cached;
  const request = fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`).then((res) => (res.ok ? res.json() : null)).then((payload) => { const metadata = { title: typeof payload?.title === "string" ? payload.title.trim() : "", creator: typeof payload?.author_name === "string" ? payload.author_name.trim() : "" }; externalPreviewCache.set(cacheKey, metadata); return metadata; }).catch(() => { externalPreviewCache.set(cacheKey, null); return null; });
  externalPreviewCache.set(cacheKey, request); return request;
}

function resolveYouTubePreviewSourceUrl(source) { if (source.externalUrl) return source.externalUrl; if (source.originalUrl) return source.originalUrl; const externalId = source.externalId || parseYouTubeUrl(source.embedUrl || source.originalUrl || "")?.externalId || ""; return externalId ? `https://www.youtube.com/watch?v=${externalId}` : ""; }
function resolveSpotifyPreviewSourceUrl(source) { if (source.externalUrl) return source.externalUrl; if (source.originalUrl) return source.originalUrl; if (source.embedUrl) { try { const embedUrl = new URL(source.embedUrl); const segments = embedUrl.pathname.split("/").filter(Boolean); const typeIndex = segments[0] === "embed" ? 1 : 0; const type = segments[typeIndex]; const externalId = segments[typeIndex + 1] || source.externalId || ""; if (type && externalId) return `https://open.spotify.com/${type}/${externalId}`; } catch { return ""; } } return ""; }

function renderMiniPlayerVolumeControl() {
  const post = getPostById(state.playerPostId); const mediaElement = getActivePlayerMediaElement(); const hasNativeVolumeControl = mediaElement instanceof HTMLMediaElement; const supportsCustomVolume = hasNativeVolumeControl || post?.sourceKind === "youtube";
  elements.miniPlayerVolume.hidden = !supportsCustomVolume; elements.miniPlayerVolumeSlider.disabled = !supportsCustomVolume; elements.miniPlayerVolumeSlider.title = supportsCustomVolume ? "Adjust volume" : "";
  const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
  elements.miniPlayerVolumeSlider.value = `${volumePercent}`; elements.miniPlayerVolumeValue.textContent = `${volumePercent}%`;
}

function renderMiniPlayer() {
  if (!state.playerPostId) { state.playerDrag = null; elements.miniPlayer.classList.remove("is-open"); elements.miniPlayer.classList.remove("is-expanded"); elements.miniPlayer.classList.remove("is-dragging"); elements.miniPlayer.setAttribute("aria-hidden", "true"); elements.miniPlayerVolume.hidden = true; clearMiniPlayerMedia(); return; }
  const post = getPostById(state.playerPostId); if (!post || !isPlayablePost(post)) { closeMiniPlayer(); return; }
  const creatorSummary = getProfileSummaryForPost(post);
  elements.miniPlayer.classList.add("is-open"); elements.miniPlayer.classList.toggle("is-expanded", state.miniPlayerExpanded); elements.miniPlayer.setAttribute("aria-hidden", "false");
  elements.miniPlayerKind.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`; elements.miniPlayerTitle.textContent = post.title; elements.miniPlayerCaption.textContent = post.caption; elements.miniPlayerCreator.textContent = creatorSummary?.displayName ?? post.creator; elements.miniPlayerCreator.onclick = creatorSummary ? (event) => openProfileByKey(creatorSummary.key, event.currentTarget) : null; elements.miniPlayerTime.textContent = formatTimestamp(post.createdAt); elements.miniExpandButton.textContent = state.miniPlayerExpanded ? "Collapse" : "Expand";
  elements.miniPlayerTags.innerHTML = ""; post.tags.forEach((tag) => { const pill = document.createElement("span"); pill.className = "tag-pill"; pill.textContent = `#${tag}`; elements.miniPlayerTags.appendChild(pill); });
  const playableIds = getPlayableVisiblePostIds(); const canStep = playableIds.length > 1; elements.miniPrevButton.disabled = !canStep; elements.miniNextButton.disabled = !canStep;
  renderMiniPlayerMedia(elements.miniPlayerStage, post); renderMiniPlayerVolumeControl(); applyMiniPlayerPosition();
  window.requestAnimationFrame(() => { if (state.playerPostId === post.id) applyMiniPlayerPosition(); });
}

function renderViewer() {
  if (!state.viewerPostId && !state.viewerAttachment) { elements.viewer.classList.remove("is-open"); elements.viewer.setAttribute("aria-hidden", "true"); clearViewerMedia(); syncOverlayBodyState(); return; }
  if (state.viewerAttachment) {
    const attachment = state.viewerAttachment; clearViewerMedia(); elements.viewer.classList.add("is-open"); elements.viewer.setAttribute("aria-hidden", "false"); syncOverlayBodyState();
    renderViewerAttachmentMedia(elements.viewerStage, attachment); elements.viewerKind.textContent = `${attachment.kind === "video" ? "Video" : "Image"} / Direct message`; elements.viewerTitle.textContent = attachment.title; elements.viewerCaption.textContent = attachment.caption; elements.viewerCreator.textContent = attachment.creator; elements.viewerCreator.onclick = null; elements.viewerCreator.tabIndex = -1; elements.viewerCreator.setAttribute("aria-disabled", "true"); elements.viewerTime.textContent = formatMessageTimestamp(attachment.createdAt); elements.viewerCollapseButton.hidden = true; elements.viewerTags.innerHTML = ""; elements.viewerPrevButton.disabled = true; elements.viewerNextButton.disabled = true; return;
  }
  const post = getPostById(state.viewerPostId); if (!post) { closeViewer(); return; }
  const creatorSummary = getProfileSummaryForPost(post); clearViewerMedia(); elements.viewer.classList.add("is-open"); elements.viewer.setAttribute("aria-hidden", "false"); syncOverlayBodyState();
  renderViewerMedia(elements.viewerStage, post); elements.viewerKind.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`; elements.viewerTitle.textContent = post.title; elements.viewerCaption.textContent = post.caption; elements.viewerCreator.textContent = creatorSummary?.displayName ?? post.creator; elements.viewerCreator.tabIndex = creatorSummary ? 0 : -1; elements.viewerCreator.setAttribute("aria-disabled", creatorSummary ? "false" : "true"); elements.viewerCreator.onclick = creatorSummary ? (event) => openProfileByKey(creatorSummary.key, event.currentTarget) : null; elements.viewerTime.textContent = formatTimestamp(post.createdAt); elements.viewerCollapseButton.hidden = !isPlayablePost(post);
  elements.viewerTags.innerHTML = ""; post.tags.forEach((tag) => { const pill = document.createElement("span"); pill.className = "tag-pill"; pill.textContent = `#${tag}`; elements.viewerTags.appendChild(pill); });
  const canStep = state.visiblePostIds.length > 1; elements.viewerPrevButton.disabled = !canStep; elements.viewerNextButton.disabled = !canStep;
}

function renderProfileView() {
  if (!state.activeProfileKey) { elements.profileView.classList.remove("is-open"); elements.profileView.setAttribute("aria-hidden", "true"); syncOverlayBodyState(); return; }
  const profile = getProfileSummaryByKey(state.activeProfileKey); if (!profile) { state.activeProfileKey = ""; elements.profileView.classList.remove("is-open"); elements.profileView.setAttribute("aria-hidden", "true"); syncOverlayBodyState(); return; }
  const posts = getPostsForProfileKey(profile.key); const totalLikes = posts.reduce((sum, post) => sum + getLikeCount(post), 0); const latestPost = posts[0] ?? null; const isSelf = Boolean(profile.userId && profile.userId === state.currentUser?.id); const metaParts = [];
  if (canRevealMemberEmails() && profile.email) metaParts.push(profile.email);
  metaParts.push(isSelf ? "Your live profile" : "Live member profile"); if (profile.createdAt) metaParts.push(`Joined ${formatTimestamp(profile.createdAt)}`);
  elements.profileView.classList.add("is-open"); elements.profileView.setAttribute("aria-hidden", "false"); syncOverlayBodyState();
  elements.profileBadge.textContent = getProfileInitials(profile.displayName); elements.profileTitle.textContent = profile.displayName; elements.profileMeta.textContent = metaParts.join(" · ");
  elements.profileStats.innerHTML = "";
  [{ label: "Posts", value: String(posts.length) }, { label: "Likes", value: String(totalLikes) }, { label: latestPost ? "Latest" : "Status", value: latestPost ? formatTimestamp(latestPost.createdAt) : (isSelf ? "Ready to publish" : "No posts yet") }].forEach((stat) => { const card = document.createElement("div"); card.className = "profile-stat"; const value = document.createElement("strong"); value.className = "profile-stat-value"; value.textContent = stat.value; const label = document.createElement("span"); label.className = "profile-stat-label"; label.textContent = stat.label; card.append(value, label); elements.profileStats.appendChild(card); });
  elements.profileFeedGrid.innerHTML = "";
  const totalPosts = posts.length;
  const pageCount = Math.max(1, Math.ceil(totalPosts / FEED_POSTS_PER_PAGE));
  state.profileFeedPage = Math.min(Math.max(1, state.profileFeedPage), pageCount);
  const startIndex = (state.profileFeedPage - 1) * FEED_POSTS_PER_PAGE;
  const pagePosts = posts.slice(startIndex, startIndex + FEED_POSTS_PER_PAGE);
  pagePosts.forEach((post) => elements.profileFeedGrid.appendChild(createFeedCard(post)));
  elements.profileEmpty.hidden = totalPosts !== 0; elements.profileEmpty.textContent = isSelf ? "Your profile is ready. Publish to the live feed to populate it." : `${profile.displayName} has not posted to the live feed yet.`;
  const showPagination = totalPosts > FEED_POSTS_PER_PAGE;
  if (elements.profileFeedPagination) {
    elements.profileFeedPagination.hidden = !showPagination;
    elements.profileFeedPagination.innerHTML = "";
    if (showPagination) {
      const startNum = startIndex + 1;
      const endNum = Math.min(totalPosts, state.profileFeedPage * FEED_POSTS_PER_PAGE);
      const summary = document.createElement("p"); summary.className = "feed-pagination-summary"; summary.textContent = `Showing ${startNum}-${endNum} of ${totalPosts} uploads`;
      const controls = document.createElement("div"); controls.className = "feed-pagination-controls";
      const prevBtn = document.createElement("button"); prevBtn.type = "button"; prevBtn.className = "feed-page-button"; prevBtn.textContent = "Previous"; prevBtn.disabled = state.profileFeedPage === 1;
      prevBtn.addEventListener("click", () => { if (state.profileFeedPage > 1) { state.profileFeedPage -= 1; renderProfileView(); elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); } });
      const nextBtn = document.createElement("button"); nextBtn.type = "button"; nextBtn.className = "feed-page-button"; nextBtn.textContent = "Next"; nextBtn.disabled = state.profileFeedPage === pageCount;
      nextBtn.addEventListener("click", () => { if (state.profileFeedPage < pageCount) { state.profileFeedPage += 1; renderProfileView(); elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); } });
      controls.appendChild(prevBtn);
      for (let page = 1; page <= pageCount; page++) {
        const pageBtn = document.createElement("button"); pageBtn.type = "button"; pageBtn.className = "feed-page-button"; pageBtn.textContent = String(page);
        pageBtn.setAttribute("aria-label", `Go to page ${page}`); pageBtn.setAttribute("aria-pressed", page === state.profileFeedPage ? "true" : "false");
        if (page === state.profileFeedPage) pageBtn.classList.add("is-active");
        pageBtn.addEventListener("click", () => { if (state.profileFeedPage !== page) { state.profileFeedPage = page; renderProfileView(); elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); } });
        controls.appendChild(pageBtn);
      }
      controls.appendChild(nextBtn); elements.profileFeedPagination.append(summary, controls);
    }
  }
}

function openOwnProfile(event) { const profileKey = getOwnProfileKey(); if (profileKey) openProfileByKey(profileKey, event?.currentTarget ?? elements.openOwnProfileButton); }
function openProfileByKey(profileKey, returnFocusElement) { const profile = getProfileSummaryByKey(profileKey); if (!profile) return; if (state.viewerPostId || state.viewerAttachment) closeViewer({ restoreFocus: false }); state.activeProfileKey = profile.key; state.profileReturnFocusElement = returnFocusElement ?? document.activeElement; state.profileFeedPage = 1; renderProfileView(); elements.profileCloseButton.focus(); }
function closeProfile(options = {}) { const { restoreFocus = true } = options; if (!state.activeProfileKey) return; state.activeProfileKey = ""; elements.profileView.classList.remove("is-open"); elements.profileView.setAttribute("aria-hidden", "true"); syncOverlayBodyState(); if (restoreFocus && state.profileReturnFocusElement instanceof HTMLElement) state.profileReturnFocusElement.focus(); state.profileReturnFocusElement = null; }
function openViewer(postId, returnFocusElement) { if (state.activeProfileKey) closeProfile({ restoreFocus: false }); if (isPlayablePost(getPostById(postId))) { state.playerPostId = postId; state.miniPlayerExpanded = true; state.returnFocusElement = returnFocusElement ?? document.activeElement; renderMiniPlayer(); elements.miniExpandButton.focus(); return; } state.viewerAttachment = null; state.viewerPostId = postId; state.returnFocusElement = returnFocusElement ?? document.activeElement; renderViewer(); elements.viewerCloseButton.focus(); }
function closeViewer(options = {}) { const { restoreFocus = true } = options; if (!state.viewerPostId && !state.viewerAttachment) return; state.viewerPostId = null; state.viewerAttachment = null; elements.viewer.classList.remove("is-open"); elements.viewer.setAttribute("aria-hidden", "true"); clearViewerMedia(); syncOverlayBodyState(); if (restoreFocus && state.returnFocusElement instanceof HTMLElement) state.returnFocusElement.focus(); state.returnFocusElement = null; renderMiniPlayer(); }

function stepViewer(delta) {
  if (state.visiblePostIds.length <= 1 || !state.viewerPostId) return;
  const currentIndex = state.visiblePostIds.indexOf(state.viewerPostId); const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + state.visiblePostIds.length) % state.visiblePostIds.length;
  const nextPostId = state.visiblePostIds[nextIndex]; if (isPlayablePost(getPostById(nextPostId))) { state.viewerPostId = null; state.playerPostId = nextPostId; state.miniPlayerExpanded = true; elements.viewer.classList.remove("is-open"); elements.viewer.setAttribute("aria-hidden", "true"); clearViewerMedia(); syncOverlayBodyState(); renderMiniPlayer(); return; }
  state.viewerPostId = nextPostId; renderViewer();
}

function openMiniPlayer(postId, returnFocusElement) { const post = getPostById(postId); if (!post) return; if (state.activeProfileKey) closeProfile({ restoreFocus: false }); if (!isPlayablePost(post)) { openViewer(postId, returnFocusElement); return; } state.playerPostId = postId; state.miniPlayerExpanded = false; state.returnFocusElement = returnFocusElement ?? document.activeElement; renderMiniPlayer(); }
function expandMiniPlayer() { if (state.playerPostId) { state.miniPlayerExpanded = !state.miniPlayerExpanded; renderMiniPlayer(); } }
function collapseViewerToPlayer() { if (!state.viewerPostId) return; state.playerPostId = state.viewerPostId; state.miniPlayerExpanded = false; state.viewerPostId = null; elements.viewer.classList.remove("is-open"); elements.viewer.setAttribute("aria-hidden", "true"); clearViewerMedia(); syncOverlayBodyState(); renderMiniPlayer(); }
function closeMiniPlayer() { state.playerPostId = null; state.miniPlayerExpanded = false; state.playerDrag = null; elements.miniPlayer.classList.remove("is-open"); elements.miniPlayer.classList.remove("is-expanded"); elements.miniPlayer.classList.remove("is-dragging"); elements.miniPlayer.setAttribute("aria-hidden", "true"); elements.miniPlayerVolume.hidden = true; clearMiniPlayerMedia(); destroyActivePlayer(); }
function handleMiniPlayerStageClick(event) { if (!event.target.closest("iframe, video, audio") && !state.miniPlayerExpanded) expandMiniPlayer(); }
function handleMiniPlayerVolumeInput(event) { state.playerVolume = normalizePlayerVolume(Number(event.target.value) / 100, state.playerVolume); savePlayerVolume(state.playerVolume); applyPlayerVolumeToActiveElement(); renderMiniPlayerVolumeControl(); }
function getPlayableVisiblePostIds() { return state.visiblePostIds.filter((id) => isPlayablePost(getPostById(id))); }
function stepMiniPlayer(delta) { const playableIds = getPlayableVisiblePostIds(); if (playableIds.length <= 1 || !state.playerPostId) return; const currentIndex = playableIds.indexOf(state.playerPostId); const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + playableIds.length) % playableIds.length; state.playerPostId = playableIds[nextIndex]; renderMiniPlayer(); }

function renderPreview(file) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = URL.createObjectURL(file); elements.previewShell.hidden = false; elements.previewShell.innerHTML = "";
  const wrapper = document.createElement("div"); wrapper.className = "preview-card"; const mediaKind = getMediaKind(file.type); let mediaElement;
  if (mediaKind === "image") { mediaElement = document.createElement("img"); mediaElement.className = "preview-media"; mediaElement.alt = file.name; mediaElement.src = state.previewUrl; }
  else if (mediaKind === "video") { mediaElement = document.createElement("video"); mediaElement.className = "preview-media"; mediaElement.controls = true; mediaElement.src = state.previewUrl; }
  else { mediaElement = document.createElement("audio"); mediaElement.className = "preview-media"; mediaElement.controls = true; mediaElement.src = state.previewUrl; }
  const meta = document.createElement("div"); meta.className = "preview-meta"; const name = document.createElement("span"); name.textContent = file.name; const size = document.createElement("span"); size.textContent = formatFileSize(file.size); meta.append(name, size); wrapper.append(mediaElement, meta); elements.previewShell.appendChild(wrapper);
}

function renderExternalPreview(parsedExternal) {
  clearPreviewOnly(); elements.previewShell.hidden = false; const wrapper = document.createElement("div"); wrapper.className = "preview-card"; const stage = createExternalPreviewStage({ provider: parsedExternal.provider, title: parsedExternal.label, creator: "", externalId: parsedExternal.externalId ?? "", externalUrl: parsedExternal.originalUrl ?? "", embedUrl: parsedExternal.embedUrl ?? "", originalUrl: parsedExternal.originalUrl ?? "" }, { variant: "preview", note: "The post will open in the docked player and can expand inside the same panel." });
  const meta = document.createElement("div"); meta.className = "preview-meta"; const type = document.createElement("span"); type.textContent = `${formatProviderName(parsedExternal.provider)} / ${parsedExternal.mediaKind}`; const url = document.createElement("span"); url.textContent = "External embed"; meta.append(type, url); wrapper.append(stage, meta); elements.previewShell.appendChild(wrapper);
}

function clearPreviewOnly() { elements.previewShell.hidden = true; elements.previewShell.innerHTML = ""; if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ""; } }

function updateSourceHelp(sourceKind) {
  const adminUploadAccess = state.backendMode !== "supabase" || isCurrentUserAdmin();
  const noneCopy = adminUploadAccess ? "Use one source per post: upload a file, or paste a YouTube / Spotify link." : "Use one source per post. YouTube and Spotify links are open to everyone, while uploaded images, videos, and audio are admin-only.";
  const uploadCopy = adminUploadAccess ? "Uploaded images, videos, and audio publish directly. Video and audio posts open in the docked player." : "Uploaded media is reserved for admins on the live feed. Non-admin accounts can post YouTube and Spotify links.";
  const copy = { none: noneCopy, upload: uploadCopy, youtube: "YouTube links publish as embedded video posts and stay open to non-admin accounts.", spotify: "Spotify links publish as embedded audio posts.", invalid: "Paste a valid YouTube or Spotify link, or clear the field and upload a file instead." };
  elements.sourceHelp.textContent = copy[sourceKind] ?? copy.none;
}

function updateActiveFilterChip() { elements.filterRow.querySelectorAll("[data-filter]").forEach((chip) => { const isActive = chip.dataset.filter === state.filter; chip.classList.toggle("is-active", isActive); chip.setAttribute("aria-pressed", isActive ? "true" : "false"); }); }

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
function showFeedback(message, isError = false) { elements.formFeedback.textContent = message; elements.formFeedback.classList.toggle("is-error", isError); }
function resetComposer() { elements.postForm.reset(); clearSelectedMedia(); state.previewExternal = null; hydrateRememberedCreator(); updateSourceHelp("none"); showFeedback(""); }
function loadLikedPosts() { return loadScopedPostIds(LIKED_POSTS_KEY); }
function loadSavedPosts() { try { return JSON.parse(localStorage.getItem(SAVED_POSTS_KEY) ?? "[]"); } catch { return []; } }
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
function buildExternalPost(base, parsed) { return { ...base, mediaKind: parsed.mediaKind, sourceKind: parsed.provider, provider: parsed.provider, externalUrl: parsed.originalUrl, embedUrl: parsed.embedUrl, externalId: parsed.externalId, label: parsed.label, isLocal: state.backendMode !== "supabase" }; }

function parseExternalMediaUrl(raw) {
  if (!raw) return null;
  const youtube = parseYouTubeUrl(raw); if (youtube) return youtube;
  const spotify = parseSpotifyUrl(raw); if (spotify) return spotify;
  return null;
}

function parseYouTubeUrl(raw) {
  let url; try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^www\./, ""); let videoId = "";
  if (host === "youtu.be") videoId = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "m.youtube.com") { if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? ""; else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/")[2] ?? ""; }
  if (!videoId) return null;
  return { provider: "youtube", mediaKind: "video", externalId: videoId, embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0`, originalUrl: raw, label: `YouTube video ${videoId}` };
}

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