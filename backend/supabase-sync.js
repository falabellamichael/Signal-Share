import { createClient } from "@supabase/supabase-js";
import { mapPlaybackState, safeGetMediaSessions } from "./bridge-logic.js";

let supabase = null;
let userId = null;
let lastSyncKey = "";

export function initSupabaseSync(url, key, uid) {
  supabase = createClient(url, key);
  userId = uid;
}

function normalizeSource(val = "") {
  const n = `${val || ""}`.trim().toLowerCase();
  return (n === "youtube" || n === "spotify") ? n : "";
}

function isBrowser(id = "") {
  const n = id.toLowerCase();
  return n.includes("chrome") || n.includes("edge") || n.includes("msedge") || n.includes("firefox") || n.includes("opera") || n.includes("browser");
}

function classifyProvider(session, preferred = "") {
  const id = (session.sourceAppUserModelId || session.sourceAppId || "").toLowerCase();
  const title = (session.media?.title || "").toLowerCase();
  const artist = (session.media?.artist || "").toLowerCase();
  const pref = normalizeSource(preferred);

  const isSpotify = id.includes("spotify") || title.includes("spotify") || artist.includes("spotify");
  const isYouTube = id.includes("youtube") || id.includes("ytmusic") || title.includes("youtube") || title.includes("youtu.be");

  if (isSpotify) return "spotify";
  if (isYouTube) return "youtube";

  if (isBrowser(id)) {
    if (pref === "youtube") return "youtube";
    if (pref === "spotify") return "spotify";
    return "browser";
  }
  return "";
}

function scoreSession(session, preferred = "") {
  const pref = normalizeSource(preferred);
  const provider = classifyProvider(session, preferred);
  const priority = (session.playback?.playbackStatus === 4 ? 5 : 1);
  let score = priority * 1000;

  if (pref) {
    if (provider === pref) score += 50000;
    else return -1000000; // Reject non-matching
  }
  
  if (provider === "spotify" || provider === "youtube") score += 500;
  return score;
}

function sanitizeMediaMeta(rawMeta = "", sourceAppId = "") {
  let meta = `${rawMeta || ""}`.replace(/\s+/g, " ").trim();
  if (!meta) return "";
  const variants = [sourceAppId, sourceAppId.replace(/!.*$/, ""), sourceAppId.replace(/\.exe$/i, "")];
  variants.forEach(v => {
    if (!v) return;
    const pattern = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:|]?\\s*`, "gi");
    meta = meta.replace(pattern, "").trim();
  });
  return meta;
}

export function buildSnapshot(preferredSource = "") {
  const sessions = safeGetMediaSessions();
  const pref = normalizeSource(preferredSource);
  
  const best = sessions.reduce((acc, s) => {
    const score = scoreSession(s, pref);
    if (score > (acc ? acc.score : -1000000)) return { session: s, score };
    return acc;
  }, null);

  if (!best || best.score < 0) return { active: false, playbackState: "none", title: "", meta: "" };

  const s = best.session;
  const title = (s.media?.title || "").trim();
  const artist = (s.media?.artist || s.media?.albumArtist || "").trim();
  const sourceAppId = s.sourceAppUserModelId || s.sourceAppId || "";
  const provider = classifyProvider(s, pref);
  
  const sanitizedMeta = sanitizeMediaMeta(artist, sourceAppId);
  const videoId = (provider === "youtube") ? extractYoutubeId(`${title} ${s.media?.albumTitle || ""}`) : "";

  return {
    active: true,
    playbackState: mapPlaybackState(s.playback?.playbackStatus),
    title: title || "Now playing",
    meta: sanitizedMeta || artist || resolveAppLabel(sourceAppId),
    appPackage: sourceAppId,
    artworkUri: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "",
    openUri: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    sourceProvider: provider,
    preferredSource: pref
  };
}

function resolveAppLabel(id = "") {
  const n = id.toLowerCase();
  if (n.includes("spotify")) return "Spotify";
  if (n.includes("youtube")) return "YouTube";
  if (n.includes("chrome")) return "Chrome";
  if (n.includes("msedge")) return "Edge";
  return id;
}

function extractYoutubeId(text) {
  const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/))([a-zA-Z0-9_-]{11})/i);
  if (match) return match[1];
  const bracket = text.match(/[\[\(\u3010]([a-zA-Z0-9_-]{11})[\]\)\u3011]/);
  return bracket ? bracket[1] : "";
}

export async function syncToSupabase(snapshot = null) {
  if (!supabase || !userId) return;
  const data = snapshot || buildSnapshot();
  
  const syncKey = `${data.title}|${data.playbackState}|${data.meta}|${data.artworkUri ? "art" : "no"}`;
  if (syncKey === lastSyncKey) return;

  const { error } = await supabase.from("system_media").upsert({
    user_id: userId,
    playback_state: data.playbackState,
    title: data.title,
    meta: data.meta,
    artwork_uri: data.artworkUri,
    open_uri: data.openUri,
    app_package: data.appPackage,
    device_name: "Desktop PC",
    updated_at: new Date().toISOString()
  });

  if (!error) lastSyncKey = syncKey;
}

export async function reportLocalActivity(activity) {
  if (!supabase || !userId) return;
  const { error } = await supabase.from("system_media").upsert({
    user_id: userId,
    playback_state: "playing",
    title: activity.title || "Arcade Game",
    meta: activity.meta || "Playing now",
    artwork_uri: activity.artworkUri || "https://signal-share.com/neon_pinball_v2_poster.png",
    app_package: "io.signalshare.arcade",
    device_name: "Desktop PC (Arcade Mode)",
    updated_at: new Date().toISOString()
  });
  return !error;
}
