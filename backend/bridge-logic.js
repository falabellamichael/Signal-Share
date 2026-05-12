import { spawn } from "node:child_process";
import { SMTCMonitor, PlaybackStatus } from "@coooookies/windows-smtc-monitor";

export const MEDIA_KEY_CODES = {
  play_pause: 0xb3,
  play: 0xfa,
  pause: 0xfb,
  next: 0xb0,
  previous: 0xb1,
};

export const WINRT_ACTION_METHODS = {
  play_pause: "TryTogglePlayPauseAsync",
  play: "TryPlayAsync",
  pause: "TryPauseAsync",
  next: "TrySkipNextAsync",
  previous: "TrySkipPreviousAsync",
};

const APP_COMMAND_CODES = {
  play_pause: 14,
  play: 46,
  pause: 47,
  next: 11,
  previous: 12,
};

export function mapPlaybackState(playbackStatus) {
  switch (playbackStatus) {
    case PlaybackStatus.PLAYING: return "playing";
    case PlaybackStatus.PAUSED: return "paused";
    case PlaybackStatus.CLOSED:
    case PlaybackStatus.STOPPED: return "none";
    default: return "active";
  }
}

export function safeGetMediaSessions() {
  if (process.platform !== "win32") return [];
  try {
    const allSessions = SMTCMonitor.getMediaSessions();
    return Array.isArray(allSessions) ? allSessions.filter(Boolean) : [];
  } catch (error) {
    console.warn("[Bridge] SMTC session fetch failed:", error.message);
    return [];
  }
}

export function sendSystemMediaKey(action, targetAppPackage = "", preferredSource = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !winrtMethodName) return Promise.resolve(false);

  // PowerShell script for targeted media control
  const script = `
$ErrorActionPreference = "Stop"
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
$preferred = [string]$env:SIGNAL_SHARE_PREFERRED_SOURCE

function Normalize-AppId([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  $normalized = $value.Trim().ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "!.*$", "")
  $normalized = [regex]::Replace($normalized, "\\.[0-9]+$", "")
  $normalized = [regex]::Replace($normalized, "\\.exe$", "")
  return $normalized
}

function Is-Match-Source($session, [string]$source) {
  if ([string]::IsNullOrWhiteSpace($source) -or $source -eq "all") { return $true }
  $id = ""
  try { $id = Normalize-AppId $session.SourceAppUserModelId } catch {}
  $text = ""
  try {
    $media = $session.TryGetMediaPropertiesAsync().GetResults()
    $text = ([string]::Join(" ", @($media.Title, $media.Artist, $media.AlbumTitle))).ToLowerInvariant()
  } catch {}

  if ($source -eq "spotify") {
    return ($id -match "spotify") -or ($text -match "spotify|open\\.spotify")
  }
  if ($source -eq "youtube") {
    return ($id -match "youtube|ytmusic") -or ($text -match "youtube\\.com|youtu\\.be|music\\.youtube")
  }
  return $true
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.ToString() -match 'Task.*AsTask.*IAsyncOperation' -and $_.ToString() -notmatch 'WithProgress' -and $_.ToString() -match 'TResult.*TResult'
  } | Select-Object -First 1

  $manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetResults()
  if ($null -ne $manager) {
    $sessions = $manager.GetSessions()
    $session = $null
    $bestScore = -1

    foreach ($candidate in $sessions) {
      if ($null -eq $candidate) { continue }
      $score = 0
      $id = $candidate.SourceAppUserModelId
      if ($id -eq $targetApp) { $score += 1000 }
      if (Is-Match-Source $candidate $preferred) { $score += 5000 }
      if ($candidate.PlaybackInfo.PlaybackStatus -eq 4) { $score += 2000 } # Playing

      if ($score -gt $bestScore) {
        $bestScore = $score
        $session = $candidate
      }
    }

    if ($session -ne $null) {
      $actionMethod = $session.GetType().GetMethod('${winrtMethodName}', [Type[]]@())
      if ($actionMethod -ne $null) {
        $actionOp = $actionMethod.Invoke($session, @())
        $winRtSuccess = [bool]($asTaskMethod.MakeGenericMethod(@([bool])).Invoke($null, @($actionOp))).Result
      }
    }
  }
} catch { $winRtSuccess = $false }

if ($winRtSuccess -eq $false -and ([string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all")) {
  # Global Fallback
  [void](Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);' -Name "MediaKeySender" -Namespace "WinAPI" -PassThru)
  [WinAPI.MediaKeySender]::keybd_event(${vkCode}, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [WinAPI.MediaKeySender]::keybd_event(${vkCode}, 0, 2, [UIntPtr]::Zero)
  Write-Output "ok-global"
  exit 0
}

if ($winRtSuccess) { Write-Output "ok-winrt" } else { Write-Output "fail" }
  `.trim();

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      env: {
        ...process.env,
        SIGNAL_SHARE_TARGET_APP: targetAppPackage,
        SIGNAL_SHARE_PREFERRED_SOURCE: preferredSource,
      },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("close", (code) => {
      resolve(code === 0 && stdout.toLowerCase().includes("ok"));
    });
  });
}
