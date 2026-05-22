import { createClient } from "npm:@supabase/supabase-js@2";

type SocialProvider = "facebook" | "instagram" | "x" | "linkedin";

type SocialPublishPayload = {
  providers?: unknown;
  connectionIds?: unknown;
  text?: unknown;
  linkUrl?: unknown;
  instagramImageUrl?: unknown;
  instagramHashtags?: unknown;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SOCIAL_TOKEN_ENCRYPTION_KEY = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") ?? "";
const X_OAUTH_CLIENT_ID = readString(Deno.env.get("X_OAUTH_CLIENT_ID"), 500);
const X_OAUTH_CLIENT_SECRET = readString(Deno.env.get("X_OAUTH_CLIENT_SECRET"), 2000);
const META_GRAPH_API_VERSION = readString(Deno.env.get("META_GRAPH_API_VERSION"), 32);

Deno.serve(async (request) => {
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
  const instagramImageUrl = normalizeHttpUrl(payload.instagramImageUrl);
  if (readString(payload.instagramImageUrl) && !instagramImageUrl) {
    return jsonResponse({ error: "Instagram image URL must use http or https." }, 400);
  }

  const adminClient = createAdminClient();
  const connections = await loadConnections(adminClient, auth.user.id, providers, readConnectionIds(payload.connectionIds));
  const draft = {
    text: readString(payload.text, 6000),
    linkUrl,
    instagramImageUrl,
    instagramHashtags: readString(payload.instagramHashtags, 500),
  };
  const results: ProviderResult[] = [];
  for (const provider of providers) {
    results.push(await publishProvider(adminClient, provider, connections.get(provider), draft));
  }
  return jsonResponse({ ok: results.every((result) => result.ok), results });
});

async function publishProvider(
  adminClient: ReturnType<typeof createAdminClient>,
  provider: SocialProvider,
  connection: SocialConnection | undefined,
  draft: {
    text: string;
    linkUrl: string;
    instagramImageUrl: string;
    instagramHashtags: string;
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
      return publishFacebook(readyConnection, draft.text, draft.linkUrl);
    }
    if (provider === "instagram") {
      return publishInstagram(readyConnection, draft.text, draft.instagramHashtags, draft.instagramImageUrl);
    }
    if (provider === "x") {
      return publishX(readyConnection, draft.text, draft.linkUrl);
    }
    return publishLinkedIn(readyConnection, draft.text, draft.linkUrl);
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
  linkUrl: string
): Promise<ProviderResult> {
  const provider: SocialProvider = "facebook";
  if (!text && !linkUrl) {
    return { provider, ok: false, error: "Facebook needs post text or an optional link URL." };
  }
  const body = new URLSearchParams({ access_token: await decryptToken(connection.access_token) });
  if (text) body.set("message", text);
  if (linkUrl) body.set("link", linkUrl);
  const payload = await requestProviderJson(metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/feed`), {
    method: "POST",
    body,
  }, provider);
  return { provider, ok: true, id: readString(recordValue(payload).id, 300) };
}

async function publishInstagram(
  connection: SocialConnection,
  text: string,
  hashtags: string,
  imageUrl: string
): Promise<ProviderResult> {
  const provider: SocialProvider = "instagram";
  if (!imageUrl) {
    return { provider, ok: false, error: "Instagram direct publishing needs a public image URL." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const caption = [text, hashtags].filter(Boolean).join("\n\n");
  const creationBody = new URLSearchParams({ access_token: accessToken, image_url: imageUrl });
  if (caption) creationBody.set("caption", caption);
  const container = recordValue(await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(connection.provider_account_id)}/media`),
    { method: "POST", body: creationBody },
    provider
  ));
  const creationId = readString(container.id, 300);
  if (!creationId) throw new Error("Instagram did not return a media container id.");
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

async function publishX(connection: SocialConnection, text: string, linkUrl: string): Promise<ProviderResult> {
  const provider: SocialProvider = "x";
  const postText = joinPostText(text, linkUrl);
  if (!postText) {
    return { provider, ok: false, error: "X needs post text or an optional link URL." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const payload = await requestProviderJson("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: postText }),
  }, provider);
  return { provider, ok: true, id: readString(recordValue(payload).data?.id, 300) };
}

async function publishLinkedIn(
  connection: SocialConnection,
  text: string,
  linkUrl: string
): Promise<ProviderResult> {
  const provider: SocialProvider = "linkedin";
  const commentary = joinPostText(text, linkUrl);
  if (!commentary) {
    return { provider, ok: false, error: "LinkedIn needs post text or an optional link URL." };
  }
  const accessToken = await decryptToken(connection.access_token);
  const metadata = recordValue(connection.metadata);
  const author = readString(metadata.authorUrn, 300) || `urn:li:person:${connection.provider_account_id}`;
  const { response, payload } = await requestProviderResponse("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: commentary },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    }),
  }, provider);
  return {
    provider,
    ok: true,
    id: readString(response.headers.get("x-restli-id"), 300) || readString(recordValue(payload).id, 300),
  };
}

async function connectionForPublish(
  adminClient: ReturnType<typeof createAdminClient>,
  connection: SocialConnection
) {
  if (!connection.token_expires_at || Date.parse(connection.token_expires_at) > Date.now() + 60_000) {
    return connection;
  }
  if (connection.provider === "x" && connection.refresh_token && X_OAUTH_CLIENT_ID) {
    return refreshXConnection(adminClient, connection);
  }
  throw new Error(`${providerLabel(connection.provider)} connection expired. Connect it again.`);
}

async function refreshXConnection(
  adminClient: ReturnType<typeof createAdminClient>,
  connection: SocialConnection
) {
  const refreshToken = await decryptToken(connection.refresh_token || "");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: X_OAUTH_CLIENT_ID,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (X_OAUTH_CLIENT_SECRET) {
    headers.Authorization = `Basic ${btoa(`${X_OAUTH_CLIENT_ID}:${X_OAUTH_CLIENT_SECRET}`)}`;
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

function joinPostText(text: string, linkUrl: string) {
  return [text, linkUrl].filter(Boolean).join("\n\n");
}

function metaGraphVersion() {
  const version = META_GRAPH_API_VERSION.replace(/^v?/i, "").replace(/^\/+|\/+$/g, "");
  return version ? `v${version}` : "v22.0";
}

function metaGraphUrl(path: string) {
  return `https://graph.facebook.com/${metaGraphVersion()}/${path.replace(/^\/+/, "")}`;
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
