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
  const BRIDGE_ENABLED_KEY = "ss_bridge_enabled";

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
    const configured = readFirstStorageValue([BRIDGE_URL_KEY, ...BRIDGE_URL_LEGACY_KEYS]);
    return normalizeBridgeBaseUrl(configured);
  }

  function setBridgeBaseUrl(value = "") {
    const normalized = normalizeBridgeBaseUrl(value);
    if (normalized) {
      safeSetLocalStorageValue(BRIDGE_URL_KEY, normalized);
      safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
      return normalized;
    }
    safeRemoveLocalStorageValue(BRIDGE_URL_KEY);
    for (const key of BRIDGE_URL_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
    return "";
  }

  function getLocalLlmToken() {
    return readFirstStorageValue([LOCAL_LLM_TOKEN_KEY, ...LOCAL_LLM_TOKEN_LEGACY_KEYS]);
  }

  function setLocalLlmToken(value = "") {
    const token = `${value || ""}`.trim();
    if (token) {
      safeSetLocalStorageValue(LOCAL_LLM_TOKEN_KEY, token);
      safeSetLocalStorageValue(BRIDGE_ENABLED_KEY, "1");
      return token;
    }
    safeRemoveLocalStorageValue(LOCAL_LLM_TOKEN_KEY);
    for (const key of LOCAL_LLM_TOKEN_LEGACY_KEYS) safeRemoveLocalStorageValue(key);
    return "";
  }

  function getRequestHeaders() {
    const token = getLocalLlmToken();
    if (!token) return {};
    return { "X-Local-LLM-Token": token };
  }

  global.SignalShareLocalLlm = Object.freeze({
    BRIDGE_URL_KEY,
    BRIDGE_URL_LEGACY_KEYS,
    LOCAL_LLM_TOKEN_KEY,
    LOCAL_LLM_TOKEN_LEGACY_KEYS,
    normalizeBridgeBaseUrl,
    getBridgeBaseUrl,
    setBridgeBaseUrl,
    getLocalLlmToken,
    setLocalLlmToken,
    getRequestHeaders
  });
})(window);
