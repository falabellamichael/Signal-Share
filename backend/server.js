import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SMTCMonitor, PlaybackStatus } from "@coooookies/windows-smtc-monitor";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { getChatResponse, getLocalModelCatalog } from "./chatbot.js";
import { SecurityEngine } from "./security-v3.js";
import { isMasterAdmin, hasPermission, ADMIN_ROLES } from "./roles-v3.js";
import { registerModerationRoutes } from "./moderation-api-v3.js";

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
const DEVICE_ID = process.env.SIGNAL_SHARE_DEVICE_ID || "";

const security = new SecurityEngine(BRIDGE_SECRET, DEVICE_ID);
console.log(`[Bridge] Security Core v3 initialized.`);
console.log(`[Bridge] Device Locking: ${DEVICE_ID ? "ENABLED" : "DISABLED"}`);

const lastMediaActionAtByKey = new Map();

// Rate limiting for system actions
const actionCounts = new Map(); // ip -> { count, resetAt }
const MAX_ACTIONS_PER_MINUTE = 30;

const CORS_WHITELIST = [
  "https://signal-share.pages.dev",
  "https://signal-share.com",
  "https://falabellamichael.github.io",
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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Security & CORS Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isWhitelisted = origin && CORS_WHITELIST.some((allowed) => origin.startsWith(allowed));
  const isLocalhost = !origin || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("::1");

  // CORS Logic
  if (isWhitelisted || isLocalhost) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, x-bridge-secret, Authorization, Target-Address-Space, target-address-space, X-Requested-With, x-requested-with, Access-Control-Allow-Private-Network, *");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Allow-Local-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin, Access-Control-Request-Private-Network");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. IP Ban Check (STRICT)
  if (security.isBanned(req.ip)) {
    return res.status(403).json({ error: "Access denied: Your IP has been permanently banned for suspicious activity." });
  }

  const incomingSecret = req.headers["x-bridge-secret"] || req.headers["X-Bridge-Secret"];
  const incomingDevice = req.headers["x-device-id"] || req.headers["X-Device-Id"];
  const isSensitive = req.path.startsWith('/api/system/') || req.path.startsWith('/api/system-media/action') || req.path.startsWith('/api/security/');
  
  // 2. Device ID Validation (Hardware-bound)
  if (isSensitive && !security.validateDevice(incomingDevice)) {
    console.warn(`[Bridge] Blocked unauthorized device attempt from ${req.ip}`);
    security.logSecurely('UNAUTHORIZED_DEVICE', { ip: req.ip, path: req.path });
    return res.status(403).json({ error: "Access denied: Unauthorized hardware device." });
  }

  // 3. Secret Validation
  if (isSensitive && !security.validateSecret(incomingSecret, BRIDGE_SECRET)) {
    console.warn(`[Bridge] Unauthorized access attempt from ${req.ip} to ${req.path}`);
    
    // Check if we should ban this IP after multiple failures
    if (security.shouldBan(req.ip, 'secret_mismatch')) {
       return res.status(403).json({ error: "Access denied: Permanent IP ban applied." });
    }
    
    return res.status(401).json({ error: "Unauthorized: Invalid or missing X-Bridge-Secret." });
  }

  // 4. Rate Limiting Check
  if (!security.checkRateLimit(req.ip, MAX_ACTIONS_PER_MINUTE)) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  next();
});

// MasterAdmin Verification Endpoint
app.post("/api/security/verify-master", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ isMaster: false });
  
  const isMaster = isMasterAdmin(email);
  return res.json({ 
    isMaster, 
    role: isMaster ? ADMIN_ROLES.MASTER : ADMIN_ROLES.USER 
  });
});

// Chat integration using the intelligence module
app.post('/api/llm/chat', async (req, res) => {
  try {
    const { message, history, pageContext, attachment, model, customInstructions } = req.body;
    console.log(`[Chatbot] Incoming POST request. Message length: ${message?.length || 0}, Model: ${model || 'auto'}, Attachment: ${attachment ? attachment.type : 'none'}`);
    if (!message) return res.status(400).json({ error: 'No message provided' });

    const reply = await getChatResponse(message, history || [], pageContext, 0, attachment, model, customInstructions);
    res.json({ reply });
  } catch (err) {
    console.error('[Bridge] LLM chat error:', err);
    res.status(500).json({ error: 'LLM processing failed' });
  }
});

// Moderation Routes
registerModerationRoutes(app, getChatResponse);

app.get('/api/llm/models', async (req, res) => {
  try {
    const force = `${req.query?.force || ""}`.trim().toLowerCase() === "true";
    const catalog = await getLocalModelCatalog({ force });
    const lmStudioSet = new Set((catalog?.lmstudio || []).map((item) => `${item}`.toLowerCase()));
    const ollamaSet = new Set((catalog?.ollama || []).map((item) => `${item}`.toLowerCase()));

    const models = (catalog?.all || []).map((id) => {
      const key = `${id || ""}`.toLowerCase();
      return {
        id,
        provider: lmStudioSet.has(key) ? "lmstudio" : (ollamaSet.has(key) ? "ollama" : "unknown")
      };
    });

    res.json({
      ok: true,
      models,
      providers: {
        lmstudio: catalog?.lmstudio || [],
        ollama: catalog?.ollama || []
      },
      checkedAt: catalog?.checkedAt || new Date().toISOString()
    });
  } catch (error) {
    console.error("[Bridge] /api/llm/models error:", error);
    res.status(500).json({ ok: false, error: "Failed to read local model catalog." });
  }
});

// Health check for the chat endpoint
app.get('/api/llm/chat', (req, res) => {
  res.json({ ok: true, status: 'AI Chat Bridge is active and awaiting POST requests.' });
});

// System inspection endpoints
app.get('/api/system/apps', async (req, res) => {
  if (!isWindows) return res.status(400).json({ error: "Only available on Windows" });
  try {
    const ps = spawn("powershell", ["-Command", "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"]);
    let data = "";
    ps.stdout.on("data", (chunk) => { data += chunk; });
    ps.on("close", () => {
      try {
        const apps = JSON.parse(data);
        res.json({ apps: Array.isArray(apps) ? apps : [apps] });
      } catch (e) {
        res.status(500).json({ error: "Failed to parse app list", details: data });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/tabs', async (req, res) => {
  if (!isWindows) return res.status(400).json({ error: "Only available on Windows" });
  try {
    // Browsers often have the active tab in the window title. 
    // We look for common browser processes.
    const ps = spawn("powershell", ["-Command", "Get-Process | Where-Object { $_.MainWindowTitle -and ($_.ProcessName -match 'chrome|msedge|firefox|opera|browser') } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"]);
    let data = "";
    ps.stdout.on("data", (chunk) => { data += chunk; });
    ps.on("close", () => {
      try {
        const tabs = JSON.parse(data);
        res.json({ tabs: Array.isArray(tabs) ? tabs : [tabs] });
      } catch (e) {
        res.status(500).json({ error: "Failed to parse tab list", details: data });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/screenshot', async (req, res) => {
  if (!isWindows) return res.status(400).json({ error: "Only available on Windows" });
  try {
    const scriptPath = path.join(projectRoot, "scratch", "screenshot.ps1");
    const ps = spawn("powershell", ["-ExecutionPolicy", "Bypass", "-File", scriptPath]);
    let data = "";
    ps.stdout.on("data", (chunk) => { data += chunk; });
    ps.on("close", () => {
      const base64 = data.trim();
      if (base64) {
        res.json({ image: `data:image/png;base64,${base64}` });
      } else {
        res.status(500).json({ error: "Screenshot failed: empty output" });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// File System Management Endpoints (Advanced Coding Abilities)
app.get('/api/system/files/list', async (req, res) => {
  const targetPath = req.query.path || '.';
  const fullPath = path.resolve(projectRoot, targetPath);
  
  if (!security.isPathSafe(targetPath, projectRoot)) {
    security.shouldBan(req.ip, 'malicious_traversal');
    return res.status(403).json({ error: "Access denied: Path outside project root." });
  }

  try {
    const files = await fs.readdir(fullPath, { withFileTypes: true });
    const result = files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      extension: path.extname(f.name)
    }));
    res.json({ path: targetPath, files: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/files/read', async (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath) return res.status(400).json({ error: "Missing path parameter" });
  
  const fullPath = path.resolve(projectRoot, targetPath);
  if (!security.isPathSafe(targetPath, projectRoot)) {
    return res.status(403).json({ error: "Access denied: Path outside project root." });
  }

  try {
    const content = await fs.readFile(fullPath, 'utf8');
    res.json({ path: targetPath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/files/write', async (req, res) => {
  const { path: targetPath, content } = req.body;
  if (!targetPath || content === undefined) return res.status(400).json({ error: "Missing path or content" });

  const fullPath = path.resolve(projectRoot, targetPath);
  if (!security.isPathSafe(targetPath, projectRoot)) {
    return res.status(403).json({ error: "Access denied: Path outside project root." });
  }

  try {
    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    res.json({ ok: true, message: `Successfully wrote ${targetPath}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// App Management Endpoints
app.post('/api/system/launch', async (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: "Missing appId" });

  try {
    const whitelist = {
      taskmgr: "taskmgr",
      calculator: "calc",
      notepad: "notepad",
      explorer: "explorer .",
      spotify: "spotify",
      chrome: "chrome",
      edge: "msedge",
      control: "control"
    };

    const cmd = whitelist[appId.toLowerCase()] || appId;
    if (cmd.includes(';') || cmd.includes('|') || cmd.includes('&')) {
      return res.status(403).json({ error: "Access denied: Invalid characters in command." });
    }

    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${cmd}"`], { windowsHide: true });
    ps.on("close", (code) => {
      if (code === 0) res.json({ ok: true, message: `Launched ${appId}` });
      else res.status(500).json({ error: `Failed to launch ${appId}` });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Security Dashboard Endpoints
app.get('/api/security/audit', (req, res) => {
  // Only accessible via bridge (which already checks secrets in the middleware)
  res.json(security.getAuditReport());
});

app.post('/api/system/close', async (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: "Missing appId" });

  try {
    const target = appId.toLowerCase();
    const psCommand = `Get-Process | Where-Object { $_.Name -like "*${target}*" -or $_.MainWindowTitle -like "*${target}*" } | Stop-Process -Force`;
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", psCommand], { windowsHide: true });
    
    ps.on("close", (code) => {
      res.json({ ok: true, message: `Attempted to close ${appId}` });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-all for /api/llm/chat with wrong method
app.all('/api/llm/chat', (req, res) => {
  console.warn(`[Chatbot] 405 Error: Received ${req.method} request for /api/llm/chat from ${req.ip}`);
  res.status(405).json({ 
    error: `Method ${req.method} not allowed.`,
    tip: 'The Signal Share AI Companion requires a POST request with a JSON body.' 
  });
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
    const pattern = new RegExp(`^${escapeRegex(variant)}\\s*(?:[-:|]\\s*)?|\\s*(?:[-:|]\\s*)?${escapeRegex(variant)}$`, "gi");
    meta = meta.replace(pattern, "").trim();

    // Use a global loop to strip ALL occurrences if it's a numeric ID doubling/tripling
    if (/^\d+$/.test(variant)) {
      const midPattern = new RegExp(`(?:[-:|\\s]+)?${escapeRegex(variant)}(?:[-:|\\s]+)?`, "gi");
      meta = meta.replace(midPattern, " ").trim();
    }
  }

  // If after sanitization the meta is just a bunch of separators or very short numeric garbage, clear it
  if (meta && (/^[-\s:|]+$/.test(meta) || /^\d+$/.test(meta.replace(/[-\s:|]/g, "")))) {
    meta = "";
  }

  const genericPrefixPattern = /^(?:spotify[a-z0-9._!-]*|operasoftware\.[a-z0-9._!-]*|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?|bluetooth|phone link)\s*(?:[-:|]\s*)?/i;
  const genericStripped = meta.replace(genericPrefixPattern, "").trim();
  if (genericStripped) meta = genericStripped;

  return meta;
}

function extractYoutubeVideoId(value) {
  if (!value) return "";
  // 1. Check for standard URL patterns (The most reliable way)
  const ytMatch = value.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*embed\/|.*shorts\/))([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) return ytMatch[1];

  // 2. Check for common browser window titles that include the ID in brackets/parens
  const bracketMatch = value.match(/[\[\(\u3010]([a-zA-Z0-9_-]{11})[\]\)\u3011]/);
  if (bracketMatch) return bracketMatch[1];

  // Note: We removed the loose 11-char pattern match because it caused
  // false positives on regular words (like uploader names), leading to 404 errors.

  return "";
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
    // Common YouTube PWA/Browser markers
    session?.sourceAppUserModelId?.toLowerCase().includes("youtube") ? "youtube-source" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifySessionProvider(session, preferredSource = "") {
  const text = getSessionSourceText(session);
  const sourceAppId = `${session?.sourceAppUserModelId || session?.sourceAppId || ""}`.toLowerCase();
  const media = session?.media || {};
  const preferred = normalizePreferredSource(preferredSource);

  const isSpotifyId = sourceAppId.includes("spotify");
  const isYouTubeId = sourceAppId.includes("youtube") || sourceAppId.includes("ytmusic") || sourceAppId.includes("google.android.youtube") || sourceAppId.includes("you.tube");

  // 1. Explicit ID Match (Desktop Apps)
  if (isSpotifyId) return "spotify";
  if (isYouTubeId) return "youtube";

  // 2. Keyword Match (Browser Titles/Metadata)
  const browserText = [
    media.title,
    media.artist,
    media.albumArtist,
    media.albumTitle,
    session?.sourceAppId,
    session?.sourceAppUserModelId
  ].filter(Boolean).join(" ").toLowerCase();

  const looksLikeYouTube =
    browserText.includes("youtube")
    || browserText.includes("ytmusic")
    || browserText.includes("youtu.be")
    || browserText.includes("music.youtube")
    || browserText.includes("you tube")
    || browserText.includes("video");

  const looksLikeSpotify = browserText.includes("spotify") || browserText.includes("open.spotify.com");

  if (looksLikeYouTube) return "youtube";
  if (looksLikeSpotify) return "spotify";

  // 3. Mode-Based Tie-Breaker (Exclusive Isolation)
  // If we are in a specific mode (e.g. YouTube mode) and the session is a browser,
  // we "claim" it for the target mode.
  if (isBrowserLikeSource(sourceAppId) || sourceAppId.includes("native-bridge")) {
    if (preferred === "youtube") {
      // If locked to YouTube, we trust generic browser sessions unless it's explicitly the Spotify app
      if (!isSpotifyId) return "youtube";
    }
    if (preferred === "spotify") {
      // If locked to Spotify, we trust generic browser sessions unless it's explicitly the YouTube app
      if (!isYouTubeId) return "spotify";
    }
  }



  if (sourceAppId.includes("phone link") || sourceAppId.includes("bluetooth") || text.includes("phone link") || text.includes("bluetooth")) return "phone_link";

  return "";
}





function scoreSession(session, preferredSource = "") {
  const preferred = normalizePreferredSource(preferredSource);
  const provider = classifySessionProvider(session, preferredSource);
  const priority = getPlaybackPriority(session?.playback?.playbackStatus);
  const text = getSessionSourceText(session);

  let score = priority * 1000;


  if (preferred) {
    if (provider === preferred) {
      score += 50000; // High boost for matching source
    } else {
      // STRICT REJECTION: If a source is preferred, we discard anything that isn't classified as it.
      // This ensures "Spotify Mode" never shows YouTube data.
      return -1000000;
    }
  } else if (isPreferredApp(session.sourceAppUserModelId || session.sourceAppId)) {
    score += 500;
  }








  if (text.includes("spotify")) score += 120;
  if (text.includes("youtube") || text.includes("youtu.be")) score += 120;
  if (session?.media?.title && `${session.media.title}`.trim()) score += 80;

  // Penalize sessions with purely numeric titles, which are often track IDs or stale sessions
  if (/^\d{5,}$/.test(session?.media?.title || "")) {
    score -= 2000;
  }

  const updated = Number(session?.lastUpdatedTime || 0);
  if (Number.isFinite(updated) && updated > 0) {
    score += (updated % 1000) / 100;
  }

  return score;
}

function pickBestSession(sessions = [], preferredSource = "") {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  const preferred = normalizePreferredSource(preferredSource);

  const best = sessions.reduce((best, session) => {
    if (!best) return session;
    return scoreSession(session, preferredSource) > scoreSession(best, preferredSource) ? session : best;
  }, null);

  if (best && preferred) {
    const score = scoreSession(best, preferredSource);
    // If the score is negative, it means we definitely didn't find a match for the preferred source
    if (score < 0) return null;
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
    const sourceProvider = classifySessionProvider(session, preferred) || preferred;


    const meta = (appLabel && sanitizedMeta && !/^\d+$/.test(appLabel) && appLabel.toLowerCase() !== sanitizedMeta.toLowerCase())
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
      const albumTitle = `${session.media?.albumTitle || ""}`.trim();
      const videoId = extractYoutubeVideoId(title)
        || extractYoutubeVideoId(albumTitle)
        || extractYoutubeVideoId(sourceAppId);

      if (videoId) {
        openUri = `https://www.youtube.com/watch?v=${videoId}`;

        // OVERRIDE FOR ADVERTISEMENTS / LOW-RES ARTWORK:
        // We prefer the direct high-res thumbnail from YouTube if we found a valid ID.
        // This fixes the issue where an "Advertisement" thumbnail is shown instead of the video.
        if (!artworkUri || title.toLowerCase().includes("advertisement") || sourceProvider === "youtube") {
          artworkUri = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }
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

$appCommandSig = '[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);'
$user32 = Add-Type -MemberDefinition $appCommandSig -Name "User32" -Namespace "Win32" -PassThru
function Send-AppCommand($cmd) {
  $WM_APPCOMMAND = 0x0319
  $targetHWnd = [IntPtr]0xffff # HWND_BROADCAST
  $lParam = [IntPtr]($cmd -shl 16)
  [Win32.User32]::SendMessage($targetHWnd, $WM_APPCOMMAND, [IntPtr]::Zero, $lParam)
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
    # We need to find the AsTask method for IAsyncOperation<T>
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
      $_.ToString() -match 'Task.*AsTask.*IAsyncOperation' -and $_.ToString() -notmatch 'WithProgress' 
    } | Select-Object -First 1
    if ($null -ne $asTaskMethod) {
      $mediaTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])).Invoke($null, @($mediaOp))
      $media = $mediaTask.Result
      if ($media.Title) { $parts.Add($media.Title) }
      if ($media.Artist) { $parts.Add($media.Artist) }
    }
  } catch { Write-Host "[Diag] Error getting session text: $_" }
  return ([string]::Join(" ", $parts)).ToLowerInvariant()
}

function Is-Match-Source($session, [string]$source) {
  if ([string]::IsNullOrWhiteSpace($source) -or $source -eq "all") { return $true }
  $id = ""
  try { $id = Normalize-AppId $session.SourceAppUserModelId } catch {}
  $text = Get-Session-Text $session
  $isBrowser = Is-Browser-App $id

  $isYouTube = ($id -match "youtube|ytmusic") -or ($text -match "youtube\\.com|youtube -|- youtube|youtu\\.be|music\\.youtube")
  $isSpotify = ($id -match "spotify") -or ($text -match "spotify|open\\.spotify")

  if ($source -eq "spotify") {
    if ($isYouTube) { return $false }
    if ($isSpotify) { return $true }
    # Only allow generic browser if it doesn't look like YouTube
    return $isBrowser
  }

  if ($source -eq "youtube") {
    if ($isSpotify) { return $false }
    if ($isYouTube) { return $true }
    # Only allow generic browser if it doesn't look like Spotify
    return $isBrowser
  }

  return $true
}


try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.ToString() -match 'Task.*AsTask.*IAsyncOperation' -and $_.ToString() -notmatch 'WithProgress' -and $_.ToString() -notmatch 'CancellationToken' -and $_.ToString() -match 'TResult.*TResult'
  } | Select-Object -First 1

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
            $candidateId = ""
            try { $candidateId = $candidate.SourceAppUserModelId } catch {}
            $isPreferred = [string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all" -or (Is-Match-Source $candidate $preferred)
            
            if (![string]::IsNullOrWhiteSpace($preferred) -and $preferred -ne "all") {
              if ($isPreferred) { $score += 10000 } else { $score -= 20000 }
            }
            if ($candidate.PlaybackInfo.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) { $score += 5000 }
            
            Write-Host "[PS] Candidate: $candidateId Score: $score"
            if ($score -gt $bestScore) { $bestScore = $score; $session = $candidate }
          } catch { Write-Host "[PS] Error scoring candidate: $_" }
        }
      }

      if ($session -eq $null) {
        $session = $manager.GetCurrentSession()
        if ($null -ne $session -and ![string]::IsNullOrWhiteSpace($preferred) -and $preferred -ne "all") {
          if (-not (Is-Match-Source $session $preferred)) { $session = $null }
        }
      }

    }

    if ($session -ne $null) {
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
} catch {
  $winRtSuccess = $false
}

# Fallback to global media keys or AppCommands if WinRT targeting failed or if it's a skip/toggle action.
# CRITICAL: Only allow global fallback if NO specific source is preferred.
# This prevents "YouTube mode" from accidentally toggling Spotify.
if ([string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all") {
  if ("${action}" -eq "play_pause") {
    Send-AppCommand $APPCOMMAND_MEDIA_PLAY_PAUSE
  } elseif ("${action}" -eq "next") {
    Send-AppCommand $APPCOMMAND_MEDIA_NEXTTRACK
  } elseif ("${action}" -eq "previous") {
    Send-AppCommand $APPCOMMAND_MEDIA_PREVIOUSTRACK
  }

  $KEYEVENTF_EXTENDEDKEY = 0x0001
  $KEYEVENTF_KEYUP = 0x0002

  # Also send global media key for maximum compatibility
  [MediaKeySender]::keybd_event(${vkCode}, 0, $KEYEVENTF_EXTENDEDKEY, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 45
  [MediaKeySender]::keybd_event(${vkCode}, 0, ($KEYEVENTF_EXTENDEDKEY -bor $KEYEVENTF_KEYUP), [UIntPtr]::Zero)

  Write-Output "ok-global"
  exit 0
}

# If we had a preferred source but winRtSuccess is false, it means we couldn't find a matching app.
# We auto-launch the app if it's a play_pause action, similar to Android's behavior.
if ($winRtSuccess -eq $false) {
  if ("${action}" -eq "play_pause") {
    if ($preferred -eq "youtube") {
      try { Start-Process "https://www.youtube.com" } catch {}
      Write-Output "ok-launched-youtube"
      exit 0
    } elseif ($preferred -eq "spotify") {
      try { Start-Process "spotify:" } catch {}
      Write-Output "ok-launched-spotify"
      exit 0
    }
  }
  Write-Output "fail-target-not-found"
  exit 0
}

Write-Output "ok-winrt"
exit 0

  `.trim();

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
    
    console.log(`[Bridge] Received open_uri request: ${uri}`);

    // Protocol Whitelist
    const allowedProtocols = ["http:", "https:", "spotify:", "ms-phone:", "yourphone:", "mobilephonelink:"];
    const hasAllowedProtocol = allowedProtocols.some(p => uri.toLowerCase().startsWith(p));
    if (!hasAllowedProtocol) {
      console.warn(`[Security] Blocked unauthorized protocol in open_uri: ${uri}`);
      return res.status(403).json({ ok: false, error: "Unauthorized protocol. Only web links and specific app deep links are allowed." });
    }

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
        Start-Process -FilePath "$uri"
      }
    `.trim();

    try {
      const psProcess = spawn("powershell.exe", ["-NoProfile", "-Command", psCommand], { windowsHide: true });
      
      // Handle errors from the spawned process
      psProcess.on('error', (err) => {
        console.error(`[Bridge] Failed to spawn PowerShell for open_uri: ${err.message}`);
      });
      
      // Capture stderr for debugging
      psProcess.stderr?.on('data', (data) => {
        const error = data.toString().trim();
        if (error && !error.includes("Start-Process")) {
          console.warn(`[Bridge] PowerShell stderr: ${error}`);
        }
      });
    } catch (err) {
      console.error(`[Bridge] Exception while spawning PowerShell: ${err.message}`);
      return res.status(500).json({ ok: false, error: "Failed to execute system command" });
    }
    
    return res.json({ ok: true, queued: true });
  }

  if (!MEDIA_KEY_CODES[action]) {
    return res.status(400).json({ 
      ok: false, 
      error: `Invalid media action: "${action}". Supported actions are: ${Object.keys(MEDIA_KEY_CODES).join(", ")}. For arcade navigation, use [ARCADE: action] instead.` 
    });
  }

  const actionKey = `${preferredSource || "all"}|${action}|${appPackage}`;
  const now = Date.now();
  if (now - (lastMediaActionAtByKey.get(actionKey) || 0) < MEDIA_ACTION_COOLDOWN_MS) {
    return res.json({ ok: true, queued: false, skipped: true });
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
        } catch (_e) { }
      }, 180);
    })
    .catch(() => invalidateSnapshotCache());
});

// Arcade Activity Reporting
app.post("/api/activity/report", async (req, res) => {
  const { activity } = req.body;
  if (!activity || !userId || !enableRemoteMediaSync) return res.status(400).json({ ok: false });

  try {
    const gameId = activity.gameId || "arcade";
    const rank = activity.rank || "";
    const score = activity.score || 0;

    // 1. Update Live Status (Shared View)
    const { error: mediaError } = await supabase.from("system_media").upsert({
      user_id: userId,
      playback_state: "playing",
      title: activity.title || "Arcade Game",
      meta: rank ? `Rank: ${rank}` : (activity.meta || "Playing now"),
      artwork_uri: activity.artworkUri || "https://signal-share.com/neon_pinball_v2_poster.png",
      app_package: "io.signalshare.arcade",
      device_name: "Desktop PC (Arcade Mode)",
      updated_at: new Date().toISOString(),
    });

    // 2. Save Persistent Stats (High Scores / Ranks)
    const { error: statsError } = await supabase.from("game_stats").upsert({
      user_id: userId,
      game_id: gameId,
      score: score,
      rank: rank,
      metadata: { ...activity, updatedAt: new Date().toISOString() },
      created_at: new Date().toISOString()
    }, { onConflict: "user_id,game_id" });

    if (!mediaError) lastSupabaseSyncKey = `activity|${activity.title}|${rank}|${Date.now()}`;
    return res.json({ ok: !mediaError && !statsError, mediaError, statsError });
  } catch (error) {
    console.error("[Bridge] Activity report failed:", error);
    return res.status(500).json({ ok: false });
  }
});
// System Automation - Launching Apps
app.post("/api/system/launch", (req, res) => {
  const appId = `${req.body?.appId || ""}`.trim().toLowerCase();
  if (!appId) return res.status(400).json({ ok: false, error: "No appId provided" });

  if (!ALLOW_OPEN_URI) {
    return res.status(403).json({ ok: false, error: "System automation is disabled in bridge config." });
  }

  // Security Whitelist for System Apps
  const whitelist = {
    "taskmgr": "taskmgr.exe",
    "task manager": "taskmgr.exe",
    "calc": "calc.exe",
    "calculator": "calc.exe",
    "notepad": "notepad.exe",
    "control": "control.exe",
    "control panel": "control.exe",
    "explorer": "explorer.exe",
    "terminal": "wt.exe",
    "cmd": "cmd.exe",
    "spotify": "spotify:",
    "chrome": "chrome.exe",
    "edge": "msedge.exe",
    "browser": "https://www.google.com"
  };

  const command = whitelist[appId];
  if (!command) {
    console.warn(`[Security] Blocked unauthorized launch request: ${appId}`);
    return res.status(403).json({ ok: false, error: "Application not in security whitelist." });
  }

  console.log(`[Bridge] Launching application: ${command}`);
  
  try {
    const psProcess = spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${command}"`], { windowsHide: true });
    psProcess.on('error', (err) => console.error(`[Bridge] Launch failed: ${err.message}`));
    return res.json({ ok: true, launched: appId });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Advanced System Automation - Shell Execution (Fortress Mode Protected)
app.post("/api/system/shell", (req, res) => {
  const { cmd, shell = "pwsh" } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "No command provided" });

  if (!ALLOW_OPEN_URI) {
    return res.status(403).json({ ok: false, error: "System automation is disabled in bridge config." });
  }

  const shellExec = shell === "bash" ? "bash.exe" : "pwsh.exe";
  console.log(`[Bridge] Executing shell command [${shell}]: ${cmd}`);
  
  exec(`"${shellExec}" -c "${cmd.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
    if (error) {
      console.warn(`[Bridge] Shell error: ${error.message}`);
      return res.json({ ok: false, error: error.message, stderr });
    }
    return res.json({ ok: true, stdout, stderr });
  });
});

// System Telemetry - Resource Usage
app.get("/api/system/telemetry", (req, res) => {
  try {
    const os = require('os');
    const telemetry = {
      platform: os.platform(),
      release: os.release(),
      uptime: Math.floor(os.uptime()),
      cpu: os.cpus()[0].model,
      cpuCount: os.cpus().length,
      memory: {
        total: Math.floor(os.totalmem() / (1024 * 1024)),
        free: Math.floor(os.freemem() / (1024 * 1024)),
        usage: Math.floor(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
      }
    };
    return res.json(telemetry);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

// Process Management - List
app.get("/api/system/processes", (req, res) => {
  exec('tasklist /fo csv', (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, data: stdout });
  });
});

// Process Management - Kill
app.post("/api/system/kill", (req, res) => {
  const { id, name } = req.body || {};
  const target = id ? `/pid ${id}` : (name ? `/im ${name}` : null);
  
  if (!target) return res.status(400).json({ error: "No PID or process name provided" });

  exec(`taskkill /f ${target}`, (error, stdout) => {
    if (error) return res.json({ ok: false, error: error.message });
    return res.json({ ok: true, output: stdout });
  });
});

// Remaining API routes

app.get("/security", (req, res) => res.sendFile(path.join(projectRoot, "security.html")));
app.get("/", (req, res) => res.sendFile(path.join(projectRoot, "index.html")));

async function syncToSupabase() {
  if (!enableRemoteMediaSync || !isWindows || !userId || !supabase) return;
  try {
    const payload = buildSnapshotPayload();
    const syncKey = [payload.playbackState, payload.title, payload.meta, payload.artworkUri ? "art" : "no-art", payload.openUri, payload.appPackage, payload.smtcHealthy].join("|");
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
    if (!error) lastSupabaseSyncKey = syncKey;
  } catch (error) { }
}

function subscribeToMediaActions() {
  if (!enableRemoteMediaSync || !isWindows || !userId) return;
  console.log(`[Bridge] Subscribing to actions for ${userId}...`);
  supabase.channel('media_actions').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'system_media_actions', filter: `user_id=eq.${userId}`
  }, async (payload) => {
    const { action, app_package } = payload.new;
    console.log(`[Bridge] Remote action: ${action}`);
    if (action === "open_uri") {
      if (payload.new.uri) {
        try {
          const psProcess = spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${payload.new.uri.replace(/"/g, '`"')}"`], { windowsHide: true });
          
          psProcess.on('error', (err) => {
            console.error(`[Bridge] Failed to spawn PowerShell for remote open_uri: ${err.message}`);
          });
          
          psProcess.stderr?.on('data', (data) => {
            const error = data.toString().trim();
            if (error && !error.includes("Start-Process")) {
              console.warn(`[Bridge] PowerShell remote stderr: ${error}`);
            }
          });
        } catch (err) {
          console.error(`[Bridge] Exception while spawning PowerShell for remote open_uri: ${err.message}`);
        }
      }
    } else {
      await sendSystemMediaKey(action, app_package, payload.new?.payload?.preferredSource || "");
    }
    await syncToSupabase();
  }).subscribe();
}

app.listen(port, "127.0.0.1", () => {
  console.log(`[Bridge] Server secured. Listening ONLY on localhost (127.0.0.1) at port ${port}`);
  if (isWindows && enableRemoteMediaSync && userId) {
    console.log(`[Bridge] Remote media sync enabled for ${userId}.`);
    setInterval(syncToSupabase, SUPABASE_SYNC_INTERVAL_MS);
    subscribeToMediaActions();
    syncToSupabase();
  }
});
