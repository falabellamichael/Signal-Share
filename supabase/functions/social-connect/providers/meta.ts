import { 
  ConnectedAccount, 
  readString, 
  requireAccessToken, 
  providerJson, 
  recordValue, 
  TokenPayload
} from "../shared.ts";

const META_OAUTH_APP_ID = readString(Deno.env.get("META_OAUTH_APP_ID"), 500);
const META_OAUTH_APP_SECRET = readString(Deno.env.get("META_OAUTH_APP_SECRET"), 2000);
const META_GRAPH_API_VERSION = readString(Deno.env.get("META_GRAPH_API_VERSION"), 32);

export function metaIsConfigured() {
  return Boolean(META_OAUTH_APP_ID && META_OAUTH_APP_SECRET);
}

function metaGraphVersion() {
  const version = META_GRAPH_API_VERSION.replace(/^v?/i, "").replace(/^\/+|\/+$/g, "");
  return version ? `v${version}` : "v22.0";
}

function metaGraphUrl(path: string) {
  return `https://graph.facebook.com/${metaGraphVersion()}/${path.replace(/^\/+/, "")}`;
}

export function metaAuthorizeUrl(provider: "facebook" | "instagram", state: string, redirectUri: string) {
  const scope = provider === "facebook"
    ? "pages_show_list,pages_read_engagement,pages_manage_posts,business_management"
    : "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,business_management";
  const params = new URLSearchParams({
    client_id: META_OAUTH_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope,
  });
  return `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${params.toString()}`;
}

export async function connectMeta(
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
  const debugInfo: string[] = [];
  
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
    
    debugInfo.push(`${pageName} (linked IG ID: ${instagramId || "none"})`);
    
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
    if (provider === "facebook") {
      throw new Error("Meta did not return any Facebook Page that can be connected. Make sure you have at least one Page and selected it during login.");
    } else {
      const pageList = debugInfo.length ? debugInfo.join(", ") : "none";
      throw new Error(`Meta did not return an Instagram account. Pages found: ${pageList}. Make sure your Instagram account is Professional (Business/Creator) and linked to a Facebook Page, and you selected BOTH during the login prompts.`);
    }
  }
  return connections;
}
