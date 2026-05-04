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
    if (document.body) {
      document.body.appendChild(container);
    }
    
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
    if (this.notificationContainer) {
      this.notificationContainer.appendChild(notificationElement);
    }

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
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissNotification(notification.id);
      });
    }

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

  // Manage unread notification badge
  setUnreadCount(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    
    localStorage.setItem('signal_share_unread_count', count.toString());
    
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.setProperty('display', 'flex', 'important');
      badge.style.setProperty('opacity', '1', 'important');
      badge.style.setProperty('visibility', 'visible', 'important');
    } else {
      badge.style.setProperty('display', 'none', 'important');
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
    } catch { return []; }
  }

  saveHistory(history) {
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem('signal_share_notifications_history', JSON.stringify(history));
    if (window.renderNotificationsHistory) window.renderNotificationsHistory();
  }

  getClearedIds() {
    try {
      const cleared = JSON.parse(localStorage.getItem('signal_share_notifications_cleared_ids') || '[]');
      return new Set(Array.isArray(cleared) ? cleared : []);
    } catch { return new Set(); }
  }

  saveClearedIds(clearedIds) {
    const arr = Array.from(clearedIds).slice(-200); // Limit to 200 items
    localStorage.setItem('signal_share_notifications_cleared_ids', JSON.stringify(arr));
  }

  addToHistory(notification) {
    const history = this.getHistory();
    const clearedIds = this.getClearedIds();
    
    // Stable ID generation for blacklisting
    let stableId = notification.id;
    if (!stableId) {
       const content = (notification.title || '') + (notification.message || '');
       let hash = 0;
       for (let i = 0; i < content.length; i++) {
         hash = ((hash << 5) - hash) + content.charCodeAt(i);
         hash |= 0;
       }
       stableId = 'gen-' + Math.abs(hash).toString(36);
    }

    // 1. Blacklist Check
    if (clearedIds.has(stableId)) return;

    // 2. Duplicate Check
    if (history.some(item => item.id === stableId)) return;

    history.unshift({
      id: stableId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      timestamp: Date.now()
    });
    this.saveHistory(history);
  }

  async syncWithSupabase(supabase, currentUserId) {
    if (!supabase || !currentUserId) return;
    console.log("[Notifications] Syncing missed notifications...");
    
    try {
      const history = this.getHistory();
      let lastTimestamp = 0;
      if (history.length > 0) {
        lastTimestamp = new Date(history[0].timestamp).getTime();
      } else {
        lastTimestamp = Date.now() - (24 * 60 * 60 * 1000);
      }

      const isoTimestamp = new Date(lastTimestamp).toISOString();

      // 2. Fetch new likes
      const { data: newLikes, error: likesError } = await supabase
        .from("post_likes")
        .select("*, posts!inner(author_id, title)")
        .eq("posts.author_id", currentUserId)
        .gt("created_at", isoTimestamp)
        .neq("user_id", currentUserId);

      if (!likesError && newLikes) {
        newLikes.forEach(like => {
          this.addToHistory({
            id: `like-${like.post_id}-${like.user_id}`,
            type: "success",
            title: "New Like!",
            message: `Someone liked your post: ${like.posts.title || "Untitled"}`
          });
          this.incrementUnreadCount();
        });
      }

      // 3. Fetch new messages
      const { data: threads, error: threadsError } = await supabase
        .from("direct_threads")
        .select("id")
        .or(`user_one_id.eq.${currentUserId},user_two_id.eq.${currentUserId}`);

      if (!threadsError && threads && threads.length > 0) {
        const threadIds = threads.map(t => t.id);
        const { data: newMessages, error: msgError } = await supabase
          .from("messages")
          .select("*")
          .in("thread_id", threadIds)
          .gt("created_at", isoTimestamp)
          .neq("sender_id", currentUserId);

        if (!msgError && newMessages) {
          newMessages.forEach(msg => {
            this.addToHistory({
              id: msg.id,
              type: "info",
              title: "New Message",
              message: msg.body || "Sent an attachment"
            });
            this.incrementUnreadCount();
          });
        }
      }
      console.log("[Notifications] Sync complete.");
    } catch (e) {
      console.error("[Notifications] Sync failed:", e);
    }
  }

  clearHistory() {
    const history = this.getHistory();
    const clearedIds = this.getClearedIds();
    history.forEach(item => {
      if (item.id) clearedIds.add(item.id);
    });
    this.saveClearedIds(clearedIds);
    this.saveHistory([]);
    this.setUnreadCount(0);
    console.log("[Notifications] History cleared and IDs blacklisted.");
  }
}

// Wrap info/warning/error/success methods to log to history
['info', 'success', 'warning', 'error'].forEach(method => {
  const original = NotificationSystem.prototype[method];
  NotificationSystem.prototype[method] = function(message, title) {
    const defaultTitles = { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error' };
    const actualTitle = title || defaultTitles[method];
    this.addToHistory({ type: method, title: actualTitle, message: message });
    return original.call(this, message, actualTitle);
  };
});

// UI Integration
window.renderNotificationsPanel = function() {
  const panel = document.getElementById('notificationsPanel');
  if (!panel || !window.state) return;
  const isOpen = window.state.notificationsPanelOpen;
  panel.hidden = !isOpen;
  panel.classList.toggle("is-open", isOpen);
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
      li.style.cursor = "pointer";
      li.innerHTML = `<strong style="display:block;font-size:0.95rem;margin-bottom:4px;">${item.title}</strong><span style="font-size:0.85rem;color:var(--text-muted, #ccc);">${item.message}</span>`;
      list.appendChild(li);
    });
  }
};

// Initialize
let notificationSystem = null;
function initNotifications() {
  if (notificationSystem) return;
  notificationSystem = new NotificationSystem();
  window.notifications = notificationSystem;
  
  const savedCount = parseInt(localStorage.getItem('signal_share_unread_count') || '0', 10);
  if (savedCount > 0) notificationSystem.setUnreadCount(savedCount);
  console.log("[Notifications] System Initialized (Reverted).");
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNotifications);
} else {
  initNotifications();
}
window.addEventListener('load', initNotifications);

window.NotificationSystem = NotificationSystem;