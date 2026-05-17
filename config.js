const isCapacitor = !!window.Capacitor;
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || isCapacitor;
const redirectUrl = "https://falabellamichael.github.io/Signal-Share/";

window.SIGNAL_SHARE_CONFIG = {
  supabaseUrl: "https://gswptxeikjmihdjxoiar.supabase.co",
  supabaseAnonKey: "sb_publishable_gIwGxzf1C4cD55l9XS16wg_Qn-LuYqT",
  authRedirectUrl: redirectUrl,
  postsTable: "posts",
  storageBucket: "media",
  webPushPublicKey: "",
  notificationFunctionName: "send-message-notification",
  spotifyPreviewFunctionName: "spotify-preview-metadata",
  adminEmails: ["falabellamichael@gmail.com", "falabellasocials@gmail.com"],
  masterAdminEmails: ["falabellamichael@gmail.com"],
};

(function installSoftSupabaseStartupStatusFix() {
  if (window.__signalShareSoftSupabaseStartupStatusFixInstalled) return;
  window.__signalShareSoftSupabaseStartupStatusFixInstalled = true;

  const softSupabaseErrorPattern = /supabase posts request failed|supabase client is not initialized|supabase unavailable|failed to fetch/i;

  function patchSoftSupabaseStatus() {
    const pill = document.getElementById("authStatusPill");
    const copy = document.getElementById("authStatusCopy");
    const hint = document.getElementById("authHint");
    if (!pill || !copy || !hint) return;

    const statusText = `${pill.textContent || ""}`;
    const combinedText = `${statusText} ${copy.textContent || ""} ${hint.textContent || ""}`;
    if (!/setup failed/i.test(statusText) || !softSupabaseErrorPattern.test(combinedText)) return;

    pill.textContent = "Local mode";
    copy.textContent = "Live Supabase feed is offline; local/demo mode is active.";
    hint.textContent = "The app is still usable locally. Live login and posting resume when Supabase responds.";
  }

  const observer = new MutationObserver(patchSoftSupabaseStatus);
  const startObserver = () => {
    patchSoftSupabaseStatus();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();
