(function initSignalShareLocalLlmConnectivity(global) {
  const BRIDGE_URL_KEY = "signal-share-bridge-url";
  const BRIDGE_URL_LEGACY_KEYS = Object.freeze([
    "ss_bridge_url",
    "SIGNAL_SHARE_BRIDGE_URL"
  ]);
  const LOCAL_LLM_TOKEN_KEY = "ss_local_llm_token";
  const LOCAL_LLM_TOKEN_LEGACY_KEYS = Object.freeze([
    "signal-share-local-llm-token",
    "SIGNAL_SHARE_LOCAL_LLM_TOKEN"
  ]);
  const BRIDGE_SECRET_KEY = "ss_bridge_secret";
  const BRIDGE_SECRET_LEGACY_KEYS = Object.freeze([
    "signal-share-bridge-secret",
    "SIGNAL_SHARE_BRIDGE_SECRET"
  ]);
  const AI_PROVIDER_KEY = "ss_ai_provider";
  const CUSTOM_ENDPOINT_BASE_URL_KEY = "ss_openai_compatible_base_url";
  const LM_STUDIO_ENDPOINT_BASE_URL_KEY = "ss_lm_studio_endpoint_base_url";
  const OLLAMA_ENDPOINT_BASE_URL_KEY = "ss_ollama_endpoint_base_url";
  const BRIDGE_ENABLED_KEY = "ss_bridge_enabled";
  const PROVIDERS = Object.freeze(["auto", "lm-studio", "ollama", "openai-compatible"]);
  const DIRECT_ENDPOINT_DEFAULTS = Object.freeze({
    "lm-studio": "http://127.0.0.1:1234/v1",
    ollama: "http://127.0.0.1:11434",
    "openai-compatible": ""
  });
  const DIRECT_MODEL_TIMEOUT_MS = 5000;
  const DIRECT_CHAT_TIMEOUT_MS = 180000;
  const MAX_DIRECT_ATTACHMENT_CHARS = 12 * 1024 * 1024;
  const MAX_DIRECT_ATTACHMENT_TEXT_CHARS = 60000;

  function safeGetLocalStorageValue(key) {
    try {
      return `${global.localStorage?.getItem(key) || ""}`.trim();
    } catch (_error) {
      return "";
    }
  }

  function safeSetLocalStorageValue(key, value) {
    try {
      global.localStorage?.setItem(key, value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function safeRemoveLocalStorageValue(key) {
    try {
      global.localStorage?.removeItem(key);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function readFirstStorageValue(keys) {
    for (const key of keys || []) {
      const value = safeGetLocalStorageValue(key);
      if (value) return value;
    }
    return "";
  }

  function readCanonicalStorageValue(primaryKey, legacyKeys = []) {
    const primaryValue = safeGetLocalStorageValue(primaryKey);
    if (primaryValue) return primaryValue;
    const legacyValue = readFirstStorageValue(legacyKeys);
    if (legacyValue) safeSetLocalStorageValue(primaryKey, legacyValue);
    return legacyValue;
  }

  function notifyConfigChanged(detail = {}) {
    try {
      global.dispatchEvent(new CustomEvent("signal-share:bridge-config-change", { detail }));
    } catch (_error) {
      // Storage still succeeded when CustomEvent is unavailable.
    }
  }

  function writeCanonicalStorageValue(primaryKey, legacyKeys, value, detail = {}) {
    const normalized = `${value || ""}`.trim();
    if (normalized) safeSetLocalStorageValue(primaryKey, normalized);
    else safeRemoveLocalStorageValue(primaryKey);
    for (const key of legacyKeys || []) safeRemoveLocalStorageValue(key);
    notifyConfigChanged(detail);
    return normalized;
  }

  function normalizeBridgeBaseUrl(value = "") {
    const raw = `${value || ""}`.trim();
    if (!raw) return "";
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const parsed = new URL(withProtocol, global.location?.href || "http://localhost");
      const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
      return normalized
        .replace(/\/api\/local-llm\/chat$/i, "")
        .replace(/\/api\/local-llm\/models$/i, "")
        .replace(/\/api\/local-llm\/health$/i, "")
        .replace(/\/api\/llm\/chat$/i, "")
        .replace(/\/api\/llm\/models$/i, "")
        .replace(/\/api\/system-media\/current$/i, "")
        .replace(/\/api\/system-media\/action$/i, "");
    } catch (_error) {
      return "";
    }
  }

  function getBridgeBaseUrl() {
    const configured = readCanonicalStorageValue(BRIDGE_URL_KEY, BRIDGE_URL_LEGACY_KEYS);
    return normalizeBridgeBaseUrl(configured);
  }

  function setBridgeBaseUrl(value = "") {
    const normalized = normalizeBridgeBaseUrl(value);
    if (normalized) {
      safeSetLocalStorageValue(BRIDGE_URL_KEY, normalized);
      safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
      for (const key of BRIDGE_URL_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
      notifyConfigChanged({ bridgeUrl: normalized });
      return normalized;
    }
    safeRemoveLocalStorageValue(BRIDGE_URL_KEY);
    for (const key of BRIDGE_URL_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
    notifyConfigChanged({ bridgeUrl: "" });
    return "";
  }

  function getBridgeSecret() {
    return readCanonicalStorageValue(BRIDGE_SECRET_KEY, BRIDGE_SECRET_LEGACY_KEYS);
  }

  function setBridgeSecret(value = "") {
    const secret = writeCanonicalStorageValue(
      BRIDGE_SECRET_KEY,
      BRIDGE_SECRET_LEGACY_KEYS,
      value,
      { bridgeSecretChanged: true }
    );
    if (secret) safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
    return secret;
  }

  function getLocalLlmToken() {
    return readCanonicalStorageValue(LOCAL_LLM_TOKEN_KEY, LOCAL_LLM_TOKEN_LEGACY_KEYS);
  }

  function setLocalLlmToken(value = "") {
    const token = `${value || ""}`.trim();
    if (token) {
      safeSetLocalStorageValue(LOCAL_LLM_TOKEN_KEY, token);
      safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
      for (const key of LOCAL_LLM_TOKEN_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
      notifyConfigChanged({ localLlmTokenChanged: true });
      return token;
    }
    safeRemoveLocalStorageValue(LOCAL_LLM_TOKEN_KEY);
    for (const key of LOCAL_LLM_TOKEN_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
    notifyConfigChanged({ localLlmTokenChanged: true });
    return "";
  }

  function normalizeProvider(value = "auto") {
    const provider = `${value || "auto"}`.trim().toLowerCase();
    return PROVIDERS.includes(provider) ? provider : "auto";
  }

  function getProviderPreference() {
    return normalizeProvider(safeGetLocalStorageValue(AI_PROVIDER_KEY));
  }

  function setProviderPreference(value = "auto") {
    const provider = normalizeProvider(value);
    safeSetLocalStorageValue(AI_PROVIDER_KEY, provider);
    notifyConfigChanged({ provider });
    return provider;
  }

  function getCustomEndpointBaseUrl() {
    return normalizeDirectEndpointBaseUrl(safeGetLocalStorageValue(CUSTOM_ENDPOINT_BASE_URL_KEY), "openai-compatible");
  }

  function setCustomEndpointBaseUrl(value = "") {
    const normalized = normalizeDirectEndpointBaseUrl(value, "openai-compatible");
    if (normalized) safeSetLocalStorageValue(CUSTOM_ENDPOINT_BASE_URL_KEY, normalized);
    else safeRemoveLocalStorageValue(CUSTOM_ENDPOINT_BASE_URL_KEY);
    notifyConfigChanged({ customEndpointBaseUrl: normalized });
    return normalized;
  }

  function isPrivateOrLoopbackHostname(hostname = "") {
    const host = `${hostname || ""}`.trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
    if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      if (octets[0] === 10 || octets[0] === 127) return true;
      if (octets[0] === 192 && octets[1] === 168) return true;
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
      if (octets[0] === 169 && octets[1] === 254) return true;
      return false;
    }
    return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }

  function normalizeDirectEndpointBaseUrl(value = "", providerValue = "openai-compatible") {
    const provider = normalizeProvider(providerValue);
    const raw = `${value || ""}`.trim();
    if (!raw || provider === "auto") return "";
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
      if (!['http:', 'https:'].includes(url.protocol.toLowerCase())) return "";
      if (url.username || url.password || url.search || url.hash) return "";
      if (!isPrivateOrLoopbackHostname(url.hostname)) return "";

      let pathname = `${url.pathname || "/"}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
      if (provider === "ollama") {
        pathname = pathname
          .replace(/\/api\/(?:tags|chat|ps)$/i, "")
          .replace(/\/+$/, "");
      } else {
        pathname = pathname
          .replace(/\/(?:chat\/completions|models)$/i, "")
          .replace(/\/+$/, "");
        if (!pathname) pathname = "/v1";
      }
      url.pathname = pathname || "/";
      return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
    } catch (_error) {
      return "";
    }
  }

  function getDirectEndpointStorageKey(providerValue = "auto") {
    const provider = normalizeProvider(providerValue);
    if (provider === "lm-studio") return LM_STUDIO_ENDPOINT_BASE_URL_KEY;
    if (provider === "ollama") return OLLAMA_ENDPOINT_BASE_URL_KEY;
    if (provider === "openai-compatible") return CUSTOM_ENDPOINT_BASE_URL_KEY;
    return "";
  }

  function getDirectEndpointBaseUrl(providerValue = getProviderPreference()) {
    const provider = normalizeProvider(providerValue);
    const storageKey = getDirectEndpointStorageKey(provider);
    if (!storageKey) return "";
    const configured = normalizeDirectEndpointBaseUrl(safeGetLocalStorageValue(storageKey), provider);
    return configured || DIRECT_ENDPOINT_DEFAULTS[provider] || "";
  }

  function setDirectEndpointBaseUrl(providerValue = getProviderPreference(), value = "") {
    const provider = normalizeProvider(providerValue);
    const storageKey = getDirectEndpointStorageKey(provider);
    if (!storageKey) return "";
    const raw = `${value || ""}`.trim();
    const normalized = normalizeDirectEndpointBaseUrl(raw, provider);
    if (raw && !normalized) return "";
    if (normalized) safeSetLocalStorageValue(storageKey, normalized);
    else safeRemoveLocalStorageValue(storageKey);
    notifyConfigChanged({ directEndpointBaseUrl: normalized, provider });
    return normalized || DIRECT_ENDPOINT_DEFAULTS[provider] || "";
  }

  function buildDirectProviderUrl(baseUrl = "", pathname = "") {
    const normalizedBase = `${baseUrl || ""}`.trim().replace(/\/+$/, "");
    if (!normalizedBase) return "";
    try {
      const url = new URL(`${normalizedBase}/`);
      const prefix = url.pathname.replace(/\/+$/, "");
      let suffix = `/${`${pathname || ""}`.replace(/^\/+/, "")}`;
      if (prefix.endsWith("/v1") && suffix.startsWith("/v1/")) suffix = suffix.slice(3);
      if (prefix.endsWith("/api") && suffix.startsWith("/api/")) suffix = suffix.slice(4);
      url.pathname = `${prefix}${suffix}`.replace(/\/{2,}/g, "/");
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function getDirectEndpointTargets(providerValue = getProviderPreference()) {
    const provider = normalizeProvider(providerValue);
    const providers = provider === "auto"
      // Ollama is first in Auto because its local API reports and starts a
      // selected model predictably; explicit provider choices keep exact order.
      ? ["ollama", "lm-studio", "openai-compatible"]
      : [provider];
    return providers.flatMap((targetProvider) => {
      const baseUrl = getDirectEndpointBaseUrl(targetProvider);
      if (!baseUrl) return [];
      return [{
        provider: targetProvider,
        type: targetProvider === "ollama" ? "ollama" : "openai-compatible",
        baseUrl
      }];
    });
  }

  function createDirectAbortContext(externalSignal, timeoutMs) {
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
    const timeout = Number(timeoutMs) > 0
      ? global.setTimeout(() => controller.abort(new DOMException("Endpoint request timed out.", "TimeoutError")), Number(timeoutMs))
      : null;
    return {
      signal: controller.signal,
      cleanup() {
        if (timeout) global.clearTimeout(timeout);
        externalSignal?.removeEventListener?.("abort", abortFromExternal);
      }
    };
  }

  async function directFetchJson(target, pathname, options = {}) {
    const endpoint = buildDirectProviderUrl(target?.baseUrl, pathname);
    if (!endpoint) throw new Error(`Invalid ${target?.provider || "direct"} endpoint URL.`);
    const { timeoutMs = DIRECT_MODEL_TIMEOUT_MS, signal: externalSignal, method = "GET", body } = options;
    const abortContext = createDirectAbortContext(externalSignal, timeoutMs);
    let response = null;
    try {
      response = await global.fetch(endpoint, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          ...(method !== "GET" ? { "Content-Type": "application/json" } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: abortContext.signal
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : null;
      if (!response.ok) {
        const message = `${data?.error?.message || data?.error || data?.message || response.statusText || "request failed"}`.trim();
        const error = new Error(`${target.provider} endpoint returned HTTP ${response.status}${message ? `: ${message.slice(0, 180)}` : ""}`);
        error.status = response.status;
        throw error;
      }
      return { data, status: response.status };
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
      if (response) throw error;
      const nextError = new Error(`${target?.provider || "Direct"} endpoint is unreachable or blocked by browser CORS.`);
      nextError.cause = error;
      nextError.isNetworkError = true;
      throw nextError;
    } finally {
      abortContext.cleanup();
    }
  }

  function parseDirectModels(target, payload) {
    const sourceRows = target.type === "ollama"
      ? (Array.isArray(payload?.models) ? payload.models : [])
      : (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []);
    const seen = new Set();
    return sourceRows.flatMap((row) => {
      const id = `${row?.id || row?.model || row?.name || ""}`.trim();
      if (!id) return [];
      const key = id.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const declaredType = `${row?.type || row?.object || ""}`.trim().toLowerCase();
      const chatCapable = !declaredType.includes("embedding")
        && !/(?:^|[\/_:.-])embed(?:ding)?(?:$|[\/_:.-])/i.test(id);
      return [{
        id,
        provider: target.provider,
        source: "direct",
        state: `${row?.state || ""}`.trim(),
        type: `${row?.type || row?.object || ""}`.trim(),
        chatCapable
      }];
    });
  }

  async function discoverDirectModels(options = {}) {
    const provider = normalizeProvider(options.provider || getProviderPreference());
    const targets = getDirectEndpointTargets(provider);
    if (targets.length === 0) {
      return {
        ok: true,
        available: false,
        reachable: false,
        provider,
        models: [],
        providers: [],
        errors: [],
        source: "direct",
        message: "Set a private or loopback OpenAI-compatible endpoint URL."
      };
    }

    const outcomes = await Promise.all(targets.map(async (target) => {
      try {
        const route = target.type === "ollama" ? "/api/tags" : "/v1/models";
        const result = await directFetchJson(target, route, {
          timeoutMs: options.timeoutMs || DIRECT_MODEL_TIMEOUT_MS,
          signal: options.signal
        });
        return { target, reachable: true, models: parseDirectModels(target, result.data), error: "" };
      } catch (error) {
        return {
          target,
          reachable: Boolean(error?.status),
          models: [],
          error: `${error?.message || error || "Direct endpoint failed."}`.trim()
        };
      }
    }));
    const models = outcomes.flatMap((outcome) => outcome.models);
    const chatModels = models.filter((row) => row.chatCapable !== false);
    const reachable = outcomes.some((outcome) => outcome.reachable);
    const errors = outcomes.filter((outcome) => outcome.error).map((outcome) => ({
      provider: outcome.target.provider,
      message: outcome.error
    }));
    return {
      ok: true,
      available: chatModels.length > 0,
      reachable,
      provider,
      models,
      providers: outcomes.map((outcome) => {
        const chatModelCount = outcome.models.filter((row) => row.chatCapable !== false).length;
        return {
          id: outcome.target.provider,
          baseUrl: outcome.target.baseUrl,
          reachable: outcome.reachable,
          available: chatModelCount > 0,
          modelCount: outcome.models.length,
          chatModelCount
        };
      }),
      errors,
      source: "direct",
      message: chatModels.length > 0
        ? `${chatModels.length} direct chat model${chatModels.length === 1 ? "" : "s"} ready${models.length > chatModels.length ? ` (${models.length - chatModels.length} non-chat model${models.length - chatModels.length === 1 ? "" : "s"} also found)` : ""}. PC Bridge is optional for desktop tools.`
        : reachable
          ? models.length > 0
            ? `The direct endpoint reported ${models.length} model${models.length === 1 ? "" : "s"}, but none can be used for chat.`
            : "The direct endpoint responded, but it reported no models."
          : "No direct endpoint is reachable. Start the provider and allow this site in its CORS settings."
    };
  }

  function decodeDirectTextAttachment(parsed) {
    try {
      if (parsed.isBase64) {
        const binary = global.atob(parsed.payload.replace(/\s+/g, ""));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\0/g, "").slice(0, MAX_DIRECT_ATTACHMENT_TEXT_CHARS);
      }
      return decodeURIComponent(parsed.payload.replace(/\+/g, "%20")).replace(/\0/g, "").slice(0, MAX_DIRECT_ATTACHMENT_TEXT_CHARS);
    } catch (_error) {
      return "";
    }
  }

  function normalizeDirectAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") return null;
    const dataUrl = `${attachment.data || ""}`.trim();
    if (!dataUrl || dataUrl.length > MAX_DIRECT_ATTACHMENT_CHARS) return null;
    const match = dataUrl.match(/^data:([^;,\s]+)?((?:;[^,]*)*?),(.*)$/is);
    if (!match) return null;
    const mimeType = `${match[1] || "application/octet-stream"}`.toLowerCase();
    const attributes = `${match[2] || ""}`.toLowerCase();
    const parsed = {
      dataUrl,
      mimeType,
      payload: `${match[3] || ""}`,
      isBase64: attributes.split(";").includes("base64")
    };
    const name = `${attachment.name || "attachment"}`.replace(/[\r\n\t]+/g, " ").trim().slice(0, 160) || "attachment";
    const isImage = mimeType.startsWith("image/");
    const isText = mimeType.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(mimeType);
    return {
      name,
      mimeType,
      kind: isImage ? "image" : isText ? "text" : "file",
      imageDataUrl: isImage ? dataUrl : "",
      imageBase64: isImage && parsed.isBase64 ? parsed.payload.replace(/\s+/g, "") : "",
      textContent: isText ? decodeDirectTextAttachment(parsed) : ""
    };
  }

  function buildDirectMessages(payload = {}) {
    const messages = [
      { role: "system", content: "You are a helpful assistant for Signal Share, a social platform." }
    ];
    const customInstructions = `${payload.customInstructions || ""}`.trim().slice(0, 2000);
    if (customInstructions) messages.push({ role: "system", content: customInstructions });
    const pageContext = `${payload.pageContext || ""}`.trim().slice(0, 24000);
    if (pageContext) messages.push({ role: "system", content: `Current page context:\n${pageContext}` });
    messages.push({ role: "system", content: "Direct endpoint mode is active without the Signal Share PC Bridge. You have no desktop, media-control, app-launch, local-file, MCP, or PC-tool access. Never claim that you performed those actions, even if other context describes capabilities available only with the Bridge." });
    messages.push({ role: "system", content: "Never emit [LIST_FILES], [READ_FILE], or [WRITE_FILE] action tags." });

    const conversationId = `${payload.conversationId || payload.chatId || ""}`.trim();
    const history = Array.isArray(payload.history) ? payload.history : [];
    for (const entry of history.slice(-12)) {
      const content = `${entry?.content || entry?.text || ""}`.trim().slice(0, 12000);
      const entryConversationId = `${entry?.conversationId || entry?.chatId || ""}`.trim();
      if (!content || (conversationId && entryConversationId && entryConversationId !== conversationId)) continue;
      messages.push({ role: entry?.role === "assistant" ? "assistant" : "user", content });
    }

    const normalizedAttachment = normalizeDirectAttachment(payload.attachment);
    const userText = `${payload.message || ""}`.trim();
    let attachmentText = "";
    if (normalizedAttachment?.kind === "text" && normalizedAttachment.textContent) {
      attachmentText = `Attached text file: ${normalizedAttachment.name} (${normalizedAttachment.mimeType}).\n\n${normalizedAttachment.textContent}`;
    } else if (normalizedAttachment?.kind === "image") {
      attachmentText = `Attached image: ${normalizedAttachment.name} (${normalizedAttachment.mimeType}). Inspect it only if this model supports vision.`;
    } else if (normalizedAttachment) {
      attachmentText = `Attached file metadata: ${normalizedAttachment.name} (${normalizedAttachment.mimeType}). Its content is unavailable in direct endpoint mode.`;
    }
    const content = [userText, attachmentText].filter(Boolean).join("\n\n") || "Continue";
    messages.push({ role: "user", content });
    return { messages, attachment: normalizedAttachment };
  }

  function addDirectAttachment(messages, attachment, targetType) {
    if (!attachment || attachment.kind !== "image") return messages;
    const cloned = messages.map((entry) => ({ ...entry }));
    let lastUserIndex = -1;
    for (let index = cloned.length - 1; index >= 0; index -= 1) {
      if (cloned[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return cloned;
    if (targetType === "ollama" && attachment.imageBase64) {
      cloned[lastUserIndex].images = [attachment.imageBase64];
    } else if (targetType === "openai-compatible" && attachment.imageDataUrl) {
      const text = typeof cloned[lastUserIndex].content === "string" ? cloned[lastUserIndex].content : "Inspect the attached image.";
      cloned[lastUserIndex].content = [
        { type: "text", text },
        { type: "image_url", image_url: { url: attachment.imageDataUrl } }
      ];
    }
    return cloned;
  }

  async function chatDirect(payload = {}, options = {}) {
    const overallTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DIRECT_CHAT_TIMEOUT_MS;
    const overallAbort = createDirectAbortContext(options.signal, overallTimeoutMs);
    try {
    const provider = normalizeProvider(payload.provider || getProviderPreference());
    const targets = getDirectEndpointTargets(provider);
    if (targets.length === 0) throw new Error("Set a private or loopback OpenAI-compatible endpoint URL first.");
    const requestedModel = `${payload.model || "auto"}`.trim();
    const catalog = await discoverDirectModels({
      provider,
      timeoutMs: Math.min(Number(options.timeoutMs) || DIRECT_MODEL_TIMEOUT_MS, DIRECT_MODEL_TIMEOUT_MS),
      signal: overallAbort.signal
    });
    const { messages, attachment } = buildDirectMessages(payload);
    const errors = [];
    const explicitModel = requestedModel && requestedModel.toLowerCase() !== "auto";
    const exactCatalogRows = explicitModel
      ? catalog.models.filter((row) => `${row?.id || ""}`.trim().toLowerCase() === requestedModel.toLowerCase())
      : [];
    if (exactCatalogRows.length > 0 && exactCatalogRows.every((row) => row.chatCapable === false)) {
      throw new Error(`The selected model (${requestedModel}) is embedding-only and cannot be used for chat.`);
    }
    const matchingProviders = explicitModel
      ? new Set(exactCatalogRows
          .filter((row) => row.chatCapable !== false)
          .map((row) => row.provider))
      : new Set();
    let orderedTargets = [...targets].sort((left, right) => {
      const leftMatch = matchingProviders.has(left.provider) ? 1 : 0;
      const rightMatch = matchingProviders.has(right.provider) ? 1 : 0;
      return rightMatch - leftMatch;
    });
    if (matchingProviders.size > 0) {
      orderedTargets = orderedTargets.filter((target) => matchingProviders.has(target.provider));
    }
    const perTargetTimeoutMs = orderedTargets.length > 1
      ? Math.min(overallTimeoutMs, 60000)
      : overallTimeoutMs;

    for (const target of orderedTargets) {
      const providerModels = catalog.models.filter((row) => row.provider === target.provider && row.chatCapable !== false);
      const model = explicitModel
        ? requestedModel
        : `${providerModels[0]?.id || ""}`.trim();
      if (!model) {
        errors.push(`${target.provider}: no model is available`);
        continue;
      }
      try {
        const directMessages = addDirectAttachment(messages, attachment, target.type);
        const temperature = Number.isFinite(Number(payload.temperature))
          ? Math.max(0, Math.min(2, Number(payload.temperature)))
          : 0.7;
        const route = target.type === "ollama" ? "/api/chat" : "/v1/chat/completions";
        const body = target.type === "ollama"
          ? { model, messages: directMessages, stream: false, options: { temperature } }
          : { model, messages: directMessages, stream: false, temperature };
        const response = await directFetchJson(target, route, {
          method: "POST",
          body,
          timeoutMs: perTargetTimeoutMs,
          signal: overallAbort.signal
        });
        const reply = target.type === "ollama"
          ? `${response.data?.message?.content || ""}`.trim()
          : `${response.data?.choices?.[0]?.message?.content || ""}`.trim();
        if (!reply) throw new Error(`${target.provider} returned no assistant text.`);
        return {
          ok: true,
          reply,
          provider: target.provider,
          model,
          source: "direct",
          capabilities: {
            pcBridge: false,
            desktopTools: false,
            mediaControl: false,
            localFiles: false,
            mcp: false
          }
        };
      } catch (error) {
        if (overallAbort.signal.aborted) throw error;
        errors.push(`${target.provider}: ${error?.message || error || "request failed"}`);
      }
    }
    throw new Error(errors.join(" | ") || "No direct AI endpoint returned a reply.");
    } finally {
      overallAbort.cleanup();
    }
  }

  function getRequestHeaders() {
    const secret = getBridgeSecret();
    const token = getLocalLlmToken();
    return {
      ...(secret ? { "X-Bridge-Secret": secret } : {}),
      ...(token ? { "X-Local-LLM-Token": token } : {})
    };
  }

  function parseRequestUrl(input) {
    try {
      const raw = typeof input === "string" ? input : `${input?.url || ""}`;
      if (!raw) return null;
      return new URL(raw, global.location?.href || "http://localhost");
    } catch (_error) {
      return null;
    }
  }

  function isLoopbackHost(hostname = "") {
    const host = `${hostname || ""}`.trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  function isBridgeApiRequest(input) {
    const url = parseRequestUrl(input);
    if (!url) return false;
    const configured = parseRequestUrl(getBridgeBaseUrl());
    const isConfiguredBridge = Boolean(configured && configured.origin === url.origin);
    return (isLoopbackHost(url.hostname) || isConfiguredBridge)
      && /^\/api\/(?:local-llm|llm|system-media|system|tools|assistant|security)(?:\/|$)/i.test(url.pathname || "");
  }

  function consumeBridgePairingFragment() {
    const rawHash = `${global.location?.hash || ""}`.replace(/^#/, "");
    if (!rawHash || !/(?:^|&)ss_bridge_(?:url|secret)=/i.test(rawHash)) return false;
    const params = new URLSearchParams(rawHash);
    const bridgeUrl = params.get("ss_bridge_url") || "";
    const bridgeSecret = params.get("ss_bridge_secret") || "";
    const localToken = params.get("ss_local_llm_token") || "";
    if (bridgeUrl) setBridgeBaseUrl(bridgeUrl);
    if (bridgeSecret) setBridgeSecret(bridgeSecret);
    if (localToken) setLocalLlmToken(localToken);
    safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
    try {
      const cleanUrl = `${global.location.pathname || ""}${global.location.search || ""}`;
      global.history?.replaceState?.(global.history.state, "", cleanUrl || "/");
    } catch (_error) {
      // The fragment is not sent to the server; failure to clean it is non-fatal.
    }
    notifyConfigChanged({ paired: true });
    return true;
  }

  function makeBridgeUnavailableResponse(input, reason = "Local bridge request failed.") {
    const url = parseRequestUrl(input);
    return new Response(JSON.stringify({
      ok: false,
      error: reason,
      message: reason,
      bridgeUnavailable: true,
      route: url?.pathname || ""
    }), {
      status: 503,
      statusText: "Bridge unavailable",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Signal-Share-Bridge-Fallback": "1"
      }
    });
  }

  function installBridgeFetchGuard() {
    if (global.__signalShareBridgeFetchGuardInstalled || typeof global.fetch !== "function") return;
    global.__signalShareBridgeFetchGuardInstalled = true;

    const nativeFetch = global.fetch.bind(global);
    global.fetch = async function signalShareBridgeGuardedFetch(input, init) {
      const bridgeRequest = isBridgeApiRequest(input);
      try {
        const response = await nativeFetch(input, init);
        if (response) return response;
        if (bridgeRequest) return makeBridgeUnavailableResponse(input, "Local bridge returned no response.");
        throw new TypeError("Fetch returned no response.");
      } catch (error) {
        if (bridgeRequest) {
          return makeBridgeUnavailableResponse(input, error?.message || "Local bridge request failed.");
        }
        throw error;
      }
    };
  }

  consumeBridgePairingFragment();
  installBridgeFetchGuard();

  global.SignalShareLocalLlm = Object.freeze({
    BRIDGE_URL_KEY,
    BRIDGE_URL_LEGACY_KEYS,
    BRIDGE_SECRET_KEY,
    BRIDGE_SECRET_LEGACY_KEYS,
    LOCAL_LLM_TOKEN_KEY,
    LOCAL_LLM_TOKEN_LEGACY_KEYS,
    AI_PROVIDER_KEY,
    CUSTOM_ENDPOINT_BASE_URL_KEY,
    LM_STUDIO_ENDPOINT_BASE_URL_KEY,
    OLLAMA_ENDPOINT_BASE_URL_KEY,
    PROVIDERS,
    DIRECT_ENDPOINT_DEFAULTS,
    normalizeBridgeBaseUrl,
    getBridgeBaseUrl,
    setBridgeBaseUrl,
    getBridgeSecret,
    setBridgeSecret,
    getLocalLlmToken,
    setLocalLlmToken,
    normalizeProvider,
    getProviderPreference,
    setProviderPreference,
    getCustomEndpointBaseUrl,
    setCustomEndpointBaseUrl,
    normalizeDirectEndpointBaseUrl,
    getDirectEndpointBaseUrl,
    setDirectEndpointBaseUrl,
    getDirectEndpointTargets,
    discoverDirectModels,
    chatDirect,
    consumeBridgePairingFragment,
    getRequestHeaders
  });
})(window);
