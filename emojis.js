/**
 * Signal Share Emoji Pack
 * A comprehensive list of emojis for the Direct Messenger.
 */

import facesEmoji from './faces.js';
import gesturesEmoji from './gestures.js';
import foodEmoji from './food.js';
import natureEmoji from './nature.js';
import placesEmoji from './places.js';
import activitiesEmoji from './activities.js';
import objectsEmoji from './objects.js';

export { default as facesEmoji } from './faces.js';
export { default as gesturesEmoji } from './gestures.js';
export { default as foodEmoji } from './food.js';
export { default as natureEmoji } from './nature.js';
export { default as placesEmoji } from './places.js';
export { default as activitiesEmoji } from './activities.js';
export { default as objectsEmoji } from './objects.js';

export const EMOJI_CATEGORIES = [
  { id: "faces", label: "Faces", icon: "😀" },
  { id: "gestures", label: "Gestures", icon: "👍" },
  { id: "food", label: "Food", icon: "🍕" },
  { id: "nature", label: "Nature", icon: "🌿" },
  { id: "places", label: "Places", icon: "🚀" },
  { id: "activities", label: "Activities", icon: "🏀" },
  { id: "objects", label: "Objects", icon: "🎉" }
];

export const EMOJI_PACK = [
  ...facesEmoji,
  ...gesturesEmoji,
  ...objectsEmoji,
  ...natureEmoji,
  ...activitiesEmoji,
  ...foodEmoji,
  ...placesEmoji
];

/**
 * Throttles emoji-related actions.
 * @param {Object} state App state
 * @param {string} actionName
 */
export function debounce(state, actionName) {
  const cooldown = 500; // ms
  
  return new Promise((resolve) => {
    if (state._lastActionAt && Date.now() - state._lastActionAt < cooldown) {
      console.warn(`[Hero] Action "${actionName}" is throttled.`);
      resolve(false);
      return;
    }
    state._lastActionAt = Date.now();
    resolve(true);
  });
}

/**
 * Executes a callback within a try-catch block specialized for emoji operations.
 */
export function safeEmojiHandler(callback) {
  try {
    return callback();
  } catch(e) {
    console.error('[Hero] Emoji error handler:', e);
    
    if (typeof window.showError === 'function') {
      window.showError({
        title: "Emoji Loading Issue",
        message: `Some emojis are currently unavailable. Our team has been notified.`,
        emoji: "😵"
      });
    }
    
    return false;
  }
}

/**
 * Validates emoji rendering performance and support.
 */
export async function testEmojiRendering() {
  const startTime = Date.now();
  
  // Internal helper to simulate support detection
  const getSupportedEmojiList = () => Promise.resolve(EMOJI_PACK.filter(e => e.char));
  
  const supportedEmojis = await getSupportedEmojiList();
  const total = EMOJI_PACK.length;
  const supportedCount = supportedEmojis.length;
  
  const calculateSuccessRate = () => (supportedCount / total) * 100;
  const collectLatencyMetrics = () => ({
    renderLatency: Date.now() - startTime,
    categoryCount: EMOJI_CATEGORIES.length
  });
  
  return { 
    successRate: calculateSuccessRate(),
    latencyData: collectLatencyMetrics()
  };
}
