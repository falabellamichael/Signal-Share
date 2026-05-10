import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SMTCMonitor, PlaybackStatus } from "@coooookies/windows-smtc-monitor";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Load environment variables from the same folder as this script
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const isWindows = process.platform === "win32";
const userId = process.env.SIGNAL_SHARE_USER_ID;

const MEDIA_KEY_CODES = {
  play_pause: 0xb3,
  play: 0xfa, // VK_MEDIA_PLAY
  pause: 0xfb, // VK_MEDIA_PAUSE
  next: 0xb0,
  previous: 0xb1,
};
const APP_COMMAND_CODES = {
  play_pause: 14, // APPCOMMAND_MEDIA_PLAY_PAUSE
  play: 46, // APPCOMMAND_MEDIA_PLAY
  pause: 47, // APPCOMMAND_MEDIA_PAUSE
  next: 11, // APPCOMMAND_MEDIA_NEXTTRACK
  previous: 12, // APPCOMMAND_MEDIA_PREVIOUSTRACK
};
const WINRT_ACTION_METHODS = {
  play_pause: "TryTogglePlayPauseAsync",
  play: "TryPlayAsync",
  pause: "TryPauseAsync",
  next: "TrySkipNextAsync",
  previous: "TrySkipPreviousAsync",
};
const MAX_ARTWORK_BYTES = Number(process.env.SIGNAL_SHARE_MAX_ARTWORK_BYTES || 1024 * 1024); // Increase to 1MB
const SMTC_ERROR_LOG_COOLDOWN_MS = 30000;
const LAST_GOOD_SNAPSHOT_MAX_AGE_MS = 15000;
const SNAPSHOT_CACHE_TTL_MS = Number(process.env.SIGNAL_SHARE_SNAPSHOT_CACHE_TTL_MS || 650);
const SUPABASE_SYNC_INTERVAL_MS = Number(process.env.SIGNAL_SHARE_SYNC_INTERVAL_MS || 5000);
const enableRemoteMediaSync = process.env.SIGNAL_SHARE_ENABLE_REMOTE_MEDIA === "true" || process.env.SIGNAL_SHARE_REMOTE_MEDIA === "true";
const ALLOW_OPEN_URI = process.env.SIGNAL_SHARE_ALLOW_OPEN_URI === "true";
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const MEDIA_ACTION_COOLDOWN_MS = 220;
console.log(`[Bridge] Security configuration loaded. Bridge Secret: ${BRIDGE_SECRET ? "CONFIGURED" : "DISABLED"}`);
const lastMediaActionAtByKey = new Map();

// Rate limiting for system actions
const actionCounts = new Map(); // ip -> { count, resetAt }
const MAX_ACTIONS_PER_MINUTE = 30;

const CORS_WHITELIST = [
  "https://falabellamichael.github.io",
  "https://signal-share.pages.dev",
  "https://signal-share.com",
  "http://localhost",
  "http://127.0.0.1"
];

let lastGoodSnapshot = null;
let lastGoodSnapshotAt = 0;
let smtcFailureCount = 0;
let lastSmtcErrorMessage = "";
let lastSmtcErrorLoggedAt = 0;
let lastSupabaseSyncKey = "";
let cachedSnapshotPayload = null;
let cachedSnapshotAt = 0;

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);

app.use(express.json({ limit: "1mb" }));

// Security & CORS Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isWhitelisted = origin && CORS_WHITELIST.some((allowed) => origin.startsWith(allowed));
  const isLocalhost = !origin || origin.includes("localhost") || origin.includes("127.0.0.1");

  if (isWhitelisted || isLocalhost) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://falabellamichael.github.io");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, x-bridge-secret, Authorization, target-address-space");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Local-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin, Access-Control-Request-Headers");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (BRIDGE_SECRET && req.path.startsWith("/api/system-media")) {
    const providedSecret = `${req.headers["x-bridge-secret"] || ""}`.trim();
    if (providedSecret !== BRIDGE_SECRET.trim()) {
      console.warn(`[Security] Unauthorized media bridge request from ${req.ip}. Path: ${req.path}, ProvidedSecret: ${providedSecret ? "PRESENT" : "MISSING"}`);
      return res.status(403).json({ error: "Unauthorized: Invalid Bridge Secret" });
    }
  }

  if (req.method === "POST" && req.path.endsWith("/action")) {
    const now = Date.now();
    const state = actionCounts.get(req.ip) || { count: 0, resetAt: now + 60000 };

    if (now > state.resetAt) {
      state.count = 0;
      state.resetAt = now + 60000;
    }

    state.count++;
    actionCounts.set(req.ip, state);

    if (state.count > MAX_ACTIONS_PER_MINUTE) {
      return res.status(429).json({ error: "Too many actions. Please slow down." });
    }
  }

  next();
});

app.use(express.static(projectRoot));

function mapPlaybackState(playbackStatus) {
  switch (playbackStatus) {
    case PlaybackStatus.PLAYING:
      return "playing";
    case PlaybackStatus.PAUSED:
      return "paused";
    case PlaybackStatus.CLOSED:
    case PlaybackStatus.STOPPED:
      return "none";
    default:
      return "active";
  }
}

function inferArtworkMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) return "image/webp";
  return "";
}

function escapeRegex(value = "") {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSourceAppIdVariants(sourceAppId = "") {
  const value = `${sourceAppId || ""}`.trim();
  if (!value) return [];
  const variants = new Set();
  variants.add(value);
  variants.add(value.replace(/!.*$/, ""));
  variants.add(value.replace(/\.\d+$/, ""));
  variants.add(value.replace(/\.exe$/i, ""));
  variants.add(value.replace(/_[a-z0-9]+$/i, ""));
  return Array.from(variants)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function sanitizeMediaMeta(rawMeta = "", sourceAppId = "") {
  let meta = `${rawMeta || ""}`.replace(/\s+/g, " ").trim();
  if (!meta) return "";

  for (const variant of getSourceAppIdVariants(sourceAppId)) {
    const prefixPattern = new RegExp(`^${escapeRegex(variant)}\\s*(?:[-:|]\\s*)?`, "i");
    const stripped = meta.replace(prefixPattern, "").trim();
    if (stripped && stripped !== meta) {
      meta = stripped;
      break;
    }
  }

  const genericPrefixPattern = /^(?:spotify[a-z0-9._!-]*|operasoftware\.[a-z0-9._!-]*|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?|bluetooth|phone link)\s*(?:[-:|]\s*)?/i;
  const genericStripped = meta.replace(genericPrefixPattern, "").trim();
  if (genericStripped) meta = genericStripped;

  return meta;
}

function extractYoutubeVideoId(value) {
  if (!value) return "";
  const ytMatch = value.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/))([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) return ytMatch[1];
  const directIdMatch = value.match(/[a-zA-Z0-9_-]{11}/);
  return directIdMatch ? directIdMatch[0] : "";
}

function normalizePreferredSource(value = "") {
  const normalized = `${value || ""}`.trim().toLowerCase();
  return normalized === "youtube" || normalized === "spotify" ? normalized : "";
}

function isBrowserLikeSource(sourceAppId = "") {
  const normalized = `${sourceAppId || ""}`.trim().toLowerCase();
  return normalized.includes("chrome")
    || normalized.includes("edge")
    || normalized.includes("msedge")
    || normalized.includes("firefox")
    || normalized.includes("opera")
    || normalized.includes("browser");
}

function isPreferredApp(sourceAppId = "", preferredSource = "") {
  const normalized = `${sourceAppId || ""}`.trim().toLowerCase();
  const preferred = normalizePreferredSource(preferredSource);

  if (preferred === "spotify") return normalized.includes("spotify") || isBrowserLikeSource(normalized);
  if (preferred === "youtube") {
    return normalized.includes("youtube")
      || normalized.includes("ytmusic")
      || normalized.includes("youtube.music")
      || isBrowserLikeSource(normalized);
  }

  return normalized.includes("spotify")
    || normalized.includes("youtube")
    || normalized.includes("ytmusic")
    || isBrowserLikeSource(normalized)
    || normalized.includes("signalshare")
    || normalized.includes("phone link")
    || normalized.includes("bluetooth");
}

function getPlaybackPriority(status) {
  switch (status) {
    case PlaybackStatus.PLAYING:
      return 4;
    case PlaybackStatus.BUFFERING:
      return 3;
    case PlaybackStatus.PAUSED:
      return 2;
    default:
      return 1;
  }
}

function getSessionSourceText(session) {
  const media = session?.media || {};
  return [
    session?.sourceAppUserModelId,
    session?.sourceAppId,
    session?.appId,
    media.title,
    media.artist,
    media.albumArtist,
    media.albumTitle,
    // Add specific indicators for YouTube to help scoring
    media.title?.toLowerCase().includes("youtube") ? "youtube-source" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifySessionProvider(session) {
  const text = getSessionSourceText(session);
  const sourceAppId = `${session?.sourceAppUserModelId || session?.sourceAppId || ""}`.toLowerCase();

  if (sourceAppId.includes("spotify") || text.includes("open.spotify.com") || text.includes("spotify")) return "spotify";
  if (
    sourceAppId.includes("youtube")
    || sourceAppId.includes("ytmusic")
    || text.includes("youtube")
    || text.includes("youtu.be")
    || text.includes("music.youtube")
  ) return "youtube";

  if (sourceAppId.includes("phone link") || sourceAppId.includes("bluetooth") || text.includes("phone link") || text.includes("bluetooth")) return "phone_link";

  return "";
}

function scoreSession(session, preferredSource = "") {
  const preferred = normalizePreferredSource(preferredSource);
  const sourceAppId = `${session?.sourceAppUserModelId || session?.sourceAppId || ""}`.trim();
  const text = getSessionSourceText(session);
  const provider = classifySessionProvider(session);
  const priority = getPlaybackPriority(session?.playback?.playbackStatus);
  const isBrowser = isBrowserLikeSource(sourceAppId);

  let score = priority * 1000;

  if (preferred) {
    if (provider === preferred) score += 5000;
    if (preferred === "spotify" && sourceAppId.toLowerCase().includes("spotify")) score += 3000;
    if (preferred === "youtube" && /youtube|ytmusic|youtube\.music/i.test(sourceAppId)) score += 3000;

    // Browser tabs do not always expose the URL through SMTC. Give browser sessions a smaller fallback boost
    // for YouTube, but do not let an obvious Spotify session win the YouTube toggle, or vice versa.
    if (preferred === "youtube" && isBrowser && provider !== "spotify") score += 500;
    if (preferred === "spotify" && isBrowser && provider !== "youtube") score += 300;

    if (provider && provider !== preferred) score -= 8000;
  } else if (isPreferredApp(sourceAppId)) {
    score += 500;
  }

  if (text.includes("spotify")) score += 120;
  if (text.includes("youtube") || text.includes("youtu.be")) score += 120;
  if (session?.media?.title && `${session.media.title}`.trim()) score += 80;

  // Penalize sessions with purely numeric titles, which are often track IDs or stale sessions
  if (/^\d{5,}$/.test(session?.media?.title || "")) {
    score -= 2000;
  }

  // Give a small boost to recently updated sessions to help break ties between multiple browser tabs
  const updated = Number(session?.lastUpdatedTime || 0);
  if (Number.isFinite(updated) && updated > 0) {
    // We use a small fraction of the timestamp to prioritize the most recent one without overpowering the status bits
    score += (updated % 1000) / 100;
  }

  return score;
}

function pickBestSession(sessions = [], preferredSource = "") {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  const preferred = normalizePreferredSource(preferredSource);
  
  // 1. Try to find a perfect match first
  const best = sessions.reduce((best, session) => {
    if (!best) return session;
    return scoreSession(session, preferredSource) > scoreSession(best, preferredSource) ? session : best;
  }, null);

  if (best && preferred) {
    const provider = classifySessionProvider(best);
    // If the top-scored session is a DIFFERENT platform, we check if it's playing
    // If it's playing, we might want to return null to show 'Idle' for the requested mode
    // BUT we should still return it if the user wants to 'take over' control.
    if (provider && provider !== preferred) {
       // In media mode specifically, if the best session doesn't match the requested platform 
       // AND it's not currently playing, we return null to avoid showing "old data" from 
       // a different app on the specialized tab.
       if (mapPlaybackState(best.playback?.playbackStatus) !== "playing") return null;
    }
  }

  return best;
}

function logSmtcError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown SMTC error");
  lastSmtcErrorMessage = message;
  const now = Date.now();
  if (now - lastSmtcErrorLoggedAt < SMTC_ERROR_LOG_COOLDOWN_MS) return;
  lastSmtcErrorLoggedAt = now;
  console.warn(`[Bridge] Windows media snapshot unavailable (${message}). Actions can still work; snapshot polling will retry.`);
}

function safeGetMediaSessions() {
  if (!isWindows) return [];
  try {
    const allSessions = SMTCMonitor.getMediaSessions();
    smtcFailureCount = 0;
    lastSmtcErrorMessage = "";
    return Array.isArray(allSessions) ? allSessions.filter(Boolean) : [];
  } catch (error) {
    smtcFailureCount += 1;
    logSmtcError(error);
    return [];
  }
}

function selectPreferredMediaSession(preferredSource = "") {
  return pickBestSession(safeGetMediaSessions(), preferredSource);
}

function resolveMediaAppLabel(sourceAppId = "") {
  if (!sourceAppId) return "";
  const normalized = sourceAppId.toLowerCase();
  
  // If it's a numeric ID (common for some browser PWAs or profiles), don't show it as a label
  if (/^\d+$/.test(sourceAppId.trim())) return "";

  if (normalized.includes("spotify")) return "Spotify";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("phone link") || normalized.includes("bluetooth")) return "Phone Link";
  if (normalized.includes("chrome")) return "Chrome";
  if (normalized.includes("msedge")) return "Edge";
  if (normalized.includes("firefox")) return "Firefox";
  if (normalized.includes("vlc")) return "VLC";
  if (normalized.includes("wmplayer")) return "Windows Media Player";

  const lastDot = sourceAppId.lastIndexOf('.');
  if (lastDot >= 0 && lastDot + 1 < sourceAppId.length) {
    return sourceAppId.substring(lastDot + 1);
  }
  return sourceAppId;
}

function getBaseSnapshot(extra = {}) {
  return {
    source: "windows-smtc",
    available: isWindows,
    active: false,
    permissionRequired: false,
    playbackState: "none",
    title: "",
    meta: "",
    appPackage: "",
    openUri: "",
    artworkUri: "",
    ...extra,
  };
}

function getRecentGoodSnapshotFallback() {
  if (!lastGoodSnapshot) return null;
  if (Date.now() - lastGoodSnapshotAt > LAST_GOOD_SNAPSHOT_MAX_AGE_MS) return null;
  return {
    ...lastGoodSnapshot,
    stale: true,
    staleReason: "Windows SMTC temporarily failed; using the most recent working snapshot.",
  };
}

function buildFreshSnapshotPayload(preferredSource = "") {
  const preferred = normalizePreferredSource(preferredSource);
  const base = getBaseSnapshot({ preferredSource: preferred });

  if (!isWindows) {
    return getBaseSnapshot({
      preferredSource: preferred,
      unavailableReason: "This endpoint is only available on Windows.",
    });
  }

  const session = selectPreferredMediaSession(preferred);
  if (!session) {
    const fallback = getRecentGoodSnapshotFallback();
    if (fallback && (!preferred || fallback.preferredSource === preferred || fallback.sourceProvider === preferred)) return fallback;

    return getBaseSnapshot({
      preferredSource: preferred,
      smtcHealthy: smtcFailureCount === 0,
      smtcFailureCount,
      smtcError: smtcFailureCount > 0 ? lastSmtcErrorMessage : "",
    });
  }

  try {
    const sourceAppId = `${session.sourceAppUserModelId || session.sourceAppId || ""}`.trim();
    const appLabel = resolveMediaAppLabel(sourceAppId);
    const playbackState = mapPlaybackState(session.playback?.playbackStatus);
    const title = `${session.media?.title || ""}`.trim();
    const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
    const sanitizedMeta = sanitizeMediaMeta(artist, sourceAppId);
    const sourceProvider = classifySessionProvider(session) || preferred;

    const meta = (appLabel && sanitizedMeta && appLabel.toLowerCase() !== sanitizedMeta.toLowerCase())
      ? `${appLabel} - ${sanitizedMeta}`
      : (sanitizedMeta || appLabel);

    let artworkUri = "";
    const thumbnail = session.media?.thumbnail;
    if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= MAX_ARTWORK_BYTES) {
      try {
        const mimeType = inferArtworkMimeType(thumbnail);
        if (mimeType) artworkUri = `data:${mimeType};base64,${thumbnail.toString("base64")}`;
      } catch (error) {
        console.warn("[Bridge] Failed to encode artwork:", error instanceof Error ? error.message : error);
      }
    }

    let openUri = "";
    if (sourceProvider === "youtube" || sourceAppId.toLowerCase().includes("youtube") || title.toLowerCase().includes("youtube")) {
      const videoId = extractYoutubeVideoId(title) || extractYoutubeVideoId(session.media?.albumTitle);
      if (videoId) {
        openUri = `https://www.youtube.com/watch?v=${videoId}`;
        if (!artworkUri) artworkUri = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      }
    }

    const payload = {
      ...base,
      active: playbackState !== "none" || Boolean(title),
      playbackState,
      title: title || "Now playing",
      meta,
      appPackage: sourceAppId,
      artworkUri,
      openUri,
      preferredSource: preferred,
      sourceProvider,
      smtcHealthy: true,
      smtcFailureCount: 0,
      smtcError: "",
      stale: Boolean(session.stale),
    };

    lastGoodSnapshot = payload;
    lastGoodSnapshotAt = Date.now();
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown snapshot parse error");
    console.warn(`[Bridge] Failed to build media snapshot from current session (${message}).`);
    const fallback = getRecentGoodSnapshotFallback();
    return fallback || getBaseSnapshot({ preferredSource: preferred, smtcHealthy: false, smtcError: message });
  }
}

function buildSnapshotPayload({ force = false, preferredSource = "" } = {}) {
  const preferred = normalizePreferredSource(preferredSource);
  const now = Date.now();
  if (!force && cachedSnapshotPayload && now - cachedSnapshotAt < SNAPSHOT_CACHE_TTL_MS) {
    if ((cachedSnapshotPayload.preferredSource || "") === preferred) return cachedSnapshotPayload;
  }

  const payload = buildFreshSnapshotPayload(preferred);
  cachedSnapshotPayload = payload;
  cachedSnapshotAt = now;
  return payload;
}

function invalidateSnapshotCache() {
  cachedSnapshotPayload = null;
  cachedSnapshotAt = 0;
}
function sendSystemMediaKey(action, targetAppPackage = "", preferredSource = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !winrtMethodName) return Promise.resolve(false);

  const script = `
$ErrorActionPreference = "Stop"
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
$preferred = [string]$env:SIGNAL_SHARE_PREFERRED_SOURCE
if ($null -eq $targetApp) { $targetApp = "" }
if ($null -eq $preferred) { $preferred = "" }
$targetApp = $targetApp.Trim()
$preferred = $preferred.Trim().ToLowerInvariant()

function Normalize-AppId([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  $normalized = $value.Trim().ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "!.*$", "")
  $normalized = [regex]::Replace($normalized, "\\.[0-9]+$", "")
  $normalized = [regex]::Replace($normalized, "\\.exe$", "")
  return $normalized
}

function Matches-AppId([string]$candidate, [string]$target) {
  $candidateNorm = Normalize-AppId $candidate
  $targetNorm = Normalize-AppId $target
  if ([string]::IsNullOrWhiteSpace($candidateNorm) -or [string]::IsNullOrWhiteSpace($targetNorm)) { return $false }
  return ($candidateNorm -eq $targetNorm) -or ($candidateNorm.StartsWith($targetNorm)) -or ($targetNorm.StartsWith($candidateNorm))
}

function Is-Browser-App([string]$id) {
  $n = Normalize-AppId $id
  return ($n -match "chrome|msedge|edge|firefox|opera|browser")
}

function Get-Session-Text($session) {
  $parts = New-Object System.Collections.Generic.List[string]
  try { if ($session.SourceAppUserModelId) { $parts.Add($session.SourceAppUserModelId) } } catch {}
  try {
    $mediaOp = $session.TryGetMediaPropertiesAsync()
    $media = $mediaOp.GetResults()
    if ($media.Title) { $parts.Add($media.Title) }
    if ($media.Artist) { $parts.Add($media.Artist) }
    if ($media.AlbumArtist) { $parts.Add($media.AlbumArtist) }
    if ($media.AlbumTitle) { $parts.Add($media.AlbumTitle) }
  } catch {}
  return ([string]::Join(" ", $parts)).ToLowerInvariant()
}

function Is-Match-Source($session, [string]$source) {
  if ([string]::IsNullOrWhiteSpace($source) -or $source -eq "all") { return $true }
  $id = ""
  try { $id = Normalize-AppId $session.SourceAppUserModelId } catch {}
  $text = Get-Session-Text $session
  $isBrowser = Is-Browser-App $id

  if ($source -eq "spotify") {
    if ($id -match "youtube|ytmusic" -or $text -match "youtube|youtu\\.be|music\\.youtube") { return $false }
    if ($id -match "spotify" -or $text -match "spotify|open\\.spotify") { return $true }
    return $isBrowser
  }

  if ($source -eq "youtube") {
    if ($id -match "spotify" -or $text -match "spotify|open\\.spotify") { return $false }
    if ($id -match "youtube|ytmusic" -or $text -match "youtube|youtu\\.be|music\\.youtube") { return $true }
    # Browser YouTube tabs often only expose the video title. Permit browser sessions as a YouTube fallback.
    return $isBrowser
  }

  return $true
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.ToString() -eq 'System.Threading.Tasks.Task\ 1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation\ 1[TResult])'
  } | Select-Object -First 1

  $id = ""
  $winRtSuccess = $false
  
  if ($asTaskMethod -ne $null) {
    $managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $managerTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])).Invoke($null, @($managerOp))
    $manager = $managerTask.Result
    $session = $null

    if ($manager -ne $null) {
      $sessions = $manager.GetSessions()

      if ($sessions.Count -gt 0) {
        $bestScore = -1
        foreach ($candidate in $sessions) {
          if ($null -eq $candidate) { continue }
          try {
            $score = 0
            $isTarget = [string]::IsNullOrWhiteSpace($targetApp) -or (Matches-AppId $candidate.SourceAppUserModelId $targetApp)
            $isPreferred = [string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all" -or (Is-Match-Source $candidate $preferred)
            
            if ($isTarget -and $isPreferred) { $score += 1000 }
            elseif ($isTarget) { $score += 500 }
            elseif ($isPreferred) { $score += 300 }

            if ($candidate.PlaybackInfo.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
              $score += 5000
            }

            if ($score -gt $bestScore) {
              $bestScore = $score
              $session = $candidate
            }
          } catch {}
        }
      }

      if ($session -eq $null) {
        $session = $manager.GetCurrentSession()
      }
    }

      if ($session -ne $null) {
        try { $id = $session.SourceAppUserModelId } catch { $id = "" }
        $actionMethod = $session.GetType().GetMethod('${winrtMethodName}', [Type[]]@())
        if ($actionMethod -ne $null) {
          try {
            $actionOp = $actionMethod.Invoke($session, @())
            $resultTask = $asTaskMethod.MakeGenericMethod(@([bool])).Invoke($null, @($actionOp))
            $winRtSuccess = [bool]$resultTask.Result
          } catch {
            $winRtSuccess = $false
          }
        }
      }
    }
  }
} catch {
  $winRtSuccess = $false
}

# Skip actions need aggressive fallback because WinRT can report success while browsers ignore the command.
$isSkipAction = "${action}" -eq "next" -or "${action}" -eq "previous"

if ($winRtSuccess -and -not $isSkipAction) {
  Write-Output "ok"
  exit 0
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MediaKeySender {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

# Fallback to global media keys if WinRT targeting failed or if it's a skip action.
# For skip actions, we prioritize the global key because it's more reliable for browser-based YouTube.
if ([string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all" -or $winRtSuccess -eq $false -or $isSkipAction) {
  $KEYEVENTF_EXTENDEDKEY = 0x0001
  $KEYEVENTF_KEYUP = 0x0002

  # Send global media key
  [MediaKeySender]::keybd_event(${vkCode}, 0, $KEYEVENTF_EXTENDEDKEY, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 45
  [MediaKeySender]::keybd_event(${vkCode}, 0, ($KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP), [UIntPtr]::Zero)

  # For Skip actions on YouTube, also try sending browser-specific shortcuts if a browser is focused or if preferred is youtube
  $isBrowserId = ($null -ne $id -and $id -match "chrome|msedge|firefox")
  if ($isSkipAction -and ($preferred -eq "youtube" -or $isBrowserId)) {
    try {
      $wshell = New-Object -ComObject WScript.Shell
      if ("${action}" -eq "next") {
        $wshell.SendKeys("+(N)") # Shift + N
      } else {
        $wshell.SendKeys("+(P)") # Shift + P
      }
    } catch {}
  }

  Write-Output "ok-global"
  exit 0
}

Write-Output "fail-source-not-active"
exit 0
  `.trim().replace(/\u007f/g, '`');

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: {
        ...process.env,
        SIGNAL_SHARE_TARGET_APP: targetAppPackage,
        SIGNAL_SHARE_PREFERRED_SOURCE: normalizePreferredSource(preferredSource),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      resolve(code === 0 && !stderr.trim() && stdout.trim().toLowerCase().includes("ok"));
    });
  });
}

app.get("/api/system-media/current", (req, res) => {
  try {
    const preferredSource = normalizePreferredSource(req.query.source || "");
    const force = req.query.force === "true";
    res.json(buildSnapshotPayload({ preferredSource, force }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown bridge error");
    console.warn("[Bridge] Snapshot request failed safely:", message);
    res.json(getBaseSnapshot({ smtcHealthy: false, smtcError: message }));
  }
});

app.post("/api/system-media/action", (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  const preferredSource = normalizePreferredSource(req.body?.preferredSource || req.query.source || "");

  if (action === "open_uri") {
    if (!ALLOW_OPEN_URI) {
      return res.status(403).json({ ok: false, error: "open_uri is disabled for security." });
    }
    const uri = `${req.body?.uri || ""}`.trim();
    if (!uri) return res.status(400).json({ ok: false });
    
    // Improved PowerShell launcher with fallbacks for Phone Link
    const psCommand = `
      $uri = "${uri.replace(/"/g, '`"')}"
      if ($uri -eq "mobilephonelink:" -or $uri -eq "ms-phone:") {
        try { Start-Process "ms-phone:" -ErrorAction Stop } catch {
          try { Start-Process "yourphone:" -ErrorAction Stop } catch {
            try { explorer.exe shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App } catch {
              Start-Process "https://www.microsoft.com/store/productId/9NMP3S0RLH54"
            }
          }
        }
      } else {
        Start-Process $uri
      }
    `.trim();

    spawn("powershell.exe", ["-NoProfile", "-Command", psCommand], { windowsHide: true });
    return res.json({ ok: true, queued: true });
  }

  if (!MEDIA_KEY_CODES[action]) return res.status(400).json({ ok: false });

  const actionKey = `${preferredSource || "all"}|${action}|${appPackage}`;
  const now = Date.now();
  const lastActionAt = lastMediaActionAtByKey.get(actionKey) || 0;
  if (now - lastActionAt < MEDIA_ACTION_COOLDOWN_MS) {
    return res.json({ ok: true, queued: false, skipped: true, reason: "duplicate-action-cooldown" });
  }
  lastMediaActionAtByKey.set(actionKey, now);

  invalidateSnapshotCache();
  res.json({ ok: true, queued: true });

  void sendSystemMediaKey(action, appPackage, preferredSource)
    .then(() => {
      invalidateSnapshotCache();
      setTimeout(() => {
        try {
          buildSnapshotPayload({ force: true, preferredSource });
          void syncToSupabase();
        } catch (_error) { }
      }, 180);
    })
    .catch(() => {
      invalidateSnapshotCache();
    });
});

app.get("/security", (req, res) => { res.sendFile(path.join(projectRoot, "security.html")); });
app.get("/security.html", (req, res) => { res.sendFile(path.join(projectRoot, "security.html")); });
app.get("/", (req, res) => { res.sendFile(path.join(projectRoot, "index.html")); });

async function syncToSupabase() {
  if (!enableRemoteMediaSync || !isWindows || !userId || !supabase) return;
  try {
    const payload = buildSnapshotPayload();
    const syncKey = [
      payload.playbackState,
      payload.title,
      payload.meta,
      payload.artworkUri ? "art" : "no-art",
      payload.openUri,
      payload.appPackage,
      payload.smtcHealthy === false ? "smtc-error" : "smtc-ok",
    ].join("|");

    if (syncKey === lastSupabaseSyncKey) return;

    const { error } = await supabase.from("system_media").upsert({
      user_id: userId,
      playback_state: payload.playbackState,
      title: payload.title,
      meta: payload.meta,
      artwork_uri: payload.artworkUri,
      open_uri: payload.openUri,
      app_package: payload.appPackage,
      device_name: "Desktop PC",
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Bridge] Supabase sync error:", error.message);
      return;
    }

    lastSupabaseSyncKey = syncKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown sync error");
    console.warn("[Bridge] Supabase sync skipped:", message);
  }
}

function subscribeToMediaActions() {
  if (!enableRemoteMediaSync || !isWindows || !userId) return;
  console.log(`[Bridge] Subscribing to actions for ${userId}...`);
  supabase.channel('media_actions').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'system_media_actions', filter: `user_id=eq.${userId}`
  }, async (payload) => {
    const { action, app_package, uri } = payload.new;
    console.log(`[Bridge] Remote action: ${action}`);
    if (action === "open_uri") {
      if (uri) {
        spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
      }
    } else {
      await sendSystemMediaKey(action, app_package, payload.new?.payload?.preferredSource || "");
    }
    await syncToSupabase();
  }).subscribe();
}

app.listen(port, "127.0.0.1", () => {
  console.log(`[Bridge] Server on http://localhost:${port}`);
  if (isWindows && enableRemoteMediaSync && userId) {
    console.log(`[Bridge] Remote media sync enabled for ${userId}.`);
    setInterval(syncToSupabase, SUPABASE_SYNC_INTERVAL_MS);
    subscribeToMediaActions();
    syncToSupabase();
  } else if (isWindows && !enableRemoteMediaSync) {
    console.log("[Bridge] Remote Supabase media sync disabled. Local controls stay faster. Set SIGNAL_SHARE_ENABLE_REMOTE_MEDIA=true to sync with the live site.");
  } else if (!userId) {
    console.warn("[Bridge] No User ID found in .env. Local bridge controls still work.");
  }
});
