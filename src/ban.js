// Ban Helper Functions
// This file contains all ban-related helper functions

/**
 * Check if current user is banned
 * @param {object} state - The application state
 * @returns {boolean} True if user is banned, false otherwise
 */
export function isCurrentUserBanned(state) {
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
export function isUserBanned(state, userId) {
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
export function isMessagingEnabled(state) {
    return state.backendMode === "supabase" && Boolean(state.currentUser);
}

/**
 * Check if user can publish to live feed
 * @param {object} state - The application state
 * @returns {boolean} True if user can publish, false otherwise
 */
export function canPublishToLiveFeed(state) {
    return Boolean(state.currentUser) && !isCurrentUserBanned(state);
}

/**
 * Check if user is blocked
 * @param {object} state - The application state
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user is blocked, false otherwise
 */
export function isUserBlocked(state, userId) {
  return Array.isArray(state.blockedUserIds) && state.blockedUserIds.includes(userId);
}

/**
 * Check if user can access admin ban panel
 * @param {object} state - The application state
 * @param {boolean} isAdmin - Whether the user is an admin based on email
 * @returns {boolean} True if user has admin privileges
 */
export function canAccessAdminBanPanel(state, isAdmin) {
    return Boolean(state.currentUser) && isAdmin === true;
}