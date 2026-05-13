export const AI_COMPANION_ID = "ai-companion";
export const AI_THREAD_ID = "thread-ai-companion";
const AI_CREATED_AT = new Date("2026-05-01").toISOString();

export const AI_COMPANION_PROFILE = Object.freeze({
  id: AI_COMPANION_ID,
  email: "ai@signal.share",
  displayName: "AI Companion",
  isAi: true,
  createdAt: AI_CREATED_AT
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isAiThreadId(threadId) {
  return threadId === AI_THREAD_ID;
}

export function getAiMessagesStorageKey(state) {
  if (!state?.currentUser?.id) return "";
  return `ai-messages-${state.currentUser.id}`;
}

function sanitizeAiMessageForStorage(message) {
  if (!message || typeof message !== "object") return null;
  const next = { ...message };
  if (next.isThinking) return null;
  if (typeof next.attachmentUrl === "string" && /^blob:/i.test(next.attachmentUrl.trim())) {
    next.attachmentUrl = "";
  }
  if (next.attachmentUrl === null) next.attachmentUrl = "";
  if (!next.createdAt) next.createdAt = new Date().toISOString();
  return next;
}

export function sanitizeAiMessagesForStorage(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(sanitizeAiMessageForStorage)
    .filter((entry) => entry && typeof entry === "object");
}

export function loadAiMessagesLocally(state) {
  const storageKey = getAiMessagesStorageKey(state);
  if (!storageKey) return [];
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeAiMessagesForStorage(parsed);
    const normalizedRaw = JSON.stringify(sanitized);
    if (normalizedRaw !== raw) {
      localStorage.setItem(storageKey, normalizedRaw);
    }
    return sanitized;
  } catch (error) {
    console.warn("AI local message cache was invalid and has been reset.", error);
    localStorage.removeItem(storageKey);
    return [];
  }
}

export function clearAiMessagesLocally(state) {
  const storageKey = getAiMessagesStorageKey(state);
  if (!storageKey) return;
  localStorage.removeItem(storageKey);
}

export function saveAiMessagesLocally(state, messages) {
  const storageKey = getAiMessagesStorageKey(state);
  if (!storageKey) return;
  const sanitized = sanitizeAiMessagesForStorage(messages);
  try {
    localStorage.setItem(storageKey, JSON.stringify(sanitized));
  } catch (error) {
    console.warn("AI local message cache exceeded limits; retrying without attachment payloads.", error);
    try {
      const fallback = sanitized.map((message) => ({ ...message, attachmentUrl: "" }));
      localStorage.setItem(storageKey, JSON.stringify(fallback));
    } catch (finalError) {
      console.warn("AI local message cache could not be saved.", finalError);
    }
  }
}

export function buildAiThread(userId, { createdAt = AI_CREATED_AT, updatedAt = "", lastMessageBody = "" } = {}) {
  const normalizedCreatedAt = typeof createdAt === "string" && createdAt.trim()
    ? createdAt
    : AI_CREATED_AT;
  const normalizedUpdatedAt = typeof updatedAt === "string" && updatedAt.trim()
    ? updatedAt
    : new Date().toISOString();

  const thread = {
    id: AI_THREAD_ID,
    userOneId: userId || "",
    userTwoId: AI_COMPANION_ID,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    isAi: true
  };

  if (typeof lastMessageBody === "string" && lastMessageBody.trim()) {
    thread.lastMessageBody = lastMessageBody;
  }

  return thread;
}

export function appendAiThreadFromLocalHistory({ state, threads }) {
  const aiHistory = loadAiMessagesLocally(state);
  if (!Array.isArray(threads)) return { threads: [], aiHistory };
  if (aiHistory.length === 0) return { threads: [...threads], aiHistory };
  if (threads.some((thread) => thread?.id === AI_THREAD_ID)) return { threads: [...threads], aiHistory };

  const lastMessage = aiHistory[aiHistory.length - 1];
  const aiThread = buildAiThread(state?.currentUser?.id || "", {
    updatedAt: lastMessage?.createdAt || new Date().toISOString(),
    lastMessageBody: lastMessage?.body || ""
  });
  return { threads: [...threads, aiThread], aiHistory };
}

export function handleAiOpenOrCreateThread({
  partnerId,
  state,
  sortThreads,
  clearMessageAttachmentSelection,
  showMessengerFeedback
}) {
  if (partnerId !== AI_COMPANION_ID) return false;
  const nowIso = new Date().toISOString();
  const aiThread = buildAiThread(state?.currentUser?.id || "", {
    createdAt: nowIso,
    updatedAt: nowIso
  });

  if (!state.directThreads.some((thread) => thread?.id === aiThread.id)) {
    state.directThreads = sortThreads([aiThread, ...state.directThreads]);
  }

  state.activeThreadId = aiThread.id;
  state.activeMessages = loadAiMessagesLocally(state);
  clearMessageAttachmentSelection?.({ preserveFeedback: true });
  showMessengerFeedback?.("");
  return true;
}

export async function handleAiThreadMessageSubmit({
  state,
  elements,
  body,
  attachmentFile,
  getMessageAttachmentKind,
  getActiveThread,
  mergeActiveMessage,
  renderMessenger,
  showMessengerFeedback,
  playIncomingMessageSound,
  shouldAttemptBridgeRequests,
  probeLocalNetworkPermission,
  resolveBridgeBaseCandidates,
  getBridgeSecretValue,
  resolvePreferredBridgeModel,
  getBridgeTargetAddressSpace
}) {
  const activeThread = getActiveThread();
  if (!activeThread?.isAi) return false;

  try {
    const userMessage = {
      id: crypto.randomUUID(),
      threadId: state.activeThreadId,
      senderId: state.currentUser.id,
      body,
      createdAt: new Date().toISOString(),
      attachmentUrl: null,
      attachmentKind: attachmentFile ? getMessageAttachmentKind(attachmentFile.type) : null,
      attachmentName: attachmentFile ? attachmentFile.name : null,
      attachmentType: attachmentFile ? attachmentFile.type : null,
      attachmentSize: attachmentFile ? attachmentFile.size : 0
    };

    const directSteamTarget = window.SignalShareAiCore?.parseDirectSteamCommand?.(body) || "";
    const directDuckDuckGoQuery = window.SignalShareAiCore?.parseDuckDuckGoCommand?.(body) || "";

    if (directSteamTarget || directDuckDuckGoQuery) {
      mergeActiveMessage(userMessage);
      saveAiMessagesLocally(state, state.activeMessages);

      state.messageAttachmentFile = null;
      state.messageAttachmentPreviewUrl = "";
      renderMessenger();

      let aiReply = "";
      if (directSteamTarget) {
        const steamPlan = window.SignalShareAiCore?.buildSteamLaunchPlan?.(directSteamTarget) || null;
        if (steamPlan?.type === "run" && steamPlan.uri) {
          window.location.href = steamPlan.uri;
          aiReply = `🎮 [Steam Protocol]: Launching ${steamPlan.key.toUpperCase()} via Steam now.`;
        } else {
          const searchUrl = steamPlan?.searchUrl || `https://store.steampowered.com/search/?term=${encodeURIComponent(directSteamTarget)}`;
          window.open(searchUrl, "_blank", "noopener,noreferrer");
          aiReply = `🎮 [Steam Protocol]: I couldn't find a direct app ID for "${directSteamTarget}", so I opened Steam search.`;
        }
      } else {
        const query = directDuckDuckGoQuery.trim();
        if (query) {
          const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
          window.open(url, "_blank", "noopener,noreferrer");
          aiReply = `🔎 [Search Protocol]: Searching DuckDuckGo for "${query}".`;
        } else {
          aiReply = "🔎 [Search Protocol]: Tell me what you want to search on DuckDuckGo.";
        }
      }

      const directAiMessage = {
        id: crypto.randomUUID(),
        threadId: state.activeThreadId,
        senderId: AI_COMPANION_ID,
        body: aiReply,
        createdAt: new Date().toISOString()
      };
      mergeActiveMessage(directAiMessage);
      saveAiMessagesLocally(state, state.activeMessages);
      renderMessenger();
      playIncomingMessageSound();
      showMessengerFeedback("");
      return true;
    }

    let aiAttachment = null;
    if (attachmentFile) {
      try {
        aiAttachment = {
          data: await readFileAsDataURL(attachmentFile),
          type: getMessageAttachmentKind(attachmentFile.type),
          name: attachmentFile.name
        };
        if (aiAttachment?.data) {
          userMessage.attachmentUrl = aiAttachment.data;
        }
      } catch (error) {
        console.error("Failed to read AI attachment", error);
      }
    }

    const history = window.SignalShareAiCore
      ? window.SignalShareAiCore.normalizeHistory(state.activeMessages, {
          aiSenderId: AI_COMPANION_ID,
          currentMessageId: userMessage.id
        })
      : state.activeMessages
          .filter((message) => !message.isThinking && message.id !== userMessage.id)
          .map((message) => ({
            role: message.senderId === AI_COMPANION_ID ? "assistant" : "user",
            content: `${message.body || ""}`.trim().slice(0, 900)
          }))
          .filter((row) => row.content.length > 0)
          .slice(-18);

    mergeActiveMessage(userMessage);
    saveAiMessagesLocally(state, state.activeMessages);

    state.messageAttachmentFile = null;
    state.messageAttachmentPreviewUrl = "";
    renderMessenger();

    const thinkingId = `thinking-${crypto.randomUUID()}`;
    const thinkingMessage = {
      id: thinkingId,
      threadId: state.activeThreadId,
      senderId: AI_COMPANION_ID,
      body: "Thinking...",
      isThinking: true,
      createdAt: new Date().toISOString()
    };
    state.activeMessages.push(thinkingMessage);
    renderMessenger();

    if (window.heroMediaPlayerController) {
      try {
        if (typeof window.heroMediaPlayerController.refreshDesktopSnapshot === "function") {
          await window.heroMediaPlayerController.refreshDesktopSnapshot({ force: true, renderAfter: false });
        }
        if (typeof window.heroMediaPlayerController.refreshNativeSnapshot === "function") {
          await window.heroMediaPlayerController.refreshNativeSnapshot({ renderAfter: false });
        }
      } catch (error) {
        console.warn("Failed to refresh media context for AI", error);
      }
    }

    const pageContext = document.title || "Signal Share";
    const pageText = document.body.innerText.substring(0, 600);
    const sharedAiContext = window.SignalShareAiCore
      ? window.SignalShareAiCore.buildCompanionContext({
          surface: "main",
          pageTitle: document.title || "",
          pageUrl: window.location.href,
          currentCategory: state.messengerOpen ? "messenger" : "feed",
          visibleText: pageText,
          attachment: aiAttachment
        })
      : "";
    const fullContext = `${pageContext} (Visible text: ${pageText})${sharedAiContext ? `\n\n${sharedAiContext}` : ""}`;
    await activateBridgeForPrompt({ shouldAttemptBridgeRequests, probeLocalNetworkPermission });

    let aiResponse;
    try {
      aiResponse = await callLocalAI({
        text: body,
        history,
        pageContext: fullContext,
        attachment: aiAttachment,
        shouldAttemptBridgeRequests,
        probeLocalNetworkPermission,
        resolveBridgeBaseCandidates,
        getBridgeSecretValue,
        resolvePreferredBridgeModel,
        getBridgeTargetAddressSpace
      });
    } finally {
      state.activeMessages = state.activeMessages.filter((message) => message.id !== thinkingId);
    }

    const aiMessage = {
      id: crypto.randomUUID(),
      threadId: state.activeThreadId,
      senderId: AI_COMPANION_ID,
      body: aiResponse,
      createdAt: new Date().toISOString()
    };
    mergeActiveMessage(aiMessage);
    saveAiMessagesLocally(state, state.activeMessages);

    if (aiResponse && aiResponse.includes("[ARCADE:")) {
      const arcadeMatch = aiResponse.match(/\[ARCADE:\s*([^\]]+)\]/);
      if (arcadeMatch && typeof window.executeArcadeAction === "function") {
        const action = arcadeMatch[1].trim().toLowerCase();
        window.executeArcadeAction(action);
      }
    }

    renderMessenger();
    playIncomingMessageSound();
    showMessengerFeedback("");
  } catch (error) {
    console.error("AI response failed", error);
    showMessengerFeedback("AI Companion is currently offline.", true);
  } finally {
    window.__SIGNAL_MESSENGER_SUBMITTING__ = false;
    state.messengerBusy = Math.max(0, state.messengerBusy - 1);
    if (elements?.messageInput) elements.messageInput.disabled = false;
    if (elements?.sendMessageButton) elements.sendMessageButton.disabled = false;
    renderMessenger();
  }

  return true;
}

async function callLocalAI({
  text,
  history = [],
  pageContext = "",
  attachment = null,
  shouldAttemptBridgeRequests,
  probeLocalNetworkPermission,
  resolveBridgeBaseCandidates,
  getBridgeSecretValue,
  resolvePreferredBridgeModel,
  getBridgeTargetAddressSpace
}) {
  await activateBridgeForPrompt({ shouldAttemptBridgeRequests, probeLocalNetworkPermission });

  const bridgeBaseCandidates = resolveBridgeBaseCandidates();
  if (bridgeBaseCandidates.length === 0) return getGlobalProtocolOfflineResponse(text);

  let abortController = null;
  let stopRequested = false;
  window.stopMessengerAi = () => {
    stopRequested = true;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  const secret = getBridgeSecretValue();
  const preferredModel = resolvePreferredBridgeModel();
  const payload = JSON.stringify({
    message: text,
    ...(preferredModel ? { model: preferredModel } : {}),
    history: Array.isArray(history) ? history : [],
    pageContext: pageContext || "Signal Share",
    attachment
  });

  if (typeof window.bridgeFetch === "function") {
    try {
      abortController = new AbortController();
      const response = await window.bridgeFetch("/api/llm/chat", {
        method: "POST",
        signal: abortController.signal,
        timeoutMs: 45000,
        body: payload
      });
      if (response?.ok) {
        const data = await response.json().catch(() => ({}));
        return data.reply || "I'm having trouble thinking right now.";
      }
      console.debug(
        `[AI Messenger] Shared bridgeFetch returned status ${response?.status ?? "unknown"}; falling back to internal resolver.`
      );
    } catch (error) {
      if (stopRequested) {
        return "🛑 [Signal Protocol] AI request stopped.";
      }
      console.debug("[AI Messenger] Shared bridgeFetch path failed:", error);
    }
  }

  let lastNetworkError = null;
  let lastHttpResponse = null;

  for (const baseUrl of bridgeBaseCandidates) {
    const endpoint = `${baseUrl}/api/llm/chat`;
    try {
      abortController = new AbortController();
      const requestController = abortController;
      const timeoutId = setTimeout(() => {
        requestController.abort();
      }, 45000);

      const targetAddressSpace = getBridgeTargetAddressSpace(baseUrl);
      const headers = { "Content-Type": "application/json" };
      if (secret) headers["X-Bridge-Secret"] = secret;

      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          headers,
          ...(targetAddressSpace ? { targetAddressSpace } : {}),
          signal: requestController.signal,
          body: payload
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        localStorage.setItem("ss_bridge_last_working_base", baseUrl);
        const data = await response.json();
        return data.reply || "I'm having trouble thinking right now.";
      }

      if (response.status === 401 || response.status === 403 || response.status === 422) {
        lastHttpResponse = response;
        break;
      }

      lastHttpResponse = response;
    } catch (error) {
      if (stopRequested) {
        return "🛑 [Signal Protocol] AI request stopped.";
      }
      lastNetworkError = error;
      console.debug(`[AI Messenger] Endpoint failed ${endpoint}:`, error);
    }
  }

  if (lastHttpResponse) {
    console.debug(`[AI Messenger] Bridge returned status ${lastHttpResponse.status}.`);
  } else if (lastNetworkError) {
    console.debug("[AI Messenger] Bridge network error:", lastNetworkError);
  }

  console.log("[AI Messenger] All endpoints failed. Switching to Global Protocol Offline mode.");
  return getGlobalProtocolOfflineResponse(text);
}

async function activateBridgeForPrompt({ shouldAttemptBridgeRequests, probeLocalNetworkPermission }) {
  localStorage.setItem("ss_bridge_enabled", "1");
  localStorage.setItem("signal-share-bridge-enabled", "1");

  if (typeof shouldAttemptBridgeRequests === "function" && shouldAttemptBridgeRequests()) {
    if (typeof probeLocalNetworkPermission === "function") {
      try {
        await probeLocalNetworkPermission();
      } catch (_error) {
        // Probe failures should not block the AI request path.
      }
    }
  }
}

function getGlobalProtocolOfflineResponse(text) {
  const query = (text || "").toLowerCase();

  const responses = {
    hello: "Hello! I'm the Signal Share protocol assistant. My primary logic core is currently offline, but I can still help you with site basics.",
    hi: "Hi there! I'm running on emergency protocol. How can I help you navigate the platform today?",
    help: "I can help you with: \n- **Feed**: How to post and view media.\n- **Messenger**: Sending direct messages.\n- **Account**: Signing in and profile settings.\n- **Media**: Using the Hero Player.\nWhat do you need help with?",
    post: "To post media, use the **Publish Post** section in the sidebar. You can drop images, videos, or audio files there. Note: You need to be signed in to publish to the live feed.",
    feed: "The live feed shows the latest posts from all members. You can filter by 'All', 'Image', 'Video', or 'Audio' using the sort controls at the top.",
    messenger: "You can start a private conversation with any member by clicking 'Message' on their profile. Your conversations sync live across all your devices.",
    profile: "Click on your name in the account section to view your profile. You can change your display name and view your own posts there.",
    hero: "The Hero Media Player at the top handles all your media playback. It supports YouTube, Spotify, and direct file uploads. You can control it using the floating play bar.",
    player: "The Hero Media Player at the top handles all your media playback. It supports YouTube, Spotify, and direct file uploads. You can control it using the floating play bar.",
    who: "I am the Signal Share A.I. Companion. I'm currently running in 'Offline Protocol' mode because I can't reach my primary brain.",
    error: "If you're seeing errors, make sure you have a stable internet connection. If you're running locally, ensure the Bridge server is active on port 3000.",
    offline: "I'm in offline mode because the local bridge server is unreachable. Please check if your backend is running."
  };

  for (const key in responses) {
    if (query.includes(key)) return `📶 [Signal Protocol] ${responses[key]}`;
  }

  return "📶 [Signal Protocol] I'm currently operating in offline mode and don't have a specific response for that. Try asking about 'help', 'posting', 'messenger', or 'the player'.";
}
