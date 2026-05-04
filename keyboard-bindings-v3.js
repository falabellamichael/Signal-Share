// Keyboard Bindings for Signal Share
// Version: 2026-05-03.01 (Fixed getKeyCombo TypeError)
// This file handles keyboard shortcuts and navigation

class KeyboardBindings {
  constructor() {
    this.shortcuts = new Map();
    this.init();
  }

  init() {
    // Initialize keyboard event listeners
    this.setupEventListeners();
    
    // Register default shortcuts
    this.registerDefaultShortcuts();
  }

  setupEventListeners() {
    // Listen for keyboard events in the capture phase to prioritize our handlers
    document.addEventListener('keydown', (event) => {
      this.handleKeyDown(event);
    }, true);
    
    // Listen for focus events to manage keyboard context
    document.addEventListener('focus', (event) => {
      this.handleFocus(event);
    }, true);
  }

  handleKeyDown(event) {
    // Don't process shortcuts if user is typing in an input field
    const activeElement = document.activeElement;
    if (activeElement && 
        (activeElement.tagName === 'INPUT' || 
         activeElement.tagName === 'TEXTAREA' || 
         activeElement.isContentEditable)) {
      return;
    }

    // Check if any registered shortcut matches
    const keyCombo = this.getKeyCombo(event);
    const shortcut = this.shortcuts.get(keyCombo);
    
    if (shortcut) {
      // Aggressively prevent default and stop propagation
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Execute the shortcut handler
      if (typeof shortcut.handler === 'function') {
        shortcut.handler(event);
      }
      
      // Log the action for debugging
      console.log(`Keyboard shortcut executed: ${keyCombo}`);
    }
  }

  handleFocus(event) {
    // This can be used to manage keyboard context
    // For example, disabling certain shortcuts when in forms
  }

  getKeyCombo(event) {
    if (!event) return '';
    let combo = '';
    
    if (event.ctrlKey) combo += 'Ctrl+';
    if (event.altKey) combo += 'Alt+';
    if (event.shiftKey) combo += 'Shift+';
    
    // Safety check for event.key
    const key = event.key;
    if (typeof key !== 'string') return combo;

    // Handle special keys
    if (key === ' ') {
      combo += 'Space';
    } else if (key === 'Enter') {
      combo += 'Enter';
    } else if (key === 'Escape') {
      combo += 'Escape';
    } else if (key === 'Tab') {
      combo += 'Tab';
    } else if (key.length === 1) {
      combo += key.toLowerCase();
    } else {
      combo += key;
    }
    
    return combo;
  }

  // Register a keyboard shortcut
  registerShortcut(keyCombo, handler, description = '') {
    this.shortcuts.set(keyCombo, {
      handler,
      description,
      registered: new Date()
    });
    
    console.log(`Registered shortcut: ${keyCombo} -> ${description}`);
  }

  // Register default shortcuts for Signal Share
  registerDefaultShortcuts() {
    // Navigation shortcuts
    this.registerShortcut('n', () => {
      // Navigate to notifications
      const notificationButton = document.getElementById('notificationsLauncherButton');
      if (notificationButton) {
        notificationButton.click();
      }
    }, 'Open notifications panel');

    this.registerShortcut('c', () => {
      // Navigate to compose
      const composeButton = document.querySelector('a[href="#compose"]');
      if (composeButton) {
        composeButton.click();
      }
    }, 'Open compose panel');

    this.registerShortcut('f', () => {
      // Focus search
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.focus();
      }
    }, 'Focus search');

    this.registerShortcut('s', () => {
      // Focus search
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.focus();
      }
    }, 'Focus search');

    this.registerShortcut('m', () => {
      // Navigate to messages
      const messagesButton = document.querySelector('a[href="#messages"]');
      if (messagesButton) {
        messagesButton.click();
      }
    }, 'Open messages panel');

    this.registerShortcut('p', () => {
      // Navigate to profile
      const profileButton = document.querySelector('a[href="#profileView"]');
      if (profileButton) {
        profileButton.click();
      }
    }, 'Open profile');

    this.registerShortcut('g', () => {
      // Navigate to feed
      const feedButton = document.querySelector('a[href="#feed"]');
      if (feedButton) {
        feedButton.click();
      }
    }, 'Open feed');

    // Notification shortcuts
    this.registerShortcut('Alt+Shift+n', () => {
      // Show notification
      if (window.notifications) {
        window.notifications.success('Test notification', 'Success');
      }
    }, 'Show test notification');
    
    this.registerShortcut('Alt+Shift+l', () => {
      // Open latest notification
      if (window.notifications) {
        const history = window.notifications.getHistory();
        if (history.length > 0) {
          const event = new CustomEvent("signal:notificationClick", {
            detail: history[0]
          });
          document.dispatchEvent(event);
        }
      }
    }, 'Open latest notification');

    this.registerShortcut('Escape', () => {
      // Close active panels
      const activePanels = document.querySelectorAll('[aria-hidden="false"]');
      activePanels.forEach(panel => {
        if (panel.classList.contains('settings-panel')) {
          const closeButton = panel.querySelector('.settings-close');
          if (closeButton) closeButton.click();
        }
      });
    }, 'Close active panels');

    // Media player shortcuts
    this.registerShortcut('Space', () => {
      // Toggle play/pause for media player
      const miniPlayer = document.getElementById('miniPlayer');
      if (miniPlayer && !miniPlayer.classList.contains('hidden')) {
        // Toggle play/pause logic would go here
        console.log('Toggle play/pause');
      }
    }, 'Toggle play/pause');

    this.registerShortcut('ArrowLeft', () => {
      // Previous media
      const prevButton = document.getElementById('miniPrevButton');
      if (prevButton) prevButton.click();
    }, 'Previous media');

    this.registerShortcut('ArrowRight', () => {
      // Next media
      const nextButton = document.getElementById('miniNextButton');
      if (nextButton) nextButton.click();
    }, 'Next media');

    // Quick actions
    this.registerShortcut('Alt+Shift+p', () => {
      // Open profile
      const profileButton = document.querySelector('a[href="#profileView"]');
      if (profileButton) profileButton.click();
    }, 'Open profile');

    this.registerShortcut('Alt+Shift+c', () => {
      // Open compose
      const composeButton = document.querySelector('a[href="#compose"]');
      if (composeButton) composeButton.click();
    }, 'Open compose');

    this.registerShortcut('Alt+Shift+f', () => {
      // Focus search
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.focus();
    }, 'Focus search');
  }

  // Enable keyboard shortcuts for a specific context
  enableShortcuts(context = 'global') {
    // This can be used to enable/disable shortcuts based on context
    console.log(`Keyboard shortcuts enabled for ${context}`);
  }

  // Disable keyboard shortcuts for a specific context
  disableShortcuts(context = 'global') {
    // This can be used to enable/disable shortcuts based on context
    console.log(`Keyboard shortcuts disabled for ${context}`);
  }

  // Get all registered shortcuts
  getShortcuts() {
    return Array.from(this.shortcuts.entries());
  }

  // Remove a shortcut
  removeShortcut(keyCombo) {
    if (this.shortcuts.has(keyCombo)) {
      this.shortcuts.delete(keyCombo);
      console.log(`Removed shortcut: ${keyCombo}`);
    }
  }

  // Clear all shortcuts
  clearShortcuts() {
    this.shortcuts.clear();
    console.log('Cleared all keyboard shortcuts');
  }
}

// Initialize keyboard bindings
let keyboardBindings = null;

// Create keyboard bindings instance immediately if we can, or on load
function initKeyboardBindings() {
  if (!keyboardBindings) {
    keyboardBindings = new KeyboardBindings();
    window.keyboardBindings = keyboardBindings;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKeyboardBindings);
} else {
  initKeyboardBindings();
}

// Make it globally available
window.KeyboardBindings = KeyboardBindings;

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyboardBindings;
}