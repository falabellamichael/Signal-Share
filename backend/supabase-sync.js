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
  if (n === "youtube" || n === "yt" || n === "music") return "youtube";
  if (n === "spotify") return "spotify";
  return "";
}

function isBrowser(id = "") {
  const n = id.toLowerCase();
  return n.includes("chrome") || n.includes("edge") || n.includes("msedge") || n.includes("firefox") || n.includes("opera") || n.includes("browser");
}

function classifyProvider(session, preferred = "") {
  if (!session) return "";
  const id = (session.sourceAppUserModelId || session.sourceAppId || "").toLowerCase();
  const media = session.media || {};
  const title = (media.title || "").toLowerCase();
  const artist = (media.artist || "").toLowerCase();
  const album = (media.albumTitle || "").toLowerCase();
  const pref = normalizeSource(preferred);

  const isSpotify = id.includes("spotify") || title.includes("spotify") || artist.includes("spotify") || title.includes("open.spotify.com");
  const isYouTube = id.includes("youtube") || id.includes("ytmusic") || title.includes("youtube") || title.includes("youtu.be") || title.includes("music.youtube") || album.includes("youtube");

  if (isSpotify) return "spotify";
  if (isYouTube) return "youtube";

  // Tie-breaker for browsers: If locked to a source, claim generic browser sessions
  if (isBrowser(id)) {
    if (pref === "youtube") return "youtube";
    if (pref === "spotify") return "spotify";
    return "browser";
  }
  return "";
}

function scoreSession(session, preferred = "") {
  if (!session) return -1000000;
  const pref = normalizeSource(preferred);
  const provider = classifyProvider(session, preferred);
  
  // SMTC PlaybackStatus: 4 = Playing, 5 = Buffering
  const status = session.playback?.playbackStatus;
  const priority = (status === 4 || status === 5 ? 10 : 1);
  let score = priority * 1000;

  if (pref) {
    if (provider === pref) {
      score += 50000;
    } else {
      // Reject non-matching session if a specific source is preferred
      return -1000000;
    }
  } else {
    // If no preference, boost known apps
    if (provider === "spotify" || provider === "youtube") score += 5000;
  }
  
  // Recent update boost
  if (session.lastUpdatedTime) score += (Number(session.lastUpdatedTime) % 1000) / 100;

  return score;
}

function sanitizeMediaMeta(rawMeta = "", sourceAppId = "") {
  let meta = `${rawMeta || ""}`.replace(/\s+/g, " ").trim();
  if (!meta) return "";
  
  // Remove Doubled IDs
  const v = sourceAppId.toLowerCase();
  const variants = [v, v.replace(/!.*$/, ""), v.replace(/\.exe$/i, ""), v.replace(/\.\d+$/, "")];
  variants.forEach(variant => {
    if (!variant || variant.length < 3) return;
    const pattern = new RegExp(`^${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:|]?\\s*|\\s*[-:|]?\\s*${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gi");
    meta = meta.replace(pattern, "").trim();
  });
  return meta;
}

export function buildSnapshot(preferredSource = "") {
  try {
    const sessions = safeGetMediaSessions();
    const pref = normalizeSource(preferredSource);
    
    console.log(`[Bridge] Building snapshot for preference: ${pref || "None"} (Found ${sessions.length} sessions)`);

    const best = sessions.reduce((acc, s) => {
      const score = scoreSession(s, pref);
      if (score > (acc ? acc.score : -999999)) return { session: s, score };
      return acc;
    }, null);

    if (!best || best.score < 0) {
      console.log(`[Bridge] No suitable session found for ${pref || "Any"}`);
      return { active: false, playbackState: "none", title: "", meta: "", preferredSource: pref };
    }

    const s = best.session;
    const media = s.media || {};
    const title = (media.title || "").trim();
    const artist = (media.artist || media.albumArtist || "").trim();
    const sourceAppId = s.sourceAppUserModelId || s.sourceAppId || "";
    const provider = classifyProvider(s, pref);
    
    const sanitizedMeta = sanitizeMediaMeta(artist, sourceAppId);
    const videoId = (provider === "youtube") ? extractYoutubeId(`${title} ${media.albumTitle || ""} ${sourceAppId}`) : "";

    const snapshot = {
      active: true,
      playbackState: mapPlaybackState(s.playback?.playbackStatus),
      title: title || "Now playing",
      meta: sanitizedMeta || artist || resolveAppLabel(sourceAppId),
      appPackage: sourceAppId,
      artworkUri: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "",
      openUri: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      sourceProvider: provider,
      preferredSource: pref,
      smtcHealthy: true
    };

    console.log(`[Bridge] Snapshot built: ${snapshot.title} by ${snapshot.meta} (${provider})`);
    return snapshot;
  } catch (err) {
    console.error("[Bridge] Critical error building snapshot:", err);
    return { active: false, playbackState: "none", title: "Bridge Error", meta: err.message };
  }
}

function resolveAppLabel(id = "") {
  const n = id.toLowerCase();
  if (n.includes("spotify")) return "Spotify";
  if (n.includes("youtube")) return "YouTube";
  if (n.includes("chrome")) return "Chrome";
  if (n.includes("msedge")) return "Edge";
  if (n.includes("firefox")) return "Firefox";
  return id.split('.').pop() || id;
}

function extractYoutubeId(text) {
  if (!text) return "";
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

  console.log(`[Bridge] Syncing to Supabase: ${data.title}`);
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

  if (error) {
    console.error("[Bridge] Supabase sync failed:", error.message);
  } else {
    lastSyncKey = syncKey;
  }
}

export async function reportLocalActivity(activity) {
  if (!supabase || !userId) return;
  console.log(`[Bridge] Reporting local activity: ${activity.title}`);
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
