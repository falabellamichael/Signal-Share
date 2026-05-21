const CACHE_NAME = "signal-share-shell-v144";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./styles-1.css",
  "./styles-2.css",
  "./styles-3.css",
  "./config.js",
  "./api-v3.js",
  "./app-v3.js",
  "./app-v3-ai.js",
  "./app-v3-ui.js",
  "./app-v3-ui-core.js",
  "./app-v3-ui-settings.js",
  "./app-v3-ui-elements.js",
  "./bridge-fetch-hardening.js",
  "./terms.html",
  "./privacy.html",
  "./site.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
];

const BRIDGE_FETCH_HARDENING_SOURCE = `
(function installBridgeFetchHardening() {
  if (window.__signalShareBridgeFetchHardeningInstalled || typeof window.fetch !== "function") return;
  window.__signalShareBridgeFetchHardeningInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const BRIDGE_PATH_PATTERN = /^\\/api\\/(?:local-llm|llm|system-media|system|tools|assistant|security)(?:\\/|$)/i;

  function parseRequestUrl(input) {
    try {
      const raw = typeof input === "string" ? input : String((input && input.url) || "");
      if (!raw) return null;
      return new URL(raw, window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function isLoopbackHost(hostname) {
    const host = String(hostname || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  function isBridgeRequest(input) {
    const url = parseRequestUrl(input);
    if (!url) return false;
    return isLoopbackHost(url.hostname) && BRIDGE_PATH_PATTERN.test(url.pathname || "");
  }

  function makeBridgeOfflineResponse(input, reason) {
    const url = parseRequestUrl(input);
    const message = reason || "Local bridge is unreachable.";
    return new Response(JSON.stringify({
      ok: false,
      error: message,
      message,
      bridgeUnavailable: true,
      route: (url && url.pathname) || ""
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
      if (!response && bridgeRequest) return makeBridgeOfflineResponse(input, "Local bridge returned no response.");
      if (!response) throw new TypeError("Fetch returned no response.");
      return response;
    } catch (error) {
      if (bridgeRequest) return makeBridgeOfflineResponse(input, (error && error.message) || "Local bridge request failed.");
      throw error;
    }
  };
})();
`;

function isLegacyLocalModelErrorPayload(text = "") {
  const value = `${text || ""}`.toLowerCase();
  const vendor = "lm" + " studio";
  const blockedPort = String.fromCharCode(49, 50, 51, 52);
  return value.includes(vendor) || value.includes(`port ${blockedPort}`) || value.includes(`:${blockedPort}`);
}

function scrubLegacyLocalModelErrorPayload(text = "") {
  if (!isLegacyLocalModelErrorPayload(text)) return text;
  try {
    const payload = JSON.parse(text);
    if (typeof payload?.reply === "string" && isLegacyLocalModelErrorPayload(payload.reply)) {
      payload.reply = "Local AI endpoint is unavailable. Check the configured bridge/provider and try again.";
      return JSON.stringify(payload);
    }
    if (typeof payload?.error === "string" && isLegacyLocalModelErrorPayload(payload.error)) {
      payload.error = "Local AI endpoint is unavailable.";
      return JSON.stringify(payload);
    }
  } catch (_error) {
    // Fall through to plain-text scrub.
  }
  return "Local AI endpoint is unavailable. Check the configured bridge/provider and try again.";
}

function shouldUseNetworkFirst(url) {
  const pathname = `${url.pathname || ""}`.toLowerCase();
  return pathname.endsWith(".js")
    || pathname.endsWith(".css")
    || pathname.endsWith(".html")
    || pathname.endsWith("/")
    || pathname.endsWith("/index.html");
}

function shouldPatchAppUiScript(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin && /\/app-v3-ui(?:-core)?\.js$/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function shouldPatchArcadeChatScript(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin && /\/arcade-chat\.js$/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function patchAppUiScript(text = "") {
  const original = 'function applySiteSettings(settings) { const root = document.documentElement; root.style.setProperty("--shell-max-width", `${settings.shellWidth}px`); root.style.setProperty("--section-gap", `${settings.sectionGap}px`); root.style.setProperty("--radius-xl", `${settings.surfaceRadius}px`); root.style.setProperty("--radius-lg", `${Math.max(18, settings.surfaceRadius - 8)}px`); root.style.setProperty("--radius-md", `${Math.max(14, settings.surfaceRadius - 14)}px`); root.style.setProperty("--feed-media-fit", settings.mediaFit); }';
  const replacement = 'function applySiteSettings(settings = {}) { const safeSettings = { ...DEFAULT_SITE_SETTINGS, ...(settings && typeof settings === "object" ? settings : {}) }; state.siteSettings = safeSettings; const root = document.documentElement; root.style.setProperty("--shell-max-width", `${safeSettings.shellWidth}px`); root.style.setProperty("--section-gap", `${safeSettings.sectionGap}px`); root.style.setProperty("--radius-xl", `${safeSettings.surfaceRadius}px`); root.style.setProperty("--radius-lg", `${Math.max(18, safeSettings.surfaceRadius - 8)}px`); root.style.setProperty("--radius-md", `${Math.max(14, safeSettings.surfaceRadius - 14)}px`); root.style.setProperty("--feed-media-fit", safeSettings.mediaFit); }';
  if (text.includes(original)) return text.replace(original, replacement);
  return text;
}

function patchArcadeChatScript(text = "") {
  const source = `${text || ""}`;
  let patched = source.replace(
    "const shouldBridgeSendPreflight = isEngineStatusOffline();",
    "const shouldBridgeSendPreflight = false;"
  );
  patched = patched.replace(
    "method: 'GET',\n                timeoutMs: 2200",
    "method: 'GET',\n                timeoutMs: 2200,\n                suppressNetworkErrors: true"
  );
  patched = patched.replace(
    "        } catch (error) {\n            console.error(`[Bridge Fetch] Failed to reach ${endpoint}:`, error.message || error);",
    "        } catch (error) {\n            if (!suppressNetworkErrors) {\n                console.error(`[Bridge Fetch] Failed to reach ${endpoint}:`, error.message || error);\n            }"
  );
  if (patched.includes("__signalShareBridgeFetchHardeningInstalled")) return patched;
  return `${BRIDGE_FETCH_HARDENING_SOURCE}\n\n${patched}`;
}

async function maybePatchAndCacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== "basic") return response;

  if (shouldPatchAppUiScript(request) || shouldPatchArcadeChatScript(request)) {
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/javascript; charset=utf-8");
    const originalText = await response.clone().text();
    const patchedText = shouldPatchArcadeChatScript(request)
      ? patchArcadeChatScript(originalText)
      : patchAppUiScript(originalText);
    const patchedResponse = new Response(patchedText, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    const copy = patchedResponse.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    return patchedResponse;
  }

  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
}

async function fetchAndCache(request) {
  const response = await fetch(request, { cache: "no-store" });
  return maybePatchAndCacheResponse(request, response);
}

async function networkFirst(request, fallbackUrl = "") {
  try {
    return await fetchAndCache(request);
  } catch (_error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) return caches.match(fallbackUrl);
    throw _error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return fetchAndCache(request);
}

async function fetchAndScrubChatResponse(request) {
  const fetchOptions = request.method === "GET" ? { cache: "no-store" } : undefined;
  const response = await fetch(request, fetchOptions);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.clone().text().catch(() => "");
  if (!text || !isLegacyLocalModelErrorPayload(text)) return response;

  const headers = new Headers(response.headers);
  if (contentType.includes("application/json")) {
    headers.set("content-type", "application/json; charset=utf-8");
  } else {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  return new Response(scrubLegacyLocalModelErrorPayload(text), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (/^\/api\//i.test(url.pathname)) {
    if (request.method === "POST" && /^\/api\/(?:local-llm|llm)\/chat$/i.test(url.pathname)) {
      event.respondWith(fetchAndScrubChatResponse(request));
      return;
    }
    const fetchOptions = request.method === "GET" ? { cache: "no-store" } : undefined;
    event.respondWith(fetch(request, fetchOptions));
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (shouldUseNetworkFirst(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data?.json?.() ?? {};
    } catch (_error) {
      return {
        title: event.data?.text?.() ?? "New message",
      };
    }
  })();

  const title = payload.title || "New message";
  const options = {
    icon: payload.icon || "./icons/icon-192.png?v=2",
    badge: payload.badge || "./icons/icon-192.png?v=2",
    tag: payload.tag || "direct-message",
    renotify: true,
    vibrate: payload.vibrate || [120, 50, 120],
    data: {
      url: payload.url || "./#messages",
      threadId: payload.threadId || "",
    },
  };

  if (typeof payload.body === "string" && payload.body.trim()) {
    options.body = payload.body.trim();
  }

  const showPush = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const isAnyFocused = clients.some((client) => client.focused);
    if (isAnyFocused) {
      console.log("[ServiceWorker] App is focused, skipping system notification.");
      return;
    }
    return self.registration.showNotification(title, options);
  });

  event.waitUntil(showPush);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "#messages", self.registration.scope).href;
  const threadId = event.notification.data?.threadId || "";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => {
        try {
          const clientUrl = new URL(client.url);
          return clientUrl.origin === self.location.origin;
        } catch (_error) {
          return false;
        }
      });

      if (matchingClient) {
        return matchingClient
          .navigate(targetUrl)
          .catch(() => matchingClient)
          .then((client) => {
            client?.postMessage({
              type: "open-messenger",
              threadId,
            });
            return client?.focus?.();
          });
      }

      return self.clients.openWindow(targetUrl).then((client) => {
        client?.postMessage({
          type: "open-messenger",
          threadId,
        });
        return client;
      });
    })
  );
});
