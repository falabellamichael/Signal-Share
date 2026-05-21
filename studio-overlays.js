(() => {
  const overlays = {
    publish: document.querySelector("#compose"),
    account: document.querySelector("#account"),
    admin: document.querySelector("#adminLayoutOverlay"),
  };

  const adminEditor = document.querySelector("#adminEditor");
  const adminLauncher = document.querySelector("#adminLayoutOverlayButton");
  const openButtons = [...document.querySelectorAll("[data-studio-overlay-open]")];
  let activeKey = "";
  let returnFocusElement = null;

  function getOverlay(key) {
    return overlays[key] ?? null;
  }

  function setLauncherState(key, isOpen) {
    openButtons
      .filter((button) => button.dataset.studioOverlayOpen === key)
      .forEach((button) => button.setAttribute("aria-expanded", isOpen ? "true" : "false"));
  }

  function syncPageLock() {
    const isOpen = Boolean(activeKey);
    document.documentElement.classList.toggle("studio-overlay-open", isOpen);
    document.body.classList.toggle("studio-overlay-open", isOpen);
  }

  function closeOverlay(key = activeKey, options = {}) {
    const { restoreFocus = true } = options;
    const overlay = getOverlay(key);
    if (!overlay || activeKey !== key) return;

    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.hidden = true;
    activeKey = "";
    setLauncherState(key, false);
    syncPageLock();

    if (restoreFocus && returnFocusElement instanceof HTMLElement) {
      returnFocusElement.focus();
    }
    returnFocusElement = null;
  }

  function openOverlay(key, launcher) {
    const overlay = getOverlay(key);
    if (!overlay) return;
    if (key === "admin" && (!adminEditor || adminEditor.hidden)) return;

    if (activeKey) closeOverlay(activeKey, { restoreFocus: false });

    activeKey = key;
    returnFocusElement = launcher instanceof HTMLElement ? launcher : document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-open");
    setLauncherState(key, true);
    syncPageLock();

    requestAnimationFrame(() => {
      overlay.querySelector(".studio-overlay-close")?.focus();
    });
  }

  function handleOpenClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const launcher = target?.closest("[data-studio-overlay-open]");
    if (!launcher) return;

    event.preventDefault();
    openOverlay(launcher.dataset.studioOverlayOpen, launcher);
  }

  function handleCloseClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const closeButton = target?.closest("[data-studio-overlay-close]");
    if (!closeButton) return;

    event.preventDefault();
    closeOverlay(closeButton.dataset.studioOverlayClose);
  }

  function syncAdminLauncher() {
    const canOpen = Boolean(adminEditor && !adminEditor.hidden);
    if (adminLauncher) adminLauncher.hidden = !canOpen;
    if (!canOpen && activeKey === "admin") closeOverlay("admin", { restoreFocus: false });
  }

  document.addEventListener("click", handleOpenClick);
  document.addEventListener("click", handleCloseClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeKey) {
      event.preventDefault();
      closeOverlay(activeKey);
    }
  });

  document.querySelector("#openOwnProfileButton")?.addEventListener("click", () => {
    if (activeKey === "account") closeOverlay("account", { restoreFocus: false });
  });

  if (adminEditor) {
    new MutationObserver(syncAdminLauncher).observe(adminEditor, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  syncAdminLauncher();
  window.SignalShareStudioOverlays = { open: openOverlay, close: closeOverlay };
})();
