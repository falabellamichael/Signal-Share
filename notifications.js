// Unified Notification System for Signal Share
// This file handles history, badges, and cross-platform notification display.

class NotificationSystem {
  constructor() {
    this.history = [];
    this.container = null;
    this.init();
  }

  init() {
    this.load();
    this.setupUI();
    this.setupListeners();
    console.log("[Notifications] System Initialized (Simplified).");
  }

  load() {
    try {
      const raw = localStorage.getItem('signal_share_notifications_history_v2');
      this.history = JSON.parse(raw || '[]');
      
      // 24-hour auto-cleanup
      const threshold = Date.now() - (24 * 60 * 60 * 1000);
      this.history = this.history.filter(n => n.timestamp > threshold);
      
      // Keep only last 50 items
      if (this.history.length > 50) this.history = this.history.slice(0, 50);
      this.save();
    } catch (e) {
      this.history = [];
    }
  }

  save() {
    localStorage.setItem('signal_share_notifications_history_v2', JSON.stringify(this.history));
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

  setupListeners() {
    // Listen for custom events (Communication from other modules)
    document.addEventListener('signal:showNotification', (event) => {
      this.add(event.detail);
    });

    document.addEventListener('signal:dismissNotification', (event) => {
      this.dismiss(event.detail.id);
    });
  }

  add(options) {
    const id = options.id || this.generateId();
    
    // De-duplication Check
    if (this.history.some(n => n.id === id)) return false;

    const notification = {
      id,
      type: options.type || 'info',
      title: options.title || '',
      message: options.message || '',
      data: options.data || null,
      timestamp: Date.now()
    };

    // Add to history
    this.history.unshift(notification);
    this.save();

    // Visual display (Banner and Browser Notification)
    if (!options.silent) {
      this.renderBanner(notification);
      this.triggerBrowserNotification(notification);
    }

    return true;
  }

  dismiss(id) {
    const element = this.container.querySelector(`[data-notification-id="${id}"]`);
    if (element) {
      element.classList.add('notification-dismissing');
      setTimeout(() => element.remove(), 300);
    }
  }

  clearHistory() {
    this.history = [];
    this.save();
  }

  // --- UI Rendering ---

  renderBanner(notification) {
    const element = document.createElement('div');
    element.className = `notification notification-${notification.type}`;
    element.setAttribute('data-notification-id', notification.id);
    
    element.innerHTML = `
      <div class="notification-content">
        <div class="notification-header">
          <strong class="notification-title">${notification.title}</strong>
          <button class="notification-close" aria-label="Close" data-id="${notification.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <p class="notification-message">${notification.message}</p>
      </div>
    `;

    // Click behavior (PC)
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (!isMobile) {
      element.style.cursor = 'pointer';
      element.addEventListener('click', (e) => {
        if (e.target.closest('.notification-close')) return;
        this.onNotificationClick(notification);
        this.dismiss(notification.id);
      });
    }

    // Close button
    element.querySelector('.notification-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss(notification.id);
    });

    this.container.appendChild(element);

    // Auto-dismiss
    setTimeout(() => this.dismiss(notification.id), 6000);
  }

  triggerBrowserNotification(notification) {
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    if (isMobile) return; // Capacitor handles native push separately

    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden && document.hasFocus()) return;

    const options = {
      body: notification.message,
      icon: "./icons/icon-192.png",
      tag: `msg-${notification.id}`,
      data: notification.data
    };

    const n = new Notification(notification.title, options);
    n.onclick = () => {
      window.focus();
      this.onNotificationClick(notification);
      n.close();
    };
  }

  onNotificationClick(notification) {
    // Notify app-v3 (Coordinator) that a click happened
    const event = new CustomEvent("signal:notificationClick", {
      detail: notification
    });
    document.dispatchEvent(event);
  }

  updateBadge() {
    const count = this.history.length;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Capacitor Native Badge Integration
    if (window.Capacitor?.Plugins?.Badge) {
      window.Capacitor.Plugins.Badge.set({ count }).catch(() => {});
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // --- Convenience Helpers ---
  success(msg, title, options) { this.add({ ...options, type: 'success', message: msg, title: title || 'Success' }); }
  error(msg, title, options) { this.add({ ...options, type: 'error', message: msg, title: title || 'Error' }); }
  info(msg, title, options) { this.add({ ...options, type: 'info', message: msg, title: title || 'Information' }); }
  warning(msg, title, options) { this.add({ ...options, type: 'warning', message: msg, title: title || 'Warning' }); }
}

// Global Instance
window.notifications = new NotificationSystem();

// Legacy UI Hook
window.renderNotificationsHistory = function() {
  const list = document.getElementById('notificationsList');
  const emptyState = document.getElementById('notificationsEmptyState');
  if (!list || !window.notifications) return;
  
  const history = window.notifications.history;
  list.innerHTML = "";
  
  if (history.length === 0) {
    if (emptyState) emptyState.style.display = "block";
  } else {
    if (emptyState) emptyState.style.display = "none";
    history.forEach(item => {
      const li = document.createElement("li");
      li.className = "notification-history-item";
      li.style.cssText = "padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; border-left: 4px solid var(--" + item.type + ", #777);";
      
      li.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:2px;">
          <strong style="display:block;font-size:0.95rem;">${item.title}</strong>
          <span style="font-size:0.85rem;color:rgba(255,255,255,0.7);">${item.message}</span>
          <small style="font-size:0.7rem;opacity:0.5;margin-top:4px;">${new Date(item.timestamp).toLocaleTimeString()}</small>
        </div>
      `;

      li.addEventListener("click", () => {
        window.notifications.onNotificationClick(item);
      });

      // Keyboard support
      li.setAttribute("tabindex", "0");
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); } });

      list.appendChild(li);
    });
  }
};