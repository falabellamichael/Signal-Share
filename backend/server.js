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
  play: 0xfa,
  pause: 0xfb,
  next: 0xb0,
  previous: 0xb1,
};
const APP_COMMAND_CODES = {
  play_pause: 14,
  play: 46,
  pause: 47,
  next: 11,
  previous: 12,
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
    case PlaybackStatus.PLAYING: return "playing";
    case PlaybackStatus.PAUSED: return "paused";
    case PlaybackStatus.CLOSED:
    case PlaybackStatus.STOPPED: return "none";
    default: return "active";
  }
}

function inferArtworkMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
  return "";
}

function escapeRegex(value = "") { return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function getSourceAppIdVariants(sourceAppId = "") {
  const value = `${sourceAppId || ""}`.trim();
  if (!value) return [];
  const variants = new Set();
  variants.add(value);
  variants.add(value.replace(/!.*$/, ""));
  variants.add(value.replace(/\.\d+$/, ""));
  variants.add(value.replace(/\.exe$/i, ""));
  variants.add(value.replace(/_[a-z0-9]+$/i, ""));
  return Array.from(variants).map((entry) => entry.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
}

function sanitizeMediaMeta(rawMeta = "", sourceAppId = "") {
  let meta = `${rawMeta || ""}`.replace(/\s+/g, " ").trim();
  if (!meta) return "";
  for (const variant of getSourceAppIdVariants(sourceAppId)) {
    const prefixPattern = new RegExp(`^${escapeRegex(variant)}\\s*(?:[-:|]\\s*)?`, "i");
    const stripped = meta.replace(prefixPattern, "").trim();
    if (stripped && stripped !== meta) { meta = stripped; break; }
  }
  return meta;
}

function extractYoutubeVideoId(value) {
  if (!value) return "";
  const ytMatch = value.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/))([a-zA-Z0-9_-]{11})/i);
  return ytMatch ? ytMatch[1] : "";
}

function scoreSession(session) {
  let score = 0;
  const status = session.playback?.playbackStatus;
  if (status === PlaybackStatus.PLAYING) score += 400;
  else if (status === PlaybackStatus.PAUSED) score += 200;
  const sourceAppId = `${session.sourceAppUserModelId || session.sourceAppId || ""}`.trim().toLowerCase();
  if (sourceAppId.includes("spotify") || sourceAppId.includes("youtube") || sourceAppId.includes("chrome") || sourceAppId.includes("msedge")) score += 400;
  if (session.media?.title) score += 100;
  return score;
}

function pickBestSession(sessions = []) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  return sessions.reduce((best, session) => (!best || scoreSession(session) > scoreSession(best) ? session : best), null);
}

function selectPreferredMediaSession() {
  const allSessions = SMTCMonitor.getMediaSessions();
  return pickBestSession(Array.isArray(allSessions) ? allSessions : []);
}

function resolveMediaAppLabel(sourceAppId = "") {
  if (!sourceAppId) return "";
  const normalized = sourceAppId.toLowerCase();
  if (normalized.includes("spotify")) return "Spotify";
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("chrome")) return "Chrome";
  if (normalized.includes("msedge")) return "Edge";
  const lastDot = sourceAppId.lastIndexOf('.');
  return lastDot >= 0 ? sourceAppId.substring(lastDot + 1) : sourceAppId;
}

function buildSnapshotPayload() {
  const base = { source: "windows-smtc", available: isWindows, active: false, playbackState: "none", title: "", meta: "", appPackage: "", openUri: "", artworkUri: "" };
  if (!isWindows) return { ...base, unavailableReason: "Only available on Windows." };
  try {
    const session = selectPreferredMediaSession();
    if (!session) return base;
    const sourceAppId = `${session.sourceAppUserModelId || session.sourceAppId || ""}`.trim();
    const appLabel = resolveMediaAppLabel(sourceAppId);
    const playbackState = mapPlaybackState(session.playback?.playbackStatus);
    const title = `${session.media?.title || ""}`.trim();
    const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
    const sanitizedMeta = sanitizeMediaMeta(artist, sourceAppId);
    const meta = (appLabel && sanitizedMeta && appLabel.toLowerCase() !== sanitizedMeta.toLowerCase()) ? `${appLabel} - ${sanitizedMeta}` : (sanitizedMeta || appLabel);
    let artworkUri = "";
    const thumbnail = session.media?.thumbnail;
    if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= MAX_ARTWORK_BYTES) {
      const mimeType = inferArtworkMimeType(thumbnail);
      if (mimeType) artworkUri = `data:${mimeType};base64,${thumbnail.toString("base64")}`;
    }
    let openUri = "";
    if (sourceAppId.toLowerCase().includes("youtube") || title.toLowerCase().includes("youtube")) {
      const videoId = extractYoutubeVideoId(title) || extractYoutubeVideoId(session.media?.albumTitle);
      if (videoId) { openUri = `https://www.youtube.com/watch?v=${videoId}`; if (!artworkUri) artworkUri = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; }
    }
    return { ...base, active: playbackState !== "none", playbackState, title: title || "Now playing", meta, appPackage: sourceAppId, artworkUri, openUri };
  } catch (error) { return base; }
}

function sendSystemMediaKey(action, targetAppPackage = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !winrtMethodName) return Promise.resolve(false);
  const script = `
$ErrorActionPreference = "Stop"
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
if ($null -eq $targetApp) { $targetApp = "" }
$targetApp = $targetApp.Trim()

function Matches-AppId([string]$candidate, [string]$target) {
  $c = $candidate.Trim().ToLowerInvariant()
  $t = $target.Trim().ToLowerInvariant()
  return $c -eq $t -or $c.StartsWith($t) -or $t.StartsWith($c)
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.ToString() -eq 'System.Threading.Tasks.Task\\\`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation\\\`1[TResult])' } | Select-Object -First 1
  if ($asTaskMethod -ne $null) {
    $managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $managerTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])).Invoke($null, @($managerOp))
    $manager = $managerTask.Result
    $session = $null
    if ($manager -ne $null) {
      foreach ($candidate in $manager.GetSessions()) {
        if ($null -eq $candidate) { continue }
        if (-not [string]::IsNullOrWhiteSpace($targetApp) -and (Matches-AppId $candidate.SourceAppUserModelId $targetApp)) { $session = $candidate; break }
        if ($null -eq $session -or $candidate.GetPlaybackInfo().PlaybackStatus -eq 4) { $session = $candidate }
      }
    }
    if ($session -eq $null -and $manager -ne $null) { $session = $manager.GetCurrentSession() }
    if ($session -ne $null) {
      $actionMethod = $session.GetType().GetMethod("${winrtMethodName}", [Type[]]@())
      if ($actionMethod -ne $null) {
        $actionOp = $actionMethod.Invoke($session, @())
        $resultTask = $asTaskMethod.MakeGenericMethod(@([bool])).Invoke($null, @($actionOp))
        $winRtSuccess = [bool]$resultTask.Result
      }
    }
  }
} catch {}

if ($winRtSuccess) { Write-Output "ok"; exit 0 }

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
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, env: { ...process.env, SIGNAL_SHARE_TARGET_APP: targetAppPackage } });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("close", (code) => { resolve(code === 0 && stdout.trim().toLowerCase().includes("ok")); });
    child.on("error", () => resolve(false));
  });
}

app.get("/api/system-media/current", (req, res) => { res.json(buildSnapshotPayload()); });
app.post("/api/system-media/action", async (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  if (action === "open_uri") {
    const uri = `${req.body?.uri || ""}`.trim();
    if (uri) spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
    return res.json({ ok: true });
  }
  const ok = await sendSystemMediaKey(action, appPackage);
  res.json({ ok });
});

let lastSyncPayload = null;
async function syncToSupabase() {
  if (!isWindows || !userId) return;
  try {
    const payload = buildSnapshotPayload();
    const syncKey = `${payload.playbackState}|${payload.title}|${payload.meta}|${payload.openUri}`;
    if (lastSyncPayload === syncKey) return;
    const { error } = await supabase.from("system_media").upsert({
      user_id: userId, playback_state: payload.playbackState, title: payload.title, meta: payload.meta,
      artwork_uri: payload.artworkUri, open_uri: payload.openUri, app_package: payload.appPackage,
      device_name: "Desktop PC", updated_at: new Date().toISOString(),
    });
    if (!error) lastSyncPayload = syncKey;
  } catch (err) {}
}

let isPerformingAction = false;
function subscribeToMediaActions() {
  if (!isWindows || !userId) return;
  supabase.channel('media_actions').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'system_media_actions', filter: `user_id=eq.${userId}`
  }, async (payload) => {
    if (isPerformingAction) return;
    isPerformingAction = true;
    try {
      const { action, app_package, uri } = payload.new;
      if (action === "open_uri" && uri) spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
      else await sendSystemMediaKey(action, app_package);
      supabase.from("system_media_actions").delete().eq("user_id", userId).lt("created_at", new Date(Date.now() - 60000).toISOString()).then(() => {});
      setTimeout(syncToSupabase, 800);
    } finally { setTimeout(() => { isPerformingAction = false; }, 500); }
  }).subscribe();
}

app.listen(port, "0.0.0.0", () => {
  console.log(`[Bridge] Server on http://localhost:${port}`);
  if (isWindows && userId) {
    setInterval(syncToSupabase, 5000);
    subscribeToMediaActions();
    syncToSupabase();
  }
});
