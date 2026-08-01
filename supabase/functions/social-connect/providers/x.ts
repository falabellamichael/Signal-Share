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
import type { XOAuthConfig } from "../../_shared/social-oauth-config.ts";

export function xIsConfigured(config: XOAuthConfig) {
  return Boolean(config.clientId);
}

export function xAuthorizeUrl(config: XOAuthConfig, state: string, redirectUri: string, codeChallenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "tweet.read tweet.write users.read media.write offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // X's OAuth servers require %20-encoded spaces in scope, not + from URLSearchParams
  return `https://x.com/i/oauth2/authorize?${params.toString().replace(/\+/g, "%20")}`;
}

export async function connectX(
  config: XOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<ConnectedAccount> {
  const token = await exchangeToken("https://api.x.com/2/oauth2/token", {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
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
