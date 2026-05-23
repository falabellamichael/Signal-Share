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

  function buildSocialFields(options, field) {
    const selectedIds = new Set(options.map((option) => option.id));
    const multiSelected = options.length > 1;
    const hasShareUrl = selectedIds.has("social-facebook")
      || selectedIds.has("social-x")
      || selectedIds.has("social-linkedin");
    const hasImageUrl = selectedIds.has("social-facebook")
      || selectedIds.has("social-instagram")
      || selectedIds.has("social-x")
      || selectedIds.has("social-linkedin");
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

    if (hasImageUrl) {
      const isInstagram = selectedIds.has("social-instagram");
      fields.push(field("imageUrl", {
        label: isInstagram ? "Image URL" : (multiSelected ? "Optional shared image URL" : "Optional image URL"),
        placeholder: "https://example.com/image.jpg",
        type: "url",
        required: isInstagram,
      }));
    }

    if (selectedIds.has("social-instagram")) {
      fields.push(field("instagramFrom", { label: "Instagram account", placeholder: "@youraccount" }));
    }

    if (selectedIds.has("social-x")) {
      fields.push(field("xHandle", { label: "X handle", placeholder: "@yourhandle" }));
    }

    if (selectedIds.has("social-linkedin")) {
      fields.push(field("linkedinFrom", { label: "LinkedIn profile or company", placeholder: "Signal Share" }));
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
