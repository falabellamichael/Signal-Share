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
  playIncomingMessageSound
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

    let aiResponse;
    try {
      aiResponse = await callLocalAI({
        text: body,
        history,
        pageContext: fullContext,
        attachment: aiAttachment
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
  attachment = null
}) {
  let abortController = new AbortController();
  let stopRequested = false;
  window.stopMessengerAi = () => {
    stopRequested = true;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  let reply = null;
  let lastError = null;

  const modelSelect = document.getElementById("chat-model-select");
  const selectedModel = modelSelect ? modelSelect.value : "auto";
  const requestModel = typeof window.resolveChatRequestModel === "function"
    ? window.resolveChatRequestModel(selectedModel)
    : (`${selectedModel || "auto"}`.trim() || "auto");
  const coreInstructions = window.SignalShareAiCore?.getStoredCustomInstructions;
  const customInstructions = typeof coreInstructions === "function"
    ? coreInstructions()
    : `${localStorage.getItem("ss_ai_custom_instructions") || ""}`.trim().slice(0, 2000);

  if (typeof window.isBridgeFeatureEnabled === "function" && !window.isBridgeFeatureEnabled()) {
    localStorage.setItem("ss_bridge_enabled", "1");
  }

  if (typeof window.bridgeFetch !== "function") {
    lastError = "Bridge fetch unavailable";
  } else {
    const bridgePayload = JSON.stringify({
      message: text,
      model: requestModel,
      customInstructions,
      attachment,
      history: Array.isArray(history) ? history : [],
      pageContext: pageContext || "Signal Share"
    });
    const candidateChatPaths = ["/api/local-llm/chat", "/api/llm/chat"];

    for (const chatPath of candidateChatPaths) {
      try {
        const response = await window.bridgeFetch(chatPath, {
          method: "POST",
          signal: abortController.signal,
          timeoutMs: 45000,
          body: bridgePayload
        });

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          reply = data.reply;
          break;
        }

        if (response.status === 404 && chatPath !== candidateChatPaths[candidateChatPaths.length - 1]) {
          continue;
        }

        lastError = `Bridge returned ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          // If local-llm auth fails, fall back to legacy bridge chat route.
          // This keeps AI available when token/secret settings are partial.
          if (chatPath === "/api/local-llm/chat") {
            continue;
          }
          break;
        }
      } catch (error) {
        if (stopRequested) {
          return "🛑 [Signal Protocol] AI request stopped.";
        }
        const bridgeDisabled = error?.name === "BridgeDisabledError";
        lastError = bridgeDisabled
          ? "Bridge disabled"
          : (error?.message || "Connection refused or blocked by browser");
        if (!bridgeDisabled) {
          console.warn(`[AI Messenger] Bridge request failed (${chatPath}):`, error);
        }
      }

      if (reply !== null) break;
    }
  }

  if (reply !== null) {
    return reply || "...";
  }

  if (lastError && lastError !== "Bridge disabled") {
    console.warn(`[AI Messenger] Primary bridge failed (${lastError}). Switching to Offline Protocol.`);
  }

  return getGlobalProtocolOfflineResponse(text);
}

function getGlobalProtocolOfflineResponse(text) {
  const input = (text || "").toLowerCase();

  const responses = [
    {
      keywords: ["pinball", "gravity"],
      answer: "🕹️ [Arcade Protocol]: In Neon Pinball, keep your eyes on the top bumpers. Hitting them in sequence triggers the 'Gravity Shift' multiplier, which can triple your score in seconds!"
    },
    {
      keywords: ["basketball", "hoops", "shot"],
      answer: "🏀 [Arcade Protocol]: For Neon Hoops, consistency is key. Try to release the ball at the peak of your swipe for a 'Perfect' shot bonus. The net gets smaller as your streak increases!"
    },
    {
      keywords: ["snake", "wrap", "trap"],
      answer: "🐍 [Arcade Protocol]: In Neon Snake, the board is edge-wrapped. If you're about to crash, move through the wall to appear on the other side. Use this to surprise high-value fruit!"
    },
    {
      keywords: ["hello", "hi", "hey"],
      answer: "👋 [Arcade Protocol]: Intelligence core is currently offline, but I am standing by for tactical support. Ask me about the games or how to improve your high score!"
    },
    {
      keywords: ["help", "what can you do"],
      answer: "🎮 [Arcade Protocol]: I am your tactical game assistant. Even in offline mode, I can provide tips for Pinball, Hoops, and Snake. Just ask about a specific game!"
    },
    {
      keywords: ["thank", "thanks"],
      answer: "🕹️ [Arcade Protocol]: You're welcome, player. Now get back in there and break that record!"
    }
  ];

  for (const response of responses) {
    if (response.keywords.some((keyword) => input.includes(keyword))) {
      return response.answer;
    }
  }

  const fallbacks = [
    "📶 [Arcade Protocol]: My advanced logic core is currently out of range. Check if your Arcade Companion bridge is running on your PC!",
    "📡 [Arcade Protocol]: Communication with the main intelligence core is unstable. Ensure the bridge server is active and try again.",
    "🕹️ [Arcade Protocol]: Sync failed. I'm relying on cached arcade data. If you're on a real device, check your bridge IP settings!",
    "🎮 [Arcade Protocol]: My logic processors are running local-only. (Bridge unreachable). I can still help with game tips though!"
  ];

  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}
