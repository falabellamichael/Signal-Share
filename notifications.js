// Signal Share Notification System (v8 - Ultra Hardened)
// This version uses stable IDs, content de-duplication, and rate limiting.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.container = null;
    this.init();
  }

  init() {
    this.load();
    this.setupUI();
    console.log("[Notifications] System Initialized (v8).");
  }

  load() {
    try {
      let saved = JSON.parse(localStorage.getItem('notifications')) || [];
      const now = Date.now();
      const threshold = now - (24 * 60 * 60 * 1000);
      
      const seenIds = new Set();
      const seenContent = new Set();
      
      this.history = saved.filter(n => {
        if (!n || !n.timestamp || n.timestamp < threshold) return false;
        const key = (n.title + '|' + n.message).toLowerCase();
        if (seenIds.has(n.id) || seenContent.has(key)) return false;
        seenIds.add(n.id);
        seenContent.add(key);
        return true;
      });

      this.save();
    } catch (e) {
      this.history = [];
    }
  }

  save() {
    localStorage.setItem('notifications', JSON.stringify(this.history.slice(0, 50)));
    this.updateBadge();
    if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  }

  setupUI() {
    this.container = document.getElementById('notification-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'notification-container';
      this.container.className = 'notification-container';
      document.body.appendChild(this.container);
    }
  }

  add(options) {
    if (!options || !options.message) return null;
    
    const title = (options.title || 'Signal Share').trim();
    const message = options.message.trim();
    const contentKey = (title + '|' + message).toLowerCase();
    
    // Stable ID: Use provided ID or hash of content
    const id = options.id || ('n-' + btoa(contentKey).substring(0, 16));
    
    const existingIndex = this.history.findIndex(n => n.id === id || (n.title + '|' + n.message).toLowerCase() === contentKey);
    
    if (existingIndex !== -1) {
      const existing = this.history[existingIndex];
      // Suppress spam (exact same notification within 30s)
      if (Date.now() - existing.timestamp < 30000) return existing.id;
      // Re-trigger old notification: move to top and mark unread
      this.history.splice(existingIndex, 1);
    }

    const notification = {
      id,
      type: options.type || 'info',
      title,
      message,
      data: options.data || null,
      timestamp: Date.now(),
      read: false
    };

    this.history.unshift(notification);
    this.save();

    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (!options.silent) {
      if (!isMobile) this.showBanner(notification);
      this.showSystemNotification(notification);
    }
    
    return id;
  }

  showBanner(notification) {
    const el = document.createElement('div');
    el.className = `notification notification-${notification.type}`;
    el.innerHTML = `
      <div class="notification-header">
        <strong>${notification.title}</strong>
        <button class="notification-close" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:inherit;">&times;</button>
      </div>
      <div class="notification-message">${notification.message}</div>
    `;

    el.onclick = (e) => {
      if (e.target.closest('.notification-close')) {
        el.remove();
        return;
      }
      this.handleNotificationClick(notification);
      el.remove();
    };

    this.container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
  }

  showSystemNotification(notification) {
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (isMobile || !("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden && document.hasFocus()) return;

    try {
      const n = new Notification(notification.title, {
        body: notification.message,
        icon: "./icons/icon-192.png",
        tag: notification.id
      });
      n.onclick = () => { window.focus(); this.handleNotificationClick(notification); n.close(); };
    } catch (e) {}
  }

  handleNotificationClick(notification) {
    document.dispatchEvent(new CustomEvent('signal:notificationClick', { detail: notification }));
  }

  updateBadge() {
    const unreadCount = this.history.filter(n => !n.read).length;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      badge.textContent = unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
    if (window.Capacitor?.Plugins?.Badge) {
      window.Capacitor.Plugins.Badge.set({ count: unreadCount }).catch(() => {});
    }
  }

  markAllRead() {
    this.history.forEach(n => n.read = true);
    this.save();
  }

  clearHistory() {
    this.history = [];
    this.save();
  }

  // Aliases and legacy stubs
  success(msg, title, opts) { return this.add({ ...opts, type: 'success', message: msg, title: title || 'Success' }); }
  error(msg, title, opts) { return this.add({ ...opts, type: 'error', message: msg, title: title || 'Error' }); }
  info(msg, title, opts) { return this.add({ ...opts, type: 'info', message: msg, title: title || 'New Message' }); }
  warning(msg, title, opts) { return this.add({ ...opts, type: 'warning', message: msg, title: title || 'Warning' }); }
  showNotification(opts) { return this.add(opts); }
  addToHistory(opts) { return this.add(opts); }
  setUnreadCount(count) { if (count === 0) this.markAllRead(); }
  syncWithSupabase() {}
  incrementUnreadCount() {}
}

window.notifications = new NotificationSystem();

window.renderNotificationsHistory = function() {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = '';
  const history = window.notifications.history;
  if (history.length === 0) {
    document.getElementById('notificationsEmptyState').style.display = 'block';
    return;
  }
  document.getElementById('notificationsEmptyState').style.display = 'none';
  history.forEach(n => {
    const li = document.createElement('li');
    const isUnread = !n.read;
    li.className = `notification-history-item ${isUnread ? 'unread' : 'read'}`;
    const borderColor = n.type === 'success' ? '#10b981' : (n.type === 'error' ? '#ef4444' : '#3b82f6');
    li.style.borderLeftColor = borderColor;
    li.innerHTML = `<strong style="display:block;">${n.title}</strong><p style="margin:4px 0;opacity:0.8;font-size:0.9rem;">${n.message}</p><small style="opacity:0.5;">${new Date(n.timestamp).toLocaleTimeString()}</small>`;
    li.onclick = () => window.notifications.handleNotificationClick(n);
    list.appendChild(li);
  });
};