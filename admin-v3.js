import { 
  loadProfilesFromSupabase, loadUserBansFromSupabase, loadCurrentUserBanFromSupabase, 
  loadBlockedUsersFromSupabase, deleteHostedPost, normalizeUserBan, normalizeUserBlock, 
  normalizeSiteSettings, getApiContext 
} from './api-v3.js';
import { resolveMemberDisplayName, formatBackendError } from './shared-utils.js';

/**
 * Administrative and Moderation Logic for Signal Share V3
 */

// --- Constants ---

export const DEFAULT_BLOCKED_TERMS = Object.freeze([
  "scam", "spam", "fraud", "phish", "buy cheap", "guaranteed win",
  "cryptocurrency", "nft whitelist", "airdrop", "ponzi"
]);

export const POST_MODERATION_ERROR = "Content blocked. Please revise your text to meet community standards.";

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  shellWidth: 1200,
  sectionGap: 24,
  surfaceRadius: 32,
  mediaFit: "cover"
});

// --- State and UI Context ---

let uiContext = {
  render: () => {},
  showOverlay: () => {},
  hideOverlay: () => {},
  showAuthFeedback: () => {},
  showMessengerFeedback: () => {},
  renderMessenger: () => {},
  renderAdminBanPanel: () => {},
  showAdminBanFeedback: () => {},
  refreshMessengerState: () => {},
  isMessagingEnabled: () => false,
  elements: {}
};

/**
 * Initialize the admin module with necessary UI callbacks
 * @param {object} context - UI functions and elements
 */
export function setAdminUiContext(context) {
  uiContext = { ...uiContext, ...context };
}

// --- Email and Access Utilities ---

export function normalizeEmailForMatch(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase(); 
  if (!normalized || !normalized.includes("@")) return normalized;
  
  const [localPart, domainPart] = normalized.split("@");
  if (!localPart || !domainPart) return normalized;
  
  if (domainPart === "gmail.com" || domainPart === "googlemail.com") {
    const localWithoutAlias = localPart.split("+")[0].replace(/\./g, "");
    return `${localWithoutAlias}@gmail.com`;
  }
  return normalized;
}

export function getCurrentUserEmailCandidates(currentUser) {
  if (!currentUser) return [];
  const candidates = new Set();
  const addEmail = (v) => {
    if (typeof v === "string") {
      const n = normalizeEmailForMatch(v);
      if (n) candidates.add(n);
    }
  };
  addEmail(currentUser.email);
  addEmail(currentUser.new_email);
  if (currentUser.user_metadata) addEmail(currentUser.user_metadata.email);
  if (Array.isArray(currentUser.identities)) {
    currentUser.identities.forEach((i) => {
      if (i?.identity_data) addEmail(i.identity_data.email);
      else if (i?.email) addEmail(i.email);
    });
  }
  return Array.from(candidates);
}

export function isCurrentUserAdmin(state, appConfig) {
  if (!state.currentUser) return false;
  const emails = getCurrentUserEmailCandidates(state.currentUser);
  return emails.some((email) => appConfig.adminEmails.includes(email));
}

export function isCurrentUserMasterAdmin(state, appConfig) {
  if (!state.currentUser) return false;
  const emails = getCurrentUserEmailCandidates(state.currentUser);
  return emails.some((email) => appConfig.masterAdminEmails.includes(email));
}

export function canRevealMemberEmails(state, appConfig) {
  return isCurrentUserAdmin(state, appConfig);
}

export function canAccessAdminBanPanel(state, appConfig) {
  return Boolean(state.currentUser) && isCurrentUserAdmin(state, appConfig);
}

// --- Post Moderation Logic ---

export function canDeletePost(post, state, appConfig) {
  if (!post) return false;
  if (post.isLocal) return true;
  if (state.backendMode !== "supabase" || !state.currentUser) return false;
  return isCurrentUserAdmin(state, appConfig) || post.authorId === state.currentUser.id;
}

export function canCurrentUserUploadMediaKind(mediaKind, state, appConfig) {
  if (state.backendMode !== "supabase") return true;
  if (!["image", "video", "audio"].includes(mediaKind)) return true;
  return isCurrentUserAdmin(state, appConfig);
}

export function getRestrictedUploadMessage(mediaKind) {
  if (mediaKind === "image") return "Only admin accounts can publish uploaded images to the live feed. YouTube and Spotify links stay open.";
  if (mediaKind === "video") return "Only admin accounts can publish uploaded videos to the live feed. YouTube links stay available to everyone.";
  if (mediaKind === "audio") return "Only admin accounts can publish uploaded audio to the live feed. Spotify and YouTube links stay open.";
  return "Only admin accounts can publish that upload type to the live feed.";
}

export function normalizeModerationText(value) {
  const curlyApostrophe = String.fromCharCode(8217);
  return String(value ?? "").toLowerCase().normalize("NFKC").split("'").join("").split(curlyApostrophe).join("").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function getActiveBlockedTerms() {
  return [...DEFAULT_BLOCKED_TERMS];
}

export function findBlockedPostTerm({ creator = "", title = "", caption = "", tags = [] }) {
  const normalizedPostText = normalizeModerationText([creator, title, caption, ...(Array.isArray(tags) ? tags : [])].join(" "));
  if (!normalizedPostText) return "";
  const haystack = ` ${normalizedPostText} `;
  return getActiveBlockedTerms().find((term) => {
    const normalizedTerm = normalizeModerationText(term);
    return normalizedTerm && haystack.includes(` ${normalizedTerm} `);
  }) ?? "";
}

export function isPostModerationError(error) {
  const details = formatBackendError(error).toLowerCase();
  return details.includes("blocked language");
}

// formatBackendError moved to shared-utils.js

// --- Ban and Block Logic ---

export function isCurrentUserBanned(state) {
  return state.currentUserBanned || false;
}

export function isUserBanned(state, userId) {
  if (!Array.isArray(state.bannedUserIds)) return false;
  return state.bannedUserIds.includes(userId);
}

export function isUserBlocked(state, userId) {
  return Array.isArray(state.blockedUserIds) && state.blockedUserIds.includes(userId);
}

export function isBlockingBackendUnavailable(error) {
  const details = formatBackendError(error).toLowerCase();
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "42P01" || code === "42501" || details.includes("user_blocks") || details.includes("permission denied");
}

export function isBanningBackendUnavailable(error) {
  const details = formatBackendError(error).toLowerCase();
  const code = typeof error?.code === "string" ? error.code : "";
  return code === "42P01" || code === "42501" || details.includes("user_bans") || details.includes("permission denied");
}

export async function refreshAdminBanState(state, appConfig) {
  if (!canAccessAdminBanPanel(state, appConfig)) { 
    uiContext.renderAdminBanPanel(); 
    return; 
  }
  state.adminBanBusy = true; 
  state.adminBanFeedback = ""; 
  state.adminBanFeedbackIsError = false; 
  uiContext.renderAdminBanPanel();
  
  try {
    const [profilesResult, bansResult] = await Promise.allSettled([loadProfilesFromSupabase(), loadUserBansFromSupabase()]);
    if (profilesResult.status !== "fulfilled") throw profilesResult.reason;
    
    let bans = []; 
    state.banningAvailable = true;
    if (bansResult.status === "fulfilled") {
      bans = bansResult.value;
    } else if (isBanningBackendUnavailable(bansResult.reason)) {
      state.banningAvailable = false; 
      state.bannedUserIds = []; 
      state.adminBanFeedback = "Run the latest Supabase schema to enable account bans."; 
      state.adminBanFeedbackIsError = true;
    } else {
      throw bansResult.reason;
    }
    
    state.availableProfiles = profilesResult.value.filter((profile) => profile.id !== state.currentUser.id);
    if (state.banningAvailable) {
      state.bannedUserIds = bans.map((ban) => ban.bannedId);
    }
  } catch (error) {
    console.error("Admin ban state could not be loaded", error);
    state.adminBanFeedback = "Ban controls could not be loaded.";
    state.adminBanFeedbackIsError = true;
  } finally {
    state.adminBanBusy = false;
    uiContext.renderAdminBanPanel();
  }
}

export async function toggleUserBan(profile, state, appConfig) {
  if (!canAccessAdminBanPanel(state, appConfig) || !profile?.id || !state.currentUser) {
    uiContext.showAdminBanFeedback("Only live admin accounts can ban members.", true);
    return;
  }
  if (!state.banningAvailable) {
    uiContext.showAdminBanFeedback("Run the latest Supabase schema to enable account bans.", true);
    return;
  }
  
  const displayName = resolveMemberDisplayName(profile);
  const banned = isUserBanned(state, profile.id);
  
  try {
    state.adminBanBusy = true; 
    state.pendingBanUserId = ""; 
    uiContext.renderAdminBanPanel();
    
    if (banned) {
      const { error } = await state.supabase.from("user_bans").delete().eq("banned_id", profile.id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from("user_bans").insert({ banned_id: profile.id, banned_by: state.currentUser.id });
      if (error && error.code !== "23505") throw error;
    }
    
    const successMessage = `${displayName} is ${banned ? "unbanned" : "banned"}.`;
    await refreshAdminBanState(state, appConfig);
    state.adminBanFeedback = successMessage;
    state.adminBanFeedbackIsError = false;
    uiContext.renderAdminBanPanel();
    
    if (uiContext.isMessagingEnabled(state)) {
      await uiContext.refreshMessengerState({ preserveActiveThread: true });
    }
  } catch (error) {
    console.error("User ban update failed", error);
    state.adminBanBusy = false;
    const details = formatBackendError(error);
    uiContext.showAdminBanFeedback(details ? `That member could not be ${banned ? "unbanned" : "banned"}. ${details}` : `That member could not be ${banned ? "unbanned" : "banned"}.`, true);
  }
}

export async function toggleProfileBlock(profile, state) {
  if (!uiContext.isMessagingEnabled(state) || !profile?.id || !state.currentUser) {
    uiContext.showMessengerFeedback("Sign in with an activated account before blocking members.", true);
    return;
  }
  if (!state.blockingAvailable) {
    uiContext.showMessengerFeedback("Blocking needs the latest Supabase messenger schema.", true);
    return;
  }
  
  const displayName = resolveMemberDisplayName(profile);
  const blocked = isUserBlocked(state, profile.id);
  
  try {
    state.messengerBusy++; 
    state.pendingBlockUserId = ""; 
    state.pendingDeleteThreadId = ""; 
    uiContext.renderMessenger();
    
    if (blocked) {
      const { error } = await state.supabase.from("user_blocks").delete().eq("blocker_id", state.currentUser.id).eq("blocked_id", profile.id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from("user_blocks").insert({ blocker_id: state.currentUser.id, blocked_id: profile.id });
      if (error && error.code !== "23505") throw error;
    }
    
    await uiContext.refreshMessengerState({ preserveActiveThread: true });
    uiContext.showMessengerFeedback(`${displayName} is ${blocked ? "unblocked" : "blocked"}.`);
  } catch (error) {
    console.error("Member block update failed", error);
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    const details = formatBackendError(error);
    uiContext.showMessengerFeedback(details ? `That member could not be ${blocked ? "unblocked" : "blocked"}. ${details}` : `That member could not be ${blocked ? "unblocked" : "blocked"}.`, true);
    uiContext.renderMessenger();
  }
}

export async function refreshCurrentUserBanState(state, appConfig) {
  state.currentUserBanned = false;
  if (!state.supabase || state.backendMode !== "supabase" || !state.currentUser) {
    uiContext.hideOverlay();
    return;
  }
  try {
    const ban = await loadCurrentUserBanFromSupabase();
    state.currentUserBanned = Boolean(ban);
    
    if (state.currentUserBanned) {
      state.adminBanPanelOpen = false;
      state.messengerOpen = false;
      state.messengerExpanded = false;
      state.activeThreadId = null;
      state.activeMessages = [];
      uiContext.showAuthFeedback("This account has been banned from posting and Direct Messenger.", true);
      uiContext.showOverlay();
    } else {
      uiContext.hideOverlay();
    }
  } catch (error) {
    if (isBanningBackendUnavailable(error)) {
      state.banningAvailable = false;
      console.warn("Account ban checks are unavailable on the current Supabase schema.", error);
      return;
    }
    throw error;
  }
}

// --- Site Settings Logic ---

export function getSiteSettingsPayload(siteSettings) {
  return {
    id: "global",
    shell_width: siteSettings.shellWidth,
    section_gap: siteSettings.sectionGap,
    surface_radius: siteSettings.surfaceRadius,
    media_fit: siteSettings.mediaFit,
    updated_at: new Date().toISOString()
  };
}

export async function handleAdminSettingsSubmit(event, state, appConfig) {
  event.preventDefault();
  const feedback = uiContext.elements.adminSettingsFeedback;
  
  if (state.backendMode !== "supabase" || !state.supabase || !isCurrentUserMasterAdmin(state, appConfig)) {
    if (feedback) {
      feedback.textContent = "Only master admin accounts can save site settings.";
      feedback.classList.add("is-error");
    }
    return;
  }
  
  const { error } = await state.supabase.from("site_settings").upsert(getSiteSettingsPayload(state.siteSettings));
  if (error) {
    console.error("Failed to save site settings", error);
    if (feedback) {
      feedback.textContent = "The layout settings could not be saved.";
      feedback.classList.add("is-error");
    }
    return;
  }
  
  if (feedback) {
    feedback.textContent = "Layout settings saved for the live site.";
    feedback.classList.remove("is-error");
  }
}
