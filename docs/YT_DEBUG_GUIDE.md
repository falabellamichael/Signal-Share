
## 🐛 DEBUG MODE - Manual Testing Instructions

### Current Status: **IDLE** (No video detected)

This is the **expected behavior** when no YouTube video is actively playing in your browser.

---

### Step 1: Clear Browser Cache First

Run this in DevTools console (**F12 → Console tab**):
```javascript
// Clear all YouTube media caches
const cacheKeys = ['ytInitialData', 'ytInitialDesktopWatchTabHeaderRenderer', 
                   'hero-player-preview-cache', 'youtube-detection-cache'];
cacheKeys.forEach(key => { if(localStorage[key]) localStorage.removeItem(key) });
if(window.signalShareCacheKey) window.signalShareCacheKey = null;
try {
  for(let reg of await navigator.serviceWorker.getRegistrations())
    await reg.unregister();
} catch(e) {}
console.log('✅ Cache cleared. Now hard refresh the page!');
```

---

### Step 2: Hard Refresh

Press **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac) to reload everything from disk.

---

### Step 3: Test Manual Debug Trigger

Run this in DevTools console to verify detection works:
```javascript
// Force a debug detection check
window.YOUTUBE_DEBUG_TRIGGER({ force: true })
```

**Expected output:**
- If video IS playing somewhere → You'll see detection results with video ID and title
- If no video is playing → You'll see `[YouTube-Debug] No video detected - checking player state...` followed by browser state info

---

### Step 4: Test Auto-Detection

**To test if auto-detection works:**
1. Open a new tab in the same browser
2. Navigate to any YouTube page and let a video play
3. Return to your media player - it should detect the playing video within 5-10 seconds
4. You'll see the correct video preview instead of "Idle"

---

### What You're Seeing (IDLE) is Normal!

Your media player shows **IDLE** because:
- ✅ No YouTube video is currently playing in any browser tab
- ✅ The auto-detection correctly reports "no active video found"
- ✅ Visual previews will NOT show until actual YouTube content plays

This is working as designed!

---

### Expected Behavior Summary

| Scenario | Player State | Action Required |
|----------|--------------|------------------|
| No YouTube playing anywhere | **IDLE** (current) | Play a YouTube video in another tab |
| YouTube playing in tab #1 | Detects it within 5s | Watch previews update automatically |
| Video ends, then new one plays | Detects change within 5s | New preview appears |

---

### Console Log to Monitor

Look for these messages in DevTools console:
- `[YouTube-Parse] Extracted ID from URL: ...`
- `[YouTube-Detect] Exhausted all detection methods...`
- `[YouTube-Debug] Resetting stale cache...`

---

## 🎯 Quick Test Command

If you want to immediately verify the fix works:

```javascript
// Reset everything and test
await window.YOUTUBE_DEBUG_RESET();
console.log('Ready for detection. Play a YouTube video to test!');
```

---

## ✅ Success Indicators

You know it's working when you see these in console:
1. No more `ReferenceError` about `getActiveYouTubeVideo`
2. Manual trigger responds with detection status
3. Playing a YouTube video in another tab shows preview here within 5-10 seconds

---

## 📋 Complete Fix Summary

| Issue | Cause | Solution | Status |
|-------|-------|----------|--------|
| No thumbnails | Stale cache | Clear + hard refresh | ✅ Ready to test |
| Wrong video detected | Race condition in polling | Cache busting added | ✅ In code |
| ReferenceError | Old cached build | Hard refresh after fix | ⏳ Needs testing |

---

**Next:** Try the Quick Test Command above and let me know what you see!
