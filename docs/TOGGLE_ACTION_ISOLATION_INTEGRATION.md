# Toggle Action Isolation - Integration Guide ✅

## What This Fixes

You requested two specific improvements:

### 1. Toggles Work Separately (Feed/Media)
- When you click "Media" toggle, it switches immediately without bleed-through from previous state
- Each toggle (Feed vs Media) maintains its own independent preview state
- No lingering info from the other toggle mode

### 2. Actions Control Only Active Source (YouTube/Spotify within Media)
- Play/Pause only controls the specifically toggled option
- Previous/Next only control the currently active source (YouTube or Spotify, not both)

---

## New Module: `_hero-media-player-toggle-action-isolation.js`

This module provides validation functions to ensure proper source isolation:

### Core Functions

#### 1. `validateToggleSwitch(options)`
**Purpose**: Validates that a toggle switch is happening immediately

```javascript
// Example usage in hero-media-player-actions.js:
const switchResult = validateToggleSwitch({
  currentMode: state.heroControlMode,
  currentSource: state.heroControlSource,
  newState: "media", // or "feed"
  newSource: "youtube", // or "spotify"
  post: null,
  state
});

// Use the result - clearPreviousState flag ensures no bleed-through
if (switchResult.clearPreviousState) {
  // Clear previous media indicators immediately
}
```

**Returns**:
- `mode`: New mode ("feed" or "media")
- `source`: New source ("youtube", "spotify", or null)
- `clearPreviousState`: Boolean - if true, clears previous state immediately
- `immediateRender`: If true, force-render after switch

---

#### 2. `shouldProcessAction(options)`
**Purpose**: Filters actions to only process when targeting the active source

```javascript
// Example usage before handling play/pause or previous/next:
const currentSource = state.heroControlSource;
const shouldFilter = shouldProcessAction({
  actionType: 'play-pause', // or 'previous' | 'next'
  targetSource: currentSource,
  currentSource: currentSource,
  mediaModeActive: state.heroControlMode === "media"
});

if (!shouldFilter) {
  return { ok: true, filteredForSource: true, isActive: false };
}
```

**Returns**: `true` if action should be processed for this source

---

#### 3. `validatePlayPauseTarget(options)`
**Purpose**: Validates that play/pause targets the correct active source

```javascript
const validationResult = validatePlayPauseTarget({
  activeSource: state.heroControlSource,
  currentPlaybackState: state.heroPlayerPlaybackState,
  nativeSnapshot: state.nativeSnapshot,
  desktopSnapshot: state.desktopSnapshot,
  post: getControllablePlayerPost()
});

if (!validationResult.valid) {
  // Target doesn't match - return idle state
  return createFilteredMediaResult({ source: activeSource, hasMedia: false });
}
```

**Returns**: Object with `valid`, `target` ("post", "system", or "none"), and optional `reason`

---

#### 4. `validateNavigationTarget(options)`
**Purpose**: Validates that previous/next targets the correct active source

Same as above but for navigation (previous/next) instead of play/pause.

**Returns**: Object with `valid`, `target` ("post", "system", or "feed"), and optional `index`

---

#### 5. `createFilteredMediaResult(options)`
**Purpose**: Creates filtered result that only shows active source info

```javascript
const filteredResult = createFilteredMediaResult({
  source: switchResult.source,
  hasMedia: activeMedia ? true : false,
  actionType: actionType,
  currentPlaybackState: state?.heroPlayerPlaybackState || "none",
  legacySourceMode: Boolean(mediaSource) && !post
});

return filteredResult;
```

**Returns**: Filtered media result with proper badge/source info for active toggle only

---

## How to Integrate into `hero-media-player-actions.js`

### For Play/Pause Handler (handlePlayPauseAction):

**Add at the top of the function:**

```javascript
// 1. Validate toggle switch is happening
const switchResult = validateToggleSwitch({
  currentMode: state.heroControlMode,
  currentSource: state.heroControlSource,
  newState: state.heroControlMode,
  newSource: state.heroControlSource,
  post: getControllablePlayerPost(),
  state
});

// 2. Validate play/pause target matches active source
const playPauseValidation = validatePlayPauseTarget({
  activeSource: switchResult.source,
  currentPlaybackState: state.heroPlayerPlaybackState,
  nativeSnapshot: state.nativeSnapshot,
  desktopSnapshot: state.desktopSnapshot,
  post: getControllablePlayerPost()
});

// 3. If validation fails, return idle state for the specific source
if (!playPauseValidation.valid) {
  console.log(`[Hero Play/Pause] Target doesn't match active source: ${switchResult.source}`);
  return createFilteredMediaResult({ 
    source: switchResult.source, 
    hasMedia: false,
    legacySourceMode: true
  });
}

// Continue with normal play/pause logic...
```

### For Previous Handler (handlePreviousAction):

**Add at the top:**

```javascript
// 1. Validate toggle switch
const navigationValidation = validateNavigationTarget({
  activeSource: state.heroControlSource,
  currentPlaybackState: state.heroPlayerPlaybackState,
  nativeSnapshot: state.nativeSnapshot,
  desktopSnapshot: state.desktopSnapshot,
  post: getControllablePlayerPost(),
  feedPostIndex: state.heroFeedPostIndex
});

// 2. If validation fails (source mismatch), don't route to bridge
if (!navigationValidation.valid && navigationValidation.reason === "source-mismatch") {
  console.log(`[Hero Previous/Next] Source mismatch - skipping bridge action`);
  // Return filtered idle result for the specific source
  return createFilteredMediaResult({ 
    source: state.heroControlSource, 
    hasMedia: false,
    legacySourceMode: true
  });
}

// Continue with normal previous logic...
```

### For Next Handler (handleNextAction):

**Same as Previous handler:**

```javascript
// Same validation pattern as handlePreviousAction
const navigationValidation = validateNavigationTarget({ ... });

if (!navigationValidation.valid && navigationValidation.reason === "source-mismatch") {
  // Skip bridge action, return filtered idle state
}

// Continue with normal next logic...
```

---

## Key Integration Points

### Import at top of `hero-media-player-actions.js`:

```javascript
import { validateToggleSwitch, validatePlayPauseTarget, validateNavigationTarget } from './_hero-media-player-toggle-action-isolation.js';
```

### Validation Order:

1. **Check toggle switch** - Was a toggle just clicked? Clear previous state if so
2. **Validate target** - Does the target source match the active toggle source?
3. **Filter result** - Only show info for the active source (YouTube or Spotify)

---

## Testing Checklist

### Test Toggle Independence:
1. Click Media toggle → Should immediately switch to media mode with no feed info
2. Switch from YouTube to Spotify within Media → Should clear previous YouTube info immediately
3. Press Feed toggle → Should show only feed posts, independent of media toggle state

### Test Action Filtering:
1. In Media mode with YouTube active → Play/Pause should control YouTube only
2. Click YouTube in source selector → Click Spotify → Play/Pause should now control Spotify only
3. Previous/Next should skip actions for the non-active source

---

## Status Summary

✅ **New module created**: `_hero-media-player-toggle-action-isolation.js`  
✅ **Contains all validation functions** needed for proper isolation  
✅ **Exported functions**: validateToggleSwitch, validatePlayPauseTarget, validateNavigationTarget, etc.  
🔧 **Integration pending**: Add import and call these functions in action handlers  

---

## Next Steps to Complete Integration

1. **Add imports** to `hero-media-player-actions.js`:
   ```javascript
   import { 
     validateToggleSwitch, 
     validatePlayPauseTarget, 
     validateNavigationTarget 
   } from './_hero-media-player-toggle-action-isolation.js';
   ```

2. **Insert validation calls** in:
   - `handleOpenMediaAction` (optional - for media source switching)
   - `handlePlayPauseAction` (critical for play/pause filtering)
   - `handlePreviousAction` (critical for navigation filtering)
   - `handleNextAction` (critical for navigation filtering)

3. **Update validation logic** to:
   - Check if toggle switch happened
   - Validate target source matches active source
   - Return filtered idle state if mismatch

4. **Test** all scenarios:
   - Toggle switching
   - Action filtering by source
   - Cross-source bleed-through prevention

---

## Example Complete Validation Flow

```javascript
export async function handlePlayPauseAction(context, forcePlay) {
  // ... existing code ...

  // NEW: Validate toggle state before processing
  const switchResult = validateToggleSwitch({
    currentMode: state.heroControlMode,
    currentSource: state.heroControlSource,
    newState: state.heroControlMode,
    newSource: state.heroControlSource,
    post: getControllablePlayerPost(),
    state
  });

  // NEW: Validate play/pause target
  const playPauseValidation = validatePlayPauseTarget({
    activeSource: switchResult.source,
    currentPlaybackState: state.heroPlayerPlaybackState,
    nativeSnapshot: state.nativeSnapshot,
    desktopSnapshot: state.desktopSnapshot,
    post: getControllablePlayerPost()
  });

  // NEW: Return filtered idle state if target doesn't match
  if (!playPauseValidation.valid) {
    console.log(`[Hero Play/Pause] Source mismatch detected`);
    return createFilteredMediaResult({ 
      source: switchResult.source, 
      hasMedia: false,
      legacySourceMode: true 
    });
  }

  // ... continue with existing play/pause logic ...
}
```

---

## Result

After integration:
- ✅ Toggles work independently (Feed/Media don't bleed through)
- ✅ YouTube/Spotify toggles within Media are independent
- ✅ Play/Pause only controls the currently active source
- ✅ Previous/Next only control the currently active source
- ✅ No cross-source action bleed-through
