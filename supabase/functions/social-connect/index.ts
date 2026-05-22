import { createClient } from "npm:@supabase/supabase-js@2";
import { 
  ConnectProvider, 
  SocialStateRecord, 
  ConnectedAccount,
  SOCIAL_TOKEN_ENCRYPTION_KEY,
  corsHeaders,
  jsonResponse,
  readString,
  randomToken,
  sha256Base64Url,
  encryptToken
} from "./shared.ts";

import { xIsConfigured, xAuthorizeUrl, connectX } from "./providers/x.ts";
import { linkedinIsConfigured, linkedinAuthorizeUrl, connectLinkedIn } from "./providers/linkedin.ts";
import { metaIsConfigured, metaAuthorizeUrl, connectMeta } from "./providers/meta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SOCIAL_ALLOWED_RETURN_ORIGINS = readOriginList(Deno.env.get("SOCIAL_ALLOWED_RETURN_ORIGINS"));

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
      x: xIsConfigured(),
      linkedin: linkedinIsConfigured(),
      facebook: metaIsConfigured(),
      instagram: metaIsConfigured(),
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
  if (provider === "x") return xIsConfigured();
  if (provider === "linkedin") return linkedinIsConfigured();
  return metaIsConfigured();
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
