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
  const n = val.toLowerCase().trim();
  return (n === "youtube" || n === "spotify") ? n : "";
}

function classifyProvider(session, preferred = "") {
  const id = (session.sourceAppUserModelId || session.sourceAppId || "").toLowerCase();
  const title = (session.media?.title || "").toLowerCase();
  
  if (id.includes("spotify") || title.includes("spotify")) return "spotify";
  if (id.includes("youtube") || id.includes("ytmusic") || title.includes("youtube")) return "youtube";
  
  const pref = normalizeSource(preferred);
  if (id.includes("chrome") || id.includes("edge") || id.includes("firefox")) {
    return pref || "browser";
  }
  return "";
}

function scoreSession(session, preferred = "") {
  const pref = normalizeSource(preferred);
  const provider = classifyProvider(session, preferred);
  let score = (session.playback?.playbackStatus === 4 ? 5000 : 1000);

  if (pref) {
    if (provider === pref) score += 10000;
    else return -1; // Reject non-matching if preference set
  }
  return score;
}

export function buildSnapshot(preferredSource = "") {
  const sessions = safeGetMediaSessions();
  const best = sessions.reduce((acc, s) => {
    const score = scoreSession(s, preferredSource);
    if (score > (acc ? acc.score : -1)) return { session: s, score };
    return acc;
  }, null);

  if (!best) return { active: false, playbackState: "none", title: "", meta: "" };

  const s = best.session;
  const videoId = (classifyProvider(s) === "youtube") ? extractYoutubeId(s.media?.title || "") : "";
  
  return {
    active: true,
    playbackState: mapPlaybackState(s.playback?.playbackStatus),
    title: s.media?.title || "Unknown",
    meta: s.media?.artist || s.sourceAppId || "",
    appPackage: s.sourceAppUserModelId || s.sourceAppId,
    artworkUri: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "",
    openUri: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    sourceProvider: classifyProvider(s, preferredSource)
  };
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
  
  const syncKey = `${data.title}|${data.playbackState}|${data.meta}`;
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
  // activity = { type: 'game', title: 'Neon Pinball', meta: 'Playing now' }
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
