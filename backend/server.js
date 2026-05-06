import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SMTCMonitor, PlaybackStatus } from "@coooookies/windows-smtc-monitor";

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

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  return "";
}

function normalizeSourceLabel(sourceAppId = "") {
  if (!sourceAppId) return "";
  const label = `${sourceAppId}`.trim();
  if (!label) return "";
  return label.replace(/\.exe$/i, "");
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

  const session = SMTCMonitor.getCurrentMediaSession();
  if (!session) return base;

  const playbackState = mapPlaybackState(session.playback?.playbackStatus);
  const sourceLabel = normalizeSourceLabel(session.sourceAppId);
  const title = `${session.media?.title || ""}`.trim();
  const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
  const meta = [sourceLabel, artist].filter(Boolean).join(" - ");

  let artworkUri = "";
  const thumbnail = session.media?.thumbnail;
  if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= 140000) {
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
    appPackage: `${session.sourceAppId || ""}`.trim(),
    artworkUri,
  };
}

function sendSystemMediaKey(action) {
  const vkCode = MEDIA_KEY_CODES[action];
  if (!vkCode) return Promise.resolve(false);

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MediaKeySender {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[MediaKeySender]::keybd_event(${vkCode}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[MediaKeySender]::keybd_event(${vkCode}, 0, 2, [UIntPtr]::Zero)
Write-Output "ok"
  `.trim();

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
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
  if (!Object.prototype.hasOwnProperty.call(MEDIA_KEY_CODES, action)) {
    res.status(400).json({ ok: false, error: "Invalid action. Use play_pause, next, or previous." });
    return;
  }
  if (!isWindows) {
    res.status(400).json({ ok: false, error: "System media actions are only available on Windows." });
    return;
  }

  const ok = await sendSystemMediaKey(action);
  res.json({ ok });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, () => {
  console.log(`Signal Share server running on http://localhost:${port}`);
});
