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
 * Ensures a value is a trimmed string with normalized whitespace.
 */
export function cleanDisplayText(value = "") {
  return toCleanString(value).replace(/\s+/g, " ");
}

/**
 * Normalizes a string: trimmed and lowercased.
 */
export function normalizeText(value = "") {
  return toCleanString(value).toLowerCase();
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
 * Determines the category of a media/attachment based on its MIME type.
 * @param {string} type MIME type
 * @param {string} fallback Default category if not matched
 */
export function getMediaKind(type = "", fallback = "file") {
  const t = (type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return fallback;
}

/**
 * Alias for backward compatibility in messenger logic.
 */
export function getMessageAttachmentKind(type = "") {
  return getMediaKind(type, "file");
}

/**
 * Clamps a number between min and max.
 */
export function clampNumber(num, min, max) {
  return Math.min(Math.max(num, min), max);
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
 * Checks if a post is an external URL provider (YouTube/Spotify).
 */
export function isExternalUrlPost(post) {
  if (!post) return false;
  return post.sourceKind === "youtube" || post.sourceKind === "spotify";
}

/**
 * Capitalizes the provider name (e.g. "youtube" -> "YouTube").
 */
export function formatProviderName(p = "") {
  const normalized = normalizeText(p);
  if (!normalized) return "";
  if (normalized === "youtube") return "YouTube";
  if (normalized === "spotify") return "Spotify";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
  const k = toCleanString(kind) || "media";
  return `${k.charAt(0).toUpperCase()}${k.slice(1)} post`;
}

/**
 * Parses a comma-separated tag string into a clean array.
 */
export function parseTags(raw = "") {
  return toCleanString(raw)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Comparison helper for sorting posts by creation date (newest first).
 */
export function compareByNewest(l, r) {
  const lTime = l?.createdAt ? new Date(l.createdAt).getTime() : 0;
  const rTime = r?.createdAt ? new Date(r.createdAt).getTime() : 0;
  return rTime - lTime;
}

/**
 * Returns the ID of the latest post from a list.
 */
export function getLatestPostedPostId(posts = []) {
  if (!posts.length) return "";
  let latestPost = posts[0];
  let latestTime = new Date(latestPost.createdAt).getTime();
  for (const candidate of posts.slice(1)) {
    const candidateTime = new Date(candidate.createdAt).getTime();
    if (!Number.isNaN(candidateTime) && (Number.isNaN(latestTime) || candidateTime > latestTime)) {
      latestPost = candidate;
      latestTime = candidateTime;
    }
  }
  return latestPost?.id ?? "";
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

/**
 * Reads a file as a data URL (base64).
 * @param {File} file 
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Checks if the app is running in a native Capacitor environment.
 */
export function isNative() {
  if (typeof window === "undefined") return false;
  return Boolean(window.Capacitor && window.Capacitor.isNativePlatform?.());
}
