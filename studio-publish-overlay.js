(() => {
  const familyGrid = document.querySelector("#publishFamilyGrid");
  const optionGrid = document.querySelector("#publishOptionGrid");
  const title = document.querySelector("#publishDestinationTitle");
  const copy = document.querySelector("#publishDestinationCopy");
  const selectedBadge = document.querySelector("#publishSelectedBadge");
  const selectedAction = document.querySelector("#publishSelectedAction");
  const selectedHint = document.querySelector("#publishSelectedHint");
  const actionButton = document.querySelector("#publishStudioActionButton");
  const shareSheetButton = document.querySelector("#publishShareSheetButton");
  const feedback = document.querySelector("#publishDestinationFeedback");
  const postForm = document.querySelector("#postForm");
  const mediaInput = document.querySelector("#mediaInput");
  const publishOverlay = document.querySelector("#compose");
  const darkToggle = document.querySelector("#publishDarkToggle");
  const legacyGithubRepoField = document.querySelector("#publishGithubRepoField");

  const ACTIVITY_KEY = "signal-share-publish-activity";
  const LOCAL_ITEMS_KEY = "signal-share-publish-saved-items";
  const SESSION_ITEMS_KEY = "signal-share-publish-session-items";
  const DARK_MODE_KEY = "signal-share-publish-generic-dark";

  if (!familyGrid || !optionGrid || !actionButton || !postForm) return;

  legacyGithubRepoField?.setAttribute("hidden", "");

  const dynamicFields = document.createElement("div");
  dynamicFields.className = "publish-field-grid publish-dynamic-fields";
  dynamicFields.id = "publishDynamicFields";
  postForm.before(dynamicFields);

  const families = {
    signal: {
      badge: "Signal Share",
      title: "Signal Share feed",
      copy: "Create a post for the feed with the media source below.",
      fields: [],
      options: [
        {
          id: "signal-feed",
          icon: "📣",
          name: "Publish Feed Post",
          note: "Use the live feed flow",
          button: "Publish post",
          hint: "Submits the current creator, title, caption, media, and tags through the existing Signal Share publish pipeline.",
        },
      ],
    },
    local: {
      badge: "Local Storage",
      title: "Local Storage",
      copy: "Pick where the browser should store this publish message. Persistent local storage survives reloads; session storage lasts until the tab closes.",
      fields: [],
      options: [
        {
          id: "localStorage",
          icon: "💾",
          name: "Local Storage",
          note: "Persists in this browser",
          button: "Save Locally",
          hint: "Saves the publish message to localStorage and logs it in Recent activity.",
        },
        {
          id: "sessionStorage",
          icon: "📦",
          name: "Session Storage",
          note: "Clears when tab closes",
          button: "Save Session",
          hint: "Saves the publish message to sessionStorage for this tab only.",
        },
      ],
    },
    github: {
      badge: "GitHub",
      title: "GitHub",
      copy: "Configure a repository URL, then generate GitHub actions. Issue and PR options open GitHub pages; commit copies a ready-to-run command.",
      fields: [
        {
          id: "publishRepoUrlInput",
          key: "repoUrl",
          label: "GitHub repository URL",
          placeholder: "https://github.com/owner/repo",
          storageKey: "signal-share-publish.repoUrl",
          type: "url",
        },
        {
          id: "publishBranchNameInput",
          key: "branchName",
          label: "Branch name",
          placeholder: "feature/context-actions",
          storageKey: "signal-share-publish.branchName",
          type: "text",
        },
      ],
      options: [
        {
          id: "commit",
          icon: "📝",
          name: "Commit & Push",
          note: "Copy a git command",
          button: "Copy Git Command",
          hint: "Copies a safe git command using your publish message as the commit message.",
        },
        {
          id: "issue",
          icon: "🐛",
          name: "Create Issue",
          note: "Open new issue page",
          button: "Open Issue",
          hint: "Opens the configured repo issue page with title and body prefilled.",
        },
        {
          id: "pullRequest",
          icon: "🤝",
          name: "Pull Request",
          note: "Open compare page",
          button: "Open PR",
          hint: "Opens the configured repo compare page. Add branch details below.",
        },
      ],
    },
    cloud: {
      badge: "Cloud Sync",
      title: "Cloud Sync",
      copy: "Browser-only pages cannot silently write to private cloud accounts, so these actions use real browser capabilities: download, import, and native share.",
      fields: [],
      options: [
        {
          id: "downloadBackup",
          icon: "⬇️",
          name: "Download Backup",
          note: "Create JSON file",
          button: "Download JSON",
          hint: "Downloads the current publish message and recent activity as a JSON file.",
        },
        {
          id: "importJson",
          icon: "⬆️",
          name: "Import JSON",
          note: "Load backup text",
          button: "Import JSON",
          hint: "Paste a JSON backup into the caption box to import activity entries.",
        },
        {
          id: "share",
          icon: "📤",
          name: "Share",
          note: "Use native share",
          button: "Share Now",
          hint: "Uses the Web Share API when available, otherwise copies the publish message.",
        },
      ],
    },
    email: {
      badge: "Email",
      title: "Email",
      copy: "Enter recipient and subject details, then open your default mail app with the content filled in.",
      fields: [
        {
          id: "publishEmailToInput",
          key: "emailTo",
          label: "Recipient email",
          placeholder: "name@example.com",
          storageKey: "signal-share-publish.emailTo",
          type: "email",
        },
        {
          id: "publishEmailSubjectInput",
          key: "emailSubject",
          label: "Subject",
          placeholder: "Quick update",
          storageKey: "signal-share-publish.emailSubject",
          type: "text",
        },
      ],
      options: [
        {
          id: "sendEmail",
          icon: "✉️",
          name: "Send Email",
          note: "Open mail app",
          button: "Compose Email",
          hint: "Opens a mailto draft with recipient, subject, and body.",
        },
        {
          id: "copyEmail",
          icon: "📋",
          name: "Copy Email",
          note: "Copy draft",
          button: "Copy Draft",
          hint: "Copies a clean email draft to your clipboard.",
        },
        {
          id: "forward",
          icon: "↪️",
          name: "Forward Message",
          note: "Forward format",
          button: "Compose Forward",
          hint: "Opens a mailto draft formatted as a forwarded message.",
        },
      ],
    },
  };

  let activeFamilyId = families.signal ? "signal" : "local";
  const selectedOptionByFamily = new Map(
    Object.entries(families).map(([familyId, family]) => [familyId, family.options[0].id]),
  );

  function readJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeFeedback(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
  }

  function showToast(message) {
    if (window.SignalShareToast?.show) {
      window.SignalShareToast.show(message);
      return;
    }
    writeFeedback(message);
  }

  function syncPublishDarkMode(isDark) {
    publishOverlay?.classList.toggle("is-generic-dark", isDark);
    darkToggle?.setAttribute("aria-pressed", isDark ? "true" : "false");
    darkToggle?.querySelector("span")?.replaceChildren(document.createTextNode(isDark ? "Theme" : "Dark"));
    darkToggle?.querySelector("strong")?.replaceChildren(
      document.createTextNode(isDark ? "Use current colors" : "Publish overlay"),
    );
  }

  function getValue(selector) {
    return `${document.querySelector(selector)?.value || ""}`.trim();
  }

  function getFieldValues(family) {
    return family.fields.reduce((values, field) => {
      const input = document.getElementById(field.id);
      values[field.key] = input ? `${input.value || ""}`.trim() : "";
      return values;
    }, {});
  }

  function getState() {
    return window.state ?? window.__SIGNAL_SHARE_STATE__ ?? null;
  }

  function getMessage() {
    const titleValue = getValue("#titleInput");
    const captionValue = getValue("#captionInput");
    const tagsValue = getValue("#tagsInput");
    const sourceValue = getValue("#externalUrlInput");
    const parts = [];
    if (titleValue) parts.push(titleValue);
    if (captionValue) parts.push(captionValue);
    if (tagsValue) parts.push(`Tags: ${tagsValue}`);
    if (sourceValue) parts.push(`Source: ${sourceValue}`);
    return parts.join("\n\n").trim();
  }

  function getDraft() {
    const selectedFile = getState()?.selectedFile ?? null;
    const family = families[activeFamilyId];
    const message = getMessage();
    return {
      creator: getValue("#creatorInput") || window.getDefaultProfileName?.() || "",
      title: getValue("#titleInput"),
      caption: getValue("#captionInput"),
      tags: getValue("#tagsInput"),
      externalUrl: getValue("#externalUrlInput"),
      message,
      details: getFieldValues(family),
      source: selectedFile
        ? {
            kind: "file",
            name: selectedFile.name,
            type: selectedFile.type,
            size: selectedFile.size,
          }
        : {
            kind: "link",
          },
      file: selectedFile,
      createdAt: new Date().toISOString(),
    };
  }

  function getShareUrl(draft) {
    return draft.externalUrl || `${window.location.origin}${window.location.pathname}`;
  }

  function getActivity() {
    return readJson(localStorage.getItem(ACTIVITY_KEY), []);
  }

  function saveActivity(activity) {
    const items = getActivity();
    items.unshift(activity);
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 12)));
    window.dispatchEvent(new CustomEvent("signal-share:publish-activity", { detail: activity }));
  }

  function getActivityForExport() {
    return getActivity();
  }

  function makeActivity(family, option, draft) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      category: family.title,
      option: option.name,
      message: draft.message,
      details: draft.details,
      source: draft.source,
      createdAt: new Date().toISOString(),
    };
  }

  function requireMessage(draft) {
    if (draft.message || draft.file) return true;
    writeFeedback("Write a title, caption, source link, or choose media first.", true);
    document.querySelector("#captionInput")?.focus();
    return false;
  }

  function escapeShell(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");
  }

  function sanitizeBranchName(value) {
    return String(value || "feature/context-actions")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._/-]/g, "")
      .replace(/^\/+|\/+$/g, "") || "feature/context-actions";
  }

  function normalizeGithubRepoUrl(value) {
    const raw = String(value || "").trim();
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://github.com/${raw}`;
    const match = normalized.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/?/i);
    if (!match) return "";
    return `https://github.com/${match[1]}/${match[2].replace(/\.git$/i, "")}`;
  }

  function getGithubRepoOrWarn(details) {
    const repoUrl = normalizeGithubRepoUrl(details.repoUrl);
    if (repoUrl) return repoUrl;
    writeFeedback("Enter a valid GitHub repository URL.", true);
    document.getElementById("publishRepoUrlInput")?.focus();
    return "";
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
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

  function downloadJson(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function persistAction(storage, key, activity, limit = 50) {
    const items = readJson(storage.getItem(key), []);
    items.unshift(activity);
    storage.setItem(key, JSON.stringify(items.slice(0, limit)));
  }

  async function shareNative(activity) {
    if (navigator.share) {
      await navigator.share({
        title: activity.message.split("\n")[0] || "Signal Share publish action",
        text: activity.message,
        url: activity.details?.externalUrl || undefined,
      });
      showToast("Shared successfully");
      return;
    }
    await copyText(activity.message);
    showToast("Sharing unavailable; message copied");
  }

  async function runLocalAction(activity, optionId) {
    const isSession = optionId === "sessionStorage";
    persistAction(isSession ? sessionStorage : localStorage, isSession ? SESSION_ITEMS_KEY : LOCAL_ITEMS_KEY, activity);
    showToast(isSession ? "Saved to session storage" : "Saved to local storage");
  }

  async function runGithubAction(activity, optionId) {
    const repoUrl = getGithubRepoOrWarn(activity.details);
    if (!repoUrl) return false;

    const branchName = sanitizeBranchName(activity.details.branchName || "feature/context-actions");
    if (optionId === "commit") {
      const command = `git checkout -b ${branchName}\ngit add .\ngit commit -m "${escapeShell(activity.message.slice(0, 80))}"\ngit push -u origin ${branchName}`;
      await copyText(command);
      showToast("Git command copied");
      return true;
    }

    if (optionId === "issue") {
      const url = `${repoUrl}/issues/new?title=${encodeURIComponent(activity.message.slice(0, 90))}&body=${encodeURIComponent(activity.message)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      showToast("GitHub issue page opened");
      return true;
    }

    if (optionId === "pullRequest") {
      const url = `${repoUrl}/compare/main...${encodeURIComponent(branchName)}?quick_pull=1&title=${encodeURIComponent(activity.message.slice(0, 90))}&body=${encodeURIComponent(activity.message)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      showToast("GitHub PR page opened");
      return true;
    }
    return false;
  }

  async function runCloudAction(activity, optionId) {
    if (optionId === "downloadBackup") {
      downloadJson({
        exportedAt: new Date().toISOString(),
        currentItem: activity,
        recentActivity: getActivityForExport(),
      }, `signal-share-actions-${new Date().toISOString().slice(0, 10)}.json`);
      showToast("JSON backup downloaded");
      return true;
    }

    if (optionId === "importJson") {
      const parsed = readJson(activity.message, null);
      if (!parsed) {
        writeFeedback("Paste valid JSON into the caption box.", true);
        return false;
      }
      const imported = Array.isArray(parsed) ? parsed : parsed.recentActivity || parsed.items || [];
      if (!Array.isArray(imported)) {
        writeFeedback("JSON must contain an activity array.", true);
        return false;
      }
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(imported.slice(0, 20)));
      showToast("Activity imported");
      return true;
    }

    if (optionId === "share") {
      await shareNative(activity);
      return true;
    }
    return false;
  }

  async function runEmailAction(activity, optionId) {
    const to = activity.details.emailTo || "";
    const subject = activity.details.emailSubject || "Quick update";
    const body = optionId === "forward"
      ? `Forwarded message:\n\n${activity.message}`
      : activity.message;

    if (optionId === "copyEmail") {
      await copyText(`To: ${to}\nSubject: ${subject}\n\n${body}`);
      showToast("Email draft copied");
      return true;
    }

    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    showToast("Email composer opened");
    return true;
  }

  async function runSelectedAction() {
    const family = families[activeFamilyId];
    const optionId = selectedOptionByFamily.get(activeFamilyId) || family.options[0].id;
    const option = family.options.find((item) => item.id === optionId) || family.options[0];
    const draft = getDraft();

    if (activeFamilyId === "signal") {
      postForm.requestSubmit();
      return;
    }

    if (!requireMessage(draft)) return;

    const activity = makeActivity(family, option, draft);
    let completed = false;

    try {
      if (activeFamilyId === "local") {
        await runLocalAction(activity, option.id);
        completed = true;
      } else if (activeFamilyId === "github") {
        completed = await runGithubAction(activity, option.id);
      } else if (activeFamilyId === "cloud") {
        completed = await runCloudAction(activity, option.id);
      } else if (activeFamilyId === "email") {
        completed = await runEmailAction(activity, option.id);
      }

      if (completed) {
        saveActivity(activity);
      }
    } catch (error) {
      writeFeedback(error?.message || "Something went wrong", true);
    }
  }

  function renderFields(family) {
    dynamicFields.replaceChildren(...family.fields.map((field) => {
      const label = document.createElement("label");
      label.className = "publish-field";
      label.setAttribute("for", field.id);

      const text = document.createElement("span");
      text.textContent = field.label;

      const input = document.createElement("input");
      input.id = field.id;
      input.type = field.type || "text";
      input.placeholder = field.placeholder || "";
      input.value = localStorage.getItem(field.storageKey) || "";
      input.dataset.storageKey = field.storageKey;
      input.addEventListener("input", () => {
        if (input.value) localStorage.setItem(field.storageKey, input.value);
        else localStorage.removeItem(field.storageKey);
      });

      label.append(text, input);
      return label;
    }));
    dynamicFields.hidden = family.fields.length === 0;
  }

  function selectOption(optionId) {
    const family = families[activeFamilyId];
    const option = family.options.find((item) => item.id === optionId);
    if (!option) return;

    selectedOptionByFamily.set(activeFamilyId, optionId);
    optionGrid.querySelectorAll("[data-publish-option]").forEach((button) => {
      const isSelected = button.dataset.publishOption === optionId;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    if (selectedBadge) selectedBadge.textContent = family.badge;
    if (selectedAction) selectedAction.textContent = option.name;
    if (selectedHint) selectedHint.textContent = option.hint;
    actionButton.textContent = option.button;
    writeFeedback("");
  }

  function renderFamily(familyId) {
    if (!families[familyId]) return;
    activeFamilyId = familyId;
    const family = families[familyId];

    if (title) title.textContent = family.title;
    if (copy) copy.textContent = family.copy;

    familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => {
      const isKnown = Boolean(families[button.dataset.publishFamily]);
      button.hidden = !isKnown;
      button.classList.toggle("is-active", button.dataset.publishFamily === familyId);
    });

    renderFields(family);
    optionGrid.replaceChildren(...family.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "publish-option-tile";
      button.dataset.publishOption = option.id;
      button.setAttribute("aria-pressed", "false");

      const icon = document.createElement("span");
      icon.className = "publish-option-icon";
      icon.textContent = option.icon;

      const label = document.createElement("strong");
      label.textContent = option.name;

      const note = document.createElement("small");
      note.textContent = option.note;

      button.append(icon, label, note);
      button.addEventListener("click", () => selectOption(option.id));
      return button;
    }));

    selectOption(selectedOptionByFamily.get(familyId) || family.options[0].id);
  }

  familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => {
    if (!families[button.dataset.publishFamily]) button.hidden = true;
  });

  familyGrid.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-publish-family]");
    if (!button || !families[button.dataset.publishFamily]) return;
    renderFamily(button.dataset.publishFamily);
  });

  actionButton.addEventListener("click", () => void runSelectedAction());
  shareSheetButton?.addEventListener("click", () => {
    const draft = getDraft();
    if (!requireMessage(draft)) return;
    void shareNative(makeActivity(families[activeFamilyId], { name: "Share sheet" }, draft));
  });

  darkToggle?.addEventListener("click", () => {
    const nextDarkMode = !publishOverlay?.classList.contains("is-generic-dark");
    syncPublishDarkMode(nextDarkMode);
    localStorage.setItem(DARK_MODE_KEY, nextDarkMode ? "true" : "false");
  });

  syncPublishDarkMode(localStorage.getItem(DARK_MODE_KEY) === "true");
  renderFamily(activeFamilyId);

  window.SignalSharePublishStudio = {
    selectFamily: renderFamily,
    selectOption,
    runSelectedAction,
    getActivity,
    clearActivity: () => {
      localStorage.removeItem(ACTIVITY_KEY);
      showToast("Activity cleared");
    },
  };
})();
