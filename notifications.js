// Signal Share Notification System (v6 - Final Restoration)
// This version strictly follows the user's requested minimalist logic.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.container = null;
    this.init();
  }

  init() {
    this.load();
    this.setupUI();
    console.log("[Notifications] System Initialized.");
  }

  // Use the exact key and logic suggested by the user
  load() {
    try {
      let saved = JSON.parse(localStorage.getItem('notifications')) || [];
      const now = new Date().getTime();
      const threshold = now - (24 * 60 * 60 * 1000); // 24 hours
      
      this.history = saved.filter(n => n.timestamp > threshold);
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
    if (!options || !options.message) return;
    
    // De-duplication
    const id = options.id || ('n-' + Date.now() + Math.random().toString(36).substr(2, 5));
    if (this.history.some(n => n.id === id)) return;

    const notification = {
      id,
      type: options.type || 'info',
      title: options.title || 'Signal Share',
      message: options.message,
      data: options.data || null,
      timestamp: Date.now(),
      read: false
    };

    this.history.unshift(notification);
    this.save();

    // Trigger visual alerts
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
    if (isMobile) return; // Mobile uses native push

    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden && document.hasFocus()) return;

    const n = new Notification(notification.title, {
      body: notification.message,
      icon: "./icons/icon-192.png",
      data: notification.data
    });

    n.onclick = () => {
      window.focus();
      this.handleNotificationClick(notification);
      n.close();
    };
  }

  handleNotificationClick(notification) {
    // Notify app-v3 coordinator
    document.dispatchEvent(new CustomEvent('signal:notificationClick', { detail: notification }));
  }

  updateBadge() {
    const unreadCount = this.history.filter(n => !n.read).length;
    
    // 1. Update the UI badge
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      badge.textContent = unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

    // 2. Update the Capacitor app icon badge
    if (window.Capacitor?.Plugins?.Badge) {
      window.Capacitor.Plugins.Badge.set({ count: unreadCount }).catch(() => {});
    }
    
    // 3. Sync to legacy storage if needed
    localStorage.setItem('signal_share_unread_count', unreadCount.toString());
  }

  markAllRead() {
    this.history.forEach(n => n.read = true);
    this.save();
  }

  clearHistory() {
    this.history = [];
    this.save();
  }

  // Standard wrappers for external calls
  success(msg, title, opts) { this.add({ ...opts, type: 'success', message: msg, title: title || 'Success' }); }
  error(msg, title, opts) { this.add({ ...opts, type: 'error', message: msg, title: title || 'Error' }); }
  info(msg, title, opts) { this.add({ ...opts, type: 'info', message: msg, title: title || 'New Message' }); }
  warning(msg, title, opts) { this.add({ ...opts, type: 'warning', message: msg, title: title || 'Warning' }); }
  
  // Stubs for app-v3
  setUnreadCount(count) { if (count === 0) this.markAllRead(); }
  syncWithSupabase() { /* Communication is handled by app-v3 or realtime */ }
}

// Global exposure
window.notifications = new NotificationSystem();

// Legacy UI hook for rendering the history list
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
    
    li.innerHTML = `
      <strong style="display:block;">${n.title}</strong>
      <p style="margin: 4px 0; font-size: 0.9rem; opacity: 0.8;">${n.message}</p>
      <small style="opacity: 0.5;">${new Date(n.timestamp).toLocaleTimeString()}</small>
    `;
    
    li.onclick = () => window.notifications.handleNotificationClick(n);
    list.appendChild(li);
  });
};