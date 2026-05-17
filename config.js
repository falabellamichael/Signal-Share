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

(function installSupabaseStartupGuards() {
  if (window.__signalShareSupabaseStartupGuardsInstalled) return;
  window.__signalShareSupabaseStartupGuardsInstalled = true;

  const postsTableName = window.SIGNAL_SHARE_CONFIG.postsTable || "posts";
  const softSupabaseErrorPattern = /supabase posts request failed|supabase client is not initialized|supabase unavailable|failed to fetch/i;

  function wrapPostsQueryBuilder(builder) {
    if (!builder || typeof builder !== "object" || builder.__signalSharePostsQueryWrapped) return builder;

    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === "__signalSharePostsQueryWrapped") return true;

        if (prop === "then") {
          const then = Reflect.get(target, prop, receiver);
          if (typeof then !== "function") return then;
          return function signalShareSafePostsThen(resolve, reject) {
            return then.call(
              target,
              (result) => {
                if (result && result.error) {
                  console.warn("[Signal Share] Posts query failed; keeping Supabase auth live and using an empty feed.", result.error);
                  return resolve({ data: [], error: null, count: 0, status: 200, statusText: "OK" });
                }
                return resolve(result);
              },
              (error) => {
                console.warn("[Signal Share] Posts query threw; keeping Supabase auth live and using an empty feed.", error);
                return resolve({ data: [], error: null, count: 0, status: 200, statusText: "OK" });
              }
            );
          };
        }

        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;

        return function signalShareWrappedPostsQueryMethod(...args) {
          const next = value.apply(target, args);
          return wrapPostsQueryBuilder(next);
        };
      }
    });
  }

  function wrapSupabaseClient(client) {
    if (!client || typeof client.from !== "function" || client.__signalShareClientWrapped) return client;

    const originalFrom = client.from.bind(client);
    const wrappedClient = new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === "__signalShareClientWrapped") return true;
        if (prop === "from") {
          return function signalShareSafeFrom(tableName, ...args) {
            const builder = originalFrom(tableName, ...args);
            return tableName === postsTableName ? wrapPostsQueryBuilder(builder) : builder;
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    window.__signalShareLiveSupabaseClient = wrappedClient;
    return wrappedClient;
  }

  function patchCreateClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") return false;
    if (window.supabase.__signalShareCreateClientWrapped) return true;

    const originalCreateClient = window.supabase.createClient.bind(window.supabase);
    window.supabase.createClient = function signalShareCreateClient(...args) {
      return wrapSupabaseClient(originalCreateClient(...args));
    };
    window.supabase.__signalShareCreateClientWrapped = true;
    return true;
  }

  function restoreLiveSupabaseState() {
    const state = window.state || window.__SIGNAL_SHARE_STATE__;
    const liveClient = window.__signalShareLiveSupabaseClient;
    if (!state || !liveClient) return;

    const backendError = `${state.backendError || ""}`;
    if (state.backendMode !== "local" || !softSupabaseErrorPattern.test(backendError)) return;

    state.supabase = liveClient;
    window.__supabaseClient = liveClient;
    state.backendMode = "supabase";
    state.backendError = "";
    state.authRestoring = false;

    if (typeof window.render === "function") {
      try { window.render(); } catch (_error) { }
    }
  }

  function patchSoftSupabaseStatus() {
    restoreLiveSupabaseState();

    const pill = document.getElementById("authStatusPill");
    const copy = document.getElementById("authStatusCopy");
    const hint = document.getElementById("authHint");
    if (!pill || !copy || !hint) return;

    const statusText = `${pill.textContent || ""}`;
    const combinedText = `${statusText} ${copy.textContent || ""} ${hint.textContent || ""}`;
    if (!/setup failed|local mode/i.test(statusText) || !softSupabaseErrorPattern.test(combinedText)) return;

    pill.textContent = "Live account ready";
    copy.textContent = "Supabase auth is online. Feed posts are empty until the posts table responds.";
    hint.textContent = "Sign in should remain available even if the feed query fails.";
  }

  const createClientInterval = setInterval(() => {
    if (patchCreateClient()) clearInterval(createClientInterval);
  }, 25);

  patchCreateClient();

  const observer = new MutationObserver(patchSoftSupabaseStatus);
  const startObserver = () => {
    patchSoftSupabaseStatus();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    setInterval(restoreLiveSupabaseState, 500);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();
