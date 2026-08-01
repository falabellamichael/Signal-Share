import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type XOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type LinkedInOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type MetaOAuthConfig = {
  clientId: string;
  clientSecret: string;
  graphApiVersion: string;
};

export type StoredMetaOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type SocialOAuthConfig = {
  x: XOAuthConfig;
  linkedin: LinkedInOAuthConfig;
  meta: MetaOAuthConfig;
};

export type StoredSocialOAuthConfig = {
  x?: XOAuthConfig;
  linkedin?: LinkedInOAuthConfig;
  meta?: StoredMetaOAuthConfig;
};

export type LoadedSocialOAuthConfig = {
  config: SocialOAuthConfig;
  stored: StoredSocialOAuthConfig;
  settingsAvailable: boolean;
};

const GET_CONFIG_RPC = "get_signal_share_oauth_config";
const UPDATE_PROVIDER_RPC = "update_signal_share_oauth_provider";

export async function loadSocialOAuthConfig(adminClient: SupabaseClient): Promise<LoadedSocialOAuthConfig> {
  const environment = environmentOAuthConfig();
  const { data, error } = await adminClient.rpc(GET_CONFIG_RPC);
  if (error) {
    const code = readString(error.code, 80);
    if (code === "PGRST202" || code === "42883") {
      return { config: environment, stored: {}, settingsAvailable: false };
    }
    console.error("[Social OAuth Config] Vault configuration lookup failed:", code || "unknown");
    throw new Error("OAuth configuration could not be loaded securely.");
  }

  const stored = normalizeStoredConfig(data);
  return {
    config: {
      x: hasOwn(stored, "x") ? stored.x! : environment.x,
      linkedin: hasOwn(stored, "linkedin") ? stored.linkedin! : environment.linkedin,
      meta: hasOwn(stored, "meta")
        ? { ...stored.meta!, graphApiVersion: environment.meta.graphApiVersion }
        : environment.meta,
    },
    stored,
    settingsAvailable: true,
  };
}

export async function saveSocialOAuthProviderConfig<Provider extends keyof StoredSocialOAuthConfig>(
  adminClient: SupabaseClient,
  provider: Provider,
  config: NonNullable<StoredSocialOAuthConfig[Provider]> | null
) {
  const normalized = config === null
    ? null
    : normalizeStoredConfig({ [provider]: config })[provider] ?? null;
  if (config !== null && normalized === null) {
    throw new Error("OAuth settings are invalid.");
  }

  const { error } = await adminClient.rpc(UPDATE_PROVIDER_RPC, {
    target_provider: provider,
    target_provider_config: normalized,
  });
  if (error) {
    const code = readString(error.code, 80);
    if (code === "PGRST202" || code === "42883") {
      throw new Error("Apply the latest Supabase migration before saving OAuth settings.");
    }
    console.error("[Social OAuth Config] Vault configuration save failed:", code || "unknown");
    throw new Error("OAuth settings could not be saved securely.");
  }
  return normalized;
}

export function xOAuthConfigured(config: XOAuthConfig) {
  return Boolean(config.clientId);
}

export function linkedInOAuthConfigured(config: LinkedInOAuthConfig) {
  return Boolean(config.clientId && config.clientSecret);
}

export function metaOAuthConfigured(config: MetaOAuthConfig) {
  return Boolean(config.clientId && config.clientSecret);
}

function environmentOAuthConfig(): SocialOAuthConfig {
  return {
    x: {
      clientId: readString(Deno.env.get("X_OAUTH_CLIENT_ID"), 500),
      clientSecret: readString(Deno.env.get("X_OAUTH_CLIENT_SECRET"), 2000),
    },
    linkedin: {
      clientId: readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_ID"), 500),
      clientSecret: readString(Deno.env.get("LINKEDIN_OAUTH_CLIENT_SECRET"), 2000),
    },
    meta: {
      clientId: readString(Deno.env.get("META_OAUTH_APP_ID"), 500),
      clientSecret: readString(Deno.env.get("META_OAUTH_APP_SECRET"), 2000),
      graphApiVersion: normalizeGraphVersion(Deno.env.get("META_GRAPH_API_VERSION")),
    },
  };
}

function normalizeStoredConfig(value: unknown): StoredSocialOAuthConfig {
  const root = parseRecord(value);
  const config: StoredSocialOAuthConfig = {};

  if (hasOwn(root, "x")) {
    const provider = parseRecord(root.x);
    config.x = {
      clientId: readString(provider.clientId, 500),
      clientSecret: readString(provider.clientSecret, 2000),
    };
  }
  if (hasOwn(root, "linkedin")) {
    const provider = parseRecord(root.linkedin);
    config.linkedin = {
      clientId: readString(provider.clientId, 500),
      clientSecret: readString(provider.clientSecret, 2000),
    };
  }
  if (hasOwn(root, "meta")) {
    const provider = parseRecord(root.meta);
    config.meta = {
      clientId: readString(provider.clientId, 500),
      clientSecret: readString(provider.clientSecret, 2000),
    };
  }

  return config;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch (_error) {
      return {};
    }
  }
  if (Array.isArray(value) && value.length === 1) return parseRecord(value[0]);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeGraphVersion(value: unknown) {
  return readString(value, 32).replace(/^v?/i, "").replace(/^\/+|\/+$/g, "");
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
