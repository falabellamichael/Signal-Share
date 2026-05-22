export type ConnectProvider = "x" | "linkedin" | "facebook" | "instagram";

export type SocialStateRecord = {
  id: string;
  user_id: string;
  provider: ConnectProvider;
  state_token: string;
  code_verifier: string | null;
  return_to: string | null;
  expires_at: string;
};

export type TokenPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

export type ConnectedAccount = {
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

export const SOCIAL_TOKEN_ENCRYPTION_KEY = Deno.env.get("SOCIAL_TOKEN_ENCRYPTION_KEY") ?? "";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function encryptToken(token: string) {
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

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(size: number) {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export function readString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

export function readScopes(value: unknown) {
  if (Array.isArray(value)) return value.map((scope) => readString(scope, 100)).filter(Boolean);
  return readString(value, 2000).split(/\s+/).filter(Boolean);
}

export function expiresAt(value: unknown) {
  const expiresIn = Number(value);
  return Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
}

export function requireAccessToken(payload: TokenPayload) {
  const accessToken = readString(payload.access_token, 5000);
  if (!accessToken) throw new Error("Social provider did not return an access token.");
  return accessToken;
}

export function providerError(value: unknown) {
  const payload = recordValue(value);
  const nested = recordValue(payload.error);
  return readString(nested.message || payload.error_description || payload.message || payload.detail || payload.title, 260);
}

export async function providerJson(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerError(payload) || `Social provider returned HTTP ${response.status}.`);
  }
  return recordValue(payload);
}

export async function exchangeToken(
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

export function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
