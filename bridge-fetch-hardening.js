(function installBridgeFetchHardening() {
  if (window.__signalShareBridgeFetchHardeningInstalled || typeof window.fetch !== "function") return;
  window.__signalShareBridgeFetchHardeningInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const BRIDGE_PATH_PATTERN = /^\/api\/(?:local-llm|llm|system-media|system|tools|assistant|security)(?:\/|$)/i;

  function parseRequestUrl(input) {
    try {
      const raw = typeof input === "string" ? input : `${input?.url || ""}`;
      if (!raw) return null;
      return new URL(raw, window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function isLoopbackHost(hostname = "") {
    const host = `${hostname || ""}`.trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  function isBridgeRequest(input) {
    const url = parseRequestUrl(input);
    if (!url) return false;
    return isLoopbackHost(url.hostname) && BRIDGE_PATH_PATTERN.test(url.pathname || "");
  }

  function makeBridgeOfflineResponse(input, reason = "Local bridge is unreachable.") {
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

  window.fetch = async function signalShareBridgeSafeFetch(input, init) {
    const bridgeRequest = isBridgeRequest(input);
    try {
      const response = await nativeFetch(input, init);
      if (!response && bridgeRequest) {
        return makeBridgeOfflineResponse(input, "Local bridge returned no response.");
      }
      if (!response) {
        throw new TypeError("Fetch returned no response.");
      }
      return response;
    } catch (error) {
      if (bridgeRequest) {
        return makeBridgeOfflineResponse(input, error?.message || "Local bridge request failed.");
      }
      throw error;
    }
  };
})();
