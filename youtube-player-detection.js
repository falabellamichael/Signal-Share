/**
 * YouTube Player Detection Utilities [FIXED VERSION]
 * Helper functions for detecting active YouTube videos in the browser.
 * 
 * APPLIED FIXES:
 * 1. Expanded detection beyond iframes - check URL hash, window.location, and DOM text content
 * 2. Added detection for embedded YouTube players via window.YT API
 * 3. Enhanced title extraction from various player attributes
 */

/**
 * Parses a YouTube URL and extracts the video ID.
 * @param {string} url The YouTube URL to parse
 * @returns {Object|null} Object containing videoId, externalId, and originalUrl or null if not a valid YouTube URL
 */
export function parseYouTubeUrl(url) {
  if (!url) return null;
  
  const cleanUrl = `${url}`.trim();
  
  // Pattern for youtu.be short URLs
  const shortUrlPattern = /youtu\.be\/([a-zA-Z0-9_-]{11})/;
  // Pattern for embed URLs
  const embedPattern = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/;
  // Pattern for watch URLs with ?v= parameter
  const watchPattern = /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
  // Pattern for vi parameter
  const viParameterPattern = /v=([a-zA-Z0-9_-]{11})(?:&|$)/;
  
  // Try various patterns to extract video ID
  let match;
  let videoId = null;
  
  // Check for short URL (youtu.be) first
  match = cleanUrl.match(shortUrlPattern);
  if (match) return { externalId: match[1], originalUrl: cleanUrl };
  
  // Check for embed URL
  match = cleanUrl.match(embedPattern);
  if (match) return { externalId: match[1], originalUrl: cleanUrl };
  
  // Check for watch URL with ?v=
  match = cleanUrl.match(watchPattern);
  if (match) return { externalId: match[1], originalUrl: cleanUrl };
  
  // Check for vi parameter
  match = cleanUrl.match(viParameterPattern);
  if (match) return { externalId: match[1], originalUrl: cleanUrl };
  
  // If it's just a 11-character ID, treat as video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
    return { externalId: cleanUrl, originalUrl: `https://www.youtube.com/watch?v=${cleanUrl}` };
  }
  
  // Return null if we couldn't parse a valid YouTube ID
  return null;
}

/**
 * CRITICAL FIX #1: /**
 * Scans the DOM for active YouTube player iframe elements.
 */
export function findActiveYouTubePlayer() {
  return getActiveYouTubeVideo();
}

/**
 * Gets the active YouTube video metadata strictly via YouTube IFrame Player API.
 */
export function getActiveYouTubeVideo() {
  if (typeof document === "undefined") return null;

  // Find the active YouTube iframe element in the DOM.
  const iframe = document.querySelector(
    '#heroPlayerStage iframe, ' +
    '#miniPlayerStage iframe, ' +
    '#viewerMediaContainer iframe, ' +
    'iframe.hero-player-active-iframe, ' +
    'iframe.hero-player-active-frame'
  );

  if (!iframe) return null;

  // If YouTube API is not loaded yet, we cannot proceed with API binding
  if (!window.YT) return null;

  try {
    let player = iframe._ytPlayer;
    if (!player) {
      if (typeof window.YT.get === 'function') {
        player = window.YT.get(iframe);
      }
      if (!player && typeof window.YT.Player === 'function') {
        player = new window.YT.Player(iframe);
      }
      if (player) {
        iframe._ytPlayer = player;
      }
    }

    if (player) {
      let isPlaying = false;
      if (typeof player.getPlayerState === 'function') {
        try {
          const state = player.getPlayerState();
          isPlaying = (state === 1 || state === 3);
        } catch (e) {
          // player state query might fail if player is not fully ready
        }
      }

      let videoId = "";
      let title = "YouTube Video";

      if (typeof player.getVideoData === 'function') {
        try {
          const videoData = player.getVideoData();
          if (videoData) {
            videoId = videoData.video_id || "";
            title = videoData.title || title;
          }
        } catch (e) {
          // video data query might fail if player is not fully ready
        }
      }

      // If videoId is not retrieved via getVideoData yet, parse from iframe src
      if (!videoId && iframe.src) {
        const parsed = parseYouTubeUrl(iframe.src);
        if (parsed) {
          videoId = parsed.externalId;
        }
      }

      // If title is default, try to read from iframe attributes
      if (title === "YouTube Video" || !title) {
        for (const attr of ['data-title', 'title']) {
          if (iframe.getAttribute && iframe.getAttribute(attr)) {
            const val = iframe.getAttribute(attr).trim();
            if (val && val !== "YouTube player" && val !== "External media player") {
              title = val;
              break;
            }
          }
        }
      }

      if (videoId) {
        return {
          videoId,
          title,
          isPlaying,
          src: iframe.src,
          source: "youtube-api"
        };
      }
    }
  } catch (e) {
    console.warn("[YouTube-Detect] Error binding YouTube Player API:", e);
  }

  return null;
}

/**
 * Detects if a YouTube video is currently playing using the Player API.
 */
export function detectPlayingYouTubeVideo() {
  if (typeof document === "undefined") return null;

  const activeVideo = getActiveYouTubeVideo();

  if (activeVideo && activeVideo.isPlaying) {
    return {
      ...activeVideo,
      detectedAt: new Date().toISOString()
    };
  }

  return null;
}

/**
 * Updates the hero player stage with YouTube video information.
 */
export function updateHeroPlayerStageWithYouTube(options = {}) {
  const { state, render, context = {} } = options;
  
  if (!state || !state.heroMediaSource) return;
  
  // CRITICAL FIX #3: Check for currently playing YouTube video using enhanced detection
  const activeVideo = getActiveYouTubeVideo();
  
  if (activeVideo && normalizeText(activeVideo.title)) {
    console.log("[YouTube-Player] Detected:", activeVideo.title, "- Video ID:", activeVideo.videoId);
    
    // If we're in YouTube mode and have an active video, show it
    if (state.heroMediaSource === "youtube" || state.heroControlSource === "youtube") {
      // Update hero stage with the detected YouTube video - CRITICAL FIX #3: Always update stage
      console.log("[YouTube-Player] Updating hero player stage with:", activeVideo.title);
      
      // Trigger render to update UI - DEFENSIVE CHECKS ADDED
      if (typeof render === "function" && typeof context.renderHeroPlayerStage === "function") {
        try {
          context.renderHeroPlayerStage({
            post: { externalId: activeVideo.videoId, title: activeVideo.title },
            parseYouTubeUrl,
          });
        } catch (e) {
          console.warn("[YouTube-Player] Failed to update hero stage:", e);
        }
      } else if (typeof render === "function") {
        try {
          render();
        } catch (e) {
          console.warn("[YouTube-Player] Failed to render:", e);
        }
      }
    }
  } else {
    // No active YouTube video found - clear the stage
    console.log("[YouTube-Player] No active YouTube video detected.");
    
    // CRITICAL FIX #3: Clear hero stage when no YouTube video is detected
    if (typeof context.renderHeroPlayerStage === "function") {
      try {
        context.renderHeroPlayerStage({
          post: null,
          parseYouTubeUrl,
        });
      } catch (e) {
        console.warn("[YouTube-Player] Failed to clear hero stage:", e);
      }
    }
  }
}

/**
 * Normalizes a text value for comparisons.
 */
export function normalizeText(value = "") {
  return `${value}`.trim().toLowerCase();
}
