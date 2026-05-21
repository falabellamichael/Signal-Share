/**
 * Improved Media Player Wrappers with Enhanced Source Routing
 * Handles all source routing for YouTube, Spotify, and Feed mode properly
 */

import { hasActiveMediaInSource } from './_hero-media-player-action-isolations-new.js';

// ============================================================================
// WRAPPER FUNCTIONS - Simplified public API
// ============================================================================

export function handleNext(options = {}) {
  const { context, render } = options;
  
  if (typeof handleNextAction === 'function') {
    try {
      handleNextAction(context);
    } catch (error) {
      console.error('[Hero] handleNext failed:', error);
    }
  }
}

export function handlePrevious(options = {}) {
  const { context, render } = options;
  
  if (typeof handlePreviousAction === 'function') {
    try {
      handlePreviousAction(context);
    } catch (error) {
      console.error('[Hero] handlePrevious failed:', error);
    }
  }
}

export function handlePlayPause(options = {}) {
  const { context, forcePlay = undefined, render, nativeSnapshot, desktopSnapshot } = options;
  
  // CRITICAL FIX #5: Zero bleed-through validation for Media Toggle Mode
  if (context.state?.heroControlMode === 'media') {
    const heroControlSource = context.state.heroControlSource;
    const preferredSource = (heroControlSource || context.state?.heroMediaSource || context.state?.systemMediaSource || "").toLowerCase();
    
    // If in toggle mode with no valid YouTube/Spotify post, validate for active media
    if ((!context.post && !context.matchedPost) && preferredSource) {
      const hasYouTubeMedia = hasActiveMediaInSource('youtube', nativeSnapshot, desktopSnapshot);
      const hasSpotifyMedia = hasActiveMediaInSource('spotify', nativeSnapshot, desktopSnapshot);
      const isYouTubeMode = preferredSource === 'youtube';
      const isSpotifyActive = preferredSource === 'spotify';

      // If in toggle mode but no active media exists, console log for debugging (zero bleed-through)
      if ((!hasYouTubeMedia && isYouTubeMode) || (!hasSpotifyMedia && isSpotifyActive)) {
        console.log('[Hero Wrappers] handlePlayPause: Zero bleed-through - toggle source has no active media');
      }
    }
  }

  if (typeof handlePlayPauseAction === 'function') {
    try {
      handlePlayPauseAction(context, forcePlay);
    } catch (error) {
      console.error('[Hero] handlePlayPause failed:', error);
    }
  }
}

export function handleOpenMedia(options = {}) {
  const { context, render, parseYouTubeUrl, openViewer, desktopSnapshot, nativeSnapshot, performDesktopAction } = options;
  
  if (typeof handleOpenMediaAction === 'function') {
    try {
      handleOpenMediaAction({
        ...context,
        renderHeroPlayerStage: typeof render === 'function' ? render : (() => {}),
        parseYouTubeUrl,
        openViewer,
        desktopSnapshot,
        nativeSnapshot,
        performDesktopAction
      });
    } catch (error) {
      console.error('[Hero] handleOpenMedia failed:', error);
    }
  }
}

export function handleOpenPhone(options = {}) {
  const { context, render, parseYouTubeUrl, performDesktopAction, state } = options;
  
  if (typeof handleOpenPhoneAction === 'function') {
    try {
      handleOpenPhoneAction({
        ...context,
        renderHeroPlayerStage: typeof render === 'function' ? render : (() => {}),
        parseYouTubeUrl,
        performDesktopAction
      });
    } catch (error) {
      console.error('[Hero] handleOpenPhone failed:', error);
    }
  }
}

export function handleVolume(options = {}) {
  const { context, event } = options;
  
  if (typeof handleVolumeAction === 'function') {
    try {
      handleVolumeAction(context, event);
    } catch (error) {
      console.error('[Hero] handleVolume failed:', error);
    }
  }
}

export function handleRefresh(options = {}) {
  const { context, render, destroyActivePlayer, nativeSnapshotBridge, canUseDesktopBridge, getNativeBridge, refreshDesktopSnapshot, refreshNativeSnapshot } = options;
  
  if (typeof handleRefreshAction === 'function') {
    try {
      handleRefreshAction({
        ...context,
        render,
        destroyActivePlayer,
        hasNativeSnapshotBridge: nativeSnapshotBridge ? () => true : (() => false),
        canUseDesktopBridge,
        getNativeBridge,
        refreshDesktopSnapshot,
        refreshNativeSnapshot
      });
    } catch (error) {
      console.error('[Hero] handleRefresh failed:', error);
    }
  }
}

// ============================================================================
// SOURCE ROUTING HELPERS - Enhanced URL Resolution
// ============================================================================

/**
 * Resolves YouTube URL from various sources with enhanced fallback logic
 */
export function resolveYouTubeUrlEnhanced(value, parseYouTubeUrl) {
  if (!value) return "";
  const sanitized = String(value).trim();
  
  // Check for full watch URL first (highest priority)
  if (sanitized.includes('youtube.com/watch') || sanitized.includes('youtu.be/')) {
    return sanitized;
  }
  
  // Try to extract ID from various patterns (shorts, embed, vi, etc)
  const idMatch = sanitized.match(/(?:v=|embed\/|youtu\.be\/|shorts\/|live\/|vi\/|vnd\.youtube:)([A-Za-z0-9_-]{11})/i);
  if (idMatch) return `https://www.youtube.com/watch?v=${idMatch[1]}`;
  
  // Check for raw 11-character ID
  if (/^[A-Za-z0-9_-]{11}$/.test(sanitized)) {
    return `https://www.youtube.com/watch?v=${sanitized}`;
  }
  
  // Try parseYouTubeUrl function as last resort
  if (typeof parseYouTubeUrl === 'function') {
    const parsed = parseYouTubeUrl(value);
    if (parsed && parsed.externalId) {
      return `https://www.youtube.com/watch?v=${parsed.externalId}`;
    }
  }
  
  return "";
}

/**
 * Resolves Spotify URI from various sources with enhanced fallback logic
 */
export function resolveSpotifyUriEnhanced(value, getSpotifyPreviewImageUrl) {
  if (!value) return "spotify:";
  const trimmed = String(value).trim();
  
  // Check for explicit Spotify URI
  if (trimmed.startsWith('spotify:')) {
    return trimmed;
  }
  
  // Check for open.spotify.com URLs
  if (trimmed.includes('open.spotify.com')) {
    return trimmed;
  }
  
  // Return default Spotify URI as fallback
  return "spotify:";
}

/**
 * Gets active media from snapshot with enhanced detection
 */
export function getActiveMediaFromSnapshot(snapshot, source) {
  if (!snapshot) return null;
  
  const provider = (snapshot.sourceProvider || "").toLowerCase();
  const appPkg = (snapshot.appPackage || "").toLowerCase();
  const title = (snapshot.title || "").toLowerCase();
  const meta = (snapshot.meta || "").toLowerCase();
  
  // Helper to check if snapshot matches source type
  const matchesSource = (preferredSource) => {
    if (!preferredSource) return true;
    
    if (preferredSource === 'spotify') {
      return provider.includes('spotify') || 
             appPkg.includes('spotify') || 
             title.includes('spotify') || 
             meta.includes('spotify');
    } else if (preferredSource === 'youtube') {
      return provider.includes('youtube') || 
             appPkg.includes('youtube') || 
             appPkg.includes('ytmusic') || 
             title.includes('youtube') || 
             meta.includes('youtube');
    }
    
    return true;
  };
  
  if (source === 'any' && (snapshot.active || snapshot.title)) {
    return { ...snapshot, detected: true };
  }
  
  if (matchesSource(source) && snapshot.active) {
    return { ...snapshot, detected: true };
  }
  
  return null;
}

/**
 * Enhanced media action resolution for better error handling
 */
export function resolveMediaActionContext(options = {}) {
  const {
    post,
    state,
    nativeSnapshot,
    desktopSnapshot,
    preferredSource
  } = options;
  
  const heroControlSource = state.heroControlSource;
  const systemMediaSource = state.systemMediaSource;
  
  // Determine effective source with fallback hierarchy
  let effectiveSource = "";
  if (preferredSource) {
    effectiveSource = preferredSource.toLowerCase();
  } else if (heroControlSource) {
    effectiveSource = heroControlSource.toLowerCase();
  } else if (systemMediaSource) {
    effectiveSource = systemMediaSource.toLowerCase();
  }
  
  // Check snapshot availability
  const hasNativeSnapshot = !!nativeSnapshot;
  const hasDesktopSnapshot = !!desktopSnapshot;
  
  // Determine mode from state
  const heroControlMode = state.heroControlMode || "";
  const heroMode = state.heroMode || "";
  
  return {
    effectiveSource,
    effectiveSourceName: effectiveSource.toUpperCase() || 'NONE',
    hasPost: !!post,
    hasNativeSnapshot,
    hasDesktopSnapshot,
    heroControlMode,
    heroMode,
    postType: post?.sourceKind || '',
    snapshotProvider: nativeSnapshot?.sourceProvider || desktopSnapshot?.sourceProvider || ''
  };
}

// ============================================================================
// DEFAULT EXPORTS
// ============================================================================

export default {
  // Wrapper functions
  handleNext,
  handlePrevious, 
  handlePlayPause,
  handleOpenMedia,
  handleOpenPhone,
  handleVolume,
  handleRefresh,
  
  // Source routing helpers
  resolveYouTubeUrlEnhanced,
  resolveSpotifyUriEnhanced,
  getActiveMediaFromSnapshot,
  resolveMediaActionContext
};
