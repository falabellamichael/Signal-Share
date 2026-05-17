import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createStrictAiTools, STRICT_TOOL_POLICY } from "./strict-ai-tools.js";

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
Do not output planning or audits. Output only code blocks or edit blocks.

${STRICT_TOOL_POLICY}`;

const CORS_WHITELIST = [
  "https://signal-share.pages.dev",
  "https://signal-share.com",
  "https://falabellamichael.github.io",
  "http://localhost",
  "http://127.0.0.1"
];

const OLLAMA_BASE_URL = process.env.SIGNAL_SHARE_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = process.env.SIGNAL_SHARE_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "llama3.1";
const LM_STUDIO_BASE_URL = process.env.SIGNAL_SHARE_LM_STUDIO_BASE_URL
  || process.env.LM_STUDIO_BASE_URL
  || process.env.LMSTUDIO_BASE_URL
  || "http://127.0.0.1:1234";
const DEFAULT_LM_STUDIO_MODEL = process.env.SIGNAL_SHARE_LM_STUDIO_MODEL
  || process.env.LM_STUDIO_MODEL
  || process.env.LMSTUDIO_MODEL
  || "local-model";

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
    || process.env.SIGNAL_SHARE_LM_STUDIO_MODEL
    || process.env.LM_STUDIO_MODEL
    || process.env.LMSTUDIO_MODEL
    || process.env.SIGNAL_SHARE_OLLAMA_MODEL
    || process.env.OLLAMA_MODEL
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
  if (userMessage) {
    messages.push({ role: "user", content: userMessage });
  } else if (!messages.some(m => m.role === "user")) {
    messages.push({ role: "user", content: "Continue" });
  }
  return messages;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timeout = Number(timeoutMs) > 0
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callOpenAiCompatibleProvider({ chatUrl, messages, model, temperature, providerLabel = "OpenAI-compatible provider" }) {
  const payload = {
    messages,
    temperature,
    stream: false
  };

  const selectedModel = `${model || ""}`.trim();
  if (selectedModel) payload.model = selectedModel;

  const response = await fetchWithTimeout(chatUrl, {
    method: "POST",
    headers: getAiHeaders(),
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${providerLabel} returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    return sanitizeModelReply(raw);
  }

  return sanitizeModelReply(
    data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.message?.content
    || data?.reply
    || data?.response
    || ""
  );
}

async function getOpenAiCompatibleModelIds(baseUrl = "") {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];

  try {
    const response = await fetchWithTimeout(`${base}/v1/models`, {
      method: "GET",
      headers: getAiHeaders()
    }, 1500);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows
      .map((row) => `${row?.id || row?.model || ""}`.trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

async function getLmStudioModelIds() {
  return getOpenAiCompatibleModelIds(LM_STUDIO_BASE_URL);
}

async function getOllamaModelIds() {
  const base = normalizeBaseUrl(OLLAMA_BASE_URL);
  if (!base) return [];

  try {
    const response = await fetchWithTimeout(`${base}/api/tags`, { method: "GET" }, 1500);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    const models = Array.isArray(data?.models) ? data.models : [];
    return models
      .map((model) => `${model?.name || model?.model || ""}`.trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

async function callOllamaProvider({ messages, model, temperature }) {
  const base = normalizeBaseUrl(OLLAMA_BASE_URL);
  if (!base) throw new Error("Ollama base URL is not configured.");

  const availableModels = await getOllamaModelIds();
  const requested = `${model || ""}`.trim();
  const selectedModel = requested && requested !== "auto"
    ? requested
    : (availableModels[0] || DEFAULT_OLLAMA_MODEL);

  if (!selectedModel) throw new Error("No Ollama model is available.");

  const response = await fetchWithTimeout(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      stream: false,
      options: {
        temperature
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Ollama provider returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    return sanitizeModelReply(raw);
  }

  return sanitizeModelReply(data?.message?.content || data?.response || "");
}

async function getProviderCandidates(model = "auto") {
  const candidates = [];
  const configuredChatUrl = getConfiguredChatUrl();
  if (configuredChatUrl) {
    candidates.push({
      id: "configured-openai-compatible",
      type: "openai-compatible",
      chatUrl: configuredChatUrl,
      model: getConfiguredModel(model),
      providerLabel: "configured OpenAI-compatible provider"
    });
  }

  const lmStudioBase = normalizeBaseUrl(LM_STUDIO_BASE_URL);
  if (lmStudioBase) {
    const lmStudioModels = await getLmStudioModelIds();
    const requested = getConfiguredModel(model);
    candidates.push({
      id: "lm-studio",
      type: "openai-compatible",
      chatUrl: `${lmStudioBase}/v1/chat/completions`,
      model: requested || lmStudioModels[0] || DEFAULT_LM_STUDIO_MODEL,
      providerLabel: "LM Studio provider"
    });
  }

  const ollamaModels = await getOllamaModelIds();
  if (ollamaModels.length > 0) {
    candidates.push({
      id: "ollama",
      type: "ollama",
      model: getConfiguredModel(model) || ollamaModels[0]
    });
  }

  return candidates;
}

async function getChatResponse(message, history = [], pageContext = "", _depth = 0, attachment = null, model = "auto", customInstructions = "") {
  if (!message && (!Array.isArray(history) || history.length === 0)) return "No message provided.";

  const messages = buildMessages({ message, history, pageContext, customInstructions });
  if (attachment?.text) {
    messages.push({ role: "user", content: `Attached content:\n${attachment.text}` });
  }

  const temperature = Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE || 0.7);
  const candidates = await getProviderCandidates(model);

  if (candidates.length === 0) {
    const error = new Error("No configured or auto-detected AI provider is available.");
    error.code = "AI_PROVIDER_UNAVAILABLE";
    throw error;
  }

  const failures = [];

  for (const candidate of candidates) {
    try {
      const reply = candidate.type === "ollama"
        ? await callOllamaProvider({ messages, model: candidate.model, temperature })
        : await callOpenAiCompatibleProvider({ chatUrl: candidate.chatUrl, messages, model: candidate.model, temperature, providerLabel: candidate.providerLabel });

      if (reply) return reply;
      failures.push(`${candidate.id}: empty response`);
    } catch (error) {
      failures.push(`${candidate.id}: ${error?.message || error}`);
    }
  }

  const error = new Error(`No AI provider returned a usable reply. ${failures.join(" | ")}`);
  error.code = "AI_PROVIDER_UNAVAILABLE";
  throw error;
}

async function getLocalModelCatalog() {
  const configuredModel = getConfiguredModel("auto");
  const configuredRows = [];
  const lmStudioModels = await getLmStudioModelIds();
  const ollamaModels = await getOllamaModelIds();
  const rows = [];

  if (configuredModel || getConfiguredChatUrl()) {
    configuredRows.push({ id: configuredModel || "configured", provider: "configured" });
  }

  for (const row of configuredRows) rows.push(row);
  for (const modelId of lmStudioModels) rows.push({ id: modelId, provider: "lm-studio" });
  if (lmStudioModels.length === 0 && normalizeBaseUrl(LM_STUDIO_BASE_URL)) {
    rows.push({ id: DEFAULT_LM_STUDIO_MODEL, provider: "lm-studio" });
  }
  for (const modelId of ollamaModels) rows.push({ id: modelId, provider: "ollama" });

  return {
    all: rows.map((row) => row.id),
    rows,
    configured: Boolean(getConfiguredChatUrl() || rows.length > 0),
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

function normalizeIntentText(value = "") {
  return `${value || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyServerStrictIntent(message = "") {
  const raw = `${message || ""}`.trim();
  const text = normalizeIntentText(raw);
  if (!text) return { tool: "chat.only", allowed: true };

  const baseIntent = strictAiTools?.classifyStrictToolIntent?.(raw);
  if (baseIntent && baseIntent.tool !== "chat.only" && baseIntent.allowed) return baseIntent;

  const searchMatch = raw.match(/^(?:search|look up|lookup|duckduckgo)\s+(?:for\s+)?(.+)$/i);
  if (searchMatch?.[1]?.trim()) {
    return { tool: "duckduckgo.search", allowed: true, query: searchMatch[1].trim() };
  }

  const appMap = [
    { id: "spotify", words: ["spotify"] },
    { id: "notepad", words: ["notepad", "note pad", "notes"] },
    { id: "calculator", words: ["calculator", "calc"] },
    { id: "file-explorer", words: ["file explorer", "explorer", "files"] },
    { id: "chrome", words: ["chrome", "google chrome"] },
    { id: "edge", words: ["edge", "microsoft edge", "ms edge"] },
    { id: "vscode", words: ["vscode", "vs code", "visual studio code"] },
    { id: "discord", words: ["discord"] },
    { id: "steam", words: ["steam"] }
  ];

  if (/^(open|launch|start)\b/.test(text)) {
    const app = appMap.find((row) => row.words.some((word) => text.includes(normalizeIntentText(word))));
    if (app) return { tool: "pc.open_app", allowed: true, appId: app.id };
    return { tool: "pc.open_app", allowed: false, reason: "Requested app is not allowlisted." };
  }

  const mediaActionMap = [
    { action: "play_pause", words: ["play pause", "play/pause", "pause", "play"] },
    { action: "next", words: ["next", "skip"] },
    { action: "previous", words: ["previous", "back"] }
  ];

  const mediaAction = mediaActionMap.find((row) => row.words.some((word) => text === normalizeIntentText(word) || text.startsWith(`${normalizeIntentText(word)} `)));
  if (mediaAction && text.includes("spotify")) {
    return { tool: "pc.app_action", allowed: true, appId: "spotify", action: mediaAction.action };
  }

  if (baseIntent && baseIntent.tool !== "chat.only") return baseIntent;
  return { tool: "chat.only", allowed: true };
}

function formatDuckDuckGoReply(results = []) {
  const rows = Array.isArray(results) ? results : [];
  if (rows.length === 0) return "No DuckDuckGo results found.";
  return rows.map((result, index) => {
    const title = `${result?.title || "Untitled result"}`.trim();
    const url = `${result?.url || ""}`.trim();
    const snippet = `${result?.snippet || ""}`.trim();
    return `${index + 1}. ${title}\n${url}${snippet ? ` — ${snippet}` : ""}`;
  }).join("\n\n");
}

async function postLocalStrictTool(pathname, body = {}) {
  const response = await fetchWithTimeout(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, 30000);

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || data?.message || `Strict tool route failed: ${pathname}`);
  }
  return data;
}

async function handleStrictChatToolTurn(req, res, message = "") {
  const intent = classifyServerStrictIntent(message);
  if (!intent || intent.tool === "chat.only") return false;

  if (!intent.allowed) {
    res.json({ ok: true, reply: intent.reason || "Requested action is not available.", strictTool: true, intent });
    return true;
  }

  try {
    if (intent.tool === "duckduckgo.search") {
      const data = await postLocalStrictTool("/api/tools/duckduckgo/search", { query: intent.query, maxResults: 5 });
      return res.json({ ok: true, reply: formatDuckDuckGoReply(data.results), strictTool: true, tool: intent.tool, results: data.results });
    }

    if (intent.tool === "pc.open_app") {
      const data = await postLocalStrictTool("/api/system/apps/open", { appId: intent.appId });
      return res.json({ ok: true, reply: `Opened ${data.label || intent.appId}.`, strictTool: true, tool: intent.tool, appId: intent.appId });
    }

    if (intent.tool === "pc.app_action") {
      const data = await postLocalStrictTool("/api/system/apps/action", { appId: intent.appId, action: intent.action });
      return res.json({ ok: true, reply: `Ran ${intent.action} for ${data.appId || intent.appId}.`, strictTool: true, tool: intent.tool, appId: intent.appId, action: intent.action });
    }

    return res.json({ ok: true, reply: "Requested action is not available.", strictTool: true, intent });
  } catch (error) {
    console.error("[Bridge] Strict chat tool enforcement error:", error);
    res.status(500).json({ ok: false, error: error?.message || "Strict tool request failed.", strictTool: true, intent });
    return true;
  }
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

const strictAiTools = createStrictAiTools({ isAuthorized, fetchWithTimeout });
app.use(strictAiTools.router);

async function handleChatRoute(req, res) {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });

    const { message, history, pageContext, attachment, model, customInstructions } = req.body || {};
    if (!message && (!Array.isArray(history) || history.length === 0)) {
      return res.status(400).json({ ok: false, error: "No message provided." });
    }

    const strictToolHandled = await handleStrictChatToolTurn(req, res, message || "");
    if (strictToolHandled) return;

    const reply = await getChatResponse(message || "", history || [], pageContext || "", 0, attachment || null, model || "auto", customInstructions || "");
    return res.json({ ok: true, reply });
  } catch (error) {
    if (error?.code === "AI_PROVIDER_UNAVAILABLE") {
      console.warn("[Bridge] AI provider unavailable:", error.message);
      return res.status(503).json({ ok: false, error: "AI provider unavailable." });
    }

    console.error("[Bridge] Chat route error:", error);
    return res.status(500).json({ ok: false, error: "AI processing failed." });
  }
}

app.post("/api/llm/chat", handleChatRoute);
app.post("/api/local-llm/chat", handleChatRoute);

app.get("/api/llm/chat", (_req, res) => {
  res.json({ ok: true, status: "AI chat bridge is active.", configured: Boolean(getConfiguredChatUrl()) });
});

app.get("/api/local-llm/health", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, configured: catalog.configured, providers: catalog.rows.map((row) => row.provider), checkedAt: new Date().toISOString() });
});

app.get("/api/llm/models", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, models: catalog.rows, ...catalog });
});

app.get("/api/local-llm/models", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, models: catalog.rows, ...catalog });
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

app.get("/api/health", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, configured: catalog.configured, service: "Signal Share Backend", time: new Date().toISOString() });
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
  console.log(`[Bridge] AI endpoint configured: ${getConfiguredChatUrl() ? "YES" : "NO"}`);
  console.log(`[Bridge] LM Studio auto-detect enabled at ${normalizeBaseUrl(LM_STUDIO_BASE_URL) || "unavailable"}`);
  console.log(`[Bridge] Ollama auto-detect enabled at ${normalizeBaseUrl(OLLAMA_BASE_URL) || "unavailable"}`);
});
