// Signal Share Notification System (NUCLEAR RESTART)
// This version is stripped of all complex logic. 
// The badge starts at 0 every refresh and only increases during your current session.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.badgeCount = 0;
    this.container = null;
    
    // ONE-TIME CLEANUP of old buggy storage
    if (!localStorage.getItem('notif_v9_reset')) {
      localStorage.removeItem('notifications');
      localStorage.setItem('notif_v9_reset', 'true');
    }
    
    this.init();
  }

  init() {
    this.loadHistory();
    this.setupUI();
    this.resetBadge();
    console.log("[Notifications] Nuclear Restart Complete. Badge is 0.");
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('notifications_history_v9');
      this.history = JSON.parse(saved || '[]');
    } catch (e) {
      this.history = [];
    }
  }

  saveHistory() {
    // Keep only last 50 items for the history panel
    localStorage.setItem('notifications_history_v9', JSON.stringify(this.history.slice(0, 50)));
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

  // THE ONLY WAY to add a notification
  add(options) {
    if (!options || !options.message) return;

    // Simple ID-based de-duplication
    const id = options.id || (Date.now() + '-' + Math.random().toString(36).substr(2, 5));
    if (this.history.some(n => n.id === id)) return;

    const item = {
      id,
      title: options.title || 'Notification',
      message: options.message,
      timestamp: Date.now(),
      type: options.type || 'info'
    };
    
    this.history.unshift(item);
    this.saveHistory();

    // 2. Increment badge ONLY if not silent
    if (!options.silent) {
      this.badgeCount++;
      this.updateBadgeUI();
      this.showBanner(item);
    }
  }

  showBanner(item) {
    const el = document.createElement('div');
    el.className = `notification notification-${item.type}`;
    el.innerHTML = `
      <div style="font-weight:bold;">${item.title}</div>
      <div>${item.message}</div>
    `;
    el.style.cursor = 'pointer';
    el.onclick = () => el.remove();
    this.container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
  }

  updateBadgeUI() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      badge.textContent = this.badgeCount;
      badge.style.display = this.badgeCount > 0 ? 'flex' : 'none';
    }
    if (window.Capacitor?.Plugins?.Badge) {
      window.Capacitor.Plugins.Badge.set({ count: this.badgeCount }).catch(() => {});
    }
  }

  resetBadge() {
    this.badgeCount = 0;
    this.updateBadgeUI();
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.resetBadge();
  }

  // Legacy support stubs - all mapped to the new simple 'add'
  success(m, t, o) { this.add({ ...o, type: 'success', message: m, title: t }); }
  error(m, t, o) { this.add({ ...o, type: 'error', message: m, title: t }); }
  info(m, t, o) { this.add({ ...o, type: 'info', message: m, title: t }); }
  warning(m, t, o) { this.add({ ...o, type: 'warning', message: m, title: t }); }
  
  showNotification(o) { this.add(o); }
  addToHistory(o) { this.add(o); }
  setUnreadCount(c) { if (c === 0) this.resetBadge(); }
  incrementUnreadCount() { 
    // Just bump the number if called from old code, don't add a message
    this.badgeCount++;
    this.updateBadgeUI();
  }
  syncWithSupabase() {} 
}

// Instantiate
window.notifications = new NotificationSystem();

// Simple history renderer
window.renderNotificationsHistory = function() {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = '';
  window.notifications.history.forEach(n => {
    const li = document.createElement('li');
    li.style.cssText = "padding:10px; margin-bottom:5px; border-radius:5px; background:rgba(255,255,255,0.05); border-left:4px solid #3b82f6;";
    li.innerHTML = `<strong>${n.title}</strong><p>${n.message}</p>`;
    list.appendChild(li);
  });
};