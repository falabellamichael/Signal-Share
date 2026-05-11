/**
 * Signal Share Shared Utilities
 * Centralized helper functions used across the application.
 */

/**
 * Ensures a value is a trimmed string.
 */
export function toCleanString(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : `${value}`.trim();
}

/**
 * Checks if a value is a Promise or thenable.
 */
export function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

/**
 * Safely calls a function with a fallback value.
 */
export function safeCall(fn, fallback, ...args) {
  if (typeof fn !== "function") return fallback;
  try {
    const result = fn(...args);
    return result == null ? fallback : result;
  } catch (_error) {
    return fallback;
  }
}

/**
 * Determines the category of a message attachment based on its MIME type.
 */
export function getMessageAttachmentKind(type = "") {
  const t = (type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * Formats the badge text for a post (e.g. "Video post / High signal").
 */
export function formatPostBadge(post, formatKind, getSignalLabel) {
  const kind = typeof formatKind === "function" 
    ? formatKind(post?.mediaKind || "media") 
    : (post?.mediaKind ? `${post.mediaKind} post` : "Media post");
  
  const signal = typeof getSignalLabel === "function" 
    ? getSignalLabel("Live on feed", post) 
    : "Live on feed";
    
  return [kind, signal].filter(Boolean).join(" / ");
}

/**
 * Formats the metadata string for a post (e.g. "Creator · Jan 1, 2024").
 */
export function formatPostMeta(post, creatorSummary, formatTimestamp) {
  const creator = creatorSummary?.displayName ?? post?.creator ?? "Signal Share";
  const timestamp = typeof formatTimestamp === "function" ? formatTimestamp(post?.createdAt) : "";
  return [creator, timestamp].filter(Boolean).join(" · ");
}

/**
 * Checks if a post contains playable media.
 */
export function isPlayablePost(post) {
  if (!post) return false;
  return (
    post.mediaKind === "video" || 
    post.mediaKind === "audio" || 
    post.sourceKind === "youtube" || 
    post.sourceKind === "spotify"
  );
}

/**
 * Capitalizes the provider name (e.g. "youtube" -> "YouTube").
 */
export function formatProviderName(p = "") {
  if (!p) return "";
  if (p.toLowerCase() === "youtube") return "YouTube";
  if (p.toLowerCase() === "spotify") return "Spotify";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * Formats an ISO timestamp into a readable date.
 */
export function formatTimestamp(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en", { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * Formats a byte size into a human-readable string (KB/MB).
 */
export function formatFileSize(size) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats a media kind into a post label (e.g. "image" -> "Image post").
 */
export function formatKind(kind = "media") {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} post`;
}

/**
 * Simple memoization and debounce state.
 */
const UtilityCache = new Map();

/**
 * Simple memoization helper for expensive lookups.
 */
export function memoGet(key, factory, ttl = 1000) {
  const now = Date.now();
  const entry = UtilityCache.get(key);
  if (entry && (now - entry.timestamp < ttl)) return entry.value;
  const value = factory();
  UtilityCache.set(key, { value, timestamp: now });
  return value;
}

/**
 * Shared debounce gate. Returns true if the action should be throttled.
 */
export function debounce(actionName, ttl = 0) {
  const now = Date.now();
  const key = `debounce_${actionName}`;
  const entry = UtilityCache.get(key);
  if (entry && (now - entry.timestamp < ttl)) return true;
  UtilityCache.set(key, { value: true, timestamp: now });
  return false;
}
