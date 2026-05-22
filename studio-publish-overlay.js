(() => {
  const $ = (selector) => document.querySelector(selector);
  const familyGrid = $("#publishFamilyGrid");
  const optionGrid = $("#publishOptionGrid");
  const title = $("#publishDestinationTitle");
  const copy = $("#publishDestinationCopy");
  const badge = $("#publishSelectedBadge");
  const selectedAction = $("#publishSelectedAction");
  const hint = $("#publishSelectedHint");
  const actionButton = $("#publishStudioActionButton");
  const shareButton = $("#publishShareSheetButton");
  const feedback = $("#publishDestinationFeedback");
  const form = $("#postForm");
  const mediaInput = $("#mediaInput");
  const overlay = $("#compose");
  const darkToggle = $("#publishDarkToggle");
  const legacyRepo = $("#publishGithubRepoField");
  if (!familyGrid || !optionGrid || !actionButton || !form) return;

  const ACTIVITY_KEY = "signal-share-publish-activity";
  const DARK_KEY = "signal-share-publish-generic-dark";
  legacyRepo?.setAttribute("hidden", "");

  const dynamicFields = document.createElement("div");
  dynamicFields.className = "publish-field-grid publish-dynamic-fields";
  dynamicFields.id = "publishDynamicFields";
  form.before(dynamicFields);

  const fieldPresets = {
    repoUrl: ["Repository URL", "https://github.com/owner/repo", "url"],
    baseBranch: ["Base branch", "main", "text"],
    branchName: ["Branch name", "feature/context-actions", "text"],
    commitMessage: ["Commit message", "feat: publish Signal Share update", "text"],
    emailFrom: ["From email", "you@example.com", "email"],
    emailTo: ["To email", "name@example.com", "email"],
    emailSubject: ["Subject", "Quick update", "text"],
    shareUrl: ["Share URL", "https://example.com/post", "url"]
  };

  function field(key, config = {}) {
    const preset = fieldPresets[key] || [key, "", "text"];
    const finalKey = config.key || key;
    return {
      id: `publishTool-${finalKey}`,
      key: finalKey,
      label: config.label || preset[0],
      placeholder: config.placeholder ?? preset[1],
      type: config.type || preset[2],
      mode: config.mode || "input",
      options: config.options || [],
      value: config.value || "",
      persist: config.persist !== false,
      storageKey: config.storageKey || `signal-share-publish.${finalKey}`
    };
  }

  const families = {
    signal: {
      badge: "Signal Share",
      title: "Signal Share feed",
      copy: "Publish to the Signal Share feed with optional routing metadata.",
      options: [{
        id: "signal-feed", icon: "📣", name: "Publish Feed Post", note: "Use live feed flow", button: "Publish post",
        hint: "Uses the existing Signal Share publish pipeline.",
        fields: [
          field("audience", { label: "Audience", mode: "select", value: "public", options: [["public", "Public feed"], ["followers", "Followers"], ["private", "Private draft"]] }),
          field("publishNote", { label: "Publish note", placeholder: "Optional note for this post" })
        ]
      }]
    },
    local: {
      badge: "Local Storage",
      title: "Local Storage",
      copy: "Save the current publish package to browser storage with option-specific keys.",
      options: [
        { id: "localStorage", icon: "💾", name: "Local Storage", note: "Persistent save", button: "Save Locally", hint: "Persists in this browser.", fields: [field("localKey", { label: "Storage key", value: "signal-share-publish-saved-items" }), field("localLabel", { label: "Save label", placeholder: "Homepage publish draft" })] },
        { id: "sessionStorage", icon: "📦", name: "Session Storage", note: "Tab session save", button: "Save Session", hint: "Clears when the tab closes.", fields: [field("sessionKey", { label: "Session key", value: "signal-share-publish-session-items" }), field("sessionLabel", { label: "Session label", placeholder: "Working draft" })] }
      ]
    },
    social: {
      badge: "Social",
      title: "Social posting",
      copy: "Build platform-specific share routes and captions.",
      options: [
        { id: "social-facebook", icon: "📘", name: "Facebook", note: "Share URL", button: "Open Facebook", hint: "Opens Facebook sharing.", fields: [field("shareUrl")] },
        { id: "social-instagram", icon: "📸", name: "Instagram", note: "Post kit", button: "Share for Instagram", hint: "Copies or shares an Instagram-ready kit.", fields: [field("instagramFrom", { label: "From account", placeholder: "@youraccount" }), field("instagramHashtags", { label: "Hashtags", placeholder: "#signalshare #media" })] },
        { id: "social-x", icon: "✕", name: "X", note: "Post intent", button: "Open X Post", hint: "Opens an X post intent.", fields: [field("xHandle", { label: "From handle", placeholder: "@yourhandle" }), field("shareUrl")] },
        { id: "social-linkedin", icon: "💼", name: "LinkedIn", note: "Link share", button: "Open LinkedIn", hint: "Opens LinkedIn sharing.", fields: [field("linkedinFrom", { label: "Profile or company", placeholder: "Signal Share" }), field("shareUrl")] }
      ]
    },
    github: {
      badge: "GitHub",
      title: "GitHub",
      copy: "Each GitHub option has its own toolset. Commit & Push builds a repo command from the URL.",
      options: [
        { id: "commit", icon: "📝", name: "Commit & Push", note: "Clone, commit, push", button: "Copy Git Command", hint: "Copies a command sequence based on repo URL, branches, remote, and commit message.", fields: [field("repoUrl"), field("baseBranch", { value: "main" }), field("branchName", { value: "feature/context-actions" }), field("remoteName", { label: "Remote name", placeholder: "origin", value: "origin" }), field("commitMessage")] },
        { id: "issue", icon: "🐛", name: "Create Issue", note: "Prefilled issue", button: "Open Issue", hint: "Opens a GitHub issue with title, labels, assignees, and body.", fields: [field("repoUrl"), field("issueTitle", { label: "Issue title", placeholder: "Publish workflow follow-up" }), field("issueLabels", { label: "Labels", placeholder: "bug, publish" }), field("issueAssignees", { label: "Assignees", placeholder: "username1, username2" })] },
        { id: "pullRequest", icon: "🤝", name: "Pull Request", note: "Compare route", button: "Open PR", hint: "Opens GitHub compare using base branch, head branch, PR title, and body.", fields: [field("repoUrl"), field("baseBranch", { value: "main" }), field("branchName", { value: "feature/context-actions" }), field("prTitle", { label: "PR title", placeholder: "Publish workflow update" }), field("prBody", { label: "PR body override", placeholder: "Leave blank to use the post package", mode: "textarea" })] }
      ]
    },
    cloud: {
      badge: "Cloud Sync",
      title: "Cloud Sync",
      copy: "Export, import, or share publish packages with matching fields.",
      options: [
        { id: "downloadBackup", icon: "⬇️", name: "Download Backup", note: "Create JSON", button: "Download JSON", hint: "Downloads a named JSON backup.", fields: [field("backupFileName", { label: "Backup file name", value: `signal-share-actions-${new Date().toISOString().slice(0, 10)}.json` }), field("backupLabel", { label: "Backup label", placeholder: "Publish overlay backup" })] },
        { id: "importJson", icon: "⬆️", name: "Import JSON", note: "Load backup", button: "Import JSON", hint: "Imports from this JSON field, or the caption box when empty.", fields: [field("importJson", { label: "JSON backup payload", placeholder: "Paste exported JSON here", mode: "textarea", persist: false }), field("importMode", { label: "Import mode", mode: "select", value: "replace", options: [["replace", "Replace activity"], ["append", "Append activity"]] })] },
        { id: "share", icon: "📤", name: "Share", note: "Native share", button: "Share Now", hint: "Uses native share with custom title and URL.", fields: [field("shareTitle", { label: "Share title", placeholder: "Signal Share post" }), field("shareUrl")] }
      ]
    },
    email: {
      badge: "Email",
      title: "Email",
      copy: "Each email option exposes From, To, and routing fields.",
      options: [
        { id: "sendEmail", icon: "✉️", name: "Send Email", note: "Open mail app", button: "Compose Email", hint: "Composes with From, To, CC, subject, and body.", fields: [field("emailFrom"), field("emailTo"), field("emailCc", { label: "CC email", placeholder: "cc@example.com", type: "email" }), field("emailSubject")] },
        { id: "copyEmail", icon: "📋", name: "Copy Email", note: "Copy draft", button: "Copy Draft", hint: "Copies a complete email draft.", fields: [field("emailFrom"), field("emailTo"), field("replyTo", { label: "Reply-To email", placeholder: "reply@example.com", type: "email" }), field("emailSubject")] },
        { id: "forward", icon: "↪️", name: "Forward Message", note: "Forward format", button: "Compose Forward", hint: "Creates a forwarded-message draft.", fields: [field("emailFrom"), field("emailTo", { label: "Forward to" }), field("originalFrom", { label: "Original from", placeholder: "original@example.com", type: "email" }), field("emailSubject", { placeholder: "Fwd: Quick update" })] }
      ]
    }
  };

  let activeFamilyId = "signal";
  const selectedByFamily = new Map(Object.entries(families).map(([id, family]) => [id, family.options[0].id]));
  const activeFamily = () => families[activeFamilyId];
  const activeOption = () => activeFamily().options.find((option) => option.id === selectedByFamily.get(activeFamilyId)) || activeFamily().options[0];
  const readJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  const getValue = (selector) => `${$(selector)?.value || ""}`.trim();
  const setFeedback = (message, isError = false) => { if (feedback) { feedback.textContent = message; feedback.classList.toggle("is-error", isError); } };
  const toast = (message) => window.SignalShareToast?.show ? window.SignalShareToast.show(message) : setFeedback(message);

  function syncDark(isDark) {
    overlay?.classList.toggle("is-generic-dark", isDark);
    darkToggle?.setAttribute("aria-pressed", isDark ? "true" : "false");
    darkToggle?.querySelector("span")?.replaceChildren(document.createTextNode(isDark ? "Theme" : "Dark"));
    darkToggle?.querySelector("strong")?.replaceChildren(document.createTextNode(isDark ? "Use current colors" : "Publish overlay"));
  }

  function fieldValues() {
    return (activeOption().fields || []).reduce((values, config) => {
      values[config.key] = `${document.getElementById(config.id)?.value || ""}`.trim();
      return values;
    }, {});
  }

  function draft() {
    const selectedFile = (window.state ?? window.__SIGNAL_SHARE_STATE__)?.selectedFile ?? null;
    const message = [getValue("#titleInput"), getValue("#captionInput"), getValue("#tagsInput") ? `Tags: ${getValue("#tagsInput")}` : "", getValue("#externalUrlInput") ? `Source: ${getValue("#externalUrlInput")}` : ""].filter(Boolean).join("\n\n").trim();
    return { creator: getValue("#creatorInput") || window.getDefaultProfileName?.() || "", title: getValue("#titleInput"), caption: getValue("#captionInput"), tags: getValue("#tagsInput"), externalUrl: getValue("#externalUrlInput"), message, details: fieldValues(), source: selectedFile ? { kind: "file", name: selectedFile.name, type: selectedFile.type, size: selectedFile.size } : { kind: "link" }, file: selectedFile, createdAt: new Date().toISOString() };
  }

  function requireContent(item) {
    if (item.message || item.file) return true;
    setFeedback("Write a title, caption, source link, or choose media first.", true);
    $("#captionInput")?.focus();
    return false;
  }

  const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
  const branch = (value) => String(value || "feature/context-actions").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^\/+|\/+$/g, "") || "feature/context-actions";
  const repoUrl = (value) => {
    const raw = String(value || "").trim();
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://github.com/${raw}`;
    const match = normalized.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/?/i);
    return match ? `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}` : "";
  };

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(value); return true; }
    const temp = document.createElement("textarea");
    temp.value = value;
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    const copied = document.execCommand("copy");
    temp.remove();
    return copied;
  }

  function activity(family, option, item) {
    return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), category: family.title, option: option.name, message: item.message, details: item.details, source: item.source, createdAt: new Date().toISOString() };
  }

  function activities() { return readJson(localStorage.getItem(ACTIVITY_KEY), []); }
  function saveActivity(item) { const items = activities(); items.unshift(item); localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 12))); window.dispatchEvent(new CustomEvent("signal-share:publish-activity", { detail: item })); }
  function downloadJson(payload, fileName) { const name = `${fileName || "signal-share-actions.json"}`.trim(); const finalName = name.toLowerCase().endsWith(".json") ? name : `${name}.json`; const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = finalName; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
  function shareUrl(item) { return item.details.shareUrl || item.details.facebookUrl || item.details.xUrl || item.details.linkedinUrl || item.externalUrl || `${location.origin}${location.pathname}`; }

  async function runAction() {
    const family = activeFamily();
    const option = activeOption();
    const item = draft();
    if (activeFamilyId === "signal") { form.requestSubmit(); return; }
    if (activeFamilyId !== "cloud" && !requireContent(item)) return;
    const record = activity(family, option, item);
    let completed = true;

    try {
      if (activeFamilyId === "local") {
        const isSession = option.id === "sessionStorage";
        const key = isSession ? item.details.sessionKey || "signal-share-publish-session-items" : item.details.localKey || "signal-share-publish-saved-items";
        const storage = isSession ? sessionStorage : localStorage;
        const items = readJson(storage.getItem(key), []);
        items.unshift(record);
        storage.setItem(key, JSON.stringify(items.slice(0, 50)));
        toast(isSession ? "Saved to session storage" : "Saved to local storage");
      } else if (activeFamilyId === "social") {
        if (option.id === "social-facebook") open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl(item))}`, "_blank", "noopener,noreferrer");
        else if (option.id === "social-x") open(`https://twitter.com/intent/tweet?text=${encodeURIComponent([item.details.xHandle, item.message].filter(Boolean).join("\n").slice(0, 260))}&url=${encodeURIComponent(shareUrl(item))}`, "_blank", "noopener,noreferrer");
        else if (option.id === "social-linkedin") open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl(item))}`, "_blank", "noopener,noreferrer");
        else { const kit = [item.details.instagramFrom && `From: ${item.details.instagramFrom}`, item.message, item.details.instagramHashtags].filter(Boolean).join("\n\n"); if (navigator.share) await navigator.share({ title: "Instagram post kit", text: kit }); else await copyText(kit); }
        toast("Social action opened");
      } else if (activeFamilyId === "github") {
        const url = repoUrl(item.details.repoUrl);
        if (!url) { setFeedback("Enter a valid GitHub repository URL.", true); $("#publishTool-repoUrl")?.focus(); return; }
        const base = branch(item.details.baseBranch || "main");
        const head = branch(item.details.branchName || "feature/context-actions");
        if (option.id === "commit") {
          const remote = branch(item.details.remoteName || "origin");
          const repoName = url.split("/").pop();
          const lines = [["git", "clone", `${url}.git`].join(" "), `cd ${repoName}`, ["git", "checkout", base].join(" "), ["git", "pull", remote, base].join(" "), ["git", "checkout", "-b", head].join(" "), ["git", "add", "."].join(" "), ["git", "commit", "-m", quote(item.details.commitMessage || item.message.slice(0, 80) || "feat: publish Signal Share update")].join(" "), ["git", "push", "-u", remote, head].join(" ")];
          await copyText(lines.join("\n"));
          toast("Git clone/commit/push command copied");
        } else if (option.id === "issue") {
          const params = new URLSearchParams({ title: item.details.issueTitle || item.message.slice(0, 90) || "Signal Share publish task", body: item.message });
          if (item.details.issueLabels) params.set("labels", item.details.issueLabels);
          if (item.details.issueAssignees) params.set("assignees", item.details.issueAssignees);
          open(`${url}/issues/new?${params.toString()}`, "_blank", "noopener,noreferrer");
          toast("GitHub issue page opened");
        } else {
          const params = new URLSearchParams({ quick_pull: "1", title: item.details.prTitle || item.message.slice(0, 90) || "Signal Share publish update", body: item.details.prBody || item.message });
          open(`${url}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${params.toString()}`, "_blank", "noopener,noreferrer");
          toast("GitHub PR page opened");
        }
      } else if (activeFamilyId === "cloud") {
        if (option.id === "downloadBackup") { downloadJson({ exportedAt: new Date().toISOString(), label: item.details.backupLabel || "Signal Share publish backup", currentItem: record, recentActivity: activities() }, item.details.backupFileName); toast("JSON backup downloaded"); }
        else if (option.id === "importJson") { const parsed = readJson(item.details.importJson || item.message, null); if (!parsed) { setFeedback("Paste valid JSON into the import field or caption box.", true); return; } const imported = Array.isArray(parsed) ? parsed : parsed.recentActivity || parsed.items || []; if (!Array.isArray(imported)) { setFeedback("JSON must contain an activity array.", true); return; } const existing = item.details.importMode === "append" ? activities() : []; localStorage.setItem(ACTIVITY_KEY, JSON.stringify([...imported, ...existing].slice(0, 20))); toast("Activity imported"); }
        else { if (navigator.share) await navigator.share({ title: item.details.shareTitle || item.title || "Signal Share", text: item.message, url: shareUrl(item) }); else await copyText(item.message); toast("Shared successfully"); }
      } else if (activeFamilyId === "email") {
        const from = item.details.emailFrom || "";
        const to = item.details.emailTo || "";
        const subject = item.details.emailSubject || "Quick update";
        const body = option.id === "forward" ? ["Forwarded message:", item.details.originalFrom && `Original from: ${item.details.originalFrom}`, "", item.message].filter(Boolean).join("\n") : item.message;
        if (option.id === "copyEmail") { await copyText([from && `From: ${from}`, to && `To: ${to}`, item.details.replyTo && `Reply-To: ${item.details.replyTo}`, `Subject: ${subject}`, "", body].filter((line) => line !== false).join("\n")); toast("Email draft copied"); }
        else { const params = new URLSearchParams({ subject, body }); if (item.details.emailCc) params.set("cc", item.details.emailCc); if (from) params.set("from", from); location.href = `mailto:${encodeURIComponent(to)}?${params.toString()}`; toast("Email composer opened"); }
      } else completed = false;
      if (completed) saveActivity(record);
    } catch (error) {
      setFeedback(error?.message || "Something went wrong", true);
    }
  }

  function control(config) {
    if (config.mode === "textarea") {
      const textarea = document.createElement("textarea"); textarea.rows = 4; textarea.value = config.persist ? localStorage.getItem(config.storageKey) || config.value || "" : ""; return textarea;
    }
    if (config.mode === "select") {
      const select = document.createElement("select"); const current = localStorage.getItem(config.storageKey) || config.value || config.options[0]?.[0] || "";
      config.options.forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = value === current; select.append(option); });
      return select;
    }
    const input = document.createElement("input"); input.type = config.type || "text"; input.value = localStorage.getItem(config.storageKey) || config.value || ""; return input;
  }

  function renderFields(option) {
    const fields = option.fields || [];
    dynamicFields.replaceChildren(...fields.map((config) => {
      const label = document.createElement("label"); label.className = "publish-field"; label.setAttribute("for", config.id);
      const text = document.createElement("span"); text.textContent = config.label;
      const input = control(config); input.id = config.id; input.name = config.key; input.placeholder = config.placeholder || "";
      const persist = () => { if (!config.persist) return; input.value ? localStorage.setItem(config.storageKey, input.value) : localStorage.removeItem(config.storageKey); };
      input.addEventListener("input", persist); input.addEventListener("change", persist);
      label.append(text, input); return label;
    }));
    dynamicFields.hidden = fields.length === 0;
  }

  function selectOption(optionId) {
    const family = activeFamily();
    const option = family.options.find((item) => item.id === optionId);
    if (!option) return;
    selectedByFamily.set(activeFamilyId, optionId);
    optionGrid.querySelectorAll("[data-publish-option]").forEach((button) => { const active = button.dataset.publishOption === optionId; button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", active ? "true" : "false"); });
    if (badge) badge.textContent = family.badge;
    if (selectedAction) selectedAction.textContent = option.name;
    if (hint) hint.textContent = option.hint;
    actionButton.textContent = option.button;
    renderFields(option);
    setFeedback("");
  }

  function renderFamily(familyId) {
    if (!families[familyId]) return;
    activeFamilyId = familyId;
    const family = activeFamily();
    if (title) title.textContent = family.title;
    if (copy) copy.textContent = family.copy;
    familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => { const known = Boolean(families[button.dataset.publishFamily]); button.hidden = !known; button.classList.toggle("is-active", button.dataset.publishFamily === familyId); });
    optionGrid.replaceChildren(...family.options.map((option) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "publish-option-tile"; button.dataset.publishOption = option.id; button.setAttribute("aria-pressed", "false");
      const icon = document.createElement("span"); icon.className = "publish-option-icon"; icon.textContent = option.icon;
      const name = document.createElement("strong"); name.textContent = option.name;
      const note = document.createElement("small"); note.textContent = option.note;
      button.append(icon, name, note); button.addEventListener("click", () => selectOption(option.id)); return button;
    }));
    selectOption(selectedByFamily.get(familyId) || family.options[0].id);
  }

  familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => { if (!families[button.dataset.publishFamily]) button.hidden = true; });
  familyGrid.addEventListener("click", (event) => { const button = event.target instanceof Element ? event.target.closest("[data-publish-family]") : null; if (button && families[button.dataset.publishFamily]) renderFamily(button.dataset.publishFamily); });
  actionButton.addEventListener("click", () => void runAction());
  shareButton?.addEventListener("click", () => { const item = draft(); if (!requireContent(item)) return; void shareNative(activity(activeFamily(), { name: "Share sheet" }, item)); });
  darkToggle?.addEventListener("click", () => { const next = !overlay?.classList.contains("is-generic-dark"); syncDark(next); localStorage.setItem(DARK_KEY, next ? "true" : "false"); });

  syncDark(localStorage.getItem(DARK_KEY) === "true");
  renderFamily(activeFamilyId);
  window.SignalSharePublishStudio = { selectFamily: renderFamily, selectOption, runSelectedAction: runAction, getActivity: activities, clearActivity: () => { localStorage.removeItem(ACTIVITY_KEY); toast("Activity cleared"); } };
})();
