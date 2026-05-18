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

// HERO MEDIA PLAYER - Enable Media-Youtube/Spotify Toggle Mode
window.SIGNAL_SHARE_HERO_PLAYER_CONFIG = {
  heroControlMode: "media", // Required for toggle mode preview
  heroMediaSource: null, // Dynamically set based on YouTube or Spotify active
  heroControlSource: null,
  desktopSnapshotEndpoint: "",
  bridgeSecret: null,
};
