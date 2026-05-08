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
const MAX_ARTWORK_BYTES = Number(process.env.SIGNAL_SHARE_MAX_ARTWORK_BYTES || 160000);
const SMTC_ERROR_LOG_COOLDOWN_MS = 30000;
const LAST_GOOD_SNAPSHOT_MAX_AGE_MS = 15000;
const SNAPSHOT_CACHE_TTL_MS = Number(process.env.SIGNAL_SHARE_SNAPSHOT_CACHE_TTL_MS || 3500);
const SUPABASE_SYNC_INTERVAL_MS = Number(process.env.SIGNAL_SHARE_SYNC_INTERVAL_MS || 5000);
const enableRemoteMediaSync = process.env.SIGNAL_SHARE_ENABLE_REMOTE_MEDIA === "true" || process.env.SIGNAL_SHARE_REMOTE_MEDIA === "true";
const ALLOW_OPEN_URI = process.env.SIGNAL_SHARE_ALLOW_OPEN_URI === "true";
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const MEDIA_ACTION_COOLDOWN_MS = 900;
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
  console.log(`[Bridge] ${req.method} ${req.path} from ${req.headers.origin || 'unknown origin'}`);
  
  const origin = req.headers.origin;
  const isWhitelisted = origin && CORS_WHITELIST.some(allowed => origin.startsWith(allowed));
  const isLocalhost = !origin || origin.includes("localhost") || origin.includes("127.0.0.1");

  if (isWhitelisted || isLocalhost) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Bridge-Secret, x-bridge-secret, target-address-space, access-control-allow-private-network");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin, Access-Control-Request-Headers");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  // Secret Token Validation
  if (BRIDGE_SECRET && req.path.startsWith("/api/system-media")) {
    const providedSecret = (req.headers['x-bridge-secret'] || '').trim();
    if (providedSecret !== BRIDGE_SECRET.trim()) {
      console.warn(`[Security] Unauthorized access attempt: Secret mismatch`);
      return res.status(403).json({ error: "Unauthorized: Invalid Bridge Secret" });
    }
  }

  // Simple Rate Limiting for Actions
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

  const genericPrefixPattern = /^(?:spotify[a-z0-9._!-]*|operasoftware\.[a-z0-9._!-]*|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?)\s*(?:[-:|]\s*)?/i;
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

function isPreferredApp(sourceAppId = "", preferredSource = "") {
  const normalized = `${sourceAppId || ""}`.trim().toLowerCase();
  
  if (preferredSource === "youtube") {
    return normalized.includes("youtube") 
      || normalized.includes("ytmusic") 
      || normalized.includes("youtube.music")
      || normalized.includes("chrome") 
      || normalized.includes("edge")
      || normalized.includes("browser");
  }
  if (preferredSource === "spotify") {
    return normalized.includes("spotify");
  }

  return normalized.includes("spotify") 
    || normalized.includes("youtube") 
    || normalized.includes("ytmusic") 
    || normalized.includes("chrome") 
    || normalized.includes("edge") 
    || normalized.includes("signalshare");
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

function scoreSession(session) {
  let score = 0;
  const status = session.playback?.playbackStatus;
  const priority = getPlaybackPriority(status);
  score += priority * 100;
  
  const sourceAppId = `${session.sourceAppUserModelId || session.sourceAppId || ""}`.trim();
  const title = `${session.media?.title || ""}`.trim().toLowerCase();
  const album = `${session.media?.albumTitle || ""}`.trim().toLowerCase();
  const preferredSource = session._preferredSource;

  let sourceMatched = isPreferredApp(sourceAppId, preferredSource);
  
  // Secondary check: if the app is a browser but the title/album mentions the source
  if (!sourceMatched && preferredSource) {
    const appLabel = resolveMediaAppLabel(sourceAppId).toLowerCase();
    const isBrowser = appLabel.includes("chrome") || appLabel.includes("edge") || appLabel.includes("firefox") || appLabel.includes("browser");
    if (isBrowser) {
      if (preferredSource === "youtube" && (title.includes("youtube") || album.includes("youtube"))) {
        sourceMatched = true;
      } else if (preferredSource === "spotify" && (title.includes("spotify") || album.includes("spotify"))) {
        sourceMatched = true;
      }
    }
  }

  if (sourceMatched) {
    score += 1000; // Massive boost for user-selected toggle source
  }

  if (session.media?.title && session.media?.title.trim()) {
    score += 100;
  }

  const updated = Number(session.lastUpdatedTime || 0);
  score += (updated % 10000); // Small boost for recent updates

  return score;
}

function pickBestSession(sessions = [], preferredSource = "") {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  return sessions.reduce((best, session) => {
    session._preferredSource = preferredSource;
    if (!best) return session;
    return scoreSession(session) > scoreSession(best) ? session : best;
  }, null);
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
    const sessions = Array.isArray(allSessions) ? allSessions.filter(Boolean) : [];
    
    if (sessions.length > 0) {
      console.log(`[Bridge] Found ${sessions.length} media sessions:`);
      sessions.forEach((s, i) => {
        console.log(`  [${i}] App: ${s.sourceAppUserModelId || s.sourceAppId}, Title: ${s.media?.title}, Status: ${s.playback?.playbackStatus}`);
      });
    }

    return sessions;
  } catch (error) {
    smtcFailureCount += 1;
    logSmtcError(error);
    return [];
  }
}

function selectPreferredMediaSession(preferredSource = "") {
  const sessions = safeGetMediaSessions();
  return pickBestSession(sessions, preferredSource);
}

function resolveMediaAppLabel(sourceAppId = "") {
  if (!sourceAppId) return "";
  const normalized = sourceAppId.toLowerCase();
  if (normalized.includes("spotify")) return "Spotify";
  if (normalized.includes("youtube")) return "YouTube";
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
  const base = getBaseSnapshot();

  if (!isWindows) {
    return getBaseSnapshot({
      unavailableReason: "This endpoint is only available on Windows.",
    });
  }

  const session = selectPreferredMediaSession(preferredSource);
  if (!session) {
    const fallback = getRecentGoodSnapshotFallback();
    if (fallback) return fallback;

    return getBaseSnapshot({
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
    if (sourceAppId.toLowerCase().includes("youtube") || title.toLowerCase().includes("youtube")) {
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
      smtcHealthy: true,
      smtcFailureCount: 0,
      smtcError: "",
    };

    lastGoodSnapshot = payload;
    lastGoodSnapshotAt = Date.now();
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown snapshot parse error");
    console.warn(`[Bridge] Failed to build media snapshot from current session (${message}).`);
    const fallback = getRecentGoodSnapshotFallback();
    return fallback || getBaseSnapshot({ smtcHealthy: false, smtcError: message });
  }
}


function buildSnapshotPayload({ force = false, preferredSource = "" } = {}) {
  const now = Date.now();
  if (!force && cachedSnapshotPayload && now - cachedSnapshotAt < SNAPSHOT_CACHE_TTL_MS) {
    // If the preferred source changed, we must invalidate cache
    if (cachedSnapshotPayload._preferredSource === preferredSource) {
      return cachedSnapshotPayload;
    }
  }

  const payload = buildFreshSnapshotPayload(preferredSource);
  payload._preferredSource = preferredSource;
  cachedSnapshotPayload = payload;
  cachedSnapshotAt = now;
  return payload;
}

function invalidateSnapshotCache() {
  cachedSnapshotPayload = null;
  cachedSnapshotAt = 0;
}
function sendSystemMediaKey(action, targetAppPackage = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const appCommand = APP_COMMAND_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !appCommand || !winrtMethodName) return Promise.resolve(false);

  const script = `
$ErrorActionPreference = "Stop"
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
if ($null -eq $targetApp) { $targetApp = "" }
$targetApp = $targetApp.Trim()

function Normalize-AppId([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  $normalized = $value.Trim().ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "!.*$", "")
  $normalized = [regex]::Replace($normalized, "\\.[0-9]+$", "")
  return $normalized
}

function Matches-AppId([string]$candidate, [string]$target) {
  $candidateNorm = Normalize-AppId $candidate
  $targetNorm = Normalize-AppId $target
  if ([string]::IsNullOrWhiteSpace($candidateNorm) -or [string]::IsNullOrWhiteSpace($targetNorm)) { return $false }
  if ($candidateNorm -eq $targetNorm) { return $true }
  if ($candidateNorm.StartsWith($targetNorm)) { return $true }
  if ($targetNorm.StartsWith($candidateNorm)) { return $true }
  return $false
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.ToString() -eq 'System.Threading.Tasks.Task\\\`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation\\\`1[TResult])'
  } | Select-Object -First 1

  if ($asTaskMethod -ne $null) {
    $managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $managerTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])).Invoke($null, @($managerOp))
    $manager = $managerTask.Result
    $session = $null

    if ($manager -ne $null -and -not [string]::IsNullOrWhiteSpace($targetApp)) {
      try {
        foreach ($candidate in $manager.GetSessions()) {
          if ($null -eq $candidate) { continue }
          if (Matches-AppId $candidate.SourceAppUserModelId $targetApp) {
            $session = $candidate
            break
          }
        }
      } catch {}
    }

    if ($session -eq $null -and $manager -ne $null) {
      $session = $manager.GetCurrentSession()
    }

    if ($session -ne $null) {
      $actionMethod = $session.GetType().GetMethod('${winrtMethodName}', [Type[]]@())
      if ($actionMethod -ne $null) {
        $actionOp = $actionMethod.Invoke($session, @())
        $resultTask = $asTaskMethod.MakeGenericMethod(@([bool])).Invoke($null, @($actionOp))
        $winRtSuccess = [bool]$resultTask.Result
      }
    }
  }
} catch {}

if ($winRtSuccess) {
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

$KEYEVENTF_EXTENDEDKEY = 0x0001
$KEYEVENTF_KEYUP = 0x0002

# Send exactly one media-key event. Do not also broadcast WM_APPCOMMAND,
# because Chrome/YouTube/Spotify may receive both and toggle twice.
[MediaKeySender]::keybd_event(${vkCode}, 0, $KEYEVENTF_EXTENDEDKEY, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 45
[MediaKeySender]::keybd_event(${vkCode}, 0, ($KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP), [UIntPtr]::Zero)
Write-Output "ok"
  `.trim();

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, SIGNAL_SHARE_TARGET_APP: targetAppPackage },
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

  try {
    const preferredSource = `${req.query.source || ""}`.toLowerCase();
    res.json(buildSnapshotPayload({ preferredSource }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown bridge error");
    console.warn("[Bridge] Snapshot request failed safely:", message);
    res.json(getBaseSnapshot({ smtcHealthy: false, smtcError: message }));
  }
});

app.post("/api/system-media/action", async (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  if (action === "open_uri") {
    if (!ALLOW_OPEN_URI) {
      return res.status(403).json({ ok: false, error: "open_uri is disabled for security." });
    }
    const uri = `${req.body?.uri || ""}`.trim();
    if (!uri) return res.status(400).json({ ok: false });
    // Use PowerShell to start the URI
    spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
    return res.json({ ok: true });
  }
  if (!MEDIA_KEY_CODES[action]) return res.status(400).json({ ok: false });

  const actionKey = `${action}|${appPackage}`;
  const now = Date.now();
  const lastActionAt = lastMediaActionAtByKey.get(actionKey) || 0;
  if (now - lastActionAt < MEDIA_ACTION_COOLDOWN_MS) {
    return res.json({ ok: true, skipped: true, reason: "duplicate-action-cooldown" });
  }
  lastMediaActionAtByKey.set(actionKey, now);

  const ok = await sendSystemMediaKey(action, appPackage);
  invalidateSnapshotCache();
  res.json({ ok });

  // Let Windows update the media session, then refresh the cache without blocking the browser response.
  setTimeout(() => {
    try {
      buildSnapshotPayload({ force: true });
      void syncToSupabase();
    } catch (_error) {}
  }, 450);
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
      await sendSystemMediaKey(action, app_package);
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
