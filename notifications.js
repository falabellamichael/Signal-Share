// Signal Share Notification System (VERSION 11 - FINAL RESTART)
// Features: Themed badge colors, exclusive DOM control, and session-only counting.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.count = 0;
    this.init();
  }

  init() {
    this.loadHistory();
    this.resetBadge();
    this.setupUI();
    
    // Listen for theme changes to update badge color
    const observer = new MutationObserver(() => this.applyThemeStyles());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    this.applyThemeStyles();
    
    console.log("[Notifications] V11 Initialized. Badge ID: globalNotificationCount");
  }

  loadHistory() {
    try {
      this.history = JSON.parse(localStorage.getItem('notif_hist_v11') || '[]');
    } catch (e) {
      this.history = [];
    }
  }

  saveHistory() {
    localStorage.setItem('notif_hist_v11', JSON.stringify(this.history.slice(0, 50)));
    if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  }

  setupUI() {
    if (!document.getElementById('notification-container')) {
      const c = document.createElement('div');
      c.id = 'notification-container';
      c.className = 'notification-container';
      document.body.appendChild(c);
    }
  }

  // The ONLY way an item enters the system
  add(opts) {
    if (!opts || !opts.message) return;

    // Strict de-duplication within current session history
    const id = opts.id || Date.now();
    if (this.history.some(n => n.id === id)) return;

    const item = {
      id,
      title: opts.title || 'Signal Share',
      message: opts.message,
      timestamp: Date.now(),
      type: opts.type || 'info'
    };

    this.history.unshift(item);
    this.saveHistory();

    if (!opts.silent) {
      this.count++;
      this.updateUI();
      this.showBanner(item);
    }
  }

  updateUI() {
    const badge = document.getElementById('globalNotificationCount');
    if (badge) {
      badge.textContent = this.count;
      badge.style.display = this.count > 0 ? 'flex' : 'none';
      this.applyThemeStyles();
    }
    if (window.Capacitor?.Plugins?.Badge) {
      window.Capacitor.Plugins.Badge.set({ count: this.count }).catch(() => {});
    }
  }

  applyThemeStyles() {
    const badge = document.getElementById('globalNotificationCount');
    if (!badge) return;

    // Get theme from HTML attribute (common in modern apps) or localStorage
    const theme = document.documentElement.getAttribute('data-theme') || 
                  document.body.className || 
                  "sunset";
    
    const isMidnight = theme.toLowerCase().includes('midnight');
    
    if (isMidnight) {
      badge.style.background = '#3b82f6'; // Premium Blue for Midnight
      badge.style.color = '#ffffff';
    } else {
      badge.style.background = '#000000'; // Black for every other theme
      badge.style.color = '#ffffff';
    }
  }

  showBanner(item) {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `notification notification-${item.type}`;
    el.style.cursor = 'pointer';
    el.innerHTML = `<strong>${item.title}</strong><div>${item.message}</div>`;
    el.onclick = () => el.remove();
    
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
  }

  resetBadge() {
    this.count = 0;
    this.updateUI();
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.resetBadge();
  }

  // Legacy Mapping
  success(m, t, o) { this.add({ ...o, type: 'success', message: m, title: t }); }
  error(m, t, o) { this.add({ ...o, type: 'error', message: m, title: t }); }
  info(m, t, o) { this.add({ ...o, type: 'info', message: m, title: t }); }
  warning(m, t, o) { this.add({ ...o, type: 'warning', message: m, title: t }); }
  
  showNotification(o) { this.add(o); }
  addToHistory(o) { this.add(o); }
  setUnreadCount(c) { if (c === 0) this.resetBadge(); }
  incrementUnreadCount() { 
    this.count++;
    this.updateUI();
  }
  syncWithSupabase() {}
}

window.notifications = new NotificationSystem();

window.renderNotificationsHistory = function() {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  list.innerHTML = '';
  
  window.notifications.history.forEach(n => {
    const li = document.createElement('li');
    li.style.cssText = "padding:12px; margin-bottom:8px; border-radius:8px; background:rgba(255,255,255,0.05); border-left:4px solid #3b82f6; cursor:pointer;";
    li.innerHTML = `<strong>${n.title}</strong><p style="margin:4px 0; font-size:0.9rem; opacity:0.8;">${n.message}</p>`;
    list.appendChild(li);
  });
  
  const empty = document.getElementById('notificationsEmptyState');
  if (empty) empty.style.display = window.notifications.history.length === 0 ? 'block' : 'none';
};