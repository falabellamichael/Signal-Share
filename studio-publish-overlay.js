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
  const overlay = $("#compose");
  const darkToggle = $("#publishDarkToggle");
  const legacyRepo = $("#publishGithubRepoField");
  const detailsLabel = Array.from(document.querySelectorAll("#compose .publish-section-label"))
    .find((node) => node.textContent?.toLowerCase().includes("details"));
  const detailsHint = detailsLabel?.querySelector("small");
  const fieldOrganizer = window.SignalSharePublishFieldOrganizer;

  if (!familyGrid || !optionGrid || !actionButton || !form) return;

  const ACTIVITY_KEY = "signal-share-publish-activity";
  const DARK_KEY = "signal-share-publish-generic-dark";
  legacyRepo?.setAttribute("hidden", "");

  const workflowStyle = document.createElement("style");
  workflowStyle.textContent = `
    #compose .publish-details-form.is-tool-mode > .publish-field-grid,
    #compose .publish-details-form.is-tool-mode > .publish-message-field,
    #compose .publish-details-form.is-tool-mode > .field-help,
    #compose .publish-details-form.is-tool-mode > .dropzone {
      display: none !important;
    }
    #compose .publish-dynamic-fields[hidden] {
      display: none !important;
    }
    #compose .publish-dynamic-fields {
      margin-bottom: 12px;
    }
    #compose .publish-dynamic-fields .publish-field.is-wide {
      grid-column: 1 / -1;
    }
    #compose .publish-field select,
    #compose .publish-field textarea {
      width: 100%;
      padding: 13px 14px;
      border: 1px solid var(--publish-border);
      border-radius: 16px;
      color: var(--publish-text);
      background: var(--publish-field);
      font: inherit;
      font-size: 1rem;
      font-weight: 400;
      outline: none;
      transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
    }
    #compose .publish-field textarea {
      min-height: 132px;
      resize: vertical;
      line-height: 1.5;
    }
    #compose .publish-field select:focus,
    #compose .publish-field textarea:focus {
      border-color: color-mix(in srgb, var(--publish-primary) 68%, var(--publish-border));
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--publish-primary) 13%, transparent);
    }
  `;
  document.head.append(workflowStyle);

  const dynamicFields = document.createElement("div");
  dynamicFields.className = "publish-field-grid publish-dynamic-fields";
  dynamicFields.id = "publishDynamicFields";
  form.before(dynamicFields);

  const presets = {
    repoUrl: ["Repository URL", "https://github.com/owner/repo", "url"],
    baseBranch: ["Base branch", "main", "text"],
    branchName: ["New branch", "feature/publish-workflow", "text"],
    commitMessage: ["Commit message", "feat: update publish workflow", "text"],
    filesToStage: ["Files to stage", ".", "text"],
    emailFrom: ["From email", "you@example.com", "email"],
    emailTo: ["To email", "name@example.com", "email"],
    emailSubject: ["Subject", "Project update", "text"],
    body: ["Message body", "Write the message body here", "text"],
    shareUrl: ["Share URL", "https://example.com/page", "url"]
  };

  function field(key, config = {}) {
    const preset = presets[key] || [key, "", "text"];
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
      required: Boolean(config.required),
      wide: Boolean(config.wide || config.mode === "textarea"),
      persist: config.persist !== false,
      storageKey: config.storageKey || `signal-share-publish.${finalKey}`
    };
  }

  const families = {
    signal: {
      badge: "Signal Share",
      title: "Signal Share feed",
      copy: "Create a media post for the Signal Share feed.",
      detailsText: "Feed metadata plus post composer.",
      usesPostComposer: true,
      options: [{
        id: "signal-feed",
        icon: "📣",
        name: "Publish Feed Post",
        note: "Media post",
        button: "Publish post",
        hint: "Uses the existing creator, title, caption, media, and tags feed pipeline.",
        fields: [
          field("audience", { label: "Audience", mode: "select", value: "public", options: [["public", "Public feed"], ["followers", "Followers"], ["private", "Private draft"]] }),
          field("publishNote", { label: "Internal note", placeholder: "Optional note for moderation or routing" })
        ]
      }]
    },
    local: {
      badge: "Local Storage",
      title: "Local Storage",
      copy: "Save a workflow payload in this browser. No media-post fields are required.",
      detailsText: "Storage-specific fields.",
      options: [
        { id: "localStorage", icon: "💾", name: "Local Storage", note: "Persistent key", button: "Save Locally", hint: "Persists a named JSON payload in localStorage.", fields: [field("localKey", { label: "Storage key", value: "signal-share-publish-saved-items", required: true }), field("localLabel", { label: "Save label", placeholder: "Publish workflow draft" }), field("body", { label: "Payload notes", mode: "textarea", placeholder: "What should this local save represent?", wide: true })] },
        { id: "sessionStorage", icon: "📦", name: "Session Storage", note: "Temporary key", button: "Save Session", hint: "Persists a named JSON payload for the current tab session.", fields: [field("sessionKey", { label: "Session key", value: "signal-share-publish-session-items", required: true }), field("sessionLabel", { label: "Session label", placeholder: "Temporary workflow draft" }), field("body", { label: "Session notes", mode: "textarea", placeholder: "What should this session save represent?", wide: true })] }
      ]
    },
    social: {
      badge: "Social",
      title: "Social posting",
      copy: "Save Social drafts or publish through connected provider accounts.",
      detailsText: "Post text, optional links, and provider-specific fields.",
      options: [
        { id: "social-facebook", icon: "📘", name: "Facebook", note: "Text or link", button: "Post to Facebook", hint: "Publishes to the connected Facebook Page without opening Facebook.", fields: [field("shareUrl", { label: "Optional link URL" }), field("body", { label: "Post text", mode: "textarea", placeholder: "Write a Facebook post", wide: true })] },
        { id: "social-instagram", icon: "📸", name: "Instagram", note: "Caption + image", button: "Post to Instagram", hint: "Publishes through Instagram when the draft includes a public image URL.", fields: [field("instagramFrom", { label: "From account", placeholder: "@youraccount" }), field("instagramImageUrl", { label: "Instagram image URL", placeholder: "https://example.com/image.jpg", type: "url" }), field("body", { label: "Caption", mode: "textarea", placeholder: "Instagram caption", required: true, wide: true }), field("instagramHashtags", { label: "Hashtags", placeholder: "#signalshare #media" })] },
        { id: "social-x", icon: "✕", name: "X", note: "Text or link", button: "Post to X", hint: "Publishes to the connected X account without opening X.", fields: [field("xHandle", { label: "From handle", placeholder: "@yourhandle" }), field("body", { label: "Post text", mode: "textarea", placeholder: "Write an X post", required: true, wide: true }), field("shareUrl", { label: "Optional link URL" })] },
        { id: "social-linkedin", icon: "💼", name: "LinkedIn", note: "Text or link", button: "Post to LinkedIn", hint: "Publishes to the connected LinkedIn author without opening LinkedIn.", fields: [field("linkedinFrom", { label: "Profile or company", placeholder: "Signal Share" }), field("shareUrl", { label: "Optional link URL" }), field("body", { label: "Post text", mode: "textarea", placeholder: "Write a LinkedIn post", wide: true })] }
      ]
    },
    github: {
      badge: "GitHub",
      title: "GitHub",
      copy: "Repository actions only. No feed title, tags, caption, media link, or dropzone.",
      detailsText: "Repository workflow fields.",
      options: [
        { id: "commit", icon: "📝", name: "Commit & Push", note: "Clone, branch, commit, push", button: "Copy Git Command", hint: "Generates a command sequence from the repository URL and branch settings.", fields: [field("repoUrl", { required: true }), field("baseBranch", { value: "main", required: true }), field("branchName", { value: "feature/publish-workflow", required: true }), field("remoteName", { label: "Remote name", placeholder: "origin", value: "origin", required: true }), field("filesToStage", { value: ".", required: true }), field("commitMessage", { required: true, wide: true })] },
        { id: "issue", icon: "🐛", name: "Create Issue", note: "Prefilled issue", button: "Open Issue", hint: "Opens a GitHub issue with title, body, labels, and assignees.", fields: [field("repoUrl", { required: true }), field("issueTitle", { label: "Issue title", placeholder: "Describe the issue", required: true }), field("issueLabels", { label: "Labels", placeholder: "bug, publish" }), field("issueAssignees", { label: "Assignees", placeholder: "username1, username2" }), field("issueBody", { label: "Issue body", mode: "textarea", placeholder: "Steps, expected result, actual result, notes", required: true, wide: true })] },
        { id: "pullRequest", icon: "🤝", name: "Pull Request", note: "Compare route", button: "Open PR", hint: "Opens a GitHub compare route with base/head branches and PR content.", fields: [field("repoUrl", { required: true }), field("baseBranch", { value: "main", required: true }), field("branchName", { value: "feature/publish-workflow", required: true }), field("prTitle", { label: "PR title", placeholder: "Describe the change", required: true }), field("prDraft", { label: "PR mode", mode: "select", value: "ready", options: [["ready", "Ready for review"], ["draft", "Draft PR"]] }), field("prBody", { label: "PR body", mode: "textarea", placeholder: "Summary, test plan, screenshots, risks", required: true, wide: true })] }
      ]
    },
    cloud: {
      badge: "Cloud Sync",
      title: "Cloud Sync",
      copy: "Export, import, or share workflow payloads with realistic fields.",
      detailsText: "Cloud handoff fields.",
      options: [
        { id: "downloadBackup", icon: "⬇️", name: "Download Backup", note: "JSON export", button: "Download JSON", hint: "Downloads a named JSON backup.", fields: [field("backupFileName", { label: "Backup file name", value: `signal-share-actions-${new Date().toISOString().slice(0, 10)}.json`, required: true }), field("backupLabel", { label: "Backup label", placeholder: "Publish overlay backup" }), field("body", { label: "Backup notes", mode: "textarea", placeholder: "Optional backup notes", wide: true })] },
        { id: "importJson", icon: "⬆️", name: "Import JSON", note: "JSON import", button: "Import JSON", hint: "Imports from the JSON field below.", fields: [field("importJson", { label: "JSON backup payload", placeholder: "Paste exported JSON here", mode: "textarea", persist: false, required: true, wide: true }), field("importMode", { label: "Import mode", mode: "select", value: "replace", options: [["replace", "Replace activity"], ["append", "Append activity"]] })] },
        { id: "share", icon: "📤", name: "Share", note: "Native share", button: "Share Now", hint: "Uses the native share sheet with title, text, and URL.", fields: [field("shareTitle", { label: "Share title", placeholder: "Signal Share workflow" }), field("shareUrl"), field("body", { label: "Share text", mode: "textarea", placeholder: "Text to share", required: true, wide: true })] }
      ]
    },
    email: {
      badge: "Email",
      title: "Email",
      copy: "Email actions use email fields only. No media-post fields.",
      detailsText: "Email routing and body fields.",
      options: [
        { id: "sendEmail", icon: "✉️", name: "Send Email", note: "Compose email", button: "Compose Email", hint: "Composes with From, To, CC, BCC, subject, and body.", fields: [field("emailFrom", { required: true }), field("emailTo", { required: true }), field("emailCc", { label: "CC email", placeholder: "cc@example.com", type: "email" }), field("emailBcc", { label: "BCC email", placeholder: "bcc@example.com", type: "email" }), field("emailSubject", { required: true, wide: true }), field("emailBody", { label: "Email body", mode: "textarea", placeholder: "Write the email body", required: true, wide: true })] },
        { id: "copyEmail", icon: "📋", name: "Copy Email", note: "Copy draft", button: "Copy Draft", hint: "Copies a complete email draft with From, To, Reply-To, subject, and body.", fields: [field("emailFrom", { required: true }), field("emailTo", { required: true }), field("replyTo", { label: "Reply-To email", placeholder: "reply@example.com", type: "email" }), field("emailSubject", { required: true, wide: true }), field("emailBody", { label: "Email body", mode: "textarea", placeholder: "Write the email body", required: true, wide: true })] },
        { id: "forward", icon: "↪️", name: "Forward Message", note: "Forward format", button: "Compose Forward", hint: "Creates a forwarded-message draft with From, Forward To, Original From, subject, and body.", fields: [field("emailFrom", { required: true }), field("emailTo", { label: "Forward to", required: true }), field("originalFrom", { label: "Original from", placeholder: "original@example.com", type: "email" }), field("emailSubject", { placeholder: "Fwd: Project update", required: true, wide: true }), field("emailBody", { label: "Forwarded message body", mode: "textarea", placeholder: "Message being forwarded", required: true, wide: true })] }
      ]
    }
  };

  let activeFamilyId = "signal";
  const selectedByFamily = new Map(Object.entries(families).map(([familyId, family]) => [familyId, new Set([family.options[0].id])]));
  const readJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
  const getValue = (selector) => `${$(selector)?.value || ""}`.trim();
  const activeFamily = () => families[activeFamilyId];
  const selectedOptions = () => {
    const family = activeFamily();
    const selectedIds = selectedByFamily.get(activeFamilyId) || new Set();
    const options = family.options.filter((option) => selectedIds.has(option.id));
    if (options.length) return options;
    const fallback = family.options[0];
    selectedByFamily.set(activeFamilyId, new Set([fallback.id]));
    return [fallback];
  };
  const activeOption = () => selectedOptions()[0];
  const setFeedback = (message, isError = false) => { if (feedback) { feedback.textContent = message; feedback.classList.toggle("is-error", isError); } };
  const toast = (message) => window.SignalShareToast?.show ? window.SignalShareToast.show(message) : setFeedback(message);

  function syncDark(isDark) {
    overlay?.classList.toggle("is-generic-dark", isDark);
    darkToggle?.setAttribute("aria-pressed", isDark ? "true" : "false");
    darkToggle?.querySelector("span")?.replaceChildren(document.createTextNode(isDark ? "Theme" : "Dark"));
    darkToggle?.querySelector("strong")?.replaceChildren(document.createTextNode(isDark ? "Use current colors" : "Publish overlay"));
  }

  function selectedFields() {
    const options = selectedOptions();
    if (fieldOrganizer?.getFields) return fieldOrganizer.getFields(activeFamilyId, options, field);
    return options.flatMap((option) => option.fields || []);
  }

  function fieldValues() {
    return selectedFields().reduce((values, config) => {
      const input = document.getElementById(config.id);
      values[config.key] = input ? `${input.value || ""}`.trim() : "";
      return values;
    }, {});
  }

  function signalDraft() {
    const selectedFile = (window.state ?? window.__SIGNAL_SHARE_STATE__)?.selectedFile ?? null;
    const message = [
      getValue("#titleInput"),
      getValue("#captionInput"),
      getValue("#tagsInput") ? `Tags: ${getValue("#tagsInput")}` : "",
      getValue("#externalUrlInput") ? `Source: ${getValue("#externalUrlInput")}` : ""
    ].filter(Boolean).join("\n\n").trim();
    return {
      creator: getValue("#creatorInput") || window.getDefaultProfileName?.() || "",
      title: getValue("#titleInput"),
      caption: getValue("#captionInput"),
      tags: getValue("#tagsInput"),
      externalUrl: getValue("#externalUrlInput"),
      message,
      details: fieldValues(),
      source: selectedFile ? { kind: "file", name: selectedFile.name, type: selectedFile.type, size: selectedFile.size } : { kind: "link" },
      file: selectedFile,
      createdAt: new Date().toISOString()
    };
  }

  function workflowDraft() {
    const details = fieldValues();
    const message = details.body || details.emailBody || details.issueBody || details.prBody || details.commitMessage || details.backupLabel || details.localLabel || details.sessionLabel || "";
    return { message, details, createdAt: new Date().toISOString() };
  }

  function draft() {
    return activeFamily()?.usesPostComposer ? signalDraft() : workflowDraft();
  }

  function validateFields() {
    const details = fieldValues();
    const missing = selectedFields().find((config) => config.required && !details[config.key]);
    if (!missing) return true;
    setFeedback(`${missing.label} is required.`, true);
    document.getElementById(missing.id)?.focus();
    return false;
  }

  const quote = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`;
  const branch = (value) => String(value || "feature/publish-workflow").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._/-]/g, "").replace(/^\/+|\/+$/g, "") || "feature/publish-workflow";
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

  function activities() { return readJson(localStorage.getItem(ACTIVITY_KEY), []); }
  function saveActivity(record) {
    const items = activities();
    items.unshift(record);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 12)));
    window.dispatchEvent(new CustomEvent("signal-share:publish-activity", { detail: record }));
  }
  function activity(family, option, item) {
    return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), category: family.title, option: option.name, message: item.message, details: item.details, source: item.source || { kind: "workflow" }, createdAt: new Date().toISOString() };
  }
  function selectedActivityOption(options) {
    if (options.length === 1) return options[0];
    return { name: options.map((option) => option.name).join(", ") };
  }
  function socialDeliveryMode() {
    return document.getElementById("publishTool-socialDeliveryMode")?.value || "direct";
  }
  function syncActionButtonLabel() {
    const family = activeFamily();
    const options = selectedOptions();
    const isSocialDraft = activeFamilyId === "social" && socialDeliveryMode() === "draft";
    actionButton.textContent = isSocialDraft
      ? options.length === 1 ? `Save ${options[0].name} draft` : `Save ${options.length} Social drafts`
      : options.length === 1 ? options[0].button : `Run ${options.length} ${family.badge} actions`;
    if (!hint) return;
    hint.textContent = isSocialDraft
      ? options.length === 1
        ? `Saves a ${options[0].name} draft without publishing it.`
        : `Saves drafts for ${options.map((option) => option.name).join(", ")} without publishing them.`
      : options.length === 1
        ? options[0].hint
        : `Shared fields are organized for ${options.map((option) => option.name).join(", ")}.`;
  }
  function downloadJson(payload, fileName) {
    const name = `${fileName || "signal-share-actions.json"}`.trim();
    const finalName = name.toLowerCase().endsWith(".json") ? name : `${name}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = finalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function shareUrl(item) { return item.details.shareUrl || item.details.facebookUrl || item.externalUrl || `${location.origin}${location.pathname}`; }
  function socialPublishFunctionName() {
    return `${window.SIGNAL_SHARE_CONFIG?.socialPublishFunctionName || "social-publish"}`.trim() || "social-publish";
  }
  function socialProviderId(option) {
    return `${option?.id || ""}`.replace(/^social-/, "");
  }
  function socialPublishErrorMessage(error, data) {
    return data?.error || error?.context?.error || error?.message || "Direct Social publishing failed.";
  }
  async function publishSocialOptions(options, item) {
    const appState = window.state ?? window.__SIGNAL_SHARE_STATE__;
    if (!appState?.supabase || appState.backendMode !== "supabase" || !appState.currentUser) {
      throw new Error("Sign in before posting directly to connected Social providers.");
    }

    const { data, error } = await appState.supabase.functions.invoke(socialPublishFunctionName(), {
      body: {
        providers: options.map(socialProviderId).filter(Boolean),
        text: item.details.body || "",
        linkUrl: item.details.shareUrl || "",
        instagramImageUrl: item.details.instagramImageUrl || "",
        instagramHashtags: item.details.instagramHashtags || "",
      },
    });

    if (error || data?.error) {
      throw new Error(socialPublishErrorMessage(error, data));
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const failed = results.filter((result) => !result?.ok);
    if (failed.length) {
      throw new Error(failed.map((result) => `${result.provider}: ${result.error || "publish failed"}`).join(" "));
    }

    return results;
  }

  async function runAction() {
    const family = activeFamily();
    const options = selectedOptions();
    const option = options[0];
    const item = draft();
    if (family.usesPostComposer) { form.requestSubmit(); return; }
    if (!validateFields()) return;
    const record = activity(family, selectedActivityOption(options), item);
    let completed = true;
    let activitySaved = false;

    try {
      if (activeFamilyId === "local") {
        const isSession = option.id === "sessionStorage";
        const key = isSession ? item.details.sessionKey : item.details.localKey;
        const storage = isSession ? sessionStorage : localStorage;
        const items = readJson(storage.getItem(key), []);
        items.unshift(record);
        storage.setItem(key, JSON.stringify(items.slice(0, 50)));
        toast(isSession ? "Saved to session storage" : "Saved to local storage");
      } else if (activeFamilyId === "social") {
        if (item.details.socialDeliveryMode === "draft") {
          toast(options.length === 1 ? "Social draft saved" : `${options.length} Social drafts saved`);
        } else {
          saveActivity(record);
          activitySaved = true;
          await publishSocialOptions(options, item);
          toast(options.length === 1 ? "Social draft posted" : `${options.length} Social drafts posted`);
        }
      } else if (activeFamilyId === "github") {
        const url = repoUrl(item.details.repoUrl);
        if (!url) { setFeedback("Enter a valid GitHub repository URL.", true); $("#publishTool-repoUrl")?.focus(); return; }
        const base = branch(item.details.baseBranch || "main");
        const head = branch(item.details.branchName || "feature/publish-workflow");
        if (option.id === "commit") {
          const remote = branch(item.details.remoteName || "origin");
          const repoName = url.split("/").pop();
          const files = item.details.filesToStage || ".";
          const lines = [
            `git clone ${url}.git`,
            `cd ${repoName}`,
            `git checkout ${base}`,
            `git pull ${remote} ${base}`,
            `git checkout -b ${head}`,
            `git add ${files}`,
            `git commit -m ${quote(item.details.commitMessage)}`,
            `git push -u ${remote} ${head}`
          ];
          await copyText(lines.join("\n"));
          toast("Git clone/commit/push command copied");
        } else if (option.id === "issue") {
          const params = new URLSearchParams({ title: item.details.issueTitle, body: item.details.issueBody });
          if (item.details.issueLabels) params.set("labels", item.details.issueLabels);
          if (item.details.issueAssignees) params.set("assignees", item.details.issueAssignees);
          window.open(`${url}/issues/new?${params.toString()}`, "_blank", "noopener,noreferrer");
          toast("GitHub issue page opened");
        } else {
          const params = new URLSearchParams({ quick_pull: "1", title: item.details.prTitle, body: item.details.prBody });
          if (item.details.prDraft === "draft") params.set("draft", "1");
          window.open(`${url}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?${params.toString()}`, "_blank", "noopener,noreferrer");
          toast("GitHub PR page opened");
        }
      } else if (activeFamilyId === "cloud") {
        if (option.id === "downloadBackup") {
          downloadJson({ exportedAt: new Date().toISOString(), label: item.details.backupLabel || "Signal Share workflow backup", currentItem: record, recentActivity: activities() }, item.details.backupFileName);
          toast("JSON backup downloaded");
        } else if (option.id === "importJson") {
          const parsed = readJson(item.details.importJson, null);
          if (!parsed) { setFeedback("Paste valid JSON into the import field.", true); return; }
          const imported = Array.isArray(parsed) ? parsed : parsed.recentActivity || parsed.items || [];
          if (!Array.isArray(imported)) { setFeedback("JSON must contain an activity array.", true); return; }
          const existing = item.details.importMode === "append" ? activities() : [];
          localStorage.setItem(ACTIVITY_KEY, JSON.stringify([...imported, ...existing].slice(0, 20)));
          toast("Activity imported");
        } else {
          if (navigator.share) await navigator.share({ title: item.details.shareTitle || "Signal Share workflow", text: item.details.body, url: shareUrl(item) });
          else await copyText([item.details.shareTitle, item.details.body, shareUrl(item)].filter(Boolean).join("\n\n"));
          toast("Share payload prepared");
        }
      } else if (activeFamilyId === "email") {
        const from = item.details.emailFrom || "";
        const to = item.details.emailTo || "";
        const subject = item.details.emailSubject || "Project update";
        const body = option.id === "forward"
          ? ["Forwarded message:", item.details.originalFrom && `Original from: ${item.details.originalFrom}`, "", item.details.emailBody].filter(Boolean).join("\n")
          : item.details.emailBody;
        if (option.id === "copyEmail") {
          await copyText([from && `From: ${from}`, to && `To: ${to}`, item.details.replyTo && `Reply-To: ${item.details.replyTo}`, `Subject: ${subject}`, "", body].filter((line) => line !== false).join("\n"));
          toast("Email draft copied");
        } else {
          const params = new URLSearchParams({ subject, body: [from && `From: ${from}`, body].filter(Boolean).join("\n\n") });
          if (item.details.emailCc) params.set("cc", item.details.emailCc);
          if (item.details.emailBcc) params.set("bcc", item.details.emailBcc);
          location.href = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
          toast("Email composer opened");
        }
      } else completed = false;

      if (completed && !activitySaved) saveActivity(record);
    } catch (error) {
      setFeedback(error?.message || "Something went wrong", true);
    }
  }

  function createControl(config) {
    if (config.mode === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.value = config.persist ? localStorage.getItem(config.storageKey) || config.value || "" : "";
      return textarea;
    }
    if (config.mode === "select") {
      const select = document.createElement("select");
      const current = localStorage.getItem(config.storageKey) || config.value || config.options[0]?.[0] || "";
      config.options.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === current;
        select.append(option);
      });
      return select;
    }
    const input = document.createElement("input");
    input.type = config.type || "text";
    input.value = localStorage.getItem(config.storageKey) || config.value || "";
    return input;
  }

  function renderFields(fields) {
    dynamicFields.replaceChildren(...fields.map((config) => {
      const label = document.createElement("label");
      label.className = `publish-field${config.wide ? " is-wide" : ""}`;
      label.setAttribute("for", config.id);
      const text = document.createElement("span");
      text.textContent = config.required ? `${config.label} *` : config.label;
      const input = createControl(config);
      input.id = config.id;
      input.name = config.key;
      input.placeholder = config.placeholder || "";
      const persist = () => {
        if (!config.persist) return;
        input.value ? localStorage.setItem(config.storageKey, input.value) : localStorage.removeItem(config.storageKey);
      };
      const syncField = () => {
        persist();
        if (config.key === "socialDeliveryMode") syncActionButtonLabel();
      };
      input.addEventListener("input", syncField);
      input.addEventListener("change", syncField);
      label.append(text, input);
      return label;
    }));
    dynamicFields.hidden = fields.length === 0;
  }

  function syncSelectedOptions() {
    const family = activeFamily();
    const options = selectedOptions();
    const selectedIds = new Set(options.map((option) => option.id));
    optionGrid.querySelectorAll("[data-publish-option]").forEach((button) => {
      const active = selectedIds.has(button.dataset.publishOption);
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (badge) badge.textContent = family.badge;
    if (selectedAction) selectedAction.textContent = options.length === 1 ? options[0].name : `${options.length} ${family.badge} options`;
    if (detailsHint) {
      detailsHint.textContent = fieldOrganizer?.getDetailsText?.(activeFamilyId, options, family.detailsText)
        || family.detailsText
        || "Action-specific fields.";
    }
    form.classList.toggle("is-tool-mode", !family.usesPostComposer);
    renderFields(selectedFields());
    syncActionButtonLabel();
  }

  function selectOption(optionId) {
    const family = activeFamily();
    if (!family.options.some((item) => item.id === optionId)) return;
    const selectedIds = selectedByFamily.get(activeFamilyId) || new Set();

    if (activeFamilyId === "social") {
      if (selectedIds.has(optionId)) {
        if (selectedIds.size === 1) {
          setFeedback("Keep at least one social option selected.", true);
          return;
        }
        selectedIds.delete(optionId);
      } else {
        selectedIds.add(optionId);
      }
    } else {
      selectedIds.clear();
      selectedIds.add(optionId);
    }

    selectedByFamily.set(activeFamilyId, selectedIds);
    syncSelectedOptions();
    setFeedback("");
  }

  function renderFamily(familyId) {
    if (!families[familyId]) return;
    activeFamilyId = familyId;
    const family = activeFamily();
    if (title) title.textContent = family.title;
    if (copy) copy.textContent = family.copy;
    familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => {
      const known = Boolean(families[button.dataset.publishFamily]);
      button.hidden = !known;
      button.classList.toggle("is-active", button.dataset.publishFamily === familyId);
    });
    optionGrid.replaceChildren(...family.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "publish-option-tile";
      button.dataset.publishOption = option.id;
      button.setAttribute("aria-pressed", "false");
      const icon = document.createElement("span");
      icon.className = "publish-option-icon";
      icon.textContent = option.icon;
      const name = document.createElement("strong");
      name.textContent = option.name;
      const note = document.createElement("small");
      note.textContent = option.note;
      button.append(icon, name, note);
      button.addEventListener("click", () => selectOption(option.id));
      return button;
    }));
    syncSelectedOptions();
  }

  familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => { if (!families[button.dataset.publishFamily]) button.hidden = true; });
  familyGrid.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-publish-family]") : null;
    if (button && families[button.dataset.publishFamily]) renderFamily(button.dataset.publishFamily);
  });
  actionButton.addEventListener("click", () => void runAction());
  shareButton?.addEventListener("click", () => {
    const item = draft();
    if (!validateFields()) return;
    void (navigator.share
      ? navigator.share({ title: item.details.shareTitle || activeOption().name, text: item.message, url: shareUrl(item) })
      : copyText([item.message, shareUrl(item)].filter(Boolean).join("\n\n")));
  });
  darkToggle?.addEventListener("click", () => {
    const next = !overlay?.classList.contains("is-generic-dark");
    syncDark(next);
    localStorage.setItem(DARK_KEY, next ? "true" : "false");
  });

  syncDark(localStorage.getItem(DARK_KEY) === "true");
  renderFamily(activeFamilyId);
  window.SignalSharePublishStudio = {
    selectFamily: renderFamily,
    selectOption,
    runSelectedAction: runAction,
    getActivity: activities,
    clearActivity: () => { localStorage.removeItem(ACTIVITY_KEY); toast("Activity cleared"); }
  };
})();
