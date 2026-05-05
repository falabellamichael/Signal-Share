import { createSupabaseClient, loadPostsFromSupabase, loadLikedPostsFromSupabase, publishPostToSupabase, compressImageFile, uploadFileToSupabase, uploadMessageAttachment, deleteHostedPost, normalizeSupabasePost, parseYouTubeUrl, openDatabase, loadPostsFromDatabase, savePostToDatabase, deletePostFromDatabase, setApiContext } from './api-v3.js?v=92';
import { createAppUi } from './app-v3-ui.js?v=96';



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
const THEME_OPTIONS = Object.freeze([
  { value: "sunset", label: "Sunset", description: "Warm default" },
  { value: "midnight", label: "Midnight", description: "Dark mode" },
  { value: "gallery", label: "Gallery", description: "Neutral light" },
  { value: "aurora", label: "Aurora", description: "Cool studio" },
  { value: "contrast", label: "High Contrast", description: "Blackout with sharp signal colors" },
  { value: "ember", label: "Ember Red", description: "Deep red companion glow" },
]);
const THEME_VALUES = new Set(THEME_OPTIONS.map((option) => option.value));
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

const {
  elements, attachEventListeners, render, renderStats, renderAccountState,
  setMessengerStatus, renderMessengerDock, syncMessengerDockScrollState, renderMessenger, focusMessengerPrimaryControl,
  openMessengerDock, collapseMessengerDock, closeMessengerDock, toggleMessengerExpansion, handleMessengerLauncherClick,
  handleMessagesNavClick, handleMessengerMinimizeClick, handleExpandedMessengerOutsideClick, renderAdminBanPanel, renderAdminBanList,
  getFilteredAdminBanProfiles, showAdminBanFeedback, handleAdminBanLauncherClick, closeAdminBanPanel, renderPeopleList,
  renderConversationList, renderActiveThread, showProfileFeedback, showMessengerFeedback, renderMessageEmojiPanel,
  toggleMessageEmojiPicker, closeMessageEmojiPicker, handleMessageEmojiPanelClick, insertEmojiIntoMessage, handleMessageAttachmentInputChange,
  handleMessageAttachmentSelection, clearMessageAttachmentSelection, renderMessageAttachmentPreview, getMessageSenderLabel, createMessageAttachmentPreviewNode,
  createMessageAttachmentNode, createMessageAttachmentTrigger, openMessageAttachmentViewer, createMessageFileNode, getMessageAttachmentKind,
  formatAttachmentTypeLabel, syncComposerCreatorWithAccount, updateComposerAccess, setStatusPill, showAuthFeedback,
  applyUserPreferences, openSettingsPanel, closeSettingsPanel, toggleSettingsPanel, renderSettingsPanel,
  openNotificationsPanel, closeNotificationsPanel, renderKeyboardShortcuts, handleThemeOptionClick, handleDensityChange,
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
  refreshLikedPostsState, isAdminRestrictedUploadKind, canCurrentUserUploadMediaKind, getRestrictedUploadMessage, canDeletePost,
  getAuthRedirectUrl, normalizeModerationText, getActiveBlockedTerms, normalizePostModerationText, normalizePostModerationTextSafe,
  findBlockedPostTerm, isPostModerationError, getSiteSettingsPayload, normalizeSiteSettings, clampNumber,
  loadPlayerPosition, normalizePlayerVolume, loadPlayerVolume, savePlayerVolume, savePlayerPosition,
  getPlayerViewportPadding, clampPlayerPosition, loadSiteSettingsFromSupabase, handleAdminSettingsSubmit, getAllPosts,
  getVisiblePosts, getKnownProfiles, getKnownProfileById, getProfileKeyForUser, getProfileKeyForCreator,
  getProfileKeyForPost, getOwnProfileKey, getProfileSummaryForPost, getPostsForProfileKey, getProfileSummaryByKey,
  getProfileBoardEntries, sortPosts, isPlayablePost, deletePost, toggleLike,
  toggleSave, loadLikedPosts, loadSavedPosts, resolvePostSource, cleanupObjectUrls,
  getLikeCount, formatKind, getSignalLabel, isFreshFeedPost, isPostFromToday,
  getLatestPostedPostId, formatTimestamp, formatFileSize, parseTags, getMediaKind,
  resolveViewerSource, resolveActivePlayerSource, compareByNewest, getSpotlightPost, getPostById,
  isPostSaved, rememberCreatorInput, rememberCreator, buildUploadPost, buildExternalPost,
  parseExternalMediaUrl, healPosts, parseSpotifyUrl, formatProviderName, isHostedPostingEnabled,
  getAppConfig, updatePostLikeCount, createDemoGraphic,
});


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
        if (window.notifications && typeof window.notifications.add === "function") {
          const threadId = notification?.data?.threadId ?? "";
          const messageId = String(notification?.data?.messageId ?? "").trim();
          const title = trimNotificationText(notification?.title || notification?.data?.title || "New message", 80) || "New message";
          const body = trimNotificationText(notification?.body || notification?.data?.body || "New direct message", 160) || "New direct message";
          window.notifications.add({
            id: messageId || `native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            type: "info",
            title,
            message: body,
            threadId,
            data: { type: "message", threadId },
            silent: true,
          });
        }
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
  if (state.currentUser && isMessagingEnabled(state)) void safelyEnsurePushNotificationRegistration({ prompt: shouldPromptForPushNotificationsOnNativeApp() });
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





function clearMessengerState() {
  unsubscribeMessagingChannels();
  state.profileRecord = null; state.availableProfiles = []; state.blockedUserIds = []; state.bannedUserIds = []; state.blockingAvailable = true; state.banningAvailable = true; state.peopleSearch = ""; state.adminBanSearch = ""; state.conversationSearch = ""; state.directThreads = []; state.activeThreadId = null; state.activeMessages = []; state.pendingBlockUserId = ""; state.pendingBanUserId = ""; state.pendingDeleteThreadId = ""; state.adminBanPanelOpen = false; state.adminBanBusy = false; state.adminBanFeedback = ""; state.adminBanFeedbackIsError = false;  state.messengerBusy = 0; state.messengerError = "";
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
  const email = state.currentUser?.email ?? ""; const localPart = email.split("@")[0] ?? "Member"; const prettyName = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return prettyName ? prettyName.slice(0, 40) : "Member";
}
function formatDisplayNameFromEmail(email = "") { const localPart = String(email ?? "").trim().split("@")[0] ?? ""; const prettyName = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); return prettyName ? prettyName.slice(0, 40) : ""; }
function resolveMemberDisplayName(profile, fallback = "Member") { if (!profile || typeof profile !== "object") return fallback; const displayName = String(profile.displayName ?? "").trim(); if (displayName && !normalizeEmailForMatch(displayName).includes("@")) return displayName.slice(0, 40); const prettyEmailName = formatDisplayNameFromEmail(profile.email); return prettyEmailName || (displayName ? displayName.slice(0, 40) : fallback); }
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
      theme: state.preferences.theme, density: state.preferences.density, motion: state.preferences.motion, status_bar_strip: state.preferences.statusBarStrip, notification_hide_sender: state.preferences.notificationHideSender,
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
window.playIncomingMessageSound = playIncomingMessageSound;
window.mergeActiveMessage = mergeActiveMessage;
window.renderActiveThread = renderActiveThread;
window.refreshMessengerState = refreshMessengerState;

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
      const targetChannelName = `messenger_live_${recipientId.slice(0, 8)}`;
      
      const tempChannel = state.supabase.channel(targetChannelName);
      tempChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          tempChannel.send({
            type: "broadcast",
            event: "new-message",
            payload: { payload: {
              id: messageId,
              thread_id: state.activeThreadId,
              sender_id: state.currentUser.id,
              body: body || null,
              created_at: new Date().toISOString(),
              ...attachmentPayload
            }}
          }).then(() => {
            // Cleanup the temporary sending channel
            setTimeout(() => tempChannel.unsubscribe(), 5000);
          });
        }
      });
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
  return { theme, density, motion, statusBarStrip, notificationHideSender, notificationHideBody };
}

function saveUserPreferences() { try { localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(state.preferences)); } catch {} }






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
function persistScopedPostIds(baseKey, ids, scope = getPersonalStateScope()) { const normalizedIds = Array.isArray(ids) ? ids.filter((v) => typeof v === "string" && v.trim()) : []; try { localStorage.setItem(getScopedStorageKey(baseKey, scope), JSON.stringify(normalizedIds)); if (scope === "guest") localStorage.removeItem(baseKey); } catch {} }

async function refreshLikedPostsState() {
  if (state.supabase && state.backendMode === "supabase" && state.currentUser) { try { state.likedPosts = await loadLikedPostsFromSupabase(); return; } catch (error) { console.error("Like state could not be loaded from Supabase", error); } }
  state.likedPosts = loadLikedPosts();
}

function isAdminRestrictedUploadKind(mediaKind) { return mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"; }
function canCurrentUserUploadMediaKind(mediaKind) { if (state.backendMode !== "supabase") return true; if (!isAdminRestrictedUploadKind(mediaKind)) return true; return isCurrentUserAdmin(); }
function getRestrictedUploadMessage(mediaKind) { if (mediaKind === "image") return "Only admin accounts can publish uploaded images to the live feed. YouTube and Spotify links stay open."; if (mediaKind === "video") return "Only admin accounts can publish uploaded videos to the live feed. YouTube links stay available to everyone."; if (mediaKind === "audio") return "Only admin accounts can publish uploaded audio to the live feed. Spotify and YouTube links stay open."; return "Only admin accounts can publish that upload type to the live feed."; }

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




function isPlayablePost(post) { if (!post) return false; return post.mediaKind === "video" || post.mediaKind === "audio" || post.sourceKind === "youtube" || post.sourceKind === "spotify"; }

































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
function formatKind(kind) { return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} post`; }
function getSignalLabel(post) { if (isFreshFeedPost(post)) return "Fresh in feed"; const likes = getLikeCount(post); if (likes >= 20) return "High signal"; if (likes >= 10) return "Building momentum"; return "Live on feed"; }
function isFreshFeedPost(post) { if (!post) return false; return isPostFromToday(post) || post.id === getLatestPostedPostId(); }
function isPostFromToday(post) { const postDate = new Date(post.createdAt); if (Number.isNaN(postDate.getTime())) return false; const today = new Date(); return postDate.getFullYear() === today.getFullYear() && postDate.getMonth() === today.getMonth() && postDate.getDate() === today.getDate(); }
function getLatestPostedPostId() { const posts = getAllPosts(); if (!posts.length) return ""; let latestPost = posts[0], latestTime = new Date(latestPost.createdAt).getTime(); for (const candidate of posts.slice(1)) { const candidateTime = new Date(candidate.createdAt).getTime(); if (!Number.isNaN(candidateTime) && (Number.isNaN(latestTime) || candidateTime > latestTime)) { latestPost = candidate; latestTime = candidateTime; } } return latestPost?.id ?? ""; }
function formatTimestamp(iso) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)); }
function formatFileSize(size) { if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`; return `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function parseTags(raw) { return raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 6); }
function getMediaKind(type) { if (type.startsWith("image/")) return "image"; if (type.startsWith("video/")) return "video"; return "audio"; }
function resolveViewerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = URL.createObjectURL(post.blob); return state.viewerUrl; } return ""; }
function resolveActivePlayerSource(post) { if (post.src) return post.src; if (post.blob) { if (state.activePlayerUrl) URL.revokeObjectURL(state.activePlayerUrl); state.activePlayerUrl = URL.createObjectURL(post.blob); return state.activePlayerUrl; } return ""; }


function compareByNewest(l, r) { return new Date(r.createdAt).getTime() - new Date(l.createdAt).getTime(); }
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




