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
    if (!allSessions || !Array.isArray(allSessions)) return [];
    return allSessions.filter(s => s && (s.sourceAppUserModelId || s.sourceAppId));
  } catch (error) {
    console.warn("[Bridge] SMTC session fetch failed:", error.message);
    return [];
  }
}

export function sendSystemMediaKey(action, targetAppPackage = "", preferredSource = "") {
  const vkCode = MEDIA_KEY_CODES[action];
  const winrtMethodName = WINRT_ACTION_METHODS[action];
  if (!vkCode || !winrtMethodName) {
    console.error(`[Bridge] Invalid media action requested: ${action}`);
    return Promise.resolve(false);
  }

  console.log(`[Bridge] Executing action: ${action} (Target: ${targetAppPackage || "All"}, Pref: ${preferredSource || "None"})`);

  const script = `
$ErrorActionPreference = "Stop"
$winRtSuccess = $false
$targetApp = [string]$env:SIGNAL_SHARE_TARGET_APP
$preferred = [string]$env:SIGNAL_SHARE_PREFERRED_SOURCE
if ($null -eq $targetApp) { $targetApp = "" }
if ($null -eq $preferred) { $preferred = "" }
$targetApp = $targetApp.Trim()
$preferred = $preferred.Trim().ToLowerInvariant()

function Normalize-AppId([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  $normalized = $value.Trim().ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, "!.*$", "")
  $normalized = [regex]::Replace($normalized, "\\.[0-9]+$", "")
  $normalized = [regex]::Replace($normalized, "\\.exe$", "")
  return $normalized
}

function Matches-AppId([string]$candidate, [string]$target) {
  $candidateNorm = Normalize-AppId $candidate
  $targetNorm = Normalize-AppId $target
  if ([string]::IsNullOrWhiteSpace($candidateNorm) -or [string]::IsNullOrWhiteSpace($targetNorm)) { return $false }
  return ($candidateNorm -eq $targetNorm) -or ($candidateNorm.StartsWith($targetNorm)) -or ($targetNorm.StartsWith($candidateNorm))
}

function Is-Browser-App([string]$id) {
  $n = Normalize-AppId $id
  return ($n -match "chrome|msedge|edge|firefox|opera|browser")
}

function Get-Session-Text($session) {
  $parts = New-Object System.Collections.Generic.List[string]
  try { if ($session.SourceAppUserModelId) { $parts.Add($session.SourceAppUserModelId) } } catch {}
  try {
    $mediaOp = $session.TryGetMediaPropertiesAsync()
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.ToString() -match 'Task.*AsTask.*IAsyncOperation' -and $_.ToString() -notmatch 'WithProgress' } | Select-Object -First 1
    $mediaTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])).Invoke($null, @($mediaOp))
    $media = $mediaTask.Result
    if ($media.Title) { $parts.Add($media.Title) }
    if ($media.Artist) { $parts.Add($media.Artist) }
    if ($media.AlbumArtist) { $parts.Add($media.AlbumArtist) }
    if ($media.AlbumTitle) { $parts.Add($media.AlbumTitle) }
  } catch {}
  return ([string]::Join(" ", $parts)).ToLowerInvariant()
}

function Is-Match-Source($session, [string]$source) {
  if ([string]::IsNullOrWhiteSpace($source) -or $source -eq "all") { return $true }
  $id = ""
  try { $id = Normalize-AppId $session.SourceAppUserModelId } catch {}
  $text = Get-Session-Text $session
  $isBrowser = Is-Browser-App $id

  $isYouTube = ($id -match "youtube|ytmusic") -or ($text -match "youtube\\.com|youtube -|- youtube|youtu\\.be|music\\.youtube")
  $isSpotify = ($id -match "spotify") -or ($text -match "spotify|open\\.spotify")

  if ($source -eq "spotify") {
    if ($isYouTube) { return $false }
    if ($isSpotify) { return $true }
    return $isBrowser
  }
  if ($source -eq "youtube") {
    if ($isSpotify) { return $false }
    if ($isYouTube) { return $true }
    return $isBrowser
  }
  return $true
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.ToString() -match 'Task.*AsTask.*IAsyncOperation' -and $_.ToString() -notmatch 'WithProgress' -and $_.ToString() -match 'TResult.*TResult'
  } | Select-Object -First 1

  if ($asTaskMethod -ne $null) {
    $managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $managerTask = $asTaskMethod.MakeGenericMethod(@([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])).Invoke($null, @($managerOp))
    $manager = $managerTask.Result

    if ($null -ne $manager) {
      $sessions = $manager.GetSessions()
      $session = $null
      $bestScore = -1

      foreach ($candidate in $sessions) {
        if ($null -eq $candidate) { continue }
        $score = 0
        $id = ""
        try { $id = $candidate.SourceAppUserModelId } catch {}

        $isTarget = [string]::IsNullOrWhiteSpace($targetApp) -or (Matches-AppId $id $targetApp)
        $isPreferred = [string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all" -or (Is-Match-Source $candidate $preferred)
        
        if (![string]::IsNullOrWhiteSpace($preferred) -and $preferred -ne "all") {
          if ($isPreferred) { $score += 10000 }
          else { $score -= 20000 }
        }
        if ($isTarget) { $score += 1000 }
        if ($candidate.PlaybackInfo.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) { $score += 5000 }

        if ($score -gt $bestScore) {
          $bestScore = $score
          $session = $candidate
        }
      }

      if ($session -ne $null -and $bestScore -ge 0) {
        $actionMethod = $session.GetType().GetMethod('${winrtMethodName}', [Type[]]@())
        if ($actionMethod -ne $null) {
          $actionOp = $actionMethod.Invoke($session, @())
          $winRtSuccess = [bool]($asTaskMethod.MakeGenericMethod(@([bool])).Invoke($null, @($actionOp))).Result
        }
      }
    }
  }
} catch { $winRtSuccess = $false }

if ($winRtSuccess -eq $false -and ([string]::IsNullOrWhiteSpace($preferred) -or $preferred -eq "all")) {
  # Global Fallback logic
  try {
    Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);' -Name "MediaKeySender" -Namespace "WinAPI" -PassThru | Out-Null
  } catch {}
  [WinAPI.MediaKeySender]::keybd_event(${vkCode}, 0, 1, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 45
  [WinAPI.MediaKeySender]::keybd_event(${vkCode}, 0, 3, [UIntPtr]::Zero)
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
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      const out = stdout.trim();
      const err = stderr.trim();
      if (err) console.error(`[Bridge] Action PowerShell Error: ${err}`);
      if (out) console.log(`[Bridge] Action Result: ${out}`);
      resolve(code === 0 && out.toLowerCase().includes("ok"));
    });
  });
}
