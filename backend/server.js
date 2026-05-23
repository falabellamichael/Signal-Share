import express from "express";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(process.cwd(), "backend", ".env") });
dotenv.config();

import mediaController from "./controllers/mediaController.js";

// Import strict AI tools for LLM/chat functionality
import { createStrictAiTools } from "./strict-ai-tools.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const BRIDGE_SECRET = process.env.SIGNAL_SHARE_BRIDGE_SECRET || "";
const LOCAL_LLM_TOKEN = process.env.SIGNAL_SHARE_LOCAL_LLM_TOKEN || "";

const OLLAMA_BASE_URL = process.env.SIGNAL_SHARE_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = process.env.SIGNAL_SHARE_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "llama3.1";
const LM_STUDIO_BASE_URL = process.env.SIGNAL_SHARE_LM_STUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234";
const LM_STUDIO_API_TOKEN = `${process.env.SIGNAL_SHARE_LM_STUDIO_API_TOKEN || process.env.LM_STUDIO_API_TOKEN || ""}`.trim();
const LM_STUDIO_MCP_CONFIG_PATH = path.join(os.homedir(), ".lmstudio", "mcp.json");
const LM_STUDIO_MCP_CONTEXT_LENGTH = parseBoundedInteger(process.env.SIGNAL_SHARE_LM_STUDIO_MCP_CONTEXT_LENGTH, 8000, 1024, 131072);
const LM_STUDIO_MAX_MCP_SELECTIONS = 16;
const AI_TEMPERATURE = Number.isFinite(Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE))
  ? Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE)
  : 0.7;

function parseBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeLmStudioPluginId(value = "") {
  const id = `${value || ""}`.trim();
  return /^mcp\/[a-z0-9][a-z0-9._/-]{0,119}$/i.test(id) ? id : "";
}

function normalizeLmStudioMcpSelection(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => normalizeLmStudioPluginId(typeof entry === "string" ? entry : entry?.id))
    .filter(Boolean))]
    .slice(0, LM_STUDIO_MAX_MCP_SELECTIONS);
}

function normalizeLmStudioMcpToolName(value = "") {
  const toolName = `${value || ""}`.trim();
  return /^[a-z][a-z0-9._:/-]{0,119}$/i.test(toolName) ? toolName : "";
}

function extractExplicitLmStudioMcpTools(message = "") {
  const directive = `${message || ""}`.match(/(?:^|\r?\n)\s*\/mcp\s+([a-z][a-z0-9._:/-]{0,119})(?=\s|$)/i);
  const toolName = normalizeLmStudioMcpToolName(directive?.[1]);
  return toolName ? [toolName] : [];
}

async function readLmStudioMcpCatalog() {
  try {
    const raw = await readFile(LM_STUDIO_MCP_CONFIG_PATH, "utf8");
    const config = JSON.parse(raw);
    const servers = config?.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : {};
    const plugins = Object.keys(servers)
      .map((label) => {
        const id = normalizeLmStudioPluginId(`mcp/${label}`);
        return id ? { id, label } : null;
      })
      .filter(Boolean)
      .slice(0, LM_STUDIO_MAX_MCP_SELECTIONS);
    return { installed: true, plugins };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { installed: false, plugins: [] };
    }
    throw new Error("Unable to read the local LM Studio MCP configuration.");
  }
}

async function resolveLmStudioMcpIntegrations(requestedPluginIds = [], allowedTools = []) {
  const selectedIds = normalizeLmStudioMcpSelection(requestedPluginIds);
  const explicitTools = allowedTools.map(normalizeLmStudioMcpToolName).filter(Boolean).slice(0, 1);
  if (selectedIds.length === 0 || explicitTools.length === 0) return [];
  const catalog = await readLmStudioMcpCatalog();
  const installedIds = new Set(catalog.plugins.map((plugin) => plugin.id));
  return selectedIds
    .filter((id) => installedIds.has(id))
    .map((id) => ({ type: "plugin", id, allowed_tools: explicitTools }));
}

function getLmStudioRequestHeaders() {
  return LM_STUDIO_API_TOKEN
    ? { Authorization: `Bearer ${LM_STUDIO_API_TOKEN}` }
    : {};
}

function isLmStudioMcpReady(integrations = []) {
  return integrations.length > 0 && Boolean(LM_STUDIO_API_TOKEN);
}

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

function normalizeConversationId(value = "") {
  return `${value || ""}`.trim();
}

function sanitizeHistoryForConversation(history, conversationId = "") {
  if (!Array.isArray(history)) return [];
  const activeConversationId = normalizeConversationId(conversationId);
  if (!activeConversationId) return [];
  return history
    .map((entry) => {
      const entryConversationId = normalizeConversationId(entry?.conversationId || entry?.chatId || "");
      return {
        role: entry?.role === "assistant" ? "assistant" : "user",
        content: `${entry?.content || entry?.text || ""}`.trim(),
        conversationId: entryConversationId
      };
    })
    .filter((entry) => {
      if (!entry.content) return false;
      if (entry.conversationId && entry.conversationId !== activeConversationId) return false;
      return true;
    })
    .map(({ role, content }) => ({ role, content }))
    .slice(-12);
}

function buildMessages({ message = "", history = [], pageContext = "", customInstructions = "", conversationId = "" } = {}) {
  const messages = [];
  messages.push({ role: "system", content: `You are a helpful assistant for Signal Share — a social platform.` });
  messages.push({ role: "system", content: "Never emit [LIST_FILES], [READ_FILE], or [WRITE_FILE] action tags. File MCP tools are available only when explicitly authorized for the current user request." });
  if (`${customInstructions || ""}`.trim()) {
    messages.push({ role: "system", content: `${customInstructions}`.trim() });
  }
  if (pageContext) {
    messages.push({ role: "system", content: `Current page context:\n${pageContext}` });
  }
  for (const entry of sanitizeHistoryForConversation(history, conversationId)) {
    messages.push(entry);
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

async function getProviderCandidates(model = "auto", { lmStudioMcpIntegrations = [] } = {}) {
  const candidates = [];
  const lmStudioBase = normalizeBaseUrl(LM_STUDIO_BASE_URL);
  const lmStudioModels = await getLmStudioModelIds();
  if (lmStudioBase && lmStudioModels.length > 0) {
    if (isLmStudioMcpReady(lmStudioMcpIntegrations)) {
      candidates.push({
        id: "lm-studio-mcp",
        type: "lm-studio-mcp",
        model: model === "auto" ? lmStudioModels[0] : model,
        providerLabel: "LM Studio MCP provider"
      });
      return candidates;
    }
    candidates.push({
      id: "lm-studio",
      type: "openai-compatible",
      chatUrl: `${lmStudioBase}/v1/chat/completions`,
      model: model === "auto" ? lmStudioModels[0] : model,
      providerLabel: "LM Studio provider"
    });
  }
  const ollamaModels = await getOllamaModelIds();
  if (ollamaModels.length > 0) {
    candidates.push({
      id: "ollama",
      type: "ollama",
      model: model === "auto" ? ollamaModels[0] : model
    });
  }
  return candidates;
}

async function getLmStudioModelIds() {
  const base = normalizeBaseUrl(LM_STUDIO_BASE_URL);
  if (!base) return [];
  try {
    const response = await fetchWithTimeout(`${base}/v1/models`, {
      method: "GET",
      headers: getLmStudioRequestHeaders()
    }, 1500);
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    const models = Array.isArray(data?.data) ? data.data : [];
    return models
      .map((model) => `${model?.id || ""}`.trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
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

async function callOpenAiCompatibleProvider({ chatUrl, messages, model, temperature }) {
  const selectedModel = `${model || ""}`.trim();
  if (!chatUrl || !selectedModel) {
    throw new Error("LM Studio chat model is unavailable.");
  }

  const response = await fetchWithTimeout(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getLmStudioRequestHeaders()
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature,
      stream: false
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`LM Studio provider returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }

  const data = JSON.parse(raw);
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => typeof part === "string" ? part : `${part?.text || ""}`)
      .join("");
  }
  return typeof data?.choices?.[0]?.text === "string" ? data.choices[0].text : "";
}

function buildLmStudioMcpSystemPrompt(messages = [], integrations = []) {
  const systemPrompt = messages
    .filter((entry) => entry?.role === "system" && typeof entry.content === "string")
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const websiteFilesGuidance = integrations.some((integration) => integration?.id === "mcp/website-files")
    ? "For the mcp/website-files filesystem tool only, safe project-relative paths in the user request have already been resolved for tool use. Do not mention absolute local paths unless the user explicitly asks for them."
    : "";
  const priorTurns = messages
    .filter((entry) => entry?.role !== "system" && typeof entry.content === "string")
    .slice(0, -1)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content.trim()}`)
    .filter((entry) => !entry.endsWith(": "));

  if (priorTurns.length === 0) return [systemPrompt, websiteFilesGuidance].filter(Boolean).join("\n\n");
  return [
    systemPrompt,
    websiteFilesGuidance,
    "Recent conversation transcript for continuity only:",
    "<conversation_history>",
    priorTurns.join("\n"),
    "</conversation_history>"
  ].filter(Boolean).join("\n\n");
}

function getLastUserMessage(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.role === "user" && typeof entry.content === "string" && entry.content.trim()) {
      return entry.content.trim();
    }
  }
  return "Continue";
}

function resolveWebsiteFilesMcpInput(input = "", integrations = []) {
  const text = `${input || ""}`;
  if (!integrations.some((integration) => integration?.id === "mcp/website-files")) return text;

  return text.replace(/(^|[\s("'`])(\.\/[^\s)"'`,;:!?]+)/g, (match, prefix, reference) => {
    const resolvedPath = path.resolve(projectRoot, reference.slice(2));
    const relativePath = path.relative(projectRoot, resolvedPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return match;
    return `${prefix}${resolvedPath}`;
  });
}

function extractLmStudioMcpReply(data) {
  if (!Array.isArray(data?.output)) return "";
  for (let index = data.output.length - 1; index >= 0; index -= 1) {
    const item = data.output[index];
    if (item?.type === "message" && typeof item.content === "string" && item.content.trim()) {
      return item.content.trim();
    }
  }
  return "";
}

async function callLmStudioMcpProvider({ messages, model, temperature, integrations = [] }) {
  const base = normalizeBaseUrl(LM_STUDIO_BASE_URL);
  const selectedModel = `${model || ""}`.trim();
  if (!base || !selectedModel) {
    throw new Error("LM Studio MCP chat model is unavailable.");
  }
  if (!isLmStudioMcpReady(integrations)) {
    throw new Error("LM Studio MCP tools require a user selection and an API token.");
  }

  const response = await fetchWithTimeout(`${base}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getLmStudioRequestHeaders()
    },
    body: JSON.stringify({
      model: selectedModel,
      input: resolveWebsiteFilesMcpInput(getLastUserMessage(messages), integrations),
      system_prompt: buildLmStudioMcpSystemPrompt(messages, integrations),
      integrations,
      context_length: LM_STUDIO_MCP_CONTEXT_LENGTH,
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0)),
      store: false,
      stream: false
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`LM Studio MCP provider returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
  }

  const data = JSON.parse(raw);
  const reply = extractLmStudioMcpReply(data);
  if (!reply) {
    throw new Error("LM Studio MCP provider returned no final assistant message.");
  }
  return reply;
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
    return raw;
  }
  return data?.message?.content || data?.response || "";
}

async function getChatResponse({ message, history, pageContext, customInstructions, conversationId, model, lmStudioMcpIntegrations = [] } = {}) {
  const messages = buildMessages({ message, history, pageContext, customInstructions, conversationId });
  const providers = await getProviderCandidates(model, { lmStudioMcpIntegrations });
  if (lmStudioMcpIntegrations.length > 0 && !providers.some((provider) => provider.type === "lm-studio-mcp")) {
    throw new Error("Selected LM Studio MCP tools require a running LM Studio server with an available chat model.");
  }
  if (providers.length === 0) {
    throw new Error("No local chat provider is available. Start LM Studio Local Server or Ollama and load a chat model.");
  }

  const providerErrors = [];
  for (const provider of providers) {
    try {
      const reply = provider.type === "lm-studio-mcp"
        ? await callLmStudioMcpProvider({
            messages,
            model: provider.model,
            temperature: AI_TEMPERATURE,
            integrations: lmStudioMcpIntegrations
          })
        : provider.type === "openai-compatible"
          ? await callOpenAiCompatibleProvider({
            chatUrl: provider.chatUrl,
            messages,
            model: provider.model,
            temperature: AI_TEMPERATURE
          })
        : await callOllamaProvider({
            messages,
            model: provider.model,
            temperature: AI_TEMPERATURE
          });
      if (`${reply || ""}`.trim()) return `${reply}`.trim();
      providerErrors.push(`${provider.providerLabel || provider.id} returned an empty reply.`);
    } catch (error) {
      providerErrors.push(`${provider.providerLabel || provider.id} failed: ${error?.message || error}`);
    }
  }

  throw new Error(providerErrors.join(" | ") || "Local AI chat failed.");
}

const STRICT_TOOL_POLICY = `STRICT TOOL USAGE: Only respond when explicitly requested with /publish or matching intent. Otherwise, respond conversationally.`;

function hasAuthorizedBridgeCredential(req) {
  const bridgeSecret = req.headers["x-bridge-secret"] || req.headers["X-Bridge-Secret"] || "";
  const localToken = req.headers["x-local-llm-token"] || req.headers["X-Local-LLM-Token"] || "";
  return Boolean((BRIDGE_SECRET && bridgeSecret === BRIDGE_SECRET) || (LOCAL_LLM_TOKEN && localToken === LOCAL_LLM_TOKEN));
}

function isAuthorized(req) {
  const isLoopback = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
  if (isLoopback) return true;
  if (!BRIDGE_SECRET && !LOCAL_LLM_TOKEN) return true;
  return hasAuthorizedBridgeCredential(req);
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, x-bridge-secret, X-Local-LLM-Token, x-local-llm-token, Authorization, Target-Address-Space");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// Initialize strict AI tools router after shared parsing and CORS middleware.
const strictAiTools = createStrictAiTools({ isAuthorized, fetchWithTimeout });
app.use(strictAiTools.router);

// Media action endpoint for Play/Pause, Next/Previous commands
app.post("/api/system/media/action", async (req, res) => {
  try {
    const { action } = req.body || {};
    
    if (!action) {
      return res.status(400).json({ ok: false, error: "Action parameter is required" });
    }

    console.log(`[Media] Received command for action: ${action}`);
    
    const result = await mediaController.executeMediaAction(action);
    
    if (result.ok) {
      return res.json({ 
        ok: true, 
        message: `Successfully executed ${action}`,
        sessionId: result.sessionId || 'unknown',
        sourceAppId: result.sourceAppId || ''
      });
    } else {
      return res.status(500).json({ 
        ok: false, 
        error: result.error || "Media action failed",
        details: result.details || null
      });
    }
  } catch (error) {
    console.error("[Media] Action endpoint error:", error.message);
    return res.status(500).json({ 
      ok: false, 
      error: `Failed to execute media action: ${error.message}` 
    });
  }
});

// New endpoint for opening media URIs (Spotify links, Phone Link)
app.post("/api/system/media/open-uri", async (req, res) => {
  try {
    const { uri } = req.body || {};
    
    if (!uri) {
      return res.status(400).json({ ok: false, error: "URI parameter is required" });
    }

    console.log(`[Media] Opening URI: ${uri}`);
    
    const result = await mediaController.openMediaUri(uri);
    
    if (result.ok) {
      return res.json({ 
        ok: true, 
        message: `Opened ${uri}`,
        openedUri: result.openedUri || ''
      });
    } else {
      return res.status(500).json({ 
        ok: false, 
        error: result.error || "Failed to open URI" 
      });
    }
  } catch (error) {
    console.error("[Media] Open URI endpoint error:", error.message);
    return res.status(500).json({ 
      ok: false, 
      error: `Failed to open media URI: ${error.message}` 
    });
  }
});

// SMTC Query handler (existing functionality)
let smtcCache = { timestamp: 0, data: null, pendingPromise: null };

function getSMTCSnapshotSafe() {
  const now = Date.now();
  if (smtcCache.data && (now - smtcCache.timestamp < 1000)) {
    return Promise.resolve(smtcCache.data);
  }
  if (smtcCache.pendingPromise) {
    return smtcCache.pendingPromise;
  }
  smtcCache.pendingPromise = new Promise((resolve) => {
    let resolved = false;
    const workerPath = path.join(__dirname, "smtc-query.js");
    const child = fork(workerPath, [], { silent: true, execArgv: [] });
    let stdoutData = "";
    if (child.stdout) {
      child.stdout.on("data", (data) => {
        stdoutData += data.toString();
      });
    }
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn("[Bridge] SMTC query timed out. Terminating child process.");
        try { child.kill("SIGKILL"); } catch (_) {}
        resolve({ sessions: [], current: null });
      }
    }, 2000);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;
      try {
        const result = JSON.parse(stdoutData.trim());
        smtcCache.data = { sessions: result.sessions, current: result.current };
        smtcCache.timestamp = Date.now();
        resolve(smtcCache.data);
        return;
      } catch (err) {
        console.error("[Bridge] Failed to parse SMTC worker stdout:", err.message, "Stdout content:", stdoutData);
      }
      resolve({ sessions: [], current: null });
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;
      console.error("[Bridge] SMTC worker process error:", err);
      try { child.kill("SIGKILL"); } catch (_) {}
      resolve({ sessions: [], current: null });
    });
  }).finally(() => {
    smtcCache.pendingPromise = null;
  });
  return smtcCache.pendingPromise;
}

function mapPlaybackState(playbackStatus) {
  switch (playbackStatus) {
    case 4: return "playing"; // PLAYING
    case 5: return "paused";   // PAUSED
    default: return "none";
  }
}

async function getLocalModelCatalog() {
  const lmStudioModels = await getLmStudioModelIds();
  const ollamaModels = await getOllamaModelIds();
  const rows = [];
  for (const modelId of lmStudioModels) rows.push({ id: modelId, provider: "lm-studio" });
  for (const modelId of ollamaModels) rows.push({ id: modelId, provider: "ollama" });
  return {
    all: [...lmStudioModels, ...ollamaModels],
    rows,
    configured: rows.length > 0,
    checkedAt: new Date().toISOString()
  };
}

app.get("/api/system-media/current", async (req, res) => {
  const isWindows = process.platform === "win32";
  const base = { source: "windows-smtc", available: isWindows, active: false, playbackState: "none", title: "", meta: "", appPackage: "", smtcHealthy: isWindows, smtcFailureCount: 0, smtcError: "" };
  
  if (!isWindows) return res.json(base);

  try {
    const snapshot = await getSMTCSnapshotSafe();
    let session = null;
    const preferredSource = (req.query.preferredSource || req.query.source || "").toLowerCase().trim();
    
    if (preferredSource) {
      const sessions = snapshot.sessions;
      if (Array.isArray(sessions) && sessions.length > 0) {
        for (const s of sessions) {
          const appId = `${s.sourceAppId || ""}`.toLowerCase();
          const title = `${s.media?.title || ""}`.toLowerCase();
          if (appId.includes(preferredSource) || title.includes(preferredSource)) {
            session = s;
            break;
          }
        }
      }
    }

    if (!session) {
      session = snapshot.current;
    }

    if (!session) {
      return res.json(base);
    }

    const playbackState = mapPlaybackState(session.playback?.playbackStatus || 0);
    const sourceLabel = `${session.sourceAppId || ""}`.trim();
    const title = `${session.media?.title || ""}`.trim();
    const artist = `${session.media?.artist || session.media?.albumArtist || ""}`.trim();
    const meta = [sourceLabel, artist].filter(Boolean).join(" - ");

    res.json({
      ...base,
      active: playbackState !== "none",
      playbackState,
      title: title || "Now playing",
      meta,
      appPackage: `${session.sourceAppId || ""}`.trim(),
      smtcHealthy: true,
      stale: false
    });
  } catch (error) {
    console.error("SMTC error:", error);
    res.json({ ...base, smtcHealthy: false, smtcError: error?.message || "Unknown error" });
  }
});

app.get("/api/system/tabs", (_req, res) => {
  res.json({ tabs: [] });
});

app.get("/api/health", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, configured: catalog.configured, service: "Signal Share Backend", time: new Date().toISOString() });
});

// Strict chat tool enforcement (existing functionality)
async function handleStrictChatToolTurn(req, res, message = "") {
  const intent = normalizeIntentText(message);
  if (!intent || intent.length === 0) return false;
  
  const appMap = [
    { id: "spotify", words: ["spotify"] },
    { id: "notepad", words: ["notepad", "note pad", "notes"] },
    { id: "calculator", words: ["calculator", "calc"] }
  ];
  
  if (/^(open|launch|start)\b/.test(intent)) {
    const app = appMap.find((row) => row.words.some((word) => intent.includes(word)));
    if (app) {
      const data = await postLocalStrictTool("/api/system/apps/open", { appId: app.id });
      return res.json({ ok: true, reply: `Opened ${data.label || app.id}.`, strictTool: true });
    }
  }

  return false;
}

function normalizeIntentText(value = "") {
  return `${value || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function postLocalStrictTool(pathname, body = {}) {
  const response = await fetchWithTimeout(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, 30000);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Strict tool route failed: ${pathname}`);
  }
  return data;
}

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const isWhitelisted = origin && ["https://signal-share.pages.dev", "http://localhost"].some(allowed => origin.startsWith(allowed));
  res.setHeader("Access-Control-Allow-Origin", isWhitelisted ? (origin || "*") : "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

async function handleChatRoute(req, res) {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
    const { message, history, pageContext, attachment, model, customInstructions, lmStudioMcpTools } = req.body || {};
    const conversationId = normalizeConversationId(req.body?.conversationId || req.body?.chatId || "");
    if (!message && (!Array.isArray(history) || history.length === 0)) {
      return res.status(400).json({ ok: false, error: "No message provided." });
    }
    const requestedLmStudioMcpTools = normalizeLmStudioMcpSelection(lmStudioMcpTools);
    const explicitlyAllowedLmStudioMcpTools = extractExplicitLmStudioMcpTools(message);
    if (Array.isArray(lmStudioMcpTools) && lmStudioMcpTools.length > 0 && requestedLmStudioMcpTools.length === 0) {
      return res.status(400).json({ ok: false, error: "The LM Studio MCP tool selection is invalid." });
    }
    let lmStudioMcpIntegrations = [];
    if (explicitlyAllowedLmStudioMcpTools.length > 0 && requestedLmStudioMcpTools.length === 0) {
      return res.status(400).json({ ok: false, error: "Select an LM Studio MCP server in Security before using /mcp <tool_name>." });
    }
    if (requestedLmStudioMcpTools.length > 0 && explicitlyAllowedLmStudioMcpTools.length > 0) {
      if (!hasAuthorizedBridgeCredential(req)) {
        return res.status(403).json({ ok: false, error: "LM Studio MCP tools require a configured bridge secret or local LLM token." });
      }
      if (!LM_STUDIO_API_TOKEN) {
        return res.status(503).json({ ok: false, error: "LM Studio MCP tools require a private LM Studio API token in the backend configuration." });
      }
      lmStudioMcpIntegrations = await resolveLmStudioMcpIntegrations(requestedLmStudioMcpTools, explicitlyAllowedLmStudioMcpTools);
      if (lmStudioMcpIntegrations.length !== requestedLmStudioMcpTools.length) {
        return res.status(400).json({ ok: false, error: "One or more selected LM Studio MCP tools are no longer installed for this user." });
      }
    }

    // Check for media actions first
    const intent = normalizeIntentText(message);
    const mediaActions = ["play", "pause", "next", "previous", "spotify", "youtube"];
    if (mediaActions.some(action => intent.includes(action.toLowerCase()))) {
      await handleStrictChatToolTurn(req, res, message);
    } else if (intent.startsWith("open ")) {
        const app = intent.split(/\s+/)[1].toLowerCase();
        if (app === "spotify") {
            const result = await mediaController.openMediaUri("spotify:");
            return res.json({ ok: true, reply: `Opening Spotify in your default player...`, strictTool: true });
        }
    } else {
      // Call AI chat endpoint
      try {
        const reply = await getChatResponse({
          message,
          history,
          pageContext,
          customInstructions,
          conversationId,
          model,
          lmStudioMcpIntegrations
        });
        return res.json({ ok: true, reply });
      } catch (chatError) {
        console.warn("[Chat] AI endpoint error:", chatError.message);
        return res.status(503).json({ 
          ok: false, 
          error: chatError?.message || "AI chat unavailable - try /api/system/media/action for media commands" 
        });
      }
    }

  } catch (error) {
    console.error("[Chat] Route error:", error);
    return res.status(500).json({ ok: false, error: "Chat request failed." });
  }
}

app.post("/api/llm/chat", handleChatRoute);
app.post("/api/local-llm/chat", handleChatRoute);
app.get("/api/llm/models", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({ ok: true, models: catalog.rows });
});

app.get("/api/local-llm/models", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized local LLM request." });
  }
  try {
    const catalog = await getLocalModelCatalog();
    const models = Array.isArray(catalog?.rows) ? catalog.rows : [];
    return res.json({
      ok: true,
      models,
      providers: {
        local: catalog?.all || []
      },
      checkedAt: catalog?.checkedAt || new Date().toISOString()
    });
  } catch (error) {
    console.error("[Bridge] /api/local-llm/models error:", error);
    return res.status(500).json({ ok: false, error: "Failed to read local model catalog." });
  }
});

app.get("/api/local-llm/mcp-tools", async (req, res) => {
  if (!hasAuthorizedBridgeCredential(req)) {
    return res.status(403).json({ ok: false, error: "LM Studio MCP discovery requires a configured bridge secret or local LLM token." });
  }
  try {
    const catalog = await readLmStudioMcpCatalog();
    return res.json({
      ok: true,
      source: "lm-studio-user-config",
      installed: catalog.installed,
      plugins: catalog.plugins,
      ready: Boolean(LM_STUDIO_API_TOKEN)
    });
  } catch (error) {
    console.error("[Bridge] /api/local-llm/mcp-tools error:", error.message);
    return res.status(500).json({ ok: false, error: "Failed to read local LM Studio MCP tools." });
  }
});

app.get("/api/local-llm/health", (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized local LLM request." });
  }
  return res.json({
    ok: true,
    authMode: LOCAL_LLM_TOKEN ? "token-or-bridge-secret" : "bridge-secret-or-loopback",
    lmStudioMcp: {
      selectionMode: "local-user",
      apiTokenConfigured: Boolean(LM_STUDIO_API_TOKEN),
      bridgeCredentialRequired: true,
      explicitToolDirectiveRequired: true
    },
    checkedAt: new Date().toISOString()
  });
});

// Express static file serving and route fallback
app.use(express.static(projectRoot));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "API route not found." });
  return res.sendFile(path.join(projectRoot, "index.html"));
});

// Server handle storage for Express 5 compatibility
const globalServer = app.listen(port, () => {
  console.log(`[Bridge] Signal Share backend listening on port ${port} (IPv4 and IPv6)`);
  console.log(`[Bridge] AI endpoint: ${OLLAMA_BASE_URL}`);
  if (LM_STUDIO_API_TOKEN && (BRIDGE_SECRET || LOCAL_LLM_TOKEN)) {
    console.log("[Bridge] LM Studio MCP access is ready for authenticated user selections.");
  } else if (LM_STUDIO_API_TOKEN) {
    console.warn("[Bridge] LM Studio MCP access requires SIGNAL_SHARE_BRIDGE_SECRET or SIGNAL_SHARE_LOCAL_LLM_TOKEN before tools can be selected.");
  }
});

// Keepalive for Node.js event loop
const _keepalive = setInterval(() => {}, 1 << 30);
globalServer.on("close", () => clearInterval(_keepalive));
globalServer.on("error", (err) => {
  console.error(`[Bridge] Server error: ${err.message}`);
});
