# Independent Toggle Implementation Guide

## Overview

This implementation creates **completely independent** toggle functionality for:

1. **Feed Toggle (Feed/Media)** - Shows feed posts exclusively, switches to respective feed post type
2. **Media Toggle (YouTube/Spotify)** - Shows YouTube/Spotify information and preview based on app/browser tab

## Key Features

### Independent Toggle Behavior

- **Feed Toggle**: Pressing the Feed toggle shows ONLY feed posts, regardless of Media toggle state
- **Media Toggle**: Pressing the Media toggle shows ONLY YouTube/Spotify info, regardless of Feed toggle state
- Both toggles can be pressed simultaneously and each will show its own "pre-preview" (standby) when nothing is playing

### How It Works

#### Feed Toggle Mode (`heroControlMode === "feed"`)
When activated:
1. Shows feed posts exclusively in the hero player stage
2. Switches to respective feed post type (YouTube/Spotify/App Media)
3. Independent of Media toggle - can coexist or be toggled separately
4. Shows "FEED MODE · READY" pre-preview when no active post

#### Media Toggle Mode (`heroControlMode === "media"`)
When activated:
1. Shows YouTube/Spotify information exclusively in the hero player stage
2. Displays info based on application/browser tab when playing
3. Independent of Feed toggle - shows only its own preview state
4. Shows "YOUTUBE · READY" or "SPOTIFY · READY" pre-preview when nothing is playing
5. Auto-detects YouTube video in browser tab for Media -> YouTube mode

### Toggle States Summary

| Mode | State | Preview Shown |
|------|-------|----------------|
| Feed Active + No Post | Feed Standby | "FEED MODE · READY" |
| Media Active (YouTube) + No Video | YouTube Standby | "YOUTUBE · READY" or "BROWSER YOUTUBE" |
| Media Active (Spotify) + No Track | Spotify Standby | "SPOTIFY · READY" or "BROWSER SPOTIFY" |
| Feed Active + Post Present | Feed Post Preview | Post artwork and metadata |
| Media Active + YouTube Playing | YouTube Preview | YouTube video info/artwork |
| Media Active + Spotify Playing | Spotify Preview | Spotify track info/artwork |

### Implementation Files

1. **`hero-media-player-preview-fixed.js`** - Main preview component with independent toggle logic
2. **`hero-media-player.js`** - Main controller (may need updates to use new preview)
3. **`youtube-player-detection.js`** - YouTube auto-detection for browser tab

## Usage Examples

### Feed Toggle
```javascript
// Activate feed mode
state.heroControlMode = "feed";

// Feed toggle will show:
// - Feed posts from respective type
// - Pre-preview when no post active
// - Independent of Media toggle state
```

### Media Toggle
```javascript
// Activate media mode
state.heroControlMode = "media";

// Set YouTube source
state.heroControlSource = "youtube";

// Media toggle will show:
// - YouTube info/artwork from browser tab when playing
// - Auto-detect YouTube videos in browser
// - Pre-preview ("YOUTUBE · READY") when nothing playing
// - Independent of Feed toggle state
```

### Simultaneous Toggles (Both Modes Active)
```javascript
state.heroControlMode = "media"; // Media toggle shows its preview
state.heroControlSource = "youtube"; // YouTube info exclusively

// OR

state.heroControlMode = "feed"; // Feed toggle shows its preview
// Independent behavior maintained for each toggle
```

## Testing Checklist

- [ ] Feed toggle shows only feed posts when active
- [ ] Media toggle shows only YouTube/Spotify info when active
- [ ] Both toggles show pre-preview when nothing is playing
- [ ] Feeding toggle can be pressed while media toggle is active (shows feed preview exclusively)
- [ ] Media toggle can be pressed while feed toggle is active (shows media preview exclusively)
- [ ] YouTube auto-detection works in browser tab for media mode
- [ ] Spotify artwork resolves correctly for both modes

## Migration Notes

To migrate to independent toggle functionality:

1. Replace `hero-media-player-preview.js` with `hero-media-player-preview-fixed.js`
2. Update imports in `hero-media-player.js`:
   ```javascript
   import { renderHeroStagePreview } from "./hero-media-player-preview-fixed.js";
   ```
3. Ensure state has the necessary properties:
   - `state.heroControlMode` (feed | media)
   - `state.heroControlSource` (youtube | spotify | all)
4. Test both toggle modes independently

## API Changes

### New State Properties

```javascript
state = {
  heroControlMode: "feed" | "media",    // Toggle mode
  heroControlSource: "youtube" | "spotify" | "all", // Active source
  heroMediaSource: "youtube" | "spotify" | "all",   // Media source
  systemMediaSource: "youtube" | "spotify" | "all", // System source
};
```

### New Configuration Options

```javascript
window.SIGNAL_SHARE_HERO_PLAYER_CONFIG = {
  heroControlMode: "feed" | "media" // Toggle mode preference
};
```

## Troubleshooting

### Toggles not showing independently

- Check that `state.heroControlMode` is being set correctly
- Verify `renderHeroStagePreview()` is being called after state changes
- Ensure the stage element exists and has access to DOM methods

### Preview not updating when toggle pressed

- Try calling `render()` after setting toggle mode
- Check console for error messages about failed DOM operations
- Verify artwork URLs are resolving correctly

### YouTube auto-detection not working

- Ensure `parseYouTubeUrl` function is available
- Check browser tab has focus with active YouTube video
- Verify URL hash/params contain valid YouTube ID

## Summary

The independent toggle implementation ensures:

1. **Feed Toggle** - Exclusively shows feed posts and feed post types
2. **Media Toggle** - Exclusively shows YouTube/Spotify info from app/browser tab
3. Both toggles maintain their own state independently
4. Both show "pre-preview" when nothing is playing in their respective modes

This provides a clean separation of concerns where each toggle controls its own preview behavior without interference from the other toggle state.
