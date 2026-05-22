import { 
  ConnectedAccount, 
  exchangeToken, 
  readString, 
  requireAccessToken, 
  providerJson, 
  readScopes, 
  expiresAt 
} from "../shared.ts";

const LINKEDIN_OAUTH_CLIENT_ID = readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_ID"), 500);
const LINKEDIN_OAUTH_CLIENT_SECRET = readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_SECRET"), 2000);

export function linkedinIsConfigured() {
  return Boolean(LINKEDIN_OAUTH_CLIENT_ID && LINKEDIN_OAUTH_CLIENT_SECRET);
}

export function linkedinAuthorizeUrl(state: string, redirectUri: string, codeChallenge: string) {
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

export async function connectLinkedIn(code: string, codeVerifier: string, redirectUri: string): Promise<ConnectedAccount> {
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
