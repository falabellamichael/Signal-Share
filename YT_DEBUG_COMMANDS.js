// ========================================
// YOUTUBE PLAYER DEBUG COMMANDS (Copy-Paste Ready)
// ========================================
// These commands work in DevTools console regardless of build system
// Simply copy-paste directly into browser DevTools Console tab

console.log("====== YOUTUBE DETECTION DIAGNOSTIC ======");
console.log("");

// TEST 1: Check if YouTube API is loaded
console.log("[TEST] Checking YouTube API...");
const hasYTAPI = typeof window.YT !== 'undefined';
console.log("  YouTube API loaded:", hasYTAPI ? "✅ YES" : "❌ NO");

// TEST 2: Scan for embedded YouTube players
console.log("");
console.log("[TEST] Scanning page for YouTube iframes...");
try {
  const youtubeIframes = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
  console.log("  Found", youtubeIframes.length, "YouTube iframe(s)");
  
  for (let i = 0; i < youtubeIframes.length; i++) {
    const src = youtubeIframes[i].src.substring(0, 60) + "...";
    console.log(`    IFrame #${i+1}: ${src}`);
  }
} catch(e) {
  console.log("  Error scanning iframes:", e.message);
}

// TEST 3: Check URL for embedded video ID
console.log("");
console.log("[TEST] Checking current page URL for YouTube video ID...");
const locationHash = window.location.hash || '';
const searchParams = new URLSearchParams(window.location.search);
const vParam = searchParams.get('v');
console.log("  URL hash:", locationHash ? locationHash.substring(0, 40) : "(none)");
console.log("  Query param ?v=:", vParam || "(none)");

// Extract video ID from hash or params if found
if (/v=([a-zA-Z0-9_-]{11})/.test(locationHash)) {
  const id = locationHash.match(/v=([a-zA-Z0-9_-]{11})/)[1];
  console.log("  ✅ Found YouTube video ID in URL:", id);
} else if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
  console.log("  ✅ Found YouTube video ID in query param:", vParam);
} else {
  console.log("  ⚠️ No YouTube video ID detected in URL");
}

// TEST 4: Check if hero player is in toggle/media mode
console.log("");
console.log("[TEST] Checking hero player state...");
const heroConfig = window.SIGNAL_SHARE_HERO_PLAYER_CONFIG || {};
console.log("  Hero media source:", heroConfig.heroMediaSource || "(not set)");
console.log("  Hero control source:", heroConfig.heroControlSource || "(not set)");

// TEST 5: Clear cache and reset (if needed)
console.log("");
console.log("[ACTION] Clearing browser cache...");
const cacheKeys = ['ytInitialData', 'ytInitialDesktopWatchTabHeaderRenderer', 
                   'hero-player-preview-cache', 'youtube-detection-cache'];
cacheKeys.forEach(key => {
  if (localStorage[key]) {
    localStorage.removeItem(key);
    console.log("  Cleared:", key);
  }
});

if (window.signalShareCacheKey) {
  window.signalShareCacheKey = null;
  console.log("  Cleared signalShareCacheKey");
}

// Clear service workers if available
try {
  for(let reg of await navigator.serviceWorker.getRegistrations()) {
    await reg.unregister();
    console.log("  Unregistered service worker:", reg.scope.substring(0, 40) + "...");
  }
} catch(e) {
  console.log("  Service worker cleanup skipped or not available");
}

console.log("");
console.log("====== SUMMARY ======");
console.log("");
console.log("The IDLE status shown is NORMAL when no YouTube video is playing.");
console.log("");
console.log("TO TEST THE FIX:");
console.log("1. Open a new tab in the same browser");
console.log("2. Navigate to any YouTube page and let a video play");
console.log("3. Return to your media player - it should detect the video within 5-10 seconds");
console.log("");
console.log("Expected behavior: When a YouTube video plays anywhere, the hero player will");
console.log("auto-detect it within the polling interval and show the correct preview.");
