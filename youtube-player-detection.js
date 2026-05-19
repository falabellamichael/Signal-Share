/**
 * YouTube Player Detection Utilities
 * Helper functions for detecting active YouTube videos in the browser.
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
 * Scans the DOM for active YouTube IFrame elements and returns their metadata.
 * @param {string[]} attributes Attributes to check for video title
 * @returns {Object|null} YouTube video metadata or null if none found
 */
export function findActiveYouTubePlayer(attributes = ['data-title', 'title']) {
  if (typeof document === "undefined") return null;
  
  // Check for YouTube IFrame API player object first
  let ytApiPlayer = null;
  try {
    const iframe = window.YT?.IframeIframeApiGetIframe(0);
    if (iframe?.src) {
      ytApiPlayer = iframe;
    }
  } catch {}
  
  // If IFrame API is available and has a valid video ID, return it
  if (ytApiPlayer && typeof parseYouTubeUrl === 'function') {
    const parsed = parseYouTubeUrl(ytApiPlayer.src);
    if (parsed && parsed.externalId) {
      let title = "";
      for (const attr of attributes) {
        try {
          if (ytApiPlayer.getAttribute && ytApiPlayer.getAttribute(attr)) {
            title = `${ytApiPlayer.getAttribute(attr)}`.trim();
            break;
          }
        } catch {}
      }
      
      return {
        videoId: parsed.externalId,
        title: title || "YouTube Video",
        src: ytApiPlayer.src,
        source: "iframe-api"
      };
    }
  }
  
  // Method 2: Scan all iframes for YouTube content
  const youtubeIframes = Array.from(document.querySelectorAll(
    'iframe[src*="youtube.com"], ' +
    'iframe[src*="youtu.be"], ' +
    'iframe[data-src*="youtube"]'
  ));
  
  for (const iframe of youtubeIframes) {
    try {
      const src = `${iframe.src}`.trim();
      const parsed = parseYouTubeUrl(src);
      
      if (!parsed || !parsed.externalId) continue;
      
      // Extract title from various attributes
      let title = "";
      for (const attr of attributes) {
        try {
          if (iframe.getAttribute && iframe.getAttribute(attr)) {
            title = `${iframe.getAttribute(attr)}`.trim();
            break;
          }
        } catch {}
      }
      
      // Check window.title for YouTube player info
      const playerTitleElement = document.querySelector?.('[role="player"], [data-youtube-player]');
      if (playerTitleElement && playerTitleElement.getAttribute) {
        const playerAttrTitle = playerTitleElement.getAttribute('title') || "";
        if (playerAttrTitle.trim()) {
          title = playerAttrTitle.trim();
        }
      }
      
      if (title || title === "") {
        return {
          videoId: parsed.externalId,
          title: title || "YouTube Video",
          src: iframe.src,
          source: "iframe-scanner"
        };
      }
    } catch (e) {
      console.warn("[YouTube-Detect] Error scanning iframe:", e);
    }
  }
  
  return null;
}

/**
 * Gets the currently active YouTube IFrame or video element in the page.
 * This is used to detect what YouTube video is currently playing.
 * @returns {Object|null} Object with videoId, title, src, and source type or null if none found
 */
export function getActiveYouTubeVideo() {
  if (typeof document === "undefined") return null;
  
  // First try IFrame API method
  if (window.YT && window.YT.Player) {
    try {
      const iframe = window.YT.IframeIframeApiGetIframe(0);
      if (iframe?.src && typeof parseYouTubeUrl === 'function') {
        const parsed = parseYouTubeUrl(iframe.src);
        if (parsed && parsed.externalId) {
          // Extract title from various attributes
          let title = "";
          for (const attr of ['data-title', 'title']) {
            try {
              if (iframe.getAttribute && iframe.getAttribute(attr)) {
                title = `${iframe.getAttribute(attr)}`.trim();
                break;
              }
            } catch {}
          }
          
          return {
            videoId: parsed.externalId,
            title: title || "YouTube Video",
            src: iframe.src,
            source: "iframe-api"
          };
        }
      }
    } catch (e) {
      console.warn("[YouTube-Detect] IFrame API error:", e);
    }
  }
  
  // Fallback: Scan all iframes for YouTube content
  const youtubeIframes = Array.from(document.querySelectorAll(
    'iframe[src*="youtube.com"], ' +
    'iframe[src*="youtu.be"], ' +
    'iframe[data-src*="youtube"]'
  ));
  
  for (const iframe of youtubeIframes) {
    try {
      const src = `${iframe.src}`.trim();
      const parsed = parseYouTubeUrl(src);
      
      if (!parsed || !parsed.externalId) continue;
      
      // Extract title from various attributes
      let title = "";
      for (const attr of ['data-title', 'title']) {
        try {
          if (iframe.getAttribute && iframe.getAttribute(attr)) {
            title = `${iframe.getAttribute(attr)}`.trim();
            break;
          }
        } catch {}
      }
      
      // Check for player element with title attribute
      const playerTitleElement = document.querySelector?.('[role="player"], [data-youtube-player]');
      if (playerTitleElement && typeof playerTitleElement.getAttribute === 'function') {
        try {
          const playerAttrTitle = playerTitleElement.getAttribute('title') || "";
          if (typeof playerAttrTitle === 'string' && playerAttrTitle.trim()) {
            title = playerAttrTitle.trim();
          }
        } catch {}
      }
      
      if (title) {
        return {
          videoId: parsed.externalId,
          title: title || "YouTube Video",
          src: iframe.src,
          source: "iframe-scanner"
        };
      }
    } catch (e) {
      console.warn("[YouTube-Detect] Error scanning iframe:", e);
    }
  }
  
  return null;
}

/**
 * Detects if a YouTube video is currently playing in the browser.
 * @returns {Object|null} Video info or null if not playing
 */
export function detectPlayingYouTubeVideo() {
  if (typeof document === "undefined") return null;
  
  const activeVideo = getActiveYouTubeVideo();
  
  if (activeVideo) {
    // YouTube videos are considered "playing" if they have an active video ID
    return {
      ...activeVideo,
      isPlaying: true,
      detectedAt: new Date().toISOString()
    };
  }
  
  return null;
}

/**
 * Updates the hero player stage with YouTube video information.
 * @param {Object} options Options for updating the stage
 */
export function updateHeroPlayerStageWithYouTube(options = {}) {
  const { state, render } = options;
  
  if (!state || !state.heroMediaSource) return;
  
  // Check if currently playing YouTube video exists
  const activeVideo = getActiveYouTubeVideo();
  
  if (activeVideo && normalizeText(activeVideo.title)) {
    console.log("[YouTube-Player] Detected:", activeVideo.title, "- Video ID:", activeVideo.videoId);
    
    // If we're in YouTube mode and have an active video, show it
    if (state.heroMediaSource === "youtube" || state.heroControlSource === "youtube") {
      // Update hero stage with the detected YouTube video
      console.log("[YouTube-Player] Updating hero player stage with:", activeVideo.title);
      
      // Trigger render to update UI
      if (render) {
        render();
      }
    }
  } else {
    // No active YouTube video found - clear the stage
    console.log("[YouTube-Player] No active YouTube video detected.");
  }
}

/**
 * Normalizes a text value for comparisons.
 */
export function normalizeText(value = "") {
  return `${value}`.trim().toLowerCase();
}
