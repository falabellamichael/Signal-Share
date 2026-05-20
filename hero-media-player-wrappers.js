// Wrapper Functions for Hero Media Player Actions
// These bridge simplified names to imported action handlers from hero-media-player-actions.js

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
  const { context, forcePlay = undefined, render } = options;
  
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
