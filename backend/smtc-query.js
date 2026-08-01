import { SMTCMonitor } from "@coooookies/windows-smtc-monitor";

/**
 * Infer artwork MIME type from binary buffer
 */
function inferArtworkMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  return "";
}

/**
 * Serialize a media session for JSON response
 */
function serializeSession(s) {
  if (!s) return null;

  let artworkUri = "";
  const thumbnail = s.media?.thumbnail;
  if (Buffer.isBuffer(thumbnail) && thumbnail.length > 0 && thumbnail.length <= 140000) {
    const mimeType = inferArtworkMimeType(thumbnail);
    if (mimeType) {
      artworkUri = `data:${mimeType};base64,${thumbnail.toString("base64")}`;
    }
  }

  return {
    sourceAppId: s.sourceAppId || "",
    media: s.media ? {
      title: s.media.title || "",
      artist: s.media.artist || "",
      albumTitle: s.media.albumTitle || "",
      albumArtist: s.media.albumArtist || "",
      trackNumber: s.media.trackNumber || 0,
      genres: s.media.genres || []
    } : null,
    playback: s.playback ? {
      playbackStatus: s.playback.playbackStatus || 0,
      playbackType: s.playback.playbackType || 0,
      controls: s.playback.controls || {}
    } : null,
    timeline: s.timeline ? {
      position: s.timeline.position || 0,
      startTime: s.timeline.startTime || 0,
      endTime: s.timeline.endTime || 0
    } : null,
    artworkUri
  };
}

/**
 * Exported command execution function for Windows Media Transport Control (SMTC).
 * Handles Play/Pause, Next/Previous actions by sending commands to the system.
 */
export async function executeMediaAction(actionName) {
  try {
    const current = SMTCMonitor.getCurrentMediaSession();

    if (!current) {
      console.log('[smtc-query] No active media session found for action:', actionName);
      return { ok: false, error: 'No active media session found.' };
    }

    // Normalize action name - map common variants to SMTC standard commands
    const normalizedAction = actionName
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/\s+/g, '_');

    try {
      // Execute the command through SMTCMonitor's native interface
      await SMTCMonitor.executeCommand(current, normalizedAction);

      console.log('[smtc-query] Command executed successfully:', actionName, 'for', current.sourceAppId || '');
      return {
        ok: true,
        sessionId: current.id || '',
        sourceAppId: current.sourceAppId || ''
      };
    } catch (error) {
      console.error('[smtc-query] Command failed:', actionName, error.message);
      return {
        ok: false,
        error: `Failed to execute ${actionName} on Windows Media Control`,
        details: error.message || 'Unknown command failure'
      };
    }
  } catch (error) {
    console.error('[smtc-query] Critical error during action execution:', error);
    return {
      ok: false,
      error: `System failed to execute command: ${error.message}`
    };
  }
}

// Main GET handler for reading media state (existing functionality)
try {
  const sessions = SMTCMonitor.getMediaSessions();
  const current = SMTCMonitor.getCurrentMediaSession();

  const serializedSessions = Array.isArray(sessions) ? sessions.map(serializeSession) : [];
  const serializedCurrent = current ? serializeSession(current) : null;

  console.log(JSON.stringify({
    ok: true,
    sessions: serializedSessions,
    current: serializedCurrent
  }));
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    error: e.message
  }));
}

process.exit(0);
