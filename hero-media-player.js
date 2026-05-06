export function createHeroMediaPlayerController(options) {
  const {
    state,
    elements,
    getControllablePlayerPost,
    getActivePlayerMediaElement,
    getPlayableVisiblePostIds,
    getProfileSummaryForPost,
    formatKind,
    getSignalLabel,
    formatTimestamp,
    normalizePlayerVolume,
    savePlayerVolume,
    applyPlayerVolumeToActiveElement,
    stepMiniPlayer,
    renderMiniPlayer,
    postMessageToYouTubePlayer,
  } = options;

  let listenersAttached = false;

  function hasUi() {
    return Boolean(
      elements.heroPlayerTitle
      && elements.heroPlayerCaption
      && elements.heroPlayerStatus
      && elements.heroPlayerPlayPauseButton
      && elements.heroPlayerPrevButton
      && elements.heroPlayerNextButton
      && elements.heroPlayerVolumeSlider
      && elements.heroPlayerVolumeValue
    );
  }

  function normalizePlaybackState(value) {
    return value === "playing" || value === "paused" ? value : "none";
  }

  function setPlaybackState(value) {
    state.heroPlayerPlaybackState = normalizePlaybackState(value);
  }

  function getPlaybackState() {
    const mediaElement = getActivePlayerMediaElement();
    if (mediaElement instanceof HTMLMediaElement) return mediaElement.paused ? "paused" : "playing";
    if (state.playerPostId) return normalizePlaybackState(state.heroPlayerPlaybackState || "paused");
    return "none";
  }

  function supportsProgrammaticPlayback(post) {
    if (!post) return false;
    if (getActivePlayerMediaElement() instanceof HTMLMediaElement) return true;
    if (post.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) return true;
    return false;
  }

  function setMediaSessionHandler(action, handler) {
    if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setActionHandler !== "function") return;
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }

  function syncMediaSession(post) {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const playbackState = post ? getPlaybackState() : "none";
    try { session.playbackState = playbackState; } catch {}

    const MetadataCtor = typeof window !== "undefined" ? window.MediaMetadata : null;
    if (!post || typeof MetadataCtor !== "function") {
      try { session.metadata = null; } catch {}
    } else {
      const creatorSummary = getProfileSummaryForPost(post);
      const artist = creatorSummary?.displayName ?? post.creator ?? "";
      try {
        session.metadata = new MetadataCtor({
          title: post.title || "Signal Share",
          artist,
          album: `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`,
        });
      } catch {}
    }

    setMediaSessionHandler("play", () => { handlePlayPause(true); });
    setMediaSessionHandler("pause", () => { handlePlayPause(false); });
    setMediaSessionHandler("previoustrack", handlePrevious);
    setMediaSessionHandler("nexttrack", handleNext);
  }

  function ensureControllablePost() {
    if (state.playerPostId && getControllablePlayerPost()) return true;
    const playableIds = getPlayableVisiblePostIds();
    if (!playableIds.length) return false;
    state.playerPostId = playableIds[0];
    setPlaybackState("paused");
    renderMiniPlayer();
    return true;
  }

  function togglePlayback(forcePlay) {
    const mediaElement = getActivePlayerMediaElement();
    if (mediaElement instanceof HTMLMediaElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : mediaElement.paused;
      if (shouldPlay) {
        const playResult = mediaElement.play();
        if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
        setPlaybackState("playing");
      } else {
        mediaElement.pause();
        setPlaybackState("paused");
      }
      return true;
    }

    const post = getControllablePlayerPost();
    if (post?.sourceKind === "youtube" && state.activePlayerElement instanceof HTMLIFrameElement) {
      const shouldPlay = typeof forcePlay === "boolean" ? forcePlay : getPlaybackState() !== "playing";
      postMessageToYouTubePlayer(state.activePlayerElement, shouldPlay ? "playVideo" : "pauseVideo");
      setPlaybackState(shouldPlay ? "playing" : "paused");
      return true;
    }

    return false;
  }

  function handlePlayPause(forcePlay) {
    if (!ensureControllablePost()) {
      render();
      return;
    }
    togglePlayback(forcePlay);
    render();
  }

  function handlePrevious() {
    if (!ensureControllablePost()) {
      render();
      return;
    }
    stepMiniPlayer(-1);
    setPlaybackState("paused");
  }

  function handleNext() {
    if (!ensureControllablePost()) {
      render();
      return;
    }
    stepMiniPlayer(1);
    setPlaybackState("paused");
  }

  function handleVolumeInput(event) {
    const rawValue = Number(event.target?.value);
    state.playerVolume = normalizePlayerVolume(rawValue / 100, state.playerVolume);
    savePlayerVolume(state.playerVolume);
    applyPlayerVolumeToActiveElement();
    render();
  }

  function attachEventListeners() {
    if (listenersAttached || !hasUi()) return;
    listenersAttached = true;
    elements.heroPlayerPlayPauseButton.addEventListener("click", () => { handlePlayPause(); });
    elements.heroPlayerPrevButton.addEventListener("click", handlePrevious);
    elements.heroPlayerNextButton.addEventListener("click", handleNext);
    elements.heroPlayerVolumeSlider.addEventListener("input", handleVolumeInput);
  }

  function render() {
    if (!hasUi()) return;
    const post = getControllablePlayerPost();
    const mediaElement = getActivePlayerMediaElement();
    const supportsPlayback = supportsProgrammaticPlayback(post);
    const supportsVolume = mediaElement instanceof HTMLMediaElement || post?.sourceKind === "youtube";
    const playbackState = getPlaybackState();
    const volumePercent = Math.round(normalizePlayerVolume(state.playerVolume) * 100);
    const playableCount = getPlayableVisiblePostIds().length;
    const canStep = playableCount > 1;
    const canBootstrapPlayback = !post && playableCount > 0;

    if (!post) {
      elements.heroPlayerTitle.textContent = "Nothing playing yet";
      elements.heroPlayerCaption.textContent = "Open a playable post to control playback on this PC or mobile device.";
      elements.heroPlayerStatus.textContent = "Use any Play button in the feed to start.";
    } else {
      const creatorSummary = getProfileSummaryForPost(post);
      elements.heroPlayerTitle.textContent = post.title;
      elements.heroPlayerCaption.textContent = `${formatKind(post.mediaKind)} / ${getSignalLabel(post)}`;
      elements.heroPlayerStatus.textContent = `${creatorSummary?.displayName ?? post.creator} · ${formatTimestamp(post.createdAt)}`;
    }

    elements.heroPlayerPlayPauseButton.textContent = playbackState === "playing" ? "Pause" : "Play";
    elements.heroPlayerPlayPauseButton.disabled = !(supportsPlayback || canBootstrapPlayback);
    elements.heroPlayerPlayPauseButton.title = supportsPlayback || canBootstrapPlayback ? "" : (post?.sourceKind === "spotify" ? "Use Spotify's embedded control directly." : "Open a playable post first.");

    elements.heroPlayerPrevButton.disabled = !canStep;
    elements.heroPlayerNextButton.disabled = !canStep;

    elements.heroPlayerVolumeSlider.disabled = !supportsVolume;
    elements.heroPlayerVolumeSlider.value = `${volumePercent}`;
    elements.heroPlayerVolumeValue.textContent = `${volumePercent}%`;

    syncMediaSession(post);
  }

  return {
    attachEventListeners,
    render,
  };
}
