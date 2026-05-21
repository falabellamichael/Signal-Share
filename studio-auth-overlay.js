(() => {
  const accountOverlay = document.querySelector("#account");
  const emailInput = document.querySelector("#authEmailInput");
  const feedback = document.querySelector("#authFeedback");
  const forgotPasswordButton = document.querySelector("#forgotPasswordButton");
  const sessionsButton = document.querySelector("#authSessionsButton");
  const sessionSheet = document.querySelector("#authSessionSheet");
  const sessionCloseButton = document.querySelector("#authSessionCloseButton");
  const signOutOtherSessionsButton = document.querySelector("#signOutOtherSessionsButton");
  const sessionNote = document.querySelector("#authSessionNote");
  const currentSessionCopy = document.querySelector("#authCurrentSessionCopy");

  if (!accountOverlay || !sessionSheet) return;

  function getAppState() {
    return window.state ?? window.__SIGNAL_SHARE_STATE__ ?? null;
  }

  function showAuthMessage(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  }

  function getAccountEmail() {
    const state = getAppState();
    return `${state?.currentUser?.email || emailInput?.value || ""}`.trim();
  }

  function getResetRedirectUrl() {
    const url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  }

  function syncSessionSheet() {
    const state = getAppState();
    const isSignedIn = Boolean(state?.currentUser && state?.supabase && state.backendMode === "supabase");
    const email = getAccountEmail();

    if (currentSessionCopy) {
      currentSessionCopy.textContent = email
        ? `${email} is signed in here.`
        : "This browser session is open.";
    }

    if (sessionNote) {
      sessionNote.textContent = isSignedIn
        ? "Other device refresh sessions can be revoked while this browser stays open."
        : "Sign in first to manage other signed-in devices.";
    }

    if (signOutOtherSessionsButton) {
      signOutOtherSessionsButton.disabled = !isSignedIn;
    }
  }

  function openSessionSheet() {
    syncSessionSheet();
    sessionSheet.hidden = false;
    sessionSheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => sessionCloseButton?.focus());
  }

  function closeSessionSheet(options = {}) {
    const { restoreFocus = true } = options;
    sessionSheet.hidden = true;
    sessionSheet.setAttribute("aria-hidden", "true");
    if (restoreFocus) sessionsButton?.focus();
  }

  async function sendPasswordReset() {
    const state = getAppState();
    const email = getAccountEmail();
    if (!state?.supabase || state.backendMode !== "supabase") {
      showAuthMessage("Password reset is available after Supabase login is configured.", true);
      return;
    }
    if (!email) {
      showAuthMessage("Enter your account email before requesting a password reset.", true);
      emailInput?.focus();
      return;
    }

    forgotPasswordButton.disabled = true;
    try {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getResetRedirectUrl(),
      });
      if (error) {
        showAuthMessage(error.message, true);
        return;
      }
      showAuthMessage(`Password reset email sent to ${email}.`);
    } finally {
      forgotPasswordButton.disabled = false;
    }
  }

  async function signOutOtherSessions() {
    const state = getAppState();
    if (!state?.supabase || state.backendMode !== "supabase" || !state.currentUser) {
      syncSessionSheet();
      showAuthMessage("Sign in before signing out other devices.", true);
      return;
    }

    signOutOtherSessionsButton.disabled = true;
    try {
      const { error } = await state.supabase.auth.signOut({ scope: "others" });
      if (error) {
        showAuthMessage(error.message, true);
        return;
      }
      showAuthMessage("Other device sessions were signed out. This browser stays active.");
      if (sessionNote) sessionNote.textContent = "Other signed-in device sessions were revoked.";
    } finally {
      syncSessionSheet();
    }
  }

  forgotPasswordButton?.addEventListener("click", () => void sendPasswordReset());
  sessionsButton?.addEventListener("click", openSessionSheet);
  sessionCloseButton?.addEventListener("click", () => closeSessionSheet());
  signOutOtherSessionsButton?.addEventListener("click", () => void signOutOtherSessions());

  accountOverlay.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-studio-overlay-close='account']")) {
      closeSessionSheet({ restoreFocus: false });
    }
  });

  new MutationObserver(() => {
    if (!accountOverlay.classList.contains("is-open")) {
      closeSessionSheet({ restoreFocus: false });
    }
    syncSessionSheet();
  }).observe(accountOverlay, {
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  syncSessionSheet();
  window.SignalShareAuthStudio = {
    openSessions: openSessionSheet,
    closeSessions: closeSessionSheet,
  };
})();

