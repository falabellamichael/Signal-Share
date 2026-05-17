import { getMessageAttachmentKind } from './shared-utils.js';

let apiContext = {
  state: null,
  APP_CONFIG: null,
  POST_LIKES_TABLE: "post_likes",
  DB_NAME: "signal-share-db",
  DB_VERSION: 1,
  STORE_NAME: "posts"
};

export function setApiContext(context) {
  apiContext = { ...apiContext, ...context };
}

export function getApiContext() {
  return apiContext;
}

function makeSupabaseUnavailableError(message = "Supabase is unavailable.") {
  const error = new Error(message);
  error.code = "SUPABASE_UNAVAILABLE";
  return error;
}

function normalizeSupabaseFailure(error, fallback = "Supabase request failed.") {
  const message = error?.message || "";
  if (message.includes("Cannot read properties of null") || message.includes("reading 'status'") || message.includes('reading "status"')) {
    return makeSupabaseUnavailableError(fallback);
  }
  if (error?.code === "SUPABASE_UNAVAILABLE") return error;
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const details = [error.message, error.details, error.hint, error.code ? `Code: ${error.code}` : ""].filter(Boolean).join(" ");
    return makeSupabaseUnavailableError(details || fallback);
  }
  return makeSupabaseUnavailableError(fallback);
}

function createOfflineSupabaseClient(reason = "Supabase unavailable") {
  const chain = {};
  const chainMethods = ["select", "order", "eq", "or", "not", "maybeSingle", "single", "insert", "upsert", "delete"];
  for (const method of chainMethods) chain[method] = () => chain;
  chain.then = undefined;

  return {
    __signalShareOfflineSupabase: true,
    reason,
    from: () => chain,
    rpc: async () => ({ data: null, error: makeSupabaseUnavailableError(reason) }),
    functions: {
      invoke: async () => ({ data: null, error: makeSupabaseUnavailableError(reason) })
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: makeSupabaseUnavailableError(reason) }),
        remove: async () => ({ data: null, error: makeSupabaseUnavailableError(reason) }),
        getPublicUrl: () => ({ data: { publicUrl: "" } })
      })
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      setSession: async () => ({ data: { session: null }, error: makeSupabaseUnavailableError(reason) }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
      subscribe: () => ({ unsubscribe() {} }),
      unsubscribe() {}
    }),
    removeChannel: () => {}
  };
}

function activateSupabaseOfflineFallback(error) {
  const reason = error?.message || "Supabase is unavailable.";
  const offlineClient = createOfflineSupabaseClient(reason);
  if (apiContext.state) {
    apiContext.state.backendMode = "local";
    apiContext.state.backendError = reason;
    apiContext.state.authRestoring = false;
    apiContext.state.currentUser = null;
    apiContext.state.supabase = offlineClient;
  }
  window.__supabaseClient = offlineClient;
  return window.__supabaseClient;
}

function isSupabaseUnavailable(error) {
  return normalizeSupabaseFailure(error).code === "SUPABASE_UNAVAILABLE";
}

function ensureSupabaseSdkAvailable() {
  const config = apiContext.APP_CONFIG || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw makeSupabaseUnavailableError("Supabase configuration is missing.");
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw makeSupabaseUnavailableError("Supabase SDK is not loaded.");
  }
}

function getSupabaseClientOrThrow() {
  const client = apiContext.state?.supabase;
  if (!client || typeof client.from !== "function" || client.__signalShareOfflineSupabase) {
    throw makeSupabaseUnavailableError("Supabase client is not initialized.");
  }
  return client;
}

async function runSupabaseQuery(queryPromise, fallback = "Supabase request failed.") {
  try {
    const result = await queryPromise;
    if (!result || typeof result !== "object") {
      throw makeSupabaseUnavailableError(fallback);
    }
    const { data, error } = result;
    if (error) throw error;
    return data;
  } catch (error) {
    throw normalizeSupabaseFailure(error, fallback);
  }
}

export function createSupabaseClient() {
  if (window.__supabaseClient && !window.__supabaseClient.__signalShareOfflineSupabase) {
    return window.__supabaseClient;
  }
  try {
    ensureSupabaseSdkAvailable();
    const client = window.supabase.createClient(apiContext.APP_CONFIG.supabaseUrl, apiContext.APP_CONFIG.supabaseAnonKey, {
      db: {
        schema: 'public'
      }
    });
    window.__supabaseClient = client;
    return client;
  } catch (error) {
    return activateSupabaseOfflineFallback(normalizeSupabaseFailure(error, "Supabase setup failed."));
  }
}

export async function loadPostsFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from(apiContext.APP_CONFIG.postsTable).select("*").order("created_at", { ascending: false }),
      "Supabase posts request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeSupabasePost);
  } catch (error) {
    throw normalizeSupabaseFailure(error, "Supabase posts request failed.");
  }
}

export async function loadLikedPostsFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const userId = apiContext.state?.currentUser?.id;
    if (!userId) return [];
    const data = await runSupabaseQuery(
      client.from(apiContext.POST_LIKES_TABLE).select("post_id").eq("user_id", userId),
      "Supabase likes request failed."
    );
    return (Array.isArray(data) ? data : []).map((row) => row.post_id).filter((id) => typeof id === "string" && id.trim());
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadProfilesFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from("profiles").select("*").order("display_name", { ascending: true }),
      "Supabase profiles request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeProfile);
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadOwnProfileFromSupabase() {
  try {
    if (!apiContext.state.currentUser) return null;
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from("profiles").select("*").eq("id", apiContext.state.currentUser.id).maybeSingle(),
      "Supabase profile request failed."
    );
    return data ? normalizeProfile(data) : null;
  } catch (error) {
    if (isSupabaseUnavailable(error)) return null;
    throw error;
  }
}

export async function loadUserBansFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from("user_bans").select("*").order("created_at", { ascending: false }),
      "Supabase user bans request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeUserBan);
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadCurrentUserBanFromSupabase() {
  try {
    if (!apiContext.state.supabase || !apiContext.state.currentUser) return null;
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from("user_bans").select("*").eq("banned_id", apiContext.state.currentUser.id).maybeSingle(),
      "Supabase current user ban request failed."
    );
    return data ? normalizeUserBan(data) : null;
  } catch (error) {
    if (isSupabaseUnavailable(error)) return null;
    throw error;
  }
}

export async function loadBlockedUsersFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const userId = apiContext.state?.currentUser?.id;
    if (!userId) return [];
    const data = await runSupabaseQuery(
      client.from("user_blocks").select("*").eq("blocker_id", userId),
      "Supabase blocked users request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeUserBlock);
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadSiteSettingsFromSupabase() {
  try {
    const client = getSupabaseClientOrThrow();
    const data = await runSupabaseQuery(
      client.from("site_settings").select("*").eq("id", "global").maybeSingle(),
      "Supabase site settings request failed."
    );
    return data ? normalizeSiteSettings(data) : null;
  } catch (error) {
    if (isSupabaseUnavailable(error)) return null;
    throw error;
  }
}

export async function syncCurrentProfileToSupabase(displayNameOverride = "") {
  const { state } = apiContext;
  if (!state.currentUser) throw new Error("Authentication required to sync profile.");

  const explicitDisplayName = typeof displayNameOverride === "string" ? displayNameOverride.trim() : "";
  const fallbackDisplayName =
    state.profileRecord?.displayName
    || state.currentUser?.displayName
    || state.currentUser?.user_metadata?.display_name
    || state.currentUser?.user_metadata?.full_name
    || state.currentUser?.user_metadata?.name
    || "";

  let displayName = (explicitDisplayName || fallbackDisplayName || "").trim().slice(0, 40);
  if (displayName.length < 2) {
    displayName = "Member";
  }

  const payload = {
    id: state.currentUser.id,
    email: state.currentUser.email,
    display_name: displayName,
    theme: state.preferences?.theme || "",
    density: state.preferences?.density || "",
    motion: state.preferences?.motion || "",
    status_bar_strip: state.preferences?.statusBarStrip ?? null,
    notification_hide_sender: Boolean(state.preferences?.notificationHideSender),
    notification_hide_body: Boolean(state.preferences?.notificationHideBody),
    show_email: state.preferences?.showEmail ?? null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await state.supabase.from("profiles").upsert(payload, { onConflict: "id" }).select().single();
  if (error) throw error;
  return normalizeProfile(data);
}

export async function loadDirectThreadsFromSupabase() {
  try {
    if (!apiContext.state.currentUser) return [];
    const userId = apiContext.state.currentUser.id;
    const data = await runSupabaseQuery(
      getSupabaseClientOrThrow()
        .from("direct_threads")
        .select("*")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
        .order("updated_at", { ascending: false }),
      "Supabase direct threads request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeDirectThread);
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadMessagesFromSupabase(threadId) {
  try {
    const data = await runSupabaseQuery(
      getSupabaseClientOrThrow()
        .from("messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true }),
      "Supabase messages request failed."
    );
    return (Array.isArray(data) ? data : []).map(normalizeMessage);
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function loadThreadAttachmentPaths(threadId) {
  try {
    const data = await runSupabaseQuery(
      getSupabaseClientOrThrow()
        .from("messages")
        .select("attachment_file_path")
        .eq("thread_id", threadId)
        .not("attachment_file_path", "is", null),
      "Supabase thread attachment request failed."
    );
    return (Array.isArray(data) ? data : []).map((row) => row.attachment_file_path).filter((path) => typeof path === "string" && path.trim());
  } catch (error) {
    if (isSupabaseUnavailable(error)) return [];
    throw error;
  }
}

export async function getOrCreateDirectThread(partnerId) {
  if (!apiContext.state.currentUser || !partnerId) throw new Error("Missing requirements for thread creation.");
  const [userOneId, userTwoId] = [apiContext.state.currentUser.id, partnerId].sort();
  const { data: existing, error: existingError } = await apiContext.state.supabase
    .from("direct_threads")
    .select("*")
    .eq("user_one_id", userOneId)
    .eq("user_two_id", userTwoId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return normalizeDirectThread(existing);

  const { data: inserted, error: insertError } = await apiContext.state.supabase
    .from("direct_threads")
    .insert({ user_one_id: userOneId, user_two_id: userTwoId })
    .select()
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate, error: duplicateError } = await apiContext.state.supabase
        .from("direct_threads")
        .select("*")
        .eq("user_one_id", userOneId)
        .eq("user_two_id", userTwoId)
        .single();
      if (duplicateError) throw duplicateError;
      return normalizeDirectThread(duplicate);
    }
    throw insertError;
  }
  return normalizeDirectThread(inserted);
}

export async function sendMessageToSupabase(threadId, text, attachmentFile, onProgress) {
  if (!apiContext.state.currentUser || !threadId) throw new Error("Missing requirements for message delivery.");
  const messageId = crypto.randomUUID();
  let attachment = null;
  if (attachmentFile) {
    attachment = await uploadMessageAttachment(threadId, messageId, attachmentFile, onProgress);
  }

  const payload = {
    id: messageId,
    thread_id: threadId,
    sender_id: apiContext.state.currentUser.id,
    body: text || "",
    attachment_url: attachment?.attachment_url ?? null,
    attachment_file_path: attachment?.attachment_file_path ?? null,
    attachment_name: attachment?.attachment_name ?? null,
    attachment_type: attachment?.attachment_type ?? null,
    attachment_size: attachment?.attachment_size ?? null,
    attachment_kind: attachment?.attachment_kind ?? null
  };

  const { data, error } = await apiContext.state.supabase.from("messages").insert(payload).select().single();
  if (error) throw error;
  return normalizeMessage(data);
}



export async function publishPostToSupabase(post, onProgress) {
  let mediaUrl = post.mediaUrl ?? null, filePath = post.filePath ?? null, fileType = post.fileType ?? null, fileSize = post.fileSize ?? null;
  if (post.sourceKind === "upload" && post.blob) { const uploaded = await uploadFileToSupabase(post.id, post.blob, onProgress); mediaUrl = uploaded.mediaUrl; filePath = uploaded.filePath; fileType = post.fileType; fileSize = post.fileSize; }
  const payload = { id: post.id, author_id: apiContext.state.currentUser?.id ?? null, creator: post.creator, title: post.title, caption: post.caption, tags: post.tags, media_kind: post.mediaKind, source_kind: post.sourceKind, provider: post.provider ?? null, media_url: mediaUrl, external_url: post.externalUrl ?? null, embed_url: post.embedUrl ?? null, external_id: post.externalId ?? null, label: post.label ?? null, file_path: filePath, file_type: fileType, file_size: fileSize, likes: post.likes ?? 0 };
  const { data, error } = await apiContext.state.supabase.from(apiContext.APP_CONFIG.postsTable).insert(payload).select().single();
  if (error) throw error; return normalizeSupabasePost(data);
}

export async function compressImageFile(file, maxWidth = 1920, quality = 0.8) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth || height > maxWidth) {
        if (width > height) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        else { width = Math.round((width * maxWidth) / height); height = maxWidth; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        const extension = file.name.split('.').pop();
        const newName = file.name.replace(new RegExp(`\\.${extension}$`, 'i'), '.webp');
        resolve(new File([blob], newName, { type: "image/webp" }));
      }, "image/webp", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export async function uploadFileToSupabase(postId, file, onProgress) {
  const compressedFile = await compressImageFile(file);
  const safeName = compressedFile.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-"); 
  const ownerPath = apiContext.state.currentUser?.id ? `${apiContext.state.currentUser.id}/` : ""; 
  const filePath = `${ownerPath}${postId}/${safeName}`;
  
  // Use resumable upload for files larger than 5MB or if it's a video/audio
  const isLargeFile = compressedFile.size > 5 * 1024 * 1024;
  const isMedia = compressedFile.type.startsWith("video/") || compressedFile.type.startsWith("audio/");
  
  if (isLargeFile || isMedia) {
    return resumableUploadFile(filePath, compressedFile, onProgress);
  }

  const { error } = await apiContext.state.supabase.storage.from(apiContext.APP_CONFIG.storageBucket).upload(filePath, compressedFile, { cacheControl: "31536000", upsert: false, contentType: compressedFile.type });
  if (error) throw error; 
  const { data } = apiContext.state.supabase.storage.from(apiContext.APP_CONFIG.storageBucket).getPublicUrl(filePath); 
  return { filePath, mediaUrl: data.publicUrl };
}

export async function resumableUploadFile(filePath, file, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const { data: { session } } = await apiContext.state.supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No active session found");

      const bucketName = apiContext.APP_CONFIG.storageBucket;
      const url = `${apiContext.APP_CONFIG.supabaseUrl}/storage/v1/upload/resumable`;

      const upload = new window.tus.Upload(file, {
        endpoint: url,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${token}`,
          'x-upsert': 'true'
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: bucketName,
          objectName: filePath,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '31536000'
        },
        chunkSize: 6 * 1024 * 1024, // 6MB chunks
        onError: (error) => {
          console.error("TUS upload error:", error);
          reject(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          if (onProgress) {
            const percentage = (bytesUploaded / bytesTotal * 100).toFixed(2);
            onProgress(percentage);
          }
        },
        onSuccess: () => {
          const { data } = apiContext.state.supabase.storage.from(bucketName).getPublicUrl(filePath);
          resolve({ filePath, mediaUrl: data.publicUrl });
        }
      });

      // Check if there are any previous uploads to continue
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
    } catch (error) {
      reject(error);
    }
  });
}

export async function uploadMessageAttachment(threadId, messageId, file, onProgress) {
  const compressedFile = await compressImageFile(file);
  const safeName = compressedFile.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, "-"); 
  const ownerPath = apiContext.state.currentUser?.id ? `${apiContext.state.currentUser.id}/` : ""; 
  const filePath = `${ownerPath}messages/${threadId}/${messageId}/${safeName}`;
  
  const isLargeFile = compressedFile.size > 5 * 1024 * 1024;
  const isMedia = compressedFile.type.startsWith("video/") || compressedFile.type.startsWith("audio/");
  
  let result;
  if (isLargeFile || isMedia) {
    result = await resumableUploadFile(filePath, compressedFile, onProgress);
  } else {
    const { error } = await apiContext.state.supabase.storage.from(apiContext.APP_CONFIG.storageBucket).upload(filePath, compressedFile, { cacheControl: "31536000", upsert: false, contentType: compressedFile.type || "application/octet-stream" });
    if (error) throw error; 
    const { data } = apiContext.state.supabase.storage.from(apiContext.APP_CONFIG.storageBucket).getPublicUrl(filePath);
    result = { mediaUrl: data.publicUrl, filePath };
  }

  return { 
    attachment_url: result.mediaUrl, 
    attachment_file_path: result.filePath, 
    attachment_name: compressedFile.name, 
    attachment_type: compressedFile.type || "application/octet-stream", 
    attachment_size: compressedFile.size, 
    attachment_kind: getMessageAttachmentKind(compressedFile.type) 
  };
}

export async function deleteHostedPost(post) {
  if (post.filePath) { const { error: storageError } = await apiContext.state.supabase.storage.from(apiContext.APP_CONFIG.storageBucket).remove([post.filePath]); if (storageError) throw storageError; }
  const { error } = await apiContext.state.supabase.from(apiContext.APP_CONFIG.postsTable).delete().eq("id", post.id); if (error) throw error;
}

export function normalizeSupabasePost(row) { 
  const post = { id: row.id, authorId: row.author_id ?? null, creator: row.creator, title: row.title, caption: row.caption, tags: Array.isArray(row.tags) ? row.tags : [], createdAt: row.created_at, mediaKind: row.media_kind, sourceKind: row.source_kind ?? "upload", provider: row.provider ?? null, src: row.media_url ?? "", mediaUrl: row.media_url ?? "", externalUrl: row.external_url ?? null, embedUrl: row.embed_url ?? null, externalId: row.external_id ?? null, label: row.label ?? null, filePath: row.file_path ?? null, fileType: row.file_type ?? null, fileSize: row.file_size ?? null, likes: row.likes ?? 0, isLocal: false }; 
  
  // Sync src with embedUrl for external providers if media_url is missing
  if ((post.sourceKind === "youtube" || post.sourceKind === "spotify") && !post.src && post.embedUrl) {
    post.src = post.embedUrl;
  }
  
  // On-the-fly healing for YouTube posts (Syncing logic from MainActivity)
  const fields = [post.externalUrl, post.embedUrl, post.externalId, post.mediaUrl, post.src, post.label, post.caption, post.title].join(" ");
  const isYouTubeHint = post.sourceKind === "youtube" || fields.toLowerCase().includes("youtu") || fields.toLowerCase().includes("vnd.youtube");
  
  const hasValidEmbed = typeof post.embedUrl === "string" && post.embedUrl.includes("youtube.com/embed/");
  
  if (isYouTubeHint && (!post.externalId || !hasValidEmbed)) {
    const repairCandidates = [post.externalUrl, post.embedUrl, post.externalId, post.mediaUrl, post.src, post.label, post.caption, post.title];
    let repaired = null;
    for (const candidate of repairCandidates) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      repaired = parseYouTubeUrl(candidate);
      if (repaired) break;
    }
    if (repaired) {
      post.externalId = repaired.externalId;
      post.embedUrl = repaired.embedUrl;
      post.src = repaired.embedUrl; // Sync src for player compatibility
      post.sourceKind = "youtube";
      post.mediaKind = "video";
      post.provider = "youtube";
    }
  }
  
  return post;
}

export function normalizeProfile(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    theme: typeof row.theme === "string" ? row.theme : "",
    density: typeof row.density === "string" ? row.density : "",
    motion: typeof row.motion === "string" ? row.motion : "",
    statusBarStrip: typeof row.status_bar_strip === "boolean" ? row.status_bar_strip : null,
    notificationHideSender: Boolean(row.notification_hide_sender),
    notificationHideBody: Boolean(row.notification_hide_body),
    showEmail: typeof row.show_email === "boolean" ? row.show_email : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeUserBlock(row) {
  return { blockerId: row.blocker_id, blockedId: row.blocked_id, createdAt: row.created_at };
}

export function normalizeUserBan(row) {
  return { bannedId: row.banned_id, bannedBy: row.banned_by, reason: row.reason ?? "", createdAt: row.created_at };
}

export function normalizeDirectThread(row) {
  return {
    id: row.id,
    userOneId: row.user_one_id,
    userTwoId: row.user_two_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    body: row.body ?? "",
    attachmentUrl: row.attachment_url ?? null,
    attachmentFilePath: row.attachment_file_path ?? null,
    attachmentName: row.attachment_name ?? null,
    attachmentType: row.attachment_type ?? null,
    attachmentSize: row.attachment_size ?? null,
    attachmentKind: row.attachment_kind ?? null,
    createdAt: row.created_at
  };
}

export function normalizeSiteSettings(row = {}) {
  const defaults = {
    shellWidth: 1200,
    sectionGap: 24,
    surfaceRadius: 32,
    mediaFit: "cover"
  };
  
  const clampNumber = (val, min, max, def) => {
    const num = Number(val);
    return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : def;
  };

  return {
    shellWidth: clampNumber(row.shell_width, 960, 1440, defaults.shellWidth),
    sectionGap: clampNumber(row.section_gap, 16, 40, defaults.sectionGap),
    surfaceRadius: clampNumber(row.surface_radius, 22, 44, defaults.surfaceRadius),
    mediaFit: row.media_fit === "contain" ? "contain" : defaults.mediaFit
  };
}

export function parseYouTubeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  const value = raw.trim();
  
  // 1. Check if it's just an 11-char ID (Android logic: value.matches("^[A-Za-z0-9_-]{11}$"))
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) {
    return buildYouTubeObject(value, raw);
  }

  // 2. Check for vnd.youtube: prefix (Android logic: rawUrl.startsWith("vnd.youtube:"))
  if (value.toLowerCase().startsWith("vnd.youtube:")) {
    const id = trimYoutubeVideoId(value.slice(12)); // "vnd.youtube:".length is 12
    if (id) return buildYouTubeObject(id, raw);
  }

  // 3. Try parsing as a URL (Android logic: Uri.parse(rawUrl))
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    const host = (url.hostname || "").toLowerCase();
    
    // youtu.be/ID (Android logic: host.contains("youtu.be"))
    if (host.includes("youtu.be")) {
      const id = trimYoutubeVideoId(url.pathname.replace("/", ""));
      if (id) return buildYouTubeObject(id, raw);
    }
    
    // youtube.com/watch?v=ID (Android logic: uri.getQueryParameter("v"))
    const v = url.searchParams.get("v") || url.searchParams.get("vi");
    if (v) {
      const id = trimYoutubeVideoId(v);
      if (id) return buildYouTubeObject(id, raw);
    }
    
    // segments like /embed/ID, /shorts/ID, /live/ID, /v/ID (Android logic: segments loop)
    const segments = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i].toLowerCase();
      if (["embed", "shorts", "live", "v"].includes(s)) {
        if (segments[i + 1]) {
          const id = trimYoutubeVideoId(segments[i + 1]);
          if (id) return buildYouTubeObject(id, raw);
        }
      }
    }
  } catch (e) {
    // URL parsing failed, fall back to regex scan
  }

  // 4. Final Regex Fallback (Matches the robust scan pattern in Android and previous JS version)
  const regex = /(?:v=|v\/|vi\/|embed\/|shorts\/|live\/|youtu\.be\/|vnd\.youtube:)([a-zA-Z0-9_-]{11})/i;
  const match = value.match(regex);
  if (match && match[1]) return buildYouTubeObject(match[1], raw);

  const labelMatch = value.match(/\byoutube\s+video\s+([a-zA-Z0-9_-]{11})\b/i);
  if (labelMatch && labelMatch[1]) return buildYouTubeObject(labelMatch[1], raw);
  
  return null;
}

function trimYoutubeVideoId(id) {
  if (!id) return "";
  const trimmed = id.trim();
  return trimmed.length > 11 ? trimmed.slice(0, 11) : trimmed;
}

function buildYouTubeObject(videoId, originalUrl) {
  if (!videoId || videoId.length !== 11) return null;
  return { 
    provider: "youtube", 
    mediaKind: "video", 
    externalId: videoId, 
    embedUrl: `https://www.youtube.com/embed/${videoId}?rel=0`, 
    originalUrl, 
    label: `YouTube video ${videoId}` 
  };
}

export function openDatabase() { 
  return new Promise((res, rej) => { 
    const req = indexedDB.open(apiContext.DB_NAME, apiContext.DB_VERSION); 
    req.addEventListener("upgradeneeded", () => { const db = req.result; if (!db.objectStoreNames.contains(apiContext.STORE_NAME)) db.createObjectStore(apiContext.STORE_NAME, { keyPath: "id" }); }); 
    req.addEventListener("success", () => res(req.result)); 
    req.addEventListener("error", () => rej(req.error)); 
  }); 
}

export function loadPostsFromDatabase() { 
  return new Promise((res, rej) => { 
    const tx = apiContext.state.db.transaction(apiContext.STORE_NAME, "readonly"); 
    const store = tx.objectStore(apiContext.STORE_NAME); 
    const req = store.getAll(); 
    req.addEventListener("success", () => res(req.result)); 
    req.addEventListener("error", () => rej(req.error)); 
  }); 
}

export function savePostToDatabase(post) { 
  return new Promise((res, rej) => { 
    const tx = apiContext.state.db.transaction(apiContext.STORE_NAME, "readwrite"); 
    const store = tx.objectStore(apiContext.STORE_NAME); 
    store.put(post); 
    tx.addEventListener("complete", () => res()); 
    tx.addEventListener("error", () => rej(tx.error)); 
  }); 
}

export function deletePostFromDatabase(id) { 
  return new Promise((res, rej) => { 
    const tx = apiContext.state.db.transaction(apiContext.STORE_NAME, "readwrite"); 
    const store = tx.objectStore(apiContext.STORE_NAME); 
    store.delete(id); 
    tx.addEventListener("complete", () => res()); 
    tx.addEventListener("error", () => rej(tx.error)); 
  }); 
}
