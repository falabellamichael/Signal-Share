import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type MessageRecord = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string | null;
  attachment_name: string | null;
  attachment_kind: string | null;
  created_at: string;
};

type ThreadRecord = {
  id: string;
  user_one_id: string;
  user_two_id: string;
};

type PushSubscriptionRecord = {
  id: string;
  platform: "web" | "android" | "android_wear";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  device_token: string | null;
  user_agent: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEB_PUSH_SUBJECT = Deno.env.get("WEB_PUSH_SUBJECT") ?? "";
const WEB_PUSH_PUBLIC_KEY = Deno.env.get("WEB_PUSH_PUBLIC_KEY") ?? "";
const WEB_PUSH_PRIVATE_KEY = Deno.env.get("WEB_PUSH_PRIVATE_KEY") ?? "";
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";

let cachedGoogleAccessToken = "";
let cachedGoogleAccessTokenExpiresAt = 0;

if (WEB_PUSH_SUBJECT && WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Supabase environment variables are incomplete." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Missing authorization header." }, 401);
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

  const payload = await request.json().catch(() => ({}));
  const messageId = `${payload?.messageId ?? ""}`.trim();
  if (!messageId) {
    return jsonResponse({ error: "Missing messageId." }, 400);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: messageRow, error: messageError } = await adminClient
    .from("messages")
    .select("id, thread_id, sender_id, body, attachment_name, attachment_kind, created_at")
    .eq("id", messageId)
    .single<MessageRecord>();

  if (messageError || !messageRow) {
    return jsonResponse({ error: "Message not found." }, 404);
  }

  if (messageRow.sender_id !== user.id) {
    return jsonResponse({ error: "You can only dispatch notifications for your own messages." }, 403);
  }

  const { data: threadRow, error: threadError } = await adminClient
    .from("direct_threads")
    .select("id, user_one_id, user_two_id")
    .eq("id", messageRow.thread_id)
    .single<ThreadRecord>();

  if (threadError || !threadRow) {
    return jsonResponse({ error: "Message thread not found." }, 404);
  }

  const recipientId =
    threadRow.user_one_id === messageRow.sender_id ? threadRow.user_two_id : threadRow.user_one_id;

  const { data: subscriptions, error: subscriptionsError } = await adminClient
    .from("push_subscriptions")
    .select("id, platform, endpoint, p256dh, auth, device_token, user_agent")
    .eq("user_id", recipientId)
    .returns<PushSubscriptionRecord[]>();

  if (subscriptionsError) {
    return jsonResponse({ error: "Push subscriptions could not be loaded." }, 500);
  }

  if (!subscriptions?.length) {
    return jsonResponse({ sent: 0, staleRemoved: 0, skipped: true });
  }

  const notificationPayload = buildNotificationPayload(messageRow);
  let sent = 0;
  let staleRemoved = 0;

  for (const subscription of subscriptions) {
    if (subscription.platform === "web") {
      const result = await sendWebPushNotification(subscription, notificationPayload);
      if (result.sent) {
        sent += 1;
      }
      if (result.removeSubscription) {
        await deleteSubscription(adminClient, subscription.id);
        staleRemoved += 1;
      }
      continue;
    }

    if (subscription.platform === "android" || subscription.platform === "android_wear") {
      const result = await sendAndroidPushNotification(subscription, notificationPayload);
      if (result.sent) {
        sent += 1;
      }
      if (result.removeSubscription) {
        await deleteSubscription(adminClient, subscription.id);
        staleRemoved += 1;
      }
    }
  }

  return jsonResponse({ sent, staleRemoved });
});

function buildNotificationPayload(message: MessageRecord) {
  return {
    title: "New message",
    body: summarizeMessageBody(message),
    threadId: message.thread_id,
    url: "#messages",
    tag: `direct-message-${message.id}`,
    icon: "./icons/icon-192.png?v=2",
    badge: "./icons/icon-192.png?v=2",
    vibrate: [120, 50, 120],
    messageId: message.id,
  };
}

function summarizeMessageBody(message: MessageRecord) {
  if (message.body?.trim()) {
    return truncateText(message.body.trim(), 120);
  }

  if (message.attachment_name?.trim()) {
    return `Sent ${message.attachment_name.trim()}`;
  }

  if (message.attachment_kind?.trim()) {
    return `Sent a ${message.attachment_kind.trim()}`;
  }

  return "New direct message";
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

async function sendWebPushNotification(
  subscription: PushSubscriptionRecord,
  payload: ReturnType<typeof buildNotificationPayload>
) {
  if (!WEB_PUSH_SUBJECT || !WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) {
    return { sent: false, removeSubscription: false };
  }

  if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    return { sent: false, removeSubscription: true };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 60,
        urgency: "high",
      }
    );

    return { sent: true, removeSubscription: false };
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode ?? 0);
    return {
      sent: false,
      removeSubscription: statusCode === 404 || statusCode === 410,
    };
  }
}

async function sendAndroidPushNotification(
  subscription: PushSubscriptionRecord,
  payload: ReturnType<typeof buildNotificationPayload>
) {
  if (!FCM_SERVICE_ACCOUNT_JSON || !subscription.device_token) {
    return { sent: false, removeSubscription: false };
  }

  try {
    const isWearDevice =
      subscription.platform === "android_wear" ||
      (subscription.platform === "android" && (subscription.user_agent ?? "").includes("Wear OS"));
    const serviceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_JSON) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: subscription.device_token,
            data: {
              type: "direct-message",
              title: payload.title,
              body: payload.body,
              threadId: payload.threadId,
              url: payload.url,
              messageId: payload.messageId,
            },
            android: {
              priority: "high",
              ttl: "60s",
              direct_boot_ok: true,
              ...(isWearDevice
                ? {}
                : {
                    collapse_key: "direct-message",
                  }),
            },
          },
        }),
      }
    );

    if (response.ok) {
      return { sent: true, removeSubscription: false };
    }

    const errorPayload = await response.json().catch(() => ({}));
    const details = errorPayload?.error?.details ?? [];
    const removeSubscription = details.some(
      (detail: { errorCode?: string }) => detail?.errorCode === "UNREGISTERED"
    );

    return { sent: false, removeSubscription };
  } catch (_error) {
    return { sent: false, removeSubscription: false };
  }
}

async function getGoogleAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken && cachedGoogleAccessTokenExpiresAt > now + 60) {
    return cachedGoogleAccessToken;
  }

  const assertion = await createGoogleServiceJwt(serviceAccount, now);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Google access token request failed.");
  }

  const tokenPayload = await tokenResponse.json();
  cachedGoogleAccessToken = tokenPayload.access_token;
  cachedGoogleAccessTokenExpiresAt = now + Number(tokenPayload.expires_in ?? 3600);
  return cachedGoogleAccessToken;
}

async function createGoogleServiceJwt(
  serviceAccount: { client_email: string; private_key: string },
  issuedAt: number
) {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const unsignedToken = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(claims)}`;
  const privateKey = await importGooglePrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function importGooglePrivateKey(privateKeyPem: string) {
  const keyBody = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const keyBytes = Uint8Array.from(atob(keyBody), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

function base64UrlEncodeJson(value: unknown) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function deleteSubscription(adminClient: ReturnType<typeof createClient>, subscriptionId: string) {
  await adminClient.from("push_subscriptions").delete().eq("id", subscriptionId);
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
