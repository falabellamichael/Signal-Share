import { createClient } from "npm:@supabase/supabase-js@2";
import {
  loadSocialOAuthConfig,
  type XOAuthConfig,
} from "../_shared/social-oauth-config.ts";

type SocialProvider = "facebook" | "instagram" | "x" | "linkedin";
type SocialMediaKind = "image" | "gif" | "video" | "document";

type SocialPublishPayload = {
  providers?: unknown;
  connectionIds?: unknown;
  text?: unknown;
  linkUrl?: unknown;
  mediaUrl?: unknown;
  mediaKind?: unknown;
  mediaMimeType?: unknown;
  mediaTitle?: unknown;
  mediaAltText?: unknown;
  imageUrl?: unknown;
  instagramImageUrl?: unknown;
  instagramHashtags?: unknown;
  instagramShareToFeed?: unknown;
};

type ProviderResult = {
  provider: SocialProvider;
  ok: boolean;
  id?: string;
  error?: string;
};

type SocialConnection = {
  id: string;
  provider: SocialProvider;
  provider_account_id: string;
  provider_account_label: string | null;
  access_token: string;
  refresh_token: string | null;
  token_type: string | null;
  scopes: string[] | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

type TokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type SocialMedia = {
  url: string;
  kind: SocialMediaKind;
  mimeType: string;
  title: string;
  altText: string;
};

type RemoteMedia = {
  bytes: Uint8Array;
  mimeType: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SOCIAL_TOKEN_ENCRYPTION_KEY = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") ?? "";
const META_GRAPH_API_VERSION = readString(Deno.env.get("META_GRAPH_API_VERSION"), 32);
const LINKEDIN_API_VERSION = readString(Deno.env.get("LINKEDIN_API_VERSION"), 16) || "202603";
const MAX_REMOTE_MEDIA_BYTES = 100 * 1024 * 1024;

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase environment variables are incomplete." }, 500);
    }
    if (!SOCIAL_TOKEN_ENCRYPTION_KEY) {
      return jsonResponse({ error: "Social token encryption is not configured." }, 500);
    }

    const auth = await authenticateCaller(request);
    if (!auth.user) {
      return jsonResponse({ error: "Sign in before posting directly to connected Social providers." }, 401);
    }

    const payload = await request.json().catch(() => ({} as SocialPublishPayload));
    const providers = readProviders(payload.providers);
    if (!providers.length) {
      return jsonResponse({ error: "Select at least one Social provider." }, 400);
    }

    const linkUrl = normalizeHttpUrl(payload.linkUrl);
    if (readString(payload.linkUrl) && !linkUrl) {
      return jsonResponse({ error: "Optional link URL must use http or https." }, 400);
    }
    const mediaInputUrl = payload.mediaUrl || payload.imageUrl || payload.instagramImageUrl;
    const mediaUrl = normalizeHttpUrl(mediaInputUrl);
    if (readString(mediaInputUrl) && !mediaUrl) {
      return jsonResponse({ error: "Optional media URL must use http or https." }, 400);
    }
    const mediaKind = readMediaKind(payload.mediaKind) || (mediaUrl ? "image" : "");
    if (mediaKind && !mediaUrl) {
      return jsonResponse({ error: "A media URL is required for the selected attachment type." }, 400);
    }
    const media: SocialMedia | null = mediaUrl && mediaKind
      ? {
        url: mediaUrl,
        kind: mediaKind,
        mimeType: readString(payload.mediaMimeType, 120).toLowerCase(),
        title: readString(payload.mediaTitle, 300),
        altText: readString(payload.mediaAltText, 1000),
      }
      : null;

    const adminClient = createAdminClient();
    const connections = await loadConnections(adminClient, auth.user.id, providers, readConnectionIds(payload.connectionIds));
    const draft = {
      text: readString(payload.text, 6000),
      linkUrl,
      media,
      instagramHashtags: readString(payload.instagramHashtags, 500),
      instagramShareToFeed: payload.instagramShareToFeed !== false,
    };
    const results: ProviderResult[] = [];
    for (const provider of providers) {
      results.push(await publishProvider(adminClient, provider, connections.get(provider), draft));
    }
    return jsonResponse({ ok: results.every((result) => result.ok), results });
  } catch (error) {
    console.error("[Social Publish] Fatal error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "An unexpected server error occurred." }, 500);
  }
});

async function publishProvider(
  adminClient: ReturnType<typeof createAdminClient>,
  provider: SocialProvider,
  connection: SocialConnection | undefined,
  draft: {
    text: string;
    linkUrl: string;
    media: SocialMedia | null;
    instagramHashtags: string;
    instagramShareToFeed: boolean;
  }
): Promise<ProviderResult> {
  try {
    if (!connection) {
      return {
        provider,
        ok: false,
        error: `Connect ${providerLabel(provider)} before posting directly.`,
      };
    }
    const readyConnection = await connectionForPublish(adminClient, connection);
    if (provider === "facebook") {
      return publishFacebook(readyConnection, draft.text, draft.linkUrl, draft.media);
    }
    if (provider === "instagram") {
      return publishInstagram(readyConnection, draft.text, draft.instagramHashtags, draft.media, draft.instagramShareToFeed);
    }
    if (provider === "x") {
      return publishX(readyConnection, draft.text, draft.linkUrl, draft.media);
    }
    return publishLinkedIn(readyConnection, draft.text, draft.linkUrl, draft.media);
  } catch (error) {
    return {
      provider,
      ok: false,
      error: error instanceof Error ? error.message : "Provider publish failed.",
    };
  }
}

async function publishFacebook(
  connection: SocialConnection,
  text: string,
  linkUrl: string,
  media: SocialMedia | null
): Promise<ProviderResult> {
  const provider: SocialProvider = "facebook";
  if (media?.kind === "document") {
    return { provider, ok: false, error: "Facebook direct publishing does not accept document attachments." };
  }
  if (!text && !linkUrl && !media) {
    return { provider, ok: false, error: "Facebook needs post text, a link, an image, a GIF, or a video." };
  }
  const accessToken = await decryptToken(connection.access_token);
  if (media?.kind === "video") {
    const body = new URLSearchParams({ access_token: accessToken, file_url: media.url });
    const description = [text, linkUrl].filter(Boolean).join("\n\n");
    if (description) body.set("description", description);
    if (media.title) body.set("title", media.title);
    const payload = await requestProviderJson(metaGraphVideoUrl(`${encodeURIComponent(connection.provider_account_id)}/videos`), {
      method: "POST",
      body,
    }, provider);
    return { provider, ok: true, id: readString(recordValue(payload).id, 300) };
  }
  if (media) {
    const body = new URLSearchParams({ access_token: accessToken, url: media.url });
    const caption = [text, linkUrl].filter(Boolean).join("\n\n");
    if (caption) body.set("caption", caption);
    const payload = await requestProviderJson(metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/photos`), {
      method: "POST",
      body,
    }, provider);
    return { provider, ok: true, id: readString(recordValue(payload).id, 300) };
  } else {
    const body = new URLSearchParams({ access_token: accessToken });
    if (text) body.set("message", text);
    if (linkUrl) body.set("link", linkUrl);
    const payload = await requestProviderJson(metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/feed`), {
      method: "POST",
      body,
    }, provider);
    return { provider, ok: true, id: readString(recordValue(payload).id, 300) };
  }
}

async function publishInstagram(
  connection: SocialConnection,
  text: string,
  hashtags: string,
  media: SocialMedia | null,
  shareToFeed: boolean
): Promise<ProviderResult> {
  const provider: SocialProvider = "instagram";
  if (!media || !["image", "video"].includes(media.kind)) {
    return { provider, ok: false, error: "Instagram direct publishing needs a public image or video URL. Video is published as a reel." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const caption = [text, hashtags].filter(Boolean).join("\n\n");
  const creationBody = new URLSearchParams({ access_token: accessToken });
  if (media.kind === "video") {
    creationBody.set("media_type", "REELS");
    creationBody.set("video_url", media.url);
    creationBody.set("share_to_feed", shareToFeed ? "true" : "false");
  } else {
    creationBody.set("image_url", media.url);
  }
  if (caption) creationBody.set("caption", caption);
  const container = recordValue(await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/media`),
    { method: "POST", body: creationBody },
    provider
  ));
  const creationId = readString(container.id, 300);
  if (!creationId) throw new Error("Instagram did not return a media container id.");

  // Poll container status until it is FINISHED before publishing
  let status = "IN_PROGRESS";
  let attempts = 0;
  const maxAttempts = 15; // 15 attempts * 3 seconds = 45 seconds max wait
  while (status === "IN_PROGRESS" && attempts < maxAttempts) {
    attempts++;
    // Wait 3 seconds between polls
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const statusData = recordValue(await requestProviderJson(
        metaGraphUrl(`${encodeURIComponent(creationId)}?fields=status_code&access_token=${accessToken}`),
        { method: "GET" },
        provider
      ));
      status = readString(statusData.status_code, 40).toUpperCase();
      if (status === "FINISHED") {
        break;
      }
      if (status === "ERROR") {
        throw new Error("Instagram media container processing failed.");
      }
    } catch (e) {
      console.error(`Instagram container status check attempt ${attempts} failed:`, e);
      if (e instanceof Error && e.message.includes("failed")) {
        throw e;
      }
    }
  }

  if (status !== "FINISHED") {
    throw new Error(`Instagram media container is still processing (status: ${status}). Please try again shortly.`);
  }

  const published = recordValue(await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/media_publish`),
    {
      method: "POST",
      body: new URLSearchParams({ access_token: accessToken, creation_id: creationId }),
    },
    provider
  ));
  return { provider, ok: true, id: readString(published.id, 300) };
}

async function publishX(
  connection: SocialConnection,
  text: string,
  linkUrl: string,
  media: SocialMedia | null
): Promise<ProviderResult> {
  const provider: SocialProvider = "x";
  if (media?.kind === "document") {
    return { provider, ok: false, error: "X direct publishing does not accept document attachments." };
  }
  const postText = joinPostText(text, linkUrl);
  if (!postText && !media) {
    return { provider, ok: false, error: "X needs post text, a link, an image, a GIF, or a video." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const mediaId = media ? await uploadXMedia(accessToken, media) : "";
  const body: Record<string, unknown> = {};
  if (postText) body.text = postText;
  if (mediaId) body.media = { media_ids: [mediaId] };
  const payload = await requestProviderJson("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, provider);
  return { provider, ok: true, id: readString(recordValue(payload).data?.id, 300) };
}

async function publishLinkedIn(
  connection: SocialConnection,
  text: string,
  linkUrl: string,
  media: SocialMedia | null
): Promise<ProviderResult> {
  const provider: SocialProvider = "linkedin";
  const commentary = joinPostText(text, linkUrl);
  if (!commentary && !media) {
    return { provider, ok: false, error: "LinkedIn needs post text, a link, or an attachment." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const metadata = recordValue(connection.metadata);
  const author = readString(metadata.authorUrn, 300) || `urn:li:person:${connection.provider_account_id}`;
  const post: Record<string, unknown> = {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (media) {
    const assetId = await uploadLinkedInMedia(accessToken, author, media);
    const mediaContent: Record<string, string> = { id: assetId };
    if (media.title) mediaContent.title = media.title;
    if (media.altText && (media.kind === "image" || media.kind === "gif")) {
      mediaContent.altText = media.altText;
    }
    post.content = { media: mediaContent };
  }

  const { response, payload } = await requestProviderResponse("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: linkedinHeaders(accessToken),
    body: JSON.stringify(post),
  }, provider);
  return {
    provider,
    ok: true,
    id: readString(response.headers.get("x-restli-id"), 300) || readString(recordValue(payload).id, 300),
  };
}

async function uploadXMedia(accessToken: string, media: SocialMedia) {
  const remote = await downloadRemoteMedia(media);
  assertRemoteMediaFormat("x", media, remote);
  const mimeType = resolvedMediaMimeType(media, remote.mimeType);
  const category = media.kind === "gif" ? "tweet_gif" : media.kind === "video" ? "tweet_video" : "tweet_image";
  const initialized = recordValue(await requestProviderJson("https://api.x.com/2/media/upload/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media_category: category,
      media_type: mimeType,
      total_bytes: remote.bytes.byteLength,
      shared: false,
    }),
  }, "x"));
  const mediaId = readString(recordValue(initialized.data).id, 300);
  if (!mediaId) throw new Error("X did not return a media upload id.");

  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0, segment = 0; offset < remote.bytes.byteLength; offset += chunkSize, segment += 1) {
    const chunk = remote.bytes.slice(offset, Math.min(remote.bytes.byteLength, offset + chunkSize));
    const formData = new FormData();
    formData.append("media", new Blob([new Uint8Array(chunk)], { type: mimeType }), media.title || `social-upload-${segment}`);
    formData.append("segment_index", `${segment}`);
    await requestProviderJson(`https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    }, "x");
  }

  const finalized = await requestProviderJson(`https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/finalize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }, "x");
  await awaitXMediaProcessing(accessToken, mediaId, finalized);
  return mediaId;
}

async function awaitXMediaProcessing(accessToken: string, mediaId: string, initialPayload: unknown) {
  let data = recordValue(recordValue(initialPayload).data);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const processing = recordValue(data.processing_info);
    const state = readString(processing.state, 40).toLowerCase();
    if (!state || state === "succeeded") return;
    if (state === "failed") throw new Error("X could not process the uploaded media.");
    const waitSeconds = Math.max(1, Math.min(10, Number(processing.check_after_secs) || 1));
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    const payload = await requestProviderJson(`https://api.x.com/2/media/upload?media_id=${encodeURIComponent(mediaId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }, "x");
    data = recordValue(recordValue(payload).data);
  }
  throw new Error("X media is still processing. Try publishing again shortly.");
}

async function uploadLinkedInMedia(accessToken: string, author: string, media: SocialMedia) {
  const remote = await downloadRemoteMedia(media);
  assertRemoteMediaFormat("linkedin", media, remote);
  if (media.kind === "video") {
    return uploadLinkedInVideo(accessToken, author, media, remote);
  }
  const endpoint = media.kind === "document" ? "documents" : "images";
  const key = media.kind === "document" ? "document" : "image";
  const initialized = recordValue(await requestProviderJson(`https://api.linkedin.com/rest/${endpoint}?action=initializeUpload`, {
    method: "POST",
    headers: linkedinHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  }, "linkedin"));
  const value = recordValue(initialized.value);
  const uploadUrl = readString(value.uploadUrl, 4000);
  const assetId = readString(value[key], 400);
  if (!uploadUrl || !assetId) throw new Error(`LinkedIn did not initialize the ${media.kind} upload.`);
  await uploadLinkedInPart(uploadUrl, accessToken, remote.bytes, resolvedMediaMimeType(media, remote.mimeType));
  return assetId;
}

async function uploadLinkedInVideo(accessToken: string, author: string, media: SocialMedia, remote: RemoteMedia) {
  const initialized = recordValue(await requestProviderJson("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: linkedinHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: author,
        fileSizeBytes: remote.bytes.byteLength,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  }, "linkedin"));
  const value = recordValue(initialized.value);
  const video = readString(value.video, 400);
  const uploadToken = readString(value.uploadToken, 2000);
  const instructions = Array.isArray(value.uploadInstructions) ? value.uploadInstructions.map(recordValue) : [];
  if (!video || !instructions.length) throw new Error("LinkedIn did not initialize the video upload.");
  const uploadedPartIds: string[] = [];
  for (const instruction of instructions) {
    const uploadUrl = readString(instruction.uploadUrl, 4000);
    const firstByte = Number(instruction.firstByte);
    const lastByte = Number(instruction.lastByte);
    if (!uploadUrl || !Number.isInteger(firstByte) || !Number.isInteger(lastByte) || firstByte < 0 || lastByte < firstByte) {
      throw new Error("LinkedIn returned invalid video upload instructions.");
    }
    const response = await uploadLinkedInPart(
      uploadUrl,
      accessToken,
      remote.bytes.slice(firstByte, Math.min(remote.bytes.byteLength, lastByte + 1)),
      resolvedMediaMimeType(media, remote.mimeType)
    );
    const partId = readString(response.headers.get("etag"), 2000).replace(/^"|"$/g, "");
    if (!partId) throw new Error("LinkedIn did not return a video part identifier.");
    uploadedPartIds.push(partId);
  }
  await requestProviderJson("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: linkedinHeaders(accessToken),
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds } }),
  }, "linkedin");
  return video;
}

async function uploadLinkedInPart(
  uploadUrl: string,
  accessToken: string,
  bytes: Uint8Array,
  mimeType: string
) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: new Blob([new Uint8Array(bytes)], { type: mimeType || "application/octet-stream" }),
  });
  if (!response.ok) throw new Error(`LinkedIn media upload returned HTTP ${response.status}.`);
  return response;
}

function linkedinHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
    "Linkedin-Version": LINKEDIN_API_VERSION,
  };
}

async function connectionForPublish(
  adminClient: ReturnType<typeof createAdminClient>,
  connection: SocialConnection
) {
  if (!connection.token_expires_at || Date.parse(connection.token_expires_at) > Date.now() + 60_000) {
    return connection;
  }
  if (connection.provider === "x" && connection.refresh_token) {
    const oauth = await loadSocialOAuthConfig(adminClient);
    if (oauth.config.x.clientId) {
      return refreshXConnection(adminClient, connection, oauth.config.x);
    }
  }
  throw new Error(`${providerLabel(connection.provider)} connection expired. Connect it again.`);
}

async function refreshXConnection(
  adminClient: ReturnType<typeof createAdminClient>,
  connection: SocialConnection,
  oauth: XOAuthConfig
) {
  const refreshToken = await decryptToken(connection.refresh_token || "");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: oauth.clientId,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (oauth.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${oauth.clientId}:${oauth.clientSecret}`)}`;
  }
  const token = recordValue(await requestProviderJson("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body,
  }, "x")) as TokenPayload;
  const accessToken = readString(token.access_token, 5000);
  if (!accessToken) {
    throw new Error("X connection could not be refreshed. Connect it again.");
  }
  const nextRefreshToken = readString(token.refresh_token, 5000) || refreshToken;
  const nextConnection = {
    ...connection,
    access_token: await encryptToken(accessToken),
    refresh_token: await encryptToken(nextRefreshToken),
    token_type: readString(token.token_type, 80) || connection.token_type,
    scopes: readScopes(token.scope).length ? readScopes(token.scope) : connection.scopes,
    token_expires_at: expiresAt(token.expires_in),
  };
  const { error } = await adminClient.from("social_connections").update({
    access_token: nextConnection.access_token,
    refresh_token: nextConnection.refresh_token,
    token_type: nextConnection.token_type,
    scopes: nextConnection.scopes,
    token_expires_at: nextConnection.token_expires_at,
  }).eq("id", connection.id);
  if (error) {
    console.error("[Social Publish] X refresh store failed:", error.message);
    throw new Error("X connection refresh could not be saved. Connect it again.");
  }
  return nextConnection;
}

async function loadConnections(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  providers: SocialProvider[],
  connectionIds: Partial<Record<SocialProvider, string>>
) {
  const { data, error } = await adminClient
    .from("social_connections")
    .select("id, provider, provider_account_id, provider_account_label, access_token, refresh_token, token_type, scopes, token_expires_at, metadata")
    .eq("user_id", userId)
    .in("provider", providers)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[Social Publish] Connection lookup failed:", error.message);
    throw new Error("Connected Social accounts could not be loaded.");
  }
  const connections = new Map<SocialProvider, SocialConnection>();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const provider = readProvider(row.provider);
    const connectionId = readString(row.id, 300);
    if (!provider) return;
    if (connectionIds[provider] && connectionIds[provider] !== connectionId) return;
    if (!connections.has(provider)) connections.set(provider, row as SocialConnection);
  });
  return connections;
}

async function authenticateCaller(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return { user: null };
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  return { user: error ? null : data.user };
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requestProviderJson(url: string, options: RequestInit, provider: SocialProvider) {
  const { payload } = await requestProviderResponse(url, options, provider);
  return payload;
}

async function requestProviderResponse(url: string, options: RequestInit, provider: SocialProvider) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerErrorMessage(payload, provider, response.status) || `Provider returned HTTP ${response.status}.`);
  }
  return { response, payload };
}

function readProviders(value: unknown) {
  if (!Array.isArray(value)) return [];
  const providers = new Set<SocialProvider>();
  value.forEach((item) => {
    const provider = readProvider(item);
    if (provider) providers.add(provider);
  });
  return [...providers];
}

function readConnectionIds(value: unknown) {
  const record = recordValue(value);
  const ids: Partial<Record<SocialProvider, string>> = {};
  (["facebook", "instagram", "x", "linkedin"] as SocialProvider[]).forEach((provider) => {
    const id = readString(record[provider], 300);
    if (id) ids[provider] = id;
  });
  return ids;
}

function readProvider(value: unknown): SocialProvider | "" {
  const provider = readString(value, 40).toLowerCase();
  return provider === "facebook" || provider === "instagram" || provider === "x" || provider === "linkedin"
    ? provider
    : "";
}

function providerLabel(provider: SocialProvider) {
  switch (provider) {
    case "x": return "X";
    case "linkedin": return "LinkedIn";
    case "facebook": return "Facebook";
    case "instagram": return "Instagram";
  }
}

function joinPostText(text: string, linkUrl: string, imageUrl?: string) {
  return [text, linkUrl, imageUrl].filter(Boolean).join("\n\n");
}

async function downloadRemoteMedia(media: SocialMedia): Promise<RemoteMedia> {
  const sourceUrl = new URL(media.url);
  assertFetchableMediaUrl(sourceUrl);
  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`The public media URL returned HTTP ${response.status}.`);
  }
  assertFetchableMediaUrl(new URL(response.url));
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error("Remote media uploads through Socials must be 100 MB or smaller.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error("Remote media uploads through Socials must be 100 MB or smaller.");
  }
  const mimeType = readString(response.headers.get("content-type"), 120).split(";")[0].toLowerCase();
  return { bytes, mimeType };
}

function assertFetchableMediaUrl(url: URL) {
  if (url.protocol !== "https:" || isPrivateMediaHostname(url.hostname)) {
    throw new Error("X and LinkedIn attachment URLs must be public HTTPS URLs.");
  }
}

function isPrivateMediaHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host === "::1"
    || host.startsWith("fe80:")
    || (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd")))
    || host === "metadata.google.internal"
  ) {
    return true;
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function resolvedMediaMimeType(media: SocialMedia, remoteMimeType: string) {
  if (remoteMimeType && remoteMimeType !== "application/octet-stream") return remoteMimeType;
  if (media.mimeType) return media.mimeType;
  if (media.kind === "gif") return "image/gif";
  if (media.kind === "video") return "video/mp4";
  if (media.kind === "document") {
    const title = `${media.title} ${media.url}`.toLowerCase();
    if (title.includes(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (title.includes(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    if (title.includes(".doc")) return "application/msword";
    if (title.includes(".ppt")) return "application/vnd.ms-powerpoint";
    return "application/pdf";
  }
  return "image/jpeg";
}

function assertRemoteMediaFormat(provider: "x" | "linkedin", media: SocialMedia, remote: RemoteMedia) {
  const mimeType = resolvedMediaMimeType(media, remote.mimeType);
  if (media.kind === "image") {
    const accepted = ["image/jpeg", "image/png"];
    if (!accepted.includes(mimeType)) {
      throw new Error(`${providerLabel(provider)} does not accept ${mimeType || "that image format"} for this image post.`);
    }
    return;
  }
  if (media.kind === "gif" && mimeType !== "image/gif") {
    throw new Error(`${providerLabel(provider)} requires a GIF attachment to use the image/gif format.`);
  }
  if (media.kind === "video" && !mimeType.startsWith("video/")) {
    throw new Error(`${providerLabel(provider)} requires a video attachment URL for a video post.`);
  }
  if (media.kind === "document" && provider === "linkedin") {
    const supported = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]);
    if (!supported.has(mimeType)) {
      throw new Error("LinkedIn documents must be PDF, DOC, DOCX, PPT, or PPTX files.");
    }
  }
}

function metaGraphVersion() {
  const version = META_GRAPH_API_VERSION.replace(/^v?/i, "").replace(/^\/+|\/+$/g, "");
  return version ? `v${version}` : "v22.0";
}

function metaGraphUrl(path: string) {
  return `https://graph.facebook.com/${metaGraphVersion()}/${path.replace(/^\/+/, "")}`;
}

function metaGraphVideoUrl(path: string) {
  return `https://graph-video.facebook.com/${metaGraphVersion()}/${path.replace(/^\/+/, "")}`;
}

function normalizeHttpUrl(value: unknown) {
  const raw = readString(value, 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function readMediaKind(value: unknown): SocialMediaKind | "" {
  const kind = readString(value, 40).toLowerCase();
  return kind === "image" || kind === "gif" || kind === "video" || kind === "document" ? kind : "";
}

function readScopes(value: unknown) {
  if (Array.isArray(value)) return value.map((scope) => readString(scope, 100)).filter(Boolean);
  return readString(value, 2000).split(/\s+/).filter(Boolean);
}

function expiresAt(value: unknown) {
  const expiresIn = Number(value);
  return Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
}

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function providerErrorMessage(payload: unknown, provider: SocialProvider, status: number) {
  const record = recordValue(payload);
  const nested = recordValue(record.error);
  const message = readString(nested.message || record.detail || record.message || record.title, 260);
  if ((provider === "x" || provider === "linkedin") && status === 401) {
    return `${providerLabel(provider)} connection is no longer authorized. Connect it again.`;
  }
  return message;
}

async function encryptToken(token: string) {
  const key = await tokenCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(token);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return `v1.${base64Url(iv)}.${base64Url(encrypted)}`;
}

async function decryptToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Social connection token storage is invalid. Connect the provider again.");
  }
  const key = await tokenCryptoKey();
  const iv = base64UrlBytes(parts[1]);
  const encrypted = base64UrlBytes(parts[2]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

async function tokenCryptoKey() {
  const seed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SOCIAL_TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", seed, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
