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

function getMessageAttachmentKind(type = "") { 
  if (type.startsWith("image/")) return "image"; 
  if (type.startsWith("video/")) return "video"; 
  if (type.startsWith("audio/")) return "audio"; 
  return "file"; 
}

export function createSupabaseClient() {
  if (window.__supabaseClient) return window.__supabaseClient;
  const client = window.supabase.createClient(apiContext.APP_CONFIG.supabaseUrl, apiContext.APP_CONFIG.supabaseAnonKey, {
    db: {
      schema: 'public'
    }
  });
  window.__supabaseClient = client;
  return client;
}

export async function loadPostsFromSupabase() { 
  const { data, error } = await apiContext.state.supabase.from(apiContext.APP_CONFIG.postsTable).select("*").order("created_at", { ascending: false }); 
  if (error) throw error; 
  return data.map(normalizeSupabasePost); 
}

export async function loadLikedPostsFromSupabase() { 
  const { data, error } = await apiContext.state.supabase.from(apiContext.POST_LIKES_TABLE).select("post_id").eq("user_id", apiContext.state.currentUser.id); 
  if (error) throw error; 
  return data.map((row) => row.post_id).filter((id) => typeof id === "string" && id.trim()); 
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
    const repaired = parseYouTubeUrl(post.externalUrl || post.embedUrl || post.externalId || post.mediaUrl || post.src || post.label || post.caption || post.title || "");
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
