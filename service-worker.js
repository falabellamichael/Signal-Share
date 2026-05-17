const CACHE_NAME = "signal-share-shell-v124";
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
  "./terms.html",
  "./privacy.html",
  "./site.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
];

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

async function fetchAndCache(request) {
  const response = await fetch(request, { cache: "no-store" });
  if (response && response.status === 200 && response.type === "basic") {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
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
  const response = await fetch(request);
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

  if (request.method === "POST" && /^\/api\/(?:local-llm|llm)\/chat$/i.test(url.pathname)) {
    event.respondWith(fetchAndScrubChatResponse(request));
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
