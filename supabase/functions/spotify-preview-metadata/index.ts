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

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return jsonResponse({ error: "Spotify credentials are not configured." }, 400);
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
  const accessToken = await getSpotifyAccessToken();
  if (!accessToken) {
    return jsonResponse({ error: "Spotify access token could not be created." }, 500);
  }

  const metadata = await fetchSpotifyPreviewMetadata(resource, accessToken, market);
  if (!metadata) {
    return jsonResponse({ error: "Spotify preview metadata could not be loaded." }, 404);
  }

  return jsonResponse(metadata);
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
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^open\./, "").replace(/^play\./, "");
  if (host !== "spotify.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const allowedTypes = new Set(["track", "album", "artist", "playlist", "episode", "show"]);
  const [type, id] = segments;
  if (!type || !id || !allowedTypes.has(type)) {
    return null;
  }

  return {
    type: type as SpotifyResource["type"],
    id,
  };
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
