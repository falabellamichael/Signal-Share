import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { sendSystemMediaKey, MEDIA_KEY_CODES } from "./bridge-logic.js";
import { initSupabaseSync, syncToSupabase, buildSnapshot, reportLocalActivity } from "./supabase-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const userId = process.env.SIGNAL_SHARE_USER_ID;
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const enableRemoteMediaSync = process.env.SIGNAL_SHARE_ENABLE_REMOTE_MEDIA === "true";
const ALLOW_OPEN_URI = process.env.SIGNAL_SHARE_ALLOW_OPEN_URI === "true";

// Security Config
const CORS_WHITELIST = [
  "https://falabellamichael.github.io",
  "https://signal-share.pages.dev",
  "https://signal-share.com",
  "http://localhost",
  "http://127.0.0.1"
];

const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_ANON_KEY || "");
if (enableRemoteMediaSync && userId) {
  initSupabaseSync(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, userId);
}

app.use(express.json({ limit: "1mb" }));

// Middleware: CORS & Security
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isWhitelisted = origin && CORS_WHITELIST.some(w => origin.startsWith(w));
  const isLocal = !origin || origin.includes("localhost") || origin.includes("127.0.0.1");

  if (isWhitelisted || isLocal) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://falabellamichael.github.io");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, Authorization");
  res.setHeader("Access-Control-Allow-Private-Network", "true");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (BRIDGE_SECRET && (req.path.startsWith("/api/system-media") || req.path.startsWith("/api/activity"))) {
    const secret = req.headers["x-bridge-secret"];
    if (secret !== BRIDGE_SECRET) return res.status(403).json({ error: "Unauthorized" });
  }

  next();
});

app.use(express.static(projectRoot));

// Routes
app.get("/api/system-media/current", (req, res) => {
  const preferred = req.query.source || "";
  res.json(buildSnapshot(preferred));
});

app.post("/api/system-media/action", async (req, res) => {
  const action = `${req.body?.action || ""}`.trim().toLowerCase();
  const appPackage = `${req.body?.appPackage || ""}`.trim();
  const preferredSource = req.body?.preferredSource || req.query.source || "";

  if (action === "open_uri") {
    if (!ALLOW_OPEN_URI) return res.status(403).json({ error: "open_uri disabled" });
    const uri = `${req.body?.uri || ""}`.trim();
    if (!uri) return res.status(400).json({ error: "Missing URI" });
    spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
    return res.json({ ok: true });
  }

  if (!MEDIA_KEY_CODES[action]) return res.status(400).json({ error: "Invalid action" });

  res.json({ ok: true, status: "queued" });
  
  await sendSystemMediaKey(action, appPackage, preferredSource);
  if (enableRemoteMediaSync) {
    setTimeout(() => syncToSupabase(buildSnapshot(preferredSource)), 200);
  }
});

app.post("/api/activity/report", async (req, res) => {
  const { activity } = req.body;
  if (!activity) return res.status(400).json({ error: "Missing activity data" });
  const success = await reportLocalActivity(activity);
  res.json({ ok: success });
});

app.get("/", (req, res) => res.sendFile(path.join(projectRoot, "index.html")));

// Initialize Sync
if (enableRemoteMediaSync && userId) {
  console.log(`[Bridge] Remote media sync active for ${userId}`);
  setInterval(() => syncToSupabase(), 5000);

  supabase.channel('media_actions').on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'system_media_actions', filter: `user_id=eq.${userId}`
  }, async (payload) => {
    const { action, app_package, uri } = payload.new;
    const pref = payload.new?.payload?.preferredSource || "";
    console.log(`[Bridge] Remote command: ${action}`);

    if (action === "open_uri") {
      if (uri && ALLOW_OPEN_URI) {
        spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process "${uri.replace(/"/g, '`"')}"`], { windowsHide: true });
      }
    } else {
      await sendSystemMediaKey(action, app_package, pref);
    }
    await syncToSupabase(buildSnapshot(pref));
  }).subscribe();
}

app.listen(port, "127.0.0.1", () => {
  console.log(`[Bridge] Server running on http://localhost:${port}`);
});
