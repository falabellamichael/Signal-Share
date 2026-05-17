import { createHeroMediaPlayerController } from "./hero-media-player.js?v=1.4";
import { createPreviewCard, createActivePlayerStage, createActivePlayerDescriptor, resolveAppPreviewArtwork, resolveYouTubePreviewId } from "./hero-media-player-preview.js";
import { EMOJI_PACK, EMOJI_CATEGORIES } from "./emojis.js";
import { isDirectMessengerAiEnabled, isDirectMessengerAiProfile } from "./direct-messenger-ai-config.js";

export function createAppUi(context) {
  const {
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
    normalizeEmailForMatch, getCurrentUserEmailCandidates, isCurrentUserAdmin, isCurrentUserMasterAdmin, canRevealMemberEmails, canUseLiveLikesForPost,
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
    getMessageAttachmentKind, formatPostBadge, formatPostMeta, resolveViewerSource, resolveActivePlayerSource, compareByNewest, getSpotlightPost, getPostById,
    isPostSaved, rememberCreatorInput, rememberCreator, buildUploadPost, buildExternalPost,
    parseExternalMediaUrl, healPosts, parseSpotifyUrl, isHostedPostingEnabled,
    getAppConfig, updatePostLikeCount, createDemoGraphic,
  } = context;

  const HERO_POST_KEY = "signal-share-hero-player-post-id";

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
    keyboardShortcutsPanel: document.querySelector("#keyboardShortcutsPanel"),
    keyboardShortcutsBackdrop: document.querySelector("#keyboardShortcutsBackdrop"),
    keyboardShortcutsCloseButton: document.querySelector("#keyboardShortcutsCloseButton"),
    settingsMainPage: document.querySelector("#settingsMainPage"),
    shortcutsList: document.querySelector("#shortcutsList"),
    themePicker: document.querySelector("#themePicker"),
    themePickerButton: document.querySelector("#themePickerButton"),
    themePickerMenu: document.querySelector("#themePickerMenu"),
    themePickerPreview: document.querySelector("#themePickerPreview"),
    themePickerLabel: document.querySelector("#themePickerLabel"),
    themePickerDescription: document.querySelector("#themePickerDescription"),
    densitySelect: document.querySelector("#densitySelect"),
    motionSelect: document.querySelector("#motionSelect"),
    statusBarStripToggle: document.getElementById("statusBarStripToggle"),
    notificationHideSenderToggle: document.getElementById("notificationHideSenderToggle"),
    notificationHideBodyToggle: document.getElementById("notificationHideBodyToggle"),
    showEmailToggle: document.getElementById("showEmailToggle"),
    bridgeSecretInput: document.getElementById("bridgeSecretInput"),
    bridgeUrlInput: document.getElementById("bridgeUrlInput"),
    localLlmTokenInput: document.getElementById("localLlmTokenInput"),
    aiCustomInstructionsInput: document.getElementById("aiCustomInstructionsInput"),
    resetPlayerPositionButton: document.getElementById("resetPlayerPositionButton"),
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
    viewerZoomControls: document.querySelector("#viewerZoomControls"),
    viewerZoomLevel: document.querySelector("#viewerZoomLevel"),
    viewerZoomIn: document.querySelector("#viewerZoomIn"),
    viewerZoomOut: document.querySelector("#viewerZoomOut"),
    viewerZoomReset: document.querySelector("#viewerZoomReset"),
    viewerMediaScroller: document.querySelector("#viewerMediaScroller"),
    viewerMediaContainer: document.querySelector("#viewerMediaContainer"),
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
    miniPlayPauseButton: document.querySelector("#miniPlayPauseButton"),
    miniNextButton: document.querySelector("#miniNextButton"),
    heroPlayerHeader: document.querySelector("#heroPlayerHeader"),
    heroPlayerTitle: document.querySelector("#heroPlayerTitle"),
    heroPlayerCaption: document.querySelector("#heroPlayerCaption"),
    heroPlayerStatus: document.querySelector("#heroPlayerStatus"),
    heroPlayerStage: document.querySelector("#heroPlayerStage"),
    heroPlayerPlayPauseButton: document.querySelector("#heroPlayerPlayPauseButton"),
    heroPlayerPrevButton: document.querySelector("#heroPlayerPrevButton"),
    heroPlayerNextButton: document.querySelector("#heroPlayerNextButton"),
    heroPlayerOpenMediaButton: document.querySelector("#heroPlayerOpenMediaButton"),
    heroPlayerVolumeSlider: document.querySelector("#heroPlayerVolumeSlider"),
    heroPlayerVolumeValue: document.querySelector("#heroPlayerVolumeValue"),
    heroPlayerOpenMiniButton: document.querySelector("#heroPlayerOpenMiniButton"),
    heroModeFeed: document.querySelector("#heroModeFeed"),
    heroModeMedia: document.querySelector("#heroModeMedia"),
    heroSourceYoutube: document.querySelector("#heroSourceYoutube"),
    heroSourceSpotify: document.querySelector("#heroSourceSpotify"),
    heroPlayerOpenPhoneButton: document.querySelector("#heroPlayerOpenPhoneButton"),
    heroPlayerRefreshButton: document.querySelector("#heroPlayerRefreshButton"),
    miniRefreshButton: document.querySelector("#miniRefreshButton"),
  };

  let lastMediaActionAt = 0;
  const MEDIA_ACTION_COOLDOWN_MS = 280;

  function checkMediaCooldown() {
    const now = Date.now();
    if (now - lastMediaActionAt < MEDIA_ACTION_COOLDOWN_MS) return false;
    lastMediaActionAt = now;
    return true;
  }

  const OVERLAY_SCROLL_CONTAINER_SELECTOR = [
    ".settings-dialog",
    ".viewer-dialog",
    ".profile-view-dialog",
    ".messenger-section",
    ".admin-ban-panel",
    ".mini-player",
    ".message-list",
    "#notificationsList",
  ].join(",");

  let activeOverlayScrollContainer = null;
  let activeOverlayTouchY = 0;
  let feedScrollObserver = null;

  function initializeFeedScrollObserver() {
    if (feedScrollObserver || !window.IntersectionObserver) return;
    feedScrollObserver = new IntersectionObserver((entries) => {
      if (state.activePlayerPostId) return; // Don't override preview if something is actually playing

      let mostVisibleEntry = null;
      let maxRatio = 0;

      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
          maxRatio = entry.intersectionRatio;
          mostVisibleEntry = entry;
        }
      }

      if (mostVisibleEntry && mostVisibleEntry.intersectionRatio > 0.25) {
        const postId = mostVisibleEntry.target.dataset.postId;
        if (postId && state.activeFeedPostId !== postId) {
          state.activeFeedPostId = postId;
          heroMediaPlayerController.render();
        }
      }
    }, {
      root: null,
      threshold: [0, 0.25, 0.5, 0.75, 1.0]
    });
  }

  function getFallbackPageMediaElement() {
    // Find any active media element on the page that isn't our primary player
    const candidates = Array.from(document.querySelectorAll("video, audio"));
    return candidates.find(el => {
      if (el === state.activePlayerElement) return false;
      if (el.closest("#heroPlayerStage")) return false;
      return !el.paused || el.currentTime > 0;
    }) || null;
  }

  function getBrowserMediaMetadata() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.metadata) return null;
    const meta = navigator.mediaSession.metadata;
    return {
      title: meta.title,
      artist: meta.artist,
      artwork: meta.artwork?.[0]?.src || ""
    };
  }

  function getStandbyPreviewPost() {
    // Pick the most recent playable post from the feed that matches the current source
    const posts = getAllPosts() || [];
    const isFeedMode = state.heroControlMode === "feed";
    const source = (state.heroControlSource || state.heroMediaSource || "").toLowerCase();

    if (source === "youtube" || source === "spotify") {
      const matched = posts.filter(p => isPlayablePost(p) && p.sourceKind === source);
      if (matched.length > 0) return matched[0];

      // If we are strictly in a media platform mode and no match exists, return null
      // to avoid bleed-through from unrelated feed items on the YouTube/Spotify stage.
      return null;
    }

    // In 'All' mode, or if no source is selected, use the general playable feed.
    const playable = posts.filter(p => isPlayablePost(p) && p.id !== state.playerPostId);
    return playable[0] || null;
  }

  function sanitizeSnapshotMeta(text) {
    if (typeof text !== "string") return "";
    return text
      .replace(/^(Spotify|YouTube|Chrome|Edge|Firefox)\s*[-·|]\s*/i, "")
      .replace(/\s*[-·|]\s*Signal\s*Share\s*$/i, "")
      .trim();
  }

  function formatProviderName(kind = "") {
    const k = `${kind || ""}`.trim().toLowerCase();
    if (k === "youtube") return "YouTube";
    if (k === "spotify") return "Spotify";
    return k.charAt(0).toUpperCase() + k.slice(1);
  }

  function getExternalPreviewMetadata(post) {
    if (!post) return null;
    if (post.sourceKind === "youtube") {
      return getYouTubePreviewMetadata(post);
    }
    if (post.sourceKind === "spotify") {
      const sourceUrl = resolveSpotifyPreviewSourceUrl(post);
      if (!sourceUrl) return null;
      return getSpotifyPreviewMetadata(post);
    }
    return null;
  }

  async function getSpotifyPreviewImageUrl(source) {
    const sourceUrl = resolveSpotifyPreviewSourceUrl(source);
    if (!sourceUrl) return "";
    const cacheKey = `spotify:preview:v10:${sourceUrl}`;
    const cached = externalPreviewCache.get(cacheKey);
    if (cached && !(cached instanceof Promise)) return cached.thumbnailUrl || "";

    // If not in cache or in progress, trigger a fetch
    try {
      const metadata = await getSpotifyPreviewMetadata(source);
      return metadata?.thumbnailUrl || "";
    } catch {
      return "";
    }
  }

  const heroMediaPlayerController = createHeroMediaPlayerController({
    state,
    elements,
    getControllablePlayerPost,
    getActivePlayerMediaElement,
    getFallbackPageMediaElement,
    getBrowserMediaMetadata,
    getStandbyPreviewPost,
    sanitizeSnapshotMeta,
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
    getExternalPreviewMetadata,
    formatProviderName,
    getHeroPost,
    setHeroPost,
    playHeroMedia,
    stepHeroPlayer,
    getHeroPlayablePosts,
    resolveYouTubePreviewId,
    isNativeCapacitorApp,
    getCapacitorPlatform,
    openViewer,
    mountPersistentPlayer,
    destroyActivePlayer,
    onStatusChange: render,
    setHeroControlMode
  });

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

    // Listeners for bell button are now handled inline in index.html to prevent conflicts
    if (elements.keyboardShortcutsButton) elements.keyboardShortcutsButton.addEventListener("click", () => window.openKeyboardShortcutsPanel && window.openKeyboardShortcutsPanel());
    if (elements.keyboardShortcutsBackdrop) elements.keyboardShortcutsBackdrop.addEventListener("click", () => window.closeKeyboardShortcutsPanel && window.closeKeyboardShortcutsPanel());
    if (elements.keyboardShortcutsCloseButton) elements.keyboardShortcutsCloseButton.addEventListener("click", () => window.closeKeyboardShortcutsPanel && window.closeKeyboardShortcutsPanel());

    if (elements.notificationsBackdrop) elements.notificationsBackdrop.addEventListener("click", handleNotificationsBackdropClick);
    if (elements.notificationsCloseButton) elements.notificationsCloseButton.addEventListener("click", closeNotificationsPanel);
    if (elements.clearNotificationsButton) elements.clearNotificationsButton.addEventListener("click", () => {
      if (window.notifications) window.notifications.clearHistory();
      if (window.renderNotificationsHistory) window.renderNotificationsHistory();
    });
    elements.themePickerButton?.addEventListener("click", toggleThemePicker);
    elements.themePickerMenu?.addEventListener("click", handleThemeOptionClick);
    elements.densitySelect.addEventListener("change", handleDensityChange);
    elements.motionSelect.addEventListener("change", handleMotionChange);
    elements.statusBarStripToggle.addEventListener("change", handleStatusBarStripToggle);
    elements.notificationHideSenderToggle.addEventListener("change", handleNotificationHideSenderToggle);
    elements.notificationHideBodyToggle.addEventListener("change", handleNotificationHideBodyToggle);
    elements.showEmailToggle.addEventListener("change", handleShowEmailToggle);

    const syncBridgeEnabledToggle = () => {
      const hasSecret = `${localStorage.getItem("ss_bridge_secret") || ""}`.trim().length > 0
        || `${localStorage.getItem("signal-share-bridge-secret") || ""}`.trim().length > 0;
      const hasBridgeUrl = `${window.SignalShareLocalLlm?.getBridgeBaseUrl?.() || localStorage.getItem("signal-share-bridge-url") || ""}`.trim().length > 0;
      const hasLocalToken = `${window.SignalShareLocalLlm?.getLocalLlmToken?.() || localStorage.getItem("ss_local_llm_token") || ""}`.trim().length > 0;
      if (hasSecret || hasBridgeUrl || hasLocalToken) {
        localStorage.setItem("ss_bridge_enabled", "1");
      } else {
        localStorage.removeItem("ss_bridge_enabled");
      }
    };

    if (elements.bridgeSecretInput) {
      elements.bridgeSecretInput.value = localStorage.getItem("ss_bridge_secret") || "";
      elements.bridgeSecretInput.addEventListener("input", (event) => {
        const secret = event.target.value.trim();
        localStorage.setItem("ss_bridge_secret", secret);
        syncBridgeEnabledToggle();
      });
    }

    if (elements.bridgeUrlInput) {
      elements.bridgeUrlInput.value = window.SignalShareLocalLlm?.getBridgeBaseUrl?.()
        || `${localStorage.getItem("signal-share-bridge-url") || ""}`.trim();
      elements.bridgeUrlInput.addEventListener("input", (event) => {
        const raw = `${event.target.value || ""}`;
        if (window.SignalShareLocalLlm?.setBridgeBaseUrl) {
          window.SignalShareLocalLlm.setBridgeBaseUrl(raw);
        } else {
          const normalized = raw.trim();
          if (normalized) {
            localStorage.setItem("signal-share-bridge-url", normalized);
          } else {
            localStorage.removeItem("signal-share-bridge-url");
          }
        }
        syncBridgeEnabledToggle();
      });
    }

    if (elements.localLlmTokenInput) {
      elements.localLlmTokenInput.value = window.SignalShareLocalLlm?.getLocalLlmToken?.()
        || `${localStorage.getItem("ss_local_llm_token") || ""}`.trim();
      elements.localLlmTokenInput.addEventListener("input", (event) => {
        const token = `${event.target.value || ""}`;
        if (window.SignalShareLocalLlm?.setLocalLlmToken) {
          window.SignalShareLocalLlm.setLocalLlmToken(token);
        } else {
          const normalized = token.trim();
          if (normalized) {
            localStorage.setItem("ss_local_llm_token", normalized);
          } else {
            localStorage.removeItem("ss_local_llm_token");
          }
        }
        syncBridgeEnabledToggle();
      });
    }

    if (elements.aiCustomInstructionsInput) {
      const coreGetInstructions = window.SignalShareAiCore?.getStoredCustomInstructions;
      const currentInstructions = typeof coreGetInstructions === "function"
        ? coreGetInstructions()
        : `${localStorage.getItem("ss_ai_custom_instructions") || ""}`.trim().slice(0, 2000);
      elements.aiCustomInstructionsInput.value = currentInstructions;

      elements.aiCustomInstructionsInput.addEventListener("input", (event) => {
        const rawInstructions = `${event.target.value || ""}`;
        const coreSetInstructions = window.SignalShareAiCore?.setStoredCustomInstructions;
        if (typeof coreSetInstructions === "function") {
          coreSetInstructions(rawInstructions);
          return;
        }
        const normalized = rawInstructions.trim().slice(0, 2000);
        if (normalized) {
          localStorage.setItem("ss_ai_custom_instructions", normalized);
        } else {
          localStorage.removeItem("ss_ai_custom_instructions");
        }
      });
    }

    window.heroMediaPlayerController = heroMediaPlayerController;

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
    elements.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleMessageSubmit(event);
      }
    });
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
    elements.viewerZoomIn.addEventListener("click", () => handleViewerZoom(0.2));
    elements.viewerZoomOut.addEventListener("click", () => handleViewerZoom(-0.2));
    elements.viewerZoomReset.addEventListener("click", () => handleViewerZoom(0, { reset: true }));
    elements.profileCloseButton.addEventListener("click", closeProfile);
    elements.viewerCollapseButton.addEventListener("click", collapseViewerToPlayer);
    elements.viewerPrevButton.addEventListener("click", () => stepViewer(-1));
    elements.viewerNextButton.addEventListener("click", () => stepViewer(1));
    elements.miniExpandButton.addEventListener("click", expandMiniPlayer);
    elements.miniCloseButton.addEventListener("click", closeMiniPlayer);
    elements.miniPrevButton.addEventListener("click", () => heroMediaPlayerController.handlePrevious({ target: "mini" }));
    elements.miniPlayPauseButton.addEventListener("click", () => heroMediaPlayerController.handlePlayPause(null, { target: "mini" }));
    elements.miniRefreshButton.addEventListener("click", () => {
      if (heroMediaPlayerController && typeof heroMediaPlayerController.handleRefresh === "function") {
        heroMediaPlayerController.handleRefresh({ target: "mini" });
      }
    });
    elements.miniNextButton.addEventListener("click", () => heroMediaPlayerController.handleNext({ target: "mini" }));
    elements.miniPlayerStage.addEventListener("click", handleMiniPlayerStageClick);
    elements.miniPlayerVolumeSlider.addEventListener("input", (event) => heroMediaPlayerController.handleVolumeInput(event));
    elements.heroPlayerOpenMiniButton?.addEventListener("click", () => {
      const postId = state.heroPlayerPostId || getHeroPost()?.id;
      if (postId) openMiniPlayer(postId, elements.heroPlayerOpenMiniButton);
    });
    elements.heroModeFeed?.addEventListener("click", () => setHeroControlMode("feed"));
    elements.heroModeMedia?.addEventListener("click", () => {
      state.desktopBridgeSuspended = false;
      setHeroControlMode("media");
    });
    elements.heroSourceYoutube?.addEventListener("click", () => setHeroControlSource("youtube"));
    elements.heroSourceSpotify?.addEventListener("click", () => setHeroControlSource("spotify"));
    elements.miniPlayerHead.addEventListener("pointerdown", beginMiniPlayerDrag);
    heroMediaPlayerController.attachEventListeners();
    initializeFeedScrollObserver();
    window.addEventListener("pointermove", handleMiniPlayerDrag);
    window.addEventListener("pointerup", endMiniPlayerDrag);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    window.addEventListener("signal:nativeBridgeReady", syncOverlayBodyState);
    // document.addEventListener("touchstart", handleOverlayTouchStart, { passive: true, capture: true });
    // document.addEventListener("touchmove", handleOverlayTouchMove, { passive: false, capture: true });
    // document.addEventListener("touchend", clearOverlayTouchState, { passive: true, capture: true });
    // document.addEventListener("touchcancel", clearOverlayTouchState, { passive: true, capture: true });
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
    document.addEventListener("click", handleThemePickerOutsideClick);
    document.addEventListener("click", handleExpandedMessengerOutsideClick);

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

    // YouTube IFrame API State Synchronization
    window.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data.event === "onStateChange") {
          // 1 = playing, 2 = paused, 0 = ended, 3 = buffering
          const isEnded = data.info === 0;
          const newState = (data.info === 1 || data.info === 3) ? "playing" : "paused";

          if (isEnded) {
            setTimeout(() => {
              const iframes = document.querySelectorAll("iframe");
              iframes.forEach(iframe => {
                if (iframe.contentWindow === event.source) {
                  if (state.heroPlayerElement?.contains(iframe)) {
                    heroMediaPlayerController.handleNext();
                  } else if (state.activePlayerElement?.contains(iframe)) {
                    handleMiniNext();
                  }
                }
              });
            }, 1200);
          }

          // Update global state if this matches our active hero or mini player
          if (state.heroPlayerElement?.contains(event.source?.frameElement) || state.heroPlayerElement === event.source?.frameElement) {
            if (state.heroPlayerPlaybackState !== newState) {
              // MIXING/STUTTER FIX: Ignore incoming status messages from iframes during the lockout window
              // following a user action. This prevents "state echoes" where the iframe reports its OLD
              // state immediately after a command, causing a stutter.
              if (state._mediaActionLockoutUntil && Date.now() < state._mediaActionLockoutUntil) {
                console.log(`[Hero] Ignoring YouTube state sync during lockout (${newState}).`);
              } else {
                state.heroPlayerPlaybackState = newState;
                heroMediaPlayerController.render();
              }
            }
          } else if (state.activePlayerElement?.contains(event.source?.frameElement) || state.activePlayerElement === event.source?.frameElement) {
            if (state.miniPlayerPlaybackState !== newState) {
              if (state._mediaActionLockoutUntil && Date.now() < state._mediaActionLockoutUntil) {
                console.log(`[Hero] Ignoring YouTube Mini state sync during lockout (${newState}).`);
              } else {
                state.miniPlayerPlaybackState = newState;
                renderMiniPlayer();
              }
            }
          }

          // Also update the dataset on the iframe itself for mini-player logic
          const iframes = document.querySelectorAll("iframe");
          iframes.forEach(iframe => {
            if (iframe.contentWindow === event.source) {
              iframe.dataset.playbackState = newState;
            }
          });
        }
      } catch (e) {
        // Not a JSON message or not from YouTube
      }
    });
  }

  function setHeroControlMode(mode) {
    state.heroControlMode = mode;

    // If switching to media, ensure bridge is active and restore the last chosen specific source if current is "all"
    if (mode === "media") {
      state.desktopBridgeSuspended = false;
      state._mediaActionLockoutUntil = 0;  // Clear any lockout to allow immediate snapshot fetch

      // Clear any stale feed post to avoid "old data" appearing on the Hero Stage when the bridge should be primary
      state.heroPlayerPostId = "";
      localStorage.removeItem("signal-share-hero-player-post-id");

      // Force immediate refresh of desktop snapshot when entering media mode
      if (heroMediaPlayerController && typeof heroMediaPlayerController.refreshDesktopSnapshot === "function") {
        heroMediaPlayerController.refreshDesktopSnapshot({ force: true, renderAfter: true });
      }

      if (state.heroControlSource === "all") {
        const sourceToRestore = state.lastHeroControlSource || "youtube";
        setHeroControlSource(sourceToRestore);
        return; // setHeroControlSource calls render()
      }
    }

    render();
  }

  function setHeroControlSource(source) {
    const isFeedMode = state.heroControlMode === "feed";
    const currentSource = state.heroControlSource;

    // Remember the last specific source chosen for future restoration in Media Mode
    if (source === "youtube" || source === "spotify") {
      state.lastHeroControlSource = source;
    }

    // In Feed mode, clicking an already active source toggle turns it off (sets back to "all")
    let targetSource = source;
    if (isFeedMode && currentSource === source) {
      targetSource = "all";
    }

    if (heroMediaPlayerController && typeof heroMediaPlayerController.setHeroControlSource === "function") {
      heroMediaPlayerController.setHeroControlSource(targetSource);
    } else {
      state.heroControlSource = targetSource;
    }

    render();
  }

  function render() {
    cleanupObjectUrls();
    state.visiblePostIds = getVisiblePosts().map((post) => post.id);
    renderStats();
    renderAccountState();
    renderMessenger();
    renderSettingsPanel();
    if (window.renderNotificationsPanel) window.renderNotificationsPanel();
    if (window.renderKeyboardShortcutsPanel) window.renderKeyboardShortcutsPanel();
    renderAdminEditor();
    renderAdminBanPanel();
    renderTagCloud();
    renderOverview();
    renderFeed();
    renderMiniPlayer();

    // Hero Media Player Controls - Centralized Sync
    const isHeroFeedMode = state.heroControlMode === "feed";
    const isHeroMediaMode = state.heroControlMode === "media";

    // Use mode-based availability for zero lag
    const canToggleSource = isHeroMediaMode;

    if (elements.heroModeFeed) elements.heroModeFeed.classList.toggle("is-active", isHeroFeedMode);
    if (elements.heroModeMedia) elements.heroModeMedia.classList.toggle("is-active", isHeroMediaMode);

    // Sync the source toggle group container
    const sourceToggleGroup = elements.heroSourceYoutube?.parentElement;
    if (sourceToggleGroup) {
      sourceToggleGroup.classList.toggle("is-dimmed", false);
    }

    if (elements.heroSourceYoutube) {
      const isYoutubeActive = state.heroControlSource === "youtube";
      elements.heroSourceYoutube.classList.toggle("is-active", isYoutubeActive);
      elements.heroSourceYoutube.classList.toggle("is-disabled", false);
      elements.heroSourceYoutube.disabled = false;
    }
    if (elements.heroSourceSpotify) {
      const isSpotifyActive = state.heroControlSource === "spotify";
      elements.heroSourceSpotify.classList.toggle("is-active", isSpotifyActive);
      elements.heroSourceSpotify.classList.toggle("is-disabled", false);
      elements.heroSourceSpotify.disabled = false;
    }

    heroMediaPlayerController.render();
    renderViewer();
    renderProfileView();
    syncSourceHelp();
    updateComposerAccess();
  }

  window.renderNotificationsPanel = function () {
    const isOpen = state.notificationsPanelOpen;
   ... (truncated)
  };
}
