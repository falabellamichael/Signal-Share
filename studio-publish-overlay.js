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
  const githubRepoField = document.querySelector("#publishGithubRepoField");
  const githubRepoInput = document.querySelector("#publishGithubRepoInput");
  const publishOverlay = document.querySelector("#compose");
  const darkToggle = document.querySelector("#publishDarkToggle");
  const GITHUB_REPO_KEY = "signal-share-publish-github-repo";
  const DARK_MODE_KEY = "signal-share-publish-generic-dark";
  const DRAFT_KEY = "signal-share-publish-draft";
  const CACHE_KEY = "signal-share-publish-session-draft";

  if (!familyGrid || !optionGrid || !actionButton || !postForm) return;

  const families = {
    signal: {
      badge: "Signal Share",
      title: "Signal Share feed",
      copy: "Create a live or local feed post with the media source below.",
      options: [
        {
          id: "signal-feed",
          mark: "📣",
          label: "Feed post",
          hint: "Use the existing post pipeline.",
          actionLabel: "Publish to feed",
          selectedHint: "This uses the current Signal Share publish and moderation flow.",
        },
      ],
    },
    local: {
      badge: "Local",
      title: "Local storage",
      copy: "Keep a draft, cache a tab copy, or export a portable package.",
      options: [
        {
          id: "local-storage",
          mark: "💾",
          label: "Local Storage",
          hint: "Save a browser draft.",
          actionLabel: "Save local draft",
          selectedHint: "Store form text and source metadata in this browser.",
        },
        {
          id: "browser-cache",
          mark: "📦",
          label: "Browser Cache",
          hint: "Hold a session draft.",
          actionLabel: "Cache this draft",
          selectedHint: "Keep a recovery copy until this browser tab session ends.",
        },
        {
          id: "export-bundle",
          mark: "⬇️",
          label: "Export bundle",
          hint: "Download a JSON manifest.",
          actionLabel: "Download bundle",
          selectedHint: "Export title, caption, tags, links, and media metadata.",
        },
      ],
    },
    social: {
      badge: "Social",
      title: "Social posting",
      copy: "Share out through supported web flows or the device share sheet.",
      options: [
        {
          id: "social-facebook",
          mark: "📘",
          label: "Facebook",
          hint: "Open the web share flow.",
          actionLabel: "Open Facebook",
          selectedHint: "Facebook receives a share URL through its browser share flow.",
        },
        {
          id: "social-instagram",
          mark: "📸",
          label: "Instagram",
          hint: "Share file or copy the kit.",
          actionLabel: "Share for Instagram",
          selectedHint: "Use the device share sheet when available, otherwise copy the post kit.",
        },
        {
          id: "social-x",
          mark: "✕",
          label: "X",
          hint: "Open a post intent.",
          actionLabel: "Open X post",
          selectedHint: "Build a post intent from the caption and share URL.",
        },
        {
          id: "social-linkedin",
          mark: "💼",
          label: "LinkedIn",
          hint: "Open link sharing.",
          actionLabel: "Open LinkedIn",
          selectedHint: "Share the current post URL through LinkedIn.",
        },
      ],
    },
    github: {
      badge: "GitHub",
      title: "GitHub handoff",
      copy: "Prepare repo-ready content, open issues, or start a pull request route.",
      options: [
        {
          id: "github-commit",
          mark: "📝",
          label: "Commit and Push",
          hint: "Prepare a commit bundle.",
          actionLabel: "Prepare commit bundle",
          selectedHint: "Downloads a markdown payload and copies a commit message.",
        },
        {
          id: "github-issue",
          mark: "🐛",
          label: "Create Issue",
          hint: "Open a prefilled issue.",
          actionLabel: "Create GitHub issue",
          selectedHint: "Use the repository field to open a prefilled GitHub issue.",
        },
        {
          id: "github-pr",
          mark: "🤝",
          label: "Pull Request",
          hint: "Open compare flow.",
          actionLabel: "Open pull request flow",
          selectedHint: "Use the repository field to start GitHub compare and PR work.",
        },
      ],
    },
    cloud: {
      badge: "Cloud",
      title: "Cloud sync",
      copy: "Export or hand off content for cloud storage and device sharing.",
      options: [
        {
          id: "cloud-drive",
          mark: "☁️",
          label: "Sync to Drive",
          hint: "Package and open Drive.",
          actionLabel: "Open Drive handoff",
          selectedHint: "Download a bundle, then continue in Google Drive.",
        },
        {
          id: "cloud-upload",
          mark: "⬆️",
          label: "Upload Files",
          hint: "Choose source media.",
          actionLabel: "Choose media file",
          selectedHint: "Use the existing media picker for an upload source.",
        },
        {
          id: "cloud-folder",
          mark: "📤",
          label: "Share Folder",
          hint: "Use share sheet or copy.",
          actionLabel: "Share package",
          selectedHint: "Share the post kit to a supported device or clipboard.",
        },
      ],
    },
    email: {
      badge: "Email",
      title: "Email delivery",
      copy: "Build email handoffs from the current post copy.",
      options: [
        {
          id: "email-send",
          mark: "✉️",
          label: "Send Email",
          hint: "Open a new message.",
          actionLabel: "Compose email",
          selectedHint: "Start a mail draft with the post title and copy.",
        },
        {
          id: "email-share",
          mark: "📧",
          label: "Share via Email",
          hint: "Include the share URL.",
          actionLabel: "Email share link",
          selectedHint: "Send the caption, source link, and page link.",
        },
        {
          id: "email-forward",
          mark: "↪️",
          label: "Forward Message",
          hint: "Package as a forward.",
          actionLabel: "Forward by email",
          selectedHint: "Create a forward-style mail draft from this package.",
        },
      ],
    },
  };

  let activeFamilyId = "signal";
  const selectedOptionIdsByFamily = new Map(
    Object.entries(families).map(([familyId, family]) => [familyId, new Set([family.options[0].id])]),
  );

  function getState() {
    return window.state ?? window.__SIGNAL_SHARE_STATE__ ?? null;
  }

  function showDestinationFeedback(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle("is-error", isError);
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

  function getShareUrl(draft) {
    return draft.externalUrl || `${window.location.origin}${window.location.pathname}`;
  }

  function getDraft() {
    const state = getState();
    const selectedFile = state?.selectedFile ?? null;
    const creator = getValue("#creatorInput") || window.getDefaultProfileName?.() || "";
    return {
      creator,
      title: getValue("#titleInput"),
      caption: getValue("#captionInput"),
      tags: getValue("#tagsInput"),
      externalUrl: getValue("#externalUrlInput"),
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
      exportedAt: new Date().toISOString(),
    };
  }

  function getDraftPayload(draft) {
    const { file, ...payload } = draft;
    return payload;
  }

  function getPostKit(draft) {
    const parts = [];
    if (draft.title) parts.push(draft.title);
    if (draft.caption) parts.push(draft.caption);
    if (draft.creator) parts.push(`By ${draft.creator}`);
    if (draft.tags) parts.push(`Tags: ${draft.tags}`);
    if (draft.externalUrl) parts.push(`Source: ${draft.externalUrl}`);
    parts.push(`Share: ${getShareUrl(draft)}`);
    return parts.join("\n\n");
  }

  function requireDraftCopy(draft) {
    if (draft.title || draft.caption || draft.externalUrl || draft.file) return true;
    showDestinationFeedback("Add a title, caption, media file, or source link first.", true);
    return false;
  }

  function slugify(value = "") {
    return `${value || "signal-share-post"}`
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "signal-share-post";
  }

  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadJsonBundle(draft) {
    downloadText(
      `${slugify(draft.title)}.signal-share.json`,
      `${JSON.stringify(getDraftPayload(draft), null, 2)}\n`,
      "application/json",
    );
  }

  function buildMarkdownBundle(draft) {
    return [
      "# Signal Share post",
      "",
      `Title: ${draft.title || "Untitled"}`,
      `Creator: ${draft.creator || "Unknown"}`,
      `Tags: ${draft.tags || "None"}`,
      `Source: ${draft.externalUrl || draft.source.name || "Add media source"}`,
      "",
      "## Caption",
      "",
      draft.caption || "",
      "",
      "## Share kit",
      "",
      getPostKit(draft),
      "",
    ].join("\n");
  }

  async function copyText(value) {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  function openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function saveDraft(storage, key, draft, label) {
    storage.setItem(key, JSON.stringify(getDraftPayload(draft)));
    showDestinationFeedback(`${label} saved.`);
  }

  function getGithubRepoParts() {
    const raw = `${githubRepoInput?.value || ""}`.trim();
    if (!raw) return null;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://github.com/${raw}`;
    try {
      const url = new URL(normalized);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
      const [owner, repo] = url.pathname.split("/").filter(Boolean);
      if (!owner || !repo) return null;
      return { owner, repo: repo.replace(/\.git$/i, "") };
    } catch {
      return null;
    }
  }

  function getGithubRepoOrWarn() {
    const repo = getGithubRepoParts();
    if (repo) return repo;
    showDestinationFeedback("Enter a GitHub repository URL or owner/repo first.", true);
    githubRepoInput?.focus();
    return null;
  }

  async function shareNative(draft) {
    if (!requireDraftCopy(draft)) return;
    if (!navigator.share) {
      const copied = await copyText(getPostKit(draft));
      showDestinationFeedback(copied
        ? "Device sharing is unavailable here. The post kit was copied instead."
        : "Device sharing is unavailable in this browser.", !copied);
      return;
    }

    const payload = {
      title: draft.title || "Signal Share post",
      text: getPostKit(draft),
      url: getShareUrl(draft),
    };

    if (draft.file && navigator.canShare?.({ files: [draft.file] })) {
      payload.files = [draft.file];
    }

    try {
      await navigator.share(payload);
      showDestinationFeedback("Share sheet opened.");
    } catch (error) {
      showDestinationFeedback(error?.name === "AbortError"
        ? "Sharing was cancelled."
        : "The share sheet could not open. Try a social or email option.", true);
    }
  }

  function openMail(draft, mode) {
    if (!requireDraftCopy(draft)) return;
    const titles = {
      "email-send": `Signal Share post: ${draft.title || "Untitled"}`,
      "email-share": `Share this Signal Share post: ${draft.title || "Untitled"}`,
      "email-forward": `Fwd: Signal Share package - ${draft.title || "Untitled"}`,
    };
    const body = [
      mode === "email-forward" ? "Forwarded Signal Share package:" : "Signal Share package:",
      "",
      getPostKit(draft),
    ].join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent(titles[mode])}&body=${encodeURIComponent(body)}`;
    showDestinationFeedback("Email draft opened.");
  }

  async function performGithubCommit(draft) {
    if (!requireDraftCopy(draft)) return;
    const filename = `${slugify(draft.title)}.signal-share.md`;
    downloadText(filename, buildMarkdownBundle(draft), "text/markdown");
    const copied = await copyText(`feat: publish ${draft.title || "Signal Share post"}`);
    showDestinationFeedback(copied
      ? "GitHub markdown bundle downloaded and a commit message was copied."
      : "GitHub markdown bundle downloaded. Commit and push it from your repo.");
  }

  function openGithubIssue(draft) {
    if (!requireDraftCopy(draft)) return;
    const repo = getGithubRepoOrWarn();
    if (!repo) return;
    openExternal(
      `https://github.com/${repo.owner}/${repo.repo}/issues/new?title=${encodeURIComponent(draft.title || "Signal Share post")}&body=${encodeURIComponent(buildMarkdownBundle(draft))}`,
    );
    showDestinationFeedback("GitHub issue composer opened.");
  }

  function openGithubPullRequest(draft) {
    if (!requireDraftCopy(draft)) return;
    const repo = getGithubRepoOrWarn();
    if (!repo) return;
    downloadText(`${slugify(draft.title)}.signal-share.md`, buildMarkdownBundle(draft), "text/markdown");
    openExternal(`https://github.com/${repo.owner}/${repo.repo}/compare`);
    showDestinationFeedback("GitHub compare flow opened and the markdown payload was downloaded.");
  }

  async function performSocialInstagram(draft) {
    if (!requireDraftCopy(draft)) return;
    if (navigator.share) {
      await shareNative(draft);
      return;
    }
    const copied = await copyText(getPostKit(draft));
    if (copied) {
      openExternal("https://www.instagram.com/");
      showDestinationFeedback("Instagram opened and the post kit was copied.");
      return;
    }
    showDestinationFeedback("Instagram sharing needs the device share sheet or clipboard access.", true);
  }

  function performAction(optionId) {
    const draft = getDraft();
    switch (optionId) {
      case "signal-feed":
        postForm.requestSubmit();
        return;
      case "local-storage":
        saveDraft(localStorage, DRAFT_KEY, draft, "Local draft");
        return;
      case "browser-cache":
        saveDraft(sessionStorage, CACHE_KEY, draft, "Session draft");
        return;
      case "export-bundle":
        if (!requireDraftCopy(draft)) return;
        downloadJsonBundle(draft);
        showDestinationFeedback("JSON bundle downloaded.");
        return;
      case "github-commit":
        void performGithubCommit(draft);
        return;
      case "github-issue":
        openGithubIssue(draft);
        return;
      case "github-pr":
        openGithubPullRequest(draft);
        return;
      case "cloud-drive":
        if (!requireDraftCopy(draft)) return;
        downloadJsonBundle(draft);
        openExternal("https://drive.google.com/drive/my-drive");
        showDestinationFeedback("Drive opened and a JSON package was downloaded.");
        return;
      case "cloud-upload":
        mediaInput?.click();
        showDestinationFeedback("Choose media for the upload source.");
        return;
      case "cloud-folder":
        void shareNative(draft);
        return;
      case "email-send":
      case "email-share":
      case "email-forward":
        openMail(draft, optionId);
        return;
      case "social-facebook":
        if (!requireDraftCopy(draft)) return;
        openExternal(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getShareUrl(draft))}`);
        showDestinationFeedback("Facebook share flow opened.");
        return;
      case "social-instagram":
        void performSocialInstagram(draft);
        return;
      case "social-x":
        if (!requireDraftCopy(draft)) return;
        openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(draft.caption || draft.title || "Signal Share post")}&url=${encodeURIComponent(getShareUrl(draft))}`);
        showDestinationFeedback("X post flow opened.");
        return;
      case "social-linkedin":
        if (!requireDraftCopy(draft)) return;
        openExternal(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(getShareUrl(draft))}`);
        showDestinationFeedback("LinkedIn share flow opened.");
        return;
      default:
        showDestinationFeedback("Choose a destination option first.", true);
    }
  }

  function getSelectedOptions() {
    const family = families[activeFamilyId];
    const selectedIds = selectedOptionIdsByFamily.get(activeFamilyId) ?? new Set();
    const options = family.options.filter((option) => selectedIds.has(option.id));
    if (options.length > 0) return options;

    selectedOptionIdsByFamily.set(activeFamilyId, new Set([family.options[0].id]));
    return [family.options[0]];
  }

  function syncSelectedOptions() {
    const family = families[activeFamilyId];
    const options = getSelectedOptions();
    const selectedIds = new Set(options.map((option) => option.id));

    optionGrid.querySelectorAll("[data-publish-option]").forEach((button) => {
      const isSelected = selectedIds.has(button.dataset.publishOption);
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    if (selectedBadge) selectedBadge.textContent = family.badge;
    if (selectedAction) {
      selectedAction.textContent = options.length === 1
        ? options[0].label
        : `${options.length} ${family.title.toLowerCase()} options`;
    }
    if (selectedHint) {
      selectedHint.textContent = options.length === 1
        ? options[0].selectedHint
        : `Run ${options.map((option) => option.label).join(", ")} from this destination together.`;
    }
    actionButton.textContent = options.length === 1
      ? options[0].actionLabel
      : `Run ${options.length} ${family.badge} actions`;
  }

  function toggleOption(optionId) {
    const family = families[activeFamilyId];
    if (!family.options.some((option) => option.id === optionId)) return;

    const selectedIds = selectedOptionIdsByFamily.get(activeFamilyId) ?? new Set();
    if (selectedIds.has(optionId)) {
      if (selectedIds.size === 1) {
        showDestinationFeedback("Keep at least one option selected in this destination.", true);
        return;
      }
      selectedIds.delete(optionId);
    } else {
      selectedIds.add(optionId);
    }

    selectedOptionIdsByFamily.set(activeFamilyId, selectedIds);
    syncSelectedOptions();
    showDestinationFeedback("");
  }

  function runSelectedActions() {
    const options = getSelectedOptions();
    options.forEach((option) => performAction(option.id));
  }

  function renderFamily(familyId) {
    activeFamilyId = familyId;
    const family = families[familyId];
    if (title) title.textContent = family.title;
    if (copy) copy.textContent = family.copy;
    if (githubRepoField) githubRepoField.hidden = familyId !== "github";

    familyGrid.querySelectorAll("[data-publish-family]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.publishFamily === familyId);
    });

    optionGrid.replaceChildren(...family.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "publish-option-tile";
      button.dataset.publishOption = option.id;

      const mark = document.createElement("span");
      mark.className = "publish-option-icon";
      mark.textContent = option.mark;

      const label = document.createElement("strong");
      label.textContent = option.label;
      const hint = document.createElement("small");
      hint.textContent = option.hint;

      button.append(mark, label, hint);
      button.addEventListener("click", () => toggleOption(option.id));
      return button;
    }));

    syncSelectedOptions();
    showDestinationFeedback("");
  }

  familyGrid.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-publish-family]");
    if (!button || !families[button.dataset.publishFamily]) return;
    renderFamily(button.dataset.publishFamily);
  });

  actionButton.addEventListener("click", runSelectedActions);
  shareSheetButton?.addEventListener("click", () => void shareNative(getDraft()));
  darkToggle?.addEventListener("click", () => {
    const nextDarkMode = !publishOverlay?.classList.contains("is-generic-dark");
    syncPublishDarkMode(nextDarkMode);
    localStorage.setItem(DARK_MODE_KEY, nextDarkMode ? "true" : "false");
  });

  if (githubRepoInput) {
    githubRepoInput.value = `${localStorage.getItem(GITHUB_REPO_KEY) || ""}`.trim();
    githubRepoInput.addEventListener("change", () => {
      const value = `${githubRepoInput.value || ""}`.trim();
      if (value) localStorage.setItem(GITHUB_REPO_KEY, value);
      else localStorage.removeItem(GITHUB_REPO_KEY);
    });
  }

  syncPublishDarkMode(localStorage.getItem(DARK_MODE_KEY) === "true");
  renderFamily(activeFamilyId);
  window.SignalSharePublishStudio = {
    selectFamily: renderFamily,
    performAction,
    runSelectedActions,
  };
})();
