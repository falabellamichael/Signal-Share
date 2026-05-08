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
const MAX_ARTWORK_BYTES = 500000;

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestedHeaders = req.headers["access-control-request-headers"];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", requestedHeaders || "Content-Type, target-address-space");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
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

function isPreferredApp(sourceAppId = "") {
  const normalized = `${sourceAppId || ""}`.trim().toLowerCase();
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
  if (isPreferredApp(sourceAppId)) {
    score += 400;
  }

  if (session.media?.title && session.media?.title.trim()) {
    score += 100;
  }

  const updated = Number(session.lastUpdatedTime || 0);
  score += (updated % 10000); // Small boost for recent updates

  return score;
}

function pickBestSession(sessions = []) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  return sessions.reduce((best, session) => {
    if (!best) return session;
    return scoreSession(session) > scoreSession(best) ? session : best;
  }, null);
}

function selectPreferredMediaSession() {
  const allSessions = SMTCMonitor.getMediaSessions();
  const sessions = Array.isArray(allSessions) ? allSessions : [];
  return pickBestSession(sessions);
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

function buildSnapshotPayload() {
  const base = {
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
  };


  if (!isWindows) {
    return {
      ...base,
      unavailableReason: "This endpoint is only available on Windows.",
    };
  }

  try {
    const session = selectPreferredMediaSession();
    if (!session) return base;

    const sourceAppId = `${session.sourceAppUserModelId || session.sourceAppId || ""}`.trim();
    const appLabel = resolveMediaAppLabel(sourceAppId);
    const playbackState = mapPlaybackState(session.playback?.playbackStatus);
    const title = `${session.media?.title || ""}`.trim();
    const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
    const sanitizedMeta = sanitizeMediaMeta(artist, sourceAppId);

    // Android-like meta construction: App Name - Artist
    const meta = (appLabel && sanitizedMeta && appLabel.toLowerCase() !== sanitizedMeta.toLowerCase())
      ? `${appLabel} - ${sanitizedMeta}`
      : (sanitizedMeta || appLabel);

    let artworkUri = "";
    const thumbnail = session.media?.thumbnail;
    if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= MAX_ARTWORK_BYTES) {
      try {
        const mimeType = inferArtworkMimeType(thumbnail);
        if (mimeType) {
          artworkUri = `data:${mimeType};base64,${thumbnail.toString("base64")}`;
        }
      } catch (e) {
        console.warn("[Bridge] Failed to encode artwork:", e.message);
      }
    }

    let openUri = "";
    // Snapshot "Healing" for YouTube (like Android MainActivity/PhoneNowPlayingHelper)
    if (sourceAppId.toLowerCase().includes("youtube") || title.toLowerCase().includes("youtube")) {
      const videoId = extractYoutubeVideoId(title) || extractYoutubeVideoId(session.media?.albumTitle);
      if (videoId) {
        openUri = `https://www.youtube.com/watch?v=${videoId}`;
        if (!artworkUri) {
          artworkUri = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }
      }
    }

    return {
      ...base,
      active: playbackState !== "none",
      playbackState,
      title: title || "Now playing",
      meta,
      appPackage: sourceAppId,
      artworkUri,
      openUri,
    };
  } catch (error) {
    console.error("[Bridge] Critical error in buildSnapshotPayload:", error);
    return base;
  }
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

# Fallback: Single-method key event to avoid double-triggering
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MediaKeySender {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[MediaKeySender]::keybd_event(${vkCode}, 0, 0x0001, [UIntPtr]::Zero)
[MediaKeySender]::keybd_event(${vkCode}, 0, (0x0001 -bor 0x0002), [UIntPtr]::Zero)
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

app.get("/api/system-media/current", (req, res) => {
  try {
    res.json(buildSnapshotPayload());
  } catch (error) {
    console.error("[Bridge] Error fetching current media session:", error);
    res.status(500).json({ 
      source: "windows-smtc", 
      available: isWindows, 
      active: false, 
      playbackState: "none",
      error: error.message 
    });
  }
});

app.post("/api/system-media/action", async (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  if (action === "open_uri") {
    const uri = `${req.body?.uri || ""}`.trim();
    if (!uri) return res.status(400).json({ ok: false });
    // Use PowerShell to start the URI
    spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
    return res.json({ ok: true });
  }
  if (!MEDIA_KEY_CODES[action]) return res.status(400).json({ ok: false });
  const ok = await sendSystemMediaKey(action, appPackage);
  res.json({ ok });
});

app.get("/", (req, res) => { res.sendFile(path.join(projectRoot, "index.html")); });

async function syncToSupabase() {
  if (!isWindows || !userId) return;
  try {
    const payload = buildSnapshotPayload();
    const { error } = await supabase.from("system_media").upsert({
      user_id: userId,
      playback_state: payload.playbackState,
      title: payload.title,
      meta: payload.meta,
      artwork_uri: payload.artworkUri,
      open_uri: payload.openUri,
      app_package: payload.appPackage,
      device_name: payload.deviceName || "Desktop PC",
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("Sync error:", error.message);
  } catch (err) { console.error("Sync crash:", err); }
}

let isPerformingAction = false;
function subscribeToMediaActions() {
  if (!isWindows || !userId) return;
  console.log(`[Bridge] Subscribing to actions for ${userId}...`);
  supabase.channel('media_actions').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'system_media_actions', filter: `user_id=eq.${userId}`
  }, async (payload) => {
    if (isPerformingAction) return;
    isPerformingAction = true;
    try {
      const { action, app_package, uri } = payload.new;
      console.log(`[Bridge] Remote action: ${action}`);
      if (action === "open_uri") {
        if (uri) {
          spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
        }
      } else {
        await sendSystemMediaKey(action, app_package);
      }
      
      // Cleanup: Delete old actions for this user to keep the table clean
      supabase.from("system_media_actions")
        .delete()
        .eq("user_id", userId)
        .lt("created_at", new Date(Date.now() - 60000).toISOString())
        .then(() => {});

      // Delay sync slightly to allow the OS to update the media state
      setTimeout(syncToSupabase, 800);
    } finally {
      setTimeout(() => { isPerformingAction = false; }, 500);
    }
  }).subscribe();
}

app.listen(port, "0.0.0.0", () => {
  console.log(`[Bridge] Server on http://localhost:${port}`);
  if (isWindows && userId) {
    console.log(`[Bridge] User verified: ${userId}`);
    setInterval(syncToSupabase, 2000);
    subscribeToMediaActions();
    syncToSupabase();
  } else if (!userId) {
    console.error("[Bridge] ERROR: No User ID found in .env");
  }
});
