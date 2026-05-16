import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "backend", ".env") });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const app = express();
const port = Number(process.env.PORT || 3000);
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const LOCAL_LLM_TOKEN = process.env.SIGNAL_SHARE_LOCAL_LLM_TOKEN || "";

const SYSTEM_PROMPT = `You are a helpful assistant for the Signal Share Arcade.

When the user asks to publish a game, output the code inside markdown code blocks with filename annotations.
Example:
\`\`\`html filename=index.html
<!DOCTYPE html>
<html>
...
</html>
\`\`\`

When editing a game, use the surgical edit format:
[EDIT: filename]
SEARCH:
Exact code to replace
REPLACE:
New code to insert
[/EDIT]

The SEARCH block must match the existing file content exactly, including whitespace.
Do not output planning or audits. Output only code blocks or edit blocks.`;

const CORS_WHITELIST = [
  "https://signal-share.pages.dev",
  "https://signal-share.com",
  "https://falabellamichael.github.io",
  "http://localhost",
  "http://127.0.0.1"
];

function normalizeBaseUrl(value = "") {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

function getConfiguredChatUrl() {
  const explicit = normalizeBaseUrl(
    process.env.SIGNAL_SHARE_AI_CHAT_URL
    || process.env.SIGNAL_SHARE_LOCAL_LLM_CHAT_URL
    || process.env.OPENAI_CHAT_URL
    || ""
  );
  if (explicit) return explicit;

  const base = normalizeBaseUrl(
    process.env.SIGNAL_SHARE_AI_BASE_URL
    || process.env.SIGNAL_SHARE_LOCAL_LLM_URL
    || process.env.OPENAI_BASE_URL
    || process.env.OPENAI_API_BASE
    || ""
  );
  if (!base) return "";
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function getConfiguredModel(requestedModel = "") {
  const requested = `${requestedModel || ""}`.trim();
  if (requested && requested !== "auto") return requested;
  return process.env.SIGNAL_SHARE_AI_MODEL
    || process.env.SIGNAL_SHARE_LOCAL_LLM_MODEL
    || process.env.OPENAI_MODEL
    || "";
}

function getAiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const apiKey = process.env.SIGNAL_SHARE_AI_API_KEY || process.env.OPENAI_API_KEY || "";
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function sanitizeModelReply(value = "") {
  return `${value || ""}`.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function buildMessages({ message = "", history = [], pageContext = "", customInstructions = "" } = {}) {
  const messages = [];
  messages.push({ role: "system", content: [SYSTEM_PROMPT, customInstructions].filter(Boolean).join("\n\n") });

  if (pageContext) {
    messages.push({ role: "system", content: `Current page context:\n${pageContext}` });
  }

  for (const entry of Array.isArray(history) ? history : []) {
    const role = entry?.role === "assistant" ? "assistant" : "user";
    const content = `${entry?.content || entry?.text || ""}`.trim();
    if (content) messages.push({ role, content });
  }

  const userMessage = `${message || ""}`.trim();
  if (userMessage) messages.push({ role: "user", content: userMessage });
  return messages;
}

async function getChatResponse(message, history = [], pageContext = "", _depth = 0, attachment = null, model = "auto", customInstructions = "") {
  if (!message && (!Array.isArray(history) || history.length === 0)) return "No message provided.";

  const chatUrl = getConfiguredChatUrl();
  if (!chatUrl) {
    return "Local AI endpoint is not configured. Set SIGNAL_SHARE_AI_BASE_URL or SIGNAL_SHARE_AI_CHAT_URL for the bridge.";
  }

  const messages = buildMessages({ message, history, pageContext, customInstructions });
  if (attachment?.text) {
    messages.push({ role: "user", content: `Attached content:\n${attachment.text}` });
  }

  const payload = {
    messages,
    temperature: Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE || 0.7),
    stream: false
  };

  const selectedModel = getConfiguredModel(model);
  if (selectedModel) payload.model = selectedModel;

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: getAiHeaders(),
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    if (!response.ok) {
      console.warn(`[Chatbot] Configured AI endpoint returned ${response.status}:`, raw.slice(0, 500));
      return "Configured AI endpoint returned an error. Check the bridge/provider settings and try again.";
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      return sanitizeModelReply(raw) || "The configured AI endpoint returned an empty response.";
    }

    const reply = data?.choices?.[0]?.message?.content
      || data?.choices?.[0]?.text
      || data?.message?.content
      || data?.reply
      || data?.response
      || "";

    return sanitizeModelReply(reply) || "The configured AI endpoint returned an empty response.";
  } catch (error) {
    console.warn("[Chatbot] Configured AI endpoint request failed:", error);
    return "Configured AI endpoint is unavailable. Check the bridge/provider settings and try again.";
  }
}

async function getLocalModelCatalog() {
  const configuredModel = getConfiguredModel("auto");
  return {
    all: configuredModel ? [configuredModel] : [],
    configured: Boolean(getConfiguredChatUrl()),
    checkedAt: new Date().toISOString()
  };
}

function isAuthorized(req) {
  const isLoopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (isLoopback) return true;
  if (!BRIDGE_SECRET && !LOCAL_LLM_TOKEN) return true;

  const bridgeSecret = req.headers["x-bridge-secret"] || req.headers["X-Bridge-Secret"] || "";
  const localToken = req.headers["x-local-llm-token"] || req.headers["X-Local-LLM-Token"] || "";
  return Boolean((BRIDGE_SECRET && bridgeSecret === BRIDGE_SECRET) || (LOCAL_LLM_TOKEN && localToken === LOCAL_LLM_TOKEN));
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const isWhitelisted = origin && CORS_WHITELIST.some((allowed) => origin.startsWith(allowed));
  const isLocalhost = !origin || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("::1");

  res.setHeader("Access-Control-Allow-Origin", isWhitelisted || isLocalhost ? (origin || "*") : "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, x-bridge-secret, X-Local-LLM-Token, x-local-llm-token, Authorization, Target-Address-Space, target-address-space, X-Requested-With, x-requested-with, Access-Control-Allow-Private-Network");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin, Access-Control-Request-Private-Network");

  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

async function handleChatRoute(req, res) {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });

    const { message, history, pageContext, attachment, model, customInstructions } = req.body || {};
    if (!message && (!Array.isArray(history) || history.length === 0)) {
      return res.status(400).json({ ok: false, error: "No message provided." });
    }

    const reply = await getChatResponse(message || "", history || [], pageContext || "", 0, attachment || null, model || "auto", customInstructions || "");
    return res.json({ ok: true, reply });
  } catch (error) {
    console.error("[Bridge] Chat route error:", error);
    return res.status(500).json({ ok: false, error: "AI processing failed." });
  }
}

app.post("/api/llm/chat", handleChatRoute);
app.post("/api/local-llm/chat", handleChatRoute);

app.get("/api/llm/chat", (_req, res) => {
  res.json({ ok: true, status: "AI chat bridge is active.", configured: Boolean(getConfiguredChatUrl()) });
});

app.get("/api/local-llm/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(getConfiguredChatUrl()), checkedAt: new Date().toISOString() });
});

app.get("/api/llm/models", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, models: catalog.all.map((id) => ({ id, provider: "configured" })), ...catalog });
});

app.get("/api/local-llm/models", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, models: catalog.all.map((id) => ({ id, provider: "configured" })), ...catalog });
});

app.get("/api/system-media/current", (_req, res) => {
  res.json({
    active: false,
    playbackState: "none",
    title: "No media detected",
    meta: "",
    artworkUri: "",
    openUri: "",
    preferredSource: "",
    sourceProvider: "",
    smtcHealthy: true,
    smtcFailureCount: 0,
    smtcError: "",
    stale: false
  });
});

app.post("/api/system-media/action", (req, res) => {
  res.json({ ok: true, action: req.body?.action || "", message: "Media control route is available." });
});

app.get("/api/system/apps", (_req, res) => {
  res.json({ apps: [] });
});

app.get("/api/system/tabs", (_req, res) => {
  res.json({ tabs: [] });
});

app.get("/api/system/screenshot", (_req, res) => {
  res.status(501).json({ error: "Screenshot capture is not enabled in this backend build." });
});

app.post("/api/security/verify-master", (req, res) => {
  const email = `${req.body?.email || ""}`.trim().toLowerCase();
  const masterEmail = `${process.env.SIGNAL_SHARE_MASTER_EMAIL || ""}`.trim().toLowerCase();
  const isMaster = Boolean(masterEmail && email && email === masterEmail);
  res.json({ isMaster, role: isMaster ? "master" : "user" });
});

app.get("/api/security/audit", (_req, res) => {
  res.json({ ok: true, checks: [], generatedAt: new Date().toISOString() });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(getConfiguredChatUrl()), service: "Signal Share Backend", time: new Date().toISOString() });
});

app.use(express.static(projectRoot));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "API route not found." });
  }
  return res.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[Bridge] Signal Share backend listening on http://0.0.0.0:${port}`);
  console.log(`DEBUG process.env.SIGNAL_SHARE_AI_BASE_URL: ${process.env.SIGNAL_SHARE_AI_BASE_URL}`);
  console.log(`DEBUG getConfiguredChatUrl(): ${getConfiguredChatUrl()}`);
  console.log(`[Bridge] AI endpoint configured: ${getConfiguredChatUrl() ? "YES" : "NO"}`);
});
