// Signal Share Notification System (V28 - BACKGROUND SYNC CATCH-UP)
// Added: Supabase catch-up sync so notification badge recovers missed messages after app/web reopen.

(function () {
  console.log("[Notifications] Loading V28...");

  const HISTORY_KEY = "notif_v17_hist";
  const COUNT_KEY = "notif_v17_count";
  const SEEN_KEY = "notif_v17_seen_ids";
  const SYNC_CURSOR_PREFIX = "notif_v17_sync_cursor";
  const MAX_HISTORY_ITEMS = 60;
  const MAX_SEEN_ITEMS = 1200;
  const MAX_SYNC_MESSAGES = 200;
  const INITIAL_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
  const SYNC_MIN_INTERVAL_MS = 12000;

  let history = [];
  let count = 0;
  let seenIds = new Map();
  let syncInFlightPromise = null;
  let lastSyncStartedAt = 0;

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeCount(value) {
    return Math.max(0, Math.round(toFiniteNumber(value, 0)));
  }

  function parseHistory(raw) {
    try {
      const parsed = JSON.parse(raw || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? ""),
          title: String(item.title ?? "Signal Share"),
          message: String(item.message ?? ""),
          timestamp: Number.isFinite(Number(item.timestamp)) ? Number(item.timestamp) : Date.now(),
          type: String(item.type ?? "info"),
          threadId: String(item.threadId ?? ""),
          read: Boolean(item.read),
          data: item.data && typeof item.data === "object" ? item.data : {},
        }))
        .filter((item) => item.id && item.message);
    } catch (_error) {
      return [];
    }
  }

  function parseSeenIds(raw) {
    if (!raw) return new Map();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const next = new Map();
        const now = Date.now();
        parsed.forEach((id) => {
          const normalizedId = String(id ?? "");
          if (normalizedId) next.set(normalizedId, now);
        });
        return next;
      }
      if (parsed && typeof parsed === "object") {
        const next = new Map();
        Object.entries(parsed).forEach(([id, timestamp]) => {
          const normalizedId = String(id ?? "");
          if (!normalizedId) return;
          const numericTimestamp = toFiniteNumber(timestamp, Date.now());
          next.set(normalizedId, numericTimestamp);
        });
        return next;
      }
    } catch (_error) {}
    return new Map();
  }

  function trimSeenIds() {
    if (seenIds.size <= MAX_SEEN_ITEMS) return;
    const sorted = Array.from(seenIds.entries()).sort((left, right) => right[1] - left[1]);
    seenIds = new Map(sorted.slice(0, MAX_SEEN_ITEMS));
  }

  function saveSeenIds() {
    trimSeenIds();
    const serialized = Object.fromEntries(seenIds.entries());
    localStorage.setItem(SEEN_KEY, JSON.stringify(serialized));
  }

  function rememberSeenId(id, timestamp = Date.now()) {
    const normalizedId = String(id ?? "");
    if (!normalizedId) return;
    seenIds.set(normalizedId, toFiniteNumber(timestamp, Date.now()));
    trimSeenIds();
  }

  function hasSeenId(id) {
    const normalizedId = String(id ?? "");
    return normalizedId ? seenIds.has(normalizedId) : false;
  }

  function trimHistory() {
    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS);
    }
  }

  function load() {
    seenIds = parseSeenIds(localStorage.getItem(SEEN_KEY));
    history = parseHistory(localStorage.getItem(HISTORY_KEY));
    history.forEach((item) => rememberSeenId(item.id, item.timestamp));
    trimHistory();
    count = normalizeCount(localStorage.getItem(COUNT_KEY));
    saveSeenIds();
  }

  function save(options = {}) {
    const { render = true } = options;
    trimHistory();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(COUNT_KEY, String(normalizeCount(count)));
    saveSeenIds();
    if (render) renderUI();
  }

  function getSyncCursorKey(userId) {
    return `${SYNC_CURSOR_PREFIX}:${userId}`;
  }

  function getSyncCursor(userId) {
    if (!userId) return "";
    const raw = localStorage.getItem(getSyncCursorKey(userId)) || "";
    if (!raw) return "";
    const timestamp = Date.parse(raw);
    return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
  }

  function setSyncCursor(userId, isoValue) {
    if (!userId) return;
    const timestamp = Date.parse(isoValue);
    if (Number.isNaN(timestamp)) return;
    localStorage.setItem(getSyncCursorKey(userId), new Date(timestamp).toISOString());
  }

  function getInitialSyncCursorIso() {
    return new Date(Date.now() - INITIAL_SYNC_LOOKBACK_MS).toISOString();
  }

  function truncateText(value, maxLength) {
    const clean = String(value ?? "");
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
  }

  function summarizeMessageRow(row) {
    if (!row || typeof row !== "object") return "New direct message";
    if (typeof row.body === "string" && row.body.trim()) return truncateText(row.body.trim(), 120);
    if (typeof row.attachment_name === "string" && row.attachment_name.trim()) return `Sent ${row.attachment_name.trim()}`;
    if (typeof row.attachment_kind === "string" && row.attachment_kind.trim()) return `Sent a ${row.attachment_kind.trim()}`;
    return "New direct message";
  }

  function getNotificationId(opts) {
    if (opts?.id) return String(opts.id);
    return `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function hasNotification(id) {
    return history.some((item) => item.id === id);
  }

  function dispatchCustomEvent(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_error) {}
  }

  function add(opts) {
    if (!opts || typeof opts !== "object") return false;
    const message = String(opts.message ?? "").trim();
    if (!message) return false;

    const id = getNotificationId(opts);
    if (hasNotification(id) || hasSeenId(id)) return false;

    const timestampFromInput = Number(opts.timestamp);
    const createdAtFromInput = Date.parse(String(opts.createdAt ?? ""));
    const timestamp = Number.isFinite(timestampFromInput)
      ? timestampFromInput
      : (Number.isNaN(createdAtFromInput) ? Date.now() : createdAtFromInput);

    const item = {
      id,
      title: String(opts.title ?? "Signal Share"),
      message,
      timestamp,
      type: String(opts.type ?? "info"),
      threadId: String(opts.threadId ?? opts.data?.threadId ?? ""),
      read: Boolean(opts.read),
      data: opts.data && typeof opts.data === "object" ? opts.data : {},
    };

    history.unshift(item);
    rememberSeenId(item.id, item.timestamp);
    if (opts.incrementCount !== false && !item.read) count = normalizeCount(count + 1);
    if (!opts.silent) showBanner(item);
    save();
    dispatchCustomEvent("notification:show", item);
    return true;
  }

  function clearHistory() {
    history = [];
    count = 0;
    save();
  }

  function resetBadge() {
    count = 0;
    save();
  }

  function markAllAsRead() {
    history.forEach((item) => {
      item.read = true;
    });
    save();
  }

  function handleNotificationClick(notification) {
    if (!notification) return;
    notification.read = true;

    const payloadType = String(notification.data?.type ?? "").toLowerCase();
    const threadId = String(notification.threadId || notification.data?.threadId || "");
    let actionTaken = false;

    if (payloadType === "message" || threadId) {
      if (typeof window.openMessengerFromNotification === "function") {
        window.openMessengerFromNotification(threadId);
        actionTaken = true;
      }
    } else {
      const haystack = `${notification.title} ${notification.message}`.toLowerCase();
      if (haystack.includes("account") || haystack.includes("profile")) {
        window.location.hash = "account";
        actionTaken = true;
      } else if (haystack.includes("feed") || haystack.includes("like")) {
        window.location.hash = "feed";
        actionTaken = true;
      }
    }

    if (actionTaken) {
      history = history.filter((item) => item.id !== notification.id);
      if (typeof window.toggleNotificationsPanel === "function") {
        window.toggleNotificationsPanel();
      }
    }

    save();
    dispatchCustomEvent("notification:dismiss", notification);
  }

  function renderUI() {
    const badge = document.getElementById("notificationBadge");
    if (badge) {
      badge.textContent = String(normalizeCount(count));
      badge.style.setProperty("display", count > 0 ? "flex" : "none", "important");
      badge.style.setProperty("bottom", "0px", "important");
      badge.style.setProperty("right", "4px", "important");
      applyThemeToBadge(badge);
    }

    const list = document.getElementById("notificationsList");
    const emptyState = document.getElementById("notificationsEmptyState");
    if (!list) return;

    list.innerHTML = "";
    if (!history.length) {
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    history.forEach((notification) => {
      const li = document.createElement("li");
      const isUnread = notification.read === false;
      const bg = isUnread ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.02)";
      const opacity = isUnread ? "1" : "0.55";
      const border = isUnread ? "4px solid #3b82f6" : "4px solid rgba(0,0,0,0.1)";
      li.style.cssText = `padding:12px; margin-bottom:8px; border-radius:12px; background:${bg}; border-left:${border}; cursor:pointer; color:inherit; list-style:none; transition: all 0.2s; opacity:${opacity};`;
      li.innerHTML = `<strong style="color:inherit;">${notification.title}</strong><p style="margin:4px 0; font-size:0.9rem; opacity:0.8; color:inherit;">${notification.message}</p>`;
      li.onclick = (event) => {
        event.stopPropagation();
        handleNotificationClick(notification);
      };
      li.onmouseover = () => {
        li.style.background = isUnread ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.04)";
        li.style.opacity = "1";
      };
      li.onmouseout = () => {
        li.style.background = bg;
        li.style.opacity = opacity;
      };
      list.appendChild(li);
    });
  }

  function applyThemeToBadge(badge) {
    if (!badge) return;
    const currentTheme = document.body.dataset.theme ||
      document.documentElement.getAttribute("data-theme") ||
      document.body.getAttribute("data-theme") ||
      "sunset";
    const isMidnight = currentTheme.toLowerCase().includes("midnight");
    badge.style.setProperty("background-color", isMidnight ? "#3b82f6" : "#000000", "important");
    badge.style.setProperty("color", "#ffffff", "important");
  }

  function showBanner(item) {
    let container = document.getElementById("notification-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "notification-container";
      container.className = "notification-container";
      document.body.appendChild(container);
    }
    const el = document.createElement("div");
    el.className = `notification notification-${item.type}`;
    el.style.cssText = "background:rgba(0,0,0,0.95); color:white; padding:15px; margin-bottom:10px; border-radius:10px; border-left:5px solid #3b82f6; box-shadow:0 5px 20px rgba(0,0,0,0.5); z-index:10001; position:relative; pointer-events:auto; cursor:pointer;";
    el.innerHTML = `<strong>${item.title}</strong><div style="font-size:0.9rem;">${item.message}</div>`;
    el.onclick = () => {
      handleNotificationClick(item);
      el.remove();
    };
    container.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 5000);
  }

  async function syncWithSupabase(supabase, userId, options = {}) {
    const { force = false } = options || {};
    if (!supabase || typeof supabase.from !== "function" || !userId) return { added: 0, skipped: true };

    const now = Date.now();
    if (syncInFlightPromise) return syncInFlightPromise;
    if (!force && now - lastSyncStartedAt < SYNC_MIN_INTERVAL_MS) return { added: 0, skipped: true };
    lastSyncStartedAt = now;

    syncInFlightPromise = (async () => {
      let added = 0;
      const cursor = getSyncCursor(userId) || getInitialSyncCursorIso();
      let latestSeenIso = cursor;

      const { data: threadRows, error: threadError } = await supabase
        .from("direct_threads")
        .select("id")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
      if (threadError) throw threadError;

      const threadIds = (threadRows || []).map((row) => row.id).filter(Boolean);
      if (!threadIds.length) {
        setSyncCursor(userId, new Date().toISOString());
        return { added: 0, skipped: false };
      }

      let messageQuery = supabase
        .from("messages")
        .select("id,thread_id,sender_id,body,attachment_name,attachment_kind,created_at")
        .in("thread_id", threadIds)
        .neq("sender_id", userId)
        .order("created_at", { ascending: true })
        .limit(MAX_SYNC_MESSAGES);

      if (cursor) {
        messageQuery = messageQuery.gt("created_at", cursor);
      }

      const { data: messageRows, error: messageError } = await messageQuery;
      if (messageError) throw messageError;
      if (!Array.isArray(messageRows) || !messageRows.length) {
        setSyncCursor(userId, new Date().toISOString());
        return { added: 0, skipped: false };
      }

      const senderIds = Array.from(new Set(messageRows.map((row) => row.sender_id).filter(Boolean)));
      const senderNameById = new Map();
      if (senderIds.length) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id,display_name")
          .in("id", senderIds);
        if (Array.isArray(profileRows)) {
          profileRows.forEach((profile) => {
            const profileId = String(profile?.id ?? "");
            if (!profileId) return;
            const displayName = String(profile?.display_name ?? "").trim() || "Someone";
            senderNameById.set(profileId, displayName);
          });
        }
      }

      for (const row of messageRows) {
        const senderName = senderNameById.get(String(row.sender_id || "")) || "Someone";
        const createdAt = String(row.created_at || "");
        const didAdd = add({
          id: String(row.id || ""),
          type: "info",
          title: `${senderName} sent a message`,
          message: summarizeMessageRow(row),
          threadId: String(row.thread_id || ""),
          data: { type: "message", threadId: String(row.thread_id || "") },
          createdAt,
          silent: true,
          incrementCount: true,
        });
        if (didAdd) added += 1;
        if (createdAt && (!latestSeenIso || Date.parse(createdAt) > Date.parse(latestSeenIso))) {
          latestSeenIso = createdAt;
        }
      }

      setSyncCursor(userId, latestSeenIso || new Date().toISOString());
      return { added, skipped: false };
    })().catch((error) => {
      console.error("[Notifications] Supabase sync failed", error);
      return { added: 0, skipped: false, error: true };
    }).finally(() => {
      syncInFlightPromise = null;
    });

    return syncInFlightPromise;
  }

  const themeObserver = new MutationObserver(() => {
    const badge = document.getElementById("notificationBadge");
    if (badge) applyThemeToBadge(badge);
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class"] });

  window.addEventListener("storage", (event) => {
    if (event.key === HISTORY_KEY || event.key === COUNT_KEY || event.key === SEEN_KEY) {
      load();
      renderUI();
    }
  });

  window.notifications = {
    add,
    showNotification: (options) => {
      const id = getNotificationId(options ?? {});
      add({ ...(options || {}), id });
      return id;
    },
    success: (message, title, options) => add({ ...(options || {}), type: "success", message, title }),
    error: (message, title, options) => add({ ...(options || {}), type: "error", message, title }),
    info: (message, title, options) => add({ ...(options || {}), type: "info", message, title }),
    warning: (message, title, options) => add({ ...(options || {}), type: "warning", message, title }),
    clearHistory: () => {
      clearHistory();
    },
    clearAll: () => {
      clearHistory();
    },
    resetBadge: () => {
      resetBadge();
    },
    markAllAsRead: () => {
      markAllAsRead();
    },
    incrementUnreadCount: () => {
      count = normalizeCount(count + 1);
      save();
    },
    syncWithSupabase: (supabase, userId, options) => syncWithSupabase(supabase, userId, options),
    setUnreadCount: (nextCount) => {
      count = normalizeCount(nextCount);
      save();
    },
  };

  window.renderNotificationsHistory = renderUI;
  load();
  if (document.readyState !== "loading") renderUI();
  else document.addEventListener("DOMContentLoaded", renderUI);
  setTimeout(renderUI, 500);
})();
