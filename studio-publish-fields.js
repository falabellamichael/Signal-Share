(() => {
  function cloneField(config) {
    return {
      ...config,
      options: Array.isArray(config.options) ? [...config.options] : [],
    };
  }

  function mergeFields(options = []) {
    const fields = [];
    const fieldsByKey = new Map();

    options.forEach((option) => {
      (option.fields || []).forEach((config) => {
        const existing = fieldsByKey.get(config.key);
        if (!existing) {
          const next = cloneField(config);
          fieldsByKey.set(next.key, next);
          fields.push(next);
          return;
        }

        existing.required = existing.required || config.required;
        existing.wide = existing.wide || config.wide;
        if (!existing.placeholder && config.placeholder) existing.placeholder = config.placeholder;
      });
    });

    return fields;
  }

  const socialMediaSupport = {
    "social-facebook": ["image", "gif", "video"],
    "social-instagram": ["image", "video"],
    "social-x": ["image", "gif", "video"],
    "social-linkedin": ["image", "gif", "video", "document"],
  };

  function sharedSocialMediaKinds(selectedIds) {
    const selected = [...selectedIds];
    if (!selected.length) return [];
    return socialMediaSupport[selected[0]].filter((kind) => (
      selected.every((id) => socialMediaSupport[id]?.includes(kind))
    ));
  }

  function buildSocialFields(options, field) {
    const selectedIds = new Set(options.map((option) => option.id));
    const multiSelected = options.length > 1;
    const hasShareUrl = selectedIds.has("social-facebook")
      || selectedIds.has("social-x")
      || selectedIds.has("social-linkedin");
    const mediaKinds = sharedSocialMediaKinds(selectedIds);
    const requiresMedia = selectedIds.has("social-instagram");
    const textRequired = selectedIds.has("social-instagram") || selectedIds.has("social-x");
    const fields = [];

    fields.push(field("socialDeliveryMode", {
      label: "Social delivery",
      mode: "select",
      value: "direct",
      options: [["direct", "Post with connected accounts"], ["draft", "Save as draft"]],
    }));

    if (hasShareUrl) {
      fields.push(field("shareUrl", {
        label: multiSelected ? "Optional shared link URL" : "Optional link URL",
        wide: multiSelected,
      }));
    }

    if (mediaKinds.length) {
      fields.push(field("mediaKind", {
        label: requiresMedia ? "Attachment type" : "Optional attachment",
        mode: "media-toolbar",
        value: requiresMedia ? "image" : "",
        options: mediaKinds.map((kind) => [kind, kind]),
        required: requiresMedia,
        wide: true,
      }));
      fields.push(field("mediaUrl", {
        label: requiresMedia ? "Public media URL" : (multiSelected ? "Optional shared media URL" : "Optional media URL"),
        placeholder: "https://example.com/media-file",
        type: "url",
        required: requiresMedia,
        wide: true,
      }));
      fields.push(field("mediaMimeType", { mode: "hidden", persist: false }));
    }

    if (selectedIds.has("social-instagram")) {
      fields.push(field("instagramFrom", { label: "Instagram account", placeholder: "@youraccount" }));
      fields.push(field("instagramShareToFeed", {
        label: "Reel visibility",
        mode: "select",
        value: "true",
        options: [["true", "Share reels to feed"], ["false", "Reels tab only"]],
      }));
    }

    if (selectedIds.has("social-x")) {
      fields.push(field("xHandle", { label: "X handle", placeholder: "@yourhandle" }));
    }

    if (selectedIds.has("social-linkedin")) {
      fields.push(field("linkedinFrom", { label: "LinkedIn profile or company", placeholder: "Signal Share" }));
      fields.push(field("mediaTitle", { label: "LinkedIn media title", placeholder: "Optional attachment title" }));
      fields.push(field("mediaAltText", { label: "LinkedIn image alt text", placeholder: "Describe an image for accessibility" }));
    }

    fields.push(field("body", {
      label: multiSelected
        ? "Shared post text / caption"
        : selectedIds.has("social-instagram")
          ? "Caption"
          : selectedIds.has("social-linkedin")
            ? "Share note"
            : "Post text",
      mode: "textarea",
      placeholder: multiSelected
        ? "Write the shared copy for the selected social destinations."
        : selectedIds.has("social-instagram")
          ? "Instagram caption"
          : "Post text",
      required: textRequired,
      wide: true,
    }));

    if (selectedIds.has("social-instagram")) {
      fields.push(field("instagramHashtags", { label: "Instagram hashtags", placeholder: "#signalshare #media" }));
    }

    return fields;
  }

  function getFields(familyId, options = [], field) {
    if (familyId === "social" && typeof field === "function") {
      return buildSocialFields(options, field);
    }

    return mergeFields(options);
  }

  function getDetailsText(familyId, options = [], fallback = "") {
    if (familyId !== "social") return fallback;
    if (options.length < 2) return fallback || "Platform-specific share fields.";
    return `Shared fields plus platform fields for ${options.map((option) => option.name).join(", ")}.`;
  }

  window.SignalSharePublishFieldOrganizer = {
    getFields,
    getDetailsText,
  };
})();
