const CACHE_NAME = "signal-share-shell-v98";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=91",
  "./config.js",
  "./api-v3.js?v=92",
  "./app-v3.js?v=96",
  "./app-v3-ui.js?v=96",
  "./terms.html",
  "./privacy.html",
  "./site.webmanifest",
  "./icons/icon-192.png?v=2",
  "./icons/icon-512.png?v=2",
  "./icons/icon-maskable-512.png?v=2",
  "./icons/apple-touch-icon-180.png?v=2",
];

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
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      });
    })
  );
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

  event.waitUntil(self.registration.showNotification(title, options));
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
