function resolveYouTubePreviewId(post, parseYouTubeUrl) {
  if (!post) return "";
  const candidates = [
    post.externalId,
    post.embedUrl,
    post.externalUrl,
    post.src,
    post.mediaUrl,
    post.label,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = `${candidate}`.trim();
    if (!value) continue;
    if (typeof parseYouTubeUrl === "function") {
      const parsed = parseYouTubeUrl(value);
      if (parsed?.externalId) return parsed.externalId;
    }
    const match = value.match(/(?:v=|embed\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
    if (match?.[1]) return match[1];
  }
  return "";
}

function resolveAppPreviewArtwork(post, options = {}) {
  if (!post) return "";
  const { parseYouTubeUrl, resolveActivePlayerSource } = options;
  if (post.sourceKind === "youtube") {
    const videoId = resolveYouTubePreviewId(post, parseYouTubeUrl);
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
  }
  if (post.mediaKind === "image") {
    if (typeof resolveActivePlayerSource === "function") {
      const resolved = resolveActivePlayerSource(post);
      if (resolved) return resolved;
    }
    if (typeof post.src === "string" && post.src.trim()) return post.src.trim();
    if (typeof post.mediaUrl === "string" && post.mediaUrl.trim()) return post.mediaUrl.trim();
  }
  return "";
}

function createPreviewCard({ badge, title, meta, note, artworkUrl }) {
  const card = document.createElement("article");
  card.className = "hero-player-preview";

  if (artworkUrl) {
    const image = document.createElement("img");
    image.className = "hero-player-preview-image";
    image.src = artworkUrl;
    image.alt = title ? `${title} preview` : "Playback preview";
    image.loading = "lazy";
    image.referrerPolicy = "strict-origin-when-cross-origin";
    card.appendChild(image);
  }

  const copy = document.createElement("div");
  copy.className = "hero-player-preview-copy";

  if (badge) {
    const badgeNode = document.createElement("p");
    badgeNode.className = "hero-player-preview-badge";
    badgeNode.textContent = badge;
    copy.appendChild(badgeNode);
  }

  const titleNode = document.createElement("p");
  titleNode.className = "hero-player-preview-title";
  titleNode.textContent = title || "Ready to play";
  copy.appendChild(titleNode);

  if (meta) {
    const metaNode = document.createElement("p");
    metaNode.className = "hero-player-preview-meta";
    metaNode.textContent = meta;
    copy.appendChild(metaNode);
  }

  if (note) {
    const noteNode = document.createElement("p");
    noteNode.className = "hero-player-preview-note";
    noteNode.textContent = note;
    copy.appendChild(noteNode);
  }

  card.appendChild(copy);
  return card;
}

function createPostStandbyPreview(post, options = {}) {
  if (!post) return null;
  const {
    getProfileSummaryForPost,
    formatKind,
    parseYouTubeUrl,
    resolveActivePlayerSource,
  } = options;
  const creatorSummary = typeof getProfileSummaryForPost === "function" ? getProfileSummaryForPost(post) : null;
  const creatorName = creatorSummary?.displayName ?? post.creator ?? "Signal Share";
  const formatLabel = typeof formatKind === "function" ? formatKind(post.mediaKind) : "";
  const providerLabel = post.sourceKind === "youtube"
    ? "YouTube"
    : post.sourceKind === "spotify"
      ? "Spotify"
      : "";
  const meta = [creatorName, formatLabel, providerLabel].filter(Boolean).join(" · ");
  return createPreviewCard({
    badge: "Preview on load",
    title: post.title || "Next playable post",
    meta,
    note: "Press Play to load this item.",
    artworkUrl: resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource }),
  });
}

export function renderHeroStagePreview(options = {}) {
  const {
    stage,
    mode,
    post,
    fallbackMedia,
    nativeSnapshot,
    desktopSnapshot,
    getStandbyPreviewPost,
    getProfileSummaryForPost,
    formatKind,
    getSignalLabel,
    formatTimestamp,
    getBrowserMediaMetadata,
    sanitizeSnapshotMeta,
    parseYouTubeUrl,
    resolveActivePlayerSource,
    activePlayerElement,
  } = options;

  if (!stage) return;
  stage.replaceChildren();

  const standbyPost = !post && typeof getStandbyPreviewPost === "function"
    ? getStandbyPreviewPost()
    : null;

  if (mode === "device") {
    if (nativeSnapshot?.permissionRequired) {
      stage.appendChild(createPreviewCard({
        badge: "Device media",
        title: "Enable access",
        meta: "Allow media access to control this device.",
        note: "Use Play to open settings.",
      }));
      return;
    }

    if (nativeSnapshot?.active) {
      stage.appendChild(createPreviewCard({
        badge: "Device media",
        title: nativeSnapshot.title || "Now playing",
        meta: nativeSnapshot.meta || "Current device playback",
        note: nativeSnapshot.playbackState === "paused" ? "Paused" : "Playing",
        artworkUrl: nativeSnapshot.artworkUri || "",
      }));
      return;
    }

    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }

    stage.appendChild(createPreviewCard({
      badge: "Device media",
      title: "No active playback",
      meta: "Start a track in any media app on this device.",
    }));
    return;
  }

  if (mode === "desktop") {
    if (desktopSnapshot?.active) {
      const resolvedArtwork = desktopSnapshot.artworkUri || "";
      stage.appendChild(createPreviewCard({
        badge: "PC system media",
        title: desktopSnapshot.title || "Now playing",
        meta: desktopSnapshot.meta || "Desktop playback",
        note: desktopSnapshot.playbackState === "paused" ? "Paused" : "Playing",
        artworkUrl: resolvedArtwork,
      }));
      return;
    }

    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }

    stage.appendChild(createPreviewCard({
      badge: "PC system media",
      title: "Waiting for playback",
      meta: "Start YouTube, Spotify, or another desktop app.",
    }));
    return;
  }

  if (!post && fallbackMedia instanceof HTMLMediaElement) {
    const metadata = typeof getBrowserMediaMetadata === "function" ? getBrowserMediaMetadata() : null;
    const fallbackTitle = metadata?.title || fallbackMedia.getAttribute("title") || "Browser playback";
    const fallbackMetaRaw = [metadata?.artist, metadata?.album].filter(Boolean).join(" · ");
    const fallbackMeta = typeof sanitizeSnapshotMeta === "function"
      ? sanitizeSnapshotMeta(fallbackMetaRaw, "")
      : fallbackMetaRaw;
    stage.appendChild(createPreviewCard({
      badge: "Browser media",
      title: fallbackTitle,
      meta: fallbackMeta || "Active browser media session",
      note: fallbackMedia.paused ? "Paused" : "Playing",
      artworkUrl: metadata?.artworkUrl || "",
    }));
    return;
  }

  if (!post) {
    const standbyCard = createPostStandbyPreview(standbyPost, {
      getProfileSummaryForPost,
      formatKind,
      parseYouTubeUrl,
      resolveActivePlayerSource,
    });
    if (standbyCard) {
      stage.appendChild(standbyCard);
      return;
    }
    stage.appendChild(createPreviewCard({
      badge: "App media",
      title: "Ready to play",
      meta: "Choose any playable card to begin.",
    }));
    return;
  }

  // Functional Player: If we have an active player element for this post, show it instead of a preview card.
  if (activePlayerElement instanceof HTMLElement) {
    stage.classList.add("is-functional");
    stage.appendChild(activePlayerElement);
    return;
  }
  
  stage.classList.remove("is-functional");

  const creatorSummary = typeof getProfileSummaryForPost === "function" ? getProfileSummaryForPost(post) : null;
  stage.appendChild(createPreviewCard({
    badge: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
    title: post.title || "Now playing",
    meta: `${creatorSummary?.displayName ?? post.creator ?? "Signal Share"} · ${formatTimestamp(post.createdAt)}`,
    artworkUrl: resolveAppPreviewArtwork(post, { parseYouTubeUrl, resolveActivePlayerSource }),
  }));
}
