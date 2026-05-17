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

(function installSupabaseNullFetchGuard() {
  if (window.__signalShareSupabaseNullFetchGuardInstalled) return;
  window.__signalShareSupabaseNullFetchGuardInstalled = true;

  async function safeFetch(...args) {
    const response = await window.fetch(...args);
    if (response) return response;
    return new Response(JSON.stringify({
      error: "Network request returned no response."
    }), {
      status: 503,
      statusText: "Network unavailable",
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  function patchSupabaseCreateClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") return false;
    if (window.supabase.__signalShareNullFetchGuardWrapped) return true;

    const originalCreateClient = window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient = function signalShareCreateClient(url, key, options = {}) {
      const nextOptions = {
        ...options,
        global: {
          ...(options && options.global ? options.global : {}),
          fetch: safeFetch
        }
      };
      return originalCreateClient(url, key, nextOptions);
    };
    window.supabase.__signalShareNullFetchGuardWrapped = true;
    return true;
  }

  if (patchSupabaseCreateClient()) return;

  const patchTimer = setInterval(() => {
    if (patchSupabaseCreateClient()) clearInterval(patchTimer);
  }, 25);

  setTimeout(() => clearInterval(patchTimer), 10000);
})();
