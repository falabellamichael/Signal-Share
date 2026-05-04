// Integration between Notification System and Keyboard Bindings
// This file handles the connection between keyboard shortcuts and notifications

class NotificationKeyboardIntegration {
  constructor() {
    this.init();
  }

  init() {
    // Listen for notification events to provide keyboard feedback
    this.setupNotificationEventListeners();
    
    // Register keyboard shortcuts that work with notifications
    this.registerNotificationShortcuts();
  }

  setupNotificationEventListeners() {
    // Listen for notification system events
    document.addEventListener('notification:show', (event) => {
      this.handleNotificationShow(event.detail);
    });
    
    document.addEventListener('notification:dismiss', (event) => {
      this.handleNotificationDismiss(event.detail);
    });
    
    // Listen for notification system initialization
    document.addEventListener('DOMContentLoaded', () => {
      if (window.notifications) {
        this.setupNotificationSystemIntegration();
      }
    });
  }

  setupNotificationSystemIntegration() {
    // Add keyboard accessibility to notification system
    const notificationContainer = document.getElementById('notification-container');
    
    if (notificationContainer) {
      // Add keyboard navigation to notifications
      notificationContainer.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          // Dismiss all notifications on Escape key
          if (window.notifications) {
            window.notifications.clearAll();
          }
        }
      });
    }
  }

  registerNotificationShortcuts() {
    // Register shortcuts that work with notifications
    if (window.keyboardBindings) {
      // Shortcut to dismiss all notifications
      window.keyboardBindings.registerShortcut(
        'Alt+Shift+d',
        () => {
          if (window.notifications) {
            window.notifications.clearAll();
          }
        },
        'Dismiss all notifications'
      );
      
      // Shortcut to show a test notification
      window.keyboardBindings.registerShortcut(
        'Alt+Shift+t',
        () => {
          if (window.notifications) {
            window.notifications.info('Keyboard shortcut test', 'Test Notification');
          }
        },
        'Show test notification'
      );
      
      // Shortcut to show success notification
      window.keyboardBindings.registerShortcut(
        'Alt+Shift+s',
        () => {
          if (window.notifications) {
            window.notifications.success('Operation completed', 'Success');
          }
        },
        'Show success notification'
      );
      
      // Shortcut to show error notification
      window.keyboardBindings.registerShortcut(
        'Alt+Shift+e',
        () => {
          if (window.notifications) {
            window.notifications.error('Something went wrong', 'Error');
          }
        },
        'Show error notification'
      );
    }
  }

  handleNotificationShow(notification) {
    // Add any keyboard-specific behavior when a notification is shown
    console.log('Notification shown:', notification);
    
    // For example, we could add focus management here
    if (notification.type === 'error' || notification.type === 'warning') {
      // Maybe focus the notification for accessibility
    }
  }

  handleNotificationDismiss(notification) {
    // Add any keyboard-specific behavior when a notification is dismissed
    console.log('Notification dismissed:', notification);
  }

  // Method to show notification with keyboard integration
  showNotificationWithKeyboardIntegration(options) {
    // Add keyboard accessibility features
    if (window.notifications) {
      const notificationId = window.notifications.showNotification(options);
      
      // Add keyboard focus management
      const notificationElement = document.querySelector(`[data-notification-id="${notificationId}"]`);
      if (notificationElement) {
        // Make it focusable for screen readers
        notificationElement.setAttribute('tabindex', '-1');
        notificationElement.focus();
      }
      
      return notificationId;
    }
  }

  // Method to get keyboard shortcuts for notifications
  getNotificationShortcuts() {
    const shortcuts = [
      {
        key: 'Alt+Shift+d',
        description: 'Dismiss all notifications',
        action: 'Clear all notifications'
      },
      {
        key: 'Alt+Shift+t',
        description: 'Show test notification',
        action: 'Display test notification'
      },
      {
        key: 'Alt+Shift+s',
        description: 'Show success notification',
        action: 'Display success notification'
      },
      {
        key: 'Alt+Shift+e',
        description: 'Show error notification',
        action: 'Display error notification'
      }
    ];
    
    return shortcuts;
  }
}

// Initialize the integration
let notificationKeyboardIntegration = null;

// Create integration instance immediately if we can, or on load
function initNotificationKeyboardIntegration() {
  if (!notificationKeyboardIntegration) {
    notificationKeyboardIntegration = new NotificationKeyboardIntegration();
    window.notificationKeyboardIntegration = notificationKeyboardIntegration;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNotificationKeyboardIntegration);
} else {
  initNotificationKeyboardIntegration();
}

// Make it globally available
window.NotificationKeyboardIntegration = NotificationKeyboardIntegration;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationKeyboardIntegration;
}