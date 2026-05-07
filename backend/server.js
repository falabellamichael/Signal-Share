import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SMTCMonitor, PlaybackStatus } from "@coooookies/windows-smtc-monitor";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const isWindows = process.platform === "win32";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const MEDIA_KEY_CODES = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
};
const APP_COMMAND_CODES = {
  play_pause: 14, // APPCOMMAND_MEDIA_PLAY_PAUSE
  next: 11, // APPCOMMAND_MEDIA_NEXTTRACK
  previous: 12, // APPCOMMAND_MEDIA_PREVIOUSTRACK
};
const WINRT_ACTION_METHODS = {
  play_pause: "TryTogglePlayPauseAsync",
  next: "TrySkipNextAsync",
  previous: "TrySkipPreviousAsync",
};
const MAX_ARTWORK_BYTES = 1200000;

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);
const userId = process.env.SIGNAL_SHARE_USER_ID;

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestedHeaders = typeof req.headers["access-control-request-headers"] === "string"
    ? req.headers["access-control-request-headers"].trim()
    : "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", requestedHeaders || "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") {
    res.status(204).end();
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

function getPlaybackPriority(playbackStatus) {
  switch (playbackStatus) {
    case PlaybackStatus.PLAYING:
      return 4;
    case PlaybackStatus.PAUSED:
      return 3;
    case PlaybackStatus.OPENED:
    case PlaybackStatus.CHANGING:
      return 2;
    case PlaybackStatus.STOPPED:
    case PlaybackStatus.CLOSED:
    default:
      return 1;
  }
}

function pickBestSession(sessions = []) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  return sessions.reduce((best, session) => {
    if (!best) return session;
    const bestPriority = getPlaybackPriority(best.playback?.playbackStatus);
    const sessionPriority = getPlaybackPriority(session.playback?.playbackStatus);
    if (sessionPriority !== bestPriority) return sessionPriority > bestPriority ? session : best;

    const bestUpdated = Number(best.lastUpdatedTime || 0);
    const sessionUpdated = Number(session.lastUpdatedTime || 0);
    if (sessionUpdated !== bestUpdated) return sessionUpdated > bestUpdated ? session : best;

    const bestHasTitle = Boolean(`${best.media?.title || ""}`.trim());
    const sessionHasTitle = Boolean(`${session.media?.title || ""}`.trim());
    if (sessionHasTitle !== bestHasTitle) return sessionHasTitle ? session : best;

    return best;
  }, null);
}

function selectPreferredMediaSession() {
  const allSessions = SMTCMonitor.getMediaSessions();
  const sessions = Array.isArray(allSessions) ? allSessions : [];
  const withPlayback = sessions.filter((session) => mapPlaybackState(session.playback?.playbackStatus) !== "none");
  const current = SMTCMonitor.getCurrentMediaSession();
  const currentState = mapPlaybackState(current?.playback?.playbackStatus);
  const currentHasMetadata = Boolean(
    `${current?.media?.title || ""}`.trim()
    || `${current?.media?.artist || current?.media?.albumArtist || ""}`.trim()
  );

  const activelyPlaying = withPlayback.filter(
    (session) => mapPlaybackState(session.playback?.playbackStatus) === "playing"
  );

  // Always prioritize sessions that are actively playing. This enables clean
  // handoff: paused Spotify -> playing YouTube, and paused YouTube -> playing Spotify.
  const bestPlayingSession = pickBestSession(activelyPlaying);
  if (bestPlayingSession) return bestPlayingSession;

  if (current && currentState !== "none" && currentHasMetadata) return current;

  // Prefer Spotify as a fallback only when nothing is actively playing.
  const spotifyFallback = pickBestSession(
    withPlayback.filter((session) => `${session?.sourceAppId || ""}`.toLowerCase().includes("spotify"))
  );
  if (spotifyFallback) return spotifyFallback;

  const activeSession = pickBestSession(withPlayback);
  if (activeSession) return activeSession;

  if (current) return current;

  return pickBestSession(sessions);
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

  const session = selectPreferredMediaSession();
  if (!session) return base;

  const sourceAppId = `${session.sourceAppId || ""}`.trim();
  const playbackState = mapPlaybackState(session.playback?.playbackStatus);
  const title = `${session.media?.title || ""}`.trim();
  const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
  const meta = sanitizeMediaMeta(artist, sourceAppId);

  let artworkUri = "";
  const thumbnail = session.media?.thumbnail;
  if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= MAX_ARTWORK_BYTES) {
    const mimeType = inferArtworkMimeType(thumbnail);
    if (mimeType) {
      artworkUri = `data:${mimeType};base64,${thumbnail.toString("base64")}`;
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
  };
}

function sendSystemMediaKey(action, targetAppPackage = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const appCommand = APP_COMMAND_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !appCommand || !winrtMethodName) return Promise.resolve(false);

  const script = `
$ErrorActionPreference = "Stop"

# Prefer direct SMTC control first. This is more reliable for apps like Spotify/Opera.
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
if ($null -eq $targetApp) { $targetApp = "" }
$targetApp = $targetApp.Trim()

function Normalize-AppId([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  $normalized = $value.Trim().ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "!.*$", "")
  $normalized = [regex]::Replace($normalized, "\.[0-9]+$", "")
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
    $_.ToString() -eq 'System.Threading.Tasks.Task\`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation\`1[TResult])'
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
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    uint Msg,
    IntPtr wParam,
    IntPtr lParam,
    uint fuFlags,
    uint uTimeout,
    out UIntPtr lpdwResult
  );
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$WM_APPCOMMAND = 0x0319
$SMTO_ABORTIFHUNG = 0x0002
$HWND_BROADCAST = [IntPtr]0xffff
$KEYEVENTF_EXTENDEDKEY = 0x0001
$KEYEVENTF_KEYUP = 0x0002
$result = [UIntPtr]::Zero
$lParam = [IntPtr](${appCommand} -shl 16)

# 1) Broadcast app command (works better for some Chromium-based browsers).
[void][MediaKeySender]::SendMessageTimeout($HWND_BROADCAST, $WM_APPCOMMAND, [IntPtr]::Zero, $lParam, $SMTO_ABORTIFHUNG, 180, [ref]$result)

# 2) Send app command to foreground window as an additional targeted attempt.
$foreground = [MediaKeySender]::GetForegroundWindow()
if ($foreground -ne [IntPtr]::Zero) {
  [void][MediaKeySender]::SendMessageTimeout($foreground, $WM_APPCOMMAND, $foreground, $lParam, $SMTO_ABORTIFHUNG, 180, [ref]$result)
}

# 3) Legacy media key event fallback.
[MediaKeySender]::keybd_event(${vkCode}, 0, $KEYEVENTF_EXTENDEDKEY, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[MediaKeySender]::keybd_event(${vkCode}, 0, ($KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP), [UIntPtr]::Zero)
Write-Output "ok"
  `.trim();

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
        env: {
          ...process.env,
          SIGNAL_SHARE_TARGET_APP: targetAppPackage,
        },
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      if (code !== 0 || stderr.trim()) {
        resolve(false);
        return;
      }
      resolve(stdout.trim().toLowerCase().includes("ok"));
    });
  });
}

app.get("/api/system-media/current", (req, res) => {
  try {
    const payload = buildSnapshotPayload();
    res.json(payload);
  } catch (error) {
    res.status(500).json({
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
      error: error instanceof Error ? error.message : "Unexpected system media error.",
    });
  }
});

app.post("/api/system-media/action", async (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  if (!Object.prototype.hasOwnProperty.call(MEDIA_KEY_CODES, action)) {
    res.status(400).json({ ok: false, error: "Invalid action. Use play_pause, next, or previous." });
    return;
  }
  if (!isWindows) {
    res.status(400).json({ ok: false, error: "System media actions are only available on Windows." });
    return;
  }

  const ok = await sendSystemMediaKey(action, appPackage);
  res.json({ ok });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(projectRoot, "index.html"));
});

async function syncToSupabase() {
  if (!isWindows || !userId) return;
  try {
    const payload = buildSnapshotPayload();
    const { error } = await supabase
      .from("system_media")
      .upsert({
        user_id: userId,
        playback_state: payload.playbackState,
        title: payload.title,
        meta: payload.meta,
        artwork_uri: payload.artworkUri,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error("Error syncing to Supabase:", error.message);
    }
  } catch (error) {
    console.error("Unexpected error in Supabase sync:", error);
  }
}

function subscribeToMediaActions() {
  if (!isWindows || !userId) return;
  console.log(`[Supabase] Subscribing to media actions for user ${userId}...`);
  
  supabase
    .channel('media_actions')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'system_media_actions',
      filter: `user_id=eq.${userId}`
    }, async (payload) => {
      const { action, app_package } = payload.new;
      console.log(`[Supabase] Remote action received: ${action} (${app_package || 'unknown app'})`);
      
      try {
        await sendSystemMediaKey(action, app_package);
        // After performing the action, sync back the state immediately
        await syncToSupabase();
      } catch (err) {
        console.error("Failed to perform remote action:", err);
      }
    })
    .subscribe((status) => {
      console.log(`[Supabase] Media actions subscription status: ${status}`);
    });
}

app.listen(port, () => {
  console.log(`Signal Share server running on http://localhost:${port}`);
  if (isWindows && userId) {
    console.log(`Windows SMTC bridge active for user: ${userId}`);
    setInterval(syncToSupabase, 2000);
    subscribeToMediaActions();
    // Initial sync
    syncToSupabase();
  }
});
