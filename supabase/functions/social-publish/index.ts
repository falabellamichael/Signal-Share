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

  const { payload } = await requestProviderJson(metaGraphUrl(`${encodeURIComponent(pageId)}/feed`), {
    method: "POST",
    body,
  });

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
    }
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
    }
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
  const postText = joinPostText(text, linkUrl);
  if (!accessToken) {
    return { provider, ok: false, error: "X publishing is not configured." };
  }
  if (!postText) {
    return { provider, ok: false, error: "X needs post text or an optional link URL." };
  }

  const { payload } = await requestProviderJson("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: postText }),
  });

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
  });

  return {
    provider,
    ok: true,
    id: readString(response.headers.get("x-restli-id"), 300) || readString(payload?.id, 300),
  };
}

async function requestProviderJson(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerErrorMessage(payload) || `Provider returned HTTP ${response.status}.`);
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

function providerErrorMessage(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload !== "object") return "";
  const nestedError = payload.error as Record<string, unknown> | undefined;
  return readString(nestedError?.message ?? payload.message ?? payload.title, 260);
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
