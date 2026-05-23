import { 
  ConnectedAccount, 
  exchangeToken, 
  readString, 
  requireAccessToken, 
  providerJson, 
  recordValue, 
  readScopes, 
  expiresAt 
} from "../shared.ts";

const X_OAUTH_CLIENT_ID = readString(Deno.env.get("X_OAUTH_CLIENT_ID"), 500);
const X_OAUTH_CLIENT_SECRET = readString(Deno.env.get("X_OAUTH_CLIENT_SECRET"), 2000);

export function xIsConfigured() {
  return Boolean(X_OAUTH_CLIENT_ID);
}

export function xAuthorizeUrl(state: string, redirectUri: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: X_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "tweet.read tweet.write users.read media.write offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // X's OAuth servers require %20-encoded spaces in scope, not + from URLSearchParams
  return `https://x.com/i/oauth2/authorize?${params.toString().replace(/\+/g, "%20")}`;
}

export async function connectX(code: string, codeVerifier: string, redirectUri: string): Promise<ConnectedAccount> {
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
