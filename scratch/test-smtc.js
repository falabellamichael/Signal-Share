import { SMTCMonitor } from "@coooookies/windows-smtc-monitor";

console.log("Starting SMTC monitor test...");
try {
  const sessions = SMTCMonitor.getMediaSessions();
  console.log("Sessions found:", sessions.length);
  for (const session of sessions) {
    console.log("App:", session.sourceAppId);
    console.log("Title:", session.media?.title);
    if (session.media?.thumbnail) {
        console.log("Thumbnail size:", session.media.thumbnail.length);
    }
  }
  console.log("Test finished successfully.");
} catch (error) {
  console.error("SMTC monitor test failed:", error);
}
