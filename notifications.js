// Signal Share Notification System (V26 - UNREAD STATES)
// Added: Tracking of 'read' vs 'unread' notifications with visual opacity differences.

(function() {
  console.log("[Notifications] Loading V26...");

  let history = [];
  let count = 0;

  function load() {
    try {
      history = JSON.parse(localStorage.getItem('notif_v17_hist') || '[]');
      count = parseInt(localStorage.getItem('notif_v17_count') || '0');
    } catch (e) {
      history = [];
      count = 0;
    }
  }

  function save() {
    localStorage.setItem('notif_v17_hist', JSON.stringify(history.slice(0, 50)));
    localStorage.setItem('notif_v17_count', count.toString());
    renderUI();
  }

  function add(opts) {
    if (!opts || !opts.message) return;
    const id = opts.id || ('n-' + Date.now() + Math.random());
    if (history.some(n => n.id === id)) return;

    const item = {
      id,
      title: opts.title || 'Signal Share',
      message: opts.message,
      timestamp: Date.now(),
      type: opts.type || 'info',
      threadId: opts.threadId || "",
      read: false // New items are always unread
    };

    history.unshift(item);
    if (!opts.silent) {
      count++;
      showBanner(item);
    }
    save();
  }

  function handleNotificationClick(n) {
    console.log("[Notifications] Item clicked:", n);
    
    // Mark as read
    n.read = true;
    save();
    
    // Close the panel first (optional, but usually desired if navigating)
    // if (window.toggleNotificationsPanel) window.toggleNotificationsPanel();
    
    // Determine where to go
    const msg = (n.message + n.title).toLowerCase();
    if (msg.includes('message') || msg.includes('text') || n.threadId) {
      if (window.openMessengerFromNotification) {
        window.openMessengerFromNotification(n.threadId || "");
      }
    } else if (msg.includes('account') || msg.includes('profile')) {
      window.location.hash = "account";
    } else if (msg.includes('feed') || msg.includes('like')) {
      window.location.hash = "feed";
    }
  }

  function renderUI() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      badge.textContent = count;
      badge.style.setProperty('display', count > 0 ? 'flex' : 'none', 'important');
      badge.style.setProperty('bottom', '0px', 'important');
      badge.style.setProperty('right', '4px', 'important');
      applyThemeToBadge(badge);
    }

    const list = document.getElementById('notificationsList');
    const emptyState = document.getElementById('notificationsEmptyState');
    if (list) {
      list.innerHTML = '';
      if (history.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        history.forEach(n => {
          const li = document.createElement('li');
          
          // Style based on READ state
          const isUnread = n.read === false;
          const bg = isUnread ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
          const opacity = isUnread ? "1" : "0.75";
          const border = isUnread ? "4px solid #3b82f6" : "4px solid rgba(255,255,255,0.2)";
          
          li.style.cssText = `padding:12px; margin-bottom:8px; border-radius:8px; background:${bg}; border-left:${border}; cursor:pointer; color:inherit; list-style:none; transition: all 0.2s; opacity:${opacity};`;
          
          li.innerHTML = `<strong style="color:inherit;">${n.title}</strong><p style="margin:4px 0; font-size:0.9rem; opacity:0.8; color:inherit;">${n.message}</p>`;
          
          li.onclick = (e) => {
            e.stopPropagation();
            handleNotificationClick(n);
          };
          
          li.onmouseover = () => { 
            li.style.background = isUnread ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)";
            li.style.opacity = "1";
          };
          li.onmouseout = () => { 
            li.style.background = bg;
            li.style.opacity = opacity;
          };
          
          list.appendChild(li);
        });
      }
    }
  }

  function applyThemeToBadge(badge) {
    if (!badge) return;
    const currentTheme = document.body.dataset.theme || 
                         document.documentElement.getAttribute('data-theme') || 
                         document.body.getAttribute('data-theme') ||
                         "sunset";
    
    const isMidnight = currentTheme.toLowerCase().includes('midnight');
    badge.style.setProperty('background-color', isMidnight ? '#3b82f6' : '#000000', 'important');
    badge.style.setProperty('color', '#ffffff', 'important');
  }

  function showBanner(item) {
    let container = document.getElementById('notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-container';
      container.className = 'notification-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `notification notification-${item.type}`;
    el.style.cssText = "background:rgba(0,0,0,0.95); color:white; padding:15px; margin-bottom:10px; border-radius:10px; border-left:5px solid #3b82f6; box-shadow:0 5px 20px rgba(0,0,0,0.5); z-index:10001; position:relative; pointer-events:auto; cursor:pointer;";
    el.innerHTML = `<strong>${item.title}</strong><div style="font-size:0.9rem;">${item.message}</div>`;
    el.onclick = () => { handleNotificationClick(item); el.remove(); };
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
  }

  const themeObserver = new MutationObserver(() => {
    const badge = document.getElementById('notificationBadge');
    if (badge) applyThemeToBadge(badge);
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  window.addEventListener('storage', (e) => {
    if (e.key === 'notif_v17_hist' || e.key === 'notif_v17_count') { load(); renderUI(); }
  });

  window.notifications = {
    add: add,
    success: (m, t, o) => add({...o, type:'success', message:m, title:t}),
    error: (m, t, o) => add({...o, type:'error', message:m, title:t}),
    info: (m, t, o) => add({...o, type:'info', message:m, title:t}),
    warning: (m, t, o) => add({...o, type:'warning', message:m, title:t}),
    clearHistory: () => { history = []; count = 0; save(); },
    resetBadge: () => { count = 0; save(); },
    markAllAsRead: () => { history.forEach(n => n.read = true); save(); },
    incrementUnreadCount: () => { count++; save(); },
    syncWithSupabase: () => {},
    setUnreadCount: (c) => { if(c===0) { count = 0; save(); } }
  };

  window.renderNotificationsHistory = renderUI;
  load();
  if (document.readyState !== 'loading') renderUI();
  else document.addEventListener('DOMContentLoaded', renderUI);
  setTimeout(renderUI, 500);

})();