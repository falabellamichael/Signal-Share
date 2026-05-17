import express from "express";
import { spawn } from "node:child_process";

const HTML_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

const MEDIA_ACTION_KEYS = {
  play_pause: 0xB3,
  next: 0xB0,
  previous: 0xB1,
  stop: 0xB2
};

const PC_APP_ALLOWLIST = Object.freeze({
  notepad: {
    id: "notepad",
    label: "Notepad",
    aliases: ["notes", "note pad"],
    launch: { command: "notepad.exe", args: [] },
    actions: {}
  },
  calculator: {
    id: "calculator",
    label: "Calculator",
    aliases: ["calc"],
    launch: { command: "calc.exe", args: [] },
    actions: {}
  },
  "file-explorer": {
    id: "file-explorer",
    label: "File Explorer",
    aliases: ["explorer", "windows explorer", "files"],
    launch: { command: "explorer.exe", args: [] },
    actions: {}
  },
  chrome: {
    id: "chrome",
    label: "Google Chrome",
    aliases: ["google chrome"],
    launch: { command: "chrome.exe", args: [] },
    actions: {}
  },
  edge: {
    id: "edge",
    label: "Microsoft Edge",
    aliases: ["microsoft edge", "ms edge", "msedge"],
    launch: { command: "msedge.exe", args: [] },
    actions: {}
  },
  vscode: {
    id: "vscode",
    label: "Visual Studio Code",
    aliases: ["vs code", "visual studio code", "code"],
    launch: { command: "code.cmd", args: [] },
    actions: {}
  },
  spotify: {
    id: "spotify",
    label: "Spotify",
    aliases: [],
    launch: { command: "cmd.exe", args: ["/c", "start", "", "spotify:"] },
    actions: {
      play_pause: { type: "media", key: "play_pause", label: "Play/Pause" },
      next: { type: "media", key: "next", label: "Next track" },
      previous: { type: "media", key: "previous", label: "Previous track" }
    }
  },
  discord: {
    id: "discord",
    label: "Discord",
    aliases: [],
    launch: { command: "cmd.exe", args: ["/c", "start", "", "discord:"] },
    actions: {}
  },
  steam: {
    id: "steam",
    label: "Steam",
    aliases: [],
    launch: { command: "cmd.exe", args: ["/c", "start", "", "steam:"] },
    actions: {}
  }
});

export const STRICT_TOOL_POLICY = `Strict tool policy for the main page assistant:
- Do only the exact action requested by the latest user message.
- Do not perform extra searches, extra app actions, cleanup, edits, publishing, opening apps, closing apps, clicking, typing, or command execution unless the user explicitly asked for that specific action.
- If the message does not explicitly request a tool, answer in chat only.
- If the message requests DuckDuckGo search, only search DuckDuckGo and summarize the returned results.
- If the message requests opening a PC app, only open an allowlisted app by app ID or known app name.
- If the message requests an app action, only perform that exact allowlisted action.
- If the requested app or action is not allowlisted, say it is not available.
- Never run arbitrary shell commands.
- Never execute arbitrary PowerShell.
- Never open arbitrary file paths.
- Never send arbitrary keystrokes to an app.`;

function decodeHtml(value = "") {
  return `${value || ""}`
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity) => HTML_ENTITIES[entity.toLowerCase()] || match);
}

function stripHtml(value = "") {
  return decodeHtml(`${value || ""}`.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuckDuckGoResultUrl(rawHref = "") {
  const href = decodeHtml(rawHref).trim();
  if (!href) return "";

  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return uddg;
    if (/^https?:$/i.test(url.protocol)) return url.href;
  } catch (_error) {
    return "";
  }

  return "";
}

function normalizeLookupText(value = "") {
  return `${value || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeActionName(value = "") {
  return `${value || ""}`
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .trim();
}

function isAllowedSystemUri(value = "") {
  const uri = `${value || ""}`.trim().toLowerCase();
  return ["http:", "https:", "spotify:", "ms-phone:", "yourphone:", "mobilephonelink:"].some((protocol) => uri.startsWith(protocol));
}

function toPowerShellSingleQuoted(value = "") {
  return `${value || ""}`.replace(/'/g, "''");
}

function getPublicAppCatalog() {
  return Object.values(PC_APP_ALLOWLIST).map((app) => ({
    id: app.id,
    label: app.label,
    aliases: app.aliases || [],
    actions: Object.entries(app.actions || {}).map(([id, action]) => ({
      id,
      label: action.label || id
    }))
  }));
}

function resolveAllowedApp(value = "") {
  const requested = normalizeLookupText(value);
  if (!requested) return null;

  for (const app of Object.values(PC_APP_ALLOWLIST)) {
    const names = [app.id, app.label, ...(app.aliases || [])].map(normalizeLookupText);
    if (names.includes(requested)) return app;
  }

  return null;
}

export function classifyStrictToolIntent(message = "") {
  const raw = `${message || ""}`.trim();
  const text = raw.toLowerCase();

  const searchMatch = raw.match(/^(?:search|look up|lookup|find|duckduckgo)\s+(?:duckduckgo\s+)?(?:for\s+)?(.+)$/i);
  if (searchMatch?.[1]?.trim()) {
    return { tool: "duckduckgo.search", allowed: true, query: searchMatch[1].trim() };
  }

  const openMatch = raw.match(/^(?:open|launch|start)\s+(.+)$/i);
  if (openMatch?.[1]?.trim()) {
    const app = resolveAllowedApp(openMatch[1]);
    return {
      tool: "pc.open_app",
      allowed: Boolean(app),
      appId: app?.id || "",
      reason: app ? "" : "Requested app is not allowlisted."
    };
  }

  const mediaMatch = text.match(/^(play pause|play\/pause|pause|play|next|skip|previous|back)(?:\s+(spotify))?$/i);
  if (mediaMatch) {
    const actionMap = {
      "play pause": "play_pause",
      "play/pause": "play_pause",
      pause: "play_pause",
      play: "play_pause",
      next: "next",
      skip: "next",
      previous: "previous",
      back: "previous"
    };
    return {
      tool: "pc.app_action",
      allowed: true,
      appId: "spotify",
      action: actionMap[mediaMatch[1]] || "play_pause"
    };
  }

  return { tool: "chat.only", allowed: true };
}

function launchProcess(command, args = []) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("PC app launching is only enabled on Windows."));
      return;
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false
    });

    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ pid: child.pid || null });
    });
  });
}

async function sendFixedMediaKey(actionName = "") {
  const normalized = normalizeActionName(actionName);
  const keyCode = MEDIA_ACTION_KEYS[normalized];
  if (!keyCode) throw new Error("Unsupported media action.");

  const hexKey = `0x${keyCode.toString(16).toUpperCase()}`;
  const className = `NativeMethods_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const script = `
$code = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
Add-Type -Namespace SignalShare -Name ${className} -MemberDefinition $code
[SignalShare.${className}]::keybd_event(${hexKey},0,0,[UIntPtr]::Zero)
[SignalShare.${className}]::keybd_event(${hexKey},0,2,[UIntPtr]::Zero)
`;
  
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

  return launchProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedCommand
  ]);
}

async function openAllowedSystemUri(uri = "") {
  const targetUri = `${uri || ""}`.trim();
  if (!targetUri) throw new Error("URI is required.");
  if (!isAllowedSystemUri(targetUri)) throw new Error("URI protocol is not allowlisted.");

  const safeUri = toPowerShellSingleQuoted(targetUri);
  const command = `
$uri = '${safeUri}'
if ($uri -eq 'mobilephonelink:' -or $uri -eq 'ms-phone:') {
  try { Start-Process 'ms-phone:' -ErrorAction Stop } catch {
    try { Start-Process 'yourphone:' -ErrorAction Stop } catch {
      try { explorer.exe 'shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App' } catch {
        Start-Process 'https://www.microsoft.com/store/productId/9NMP3S0RLH54'
      }
    }
  }
} else {
  Start-Process -FilePath $uri
}
`.trim();

  return launchProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command
  ]);
}

async function openAllowedApp(app) {
  if (!app?.launch?.command) throw new Error("App launch definition is missing.");
  return launchProcess(app.launch.command, app.launch.args || []);
}

async function runAllowedAppAction(app, actionName = "") {
  const normalized = normalizeActionName(actionName);
  const action = app?.actions?.[normalized];
  if (!action) throw new Error("App action is not allowlisted.");

  if (action.type === "media") {
    return sendFixedMediaKey(action.key);
  }

  throw new Error("App action type is not implemented.");
}

async function searchDuckDuckGo({ fetchWithTimeout, query = "", maxResults = 5 }) {
  const q = `${query || ""}`.trim().slice(0, 300);
  if (!q) throw new Error("Search query is required.");

  const limit = Math.max(1, Math.min(Number(maxResults) || 5, 10));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "SignalShareBot/1.0 (+https://signal-share.com)"
    }
  }, 10000);

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}: ${html.slice(0, 160)}`);
  }

  const anchors = [...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const results = [];

  for (let index = 0; index < anchors.length && results.length < limit; index += 1) {
    const match = anchors[index];
    const next = anchors[index + 1];
    const block = html.slice(match.index || 0, next?.index || html.length);
    const snippetMatch = block.match(/<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const title = stripHtml(match[2]);
    const urlValue = normalizeDuckDuckGoResultUrl(match[1]);
    const snippet = stripHtml(snippetMatch?.[1] || "");

    if (!title || !urlValue || !/^https?:\/\//i.test(urlValue)) continue;
    if (results.some((result) => result.url === urlValue)) continue;
    results.push({ title, url: urlValue, snippet });
  }

  return results;
}

export function createStrictAiTools({ isAuthorized, fetchWithTimeout }) {
  const router = express.Router();

  router.post("/api/tools/duckduckgo/search", async (req, res) => {
    try {
      if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });

      const query = `${req.body?.query || ""}`.trim();
      const maxResults = req.body?.maxResults || req.body?.limit || 5;
      if (!query) return res.status(400).json({ ok: false, error: "Search query is required." });

      const results = await searchDuckDuckGo({ fetchWithTimeout, query, maxResults });
      return res.json({ ok: true, query, results });
    } catch (error) {
      console.error("[Bridge] DuckDuckGo search error:", error);
      return res.status(502).json({ ok: false, error: "DuckDuckGo search failed." });
    }
  });

  router.post("/api/assistant/intent", (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
    return res.json({
      ok: true,
      policy: STRICT_TOOL_POLICY,
      intent: classifyStrictToolIntent(req.body?.message || "")
    });
  });

  router.post("/api/system-media/action", async (req, res) => {
    try {
      if (!isAuthorized(req)) return res.json({ ok: false, error: "Unauthorized bridge request." });

      const action = normalizeActionName(req.body?.action || "");
      if (action === "open_uri") {
        const uri = `${req.body?.uri || req.body?.openUri || ""}`.trim();
        const result = await openAllowedSystemUri(uri);
        return res.json({ ok: true, action, ...result });
      }

      if (!MEDIA_ACTION_KEYS[action]) {
        return res.json({ ok: false, error: "Unsupported media action." });
      }

      const result = await sendFixedMediaKey(action);
      return res.json({ ok: true, action, ...result });
    } catch (error) {
      console.error("[Bridge] Media action error:", error);
      return res.json({ ok: false, error: error?.message || "Media action failed." });
    }
  });

  router.get("/api/system/apps", (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });
    return res.json({ ok: true, apps: getPublicAppCatalog() });
  });

  router.post("/api/system/apps/open", async (req, res) => {
    try {
      if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });

      const app = resolveAllowedApp(req.body?.appId || req.body?.app || req.body?.name || "");
      if (!app) {
        return res.status(400).json({ ok: false, error: "Requested app is not allowlisted." });
      }

      const result = await openAllowedApp(app);
      return res.json({ ok: true, appId: app.id, label: app.label, ...result });
    } catch (error) {
      console.error("[Bridge] App launch error:", error);
      return res.status(500).json({ ok: false, error: error?.message || "App launch failed." });
    }
  });

  router.post("/api/system/apps/action", async (req, res) => {
    try {
      if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized bridge request." });

      const app = resolveAllowedApp(req.body?.appId || req.body?.app || req.body?.name || "");
      if (!app) {
        return res.status(400).json({ ok: false, error: "Requested app is not allowlisted." });
      }

      const action = normalizeActionName(req.body?.action || "");
      const result = await runAllowedAppAction(app, action);
      return res.json({ ok: true, appId: app.id, action, ...result });
    } catch (error) {
      console.error("[Bridge] App action error:", error);
      return res.status(400).json({ ok: false, error: error?.message || "App action failed." });
    }
  });

  return { router, policy: STRICT_TOOL_POLICY, classifyStrictToolIntent };
}
