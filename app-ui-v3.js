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
  setApiContext 
} from './api-v3.js?v=92';

// Messenger & Admin Features
// Extracted from app-v3.js for modularity

const state = window.__SIGNAL_SHARE_STATE__;
const elements = window.__SIGNAL_SHARE_ELEMENTS__;

// Helper to ensure we can access core functions from app-v3.js
const getCore = () => window;

// --- Settings & Preferences ---

function loadUserPreferences() {
  try { return normalizeUserPreferences(JSON.parse(localStorage.getItem(window.USER_PREFERENCES_KEY) ?? "{}")); } catch { return { ...window.DEFAULT_USER_PREFERENCES }; }
}

function normalizeUserPreferences(raw = {}) {
  const theme = window.THEME_VALUES.has(raw.theme) ? raw.theme : window.DEFAULT_USER_PREFERENCES.theme;
  const density = ["airy", "compact"].includes(raw.density) ? raw.density : window.DEFAULT_USER_PREFERENCES.density;
  const motion = ["full", "calm"].includes(raw.motion) ? raw.motion : window.DEFAULT_USER_PREFERENCES.motion;
  const statusBarStrip = typeof raw.statusBarStrip === "boolean" ? raw.statusBarStrip : window.DEFAULT_USER_PREFERENCES.statusBarStrip;
  const notificationHideSender = typeof raw.notificationHideSender === "boolean" ? raw.notificationHideSender : window.DEFAULT_USER_PREFERENCES.notificationHideSender;
  const notificationHideBody = typeof raw.notificationHideBody === "boolean" ? raw.notificationHideBody : window.DEFAULT_USER_PREFERENCES.notificationHideBody;
  return { theme, density, motion, statusBarStrip, notificationHideSender, notificationHideBody };
}

function saveUserPreferences() { try { localStorage.setItem(window.USER_PREFERENCES_KEY, JSON.stringify(state.preferences)); } catch {} }

function applyUserPreferences(preferences) {
  document.body.dataset.theme = preferences.theme; 
  document.body.dataset.density = preferences.density; 
  document.body.dataset.motion = preferences.motion; 
  document.documentElement.dataset.statusBarStrip = preferences.statusBarStrip ? "on" : "off"; 
  document.documentElement.style.scrollBehavior = preferences.motion === "calm" ? "auto" : "smooth";
}

function openSettingsPanel() { 
  state.settingsPanelOpen = true; 
  state.settingsActivePage = "main"; 
  setMobileHeaderHidden(false); 
  renderSettingsPanel(); 
  requestAnimationFrame(() => elements.settingsCloseButton?.focus?.()); 
}

function closeSettingsPanel(options = {}) { 
  const { restoreFocus = true } = options; 
  if (!state.settingsPanelOpen) return; 
  state.settingsPanelOpen = false; 
  state.themePickerOpen = false; 
  renderSettingsPanel(); 
  if (restoreFocus) elements.settingsToggleButton.focus(); 
}

function toggleSettingsPanel(event) { 
  if (event) { event.preventDefault(); event.stopPropagation(); } 
  if (state.settingsPanelOpen) closeSettingsPanel(); else openSettingsPanel(); 
}

function renderSettingsPanel() {
  if (!elements.settingsPanel) return;
  const isOpen = state.settingsPanelOpen;
  if (!isOpen) state.themePickerOpen = false;
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
      if (window.renderThemePicker) window.renderThemePicker();
    }
  }
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
      <kbd style="background: #fff; color: #081017; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line, rgba(19, 33, 43, 0.2)); border-bottom: 3px solid var(--line, rgba(19, 33, 43, 0.3)); font-family: inherit; font-weight: 700; font-size: 0.8rem; min-width: 32px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: inline-flex; align-items: center; justify-content: center;">${key}</kbd>
    `;
    elements.shortcutsList.appendChild(item);
  });
}

function updateUserPreferences(nextPreferences) { 
  state.preferences = normalizeUserPreferences(nextPreferences); 
  applyUserPreferences(state.preferences); 
  saveUserPreferences(); 
  if (state.supabase && state.currentUser) {
    void window.syncCurrentProfileToSupabase().catch(err => console.error("[Preferences] Sync failed:", err));
  }
  renderSettingsPanel(); 
}

function resetUserPreferences() { 
  updateUserPreferences({ ...window.DEFAULT_USER_PREFERENCES }); 
  if (window.resetPlayerDockPosition) window.resetPlayerDockPosition(); 
  if (window.resetPlayerVolume) window.resetPlayerVolume(); 
}

// --- Notifications Panel ---

function openNotificationsPanel() { 
  state.notificationsPanelOpen = true; 
  setMobileHeaderHidden(false); 
  getCore().render();
  if (window.notifications?.resetBadge) window.notifications.resetBadge();
  if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  requestAnimationFrame(() => elements.notificationsCloseButton?.focus?.()); 
}

function closeNotificationsPanel(options = {}) { 
  const { restoreFocus = true } = options; 
  if (!state.notificationsPanelOpen) return; 
  state.notificationsPanelOpen = false; 
  getCore().render(); 
  if (restoreFocus && elements.notificationsLauncherButton) elements.notificationsLauncherButton.focus(); 
}

let lastToggleTime = 0;
function toggleNotificationsPanel(event) { 
  const now = Date.now();
  if (now - lastToggleTime < 300) return; 
  lastToggleTime = now;
  if (event) { event.preventDefault(); event.stopPropagation(); } 
  if (state.notificationsPanelOpen) closeNotificationsPanel(); else openNotificationsPanel(); 
}

// --- Overlay & Mobile UI Helpers ---

function syncOverlayBodyState() { document.body.classList.toggle("viewer-open", Boolean(state.viewerPostId || state.viewerAttachment || state.activeProfileKey)); }

function setMobileHeaderHidden(hidden) { state.mobileHeaderHidden = hidden; elements.siteHeader.classList.toggle("is-hidden", hidden); }

function syncMobileHeaderVisibility() { 
  if (!(window.isMobileHeaderViewport && window.isMobileHeaderViewport())) { setMobileHeaderHidden(false); state.lastScrollY = window.scrollY; return; } 
  if (state.settingsPanelOpen || window.scrollY <= 24) setMobileHeaderHidden(false); 
  state.lastScrollY = window.scrollY; 
}

function handleWindowScroll() { 
  if (!(window.isMobileHeaderViewport && window.isMobileHeaderViewport())) return; 
  const currentScrollY = window.scrollY; 
  if (state.settingsPanelOpen || currentScrollY <= 24) { setMobileHeaderHidden(false); state.lastScrollY = currentScrollY; return; } 
  const delta = currentScrollY - state.lastScrollY; 
  if (Math.abs(delta) < 8) { state.lastScrollY = currentScrollY; return; } 
  if (delta > 0) setMobileHeaderHidden(true); else setMobileHeaderHidden(false); 
  state.lastScrollY = currentScrollY; 
}

function updateViewportMetrics() {
  const root = document.documentElement; const viewport = window.visualViewport; 
  const offsetTop = viewport ? Math.max(0, Math.round(viewport.offsetTop)) : 0; 
  const visibleHeight = viewport ? Math.round(viewport.height) : window.innerHeight; 
  const offsetBottom = viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0;
  root.style.setProperty("--viewport-offset-top", `${offsetTop}px`); 
  root.style.setProperty("--viewport-offset-bottom", `${offsetBottom}px`); 
  root.style.setProperty("--viewport-visible-height", `${visibleHeight}px`);
}

function handleViewportResize() { 
  updateViewportMetrics(); 
  syncMobileHeaderVisibility(); 
  if (window.syncMobileMessengerMode) window.syncMobileMessengerMode(); 
  if (state.playerPostId && state.playerPosition && window.applyMiniPlayerPosition) window.applyMiniPlayerPosition(); 
}

function showFeedback(message, isError = false) { elements.formFeedback.textContent = message; elements.formFeedback.classList.toggle("is-error", isError); }
function showAuthFeedback(message, isError = false) { elements.authFeedback.textContent = message; elements.authFeedback.classList.toggle("is-error", isError); }
function setStatusPill(text, tone) { elements.authStatusPill.textContent = text; elements.authStatusPill.classList.remove("is-live", "is-warning"); if (tone === "live") elements.authStatusPill.classList.add("is-live"); if (tone === "warning") elements.authStatusPill.classList.add("is-warning"); }

// --- Messenger Logic ---

function clearMessengerState() {
  state.messages = [];
  state.activeThreadId = "";
  state.messengerOpen = false;
  state.messengerExpanded = false;
  state.messageAttachment = null;
  state.peopleSearch = "";
  state.conversationSearch = "";
}

function setMessengerStatus(text, tone) {
  elements.messengerStatusPill.textContent = text;
  elements.messengerStatusPill.classList.remove("is-live", "is-warning");
  if (tone === "live") elements.messengerStatusPill.classList.add("is-live");
  if (tone === "warning") elements.messengerStatusPill.classList.add("is-warning");
}

function renderMessengerDock() {
  const isOpen = state.messengerOpen;
  const isExpanded = state.messengerExpanded;
  elements.messengerSection.classList.toggle("is-open", isOpen);
  elements.messengerSection.classList.toggle("is-expanded", isExpanded);
  elements.messengerSection.setAttribute("aria-expanded", String(isOpen));
  elements.messengerExpandButton.setAttribute("aria-expanded", String(isExpanded));
  elements.messengerLauncherButton.classList.toggle("is-hidden", isOpen);
  syncMessengerDockScrollState();
}

function syncMessengerDockScrollState() {
  if (state.messengerOpen) {
    document.body.style.overflow = state.messengerExpanded ? "hidden" : "";
  } else {
    document.body.style.overflow = "";
  }
}

function renderMessenger() {
  const isEnabled = state.backendMode === "supabase" && Boolean(state.currentUser);
  elements.messengerSection.hidden = !isEnabled;
  if (!isEnabled) return;

  const partnerProfile = getThreadPartnerProfile(state.activeThreadId);
  elements.activeThreadLabel.textContent = partnerProfile?.displayName || "Select a conversation";
  elements.activeThreadMeta.textContent = partnerProfile ? (partnerProfile.email || "Member") : "Choose a member to start messaging.";

  renderPeopleList();
  renderConversationList();
  renderActiveThread();
  renderMessengerDock();
}

function focusMessengerPrimaryControl() {
  if (state.activeThreadId) {
    elements.messageInput.focus();
  } else {
    elements.peopleSearchInput.focus();
  }
}

function openMessengerDock() {
  state.messengerOpen = true;
  renderMessenger();
  focusMessengerPrimaryControl();
}

function collapseMessengerDock() {
  state.messengerExpanded = false;
  renderMessenger();
}

function closeMessengerDock() {
  state.messengerOpen = false;
  state.messengerExpanded = false;
  renderMessenger();
}

function toggleMessengerExpansion() {
  state.messengerExpanded = !state.messengerExpanded;
  renderMessenger();
}

function handleMessengerLauncherClick() {
  openMessengerDock();
}

function handleMessagesNavClick() {
  openMessengerDock();
}

function handleMessengerMinimizeClick() {
  closeMessengerDock();
}

function handleExpandedMessengerOutsideClick(event) {
  if (state.messengerExpanded && !elements.messengerSection.contains(event.target) && !elements.messengerLauncherButton.contains(event.target)) {
    collapseMessengerDock();
  }
}

function renderAdminBanPanel() {
  const isAdmin = getCore().isCurrentUserAdmin();
  elements.adminBanPanel.hidden = !isAdmin;
  if (!isAdmin) return;
  
  elements.adminBanPanel.classList.add("is-open");
  elements.adminBanPanel.setAttribute("aria-hidden", "false");
  renderAdminBanList();
}

function renderAdminBanList() {
  const profiles = getFilteredAdminBanProfiles();
  elements.adminBanList.innerHTML = "";
  
  if (profiles.length === 0) {
    elements.adminBanEmpty.hidden = false;
    return;
  }
  
  elements.adminBanEmpty.hidden = true;
  profiles.forEach(profile => {
    const isBanned = state.bannedUserIds.includes(profile.id);
    const row = document.createElement("div");
    row.className = "admin-ban-row";
    row.innerHTML = `
      <div class="admin-ban-info">
        <strong>${profile.displayName || "Member"}</strong>
        <span>${profile.email || profile.id}</span>
      </div>
      <button class="button ${isBanned ? 'button-secondary' : 'button-danger'}" type="button">
        ${isBanned ? 'Unban' : 'Ban'}
      </button>
    `;
    row.querySelector("button").addEventListener("click", () => toggleUserBan(profile.id, !isBanned));
    elements.adminBanList.appendChild(row);
  });
}

function getFilteredAdminBanProfiles() {
  const query = state.adminBanSearch.toLowerCase();
  return state.availableProfiles.filter(p => {
    if (p.id === state.currentUser?.id) return false;
    if (!query) return true;
    return (p.displayName || "").toLowerCase().includes(query) || (p.email || "").toLowerCase().includes(query);
  });
}

function showAdminBanFeedback(msg, isError) {
  elements.adminBanFeedback.textContent = msg;
  elements.adminBanFeedback.classList.toggle("is-error", isError);
}

async function refreshAdminBanState() {
  if (!getCore().isCurrentUserAdmin()) return;
  try {
    const [profiles, bans] = await Promise.all([
      loadProfilesFromSupabase(),
      loadUserBansFromSupabase()
    ]);
    state.availableProfiles = profiles;
    state.bannedUserIds = bans.map(b => b.user_id);
    renderAdminBanPanel();
  } catch (err) {
    console.error("Ban state refresh failed", err);
    showAdminBanFeedback("Could not refresh member list", true);
  }
}

async function toggleUserBan(userId, shouldBan) {
  if (!getCore().isCurrentUserAdmin()) return;
  try {
    if (shouldBan) {
      await state.supabase.from("user_bans").insert({ user_id: userId, banned_by: state.currentUser.id });
    } else {
      await state.supabase.from("user_bans").delete().eq("user_id", userId);
    }
    await refreshAdminBanState();
    showAdminBanFeedback(shouldBan ? "User banned" : "User unbanned", false);
  } catch (err) {
    console.error("Ban toggle failed", err);
    showAdminBanFeedback("Operation failed", true);
  }
}

function handleAdminBanLauncherClick() {
  renderAdminBanPanel();
}

function closeAdminBanPanel() {
  elements.adminBanPanel.classList.remove("is-open");
  elements.adminBanPanel.setAttribute("aria-hidden", "true");
}

function renderPeopleList() {
  const profiles = getFilteredPeopleProfiles();
  elements.peopleList.innerHTML = "";
  elements.peopleEmpty.hidden = profiles.length !== 0;

  profiles.forEach((profile) => {
    const isBlocked = isUserBlocked(profile.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `messenger-row ${isBlocked ? "is-blocked" : ""}`;
    row.innerHTML = `
      <div class="messenger-avatar">${getCore().getProfileInitials(profile.displayName)}</div>
      <div class="messenger-info">
        <strong>${profile.displayName}</strong>
        <span>${isBlocked ? "Blocked" : (profile.email || "Member")}</span>
      </div>
      <div class="messenger-actions">
        <button class="messenger-action-icon block-toggle" title="${isBlocked ? "Unblock" : "Block"}">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm5.31-3.1L6.69 5.69C8.04 4.63 9.74 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z" fill="currentColor"/></svg>
        </button>
      </div>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".block-toggle")) {
        toggleProfileBlock(profile.id);
      } else if (!isBlocked) {
        openOrCreateThread(profile.id);
      }
    });
    elements.peopleList.appendChild(row);
  });
}

function isUserBlocked(userId) {
  return Array.isArray(state.blockedUserIds) && state.blockedUserIds.includes(userId);
}

async function toggleProfileBlock(userId) {
  const isBlocked = isUserBlocked(userId);
  try {
    if (isBlocked) {
      await state.supabase.from("user_blocks").delete().eq("blocked_user_id", userId).eq("user_id", state.currentUser.id);
      state.blockedUserIds = state.blockedUserIds.filter(id => id !== userId);
    } else {
      await state.supabase.from("user_blocks").insert({ blocked_user_id: userId, user_id: state.currentUser.id });
      state.blockedUserIds = [...(state.blockedUserIds || []), userId];
    }
    renderMessenger();
  } catch (err) {
    console.error("Block toggle failed", err);
    showMessengerFeedback("Failed to update block status", true);
  }
}

function renderConversationList() {
  const threads = getFilteredConversationThreads();
  elements.conversationList.innerHTML = "";
  elements.conversationEmpty.hidden = threads.length !== 0;

  threads.forEach((thread) => {
    const partner = getThreadPartnerProfile(thread.id);
    const isActive = state.activeThreadId === thread.id;
    const isBlocked = isThreadBlocked(thread.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `messenger-row ${isActive ? "is-active" : ""} ${isBlocked ? "is-blocked" : ""}`;
    row.innerHTML = `
      <div class="messenger-avatar">${getCore().getProfileInitials(partner?.displayName || "??")}</div>
      <div class="messenger-info">
        <strong>${partner?.displayName || "Member"}</strong>
        <span>${isBlocked ? "Conversation blocked" : (thread.lastMessage || "No messages yet")}</span>
      </div>
      ${thread.unreadCount > 0 ? `<span class="messenger-unread">${thread.unreadCount}</span>` : ""}
    `;
    row.addEventListener("click", () => openExistingThread(thread.id));
    elements.conversationList.appendChild(row);
  });
}

function renderActiveThread(preserveScroll = false) {
  const thread = getActiveThread();
  const scrollPos = elements.messageList.scrollTop;
  const isAtBottom = elements.messageList.scrollHeight - elements.messageList.scrollTop <= elements.messageList.clientHeight + 100;

  elements.messageList.innerHTML = "";
  elements.messageEmpty.hidden = Boolean(thread && state.messages.length > 0);

  if (!state.activeThreadId) {
    elements.messageForm.hidden = true;
    return;
  }

  const isBlocked = isThreadBlocked(state.activeThreadId);
  elements.messageForm.hidden = isBlocked;
  if (isBlocked) {
    elements.messageEmpty.textContent = "You have blocked this member. Unblock them in the People tab to resume messaging.";
    elements.messageEmpty.hidden = false;
    return;
  }

  state.messages.forEach((msg) => {
    const isOwn = msg.senderId === state.currentUser?.id;
    const item = document.createElement("div");
    item.className = `message-item ${isOwn ? "is-own" : ""}`;
    
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    
    if (msg.body) {
      const text = document.createElement("p");
      text.className = "message-text";
      text.textContent = msg.body;
      bubble.appendChild(text);
    }
    
    if (msg.attachmentUrl) {
      const attachment = createMessageAttachmentNode(msg);
      bubble.appendChild(attachment);
    }
    
    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = formatMessageTimestamp(msg.createdAt);
    
    item.append(bubble, time);
    elements.messageList.appendChild(item);
  });

  if (preserveScroll) {
    elements.messageList.scrollTop = scrollPos;
  } else if (isAtBottom || state.messages.length > 0) {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }
}

function showMessengerFeedback(msg, isError) {
  elements.messengerFeedback.textContent = msg;
  elements.messengerFeedback.classList.toggle("is-error", isError);
}

function renderMessageEmojiPanel() {}
function toggleMessageEmojiPicker() {
  const isOpen = !elements.messageEmojiPanel.hidden;
  if (isOpen) closeMessageEmojiPicker();
  else {
    elements.messageEmojiPanel.hidden = false;
    elements.messageEmojiButton.setAttribute("aria-expanded", "true");
  }
}
function closeMessageEmojiPicker() {
  elements.messageEmojiPanel.hidden = true;
  elements.messageEmojiButton.setAttribute("aria-expanded", "false");
}
function handleMessageEmojiPanelClick(event) {
  const btn = event.target.closest("[data-emoji]");
  if (!btn) return;
  insertEmojiIntoMessage(btn.dataset.emoji);
}
function insertEmojiIntoMessage(emoji) {
  const start = elements.messageInput.selectionStart;
  const end = elements.messageInput.selectionEnd;
  const text = elements.messageInput.value;
  elements.messageInput.value = text.slice(0, start) + emoji + text.slice(end);
  elements.messageInput.focus();
  const nextPos = start + emoji.length;
  elements.messageInput.setSelectionRange(nextPos, nextPos);
}

function handleMessageAttachmentInputChange(event) {
  const [file] = Array.from(event.target.files || []);
  if (file) handleMessageAttachmentSelection(file);
}

function handleMessageAttachmentSelection(file) {
  if (file.size > 50 * 1024 * 1024) {
    showMessengerFeedback("Attachment too large (max 50MB)", true);
    return;
  }
  state.messageAttachment = file;
  renderMessageAttachmentPreview();
}

function clearMessageAttachmentSelection() {
  state.messageAttachment = null;
  elements.messageAttachmentInput.value = "";
  renderMessageAttachmentPreview();
}

function renderMessageAttachmentPreview() {
  const file = state.messageAttachment;
  elements.messageAttachmentPreview.hidden = !file;
  elements.messageAttachmentClearButton.hidden = !file;
  elements.messageAttachmentPreview.innerHTML = "";
  if (file) {
    const node = createMessageAttachmentPreviewNode(file);
    elements.messageAttachmentPreview.appendChild(node);
  }
}

function getMessageSenderLabel(senderId) {
  if (senderId === state.currentUser?.id) return "You";
  const profile = (state.availableProfiles || []).find(p => p.id === senderId);
  return profile?.displayName || "Member";
}

function createMessageAttachmentPreviewNode(file) {
  const wrapper = document.createElement("div");
  wrapper.className = "attachment-preview-item";
  const kind = getCore().getMediaKind(file.type);
  wrapper.textContent = `${kind === 'image' ? '🖼️' : (kind === 'video' ? '🎬' : '🎵')} ${file.name}`;
  return wrapper;
}

function createMessageAttachmentNode(msg) {
  const kind = msg.attachmentKind || "file";
  const wrapper = document.createElement("div");
  wrapper.className = `message-attachment message-attachment-${kind}`;
  const trigger = createMessageAttachmentTrigger(msg);
  wrapper.appendChild(trigger);
  return wrapper;
}

function createMessageAttachmentTrigger(msg) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "attachment-trigger";
  const kind = msg.attachmentKind;
  btn.innerHTML = `
    <span class="attachment-icon">${kind === 'image' ? '🖼️' : (kind === 'video' ? '🎬' : '🎵')}</span>
    <span class="attachment-name">${msg.attachmentName || "Attachment"}</span>
  `;
  btn.addEventListener("click", () => openMessageAttachmentViewer(msg));
  return btn;
}

function openMessageAttachmentViewer(msg) {
  if (!msg.attachmentUrl) return;
  getCore().openViewer(null, null); // Clear existing
  state.viewerAttachment = {
    url: msg.attachmentUrl,
    kind: msg.attachmentKind || "image",
    title: msg.attachmentName || "Shared media",
    caption: `From ${getMessageSenderLabel(msg.senderId)}`,
    creator: getMessageSenderLabel(msg.senderId),
    createdAt: msg.createdAt
  };
  renderViewer();
}

function createMessageFileNode(msg) {
  const link = document.createElement("a");
  link.href = msg.attachmentUrl;
  link.target = "_blank";
  link.textContent = msg.attachmentName || "Download file";
  return link;
}

function getMessageAttachmentKind(type) {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "audio";
}

function formatAttachmentTypeLabel(kind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function normalizeUserBlock(row) { return row.blocked_user_id; }
function normalizeUserBan(row) { return row.user_id; }
function normalizeDirectThread(row) {
  return {
    id: row.id,
    participants: [row.user_a, row.user_b],
    lastMessage: row.last_message_body || "",
    lastActivity: row.updated_at,
    unreadCount: 0
  };
}
function normalizeMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    body: row.body || "",
    createdAt: row.created_at,
    attachmentUrl: row.attachment_file_path || "",
    attachmentName: row.attachment_name || "",
    attachmentKind: row.attachment_kind || ""
  };
}

function getThreadPartnerId(threadId) {
  const thread = state.threads.find(t => t.id === threadId);
  if (!thread) return "";
  return thread.participants.find(id => id !== state.currentUser?.id) || "";
}

function getThreadPartnerProfile(threadId) {
  const partnerId = getThreadPartnerId(threadId);
  return state.availableProfiles.find(p => p.id === partnerId) || null;
}

function getFilteredPeopleProfiles() {
  const query = (state.peopleSearch || "").toLowerCase();
  return state.availableProfiles.filter(p => {
    if (p.id === state.currentUser?.id) return false;
    if (!query) return true;
    return (p.displayName || "").toLowerCase().includes(query) || (p.email || "").toLowerCase().includes(query);
  });
}

function getFilteredConversationThreads() {
  const query = (state.conversationSearch || "").toLowerCase();
  const threads = state.threads.filter(t => {
    const partner = getThreadPartnerProfile(t.id);
    if (!query) return true;
    return (partner?.displayName || "").toLowerCase().includes(query) || (partner?.email || "").toLowerCase().includes(query);
  });
  return sortThreads(threads);
}

function isThreadBlocked(threadId) {
  const partnerId = getThreadPartnerId(threadId);
  return isUserBlocked(partnerId);
}

function getActiveThread() {
  return state.threads.find(t => t.id === state.activeThreadId) || null;
}

function sortThreads(threads) {
  return [...threads].sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
}

function mergeThread(thread) {
  const index = state.threads.findIndex(t => t.id === thread.id);
  if (index !== -1) state.threads[index] = { ...state.threads[index], ...thread };
  else state.threads.push(thread);
}

function mergeActiveMessage(message) {
  if (message.threadId !== state.activeThreadId) return;
  if (state.messages.some(m => m.id === message.id)) return;
  state.messages.push(message);
}

function canonicalizeThreadPair(idA, idB) {
  return [idA, idB].sort().join(":");
}

async function syncCurrentProfileToSupabase() {
  if (!state.supabase || !state.currentUser) return;
  const payload = {
    id: state.currentUser.id,
    display_name: state.profileRecord.displayName,
    email: state.currentUser.email,
    updated_at: new Date().toISOString()
  };
  const { error } = await state.supabase.from("profiles").upsert(payload);
  if (error) throw error;
}

async function finalizeProfileSync() {
  await syncCurrentProfileToSupabase();
  await refreshMessengerState({ preserveActiveThread: true });
}

async function loadOwnProfileFromSupabase() {
  const { data, error } = await state.supabase.from("profiles").select("*").eq("id", state.currentUser.id).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, displayName: data.display_name, email: data.email, createdAt: data.created_at } : null;
}

async function loadProfilesFromSupabase() {
  const { data, error } = await state.supabase.from("profiles").select("*").limit(100);
  if (error) throw error;
  return (data || []).map(d => ({ id: d.id, displayName: d.display_name, email: d.email, createdAt: d.created_at }));
}

async function loadBlockedUsersFromSupabase() {
  const { data, error } = await state.supabase.from("user_blocks").select("blocked_user_id").eq("user_id", state.currentUser.id);
  if (error) throw error;
  return (data || []).map(normalizeUserBlock);
}

async function loadUserBansFromSupabase() {
  const { data, error } = await state.supabase.from("user_bans").select("*");
  if (error) throw error;
  return (data || []).map(normalizeUserBan);
}

async function loadCurrentUserBanFromSupabase() {
  const { data, error } = await state.supabase.from("user_bans").select("*").eq("user_id", state.currentUser.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function refreshCurrentUserBanState() {
  if (!state.supabase || !state.currentUser) return;
  try {
    state.currentUserBanned = await loadCurrentUserBanFromSupabase();
    if (state.currentUserBanned) {
      getCore().showOverlay();
    } else {
      getCore().hideOverlay();
    }
  } catch (err) {
    console.error("Ban check failed", err);
  }
}

async function loadDirectThreadsFromSupabase() {
  const { data, error } = await state.supabase.from("direct_threads").select("*").or(`user_a.eq.${state.currentUser.id},user_b.eq.${state.currentUser.id}`);
  if (error) throw error;
  return (data || []).map(normalizeDirectThread);
}

async function loadMessagesFromSupabase(threadId) {
  const { data, error } = await state.supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(normalizeMessage);
}

async function loadThreadAttachmentPaths(threadId) {
  return []; // Placeholder if needed
}

async function refreshMessengerState(options = {}) {
  if (!getCore().isMessagingEnabled(state)) {
    clearMessengerState();
    return;
  }
  
  const { preserveActiveThread = false } = options;
  try {
    const [profiles, blocks, threads] = await Promise.all([
      loadProfilesFromSupabase(),
      loadBlockedUsersFromSupabase(),
      loadDirectThreadsFromSupabase()
    ]);
    
    state.availableProfiles = profiles;
    state.blockedUserIds = blocks;
    state.threads = threads;
    
    if (preserveActiveThread && state.activeThreadId) {
      state.messages = await loadMessagesFromSupabase(state.activeThreadId);
    } else {
      state.activeThreadId = "";
      state.messages = [];
    }
    
    setMessengerStatus("Live", "live");
    renderMessenger();
    subscribeMessagingChannels();
  } catch (err) {
    console.error("Messenger refresh failed", err);
    setMessengerStatus("Sync issue", "warning");
  }
}

function unsubscribeMessagingChannels() {
  if (state.messengerRealtime) {
    state.messengerRealtime.stop();
    state.messengerRealtime = null;
  }
}

function subscribeMessagingChannels() {
  if (!getCore().isMessagingEnabled(state) || state.messengerRealtime) return;
  state.messengerRealtime = new window.MessengerRealtime(state);
  state.messengerRealtime.init();
}

function playIncomingMessageSound() {
  const audio = new Audio("https://falabellamichael.github.io/Signal-Share/message-receive.mp3");
  audio.volume = 0.5;
  void audio.play().catch(() => {});
}

async function openExistingThread(threadId) {
  state.activeThreadId = threadId;
  state.messages = await loadMessagesFromSupabase(threadId);
  renderMessenger();
}

async function deleteConversation(threadId) {
  if (!confirm("Are you sure you want to delete this conversation? This will hide it from your list but won't delete messages for the other person.")) return;
  // Implementation for hiding/deleting threads could go here
}

async function openOrCreateThread(partnerId) {
  const existing = state.threads.find(t => t.participants.includes(partnerId));
  if (existing) {
    await openExistingThread(existing.id);
    return;
  }
  
  try {
    const threadId = canonicalizeThreadPair(state.currentUser.id, partnerId);
    const { data, error } = await state.supabase.from("direct_threads").upsert({
      id: threadId,
      user_a: state.currentUser.id < partnerId ? state.currentUser.id : partnerId,
      user_b: state.currentUser.id < partnerId ? partnerId : state.currentUser.id,
      updated_at: new Date().toISOString()
    }).select().single();
    
    if (error) throw error;
    mergeThread(normalizeDirectThread(data));
    await openExistingThread(data.id);
  } catch (err) {
    console.error("Thread creation failed", err);
    showMessengerFeedback("Could not start conversation", true);
  }
}

async function handleMessageSubmit(event) {
  event?.preventDefault();
  const body = elements.messageInput.value.trim();
  const attachment = state.messageAttachment;
  
  if (!body && !attachment) return;
  if (!state.activeThreadId || !state.currentUser) return;
  
  const threadId = state.activeThreadId;
  elements.messageInput.value = "";
  clearMessageAttachmentSelection();
  
  try {
    let attachmentUrl = "";
    let attachmentName = "";
    let attachmentKind = "";
    
    if (attachment) {
      showMessengerFeedback("Uploading attachment...", false);
      const path = await uploadMessageAttachment(attachment, state.currentUser.id);
      attachmentUrl = state.supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      attachmentName = attachment.name;
      attachmentKind = getMessageAttachmentKind(attachment.type);
    }
    
    const payload = {
      thread_id: threadId,
      sender_id: state.currentUser.id,
      body: body,
      attachment_file_path: attachmentUrl,
      attachment_name: attachmentName,
      attachment_kind: attachmentKind
    };
    
    const { data, error } = await state.supabase.from("messages").insert(payload).select().single();
    if (error) throw error;
    
    const message = normalizeMessage(data);
    mergeActiveMessage(message);
    renderActiveThread();
    showMessengerFeedback("", false);
    
    // Update thread activity
    await state.supabase.from("direct_threads").update({
      last_message_body: body || `Sent an ${attachmentKind}`,
      updated_at: new Date().toISOString()
    }).eq("id", threadId);

    // Trigger notification dispatch via Edge Function
    const partnerId = getThreadPartnerId(threadId);
    void getCore().triggerMessageNotificationDispatch(partnerId, body || `Sent an ${attachmentKind}`, threadId).catch(console.error);

  } catch (err) {
    console.error("Message send failed", err);
    showMessengerFeedback("Failed to send message", true);
  }
}

function formatMessageTimestamp(iso) {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// UI Rendering & Helpers
// Extracted from app-v3.js

function updateUserPreferences(nextPreferences) { 
  state.preferences = getCore().normalizeUserPreferences(nextPreferences); 
  getCore().applyUserPreferences(state.preferences); 
  getCore().saveUserPreferences(); 
  if (state.supabase && state.currentUser) {
    void syncCurrentProfileToSupabase().catch(err => {
      console.error("[Preferences] Sync failed:", err);
      if (window.notifications) {
        window.notifications.error("Failed to sync privacy settings to database.", "Sync Error");
      }
    });
  }
  getCore().renderSettingsPanel(); 
}

function handleThemeOptionClick(event) { const button = event.target.closest("[data-theme-option]"); if (!button) return; updateUserPreferences({ ...state.preferences, theme: button.dataset.themeOption }); }
function handleDensityChange(event) { updateUserPreferences({ ...state.preferences, density: event.target.value }); }
function handleMotionChange(event) { updateUserPreferences({ ...state.preferences, motion: event.target.value }); }
function handleStatusBarStripToggle(event) { updateUserPreferences({ ...state.preferences, statusBarStrip: event.target.checked }); }
function handleNotificationHideSenderToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideSender: event.target.checked }); }
function handleNotificationHideBodyToggle(event) { updateUserPreferences({ ...state.preferences, notificationHideBody: event.target.checked }); }

function resetPlayerDockPosition() { state.playerPosition = null; savePlayerPosition(null); applyMiniPlayerPosition(); }
function resetPlayerVolume() { state.playerVolume = 1; savePlayerVolume(1); applyPlayerVolumeToActiveElement(); renderMiniPlayerVolumeControl(); }
function resetUserPreferences() { updateUserPreferences({ ...window.DEFAULT_USER_PREFERENCES }); resetPlayerDockPosition(); resetPlayerVolume(); }

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

function isCurrentUserAdmin() { const emails = getCurrentUserEmailCandidates(); return emails.some((email) => window.APP_CONFIG.adminEmails.includes(email)); }
function canRevealMemberEmails() { return isCurrentUserAdmin(); }
function canUseLiveLikesForPost(post) { return Boolean(state.supabase && state.backendMode === "supabase" && state.currentUser && post && !post.isLocal); }
function getPersonalStateScope() { return state.currentUser?.id ? `user:${state.currentUser.id}` : "guest"; }
function getScopedStorageKey(baseKey, scope = getPersonalStateScope()) { return `${baseKey}:${scope}`; }
function parseStoredPostIds(rawValue) { try { const parsed = JSON.parse(rawValue ?? "[]"); return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string" && v.trim()) : []; } catch { return []; } }
function loadScopedPostIds(baseKey, scope = getPersonalStateScope()) { const scoped = parseStoredPostIds(localStorage.getItem(getScopedStorageKey(baseKey, scope))); if (scoped.length || scope !== "guest") return scoped; return parseStoredPostIds(localStorage.getItem(baseKey)); }
function persistScopedPostIds(baseKey, ids, scope = getPersonalStateScope()) { const normalizedIds = Array.isArray(ids) ? ids.filter((v) => typeof v === "string" && v.trim()) : []; try { localStorage.setItem(getScopedStorageKey(baseKey, scope), JSON.stringify(normalizedIds)); if (scope === "guest") localStorage.removeItem(baseKey); } catch {} }

async function refreshLikedPostsState() {
  if (state.supabase && state.backendMode === "supabase" && state.currentUser) { try { state.likedPosts = await loadLikedPostsFromSupabase(); return; } catch (error) { console.error("Like state could not be loaded from Supabase", error); } }
  state.likedPosts = getCore().loadLikedPosts();
}

function isAdminRestrictedUploadKind(mediaKind) { return mediaKind === "image" || mediaKind === "video" || mediaKind === "audio"; }
function canCurrentUserUploadMediaKind(mediaKind) { if (state.backendMode !== "supabase") return true; if (!isAdminRestrictedUploadKind(mediaKind)) return true; return isCurrentUserAdmin(); }
function getRestrictedUploadMessage(mediaKind) { if (mediaKind === "image") return "Only admin accounts can publish uploaded images."; if (mediaKind === "video") return "Only admin accounts can publish uploaded videos."; if (mediaKind === "audio") return "Only admin accounts can publish uploaded audio."; return "Only admin accounts can publish that upload type."; }

function syncSourceHelp() { if (state.previewExternal?.provider) { updateSourceHelp(state.previewExternal.provider); return; } if (state.selectedFile) { updateSourceHelp("upload"); return; } if (elements.externalUrlInput.value.trim() && !state.previewExternal) { updateSourceHelp("invalid"); return; } updateSourceHelp("none"); }
function canDeletePost(post) { if (!post) return false; if (post.isLocal) return true; if (state.backendMode !== "supabase" || !state.currentUser) return false; return isCurrentUserAdmin() || post.authorId === state.currentUser.id; }

function getAuthRedirectUrl() { return window.DEFAULT_AUTH_REDIRECT_URL; }

function normalizeModerationText(value) { return String(value ?? "").toLowerCase().normalize("NFKC").replace(/['\u2019]+/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function getActiveBlockedTerms() { return [...window.DEFAULT_BLOCKED_TERMS]; }
function normalizePostModerationTextSafe(value) { const curlyApostrophe = String.fromCharCode(8217); return String(value ?? "").toLowerCase().normalize("NFKC").split("'").join("").split(curlyApostrophe).join("").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function findBlockedPostTerm({ creator = "", title = "", caption = "", tags = [] }) { const normalizedPostText = normalizePostModerationTextSafe([creator, title, caption, ...(Array.isArray(tags) ? tags : [])].join(" ")); if (!normalizedPostText) return ""; const haystack = ` ${normalizedPostText} `; return getActiveBlockedTerms().find((term) => { const normalizedTerm = normalizePostModerationTextSafe(term); return normalizedTerm && haystack.includes(` ${normalizedTerm} `); }) ?? ""; }
function isPostModerationError(error) { const message = getCore().formatBackendError(error).toLowerCase(); return message.includes("blocked language"); }

function getSiteSettingsPayload() { return { id: "global", shell_width: state.siteSettings.shellWidth, section_gap: state.siteSettings.sectionGap, surface_radius: state.siteSettings.surfaceRadius, media_fit: state.siteSettings.mediaFit, updated_at: new Date().toISOString() }; }
function normalizeSiteSettings(row = {}) { return { shellWidth: clampNumber(row.shell_width, 960, 1440, 1200), sectionGap: clampNumber(row.section_gap, 16, 40, 24), surfaceRadius: clampNumber(row.surface_radius, 22, 44, 32), mediaFit: row.media_fit === "contain" ? "contain" : "cover" }; }
function clampNumber(value, min, max, fallback) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(max, Math.max(min, Math.round(numeric))); }

function loadPlayerPosition() { try { const raw = localStorage.getItem(window.PLAYER_POSITION_KEY); if (!raw) return null; const parsed = JSON.parse(raw); return { x: Math.round(parsed.x), y: Math.round(parsed.y) }; } catch { return null; } }
function normalizePlayerVolume(value, fallback = 1) { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(1, Math.max(0, numeric)); }
function loadPlayerVolume() { try { const raw = localStorage.getItem(window.PLAYER_VOLUME_KEY); if (!raw) return 1; return normalizePlayerVolume(raw); } catch { return 1; } }
function savePlayerVolume(volume) { try { localStorage.setItem(window.PLAYER_VOLUME_KEY, `${normalizePlayerVolume(volume)}`); } catch {} }
function savePlayerPosition(position) { try { if (!position) { localStorage.removeItem(window.PLAYER_POSITION_KEY); return; } localStorage.setItem(window.PLAYER_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })); } catch {} }

function getPlayerViewportPadding() { return window.innerWidth <= 760 ? 12 : 20; }
function clampPlayerPosition(position) { if (!position) return null; const padding = getPlayerViewportPadding(); const width = elements.miniPlayer.offsetWidth || 360; const height = elements.miniPlayer.offsetHeight || 280; const maxX = Math.max(padding, window.innerWidth - width - padding); const maxY = Math.max(padding, window.innerHeight - height - padding); return { x: Math.min(maxX, Math.max(padding, Math.round(position.x))), y: Math.min(maxY, Math.max(padding, Math.round(position.y))) }; }

function applyMiniPlayerPosition() {
  if (!state.playerPosition) { elements.miniPlayer.style.left = ""; elements.miniPlayer.style.top = ""; elements.miniPlayer.style.right = ""; elements.miniPlayer.style.bottom = ""; return; }
  const nextPosition = clampPlayerPosition(state.playerPosition); state.playerPosition = nextPosition; savePlayerPosition(nextPosition);
  elements.miniPlayer.style.left = `${nextPosition.x}px`; elements.miniPlayer.style.top = `${nextPosition.y}px`; elements.miniPlayer.style.right = "auto"; elements.miniPlayer.style.bottom = "auto";
}

function beginMiniPlayerDrag(event) {
  const target = event.target instanceof Element ? event.target : null; if (!state.playerPostId || target?.closest("button")) return;
  const rect = elements.miniPlayer.getBoundingClientRect();
  state.playerPosition = clampPlayerPosition(state.playerPosition ?? { x: rect.left, y: rect.top });
  state.playerDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  elements.miniPlayer.classList.add("is-dragging");
  try { elements.miniPlayerHead.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
}

function handleMiniPlayerDrag(event) { if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; state.playerPosition = clampPlayerPosition({ x: event.clientX - state.playerDrag.offsetX, y: event.clientY - state.playerDrag.offsetY }); applyMiniPlayerPosition(); }
function endMiniPlayerDrag(event) { if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; try { elements.miniPlayerHead.releasePointerCapture(event.pointerId); } catch {} state.playerDrag = null; elements.miniPlayer.classList.remove("is-dragging"); savePlayerPosition(state.playerPosition); }

function handleViewportResize() { updateViewportMetrics(); syncMobileHeaderVisibility(); syncMobileMessengerMode(); if (state.playerPostId && state.playerPosition) applyMiniPlayerPosition(); }
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

function handleWindowClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  
  // Theme picker
  if (state.themePickerOpen && !target.closest("#themePickerButton") && !target.closest("#themePickerMenu")) closeThemePicker();
  
  // Emoji picker
  if (state.messageEmojiPickerOpen && !target.closest("#messageEmojiPanel") && !target.closest("#messageEmojiButton")) closeMessageEmojiPicker();
  
  // Admin Ban Panel
  if (state.adminBanPanelOpen && !target.closest("#adminBanPanel") && !target.closest("#adminBanLauncherButton")) closeAdminBanPanel({ restoreFocus: false });
  
  // Messenger Outside Click (Simplified/Consolidated)
  if (state.messengerExpanded) {
    const isMessengerControl = target.closest("#messages") || target.closest("#messengerDock") || target.closest("#messengerLauncherButton") || target.closest("#messagesNavLink");
    const isOverlay = target.closest("#settingsPanel") || target.closest("#notificationsPanel") || target.closest("#keyboardShortcutsPanel") || target.closest("#viewer");
    if (!isMessengerControl && !isOverlay) {
      collapseMessengerDock();
    }
  }
}

function handleSelectedFile(file) {
  if (!/^image\/|^video\/|^audio\//.test(file.type)) { clearSelectedMedia(); showFeedback("Only image, video, or audio uploads are supported.", true); return; }
  const mediaKind = getMediaKind(file.type);
  const sizeLimit = mediaKind === "image" ? window.MAX_IMAGE_FILE_SIZE : window.MAX_VIDEO_FILE_SIZE;
  if (file.size > sizeLimit) { clearSelectedMedia(); showFeedback(`Choose a ${mediaKind} smaller than ${mediaKind === "image" ? "50 MB" : "15 MB"}.`, true); return; }
  if (!isCurrentUserAdmin() && ["image", "video", "audio"].includes(mediaKind)) { 
     // Fallback if the logic in app-v3.js wasn't called
     if (state.backendMode === "supabase") {
       clearSelectedMedia(); 
       showFeedback("Only admin accounts can publish that upload type to the live feed.", true); 
       return; 
     }
  }
  if (elements.externalUrlInput.value.trim()) { elements.externalUrlInput.value = ""; state.previewExternal = null; }
  state.selectedFile = file;
  updateSourceHelp("upload");
  showFeedback(`${file.name} is ready to publish.`);
  renderPreview(file);
}

function handleExternalUrlInput(event) {
  const rawUrl = event.target.value.trim();
  if (!rawUrl) { state.previewExternal = null; if (!state.selectedFile) { clearPreviewOnly(); updateSourceHelp("none"); } return; }
  const parsed = parseYouTubeUrl(rawUrl) || parseSpotifyUrl(rawUrl);
  if (!parsed) { state.previewExternal = null; if (!state.selectedFile) clearPreviewOnly(); updateSourceHelp("invalid"); showFeedback("Only YouTube and Spotify links are supported for external media.", true); return; }
  clearSelectedMedia({ preserveFeedback: true });
  state.previewExternal = parsed;
  updateSourceHelp(parsed.provider);
  renderExternalPreview(parsed);
  showFeedback(`${parsed.provider.charAt(0).toUpperCase() + parsed.provider.slice(1)} link is ready to publish.`);
}

function renderPreview(file) {
  clearPreviewOnly();
  elements.previewStage.hidden = false;
  elements.clearPreviewButton.hidden = false;
  const kind = getMediaKind(file.type);
  const url = URL.createObjectURL(file);
  state.previewUrl = url;
  
  if (kind === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Preview";
    elements.previewStage.appendChild(img);
  } else if (kind === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    elements.previewStage.appendChild(video);
  } else {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.controls = true;
    elements.previewStage.appendChild(audio);
  }
}

function clearPreviewOnly() {
  elements.previewStage.hidden = true;
  elements.clearPreviewButton.hidden = true;
  elements.previewStage.innerHTML = "";
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
}

function parseSpotifyUrl(raw) {
  let url; try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.replace(/^open\./, "").replace(/^play\./, ""); if (host !== "spotify.com") return null;
  const segments = url.pathname.split("/").filter(Boolean); const allowed = ["track", "album", "playlist", "artist", "episode", "show"]; const [type, id] = segments;
  if (!allowed.includes(type) || !id) return null;
  return { provider: "spotify", mediaKind: "audio", externalId: id, embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`, originalUrl: raw, label: `Spotify ${type}` };
}

function getMediaKind(type) { if (type.startsWith("image/")) return "image"; if (type.startsWith("video/")) return "video"; return "audio"; }
function clearSelectedMedia(options = {}) { const { preserveFeedback = false } = options; state.selectedFile = null; elements.mediaInput.value = ""; clearPreviewOnly(); if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ""; } if (!preserveFeedback) elements.formFeedback.classList.remove("is-error"); }
function renderExternalPreview(parsed) {
  clearPreviewOnly();
  elements.previewStage.hidden = false;
  elements.clearPreviewButton.hidden = false;
  const iframe = document.createElement("iframe");
  iframe.src = parsed.embedUrl;
  iframe.width = "100%";
  iframe.height = "352";
  iframe.frameBorder = "0";
  iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  elements.previewStage.appendChild(iframe);
}

function syncProfileNavAvatar() {
  const profile = state.profileRecord;
  const initials = profile ? getProfileInitials(profile.displayName) : "--";
  if (elements.profileNavAvatar) {
    elements.profileNavAvatar.textContent = initials;
    elements.profileNavAvatar.setAttribute("aria-label", profile ? `View your profile (${profile.displayName})` : "View your profile");
  }
}

function renderStats() {
  const posts = getAllPosts();
  const creators = new Set(posts.map((post) => getProfileKeyForPost(post)).filter(Boolean));
  const stats = { posts: posts.length, creators: creators.size };
  Object.entries(stats).forEach(([key, value]) => { 
    const target = elements.statsPanel.querySelector(`[data-stat="${key}"]`); 
    if (target) target.textContent = String(value); 
  });
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
    if (state.backendError) { 
      setStatusPill("Setup failed", "warning"); 
      elements.authStatusCopy.textContent = state.backendError; 
      elements.authHint.textContent = "Supabase config is present, but startup failed. Rerun the SQL schema and confirm the live config file is deployed."; 
    } else {
      setStatusPill("Local mode");
      elements.authStatusCopy.textContent = "Connect Supabase to enable login and live posting.";
      elements.authHint.textContent = "Signed-in and activated accounts can publish to the shared feed.";
    }
  } else {
    if (isSignedIn) {
      if (isActivated) {
        setStatusPill("Live", "live");
        elements.authStatusCopy.textContent = "Authenticated and activated.";
        elements.authHint.textContent = "You can publish to the shared feed and use the Direct Messenger.";
        elements.accountEmail.textContent = getCurrentUserEmail();
        elements.accountMeta.textContent = "Member account active";
      } else {
        setStatusPill("Awaiting activation", "warning");
        elements.authStatusCopy.textContent = "Email confirmation pending.";
        elements.authHint.textContent = "Confirm your email to unlock all features.";
        elements.accountEmail.textContent = getCurrentUserEmail();
        elements.accountMeta.textContent = "Confirm your email address";
        
        if (pendingEmail) {
          elements.activationTitle.textContent = "Check your inbox";
          elements.activationMessage.textContent = `Confirmation link sent to ${pendingEmail}.`;
        }
      }
    } else {
      setStatusPill("Live", "live");
      elements.authStatusCopy.textContent = "Connected to Supabase.";
      elements.authHint.textContent = "Sign in or create an account to start publishing to the live feed.";
    }
  }
}

function renderNotificationsPanel() {
  const isOpen = state.notificationsPanelOpen;
  if (elements.notificationsPanel) {
    elements.notificationsPanel.hidden = !isOpen;
    elements.notificationsPanel.classList.toggle("is-open", isOpen);
    elements.notificationsPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }
  syncOverlayBodyState();
}

function updateComposerAccess() {
  const liveLocked = state.backendMode === "supabase" && !canPublishToLiveFeed(state);
  const lockedMessage = isCurrentUserBanned(state) ? "This account is banned from publishing to the live feed." : "Sign in with an activated account to publish to the live feed.";
  elements.postForm.querySelectorAll("input, textarea, button").forEach((element) => { 
    if (element.id === "resetFormButton") { element.disabled = false; return; } 
    element.disabled = liveLocked; 
  });
  elements.dropzone.tabIndex = liveLocked ? -1 : 0; 
  elements.dropzone.setAttribute("aria-disabled", liveLocked ? "true" : "false"); 
  elements.dropzone.classList.toggle("is-disabled", liveLocked);
  
  if (liveLocked) { 
    if (elements.formFeedback.textContent !== lockedMessage || !elements.formFeedback.classList.contains("is-error")) showFeedback(lockedMessage, true); 
    return; 
  }
  if (elements.formFeedback.textContent === lockedMessage) showFeedback("");
}

function applySiteSettings(settings) { const root = document.documentElement; root.style.setProperty("--shell-max-width", `${settings.shellWidth}px`); root.style.setProperty("--section-gap", `${settings.sectionGap}px`); root.style.setProperty("--radius-xl", `${settings.surfaceRadius}px`); root.style.setProperty("--feed-media-fit", settings.mediaFit); }
async function loadSiteSettingsFromSupabase() { const { data, error } = await state.supabase.from("site_settings").select("*").eq("id", "global").maybeSingle(); if (error) throw error; return data ? normalizeSiteSettings(data) : { ...window.DEFAULT_SITE_SETTINGS }; }

function handleAdminSettingsInput() { state.siteSettings = { shellWidth: clampNumber(elements.layoutWidthInput.value, 960, 1440, 1200), sectionGap: clampNumber(elements.layoutGapInput.value, 16, 40, 24), surfaceRadius: clampNumber(elements.layoutRadiusInput.value, 22, 44, 32), mediaFit: elements.mediaFitSelect.value === "contain" ? "contain" : "cover" }; applySiteSettings(state.siteSettings); updateAdminSettingsValues(); }
function handleAdminSettingsReset() { state.siteSettings = { ...window.DEFAULT_SITE_SETTINGS }; applySiteSettings(state.siteSettings); renderAdminEditor(); elements.adminSettingsFeedback.textContent = "Defaults restored locally."; }
async function handleAdminSettingsSubmit(event) { event.preventDefault(); if (!isCurrentUserAdmin()) { elements.adminSettingsFeedback.textContent = "Admin only."; return; } const { error } = await state.supabase.from("site_settings").upsert(getSiteSettingsPayload()); if (error) { elements.adminSettingsFeedback.textContent = "Save failed."; return; } elements.adminSettingsFeedback.textContent = "Settings saved."; }
function updateAdminSettingsValues() { elements.layoutWidthValue.textContent = `${state.siteSettings.shellWidth}px`; elements.layoutGapValue.textContent = `${state.siteSettings.sectionGap}px`; elements.layoutRadiusValue.textContent = `${state.siteSettings.surfaceRadius}px`; }

function renderAdminEditor() { const showAdminEditor = state.backendMode === "supabase" && isCurrentUserActivated() && isCurrentUserAdmin(); elements.adminEditor.hidden = !showAdminEditor; if (!showAdminEditor) return; elements.layoutWidthInput.value = String(state.siteSettings.shellWidth); elements.layoutGapInput.value = String(state.siteSettings.sectionGap); elements.layoutRadiusInput.value = String(state.siteSettings.surfaceRadius); elements.mediaFitSelect.value = state.siteSettings.mediaFit; updateAdminSettingsValues(); }

function renderTagCloud() {
  const posts = getVisiblePosts(); const tagCounts = new Map(); posts.forEach((post) => { (post.tags || []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)); });
  const tags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8); elements.tagCloud.innerHTML = "";
  tags.forEach(([tag, count]) => { const button = document.createElement("button"); button.className = "tag-chip"; button.textContent = `#${tag} ${count}`; if (state.search === tag.toLowerCase()) button.classList.add("is-active"); button.addEventListener("click", () => { state.search = tag.toLowerCase(); elements.searchInput.value = tag; getCore().render(); }); elements.tagCloud.appendChild(button); });
}

function renderOverview() { const posts = getVisiblePosts(); renderSpotlight(posts); renderCreatorBoard(posts); }
function renderFeed() { elements.feedGrid.innerHTML = ""; const posts = getVisiblePosts(); const pagePosts = getCurrentFeedPagePosts(posts); pagePosts.forEach((post) => elements.feedGrid.appendChild(createFeedCard(post))); elements.emptyState.hidden = posts.length !== 0; renderFeedPagination(posts); }

function createFeedCard(post) {
  const fragment = elements.feedCardTemplate.content.cloneNode(true);
  const mediaContainer = fragment.querySelector(".card-media");
  const kind = fragment.querySelector(".card-kind");
  const signal = fragment.querySelector(".card-signal");
  const title = fragment.querySelector(".card-title");
  const caption = fragment.querySelector(".card-caption");
  const creator = fragment.querySelector(".card-creator");
  const time = fragment.querySelector(".card-time");
  const tags = fragment.querySelector(".card-tags");
  const openButton = fragment.querySelector(".open-button");
  const saveButton = fragment.querySelector(".save-button");
  const likeButton = fragment.querySelector(".like-button");
  const deleteButton = fragment.querySelector(".delete-button") || document.createElement("button");
  
  kind.textContent = formatKind(post.mediaKind);
  signal.textContent = getSignalLabel(post);
  title.textContent = post.title;
  caption.textContent = post.caption;
  const creatorSummary = getProfileSummaryForPost(post);
  creator.textContent = creatorSummary?.displayName ?? post.creator;
  time.textContent = formatTimestamp(post.createdAt);
  
  const isLiked = state.likedPosts.includes(post.id);
  likeButton.textContent = `${getLikeCount(post)} likes`;
  likeButton.setAttribute("aria-pressed", String(isLiked));
  if (isLiked) likeButton.classList.add("is-liked");
  
  const isSaved = isPostSaved(post.id);
  saveButton.textContent = isSaved ? "Saved" : "Save";
  saveButton.classList.toggle("is-saved", isSaved);
  
  openButton.textContent = isPlayablePost(post) ? "Play" : "Open";
  
  creator.addEventListener("click", (e) => openProfileByKey(creatorSummary?.key, e.currentTarget));
  openButton.addEventListener("click", (e) => isPlayablePost(post) ? openMiniPlayer(post.id, e.currentTarget) : openViewer(post.id, e.currentTarget));
  saveButton.addEventListener("click", () => toggleSave(post.id));
  likeButton.addEventListener("click", () => void toggleLike(post.id));
  
  if (canDeletePost(post)) {
    deleteButton.hidden = false;
    deleteButton.addEventListener("click", () => deletePost(post.id));
  }
  
  (post.tags || []).forEach(t => { const p = document.createElement("span"); p.className = "tag-pill"; p.textContent = `#${t}`; tags.appendChild(p); });
  renderCardMedia(mediaContainer, post);
  return fragment;
}

function getAllPosts() { if (state.backendMode === "local" && state.userPosts.length === 0) return [...window.DEMO_POSTS]; return [...state.userPosts]; }
function renderFeed() {
  elements.feedGrid.innerHTML = "";
  const posts = getVisiblePosts();
  const pagePosts = getCurrentFeedPagePosts(posts);
  pagePosts.forEach((post) => elements.feedGrid.appendChild(createFeedCard(post)));
  elements.emptyState.hidden = posts.length !== 0;
  renderFeedPagination(posts);
}

function createFeedCard(post) {
  const fragment = elements.feedCardTemplate.content.cloneNode(true);
  const mediaContainer = fragment.querySelector(".card-media");
  const kind = fragment.querySelector(".card-kind");
  const signal = fragment.querySelector(".card-signal");
  const title = fragment.querySelector(".card-title");
  const caption = fragment.querySelector(".card-caption");
  const creator = fragment.querySelector(".card-creator");
  const time = fragment.querySelector(".card-time");
  const tags = fragment.querySelector(".card-tags");
  const openButton = fragment.querySelector(".open-button");
  const saveButton = fragment.querySelector(".save-button");
  const likeButton = fragment.querySelector(".like-button");
  const deleteButton = fragment.querySelector(".delete-button");
  const creatorSummary = getProfileSummaryForPost(post);

  kind.textContent = formatKind(post.mediaKind);
  signal.textContent = getSignalLabel(post);
  title.textContent = post.title;
  caption.textContent = post.caption;
  creator.textContent = creatorSummary?.displayName ?? post.creator;
  time.textContent = formatTimestamp(post.createdAt);
  likeButton.textContent = `${getLikeCount(post)} likes`;
  saveButton.textContent = isPostSaved(post.id) ? "Saved" : "Save";
  saveButton.setAttribute("aria-pressed", isPostSaved(post.id) ? "true" : "false");
  saveButton.classList.toggle("is-saved", isPostSaved(post.id));
  openButton.textContent = isPlayablePost(post) ? "Play" : "Open";

  const isLiked = state.likedPosts.includes(post.id);
  likeButton.setAttribute("aria-pressed", isLiked ? "true" : "false");
  if (isLiked) likeButton.classList.add("is-liked");

  if (creatorSummary) {
    creator.addEventListener("click", (event) => openProfileByKey(creatorSummary.key, event.currentTarget));
  }
  openButton.addEventListener("click", (event) => {
    if (isPlayablePost(post)) openMiniPlayer(post.id, event.currentTarget);
    else openViewer(post.id, event.currentTarget);
  });
  saveButton.addEventListener("click", () => toggleSave(post.id));
  likeButton.addEventListener("click", () => void toggleLike(post.id));

  if (isCurrentUserAdmin() || (state.currentUser && post.authorId === state.currentUser.id)) {
    deleteButton.hidden = false;
    deleteButton.addEventListener("click", () => deletePost(post.id));
  }

  (post.tags || []).forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.textContent = `#${tag}`;
    tags.appendChild(pill);
  });

  renderCardMedia(mediaContainer, post);
  return fragment;
}

function getVisiblePosts() { 
  const query = state.search; 
  const all = healPosts(getAllPosts());
  const posts = all.filter((post) => { 
    const matchesFilter = state.filter === "all" || state.filter === post.mediaKind || (state.filter === "saved" && isPostSaved(post.id)); 
    if (!matchesFilter) return false; 
    if (!query) return true; 
    const haystack = [post.title, post.caption, post.creator, (post.tags || []).join(" ")].join(" ").toLowerCase(); 
    return haystack.includes(query); 
  }); 
  return sortPosts(posts); 
}

function getFeedPageCount(totalPosts) { return Math.max(1, Math.ceil(totalPosts / window.FEED_POSTS_PER_PAGE)); }
function clampFeedPage(totalPosts) { state.feedPage = Math.min(Math.max(1, state.feedPage), getFeedPageCount(totalPosts)); }
function getCurrentFeedPagePosts(posts) {
  clampFeedPage(posts.length);
  const startIndex = (state.feedPage - 1) * window.FEED_POSTS_PER_PAGE;
  return posts.slice(startIndex, startIndex + window.FEED_POSTS_PER_PAGE);
}
function resetFeedPagination() { state.feedPage = 1; }

function renderFeedPagination(posts) {
  const totalPosts = posts.length;
  const pageCount = getFeedPageCount(totalPosts);
  const showPagination = totalPosts > window.FEED_POSTS_PER_PAGE;
  elements.feedPagination.hidden = !showPagination;
  elements.feedPagination.innerHTML = "";
  if (!showPagination) return;

  const startIndex = (state.feedPage - 1) * window.FEED_POSTS_PER_PAGE + 1;
  const endIndex = Math.min(totalPosts, state.feedPage * window.FEED_POSTS_PER_PAGE);
  const summary = document.createElement("p");
  summary.className = "feed-pagination-summary";
  summary.textContent = `Showing ${startIndex}-${endIndex} of ${totalPosts} posts`;

  const controls = document.createElement("div");
  controls.className = "feed-pagination-controls";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "feed-page-button";
  prevButton.textContent = "Previous";
  prevButton.disabled = state.feedPage === 1;
  prevButton.addEventListener("click", () => {
    if (state.feedPage > 1) {
      state.feedPage -= 1;
      renderFeed();
    }
  });

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "feed-page-button";
  nextButton.textContent = "Next";
  nextButton.disabled = state.feedPage === pageCount;
  nextButton.addEventListener("click", () => {
    if (state.feedPage < pageCount) {
      state.feedPage += 1;
      renderFeed();
    }
  });

  controls.appendChild(prevButton);
  for (let page = 1; page <= pageCount; page++) {
    const pageButton = document.createElement("button");
    pageButton.type = "button";
    pageButton.className = "feed-page-button";
    pageButton.textContent = String(page);
    if (page === state.feedPage) pageButton.classList.add("is-active");
    pageButton.addEventListener("click", () => {
      if (state.feedPage !== page) {
        state.feedPage = page;
        renderFeed();
      }
    });
    controls.appendChild(pageButton);
  }
  controls.appendChild(nextButton);
  elements.feedPagination.append(summary, controls);
}

function renderOverview() {
  const posts = getVisiblePosts();
  renderSpotlight(posts);
  renderCreatorBoard(posts);
}

function renderSpotlight(posts) {
  elements.spotlightCard.innerHTML = "";
  if (posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "spotlight-empty";
    empty.innerHTML = "<p class=\"eyebrow\">Spotlight</p><h3>No active spotlight</h3><p>Change the filter or publish a new post to refresh the board.</p>";
    elements.spotlightCard.appendChild(empty);
    return;
  }
  const post = getSpotlightPost(posts);
  const creatorSummary = getProfileSummaryForPost(post);
  const copy = document.createElement("div");
  copy.className = "spotlight-copy";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Spotlight";
  const title = document.createElement("h3");
  title.className = "spotlight-title";
  title.textContent = post.title;
  const caption = document.createElement("p");
  caption.className = "spotlight-caption";
  caption.textContent = post.caption;

  const meta = document.createElement("div");
  meta.className = "spotlight-meta";
  const creator = document.createElement("button");
  creator.type = "button";
  creator.className = "profile-trigger";
  creator.textContent = creatorSummary?.displayName ?? post.creator;
  if (creatorSummary) creator.addEventListener("click", (event) => openProfileByKey(creatorSummary.key, event.currentTarget));

  const info = document.createElement("span");
  info.textContent = `${formatKind(post.mediaKind)} / ${getLikeCount(post)} likes`;
  meta.append(creator, info);

  const actions = document.createElement("div");
  actions.className = "spotlight-actions";
  const openButton = document.createElement("button");
  openButton.className = "button button-primary";
  openButton.type = "button";
  openButton.textContent = isPlayablePost(post) ? "Open player" : "Open spotlight";
  openButton.addEventListener("click", (event) => {
    if (isPlayablePost(post)) openMiniPlayer(post.id, event.currentTarget);
    else openViewer(post.id, event.currentTarget);
  });

  const saveButton = document.createElement("button");
  saveButton.className = "button button-secondary";
  saveButton.type = "button";
  saveButton.textContent = isPostSaved(post.id) ? "Saved locally" : "Save post";
  saveButton.addEventListener("click", () => toggleSave(post.id));
  actions.append(openButton, saveButton);
  copy.append(eyebrow, title, caption, meta, actions);

  const media = document.createElement("div");
  media.className = "spotlight-media";
  renderSpotlightMedia(media, post);
  elements.spotlightCard.append(copy, media);
}

function getSpotlightPost(posts) {
  return posts.find(p => getLikeCount(p) > 5) || posts[0];
}

function renderCreatorBoard(posts) {
  elements.creatorBoard.innerHTML = "";
  const ranked = getProfileBoardEntries(posts).slice(0, 4);
  if (ranked.length === 0) {
    elements.creatorBoard.textContent = "No creators match the current feed.";
    return;
  }
  ranked.forEach((entry, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "board-row board-button";
    row.addEventListener("click", (event) => openProfileByKey(entry.summary.key, event.currentTarget));
    const rank = document.createElement("span");
    rank.className = "board-rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const details = document.createElement("div");
    details.className = "board-details";
    const creator = document.createElement("strong");
    creator.textContent = entry.summary.displayName;
    const meta = document.createElement("span");
    meta.textContent = `${entry.posts} post${entry.posts === 1 ? "" : "s"} / ${entry.likes} likes`;
    details.append(creator, meta);
    row.append(rank, details);
    elements.creatorBoard.appendChild(row);
  });
}

function renderTagCloud() {
  const posts = getVisiblePosts();
  const tagCounts = new Map();
  posts.forEach((post) => {
    (post.tags || []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1));
  });
  const tags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  elements.tagCloud.innerHTML = "";
  tags.forEach(([tag, count]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    button.dataset.tag = tag;
    button.textContent = `#${tag} ${count}`;
    if (state.search === tag.toLowerCase()) button.classList.add("is-active");
    elements.tagCloud.appendChild(button);
  });
}

function renderCardMedia(container, post) { appendMedia(container, post, { variant: "card" }); }
function renderSpotlightMedia(container, post) { appendMedia(container, post, { variant: "spotlight" }); }
function renderViewerMedia(container, post) { if (isPlayablePost(post)) mountPersistentPlayer(container, post, "viewer"); else appendMedia(container, post, { variant: "viewer" }); }
function renderMiniPlayerMedia(container, post) { mountPersistentPlayer(container, post, "mini"); }

function isPlayablePost(post) { return post?.mediaKind === "video" || post?.mediaKind === "audio" || post?.sourceKind === "youtube" || post?.sourceKind === "spotify"; }
function getActivePlayerMediaElement() { return state.activePlayerElement?.querySelector("video, audio") || (state.activePlayerElement instanceof HTMLMediaElement ? state.activePlayerElement : null); }
function getControllablePlayerPost() { return state.playerPostId ? getPostById(state.playerPostId) : null; }

function buildPersistentPlayerSource(post) {
  let source = post.embedUrl || post.src || "";
  if (post.sourceKind === "youtube" && source) {
    const url = new URL(source.startsWith("http") ? source : "https:" + source);
    url.searchParams.set("enablejsapi", "1"); url.searchParams.set("autoplay", "1");
    return url.toString();
  }
  return source;
}

function applyPlayerVolumeToActiveElement() {
  const media = getActivePlayerMediaElement(); if (media) { media.volume = state.playerVolume; media.muted = state.playerVolume === 0; return; }
  const post = getControllablePlayerPost();
  if (post?.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) {
    const vol = Math.round(state.playerVolume * 100);
    state.activePlayerElement.contentWindow.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [vol] }), "*");
  }
}

function mountPersistentPlayer(container, post, variant) {
  if (state.activePlayerPostId !== post.id) { destroyActivePlayer(); state.activePlayerElement = createPersistentPlayer(post); state.activePlayerPostId = post.id; }
  applyPersistentPlayerVariant(post, variant); applyPlayerVolumeToActiveElement();
  if (container.firstChild !== state.activePlayerElement) container.replaceChildren(state.activePlayerElement);
}

function createPersistentPlayer(post) {
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") {
    const f = document.createElement("iframe"); f.src = buildPersistentPlayerSource(post); f.allow = "autoplay; encrypted-media; fullscreen"; return f;
  }
  const media = document.createElement(post.mediaKind === "video" ? "video" : "audio");
  media.controls = true; media.src = post.src || (post.blob ? URL.createObjectURL(post.blob) : "");
  return media;
}

function applyPersistentPlayerVariant(post, variant) {
  if (!state.activePlayerElement) return;
  state.activePlayerElement.className = variant === "viewer" ? "viewer-media" : "mini-player-media";
}

function appendMedia(container, post, options = {}) {
  const { variant = "card", sourceResolver = resolvePostSource } = options; 
  const source = sourceResolver(post);
  if (post.sourceKind === "youtube" || post.sourceKind === "spotify") { renderExternalMedia(container, post, variant); return; }
  if (post.mediaKind === "image") { 
    const image = document.createElement("img"); 
    image.loading = variant === "viewer" ? "eager" : "lazy"; 
    image.alt = post.title; 
    image.src = source; 
    image.className = variant === "viewer" ? "viewer-media" : (variant === "mini" ? "mini-player-media" : ""); 
    container.appendChild(image); 
    return; 
  }
  if (post.mediaKind === "video") { 
    const video = document.createElement("video"); 
    video.controls = true; 
    video.preload = "metadata"; 
    video.src = source; 
    if (variant === "viewer") video.className = "viewer-media"; 
    if (variant === "mini") video.className = "mini-player-media"; 
    container.appendChild(video); 
    return; 
  }
  const audioStage = document.createElement("div"); 
  audioStage.className = variant === "viewer" ? "audio-stage audio-stage-viewer" : (variant === "mini" ? "audio-stage audio-stage-mini" : "audio-stage"); 
  const label = document.createElement("span"); 
  label.textContent = variant === "spotlight" ? "Audio spotlight" : "Audio drop"; 
  const title = document.createElement("strong"); 
  title.textContent = post.title; 
  audioStage.append(label, title); 
  container.appendChild(audioStage);
  if (source) { 
    const audio = document.createElement("audio"); 
    audio.controls = true; 
    audio.preload = "metadata"; 
    audio.src = source; 
    if (variant === "viewer") audio.className = "viewer-audio"; 
    if (variant === "mini") audio.className = "mini-player-audio"; 
    container.appendChild(audio); 
  }
}

function renderExternalMedia(container, post, variant) {
  if (variant === "viewer") { 
    const frame = document.createElement("iframe"); 
    frame.className = post.sourceKind === "youtube" ? "viewer-embed viewer-youtube" : "viewer-embed viewer-spotify"; 
    frame.src = buildPersistentPlayerSource(post); 
    frame.title = `${post.title} player`; 
    frame.loading = "lazy"; 
    frame.width = "100%"; 
    frame.height = post.sourceKind === "youtube" ? "100%" : "440"; 
    frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; 
    frame.referrerPolicy = "strict-origin-when-cross-origin"; 
    frame.setAttribute("allowfullscreen", ""); 
    container.appendChild(frame); 
    return; 
  }
  if (variant === "mini") { 
    const frame = document.createElement("iframe"); 
    frame.className = post.sourceKind === "youtube" ? "mini-player-embed mini-youtube" : "mini-player-embed mini-spotify"; 
    frame.src = buildPersistentPlayerSource(post); 
    frame.title = `${post.title} player`; 
    frame.loading = "lazy"; 
    frame.width = "100%"; 
    frame.height = post.sourceKind === "youtube" ? "192" : "152"; 
    frame.allow = post.sourceKind === "youtube" ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" : "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; 
    frame.referrerPolicy = "strict-origin-when-cross-origin"; 
    frame.setAttribute("allowfullscreen", ""); 
    container.appendChild(frame); 
    return; 
  }
  container.appendChild(createExternalPreviewStage({ 
    provider: post.sourceKind, 
    title: post.title, 
    creator: post.creator, 
    externalId: post.externalId ?? "", 
    externalUrl: post.externalUrl ?? "", 
    embedUrl: post.embedUrl ?? "", 
    label: post.label ?? "" 
  }, { 
    variant, 
    note: post.sourceKind === "youtube" ? "Video preview opens in the docked player." : "Music preview opens in the docked player." 
  }));
}

function createExternalPreviewStage(source, options = {}) {
  const { variant = "card", note = "" } = options; 
  const stage = document.createElement("div"); 
  stage.className = `external-preview-card external-preview-card-${variant} external-preview-card-${source.provider}`;
  
  const image = document.createElement("img"); 
  image.className = "external-preview-image"; 
  image.alt = `${source.title} preview`; 
  image.loading = variant === "spotlight" ? "eager" : "lazy"; 
  image.referrerPolicy = "strict-origin-when-cross-origin";
  
  const overlay = document.createElement("div"); 
  overlay.className = "external-preview-overlay"; 
  const badge = document.createElement("span"); 
  badge.className = "external-preview-badge"; 
  badge.textContent = formatProviderName(source.provider); 
  const title = document.createElement("strong"); 
  title.className = "external-preview-title"; 
  title.textContent = source.title; 
  const description = document.createElement("p"); 
  description.className = "external-preview-copy"; 
  description.textContent = note || source.creator || "External media preview";
  
  overlay.append(badge, title, description); 
  stage.append(image, overlay);
  
  if (source.provider === "youtube") { 
    void applyExternalPreviewMetadata(stage, image, title, badge, source); 
    loadPreviewImageCandidates(stage, image, resolveYouTubePreviewCandidates(source)); 
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

function loadPreviewImageCandidates(stage, image, candidates) {
  const urls = candidates.filter(Boolean); if (!urls.length) return;
  let index = 0; const tryNext = () => { if (index >= urls.length) { image.removeAttribute("src"); return; } const nextUrl = urls[index]; index += 1; image.onload = () => { stage.classList.add("has-image"); image.onload = null; image.onerror = null; }; image.onerror = () => { stage.classList.remove("has-image"); tryNext(); }; image.src = nextUrl; };
  tryNext();
}

async function getExternalPreviewMetadata(source) { 
  if (source.provider === "spotify") return getSpotifyPreviewMetadata(source); 
  if (source.provider === "youtube") return getYouTubePreviewMetadata(source); 
  return null; 
}

async function getSpotifyPreviewMetadata(source) {
  const sourceUrl = resolveSpotifyPreviewSourceUrl(source); if (!sourceUrl) return null;
  const cacheKey = `spotify:preview:v10:${sourceUrl}`; 
  const cached = window.externalPreviewCache.get(cacheKey); 
  if (cached && !(cached instanceof Promise)) return cached; 
  if (cached instanceof Promise) return cached;
  
  const request = Promise.all([fetchSpotifyPreviewCatalogMetadata(source, sourceUrl), fetchSpotifyPreviewOEmbedMetadata(sourceUrl)]).then(([cat, oem]) => { 
    const fallbackCreator = deriveSpotifyCreatorFromSourceTitle(source, cat?.title || oem?.title || "");
    const metadata = {
      title: cat?.title || oem?.title || "",
      creator: cat?.creator || oem?.creator || fallbackCreator || "",
      thumbnailUrl: cat?.thumbnailUrl || oem?.thumbnailUrl || "",
      error: cat?.error && !oem?.title ? cat.error : null
    }; 
    const hasMetadata = Boolean(metadata.title || metadata.creator || metadata.thumbnailUrl); 
    return hasMetadata ? metadata : (metadata.error ? metadata : null); 
  }).then(result => {
    window.externalPreviewCache.set(cacheKey, result);
    return result;
  }).catch(() => { 
    window.externalPreviewCache.set(cacheKey, null); 
    return null; 
  });
  window.externalPreviewCache.set(cacheKey, request); return request;
}

async function fetchSpotifyPreviewCatalogMetadata(source, sourceUrl) { 
  if (!state.supabase || state.backendMode !== "supabase" || !state.currentUser) return { error: "Not Signed In" }; 
  const functionName = window.getSpotifyPreviewFunctionName ? window.getSpotifyPreviewFunctionName() : "spotify-preview-metadata"; 
  try { 
    const { data, error } = await state.supabase.functions.invoke(functionName, { body: { url: sourceUrl, market: getSpotifyPreviewMarket() } }); 
    if (error) return { error: error.message || "API Error" };
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

function getSpotifyPreviewMarket() { const locale = (Array.isArray(navigator.languages) && navigator.languages[0]) || navigator.language || ""; const match = `${locale}`.trim().match(/[-_]([A-Za-z]{2})$/); return match ? match[1].toUpperCase() : "US"; }

function resolveYouTubePreviewCandidates(source) {
  const externalId = source.externalId || parseYouTubeUrl(source.externalUrl || source.embedUrl || "")?.externalId || "";
  if (!externalId) return [];
  return [
    `https://i.ytimg.com/vi/${externalId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${externalId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${externalId}/0.jpg`
  ];
}

async function getYouTubePreviewMetadata(source) {
  const sourceUrl = resolveYouTubePreviewSourceUrl(source); if (!sourceUrl) return null;
  const cacheKey = `youtube:oembed:${sourceUrl}`; 
  const cached = window.externalPreviewCache.get(cacheKey); 
  if (cached && !(cached instanceof Promise)) return cached; 
  if (cached instanceof Promise) return cached;
  const request = fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`).then((res) => (res.ok ? res.json() : null)).then((payload) => {
    if (!payload || (!payload.title && !payload.thumbnail_url)) return null;
    const metadata = {
      title: typeof payload.title === "string" ? payload.title.trim() : "",
      creator: typeof payload.author_name === "string" ? payload.author_name.trim() : "",
      thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url.trim() : ""
    };
    window.externalPreviewCache.set(cacheKey, metadata);
    return metadata;
  }).catch(() => {
    window.externalPreviewCache.set(cacheKey, null);
    return null;
  });
  window.externalPreviewCache.set(cacheKey, request); return request;
}

function resolveYouTubePreviewSourceUrl(source) {
  const externalId = source.externalId || parseYouTubeUrl(source.externalUrl || source.embedUrl || "")?.externalId || "";
  if (externalId) return `https://www.youtube.com/watch?v=${externalId}`;
  if (source.externalUrl) return source.externalUrl;
  return "";
}

function resolveSpotifyPreviewSourceUrl(source) { 
  if (source.externalUrl) return source.externalUrl; 
  if (source.embedUrl) { 
    try { 
      const embedUrl = new URL(source.embedUrl.startsWith("http") ? source.embedUrl : "https:" + source.embedUrl); 
      const segments = embedUrl.pathname.split("/").filter(Boolean); 
      const typeIndex = segments[0] === "embed" ? 1 : 0; 
      const type = segments[typeIndex]; 
      const externalId = segments[typeIndex + 1] || source.externalId || ""; 
      if (type && externalId) return `https://open.spotify.com/${type}/${externalId}`; 
    } catch { return ""; } 
  } 
  return ""; 
}

function resolvePostSource(post) { return post.src || (post.blob ? URL.createObjectURL(post.blob) : ""); }
function formatProviderName(p) { if (p === "youtube") return "YouTube"; if (p === "spotify") return "Spotify"; return p.charAt(0).toUpperCase() + p.slice(1); }

function destroyActivePlayer() {
  if (state.activePlayerElement) {
    const m = getActivePlayerMediaElement(); 
    if (m) { m.pause(); m.src = ""; }
    state.activePlayerElement.remove();
  }
  state.activePlayerElement = null; 
  state.activePlayerPostId = null;
}

function renderProfileView() {
  if (!state.activeProfileKey) { 
    elements.profileView.classList.remove("is-open"); 
    elements.profileView.setAttribute("aria-hidden", "true"); 
    syncOverlayBodyState(); 
    return; 
  }
  const profile = getProfileSummaryByKey(state.activeProfileKey); 
  if (!profile) { 
    state.activeProfileKey = ""; 
    elements.profileView.classList.remove("is-open"); 
    elements.profileView.setAttribute("aria-hidden", "true"); 
    syncOverlayBodyState(); 
    return; 
  }
  const posts = getPostsForProfileKey(profile.key); 
  const totalLikes = posts.reduce((sum, post) => sum + getLikeCount(post), 0); 
  const latestPost = posts[0] ?? null; 
  const isSelf = Boolean(profile.userId && profile.userId === state.currentUser?.id); 
  const metaParts = [];
  if (canRevealMemberEmails() && profile.email) metaParts.push(profile.email);
  metaParts.push(isSelf ? "Your live profile" : "Live member profile"); 
  if (profile.createdAt) metaParts.push(`Joined ${formatTimestamp(profile.createdAt)}`);
  
  elements.profileView.classList.add("is-open"); 
  elements.profileView.setAttribute("aria-hidden", "false"); 
  syncOverlayBodyState();
  elements.profileBadge.textContent = getProfileInitials(profile.displayName); 
  elements.profileTitle.textContent = profile.displayName; 
  elements.profileMeta.textContent = metaParts.join(" · ");
  elements.profileStats.innerHTML = "";
  
  [{ label: "Posts", value: String(posts.length) }, 
   { label: "Likes", value: String(totalLikes) }, 
   { label: latestPost ? "Latest" : "Status", value: latestPost ? formatTimestamp(latestPost.createdAt) : (isSelf ? "Ready to publish" : "No posts yet") }
  ].forEach((stat) => { 
    const card = document.createElement("div"); 
    card.className = "profile-stat"; 
    const value = document.createElement("strong"); 
    value.className = "profile-stat-value"; 
    value.textContent = stat.value; 
    const label = document.createElement("span"); 
    label.className = "profile-stat-label"; 
    label.textContent = stat.label; 
    card.append(value, label); 
    elements.profileStats.appendChild(card); 
  });
  
  elements.profileFeedGrid.innerHTML = "";
  const totalPosts = posts.length;
  const pageCount = Math.max(1, Math.ceil(totalPosts / window.FEED_POSTS_PER_PAGE));
  state.profileFeedPage = Math.min(Math.max(1, state.profileFeedPage), pageCount);
  const startIndex = (state.profileFeedPage - 1) * window.FEED_POSTS_PER_PAGE;
  const pagePosts = posts.slice(startIndex, startIndex + window.FEED_POSTS_PER_PAGE);
  pagePosts.forEach((post) => elements.profileFeedGrid.appendChild(createFeedCard(post)));
  
  elements.profileEmpty.hidden = totalPosts !== 0; 
  elements.profileEmpty.textContent = isSelf ? "Your profile is ready. Publish to the live feed to populate it." : `${profile.displayName} has not posted to the live feed yet.`;
  
  const showPagination = totalPosts > window.FEED_POSTS_PER_PAGE;
  if (elements.profileFeedPagination) {
    elements.profileFeedPagination.hidden = !showPagination;
    elements.profileFeedPagination.innerHTML = "";
    if (showPagination) {
      const startNum = startIndex + 1;
      const endNum = Math.min(totalPosts, state.profileFeedPage * window.FEED_POSTS_PER_PAGE);
      const summary = document.createElement("p"); 
      summary.className = "feed-pagination-summary"; 
      summary.textContent = `Showing ${startNum}-${endNum} of ${totalPosts} uploads`;
      
      const controls = document.createElement("div"); 
      controls.className = "feed-pagination-controls";
      
      const prevBtn = document.createElement("button"); 
      prevBtn.type = "button"; 
      prevBtn.className = "feed-page-button"; 
      prevBtn.textContent = "Previous"; 
      prevBtn.disabled = state.profileFeedPage === 1;
      prevBtn.addEventListener("click", () => { 
        if (state.profileFeedPage > 1) { 
          state.profileFeedPage -= 1; 
          renderProfileView(); 
          elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); 
        } 
      });
      
      const nextBtn = document.createElement("button"); 
      nextBtn.type = "button"; 
      nextBtn.className = "feed-page-button"; 
      nextBtn.textContent = "Next"; 
      nextBtn.disabled = state.profileFeedPage === pageCount;
      nextBtn.addEventListener("click", () => { 
        if (state.profileFeedPage < pageCount) { 
          state.profileFeedPage += 1; 
          renderProfileView(); 
          elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); 
        } 
      });
      
      controls.appendChild(prevBtn);
      for (let page = 1; page <= pageCount; page++) {
        const pageBtn = document.createElement("button"); 
        pageBtn.type = "button"; 
        pageBtn.className = "feed-page-button"; 
        pageBtn.textContent = String(page);
        pageBtn.setAttribute("aria-label", `Go to page ${page}`); 
        pageBtn.setAttribute("aria-pressed", page === state.profileFeedPage ? "true" : "false");
        if (page === state.profileFeedPage) pageBtn.classList.add("is-active");
        pageBtn.addEventListener("click", () => { 
          if (state.profileFeedPage !== page) { 
            state.profileFeedPage = page; 
            renderProfileView(); 
            elements.profileView.querySelector(".profile-view-dialog")?.scrollTo({ top: 0, behavior: "smooth" }); 
          } 
        });
        controls.appendChild(pageBtn);
      }
      controls.appendChild(nextBtn); 
      elements.profileFeedPagination.append(summary, controls);
    }
  }
}

function getProfileInitials(name) { 
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean); 
  if (parts.length === 0) return "SS"; 
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase(); 
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join(""); 
}

function openOwnProfile(event) { 
  const profileKey = getOwnProfileKey(); 
  if (profileKey) openProfileByKey(profileKey, event?.currentTarget ?? elements.openOwnProfileButton); 
}

function openProfileByKey(profileKey, returnFocusElement) { 
  const profile = getProfileSummaryByKey(profileKey); 
  if (!profile) return; 
  if (state.viewerPostId || state.viewerAttachment) closeViewer({ restoreFocus: false }); 
  state.activeProfileKey = profile.key; 
  state.profileReturnFocusElement = returnFocusElement ?? document.activeElement; 
  state.profileFeedPage = 1; 
  renderProfileView(); 
  elements.profileCloseButton.focus(); 
}

function closeProfile(options = {}) { 
  const { restoreFocus = true } = options; 
  if (!state.activeProfileKey) return; 
  state.activeProfileKey = ""; 
  elements.profileView.classList.remove("is-open"); 
  elements.profileView.setAttribute("aria-hidden", "true"); 
  syncOverlayBodyState(); 
  if (restoreFocus && state.profileReturnFocusElement instanceof HTMLElement) state.profileReturnFocusElement.focus(); 
  state.profileReturnFocusElement = null; 
}

function renderMiniPlayer() {
  const post = getPostById(state.playerPostId);
  elements.miniPlayer.classList.toggle("is-open", !!post);
  if (!post) return;
  elements.miniPlayerTitle.textContent = post.title;
  renderMiniPlayerMedia(elements.miniPlayerStage, post);
  applyMiniPlayerPosition();
}

function renderViewer() {
  if (!state.viewerPostId && !state.viewerAttachment) { 
    elements.viewer.classList.remove("is-open"); 
    elements.viewer.setAttribute("aria-hidden", "true"); 
    clearViewerMedia(); 
    syncOverlayBodyState(); 
    return; 
  }
  if (state.viewerAttachment) {
    const attachment = state.viewerAttachment; 
    clearViewerMedia(); 
    elements.viewer.classList.add("is-open"); 
    elements.viewer.setAttribute("aria-hidden", "false"); 
    syncOverlayBodyState();
    renderViewerAttachmentMedia(elements.viewerStage, attachment); 
    elements.viewerKind.textContent = `${attachment.kind === "video" ? "Video" : "Image"} / Direct message`; 
    elements.viewerTitle.textContent = attachment.title; 
    elements.viewerCaption.textContent = attachment.caption; 
    elements.viewerCreator.textContent = attachment.creator; 
    elements.viewerCreator.onclick = null; 
    elements.viewerCreator.tabIndex = -1; 
    elements.viewerCreator.setAttribute("aria-disabled", "true"); 
    elements.viewerTime.textContent = window.formatMessageTimestamp ? window.formatMessageTimestamp(attachment.createdAt) : formatTimestamp(attachment.createdAt); 
    elements.viewerCollapseButton.hidden = true; 
    elements.viewerTags.innerHTML = ""; 
    elements.viewerPrevButton.disabled = true; 
    elements.viewerNextButton.disabled = true; 
    return;
  }
  const post = getPostById(state.viewerPostId); 
  if (!post) { closeViewer(); return; }
  const creatorSummary = getProfileSummaryForPost(post); 
  clearViewerMedia(); 
  elements.viewer.classList.add("is-open"); 
  elements.viewer.setAttribute("aria-hidden", "false"); 
  syncOverlayBodyState();
  renderViewerMedia(elements.viewerStage, post); 
  elements.viewerKind.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`; 
  elements.viewerTitle.textContent = post.title; 
  elements.viewerCaption.textContent = post.caption; 
  elements.viewerCreator.textContent = creatorSummary?.displayName ?? post.creator; 
  elements.viewerCreator.tabIndex = creatorSummary ? 0 : -1; 
  elements.viewerCreator.setAttribute("aria-disabled", creatorSummary ? "false" : "true"); 
  elements.viewerCreator.onclick = creatorSummary ? (event) => openProfileByKey(creatorSummary.key, event.currentTarget) : null; 
  elements.viewerTime.textContent = formatTimestamp(post.createdAt); 
  elements.viewerCollapseButton.hidden = !isPlayablePost(post);
  elements.viewerTags.innerHTML = ""; 
  (post.tags || []).forEach((tag) => { 
    const pill = document.createElement("span"); 
    pill.className = "tag-pill"; 
    pill.textContent = `#${tag}`; 
    elements.viewerTags.appendChild(pill); 
  });
  const canStep = state.visiblePostIds.length > 1; 
  elements.viewerPrevButton.disabled = !canStep; 
  elements.viewerNextButton.disabled = !canStep;
}

function renderMiniPlayer() {
  if (!state.playerPostId) { 
    state.playerDrag = null; 
    elements.miniPlayer.classList.remove("is-open"); 
    elements.miniPlayer.classList.remove("is-expanded"); 
    elements.miniPlayer.classList.remove("is-dragging"); 
    elements.miniPlayer.setAttribute("aria-hidden", "true"); 
    elements.miniPlayerVolume.hidden = true; 
    clearMiniPlayerMedia(); 
    return; 
  }
  const post = getPostById(state.playerPostId); 
  if (!post || !isPlayablePost(post)) { closeMiniPlayer(); return; }
  const creatorSummary = getProfileSummaryForPost(post);
  elements.miniPlayer.classList.add("is-open"); 
  elements.miniPlayer.classList.toggle("is-expanded", state.miniPlayerExpanded); 
  elements.miniPlayer.setAttribute("aria-hidden", "false");
  elements.miniPlayerKind.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`; 
  elements.miniPlayerTitle.textContent = post.title; 
  elements.miniPlayerCaption.textContent = post.caption; 
  elements.miniPlayerCreator.textContent = creatorSummary?.displayName ?? post.creator; 
  elements.miniPlayerCreator.onclick = creatorSummary ? (event) => openProfileByKey(creatorSummary.key, event.currentTarget) : null; 
  elements.miniPlayerTime.textContent = formatTimestamp(post.createdAt); 
  elements.miniExpandButton.textContent = state.miniPlayerExpanded ? "Collapse" : "Expand";
  elements.miniPlayerTags.innerHTML = ""; 
  (post.tags || []).forEach((tag) => { 
    const pill = document.createElement("span"); 
    pill.className = "tag-pill"; 
    pill.textContent = `#${tag}`; 
    elements.miniPlayerTags.appendChild(pill); 
  });
  const playableIds = getPlayableVisiblePostIds(); 
  const canStep = playableIds.length > 1; 
  elements.miniPrevButton.disabled = !canStep; 
  elements.miniNextButton.disabled = !canStep;
  renderMiniPlayerMedia(elements.miniPlayerStage, post); 
  renderMiniPlayerVolumeControl(); 
  applyMiniPlayerPosition();
  window.requestAnimationFrame(() => { if (state.playerPostId === post.id) applyMiniPlayerPosition(); });
}

function clearViewerMedia() { elements.viewerStage.innerHTML = ""; }
function clearMiniPlayerMedia() { elements.miniPlayerStage.innerHTML = ""; }

function openViewer(postId, returnFocusElement) { 
  if (state.activeProfileKey) closeProfile({ restoreFocus: false }); 
  if (isPlayablePost(getPostById(postId))) { 
    state.playerPostId = postId; 
    state.miniPlayerExpanded = true; 
    state.returnFocusElement = returnFocusElement ?? document.activeElement; 
    renderMiniPlayer(); 
    elements.miniExpandButton.focus(); 
    return; 
  } 
  state.viewerAttachment = null; 
  state.viewerPostId = postId; 
  state.returnFocusElement = returnFocusElement ?? document.activeElement; 
  renderViewer(); 
  elements.viewerCloseButton.focus(); 
}

function closeViewer(options = {}) { 
  const { restoreFocus = true } = options; 
  if (!state.viewerPostId && !state.viewerAttachment) return; 
  state.viewerPostId = null; 
  state.viewerAttachment = null; 
  elements.viewer.classList.remove("is-open"); 
  elements.viewer.setAttribute("aria-hidden", "true"); 
  clearViewerMedia(); 
  syncOverlayBodyState(); 
  if (restoreFocus && state.returnFocusElement instanceof HTMLElement) state.returnFocusElement.focus(); 
  state.returnFocusElement = null; 
  renderMiniPlayer(); 
}

function stepViewer(delta) {
  if (state.visiblePostIds.length <= 1 || !state.viewerPostId) return;
  const currentIndex = state.visiblePostIds.indexOf(state.viewerPostId); 
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + state.visiblePostIds.length) % state.visiblePostIds.length;
  const nextPostId = state.visiblePostIds[nextIndex]; 
  if (isPlayablePost(getPostById(nextPostId))) { 
    state.viewerPostId = null; 
    state.playerPostId = nextPostId; 
    state.miniPlayerExpanded = true; 
    elements.viewer.classList.remove("is-open"); 
    elements.viewer.setAttribute("aria-hidden", "true"); 
    clearViewerMedia(); 
    syncOverlayBodyState(); 
    renderMiniPlayer(); 
    return; 
  }
  state.viewerPostId = nextPostId; 
  renderViewer();
}

function openMiniPlayer(postId, returnFocusElement) { 
  const post = getPostById(postId); 
  if (!post) return; 
  if (state.activeProfileKey) closeProfile({ restoreFocus: false }); 
  if (!isPlayablePost(post)) { openViewer(postId, returnFocusElement); return; } 
  state.playerPostId = postId; 
  state.miniPlayerExpanded = false; 
  state.returnFocusElement = returnFocusElement ?? document.activeElement; 
  renderMiniPlayer(); 
}

function expandMiniPlayer() { if (state.playerPostId) { state.miniPlayerExpanded = !state.miniPlayerExpanded; renderMiniPlayer(); } }

function collapseViewerToPlayer() { 
  if (!state.viewerPostId) return; 
  state.playerPostId = state.viewerPostId; 
  state.miniPlayerExpanded = false; 
  state.viewerPostId = null; 
  elements.viewer.classList.remove("is-open"); 
  elements.viewer.setAttribute("aria-hidden", "true"); 
  clearViewerMedia(); 
  syncOverlayBodyState(); 
  renderMiniPlayer(); 
}

function closeMiniPlayer() { 
  state.playerPostId = null; 
  state.miniPlayerExpanded = false; 
  state.playerDrag = null; 
  elements.miniPlayer.classList.remove("is-open"); 
  elements.miniPlayer.classList.remove("is-expanded"); 
  elements.miniPlayer.classList.remove("is-dragging"); 
  elements.miniPlayer.setAttribute("aria-hidden", "true"); 
  elements.miniPlayerVolume.hidden = true; 
  clearMiniPlayerMedia(); 
  destroyActivePlayer(); 
}

function handleMiniPlayerStageClick(event) { if (!event.target.closest("iframe, video, audio") && !state.miniPlayerExpanded) expandMiniPlayer(); }

function handleMiniPlayerVolumeInput(event) { 
  state.playerVolume = Number(event.target.value) / 100; 
  savePlayerVolume(state.playerVolume); 
  applyPlayerVolumeToActiveElement(); 
  renderMiniPlayerVolumeControl(); 
}

function renderMiniPlayerVolumeControl() {
  const post = getPostById(state.playerPostId); 
  const mediaElement = getActivePlayerMediaElement(); 
  const hasNativeVolumeControl = mediaElement instanceof HTMLMediaElement; 
  const supportsCustomVolume = hasNativeVolumeControl || post?.sourceKind === "youtube";
  elements.miniPlayerVolume.hidden = !supportsCustomVolume; 
  elements.miniPlayerVolumeSlider.disabled = !supportsCustomVolume; 
  elements.miniPlayerVolumeSlider.title = supportsCustomVolume ? "Adjust volume" : "";
  const volumePercent = Math.round(state.playerVolume * 100);
  elements.miniPlayerVolumeSlider.value = `${volumePercent}`; 
  elements.miniPlayerVolumeValue.textContent = `${volumePercent}%`;
}

function getPlayableVisiblePostIds() { return state.visiblePostIds.filter((id) => isPlayablePost(getPostById(id))); }

function stepMiniPlayer(delta) { 
  const playableIds = getPlayableVisiblePostIds(); 
  if (playableIds.length <= 1 || !state.playerPostId) return; 
  const currentIndex = playableIds.indexOf(state.playerPostId); 
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + playableIds.length) % playableIds.length; 
  state.playerPostId = playableIds[nextIndex]; 
  renderMiniPlayer(); 
}

function applyMiniPlayerPosition() {
  if (!state.playerPosition) { 
    elements.miniPlayer.style.left = ""; 
    elements.miniPlayer.style.top = ""; 
    elements.miniPlayer.style.right = ""; 
    elements.miniPlayer.style.bottom = ""; 
    return; 
  }
  const nextPosition = clampPlayerPosition(state.playerPosition); 
  state.playerPosition = nextPosition; 
  savePlayerPosition(nextPosition);
  elements.miniPlayer.style.left = `${nextPosition.x}px`; 
  elements.miniPlayer.style.top = `${nextPosition.y}px`; 
  elements.miniPlayer.style.right = "auto"; 
  elements.miniPlayer.style.bottom = "auto";
}

function clampPlayerPosition(position) { 
  if (!position) return null; 
  const padding = window.innerWidth <= 760 ? 12 : 20; 
  const width = elements.miniPlayer.offsetWidth || 300; 
  const height = elements.miniPlayer.offsetHeight || 280; 
  const maxX = Math.max(padding, window.innerWidth - width - padding); 
  const maxY = Math.max(padding, window.innerHeight - height - padding); 
  return { 
    x: Math.min(maxX, Math.max(padding, Math.round(position.x))), 
    y: Math.min(maxY, Math.max(padding, Math.round(position.y))) 
  }; 
}

function beginMiniPlayerDrag(event) {
  const target = event.target instanceof Element ? event.target : null; 
  if (!state.playerPostId || target?.closest("button")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const rect = elements.miniPlayer.getBoundingClientRect(); 
  const defaultPosition = { x: rect.left, y: rect.top };
  state.playerPosition = clampPlayerPosition(state.playerPosition ?? defaultPosition);
  state.playerDrag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  elements.miniPlayer.classList.add("is-dragging"); 
  applyMiniPlayerPosition();
  if (typeof elements.miniPlayerHead.setPointerCapture === "function") { 
    try { elements.miniPlayerHead.setPointerCapture(event.pointerId); } catch {} 
  }
  event.preventDefault();
}

function handleMiniPlayerDrag(event) { 
  if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; 
  state.playerPosition = clampPlayerPosition({ 
    x: event.clientX - state.playerDrag.offsetX, 
    y: event.clientY - state.playerDrag.offsetY 
  }); 
  applyMiniPlayerPosition(); 
}

function endMiniPlayerDrag(event) { 
  if (!state.playerDrag || event.pointerId !== state.playerDrag.pointerId) return; 
  if (typeof elements.miniPlayerHead.releasePointerCapture === "function") { 
    try { elements.miniPlayerHead.releasePointerCapture(event.pointerId); } catch {} 
  } 
  state.playerDrag = null; 
  elements.miniPlayer.classList.remove("is-dragging"); 
  savePlayerPosition(state.playerPosition); 
}

async function deletePost(id) {
  const post = getPostById(id); if (!post) return;
  if (confirm("Delete this post?")) {
    if (state.backendMode === "supabase" && !post.isLocal) await deleteHostedPost(post);
    state.userPosts = state.userPosts.filter(p => p.id !== id);
    getCore().render();
  }
}

async function toggleLike(id) {
  const post = getPostById(id); if (!post) return;
  const liked = state.likedPosts.includes(id);
  if (liked) state.likedPosts = state.likedPosts.filter(i => i !== id);
  else state.likedPosts.push(id);
  persistScopedPostIds(window.LIKED_POSTS_KEY, state.likedPosts);
  getCore().render();
}

function toggleSave(id) {
  const saved = state.savedPosts.includes(id);
  if (saved) state.savedPosts = state.savedPosts.filter(i => i !== id);
  else state.savedPosts.push(id);
  localStorage.setItem(window.SAVED_POSTS_KEY, JSON.stringify(state.savedPosts));
  getCore().render();
}

function sortPosts(posts) { return posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); }
function getPostById(id) { return getAllPosts().find(p => p.id === id); }
function isPostSaved(id) { return state.savedPosts.includes(id); }
function getLikeCount(post) { return (post.likes || 0) + (state.likedPosts.includes(post.id) ? 1 : 0); }
function formatKind(k) { return k.charAt(0).toUpperCase() + k.slice(1); }
function getSignalLabel(p) { return getLikeCount(p) > 10 ? "High Signal" : "Live"; }
function formatTimestamp(iso) { return new Date(iso).toLocaleDateString(); }

function healPosts(posts) { return posts.map(p => { if (p.sourceKind === "youtube" && !p.embedUrl) { const parsed = parseYouTubeUrl(p.externalUrl || p.src); if (parsed) return { ...p, ...parsed }; } return p; }); }

function updateSourceHelp(kind) {
  const msgs = { youtube: "YouTube link active", spotify: "Spotify link active", upload: "File ready", none: "Ready to post" };
  elements.sourceHelp.textContent = msgs[kind] || msgs.none;
}

// Attach everything to window so app-v3.js can find them
Object.assign(window, {
  clearMessengerState,
  renderMessenger,
  refreshMessengerState,
  mergeActiveMessage,
  refreshCurrentUserBanState,
  closeMessengerDock,
  handleMessengerLauncherClick,
  handleMessagesNavClick,
  handleMessengerMinimizeClick,
  toggleMessengerExpansion,
  closeAdminBanPanel,
  handleAdminBanLauncherClick,
  renderAdminBanPanel,
  renderAdminEditor,
  handleAdminSettingsInput,
  handleAdminSettingsReset,
  handleAdminSettingsSubmit,
  loadUserPreferences,
  normalizeUserPreferences,
  saveUserPreferences,
  applyUserPreferences,
  openSettingsPanel,
  closeSettingsPanel,
  toggleSettingsPanel,
  renderSettingsPanel,
  renderKeyboardShortcuts,
  updateUserPreferences,
  resetUserPreferences,
  openNotificationsPanel,
  closeNotificationsPanel,
  toggleNotificationsPanel,
  syncOverlayBodyState,
  setMobileHeaderHidden,
  syncMobileHeaderVisibility,
  handleWindowScroll,
  updateViewportMetrics,
  handleViewportResize,
  showFeedback,
  showAuthFeedback,
  setStatusPill,
  handleThemeOptionClick,
  handleDensityChange,
  handleMotionChange,
  handleStatusBarStripToggle,
  handleNotificationHideSenderToggle,
  handleNotificationHideBodyToggle,
  resetPlayerDockPosition,
  resetPlayerVolume,
  renderFeed,
  renderOverview,
  renderTagCloud,
  renderViewer,
  renderMiniPlayer,
  renderProfileView,
  openProfileByKey,
  closeProfile,
  openViewer,
  closeViewer,
  openMiniPlayer,
  closeMiniPlayer,
  handleMiniPlayerDrag,
  beginMiniPlayerDrag,
  endMiniPlayerDrag,
  handleMiniPlayerVolumeInput,
  deletePost,
  toggleLike,
  toggleSave,
  syncSourceHelp,
  updateActiveFilterChip,
  isCurrentUserAdmin,
  isCurrentUserActivated,
  canRevealMemberEmails,
  playIncomingMessageSound,
  syncCurrentProfileToSupabase,
  handleMessageSubmit,
  handleMessageAttachmentInputChange,
  handleMessageEmojiPanelClick,
  toggleMessageEmojiPicker,
  closeMessageEmojiPicker,
  clearMessageAttachmentSelection,
  openOwnProfile,
  stepViewer,
  expandMiniPlayer,
  collapseViewerToPlayer,
  stepMiniPlayer,
  applyMiniPlayerPosition,
  clampPlayerPosition,
  destroyActivePlayer,
  renderCardMedia,
  renderSpotlightMedia,
  renderViewerMedia,
  renderViewerAttachmentMedia,
  renderMiniPlayerMedia,
  renderMiniPlayerVolumeControl,
  getVisiblePosts,
  sortPosts,
  getFeedPageCount,
  clampFeedPage,
  getCurrentFeedPagePosts,
  resetFeedPagination,
  renderFeedPagination,
  renderSpotlight,
  renderCreatorBoard,
  getProfileSummaryForPost,
  getPostsForProfileKey,
  getProfileSummaryByKey,
  getProfileInitials,
  formatKind,
  getSignalLabel,
  formatTimestamp,
  healPosts,
  appendMedia,
  renderExternalMedia,
  createExternalPreviewStage,
  applyExternalPreviewMetadata,
  getExternalPreviewMetadata,
  getSpotifyPreviewMetadata,
  fetchSpotifyPreviewCatalogMetadata,
  fetchSpotifyPreviewOEmbedMetadata,
  getYouTubePreviewMetadata,
  resolveYouTubePreviewSourceUrl,
  resolveSpotifyPreviewSourceUrl,
  getPostById,
  isPostSaved,
  getLikeCount,
  updateComposerAccess,
  handleWindowClick,
  handleWindowScroll,
  handleViewportResize,
  handleSelectedFile,
  handleExternalUrlInput,
  clearSelectedMedia,
  clearPreviewOnly,
  renderPreview,
  renderExternalPreview
});
