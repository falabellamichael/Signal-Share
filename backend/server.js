import express from "express";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
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

// Import strict AI tools for LLM/chat functionality
import { createStrictAiTools } from "./strict-ai-tools.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const BRIDGE_SECRET = `${process.env.SIGNAL_SHARE_BRIDGE_SECRET || ""}`.trim();
const LOCAL_LLM_TOKEN = `${process.env.SIGNAL_SHARE_LOCAL_LLM_TOKEN || ""}`.trim();
const BRIDGE_DEVICE_ID = `${process.env.SIGNAL_SHARE_DEVICE_ID || ""}`.trim();

const OLLAMA_BASE_URL = process.env.SIGNAL_SHARE_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = process.env.SIGNAL_SHARE_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "llama3.1";
const LM_STUDIO_BASE_URL = process.env.SIGNAL_SHARE_LM_STUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234";
const LM_STUDIO_API_TOKEN = `${process.env.SIGNAL_SHARE_LM_STUDIO_API_TOKEN || process.env.LM_STUDIO_API_TOKEN || ""}`.trim();
const OPENAI_COMPATIBLE_BASE_URL = `${process.env.SIGNAL_SHARE_AI_BASE_URL || process.env.SIGNAL_SHARE_OPENAI_COMPATIBLE_BASE_URL || ""}`.trim();
const OPENAI_COMPATIBLE_API_TOKEN = `${process.env.SIGNAL_SHARE_AI_API_TOKEN || process.env.LM_API_TOKEN || ""}`.trim();
const LM_STUDIO_MCP_CONFIG_PATH = path.join(os.homedir(), ".lmstudio", "mcp.json");
const LM_STUDIO_MCP_CONTEXT_LENGTH = parseBoundedInteger(process.env.SIGNAL_SHARE_LM_STUDIO_MCP_CONTEXT_LENGTH, 8000, 1024, 131072);
const LM_STUDIO_MAX_MCP_SELECTIONS = 16;
const AI_TEMPERATURE = Number.isFinite(Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE))
  ? Number(process.env.SIGNAL_SHARE_AI_TEMPERATURE)
  : 0.7;
const BRIDGE_LAN_ENABLED = parseBoolean(process.env.SIGNAL_SHARE_BRIDGE_LAN, false);
const BRIDGE_LISTEN_HOST = resolveBridgeListenHost();
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://falabellamichael.github.io",
  "https://signalshare.io",
  "https://www.signalshare.io",
  "https://signal-share.pages.dev",
  "capacitor://localhost",
  "ionic://localhost"
]);
const EXTRA_ALLOWED_ORIGINS = `${process.env.SIGNAL_SHARE_ALLOWED_ORIGINS || ""}`
  .split(",")
  .map((value) => normalizeOrigin(value))
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);
const MAX_ATTACHMENT_DATA_URL_CHARS = 12 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;

function parseBoolean(value, fallback = false) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function isLoopbackBindHost(value = "") {
  const host = `${value || ""}`.trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function resolveBridgeListenHost() {
  const requestedHost = `${process.env.SIGNAL_SHARE_BRIDGE_BIND || ""}`.trim();
  const hasCredential = Boolean(BRIDGE_SECRET || LOCAL_LLM_TOKEN);
  if (requestedHost && isLoopbackBindHost(requestedHost)) return requestedHost;
  if (BRIDGE_LAN_ENABLED && hasCredential) return requestedHost || "0.0.0.0";
  if (requestedHost && !isLoopbackBindHost(requestedHost)) {
    console.warn("[Bridge] Ignoring non-loopback bind: LAN mode requires an explicit opt-in and a configured credential.");
  }
  if (BRIDGE_LAN_ENABLED && !hasCredential) {
    console.warn("[Bridge] LAN mode requested without a bridge secret or local LLM token; using loopback only.");
  }
  return "127.0.0.1";
}

function normalizeOrigin(value = "") {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch (_error) {
    return "";
  }
}

function isAllowedOrigin(origin = "") {
  const raw = `${origin || ""}`.trim();
  if (!raw) return true;
  if (ALLOWED_ORIGINS.has(raw)) return true;
  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    if ((protocol === "http:" || protocol === "https:")
      && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1")) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function isTrustedLocalOrigin(origin = "") {
  const raw = `${origin || ""}`.trim();
  if (!raw) return true;
  if (raw === "capacitor://localhost" || raw === "ionic://localhost") return true;
  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    return (protocol === "http:" || protocol === "https:")
      && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1");
  } catch (_error) {
    return false;
  }
}

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

function normalizeProvider(value = "auto") {
  const provider = `${value || "auto"}`.trim().toLowerCase();
  const aliases = {
    auto: "auto",
    lmstudio: "lm-studio",
    "lm-studio": "lm-studio",
    ollama: "ollama",
    openai: "openai-compatible",
    "openai-compatible": "openai-compatible"
  };
  return aliases[provider] || "";
}

function isPrivateOrLoopbackHostname(hostname = "") {
  const host = `${hostname || ""}`.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return false;
    if (octets[0] === 10 || octets[0] === 127) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    return false;
  }
  return host.startsWith("fc") || host.startsWith("fd");
}

function normalizePrivateEndpointBaseUrl(value = "") {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (!["http:", "https:"].includes(url.protocol.toLowerCase())) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    if (!isPrivateOrLoopbackHostname(url.hostname)) return "";
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

function buildProviderUrl(baseUrl = "", pathname = "") {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  const url = new URL(`${base}/`);
  const prefix = url.pathname.replace(/\/+$/, "");
  let suffix = `/${`${pathname || ""}`.replace(/^\/+/, "")}`;
  if (prefix.endsWith("/v1") && suffix.startsWith("/v1/")) suffix = suffix.slice(3);
  if (prefix.endsWith("/api") && suffix.startsWith("/api/")) suffix = suffix.slice(4);
  url.pathname = `${prefix}${suffix}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getOpenAiCompatibleHeaders(provider = "lm-studio") {
  const token = provider === "openai-compatible" ? OPENAI_COMPATIBLE_API_TOKEN : LM_STUDIO_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getProviderCatalogTargets(provider = "auto", endpointBaseUrl = "") {
  const selectedProvider = normalizeProvider(provider);
  if (!selectedProvider) {
    throw new Error("Unsupported AI provider. Choose auto, lm-studio, ollama, or openai-compatible.");
  }
  const requestedBase = `${endpointBaseUrl || ""}`.trim();
  const privateBase = requestedBase ? normalizePrivateEndpointBaseUrl(requestedBase) : "";
  if (requestedBase && !privateBase) {
    throw new Error("Custom AI endpoints must be private or loopback HTTP(S) URLs without credentials, query parameters, or fragments.");
  }

  const targets = [];
  const addOpenAi = (id, label, base, tokenProvider = id) => {
    const normalizedBase = normalizeBaseUrl(base);
    if (!normalizedBase) return;
    targets.push({
      id,
      label,
      type: "openai-compatible",
      baseUrl: normalizedBase,
      headers: getOpenAiCompatibleHeaders(tokenProvider)
    });
  };
  const addOllama = (base) => {
    const normalizedBase = normalizeBaseUrl(base);
    if (!normalizedBase) return;
    targets.push({ id: "ollama", label: "Ollama", type: "ollama", baseUrl: normalizedBase, headers: {} });
  };

  if (privateBase) {
    if (selectedProvider === "auto" || selectedProvider === "lm-studio") {
      addOpenAi(selectedProvider === "auto" ? "openai-compatible" : "lm-studio", selectedProvider === "auto" ? "OpenAI-compatible" : "LM Studio", privateBase, selectedProvider === "auto" ? "openai-compatible" : "lm-studio");
    }
    if (selectedProvider === "auto" || selectedProvider === "ollama") addOllama(privateBase);
    if (selectedProvider === "openai-compatible") addOpenAi("openai-compatible", "OpenAI-compatible", privateBase, "openai-compatible");
    return targets;
  }

  if (selectedProvider === "auto" || selectedProvider === "lm-studio") {
    addOpenAi("lm-studio", "LM Studio", LM_STUDIO_BASE_URL, "lm-studio");
  }
  if (selectedProvider === "auto" || selectedProvider === "ollama") addOllama(OLLAMA_BASE_URL);
  if (selectedProvider === "auto" || selectedProvider === "openai-compatible") {
    addOpenAi("openai-compatible", "OpenAI-compatible", OPENAI_COMPATIBLE_BASE_URL, "openai-compatible");
  }
  return targets;
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

function parseAttachmentDataUrl(value = "") {
  const dataUrl = `${value || ""}`.trim();
  if (!dataUrl) return null;
  if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
    throw new Error("The attachment is too large for the local companion bridge (12 MB data limit).");
  }
  const match = dataUrl.match(/^data:([^;,\s]+)?((?:;[^,]*)*?),(.*)$/is);
  if (!match) return null;
  const mimeType = `${match[1] || "application/octet-stream"}`.toLowerCase();
  const attributes = `${match[2] || ""}`.toLowerCase();
  const payload = `${match[3] || ""}`;
  const isBase64 = attributes.split(";").includes("base64");
  return { dataUrl, mimeType, payload, isBase64 };
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const name = `${attachment.name || "attachment"}`.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) || "attachment";
  const parsed = parseAttachmentDataUrl(attachment.data);
  const declaredKind = `${attachment.type || "file"}`.trim().toLowerCase();
  const mimeType = parsed?.mimeType || `${attachment.mimeType || ""}`.trim().toLowerCase();
  const kind = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(mimeType)
      ? "text"
      : ["image", "text", "file", "audio", "video"].includes(declaredKind) ? declaredKind : "file";
  let textContent = "";
  if (parsed && kind === "text") {
    try {
      textContent = parsed.isBase64
        ? Buffer.from(parsed.payload.replace(/\s+/g, ""), "base64").toString("utf8")
        : decodeURIComponent(parsed.payload.replace(/\+/g, "%20"));
      textContent = textContent.replace(/\0/g, "").slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    } catch (_error) {
      textContent = "";
    }
  }
  const imageDataUrl = parsed && kind === "image" ? parsed.dataUrl : "";
  const ollamaImage = parsed && kind === "image" && parsed.isBase64
    ? parsed.payload.replace(/\s+/g, "")
    : "";
  return {
    name,
    kind,
    mimeType: mimeType || "application/octet-stream",
    textContent,
    imageDataUrl,
    ollamaImage
  };
}

function describeAttachmentForModel(attachment) {
  if (!attachment) return "";
  if (attachment.kind === "text" && attachment.textContent) {
    return `Attached text file: ${attachment.name} (${attachment.mimeType}).\n\n${attachment.textContent}`;
  }
  if (attachment.kind === "image" && attachment.imageDataUrl) {
    return `Attached image: ${attachment.name} (${attachment.mimeType}). Inspect the image if this model supports vision; otherwise state that limitation.`;
  }
  return `Attached file metadata: ${attachment.name} (${attachment.mimeType}, ${attachment.kind}). The file content is not available to this model, so do not claim to have inspected it.`;
}

function addOpenAiAttachment(messages, attachment) {
  if (!attachment?.imageDataUrl) return messages;
  const cloned = messages.map((entry) => ({ ...entry }));
  const lastUserIndex = cloned.findLastIndex((entry) => entry.role === "user");
  if (lastUserIndex < 0) return cloned;
  const text = typeof cloned[lastUserIndex].content === "string" ? cloned[lastUserIndex].content : "Inspect the attached image.";
  cloned[lastUserIndex].content = [
    { type: "text", text },
    { type: "image_url", image_url: { url: attachment.imageDataUrl } }
  ];
  return cloned;
}

function addOllamaAttachment(messages, attachment) {
  if (!attachment?.ollamaImage) return messages;
  const cloned = messages.map((entry) => ({ ...entry }));
  const lastUserIndex = cloned.findLastIndex((entry) => entry.role === "user");
  if (lastUserIndex >= 0) cloned[lastUserIndex].images = [attachment.ollamaImage];
  return cloned;
}

function buildMessages({ message = "", history = [], pageContext = "", customInstructions = "", conversationId = "", attachment = null } = {}) {
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
  const attachmentContext = describeAttachmentForModel(attachment);
  if (userMessage) {
    messages.push({ role: "user", content: [userMessage, attachmentContext].filter(Boolean).join("\n\n") });
  } else if (attachmentContext) {
    messages.push({ role: "user", content: attachmentContext });
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

async function getOpenAiCompatibleModelIds(baseUrl = LM_STUDIO_BASE_URL, headers = getLmStudioRequestHeaders()) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  try {
    const response = await fetchWithTimeout(buildProviderUrl(base, "/v1/models"), {
      method: "GET",
      headers
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

async function getLmStudioModelIds(baseUrl = LM_STUDIO_BASE_URL) {
  return getOpenAiCompatibleModelIds(baseUrl, getLmStudioRequestHeaders());
}

async function getOllamaModelIds(baseUrl = OLLAMA_BASE_URL) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return [];
  try {
    const response = await fetchWithTimeout(buildProviderUrl(base, "/api/tags"), { method: "GET" }, 1500);
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

async function probeProviderTarget(target) {
  const models = target.type === "ollama"
    ? await getOllamaModelIds(target.baseUrl)
    : await getOpenAiCompatibleModelIds(target.baseUrl, target.headers);
  return { ...target, models, available: models.length > 0 };
}

async function getProviderCandidates(model = "auto", {
  provider = "auto",
  endpointBaseUrl = "",
  lmStudioMcpIntegrations = []
} = {}) {
  const selectedProvider = normalizeProvider(provider);
  if (!selectedProvider) {
    throw new Error("Unsupported AI provider. Choose auto, lm-studio, ollama, or openai-compatible.");
  }
  if (lmStudioMcpIntegrations.length > 0 && !["auto", "lm-studio"].includes(selectedProvider)) {
    throw new Error("LM Studio MCP tools can only be used with the LM Studio provider.");
  }
  const targets = getProviderCatalogTargets(selectedProvider, endpointBaseUrl);
  const probes = await Promise.all(targets.map((target) => probeProviderTarget(target)));
  const candidates = [];
  for (const target of probes) {
    if (!target.available) continue;
    const selectedModel = `${model || "auto"}`.trim() === "auto" ? target.models[0] : `${model}`.trim();
    if (target.id === "lm-studio" && isLmStudioMcpReady(lmStudioMcpIntegrations)) {
      candidates.push({
        id: "lm-studio-mcp",
        type: "lm-studio-mcp",
        baseUrl: target.baseUrl,
        model: selectedModel,
        providerLabel: "LM Studio MCP provider"
      });
      return candidates;
    }
    candidates.push({
      ...target,
      model: selectedModel,
      providerLabel: `${target.label} provider`
    });
  }
  return candidates;
}

async function callOpenAiCompatibleProvider({ baseUrl, headers = {}, messages, model, temperature, providerLabel = "OpenAI-compatible provider" }) {
  const selectedModel = `${model || ""}`.trim();
  const chatUrl = buildProviderUrl(baseUrl, "/v1/chat/completions");
  if (!chatUrl || !selectedModel) {
    throw new Error(`${providerLabel} chat model is unavailable.`);
  }

  const response = await fetchWithTimeout(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
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
    throw new Error(`${providerLabel} returned HTTP ${response.status}: ${raw.slice(0, 240)}`);
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

async function callLmStudioMcpProvider({ baseUrl = LM_STUDIO_BASE_URL, messages, model, temperature, integrations = [] }) {
  const base = normalizeBaseUrl(baseUrl);
  const selectedModel = `${model || ""}`.trim();
  if (!base || !selectedModel) {
    throw new Error("LM Studio MCP chat model is unavailable.");
  }
  if (!isLmStudioMcpReady(integrations)) {
    throw new Error("LM Studio MCP tools require a user selection and an API token.");
  }

  const response = await fetchWithTimeout(buildProviderUrl(base, "/api/v1/chat"), {
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

async function callOllamaProvider({ baseUrl = OLLAMA_BASE_URL, messages, model, temperature }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("Ollama base URL is not configured.");
  const availableModels = await getOllamaModelIds(base);
  const requested = `${model || ""}`.trim();
  const selectedModel = requested && requested !== "auto"
    ? requested
    : (availableModels[0] || DEFAULT_OLLAMA_MODEL);
  if (!selectedModel) throw new Error("No Ollama model is available.");
  const response = await fetchWithTimeout(buildProviderUrl(base, "/api/chat"), {
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

async function getChatResponse({
  message,
  history,
  pageContext,
  customInstructions,
  conversationId,
  attachment,
  model,
  provider = "auto",
  endpointBaseUrl = "",
  lmStudioMcpIntegrations = []
} = {}) {
  const normalizedAttachment = normalizeAttachment(attachment);
  const messages = buildMessages({ message, history, pageContext, customInstructions, conversationId, attachment: normalizedAttachment });
  const providers = await getProviderCandidates(model, { provider, endpointBaseUrl, lmStudioMcpIntegrations });
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
            baseUrl: provider.baseUrl,
            messages,
            model: provider.model,
            temperature: AI_TEMPERATURE,
            integrations: lmStudioMcpIntegrations
          })
          : provider.type === "openai-compatible"
          ? await callOpenAiCompatibleProvider({
            baseUrl: provider.baseUrl,
            headers: provider.headers,
            messages: addOpenAiAttachment(messages, normalizedAttachment),
            model: provider.model,
            temperature: AI_TEMPERATURE,
            providerLabel: provider.providerLabel
          })
        : await callOllamaProvider({
            baseUrl: provider.baseUrl,
            messages: addOllamaAttachment(messages, normalizedAttachment),
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
  const bridgeSecret = `${req.get("x-bridge-secret") || ""}`;
  const localToken = `${req.get("x-local-llm-token") || ""}`;
  const deviceId = `${req.get("x-device-id") || ""}`;
  const matches = (actual, expected) => {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  };
  const credentialMatches = matches(bridgeSecret, BRIDGE_SECRET) || matches(localToken, LOCAL_LLM_TOKEN);
  if (!credentialMatches) return false;
  return !BRIDGE_DEVICE_ID || matches(deviceId, BRIDGE_DEVICE_ID);
}

function isAuthorized(req) {
  const remoteAddress = `${req.socket?.remoteAddress || req.ip || ""}`.toLowerCase();
  const isLoopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (hasAuthorizedBridgeCredential(req)) return true;
  const origin = `${req.get("origin") || ""}`.trim();
  if (origin) {
    if (BRIDGE_SECRET || LOCAL_LLM_TOKEN) return false;
    if (!isTrustedLocalOrigin(origin)) return false;
  }
  return isLoopback;
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  const origin = `${req.headers.origin || ""}`.trim();
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ ok: false, error: "This web origin is not allowed to use the companion bridge." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret, X-Local-LLM-Token, X-Device-Id, Authorization, Target-Address-Space, Access-Control-Request-Private-Network");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Initialize strict AI tools router after shared parsing and CORS middleware.
const strictAiTools = createStrictAiTools({ isAuthorized, fetchWithTimeout });
app.use(strictAiTools.router);

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

async function getLocalModelCatalog({ provider = "auto", endpointBaseUrl = "" } = {}) {
  const selectedProvider = normalizeProvider(provider);
  if (!selectedProvider) {
    throw new Error("Unsupported AI provider. Choose auto, lm-studio, ollama, or openai-compatible.");
  }
  const targets = getProviderCatalogTargets(selectedProvider, endpointBaseUrl);
  const probes = await Promise.all(targets.map((target) => probeProviderTarget(target)));
  const rows = probes.flatMap((target) => target.models.map((modelId) => ({ id: modelId, provider: target.id })));
  return {
    selectedProvider,
    all: [...new Set(rows.map((row) => row.id))],
    rows,
    configured: targets.length > 0,
    available: rows.length > 0,
    providers: probes.map((target) => ({
      id: target.id,
      label: target.label,
      baseUrl: target.baseUrl,
      configured: true,
      available: target.available,
      status: target.available ? "ready" : "no-model",
      models: target.models
    })),
    checkedAt: new Date().toISOString()
  };
}

app.get("/api/system-media/current", async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
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

app.get("/api/system/tabs", (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
  res.json({ tabs: [] });
});

app.get("/api/health", async (_req, res) => {
  const catalog = await getLocalModelCatalog();
  res.json({
    ok: true,
    configured: catalog.configured,
    aiAvailable: catalog.available,
    service: "Signal Share Companion",
    bindHost: BRIDGE_LISTEN_HOST,
    time: new Date().toISOString()
  });
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

async function handleChatRoute(req, res) {
  try {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
    const { message, history, pageContext, attachment, model, customInstructions, lmStudioMcpTools, endpointBaseUrl } = req.body || {};
    const requestedProvider = normalizeProvider(req.body?.provider || "auto");
    const conversationId = normalizeConversationId(req.body?.conversationId || req.body?.chatId || "");
    if (!requestedProvider) {
      return res.status(400).json({ ok: false, error: "Unsupported AI provider. Choose auto, lm-studio, ollama, or openai-compatible." });
    }
    if (`${endpointBaseUrl || ""}`.trim() && !normalizePrivateEndpointBaseUrl(endpointBaseUrl)) {
      return res.status(400).json({ ok: false, error: "Custom AI endpoints must be private or loopback HTTP(S) URLs without credentials, query parameters, or fragments." });
    }
    if (!message && !attachment && (!Array.isArray(history) || history.length === 0)) {
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

    const handledByStrictTool = await handleStrictChatToolTurn(req, res, message);
    if (handledByStrictTool) return handledByStrictTool;

    try {
      const reply = await getChatResponse({
        message,
        history,
        pageContext,
        customInstructions,
        conversationId,
        attachment,
        model,
        provider: requestedProvider,
        endpointBaseUrl,
        lmStudioMcpIntegrations
      });
      return res.json({ ok: true, reply, provider: requestedProvider });
    } catch (chatError) {
      console.warn("[Chat] AI endpoint error:", chatError.message);
      return res.status(503).json({
        ok: false,
        error: chatError?.message || "Local AI chat is unavailable. Start a configured provider and load a model."
      });
    }
  } catch (error) {
    console.error("[Chat] Route error:", error);
    return res.status(500).json({ ok: false, error: "Chat request failed." });
  }
}

app.post("/api/llm/chat", handleChatRoute);
app.post("/api/local-llm/chat", handleChatRoute);
app.get("/api/llm/models", async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized local LLM request." });
  try {
    const catalog = await getLocalModelCatalog({
      provider: req.query.provider || "auto",
      endpointBaseUrl: req.query.endpointBaseUrl || ""
    });
    return res.json({
      ok: true,
      configured: catalog.configured,
      aiAvailable: catalog.available,
      models: catalog.rows,
      providers: catalog.providers,
      message: catalog.available ? "AI provider and model are ready." : "The companion is reachable, but no configured AI provider currently has a loaded model.",
      checkedAt: catalog.checkedAt
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || "Invalid model catalog request." });
  }
});

app.get("/api/local-llm/models", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized local LLM request." });
  }
  try {
    const catalog = await getLocalModelCatalog({
      provider: req.query.provider || "auto",
      endpointBaseUrl: req.query.endpointBaseUrl || ""
    });
    const models = Array.isArray(catalog?.rows) ? catalog.rows : [];
    return res.json({
      ok: true,
      configured: catalog.configured,
      aiAvailable: catalog.available,
      models,
      providers: catalog.providers,
      message: catalog.available ? "AI provider and model are ready." : "The companion is reachable, but no configured AI provider currently has a loaded model.",
      checkedAt: catalog?.checkedAt || new Date().toISOString()
    });
  } catch (error) {
    console.error("[Bridge] /api/local-llm/models error:", error);
    return res.status(400).json({ ok: false, error: error?.message || "Failed to read local model catalog." });
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

app.get("/api/local-llm/health", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized local LLM request." });
  }
  try {
    const catalog = await getLocalModelCatalog({
      provider: req.query.provider || "auto",
      endpointBaseUrl: req.query.endpointBaseUrl || ""
    });
    return res.json({
      ok: true,
      configured: catalog.configured,
      aiAvailable: catalog.available,
      authMode: LOCAL_LLM_TOKEN ? "token-or-bridge-secret-or-loopback" : "bridge-secret-or-loopback",
      selectedProvider: catalog.selectedProvider,
      providers: catalog.providers,
      models: catalog.rows,
      message: catalog.available ? "AI provider and model are ready." : "The companion is running, but no configured AI provider has a loaded model.",
      lmStudioMcp: {
        selectionMode: "local-user",
        apiTokenConfigured: Boolean(LM_STUDIO_API_TOKEN),
        bridgeCredentialRequired: true,
        explicitToolDirectiveRequired: true
      },
      checkedAt: catalog.checkedAt
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || "Invalid health request." });
  }
});

// Express static file serving and route fallback
if (existsSync(path.join(projectRoot, "index.html"))) app.use(express.static(projectRoot));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "API route not found." });
  const indexPath = path.join(projectRoot, "index.html");
  if (!existsSync(indexPath)) return res.status(404).send("Signal Share companion API is running.");
  return res.sendFile(indexPath);
});

// Server handle storage for Express 5 compatibility
const globalServer = app.listen(port, BRIDGE_LISTEN_HOST, () => {
  console.log(`[Bridge] Signal Share companion listening on http://${BRIDGE_LISTEN_HOST}:${port}`);
  console.log(`[Bridge] Default providers: LM Studio ${normalizeBaseUrl(LM_STUDIO_BASE_URL)}; Ollama ${normalizeBaseUrl(OLLAMA_BASE_URL)}`);
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
