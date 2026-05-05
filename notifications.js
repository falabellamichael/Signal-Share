// Signal Share Notification System (v7 - Anti-Skyrocket)
// Optimized for strict de-duplication and 24h retention.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.container = null;
    this.init();
  }

  init() {
    this.load();
    this.setupUI();
    console.log("[Notifications] System Initialized (v7).");
  }

  load() {
    try {
      let saved = JSON.parse(localStorage.getItem('notifications')) || [];
      if (!Array.isArray(saved)) saved = [];
      
      const now = Date.now();
      const threshold = now - (24 * 60 * 60 * 1000);
      
      // Strict filtering: 24h + Deduplication by ID and Content
      const seenIds = new Set();
      const seenContent = new Set();
      
      this.history = saved.filter(n => {
        if (!n || typeof n !== 'object' || !n.timestamp || n.timestamp < threshold) return false;
        
        const contentKey = (n.title || '') + '|' + (n.message || '');
        if (seenIds.has(n.id) || seenContent.has(contentKey)) return false;
        
        seenIds.add(n.id);
        seenContent.add(contentKey);
        return true;
      });

      this.save();
    } catch (e) {
      console.error("[Notifications] Load error:", e);
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
    if (!options || !options.message) return;
    
    const title = options.title || 'Signal Share';
    const message = options.message;
    const contentKey = title + '|' + message;
    
    // Strict De-duplication Check
    if (this.history.some(n => n.id === options.id || (n.title + '|' + n.message) === contentKey)) {
      console.log("[Notifications] Duplicate suppressed:", title);
      return;
    }

    const notification = {
      id: options.id || ('notif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5)),
      type: options.type || 'info',
      title,
      message,
      data: options.data || null,
      timestamp: Date.now(),
      read: false
    };

    this.history.unshift(notification);
    this.save();

    // Visual Alerts
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (!options.silent) {
      if (!isMobile) this.showBanner(notification);
      this.showSystemNotification(notification);
    }
  }

  showBanner(notification) {
    const el = document.createElement('div');
    el.className = `notification notification-${notification.type}`;
    el.innerHTML = `
      <div class="notification-header">
        <strong>${notification.title}</strong>
        <button class="notification-close">&times;</button>
      </div>
      <div class="notification-message">${notification.message}</div>
    `;

    el.onclick = (e) => {
      if (e.target.classList.contains('notification-close')) {
        el.remove();
        return;
      }
      this.handleNotificationClick(notification);
      el.remove();
    };

    el.querySelector('.notification-close').onclick = (e) => {
      e.stopPropagation();
      el.remove();
    };

    this.container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
  }

  showSystemNotification(notification) {
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (isMobile) return;

    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden && document.hasFocus()) return;

    try {
      const n = new Notification(notification.title, {
        body: notification.message,
        icon: "./icons/icon-192.png",
        tag: notification.id // Tag prevents multiple system alerts for same notification
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

  // Backward compatibility stubs
  success(msg, title, opts) { this.add({ ...opts, type: 'success', message: msg, title: title || 'Success' }); }
  error(msg, title, opts) { this.add({ ...opts, type: 'error', message: msg, title: title || 'Error' }); }
  info(msg, title, opts) { this.add({ ...opts, type: 'info', message: msg, title: title || 'New Message' }); }
  warning(msg, title, opts) { this.add({ ...opts, type: 'warning', message: msg, title: title || 'Warning' }); }
  setUnreadCount(count) { if (count === 0) this.markAllRead(); }
  syncWithSupabase() { /* No-op, managed by realtime */ }
  incrementUnreadCount() { /* No-op, badge is history-derived */ }
}

// Global initialization
window.notifications = new NotificationSystem();

// UI Hook
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
    li.className = `notification-history-item ${n.read ? 'read' : 'unread'}`;
    li.style.cssText = "padding: 12px; margin-bottom: 8px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; border-left: 4px solid " + (n.type === 'success' ? '#10b981' : '#3b82f6');
    li.innerHTML = `<strong>${n.title}</strong><p style="margin:4px 0;opacity:0.8;">${n.message}</p><small style="opacity:0.5;">${new Date(n.timestamp).toLocaleTimeString()}</small>`;
    li.onclick = () => window.notifications.handleNotificationClick(n);
    list.appendChild(li);
  });
};