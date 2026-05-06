import { createHeroMediaPlayerController } from "./hero-media-player.js?v=9";

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
  } = context;

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
    showEmailToggle: document.querySelector("#showEmailToggle"),
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
    miniPlayPauseButton: document.querySelector("#miniPlayPauseButton"),
    miniNextButton: document.querySelector("#miniNextButton"),
    heroPlayerTitle: document.querySelector("#heroPlayerTitle"),
    heroPlayerCaption: document.querySelector("#heroPlayerCaption"),
    heroPlayerStatus: document.querySelector("#heroPlayerStatus"),
    heroPlayerStage: document.querySelector("#heroPlayerStage"),
    heroPlayerPlayPauseButton: document.querySelector("#heroPlayerPlayPauseButton"),
    heroPlayerPrevButton: document.querySelector("#heroPlayerPrevButton"),
    heroPlayerNextButton: document.querySelector("#heroPlayerNextButton"),
    heroPlayerVolumeSlider: document.querySelector("#heroPlayerVolumeSlider"),
    heroPlayerVolumeValue: document.querySelector("#heroPlayerVolumeValue"),
  };

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
  const heroMediaPlayerController = createHeroMediaPlayerController({
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
    if (elements.keyboardShortcutsButton) elements.keyboardShortcutsButton.addEventListener("click", () => window.showSettingsPage && window.showSettingsPage('shortcuts'));
    if (elements.notificationsBackdrop) elements.notificationsBackdrop.addEventListener("click", handleNotificationsBackdropClick);
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
    elements.showEmailToggle.addEventListener("change", handleShowEmailToggle);
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
    elements.miniPlayPauseButton.addEventListener("click", handleMiniPlayerPlayPauseClick);
    elements.miniNextButton.addEventListener("click", () => stepMiniPlayer(1));
    elements.miniPlayerStage.addEventListener("click", handleMiniPlayerStageClick);
    elements.miniPlayerVolumeSlider.addEventListener("input", handleMiniPlayerVolumeInput);
    elements.miniPlayerHead.addEventListener("pointerdown", beginMiniPlayerDrag);
    heroMediaPlayerController.attachEventListeners();
    window.addEventListener("pointermove", handleMiniPlayerDrag);
    window.addEventListener("pointerup", endMiniPlayerDrag);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    window.addEventListener("signal:nativeBridgeReady", syncOverlayBodyState);
    document.addEventListener("touchstart", handleOverlayTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", handleOverlayTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", clearOverlayTouchState, { passive: true, capture: true });
    document.addEventListener("touchcancel", clearOverlayTouchState, { passive: true, capture: true });
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
    heroMediaPlayerController.render();
    renderViewer();
    renderProfileView();
    syncSourceHelp();
    updateComposerAccess();
  }

  window.renderNotificationsPanel = function() {
    const isOpen = state.notificationsPanelOpen;
    if (elements.notificationsPanel) {
      elements.notificationsPanel.hidden = !isOpen;
      elements.notificationsPanel.classList.toggle("is-open", isOpen);
      elements.notificationsPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
    syncOverlayBodyState();
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
    syncOverlayBodyState();
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

    syncOverlayBodyState();

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
  let lastConversationRenderKey = "";

  function maskEmailForProfileView(email = "") {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) return "";
    const [localPart, domainPart] = normalized.split("@");
    if (!localPart || !domainPart) return "";
    const domainSegments = domainPart.split(".");
    const domainName = domainSegments[0] ?? "";
    const domainTld = domainSegments.slice(1).join(".");
    const maskedLocal = localPart.length <= 2
      ? `${localPart[0] ?? "*"}*`
      : `${localPart[0]}${"*".repeat(Math.max(1, localPart.length - 2))}${localPart[localPart.length - 1]}`;
    const maskedDomainName = domainName.length <= 1
      ? "*"
      : `${domainName[0]}${"*".repeat(Math.max(1, domainName.length - 1))}`;
    return `${maskedLocal}@${maskedDomainName}${domainTld ? `.${domainTld}` : ""}`;
  }

  function resolveVisibleMemberEmail(email = "") {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!normalized || !state.preferences.showEmail) return "";
    if (canRevealMemberEmails()) return normalized;
    return maskEmailForProfileView(normalized);
  }

  function renderPeopleList(isReady) {
    const currentKey = `${isReady}-${state.availableProfiles.length}-${state.peopleSearch}-${state.messengerBusy}-${state.blockedUserIds.length}-${state.bannedUserIds.length}-${state.pendingBlockUserId}-${state.preferences.showEmail}`;
    if (currentKey === lastPeopleRenderKey) return;
    lastPeopleRenderKey = currentKey;
    elements.peopleList.innerHTML = ""; const visibleProfiles = getFilteredPeopleProfiles();
    if (!isReady) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "Sign in with an activated account to see other members."; return; }
    if (state.availableProfiles.length === 0) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "No other members are visible yet. Another signed-in user needs to join first."; return; }
    if (visibleProfiles.length === 0) { elements.peopleEmpty.hidden = false; elements.peopleEmpty.textContent = "No people match this search."; return; }
    elements.peopleEmpty.hidden = true;
    visibleProfiles.forEach((profile) => {
      const displayName = resolveMemberDisplayName(profile); const blocked = isUserBlocked(state, profile.id); const banned = isUserBanned(state, profile.id); const item = document.createElement("div"); item.className = "person-item"; const row = document.createElement("div"); row.className = "person-row"; const button = document.createElement("button"); button.type = "button"; button.className = "person-button"; if (blocked || banned) button.classList.add("is-blocked"); button.disabled = blocked || banned || state.messengerBusy;
      const name = document.createElement("strong"); name.textContent = displayName; const meta = document.createElement("span"); meta.textContent = resolveVisibleMemberEmail(profile.email) || "Member"; const action = document.createElement("span"); action.className = "person-action"; action.textContent = banned ? "Banned" : (blocked ? "Blocked" : "Message");
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

  function syncComposerCreatorWithAccount() { const shouldLockToAccount = state.backendMode === "supabase" && Boolean(state.currentUser); if (shouldLockToAccount) elements.creatorInput.value = getDefaultProfileName(); elements.creatorInput.readOnly = shouldLockToAccount; }

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

  function applyUserPreferences(preferences) {
    document.body.dataset.theme = preferences.theme; document.body.dataset.density = preferences.density; document.body.dataset.motion = preferences.motion; document.documentElement.dataset.statusBarStrip = preferences.statusBarStrip ? "on" : "off"; document.documentElement.style.scrollBehavior = preferences.motion === "calm" ? "auto" : "smooth";
  }

  function openSettingsPanel() { state.settingsPanelOpen = true; state.settingsActivePage = "main"; setMobileHeaderHidden(false); renderSettingsPanel(); requestAnimationFrame(() => elements.settingsCloseButton?.focus?.()); }

  function closeSettingsPanel(options = {}) { const { restoreFocus = true } = options; if (!state.settingsPanelOpen) return; state.settingsPanelOpen = false; state.themePickerOpen = false; renderSettingsPanel(); if (restoreFocus) elements.settingsToggleButton.focus(); }

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
    if (!isOpen) state.themePickerOpen = false;
    elements.settingsPanel.hidden = !isOpen;
    elements.settingsPanel.classList.toggle("is-open", isOpen);
    elements.settingsPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    elements.settingsToggleButton.setAttribute("aria-expanded", isOpen ? "true" : "false");

    syncOverlayBodyState();

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
        if (elements.showEmailToggle) elements.showEmailToggle.checked = state.preferences.showEmail;
        renderThemePicker();
      }
    }
  }

  let notificationsOpenedAt = 0;

  function openNotificationsPanel() { 
    state.notificationsPanelOpen = true; 
    notificationsOpenedAt = performance.now();
    setMobileHeaderHidden(false); 
    render();
    if (window.notifications?.resetBadge) window.notifications.resetBadge();
    if (window.renderNotificationsHistory) window.renderNotificationsHistory();
    requestAnimationFrame(() => elements.notificationsCloseButton?.focus?.()); 
  }

  function handleNotificationsBackdropClick(event) {
    // Prevent the opening tap from immediately re-closing the panel on mobile.
    if (performance.now() - notificationsOpenedAt < 220) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    closeNotificationsPanel();
  }

  function closeNotificationsPanel(options = {}) { 
    const { restoreFocus = true } = options; 
    if (!state.notificationsPanelOpen) return; 
    state.notificationsPanelOpen = false; 
    render(); 
    if (restoreFocus && elements.notificationsLauncherButton) elements.notificationsLauncherButton.focus(); 
  }

  let lastToggleTime = 0;
  window.toggleNotificationsPanel = function(event) { 
    console.log("[App] Toggling notifications panel...");
    const now = Date.now();
    if (now - lastToggleTime < 300) return; // Prevent double-toggle
    lastToggleTime = now;

    if (event) { event.preventDefault(); event.stopPropagation(); } 
    if (state.notificationsPanelOpen) closeNotificationsPanel(); else openNotificationsPanel(); 
  }

  // Initial setup for the notification bell
  if (elements.notificationsLauncherButton) {
    const bell = elements.notificationsLauncherButton;
    bell.style.cssText = "background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; color: inherit; padding: 0 8px; z-index: 10000; pointer-events: auto !important; -webkit-tap-highlight-color: rgba(0,0,0,0); flex-shrink: 0; min-height: 44px; min-width: 44px;";
    
    bell.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.toggleNotificationsPanel(e);
    });
  }

  window.NotificationSystem = {
    toggle: () => window.toggleNotificationsPanel()
  };
  window.toggleNotifications = () => window.toggleNotificationsPanel();
  window.openMessengerFromNotification = openMessengerThreadFromNotification;

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

  function getThemeOption(value) {
    return THEME_OPTIONS.find((option) => option.value === value) ?? THEME_OPTIONS[0];
  }

  function renderThemePicker() {
    if (!elements.themePicker || !elements.themePickerButton || !elements.themePickerMenu) return;
    const activeTheme = getThemeOption(state.preferences.theme);
    elements.themePicker.classList.toggle("is-open", state.themePickerOpen);
    elements.themePickerButton.setAttribute("aria-expanded", state.themePickerOpen ? "true" : "false");
    elements.themePickerMenu.hidden = !state.themePickerOpen;
    if (elements.themePickerLabel) elements.themePickerLabel.textContent = activeTheme.label;
    if (elements.themePickerDescription) elements.themePickerDescription.textContent = activeTheme.description;
    if (elements.themePickerPreview) elements.themePickerPreview.className = `theme-preview theme-preview-${activeTheme.value}`;
    elements.themePickerMenu.querySelectorAll("[data-theme-option]").forEach((button) => {
      const isActive = button.dataset.themeOption === state.preferences.theme;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function toggleThemePicker(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    state.themePickerOpen = !state.themePickerOpen;
    renderThemePicker();
  }

  function closeThemePicker() {
    if (!state.themePickerOpen) return;
    state.themePickerOpen = false;
    renderThemePicker();
  }

  function handleThemePickerOutsideClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!state.themePickerOpen || !target || elements.themePicker?.contains(target)) return;
    closeThemePicker();
  }

  function handleThemeOptionClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-theme-option]");
    if (!button) return;
    state.themePickerOpen = false;
    updateUserPreferences({ ...state.preferences, theme: button.dataset.themeOption });
  }

  function handleDensityChange(event) { updateUserPreferences({ ...state.preferences, density: event.target.value }); }

  function handleMotionChange(event) { updateUserPreferences({ ...state.preferences, motion: event.target.value }); }

  function handleStatusBarStripToggle(event) { updateUserPreferences({ ...state.preferences, statusBarStrip: event.target.checked }); }

  function handleNotificationHideSenderToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideSender: event.target.checked }); }

  function handleNotificationHideBodyToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideBody: event.target.checked }); }

  function handleShowEmailToggle(event) {
    updateUserPreferences({ ...state.preferences, showEmail: event.target.checked });
    renderMessenger();
    renderProfileView();
  }

  function resetPlayerDockPosition() { state.playerPosition = null; savePlayerPosition(null); applyMiniPlayerPosition(); }

  function resetPlayerVolume() { state.playerVolume = DEFAULT_PLAYER_VOLUME; savePlayerVolume(DEFAULT_PLAYER_VOLUME); applyPlayerVolumeToActiveElement(); renderMiniPlayerVolumeControl(); }

  function resetUserPreferences() { updateUserPreferences({ ...DEFAULT_USER_PREFERENCES }); resetPlayerDockPosition(); resetPlayerVolume(); }

  function syncSourceHelp() { if (state.previewExternal?.provider) { updateSourceHelp(state.previewExternal.provider); return; } if (state.selectedFile) { updateSourceHelp("upload"); return; } if (elements.externalUrlInput.value.trim() && !state.previewExternal) { updateSourceHelp("invalid"); return; } updateSourceHelp("none"); }

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

  function getOpenOverlayRoots() {
    return [
      state.settingsPanelOpen ? elements.settingsPanel : null,
      state.notificationsPanelOpen ? elements.notificationsPanel : null,
      state.viewerPostId || state.viewerAttachment ? elements.viewer : null,
      state.activeProfileKey ? elements.profileView : null,
      state.adminBanPanelOpen ? elements.adminBanPanel : null,
      state.messengerOpen ? elements.messengerSection : null,
      state.playerPostId ? elements.miniPlayer : null,
    ].filter(Boolean);
  }

  function getOverlayScrollContainer(target) {
    if (!(target instanceof Element)) return null;
    const overlayRoot = getOpenOverlayRoots().find((root) => root.contains(target));
    if (!overlayRoot) return null;
    const scrollContainer = target.closest(OVERLAY_SCROLL_CONTAINER_SELECTOR);
    if (scrollContainer && overlayRoot.contains(scrollContainer)) return scrollContainer;
    return overlayRoot;
  }

  function handleOverlayTouchStart(event) {
    const touch = event.touches?.[0];
    activeOverlayScrollContainer = getOverlayScrollContainer(event.target);
    if (!touch || !activeOverlayScrollContainer) return;
    activeOverlayTouchY = touch.clientY;
  }

  function handleOverlayTouchMove(event) {
    if (!activeOverlayScrollContainer) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - activeOverlayTouchY;
    activeOverlayTouchY = touch.clientY;
    const maxScrollTop = Math.max(0, activeOverlayScrollContainer.scrollHeight - activeOverlayScrollContainer.clientHeight);
    const atTop = activeOverlayScrollContainer.scrollTop <= 0;
    const atBottom = activeOverlayScrollContainer.scrollTop >= maxScrollTop - 1;
    if (maxScrollTop <= 0 || (deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) event.preventDefault();
  }

  function clearOverlayTouchState() {
    activeOverlayScrollContainer = null;
    activeOverlayTouchY = 0;
  }

  function applySiteSettings(settings) { const root = document.documentElement; root.style.setProperty("--shell-max-width", `${settings.shellWidth}px`); root.style.setProperty("--section-gap", `${settings.sectionGap}px`); root.style.setProperty("--radius-xl", `${settings.surfaceRadius}px`); root.style.setProperty("--radius-lg", `${Math.max(18, settings.surfaceRadius - 8)}px`); root.style.setProperty("--radius-md", `${Math.max(14, settings.surfaceRadius - 14)}px`); root.style.setProperty("--feed-media-fit", settings.mediaFit); }

  function handleAdminSettingsInput() { state.siteSettings = { shellWidth: clampNumber(elements.layoutWidthInput.value, 960, 1440, DEFAULT_SITE_SETTINGS.shellWidth), sectionGap: clampNumber(elements.layoutGapInput.value, 16, 40, DEFAULT_SITE_SETTINGS.sectionGap), surfaceRadius: clampNumber(elements.layoutRadiusInput.value, 22, 44, DEFAULT_SITE_SETTINGS.surfaceRadius), mediaFit: elements.mediaFitSelect.value === "contain" ? "contain" : "cover" }; applySiteSettings(state.siteSettings); updateAdminSettingsValues(); }

  function handleAdminSettingsReset() { state.siteSettings = { ...DEFAULT_SITE_SETTINGS }; applySiteSettings(state.siteSettings); renderAdminEditor(); elements.adminSettingsFeedback.textContent = "Defaults restored locally. Save to publish them."; elements.adminSettingsFeedback.classList.remove("is-error"); }

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

  function syncOverlayBodyState() {
    const modalOverlayOpen = Boolean(state.viewerPostId || state.viewerAttachment || state.activeProfileKey || state.settingsPanelOpen || state.notificationsPanelOpen || state.adminBanPanelOpen);
    const scrollOverlayOpen = Boolean(modalOverlayOpen || state.messengerOpen || state.playerPostId);
    document.documentElement.classList.toggle("overlay-scroll-active", scrollOverlayOpen);
    document.body.classList.toggle("viewer-open", modalOverlayOpen);
    document.body.classList.toggle("overlay-scroll-active", scrollOverlayOpen);
    window.__signalShareOverlayOpen = scrollOverlayOpen;

    // Native bridge: Disable pull-to-refresh when any overlay is open
    if (window.NativeBridge && typeof window.NativeBridge.setPullToRefreshEnabled === "function") {
      window.NativeBridge.setPullToRefreshEnabled(!scrollOverlayOpen);
    }
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

  function getProfileInitials(name) { const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean); if (parts.length === 0) return "SS"; if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase(); return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join(""); }

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

  function getActivePlayerMediaElement() { if (!(state.activePlayerElement instanceof HTMLElement)) return null; if (state.activePlayerElement instanceof HTMLMediaElement) return state.activePlayerElement; const mediaElement = state.activePlayerElement.querySelector("video, audio"); return mediaElement instanceof HTMLMediaElement ? mediaElement : null; }

  function getControllablePlayerPost() { return getPostById(state.activePlayerPostId || state.playerPostId); }

  function resolveExternalEmbedSource(post) {
    if (!post) return "";
    if (post.sourceKind === "youtube") {
      const repairCandidates = [post.embedUrl, post.externalUrl, post.externalId, post.mediaUrl, post.src, post.label, post.caption, post.title];
      for (const candidate of repairCandidates) {
        if (typeof candidate !== "string" || !candidate.trim()) continue;
        const parsed = parseYouTubeUrl(candidate);
        if (parsed?.embedUrl) return parsed.embedUrl;
      }
      return typeof post.embedUrl === "string" ? post.embedUrl : "";
    }
    return post.embedUrl || post.src || post.mediaUrl || "";
  }

  function buildPersistentPlayerSource(post) {
    let source = resolveExternalEmbedSource(post);
    if (post?.sourceKind !== "youtube" || !source) return source;

    if (source.startsWith("//")) source = "https:" + source;

    try {
      const url = new URL(source);
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("playsinline", "1");
      url.searchParams.set("autoplay", "1");
      url.searchParams.set("mute", "1");

      if (window.location.protocol.startsWith("http") && window.location.origin && window.location.origin !== "null") {
        url.searchParams.set("origin", window.location.origin);
      } else {
        url.searchParams.set("origin", window.location.href.split("#")[0].split("?")[0]);
      }

      return url.toString();
    }
    catch {
      const separator = source.includes("?") ? "&" : "?";
      return `${source}${separator}enablejsapi=1&playsinline=1&autoplay=1&mute=1`;
    }
  }

  function postMessageToYouTubePlayer(frame, func, args = []) { if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return; frame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*"); }

  function syncPlayerVolumeFromMediaElement(event) { const mediaElement = event?.target; if (!(mediaElement instanceof HTMLMediaElement)) return; state.playerVolume = normalizePlayerVolume(mediaElement.muted ? 0 : mediaElement.volume, state.playerVolume); savePlayerVolume(state.playerVolume); renderMiniPlayerVolumeControl(); heroMediaPlayerController.render(); }

  function syncPlayerPlaybackFromMediaElement(event) { const mediaElement = event?.target; if (!(mediaElement instanceof HTMLMediaElement)) return; state.heroPlayerPlaybackState = mediaElement.paused ? "paused" : "playing"; heroMediaPlayerController.render(); }

  function attachPersistentPlayerMediaListeners(mediaElement) { if (!(mediaElement instanceof HTMLMediaElement)) return; mediaElement.addEventListener("volumechange", syncPlayerVolumeFromMediaElement); mediaElement.addEventListener("play", syncPlayerPlaybackFromMediaElement); mediaElement.addEventListener("pause", syncPlayerPlaybackFromMediaElement); mediaElement.addEventListener("ended", syncPlayerPlaybackFromMediaElement); }

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
    if (variant === "viewer") { const frame = document.createElement("iframe"); frame.className = post.sourceKind === "youtube" ? "viewer-embed viewer-youtube" : "viewer-embed viewer-spotify"; frame.src = buildPersistentPlayerSource(post); frame.title = `${post.title} player`; frame.loading = "lazy"; frame.width = "100%"; frame.height = post.sourceKind === "youtube" ? "100%" : "440"; frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.setAttribute("allowfullscreen", ""); container.appendChild(frame); return; }
    if (variant === "mini") { const frame = document.createElement("iframe"); frame.className = post.sourceKind === "youtube" ? "mini-player-embed mini-youtube" : "mini-player-embed mini-spotify"; frame.src = buildPersistentPlayerSource(post); frame.title = `${post.title} player`; frame.loading = "lazy"; frame.width = "100%"; frame.height = post.sourceKind === "youtube" ? "192" : "152"; frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.setAttribute("allowfullscreen", ""); container.appendChild(frame); return; }
    container.appendChild(createExternalPreviewStage({ provider: post.sourceKind, title: post.title, creator: post.creator, externalId: post.externalId ?? "", externalUrl: post.externalUrl ?? "", embedUrl: post.embedUrl ?? "", label: post.label ?? "", caption: post.caption ?? "" }, { variant, note: post.sourceKind === "youtube" ? "Video preview opens in the docked player." : "Music preview opens in the docked player." }));
  }

  function createExternalPreviewStage(source, options = {}) {
    const { variant = "card", note = "" } = options; const stage = document.createElement("div"); stage.className = `external-preview-card external-preview-card-${variant} external-preview-card-${source.provider}`;
    const image = document.createElement("img"); image.className = "external-preview-image"; image.alt = `${source.title} preview`; image.loading = variant === "spotlight" ? "eager" : "lazy"; image.referrerPolicy = "strict-origin-when-cross-origin";
    const overlay = document.createElement("div"); overlay.className = "external-preview-overlay"; const badge = document.createElement("span"); badge.className = "external-preview-badge"; badge.textContent = formatProviderName(source.provider); const title = document.createElement("strong"); title.className = "external-preview-title"; title.textContent = source.title; const description = document.createElement("p"); description.className = "external-preview-copy"; description.textContent = note || source.creator || "External media preview";
    overlay.append(badge, title, description); stage.append(image, overlay);
    if (source.provider === "youtube") {
      void applyExternalPreviewMetadata(stage, image, title, badge, source);
      const externalId = resolveYouTubePreviewExternalId(source);
      const thumbnailCacheKey = externalId ? `youtube:thumbnail:${externalId}` : "";
      const cachedThumbnail = thumbnailCacheKey ? externalPreviewCache.get(thumbnailCacheKey) : null;
      if (typeof cachedThumbnail === "string" && cachedThumbnail.trim()) {
        loadPreviewImageCandidates(stage, image, [cachedThumbnail.trim()], { cacheKey: thumbnailCacheKey });
      } else {
        loadPreviewImageCandidates(stage, image, resolveYouTubePreviewCandidates(source), { cacheKey: thumbnailCacheKey });
      }
    }
    else if (source.provider === "spotify") {
      badge.textContent = formatExternalPreviewBadge(source.provider, deriveSpotifyCreatorFromSourceTitle(source));
      void applyExternalPreviewMetadata(stage, image, title, badge, source);
    }
    return stage;
  }

  async function applyExternalPreviewMetadata(stage, image, titleElement, badgeElement, source) {
    const metadata = await getExternalPreviewMetadata(source);
    if (!stage.isConnected || !metadata) return;
    if (typeof metadata.title === "string" && metadata.title.trim()) {
      const previewTitle = metadata.title.trim();
      titleElement.textContent = previewTitle;
      image.alt = `${previewTitle} preview`;
    }
    const fallbackCreator = source.provider === "spotify" ? deriveSpotifyCreatorFromSourceTitle(source, metadata.title) : "";
    const previewCreator = typeof metadata.creator === "string" && metadata.creator.trim() ? metadata.creator.trim() : fallbackCreator;
    badgeElement.textContent = formatExternalPreviewBadge(source.provider, previewCreator);
    if (typeof metadata.thumbnailUrl === "string" && metadata.thumbnailUrl.trim()) {
      loadPreviewImageCandidates(stage, image, [metadata.thumbnailUrl.trim()]);
    }
  }

  function formatExternalPreviewBadge(provider, creator = "") {
    const providerName = formatProviderName(provider);
    const cleanCreator = typeof creator === "string" ? creator.trim() : "";
    return cleanCreator && cleanCreator !== providerName ? `${cleanCreator} / ${providerName}` : providerName;
  }

  function deriveSpotifyCreatorFromSourceTitle(source) {
    if (source?.provider !== "spotify") return "";
    const sourceTitle = typeof source.title === "string" ? source.title.trim() : "";
    if (!sourceTitle) return "";
    const match = sourceTitle.match(/^(.{1,80}?)\s+-\s+(.+)$/);
    if (!match) return "";
    const candidate = match[1].trim();
    const remainder = match[2].trim();
    if (!candidate || !remainder || isGenericSpotifyCreatorFallback(candidate)) return "";
    return candidate;
  }

  function isGenericSpotifyCreatorFallback(value) {
    return /^(audio|music|post|song|spotify|track|untitled)$/i.test(String(value ?? "").trim());
  }

  function loadPreviewImageCandidates(stage, image, candidates, options = {}) {
    const { cacheKey = "" } = options;
    const urls = candidates.filter(Boolean); if (!urls.length) return;
    let index = 0; const tryNext = () => { if (index >= urls.length) { image.removeAttribute("src"); return; } const nextUrl = urls[index]; index += 1; image.onload = () => { stage.classList.add("has-image"); if (cacheKey) externalPreviewCache.set(cacheKey, nextUrl); image.onload = null; image.onerror = null; }; image.onerror = () => { stage.classList.remove("has-image"); tryNext(); }; image.src = nextUrl; };
    tryNext();
  }

  async function loadSpotifyPreviewImage(stage, image, source) { const thumbnailUrl = await getSpotifyPreviewImageUrl(source); if (!stage.isConnected || !thumbnailUrl) return; loadPreviewImageCandidates(stage, image, [thumbnailUrl]); }

  async function getExternalPreviewMetadata(source) { if (source.provider === "spotify") return getSpotifyPreviewMetadata(source); if (source.provider === "youtube") return getYouTubePreviewMetadata(source); return null; }

  async function getSpotifyPreviewMetadata(source) {
    const sourceUrl = resolveSpotifyPreviewSourceUrl(source); if (!sourceUrl) return null;
    const cacheKey = `spotify:preview:v10:${sourceUrl}`; const cached = externalPreviewCache.get(cacheKey); if (cached && !(cached instanceof Promise)) return cached; if (cached instanceof Promise) return cached;
    const request = Promise.all([fetchSpotifyPreviewCatalogMetadata(source, sourceUrl), fetchSpotifyPreviewOEmbedMetadata(sourceUrl)]).then(([cat, oem]) => { 
      // Even if cat has an error, we try to use oem as a fallback
      const fallbackCreator = deriveSpotifyCreatorFromSourceTitle(source, cat?.title || oem?.title || "");
      const metadata = {
        title: cat?.title || oem?.title || "",
        creator: cat?.creator || oem?.creator || fallbackCreator || "",
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

  function resolveYouTubePreviewExternalId(source) {
    const directId = typeof source?.externalId === "string" ? source.externalId.trim() : "";
    if (/^[a-zA-Z0-9_-]{11}$/.test(directId)) return directId;

    const values = [
      source?.externalUrl,
      source?.embedUrl,
      source?.originalUrl,
      source?.mediaUrl,
      source?.src,
      source?.label,
      source?.caption,
      source?.title,
    ];

    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) continue;
      const parsed = parseYouTubeUrl(value);
      const parsedId = typeof parsed?.externalId === "string" ? parsed.externalId.trim() : "";
      if (/^[a-zA-Z0-9_-]{11}$/.test(parsedId)) return parsedId;
    }

    return "";
  }

  function resolveYouTubePreviewCandidates(source) {
    const externalId = resolveYouTubePreviewExternalId(source);
    if (!externalId) return [];
    return [
      `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${externalId}/sddefault.jpg`,
      `https://img.youtube.com/vi/${externalId}/0.jpg`,
      `https://i.ytimg.com/vi/${externalId}/maxresdefault.jpg`
    ];
  }

  async function getYouTubePreviewMetadata(source) {
    const externalId = resolveYouTubePreviewExternalId(source); if (!externalId) return null;
    const cacheKey = `youtube:preview:${externalId}`; const cached = externalPreviewCache.get(cacheKey); if (cached && !(cached instanceof Promise)) return cached; if (cached instanceof Promise) return cached;
    const metadata = {
      title: typeof source?.title === "string" ? source.title.trim() : "",
      creator: "",
      thumbnailUrl: "",
    };
    externalPreviewCache.set(cacheKey, metadata);
    return metadata;
  }

  function resolveYouTubePreviewSourceUrl(source) {
    const externalId = resolveYouTubePreviewExternalId(source);
    if (externalId) return `https://www.youtube.com/watch?v=${externalId}`;
    return "";
  }

  function resolveSpotifyPreviewSourceUrl(source) { if (source.externalUrl) return source.externalUrl; if (source.originalUrl) return source.originalUrl; if (source.embedUrl) { try { const embedUrl = new URL(source.embedUrl); const segments = embedUrl.pathname.split("/").filter(Boolean); const typeIndex = segments[0] === "embed" ? 1 : 0; const type = segments[typeIndex]; const externalId = segments[typeIndex + 1] || source.externalId || ""; if (type && externalId) return `https://open.spotify.com/${type}/${externalId}`; } catch { return ""; } } return ""; }

  function renderMiniPlayerVolumeControl() {
    const post = getPostById(state.playerPostId); const mediaElement = getActivePlayerMediaElement(); const hasNativeVolumeControl = mediaElement instanceof HTMLMediaElement; const supportsCustomVolume = hasNativeVolumeControl || post?.sourceKind === "youtube";
    elements.miniPlayerVolume.hidden = !supportsCustomVolume; elements.miniPlayerVolumeSlider.disabled = !supportsCustomVolume; elements.miniPlayerVolumeSlider.title = supportsCustomVolume ? "Adjust volume" : "";
    const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
    elements.miniPlayerVolumeSlider.value = `${volumePercent}`; elements.miniPlayerVolumeValue.textContent = `${volumePercent}%`;
  }

  function renderMiniPlayerPlaybackButton(post = getControllablePlayerPost()) {
    if (!(elements.miniPlayPauseButton instanceof HTMLButtonElement)) return;
    const mediaElement = getActivePlayerMediaElement();
    let playbackState = state.heroPlayerPlaybackState === "playing" ? "playing" : "paused";
    if (mediaElement instanceof HTMLMediaElement) playbackState = mediaElement.paused ? "paused" : "playing";
    elements.miniPlayPauseButton.textContent = playbackState === "playing" ? "Pause" : "Play";
    elements.miniPlayPauseButton.disabled = !post;
  }

  function handleMiniPlayerPlayPauseClick() {
    const post = getControllablePlayerPost();
    if (!post) return;

    const mediaElement = getActivePlayerMediaElement();
    if (mediaElement instanceof HTMLMediaElement) {
      const shouldPlay = mediaElement.paused;
      if (shouldPlay) {
        const playResult = mediaElement.play();
        if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
      } else {
        mediaElement.pause();
      }
      state.heroPlayerPlaybackState = shouldPlay ? "playing" : "paused";
      renderMiniPlayerPlaybackButton(post);
      heroMediaPlayerController.render();
      return;
    }

    if (post.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) {
      const shouldPlay = state.heroPlayerPlaybackState !== "playing";
      postMessageToYouTubePlayer(state.activePlayerElement, shouldPlay ? "playVideo" : "pauseVideo");
      state.heroPlayerPlaybackState = shouldPlay ? "playing" : "paused";
      renderMiniPlayerPlaybackButton(post);
      heroMediaPlayerController.render();
      return;
    }

    elements.heroPlayerPlayPauseButton?.click();
    renderMiniPlayerPlaybackButton(post);
  }

  function moveFocusOutOfMiniPlayer() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (!elements.miniPlayer.contains(activeElement)) return;

    const focusCandidates = [
      state.returnFocusElement,
      elements.heroPlayerPlayPauseButton,
      elements.messagesNavLink,
      elements.settingsToggleButton,
      elements.searchInput,
    ];

    for (const candidate of focusCandidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (!document.contains(candidate)) continue;
      if (elements.miniPlayer.contains(candidate)) continue;
      if (candidate.hasAttribute("disabled")) continue;
      try {
        candidate.focus({ preventScroll: true });
        return;
      } catch {
        // Try next candidate.
      }
    }

    activeElement.blur();
  }

  function renderMiniPlayer() {
    if (!state.playerPostId) { moveFocusOutOfMiniPlayer(); state.playerDrag = null; elements.miniPlayer.classList.remove("is-open"); elements.miniPlayer.classList.remove("is-expanded"); elements.miniPlayer.classList.remove("is-dragging"); elements.miniPlayer.setAttribute("aria-hidden", "true"); elements.miniPlayerVolume.hidden = true; renderMiniPlayerPlaybackButton(null); clearMiniPlayerMedia(); syncOverlayBodyState(); heroMediaPlayerController.render(); return; }
    const post = getPostById(state.playerPostId); if (!post || !isPlayablePost(post)) { closeMiniPlayer(); return; }
    const creatorSummary = getProfileSummaryForPost(post);
    elements.miniPlayer.classList.add("is-open"); elements.miniPlayer.classList.toggle("is-expanded", state.miniPlayerExpanded); elements.miniPlayer.setAttribute("aria-hidden", "false");
    syncOverlayBodyState();
    elements.miniPlayerKind.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`; elements.miniPlayerTitle.textContent = post.title; elements.miniPlayerCaption.textContent = post.caption; elements.miniPlayerCreator.textContent = creatorSummary?.displayName ?? post.creator; elements.miniPlayerCreator.onclick = creatorSummary ? (event) => openProfileByKey(creatorSummary.key, event.currentTarget) : null; elements.miniPlayerTime.textContent = formatTimestamp(post.createdAt); elements.miniExpandButton.textContent = state.miniPlayerExpanded ? "Collapse" : "Expand";
    elements.miniPlayerTags.innerHTML = ""; post.tags.forEach((tag) => { const pill = document.createElement("span"); pill.className = "tag-pill"; pill.textContent = `#${tag}`; elements.miniPlayerTags.appendChild(pill); });
    const playableIds = getPlayableVisiblePostIds(); const canStep = playableIds.length > 1; elements.miniPrevButton.disabled = !canStep; elements.miniNextButton.disabled = !canStep; renderMiniPlayerPlaybackButton(post);
    renderMiniPlayerMedia(elements.miniPlayerStage, post); renderMiniPlayerVolumeControl(); applyMiniPlayerPosition();
    window.requestAnimationFrame(() => { if (state.playerPostId === post.id) applyMiniPlayerPosition(); });
    heroMediaPlayerController.render();
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
    const visibleEmail = resolveVisibleMemberEmail(profile.email);
    if (visibleEmail) metaParts.push(visibleEmail);
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

  function closeMiniPlayer() { moveFocusOutOfMiniPlayer(); state.playerPostId = null; state.miniPlayerExpanded = false; state.playerDrag = null; state.heroPlayerPlaybackState = "none"; elements.miniPlayer.classList.remove("is-open"); elements.miniPlayer.classList.remove("is-expanded"); elements.miniPlayer.classList.remove("is-dragging"); elements.miniPlayer.setAttribute("aria-hidden", "true"); elements.miniPlayerVolume.hidden = true; renderMiniPlayerPlaybackButton(null); clearMiniPlayerMedia(); destroyActivePlayer(); syncOverlayBodyState(); heroMediaPlayerController.render(); state.returnFocusElement = null; }

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

  function showFeedback(message, isError = false) { elements.formFeedback.textContent = message; elements.formFeedback.classList.toggle("is-error", isError); }

  function resetComposer() { elements.postForm.reset(); clearSelectedMedia(); state.previewExternal = null; hydrateRememberedCreator(); updateSourceHelp("none"); showFeedback(""); }

  function clearSelectedMedia(options = {}) { const { preserveFeedback = false } = options; state.selectedFile = null; elements.mediaInput.value = ""; clearPreviewOnly(); if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ""; } if (!preserveFeedback) elements.formFeedback.classList.remove("is-error"); }

  function clearViewerMedia() { elements.viewerStage.replaceChildren(); if (state.viewerUrl) { URL.revokeObjectURL(state.viewerUrl); state.viewerUrl = ""; } }

  function clearMiniPlayerMedia() { elements.miniPlayerStage.replaceChildren(); }

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

  function hydrateRememberedCreator() { const remembered = localStorage.getItem(CREATOR_NAME_KEY); if (remembered) elements.creatorInput.value = remembered; }

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

  return {
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
  };
}
