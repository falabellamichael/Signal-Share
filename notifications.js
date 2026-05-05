// Signal Share Notification System (V20 - STABLE REVERT)
// Reverted the experimental overrides and data merging to restore the last known stable state.

(function() {
  console.log("[Notifications] Loading V20...");

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
      type: opts.type || 'info'
    };

    history.unshift(item);
    if (!opts.silent) {
      count++;
      showBanner(item);
    }
    save();
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
    if (list) {
      list.innerHTML = '';
      history.forEach(n => {
        const li = document.createElement('li');
        li.style.cssText = "padding:12px; margin-bottom:8px; border-radius:8px; background:rgba(255,255,255,0.05); border-left:4px solid #3b82f6; cursor:pointer; color:inherit; list-style:none;";
        li.innerHTML = `<strong style="color:inherit;">${n.title}</strong><p style="margin:4px 0; font-size:0.9rem; opacity:0.8; color:inherit;">${n.message}</p>`;
        list.appendChild(li);
      });
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
    badge.style.setProperty('opacity', '1', 'important');
    badge.style.setProperty('visibility', 'visible', 'important');
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
    el.style.cssText = "background:rgba(0,0,0,0.95); color:white; padding:15px; margin-bottom:10px; border-radius:10px; border-left:5px solid #3b82f6; box-shadow:0 5px 20px rgba(0,0,0,0.5); z-index:10001; position:relative; pointer-events:auto;";
    el.innerHTML = `<strong>${item.title}</strong><div style="font-size:0.9rem;">${item.message}</div>`;
    el.onclick = () => el.remove();
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