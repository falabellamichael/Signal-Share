const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
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
};
