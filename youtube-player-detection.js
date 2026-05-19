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
 * CRITICAL FIX #1: Scan DOM for active YouTube videos via multiple methods
 */
export function findActiveYouTubePlayer(attributes = ['data-title', 'title']) {
  if (typeof document === "undefined") return null;
  
  // Method 1: Check window.YT API player object first
  let ytApiPlayer = null;
  try {
    if (window.YT && typeof window.YT.IframeIframeApiGetIframe === 'function') {
      const iframe = window.YT.IframeIframeApiGetIframe(0);
      if (iframe?.src) {
        ytApiPlayer = iframe;
      }
    }
  } catch (e) {
    console.warn("[YouTube-Detect] IFrame API error:", e);
  }
  
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
        if (typeof playerAttrTitle === 'string' && playerAttrTitle.trim()) {
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
  
  // CRITICAL FIX #1: Check for YouTube in window.location hash/params
  try {
    const hash = `${window.location.hash}`.trim();
    const idMatch = hash.match(/(?:v=|&v=)([a-zA-Z0-9_-]{11})/i);
    
    if (idMatch) {
      return {
        videoId: idMatch[1],
        title: "YouTube Video",
        source: "url-hash"
      };
    }
  } catch (e) {
    console.warn("[YouTube-Detect] URL hash detection failed:", e);
  }

  // CRITICAL FIX #1: Check for YouTube in URL search params
  try {
    const searchParams = new URLSearchParams(`${window.location.search}`.trim());
    const vParam = searchParams.get("v");
    
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return {
        videoId: vParam,
        title: "YouTube Video",
        source: "url-param"
      };
    }
  } catch (e) {
    console.warn("[YouTube-Detect] URL param detection failed:", e);
  }

  // CRITICAL FIX #1: Check for embedded YouTube player in DOM text content
  try {
    const fullUrl = `${window.location.href}`.trim();
    const match = fullUrl.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/)([a-zA-Z0-9_-]{11})/i);
    
    if (match) {
      return {
        videoId: match[1],
        title: "YouTube Video",
        source: "url-href"
      };
    }
  } catch (e) {
    console.warn("[YouTube-Detect] URL href detection failed:", e);
  }

  return null;
}

/**
 * CRITICAL FIX #2: Improved YouTube video detection with fallback methods
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
  
  // CRITICAL FIX #2: Try URL detection as fallback
  try {
    const hashMatch = `${window.location.hash}`.match(/(?:v=|&v=)([a-zA-Z0-9_-]{11})/i);
    if (hashMatch) {
      return {
        videoId: hashMatch[1],
        title: "YouTube Video",
        source: "url-hash-fallback"
      };
    }
  } catch (e) {}

  try {
    const searchParams = new URLSearchParams(`${window.location.search}`.trim());
    const vParam = searchParams.get("v");
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return {
        videoId: vParam,
        title: "YouTube Video",
        source: "url-param-fallback"
      };
    }
  } catch (e) {}

  // CRITICAL FIX #2: Try URL href detection as final fallback
  try {
    const fullUrl = `${window.location.href}`.trim();
    const match = fullUrl.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/)([a-zA-Z0-9_-]{11})/i);
    
    if (match) {
      return {
        videoId: match[1],
        title: "YouTube Video",
        source: "url-href-fallback"
      };
    }
  } catch (e) {}

  return null;
}

/**
 * CRITICAL FIX #3: Improved YouTube video detection with multiple fallback methods
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
