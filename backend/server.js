import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { 
  buildFreshSnapshotPayload, 
  sendSystemMediaKey, 
  MEDIA_KEY_CODES,
  getBaseSnapshot
} from "./media-logic.js";
import { 
  initSupabase, 
  syncToSupabase, 
  reportActivity, 
  subscribeToActions 
} from "./sync-logic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const userId = process.env.SIGNAL_SHARE_USER_ID;
const enableRemoteMediaSync = process.env.SIGNAL_SHARE_ENABLE_REMOTE_MEDIA === "true";
const ALLOW_OPEN_URI = process.env.SIGNAL_SHARE_ALLOW_OPEN_URI === "true";
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const MEDIA_ACTION_COOLDOWN_MS = 220;

const lastMediaActionAtByKey = new Map();
let cachedSnapshotPayload = null;
let cachedSnapshotAt = 0;
const SNAPSHOT_CACHE_TTL_MS = 650;
const SUPABASE_SYNC_INTERVAL_MS = 5000;

if (process.env.SUPABASE_URL) {
  initSupabase(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, userId);
}

app.use(express.json({ limit: "1mb" }));

// Security & CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, Authorization");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.status(204).end();
  
  if (BRIDGE_SECRET && req.path.startsWith("/api/system-media")) {
    if (req.headers["x-bridge-secret"] !== BRIDGE_SECRET) {
      return res.status(403).json({ error: "Unauthorized" });
    }
  }
  next();
});

app.use(express.static(projectRoot));

function getCachedSnapshot(preferred = "", force = false) {
  const now = Date.now();
  if (!force && cachedSnapshotPayload && (now - cachedSnapshotAt < SNAPSHOT_CACHE_TTL_MS)) {
    if (cachedSnapshotPayload.preferredSource === preferred) return cachedSnapshotPayload;
  }
  const snap = buildFreshSnapshotPayload(preferred);
  cachedSnapshotPayload = snap;
  cachedSnapshotAt = now;
  return snap;
}

app.get("/api/system-media/current", (req, res) => {
  const preferred = (req.query.source || "").toLowerCase();
  res.json(getCachedSnapshot(preferred, req.query.force === "true"));
});

app.post("/api/system-media/action", async (req, res) => {
  const { action, appPackage, preferredSource, uri } = req.body;
  
  if (action === "open_uri") {
    if (!ALLOW_OPEN_URI) return res.status(403).json({ ok: false });
    const ps = `Start-Process "${uri.replace(/"/g, '`"')}"`;
    import("node:child_process").then(cp => cp.spawn("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true }));
    return res.json({ ok: true });
  }

  if (!MEDIA_KEY_CODES[action]) return res.status(400).json({ ok: false });

  const key = `${action}|${preferredSource}`;
  if (Date.now() - (lastMediaActionAtByKey.get(key) || 0) < MEDIA_ACTION_COOLDOWN_MS) {
    return res.json({ ok: true, skipped: true });
  }
  lastMediaActionAtByKey.set(key, Date.now());

  res.json({ ok: true });
  await sendSystemMediaKey(action, appPackage, preferredSource);
  cachedSnapshotPayload = null;
  
  setTimeout(async () => {
    const snap = getCachedSnapshot(preferredSource, true);
    if (enableRemoteMediaSync) await syncToSupabase(snap);
  }, 200);
});

app.post("/api/activity/report", async (req, res) => {
  const ok = await reportActivity(req.body.activity);
  res.json({ ok });
});

app.get("/", (req, res) => res.sendFile(path.join(projectRoot, "index.html")));

app.listen(port, "127.0.0.1", () => {
  console.log(`[Bridge] Server running on http://localhost:${port}`);
  if (enableRemoteMediaSync && userId) {
    setInterval(async () => {
      const snap = getCachedSnapshot();
      await syncToSupabase(snap);
    }, SUPABASE_SYNC_INTERVAL_MS);
    subscribeToActions(() => {
      cachedSnapshotPayload = null;
      const snap = getCachedSnapshot();
      syncToSupabase(snap);
    });
  }
});
