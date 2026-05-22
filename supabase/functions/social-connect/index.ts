import { createClient } from "npm:@supabase/supabase-js@2";

type ConnectProvider = "x" | "linkedin" | "facebook" | "instagram";

type SocialStateRecord = {
  id: string;
  user_id: string;
  provider: ConnectProvider;
  state_token: string;
  code_verifier: string | null;
  return_to: string | null;
  expires_at: string;
};

type TokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type ConnectedAccount = {
  provider: ConnectProvider;
  accountId: string;
  accountLabel: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
  metadata: Record<string, unknown>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SOCIAL_TOKEN_ENCRYPTION_KEY = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") ?? "";
const SOCIAL_ALLOWED_RETURN_ORIGINS = readOriginList(Deno.env.get("SOCIAL_ALLOWED_RETURN_ORIGINS"));
const X_OAUTH_CLIENT_ID = readString(Deno.env.get("X_OAUTH_CLIENT_ID"), 500);
const X_OAUTH_CLIENT_SECRET = readString(Deno.env.get("X_OAUTH_CLIENT_SECRET"), 2000);
const LINKEDIN_OAUTH_CLIENT_ID = readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_ID"), 500);
const LINKEDIN_OAUTH_CLIENT_SECRET = readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_SECRET"), 2000);
const META_OAUTH_APP_ID = readString(Deno.env.get("META_OAUTH_APP_ID"), 500);
const META_OAUTH_APP_SECRET = readString(Deno.env.get("META_OAUTH_APP_SECRET"), 2000);
const META_GRAPH_API_VERSION = readString(Deno.env.get("META_GRAPH_API_VERSION"), 32);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Supabase environment variables are incomplete." }, 500);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.has("state")) {
    return finishOAuth(request, url);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const auth = await authenticateCaller(request);
  if (!auth.user) {
    return jsonResponse({ error: "Sign in before connecting a Social provider." }, 401);
  }

  const adminClient = createAdminClient();
  const payload = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = readString(payload.action, 40).toLowerCase() || "status";

  if (action === "status") {
    return statusResponse(adminClient, auth.user.id);
  }

  const provider = readConnectProvider(payload.provider);
  if (!provider) {
    return jsonResponse({ error: "Choose a supported Social provider for this connection." }, 400);
  }
  if (action === "disconnect") {
    const { error } = await adminClient
      .from("social_connections")
      .delete()
      .eq("user_id", auth.user.id)
      .eq("provider", provider);
    if (error) {
      console.error("[Social Connect] Disconnect failed:", error.message);
      return jsonResponse({ error: "Social connection could not be removed." }, 500);
    }
    return statusResponse(adminClient, auth.user.id);
  }
  if (action !== "start") {
    return jsonResponse({ error: "Unsupported Social connection action." }, 400);
  }
  if (!providerIsConfigured(provider)) {
    return jsonResponse({ error: `${providerLabel(provider)} OAuth is not configured yet.` }, 501);
  }
  if (!SOCIAL_TOKEN_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Social token encryption is not configured." }, 500);
  }

  const returnTo = safeReturnTo(payload.returnTo, request.headers.get("Origin"));
  if (!returnTo) {
    return jsonResponse({ error: "Social connection return URL is not allowed." }, 400);
  }

  await adminClient.from("social_oauth_states").delete().lt("expires_at", new Date().toISOString());

  const stateToken = randomToken(36);
  const codeVerifier = randomToken(64);
  const { error: stateError } = await adminClient.from("social_oauth_states").insert({
    user_id: auth.user.id,
    provider,
    state_token: stateToken,
    code_verifier: codeVerifier,
    return_to: returnTo,
  });
  if (stateError) {
    console.error("[Social Connect] OAuth state insert failed:", stateError.message);
    return jsonResponse({ error: "Social connection could not be started." }, 500);
  }

  const redirectUri = callbackUrl(url);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return jsonResponse({
    provider,
    authorizeUrl: providerAuthorizeUrl(provider, stateToken, redirectUri, codeChallenge),
  });
});

async function finishOAuth(request: Request, url: URL) {
  const adminClient = createAdminClient();
  const stateToken = readString(url.searchParams.get("state"), 500);
  const { data: state, error: stateError } = await adminClient
    .from("social_oauth_states")
    .select("id, user_id, provider, state_token, code_verifier, return_to, expires_at")
    .eq("state_token", stateToken)
    .maybeSingle<SocialStateRecord>();

  const fallbackReturnTo = safeReturnTo(state?.return_to, request.headers.get("Origin"));
  if (stateError || !state || Date.parse(state.expires_at) <= Date.now()) {
    if (state?.id) await adminClient.from("social_oauth_states").delete().eq("id", state.id);
    return redirectResult(fallbackReturnTo, "error", "Social connection expired. Start it again.");
  }

  await adminClient.from("social_oauth_states").delete().eq("id", state.id);
  const denied = readString(url.searchParams.get("error_description") || url.searchParams.get("error"), 260);
  if (denied) {
    return redirectResult(fallbackReturnTo, "error", denied);
  }

  const code = readString(url.searchParams.get("code"), 1200);
  if (!code || !state.code_verifier) {
    return redirectResult(fallbackReturnTo, "error", "Social provider did not return an authorization code.");
  }
  if (!SOCIAL_TOKEN_ENCRYPTION_KEY) {
    return redirectResult(fallbackReturnTo, "error", "Social token encryption is not configured.");
  }

  try {
    const redirectUri = callbackUrl(url);
    const connections = await providerConnections(state.provider, code, state.code_verifier, redirectUri);
    const rows = await Promise.all(connections.map(async (connection) => ({
      user_id: state.user_id,
      provider: connection.provider || state.provider,
      provider_account_id: connection.accountId,
      provider_account_label: connection.accountLabel,
      access_token: await encryptToken(connection.accessToken),
      refresh_token: connection.refreshToken ? await encryptToken(connection.refreshToken) : null,
      token_type: connection.tokenType,
      scopes: connection.scopes,
      token_expires_at: connection.expiresAt,
      metadata: connection.metadata,
    })));
    const { error: connectionError } = await adminClient.from("social_connections").upsert(rows, {
      onConflict: "user_id,provider,provider_account_id",
    });
    if (connectionError) {
      console.error("[Social Connect] Connection store failed:", connectionError.message);
      return redirectResult(fallbackReturnTo, "error", "Social connection could not be saved.");
    }
    return redirectResult(fallbackReturnTo, "connected", `${providerLabel(state.provider)} connected.`);
  } catch (error) {
    console.error("[Social Connect] OAuth callback failed:", error);
    return redirectResult(
      fallbackReturnTo,
      "error",
      error instanceof Error ? error.message : "Social provider connection failed."
    );
  }
}

async function providerConnections(
  provider: ConnectProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<ConnectedAccount[]> {
  if (provider === "x") return [await connectX(code, codeVerifier, redirectUri)];
  if (provider === "linkedin") return [await connectLinkedIn(code, codeVerifier, redirectUri)];
  return connectMeta(provider, code, redirectUri);
}

async function connectX(code: string, codeVerifier: string, redirectUri: string): Promise<ConnectedAccount> {
  const token = await exchangeToken("https://api.x.com/2/oauth2/token", {
    clientId: X_OAUTH_CLIENT_ID,
    clientSecret: X_OAUTH_CLIENT_SECRET,
    code,
    codeVerifier,
    redirectUri,
  });
  const accessToken = requireAccessToken(token);
  const accountPayload = await providerJson("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const account = recordValue(accountPayload.data);
  const accountId = readString(account?.id, 300);
  const username = readString(account?.username, 300);
  if (!accountId) {
    throw new Error("X did not return the connected account.");
  }
  return {
    provider: "x",
    accountId,
    accountLabel: username ? `@${username}` : "Connected X account",
    accessToken,
    refreshToken: readString(token.refresh_token, 5000),
    tokenType: readString(token.token_type, 80) || "Bearer",
    scopes: readScopes(token.scope),
    expiresAt: expiresAt(token.expires_in),
    metadata: { username },
  };
}

async function connectLinkedIn(code: string, codeVerifier: string, redirectUri: string): Promise<ConnectedAccount> {
  const token = await exchangeToken("https://www.linkedin.com/oauth/v2/accessToken", {
    clientId: LINKEDIN_OAUTH_CLIENT_ID,
    clientSecret: LINKEDIN_OAUTH_CLIENT_SECRET,
    code,
    codeVerifier,
    redirectUri,
  });
  const accessToken = requireAccessToken(token);
  const profile = await providerJson("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const accountId = readString(profile.sub, 300);
  if (!accountId) {
    throw new Error("LinkedIn did not return the connected member.");
  }
  const name = [readString(profile.given_name, 160), readString(profile.family_name, 160)]
    .filter(Boolean)
    .join(" ");
  return {
    provider: "linkedin",
    accountId,
    accountLabel: name || readString(profile.name, 300) || "Connected LinkedIn member",
    accessToken,
    refreshToken: readString(token.refresh_token, 5000),
    tokenType: readString(token.token_type, 80) || "Bearer",
    scopes: readScopes(token.scope),
    expiresAt: expiresAt(token.expires_in),
    metadata: { authorUrn: `urn:li:person:${accountId}` },
  };
}

async function connectMeta(
  provider: "facebook" | "instagram",
  code: string,
  redirectUri: string
): Promise<ConnectedAccount[]> {
  const tokenParams = new URLSearchParams({
    client_id: META_OAUTH_APP_ID,
    client_secret: META_OAUTH_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const token = await providerJson(metaGraphUrl(`oauth/access_token?${tokenParams.toString()}`), {
    method: "GET",
  }) as TokenPayload;
  const userAccessToken = requireAccessToken(token);
  const accountsParams = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username,name}",
    access_token: userAccessToken,
  });
  const accountsPayload = await providerJson(metaGraphUrl(`me/accounts?${accountsParams.toString()}`), {
    method: "GET",
  });
  const pages = Array.isArray(accountsPayload.data) ? accountsPayload.data.map(recordValue) : [];
  const connections: ConnectedAccount[] = [];
  pages.forEach((page) => {
    const pageId = readString(page.id, 300);
    const pageName = readString(page.name, 300);
    const pageToken = readString(page.access_token, 5000);
    if (!pageId || !pageToken) return;
    if (provider === "facebook") {
      connections.push({
        provider,
        accountId: pageId,
        accountLabel: pageName || "Connected Facebook Page",
        accessToken: pageToken,
        refreshToken: "",
        tokenType: "Bearer",
        scopes: [],
        expiresAt: null,
        metadata: { pageName },
      });
      return;
    }
    const instagram = recordValue(page.instagram_business_account);
    const instagramId = readString(instagram.id, 300);
    const username = readString(instagram.username, 300);
    if (!instagramId) return;
    connections.push({
      provider,
      accountId: instagramId,
      accountLabel: username ? `@${username}` : readString(instagram.name, 300) || "Connected Instagram account",
      accessToken: pageToken,
      refreshToken: "",
      tokenType: "Bearer",
      scopes: [],
      expiresAt: null,
      metadata: { pageId, pageName, username },
    });
  });
  if (!connections.length) {
    throw new Error(provider === "facebook"
      ? "Meta did not return a Facebook Page that can be connected."
      : "Meta did not return an Instagram account that can be connected.");
  }
  return connections;
}

async function exchangeToken(
  endpoint: string,
  config: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }
) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: config.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: config.codeVerifier,
  });
  const headers: HeadersInit = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }
  return providerJson(endpoint, { method: "POST", headers, body }) as Promise<TokenPayload>;
}

async function statusResponse(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await adminClient
    .from("social_connections")
    .select("id, provider, provider_account_id, provider_account_label, scopes, token_expires_at, updated_at")
    .eq("user_id", userId)
    .in("provider", ["x", "linkedin", "facebook", "instagram"])
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[Social Connect] Connection status failed:", error.message);
    return jsonResponse({ error: "Social connections could not be loaded." }, 500);
  }
  return jsonResponse({
    configured: {
      x: providerIsConfigured("x"),
      linkedin: providerIsConfigured("linkedin"),
      facebook: providerIsConfigured("facebook"),
      instagram: providerIsConfigured("instagram"),
    },
    connections: Array.isArray(data) ? data.map((row) => ({
      id: readString(row.id, 300),
      provider: readString(row.provider, 40),
      accountId: readString(row.provider_account_id, 300),
      label: readString(row.provider_account_label, 300),
      scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => readString(scope, 100)).filter(Boolean) : [],
      expiresAt: readString(row.token_expires_at, 100),
      updatedAt: readString(row.updated_at, 100),
    })) : [],
  });
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

function xAuthorizeUrl(state: string, redirectUri: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: X_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // X's OAuth servers require %20-encoded spaces in scope, not + from URLSearchParams
  return `https://x.com/i/oauth2/authorize?${params.toString().replace(/\+/g, "%20")}`;
}

function providerAuthorizeUrl(
  provider: ConnectProvider,
  state: string,
  redirectUri: string,
  codeChallenge: string
) {
  if (provider === "x") return xAuthorizeUrl(state, redirectUri, codeChallenge);
  if (provider === "linkedin") return linkedinAuthorizeUrl(state, redirectUri, codeChallenge);
  return metaAuthorizeUrl(provider, state, redirectUri);
}

function linkedinAuthorizeUrl(state: string, redirectUri: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINKEDIN_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile w_member_social",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

function metaAuthorizeUrl(provider: "facebook" | "instagram", state: string, redirectUri: string) {
  const scope = provider === "facebook"
    ? "pages_show_list,pages_read_engagement,pages_manage_posts"
    : "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish";
  const params = new URLSearchParams({
    client_id: META_OAUTH_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope,
  });
  return `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${params.toString()}`;
}

function callbackUrl(url: URL) {
  // Force HTTPS in production because Supabase load balancer forwards as HTTP
  const protocol = url.hostname.endsWith(".supabase.co") ? "https:" : url.protocol;
  let pathname = url.pathname;
  // Supabase proxy strips /functions/v1 from the internal path, so we must restore it
  if (url.hostname.endsWith(".supabase.co") && !pathname.startsWith("/functions/v1/")) {
    pathname = `/functions/v1${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  }
  return `${protocol}//${url.host}${pathname}`;
}

function providerIsConfigured(provider: ConnectProvider) {
  if (provider === "x") return Boolean(X_OAUTH_CLIENT_ID);
  if (provider === "linkedin") return Boolean(LINKEDIN_OAUTH_CLIENT_ID && LINKEDIN_OAUTH_CLIENT_SECRET);
  return Boolean(META_OAUTH_APP_ID && META_OAUTH_APP_SECRET);
}

function providerLabel(provider: ConnectProvider) {
  if (provider === "x") return "X";
  if (provider === "linkedin") return "LinkedIn";
  return provider === "facebook" ? "Facebook" : "Instagram";
}

function readConnectProvider(value: unknown): ConnectProvider | "" {
  const provider = readString(value, 40).toLowerCase();
  return provider === "x" || provider === "linkedin" || provider === "facebook" || provider === "instagram"
    ? provider
    : "";
}

function redirectResult(returnTo: string, status: "connected" | "error", message: string) {
  const target = safeReturnTo(returnTo, "");
  if (!target) {
    return jsonResponse({ status, error: status === "error" ? message : undefined, message }, status === "error" ? 400 : 200);
  }
  const url = new URL(target);
  url.searchParams.set("signal_social", status);
  url.searchParams.set("signal_social_message", message.slice(0, 260));
  return Response.redirect(url.toString(), 303);
}

function safeReturnTo(value: unknown, requestOrigin: string | null) {
  const raw = readString(value, 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const allowed = new Set(SOCIAL_ALLOWED_RETURN_ORIGINS);
    const origin = normalizeOrigin(requestOrigin);
    if (origin) allowed.add(origin);
    return allowed.has(url.origin) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function readOriginList(value: unknown) {
  return readString(value, 4000)
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function normalizeOrigin(value: unknown) {
  try {
    const url = new URL(readString(value, 2048));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch (_error) {
    return "";
  }
}

async function providerJson(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerError(payload) || `Social provider returned HTTP ${response.status}.`);
  }
  return recordValue(payload);
}

function requireAccessToken(payload: TokenPayload) {
  const accessToken = readString(payload.access_token, 5000);
  if (!accessToken) throw new Error("Social provider did not return an access token.");
  return accessToken;
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

function providerError(value: unknown) {
  const payload = recordValue(value);
  const nested = recordValue(payload.error);
  return readString(nested.message || payload.error_description || payload.message || payload.detail || payload.title, 260);
}

function metaGraphVersion() {
  const version = META_GRAPH_API_VERSION.replace(/^v?/i, "").replace(/^\/+|\/+$/g, "");
  return version ? `v${version}` : "v22.0";
}

function metaGraphUrl(path: string) {
  return `https://graph.facebook.com/${metaGraphVersion()}/${path.replace(/^\/+/, "")}`;
}

async function encryptToken(token: string) {
  const key = await tokenCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(token);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return `v1.${base64Url(iv)}.${base64Url(encrypted)}`;
}

async function tokenCryptoKey() {
  const seed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SOCIAL_TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", seed, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(size: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
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
