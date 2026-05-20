// Wrapper Functions for Hero Media Player Actions
// These bridge simplified names to imported action handlers from hero-media-player-actions.js
import { hasActiveMediaInSource } from './src/heroes/fixed/_hero-media-player-toggle-state-validation';

export function handleNext(options = {}) {
  const { context, render } = options;
  
  if (typeof handleNextAction === 'function') {
    try {
      handleNextAction(context);
    } catch (error) {
      console.error('[Hero] handleNext failed:', error);
    }
  } else {
    console.warn('[Hero] handleNextAction not available');
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
  } else {
    console.warn('[Hero] handlePreviousAction not available');
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
  } else {
    console.warn('[Hero] handlePlayPauseAction not available');
  }
}
