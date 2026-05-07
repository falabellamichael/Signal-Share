const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
const SPOTIFY_DEFAULT_MARKET = normalizeMarket(Deno.env.get("SPOTIFY_DEFAULT_MARKET")) || "US";

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

type SpotifyResource = {
  type: "track" | "album" | "artist" | "playlist" | "episode" | "show";
  id: string;
};

type SpotifyPreviewMetadata = {
  title: string;
  creator: string;
  thumbnailUrl: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const url = new URL(request.url);
  const payload =
    request.method === "POST" ? await request.json().catch(() => ({} as Record<string, unknown>)) : null;
  const sourceUrl = `${payload?.url ?? url.searchParams.get("url") ?? ""}`.trim();
  if (!sourceUrl) {
    return jsonResponse({ error: "Missing Spotify URL." }, 400);
  }

  const resource = parseSpotifyUrl(sourceUrl);
  if (!resource) {
    return jsonResponse({ error: "Unsupported Spotify URL." }, 400);
  }

  const market =
    normalizeMarket(typeof payload?.market === "string" ? payload.market : url.searchParams.get("market")) ||
    SPOTIFY_DEFAULT_MARKET;
  const canonicalUrl = buildSpotifyCanonicalUrl(resource);

  let catalogMetadata: SpotifyPreviewMetadata | null = null;
  if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
    const accessToken = await getSpotifyAccessToken();
    if (accessToken) {
      catalogMetadata = await fetchSpotifyPreviewMetadata(resource, accessToken, market);
    }
  }

  // Fallback path: Spotify oEmbed is public and often works even when Web API scopes/quotas are restricted.
  const oEmbedMetadata = await fetchSpotifyOEmbedMetadata(canonicalUrl || sourceUrl);
  const metadata = mergeSpotifyPreviewMetadata(catalogMetadata, oEmbedMetadata);
  if (metadata) {
    return jsonResponse(metadata);
  }

  return jsonResponse({ error: `Spotify metadata unavailable for this ${resource.type}.` }, 404);
});

async function getSpotifyAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const credentials = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }).catch(() => null);

  if (!response?.ok) {
    cachedAccessToken = "";
    cachedAccessTokenExpiresAt = 0;
    const errBody = await response?.json().catch(() => ({}));
    console.error("[Spotify Auth Error]:", response?.status, errBody);
    return "";
  }

  const payload = await response.json().catch(() => null);
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
  const expiresIn = Number(payload?.expires_in) || 3600;
  if (!accessToken) {
    cachedAccessToken = "";
    cachedAccessTokenExpiresAt = 0;
    return "";
  }

  cachedAccessToken = accessToken;
  cachedAccessTokenExpiresAt = now + expiresIn * 1000;
  return accessToken;
}

async function fetchSpotifyPreviewMetadata(
  resource: SpotifyResource,
  accessToken: string,
  market: string
): Promise<SpotifyPreviewMetadata | null> {
  const endpoint = buildSpotifyResourceEndpoint(resource, market);
  if (!endpoint) {
    return null;
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).catch(() => null);

  if (!response?.ok) {
    const errBody = await response?.json().catch(() => ({}));
    console.error(`[Spotify API Error] ${resource.type}:`, response?.status, errBody);
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return normalizeSpotifyPreviewMetadata(resource.type, payload);
}

function buildSpotifyResourceEndpoint(resource: SpotifyResource, market: string) {
  const base = "https://api.spotify.com/v1";
  const encodedId = encodeURIComponent(resource.id);
  const marketSuffix = market ? `?market=${encodeURIComponent(market)}` : "";

  switch (resource.type) {
    case "track":
      return `${base}/tracks/${encodedId}${marketSuffix}`;
    case "album":
      return `${base}/albums/${encodedId}${marketSuffix}`;
    case "artist":
      return `${base}/artists/${encodedId}`;
    case "playlist":
      return `${base}/playlists/${encodedId}${marketSuffix}`;
    case "episode":
      return `${base}/episodes/${encodedId}${marketSuffix}`;
    case "show":
      return `${base}/shows/${encodedId}${marketSuffix}`;
    default:
      return "";
  }
}

function buildSpotifyCanonicalUrl(resource: SpotifyResource) {
  if (!resource?.type || !resource?.id) return "";
  return `https://open.spotify.com/${resource.type}/${resource.id}`;
}

async function fetchSpotifyOEmbedMetadata(resourceUrl: string): Promise<SpotifyPreviewMetadata | null> {
  const trimmedUrl = `${resourceUrl || ""}`.trim();
  if (!trimmedUrl) return null;

  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(trimmedUrl)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const title = readString(payload.title);
  const creator = readString(payload.author_name);
  const thumbnailUrl = readString(payload.thumbnail_url);
  if (!title && !creator && !thumbnailUrl) {
    return null;
  }

  return {
    title,
    creator,
    thumbnailUrl,
  };
}

function mergeSpotifyPreviewMetadata(
  catalogMetadata: SpotifyPreviewMetadata | null,
  oEmbedMetadata: SpotifyPreviewMetadata | null
): SpotifyPreviewMetadata | null {
  if (!catalogMetadata && !oEmbedMetadata) return null;

  return {
    title: readString(catalogMetadata?.title) || readString(oEmbedMetadata?.title),
    creator: readString(catalogMetadata?.creator) || readString(oEmbedMetadata?.creator),
    thumbnailUrl: readString(catalogMetadata?.thumbnailUrl) || readString(oEmbedMetadata?.thumbnailUrl),
  };
}

function normalizeSpotifyPreviewMetadata(type: SpotifyResource["type"], payload: Record<string, unknown>) {
  switch (type) {
    case "track": {
      const artists = (payload.artists as unknown[]) || [];
      const album = payload.album as Record<string, unknown> | null;
      return {
        title: readString(payload.name) || "Unknown Track",
        creator: joinNames(artists) || joinNames(album?.artists) || "Unknown Artist",
        thumbnailUrl: firstImageUrl(album?.images) || firstImageUrl(payload.images),
      };
    }
    case "album":
      return {
        title: readString(payload.name) || "Unknown Album",
        creator: joinNames(payload.artists) || "Unknown Artist",
        thumbnailUrl: firstImageUrl(payload.images),
      };
    case "artist":
      return {
        title: readString(payload.name) || "Unknown Artist",
        creator: "Artist",
        thumbnailUrl: firstImageUrl(payload.images),
      };
    case "playlist": {
      const owner = payload.owner as Record<string, unknown> | null;
      return {
        title: readString(payload.name) || "Unknown Playlist",
        creator: readString(owner?.display_name) || readString(owner?.id) || "Spotify Playlist",
        thumbnailUrl: firstImageUrl(payload.images),
      };
    }
    case "episode": {
      const show = payload.show as Record<string, unknown> | null;
      return {
        title: readString(payload.name) || "Unknown Episode",
        creator: readString(show?.name) || readString(show?.publisher) || "Spotify Episode",
        thumbnailUrl: firstImageUrl(payload.images) || firstImageUrl(show?.images),
      };
    }
    case "show":
      return {
        title: readString(payload.name) || "Unknown Show",
        creator: readString(payload.publisher) || readString(payload.name) || "Spotify Show",
        thumbnailUrl: firstImageUrl(payload.images),
      };
    default:
      return null;
  }
}

function parseSpotifyUrl(rawUrl: string): SpotifyResource | null {
  const value = `${rawUrl || ""}`.trim();
  if (!value) {
    return null;
  }

  const spotifyUriMatch = value.match(/^spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]+)$/i);
  if (spotifyUriMatch) {
    return {
      type: spotifyUriMatch[1].toLowerCase() as SpotifyResource["type"],
      id: spotifyUriMatch[2],
    };
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const host = parsed.hostname.replace(/^www\./i, "").replace(/^open\./i, "").replace(/^play\./i, "").toLowerCase();
    if (host !== "spotify.com") {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] && /^intl-[a-z]{2,5}$/i.test(segments[0])) segments.shift();
    if (segments[0] === "embed") segments.shift();

    const allowedTypes = new Set(["track", "album", "artist", "playlist", "episode", "show"]);
    const type = `${segments[0] || ""}`.trim().toLowerCase();
    const id = `${segments[1] || ""}`.trim().replace(/[/?#].*$/, "");
    if (!type || !id || !allowedTypes.has(type)) {
      return null;
    }

    return {
      type: type as SpotifyResource["type"],
      id,
    };
  } catch {
    return null;
  }
}

function normalizeMarket(value: string | null | undefined) {
  const market = `${value ?? ""}`.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(market) ? market : "";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function joinNames(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (entry && typeof entry === "object" && "name" in entry) {
        return readString(entry.name);
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

function firstImageUrl(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }

  for (const entry of value) {
    const candidate = readString((entry as Record<string, unknown> | null)?.url);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function jsonResponse(payload: Record<string, unknown>, _status = 200) {
  return new Response(JSON.stringify(payload), {
    status: 200, // Always 200 to avoid generic Supabase "non-2xx" errors in frontend
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
