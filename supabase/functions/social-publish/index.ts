import { createClient } from "npm:@supabase/supabase-js@2";

type SocialProvider = "facebook" | "instagram" | "x" | "linkedin";

type SocialPublishPayload = {
  providers?: unknown;
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

type XOAuth1Credentials = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const META_GRAPH_API_VERSION = readString(Deno.env.get("META_GRAPH_API_VERSION"), 32);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ error: "Supabase environment variables are incomplete." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const { data: isAdmin, error: adminError } = await callerClient.rpc("is_signal_share_admin");
  if (adminError) {
    console.error("[Social Publish] Admin check failed:", adminError.message);
    return jsonResponse({ error: "Social publishing permission check failed." }, 500);
  }
  if (!isAdmin) {
    return jsonResponse({ error: "Only Signal Share admins can post to connected Social providers." }, 403);
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

  const draft = {
    text: readString(payload.text, 6000),
    linkUrl,
    instagramImageUrl,
    instagramHashtags: readString(payload.instagramHashtags, 500),
  };

  const results: ProviderResult[] = [];
  for (const provider of providers) {
    results.push(await publishProvider(provider, draft));
  }

  return jsonResponse({
    ok: results.every((result) => result.ok),
    results,
  });
});

async function publishProvider(
  provider: SocialProvider,
  draft: {
    text: string;
    linkUrl: string;
    instagramImageUrl: string;
    instagramHashtags: string;
  }
): Promise<ProviderResult> {
  try {
    switch (provider) {
      case "facebook":
        return await publishFacebook(draft.text, draft.linkUrl);
      case "instagram":
        return await publishInstagram(draft.text, draft.instagramHashtags, draft.instagramImageUrl);
      case "x":
        return await publishX(draft.text, draft.linkUrl);
      case "linkedin":
        return await publishLinkedIn(draft.text, draft.linkUrl);
      default:
        return { provider, ok: false, error: "Provider is not supported." };
    }
  } catch (error) {
    return {
      provider,
      ok: false,
      error: error instanceof Error ? error.message : "Provider publish failed.",
    };
  }
}

async function publishFacebook(text: string, linkUrl: string): Promise<ProviderResult> {
  const provider: SocialProvider = "facebook";
  const pageId = readString(Deno.env.get("FACEBOOK_PAGE_ID"), 200);
  const accessToken = readString(Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN"), 4096);
  if (!pageId || !accessToken) {
    return { provider, ok: false, error: "Facebook publishing is not configured." };
  }
  if (!text && !linkUrl) {
    return { provider, ok: false, error: "Facebook needs post text or an optional link URL." };
  }

  const body = new URLSearchParams({ access_token: accessToken });
  if (text) body.set("message", text);
  if (linkUrl) body.set("link", linkUrl);

  const { payload } = await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(pageId)}/feed`),
    {
      method: "POST",
      body,
    },
    provider
  );

  return {
    provider,
    ok: true,
    id: readString(payload?.id, 300),
  };
}

async function publishInstagram(
  text: string,
  hashtags: string,
  imageUrl: string
): Promise<ProviderResult> {
  const provider: SocialProvider = "instagram";
  const userId = readString(Deno.env.get("INSTAGRAM_USER_ID"), 200);
  const accessToken = readString(Deno.env.get("INSTAGRAM_ACCESS_TOKEN"), 4096);
  if (!userId || !accessToken) {
    return { provider, ok: false, error: "Instagram publishing is not configured." };
  }
  if (!imageUrl) {
    return { provider, ok: false, error: "Instagram direct publishing needs a public image URL." };
  }

  const caption = [text, hashtags].filter(Boolean).join("\n\n");
  const creationBody = new URLSearchParams({
    access_token: accessToken,
    image_url: imageUrl,
  });
  if (caption) creationBody.set("caption", caption);

  const { payload: container } = await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(userId)}/media`),
    {
      method: "POST",
      body: creationBody,
    },
    provider
  );
  const creationId = readString(container?.id, 300);
  if (!creationId) {
    throw new Error("Instagram did not return a media container id.");
  }

  const publishBody = new URLSearchParams({
    access_token: accessToken,
    creation_id: creationId,
  });
  const { payload: published } = await requestProviderJson(
    metaGraphUrl(`${encodeURIComponent(userId)}/media_publish`),
    {
      method: "POST",
      body: publishBody,
    },
    provider
  );

  return {
    provider,
    ok: true,
    id: readString(published?.id, 300),
  };
}

async function publishX(text: string, linkUrl: string): Promise<ProviderResult> {
  const provider: SocialProvider = "x";
  const accessToken = readString(Deno.env.get("X_USER_ACCESS_TOKEN"), 4096);
  const oauth1 = readXOAuth1Credentials();
  const postText = joinPostText(text, linkUrl);
  if (!accessToken && !oauth1) {
    return { provider, ok: false, error: "X publishing is not configured." };
  }
  if (!postText) {
    return { provider, ok: false, error: "X needs post text or an optional link URL." };
  }

  const authorization = oauth1
    ? await xOAuth1Authorization("POST", "https://api.x.com/2/tweets", oauth1)
    : `Bearer ${accessToken}`;
  const { payload } = await requestProviderJson("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: postText }),
  }, provider);

  return {
    provider,
    ok: true,
    id: readString(payload?.data?.id, 300),
  };
}

async function publishLinkedIn(text: string, linkUrl: string): Promise<ProviderResult> {
  const provider: SocialProvider = "linkedin";
  const accessToken = readString(Deno.env.get("LINKEDIN_ACCESS_TOKEN"), 4096);
  const author = readString(Deno.env.get("LINKEDIN_AUTHOR_URN"), 300);
  const version = readString(Deno.env.get("LINKEDIN_VERSION"), 32);
  const commentary = joinPostText(text, linkUrl);
  if (!accessToken || !author || !version) {
    return { provider, ok: false, error: "LinkedIn publishing is not configured." };
  }
  if (!commentary) {
    return { provider, ok: false, error: "LinkedIn needs post text or an optional link URL." };
  }

  const { response, payload } = await requestProviderJson("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Linkedin-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      commentary,
      visibility: "PUBLIC",
      lifecycleState: "PUBLISHED",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      isReshareDisabledByAuthor: false,
    }),
  }, provider);

  return {
    provider,
    ok: true,
    id: readString(response.headers.get("x-restli-id"), 300) || readString(payload?.id, 300),
  };
}

async function requestProviderJson(url: string, options: RequestInit, provider?: SocialProvider) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerErrorMessage(payload, provider) || `Provider returned HTTP ${response.status}.`);
  }
  return { response, payload };
}

function readProviders(value: unknown) {
  if (!Array.isArray(value)) return [];
  const known = new Set<SocialProvider>(["facebook", "instagram", "x", "linkedin"]);
  return [...new Set(value.map((item) => readString(item, 40).toLowerCase()))]
    .filter((item): item is SocialProvider => known.has(item as SocialProvider));
}

function joinPostText(text: string, linkUrl: string) {
  return [text, linkUrl].filter(Boolean).join("\n\n");
}

function metaGraphUrl(path: string) {
  const version = META_GRAPH_API_VERSION.replace(/^\/+|\/+$/g, "");
  const versionPrefix = version ? `${version}/` : "";
  return `https://graph.facebook.com/${versionPrefix}${path.replace(/^\/+/, "")}`;
}

function readXOAuth1Credentials(): XOAuth1Credentials | null {
  const credentials = {
    consumerKey: readString(Deno.env.get("X_API_KEY"), 4096),
    consumerSecret: readString(Deno.env.get("X_API_KEY_SECRET"), 4096),
    accessToken: readString(Deno.env.get("X_ACCESS_TOKEN"), 4096),
    accessTokenSecret: readString(Deno.env.get("X_ACCESS_TOKEN_SECRET"), 4096),
  };

  return Object.values(credentials).every(Boolean) ? credentials : null;
}

async function xOAuth1Authorization(method: string, rawUrl: string, credentials: XOAuth1Credentials) {
  const url = new URL(rawUrl);
  const oauthParams = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: `${Math.floor(Date.now() / 1000)}`,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const signatureParams = [
    ...Object.entries(oauthParams),
    ...url.searchParams.entries(),
  ].map(([key, value]) => [oauthPercentEncode(key), oauthPercentEncode(value)] as const)
    .sort(compareOAuthPairs);
  const normalizedParams = signatureParams.map(([key, value]) => `${key}=${value}`).join("&");
  const baseUrl = `${url.origin}${url.pathname}`;
  const signatureBase = [
    method.toUpperCase(),
    oauthPercentEncode(baseUrl),
    oauthPercentEncode(normalizedParams),
  ].join("&");
  const signingKey = [
    oauthPercentEncode(credentials.consumerSecret),
    oauthPercentEncode(credentials.accessTokenSecret),
  ].join("&");
  const oauthSignature = await signHmacSha1(signingKey, signatureBase);
  const headerParams = Object.entries({
    ...oauthParams,
    oauth_signature: oauthSignature,
  }).sort(compareOAuthPairs);

  return `OAuth ${headerParams.map(([key, value]) => (
    `${oauthPercentEncode(key)}="${oauthPercentEncode(value)}"`
  )).join(", ")}`;
}

function compareOAuthPairs(left: readonly [string, string], right: readonly [string, string]) {
  if (left[0] === right[0]) return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
  return left[0] < right[0] ? -1 : 1;
}

function oauthPercentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

async function signHmacSha1(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function readString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function providerErrorMessage(payload: Record<string, unknown> | null, provider?: SocialProvider) {
  if (!payload || typeof payload !== "object") return "";
  const nestedError = payload.error as Record<string, unknown> | undefined;
  const message = readString(nestedError?.message ?? payload.message ?? payload.title, 260);
  const code = typeof nestedError?.code === "number" ? nestedError.code : 0;
  if (provider === "facebook" && (code === 190 || message === "Got unexpected null")) {
    return "Facebook rejected the Page access token. Set FACEBOOK_PAGE_ACCESS_TOKEN to a current Page access token with Page post access.";
  }
  if (provider === "x" && message === "Unsupported Authentication") {
    return "X rejected app-only authentication. Use an OAuth 2.0 user access token or configure the X OAuth 1.0a user-context secrets.";
  }
  return message;
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
