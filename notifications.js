// Notification System for Signal Share
// This file handles notification display and management

class NotificationSystem {
  constructor() {
    this.notifications = [];
    this.notificationContainer = null;
    this.init();
  }

  init() {
    // Create notification container if it doesn't exist
    this.notificationContainer = document.getElementById('notification-container');
    if (!this.notificationContainer) {
      this.notificationContainer = this.createNotificationContainer();
    }
    
    // Initialize notification system
    this.setupEventListeners();
  }

  createNotificationContainer() {
    const container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    container.setAttribute('aria-live', 'assertive');
    container.setAttribute('aria-atomic', 'true');
    
    // Add to body
    document.body.appendChild(container);
    
    return container;
  }

  setupEventListeners() {
    // Listen for custom notification events
    document.addEventListener('signal:showNotification', (event) => {
      this.showNotification(event.detail);
    });
    
    // Listen for notification dismissal
    document.addEventListener('signal:dismissNotification', (event) => {
      this.dismissNotification(event.detail.id);
    });
  }

  showNotification(options) {
    const notification = {
      id: this.generateId(),
      type: options.type || 'info',
      title: options.title || '',
      message: options.message || '',
      duration: options.duration || 5000,
      timestamp: new Date()
    };

    // Add to notifications array
    this.notifications.push(notification);

    // Create notification element
    const notificationElement = this.createNotificationElement(notification);
    
    // Add to container
    this.notificationContainer.appendChild(notificationElement);

    // Auto-dismiss if duration is set
    if (notification.duration > 0) {
      setTimeout(() => {
        this.dismissNotification(notification.id);
      }, notification.duration);
    }

    return notification.id;
  }

  createNotificationElement(notification) {
    const element = document.createElement('div');
    element.className = `notification notification-${notification.type}`;
    element.setAttribute('role', 'alert');
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('data-notification-id', notification.id);
    
    // Add content
    element.innerHTML = `
      <div class="notification-content">
        <div class="notification-header">
          <strong class="notification-title">${notification.title}</strong>
          <button class="notification-close" aria-label="Close notification" data-id="${notification.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <p class="notification-message">${notification.message}</p>
      </div>
    `;

    // Add close button event listener
    const closeButton = element.querySelector('.notification-close');
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissNotification(notification.id);
    });

    return element;
  }

  dismissNotification(id) {
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      const notification = this.notifications[index];
      
      // Remove from array
      this.notifications.splice(index, 1);
      
      // Remove from DOM
      const element = this.notificationContainer.querySelector(`[data-notification-id="${id}"]`);
      if (element) {
        element.classList.add('notification-dismissing');
        setTimeout(() => {
          if (element.parentNode) {
            element.parentNode.removeChild(element);
          }
        }, 300);
      }
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // Public methods for external use
  success(message, title = 'Success') {
    return this.showNotification({
      type: 'success',
      title,
      message
    });
  }

  error(message, title = 'Error') {
    return this.showNotification({
      type: 'error',
      title,
      message
    });
  }

  info(message, title = 'Information') {
    return this.showNotification({
      type: 'info',
      title,
      message
    });
  }

  warning(message, title = 'Warning') {
    return this.showNotification({
      type: 'warning',
      title,
      message
    });
  }

  // Clear all notifications
  clearAll() {
    this.notifications.forEach(notification => {
      this.dismissNotification(notification.id);
    });
    this.notifications = [];
  }

  // Manage unread notification badge on the profile avatar
  setUnreadCount(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    
    // Save to localStorage so it persists across reloads
    localStorage.setItem('signal_share_unread_count', count.toString());
    
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
      badge.style.opacity = '1';
      badge.style.visibility = 'visible';
      console.log("[Notifications] Force showing badge on phone:", count);
    } else {
      badge.style.display = 'none';
    }
  }

  incrementUnreadCount() {
    let count = parseInt(localStorage.getItem('signal_share_unread_count') || '0', 10);
    this.setUnreadCount(count + 1);
  }

  // History Management
  getHistory() {
    try {
      const history = JSON.parse(localStorage.getItem('signal_share_notifications_history') || '[]');
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  saveHistory(history) {
    // Keep last 50 notifications max
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem('signal_share_notifications_history', JSON.stringify(history));
    if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  }

  addToHistory(notification) {
    const history = this.getHistory();
    history.unshift({
      id: notification.id || Date.now().toString(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      timestamp: Date.now()
    });
    this.saveHistory(history);
  }

  clearHistory() {
    this.saveHistory([]);
    this.setUnreadCount(0);
  }
}

// Wrap info/warning/error/success methods to log to history
const originalMethods = {
  info: NotificationSystem.prototype.info,
  success: NotificationSystem.prototype.success,
  warning: NotificationSystem.prototype.warning,
  error: NotificationSystem.prototype.error
};

['info', 'success', 'warning', 'error'].forEach(method => {
  NotificationSystem.prototype[method] = function(message, title) {
    const defaultTitles = { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error' };
    const actualTitle = title || defaultTitles[method];
    this.addToHistory({ type: method, title: actualTitle, message: message });
    return originalMethods[method].call(this, message, actualTitle);
  };
});

// Initialize notification system
let notificationSystem = new NotificationSystem();
window.notifications = notificationSystem;

// Restore badge state immediately
(function restoreBadge() {
  const savedCount = parseInt(localStorage.getItem('signal_share_unread_count') || '0', 10);
  if (savedCount > 0 && window.notifications) {
    window.notifications.setUnreadCount(savedCount);
  }
})();

// Make the class globally available
window.NotificationSystem = NotificationSystem;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationSystem;
}

// UI Integration for Notifications
window.renderNotificationsPanel = function() {
  const panel = document.getElementById('notificationsPanel');
  const launcher = document.getElementById('notificationsLauncherButton');
  if (!panel || !window.state) return;
  
  const isOpen = window.state.notificationsPanelOpen;
  panel.hidden = !isOpen;
  panel.classList.toggle("is-open", isOpen);
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (launcher) launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
};

window.renderNotificationsHistory = function() {
  const list = document.getElementById('notificationsList');
  const emptyState = document.getElementById('notificationsEmptyState');
  const clearButton = document.getElementById('clearNotificationsButton');
  if (!list || !window.notifications) return;
  
  const history = window.notifications.getHistory();
  list.innerHTML = "";
  
  if (history.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (clearButton) clearButton.style.display = "none";
  } else {
    if (emptyState) emptyState.style.display = "none";
    if (clearButton) clearButton.style.display = "block";
    history.forEach(item => {
      const li = document.createElement("li");
      li.style.padding = "12px";
      li.style.background = "var(--bg-elevated, rgba(255,255,255,0.05))";
      li.style.borderRadius = "8px";
      li.innerHTML = `<strong style="display:block;font-size:0.95rem;margin-bottom:4px;">${item.title}</strong><span style="font-size:0.85rem;color:var(--text-muted, #ccc);">${item.message}</span>`;
      list.appendChild(li);
    });
  }
};