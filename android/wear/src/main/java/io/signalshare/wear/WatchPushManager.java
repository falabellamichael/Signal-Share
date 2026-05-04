package io.signalshare.wear;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.ToneGenerator;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.VibrationAttributes;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.text.TextUtils;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class WatchPushManager {
    private static final String TAG = "WatchPushManager";
    private static final String PREFS_NAME = "signal_share_wear";
    private static final String PREF_ACCESS_TOKEN = "access_token";
    private static final String PREF_USER_ID = "user_id";
    private static final String PREF_PUSH_TOKEN = "watch_push_token";
    private static final String PREF_LAST_MESSAGE_ID = "last_message_id_seen";
    private static final String PREF_WATCH_NOTIFICATIONS_ENABLED = "watch_notifications_enabled";
    private static final String PREF_APP_VISIBLE = "app_visible";
    private static final String CHANNEL_ID = "watch_messages_alerts_v3";
    private static final String CHANNEL_NAME = "Messages";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private WatchPushManager() {
    }

    public static void ensureInitialized(Context context) {
        Context appContext = context.getApplicationContext();
        createNotificationChannel(appContext);
        // Default to enabled if not set
        if (!getPrefs(appContext).contains(PREF_WATCH_NOTIFICATIONS_ENABLED)) {
            setWatchNotificationsEnabled(appContext, true);
        }
        com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> {
                    if (TextUtils.isEmpty(token)) {
                        return;
                    }

                    persistPushToken(appContext, token);
                    registerPushSubscription(appContext, token);
                });
    }

    public static void handleNewToken(Context context, String token) {
        if (TextUtils.isEmpty(token)) {
            return;
        }

        Context appContext = context.getApplicationContext();
        createNotificationChannel(appContext);
        persistPushToken(appContext, token);
        registerPushSubscription(appContext, token);
    }

    public static void unregisterPushSubscription(Context context, String accessToken) {
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        String token = getStoredPushToken(context);
        if (TextUtils.isEmpty(token)) {
            return;
        }

        EXECUTOR.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("subscription_platform", "android");
                payload.put("subscription_endpoint", JSONObject.NULL);
                payload.put("subscription_device_token", token);
                executeRpcRequest(
                        BuildConfig.SUPABASE_URL + "/rest/v1/rpc/unregister_push_subscription",
                        payload,
                        accessToken
                );
            } catch (Exception exception) {
                Log.w(TAG, "Failed to unregister watch push subscription", exception);
            }
        });
    }

    public static void showIncomingMessageNotification(
            Context context,
            String title,
            String body,
            String threadId,
            String messageId
    ) {
        Context appContext = context.getApplicationContext();

        // Check if watch notifications are manually disabled
        if (!isWatchNotificationsEnabled(appContext)) {
            return;
        }

        if (hasSeenMessage(appContext, messageId)) {
            return;
        }

        createNotificationChannel(appContext);
        markMessageAsSeen(appContext, messageId);

        NotificationManager notificationManager =
                (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            return;
        }

        Intent intent = new Intent(appContext, MainActivity.class);
        if (!TextUtils.isEmpty(threadId)) {
            intent.putExtra("threadId", threadId);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int requestCode = !TextUtils.isEmpty(messageId) ? messageId.hashCode() : threadId.hashCode();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                appContext,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(appContext, CHANNEL_ID)
                .setSmallIcon(R.drawable.wear_app_icon)
                .setContentTitle(TextUtils.isEmpty(title) ? "New message" : title)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVibrate(new long[]{120, 50, 120})
                .setSilent(false)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        if (!TextUtils.isEmpty(body)) {
            builder.setContentText(body);
        }

        notificationManager.notify(requestCode, builder.build());
        playAlertFeedback(appContext);
    }

    public static boolean isWatchNotificationsEnabled(Context context) {
        return getPrefs(context).getBoolean(PREF_WATCH_NOTIFICATIONS_ENABLED, true);
    }

    public static void setWatchNotificationsEnabled(Context context, boolean enabled) {
        getPrefs(context).edit().putBoolean(PREF_WATCH_NOTIFICATIONS_ENABLED, enabled).apply();
    }

    private static void registerPushSubscription(Context context, String token) {
        SharedPreferences prefs = getPrefs(context);
        String accessToken = prefs.getString(PREF_ACCESS_TOKEN, "");
        String userId = prefs.getString(PREF_USER_ID, "");
        if (TextUtils.isEmpty(accessToken) || TextUtils.isEmpty(userId) || TextUtils.isEmpty(token)) {
            return;
        }

        EXECUTOR.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("subscription_platform", "android");
                payload.put("subscription_endpoint", JSONObject.NULL);
                payload.put("subscription_p256dh", JSONObject.NULL);
                payload.put("subscription_auth", JSONObject.NULL);
                payload.put("subscription_device_token", token);
                payload.put(
                        "subscription_user_agent",
                        String.format(Locale.US, "Wear OS %s (%s)", Build.MODEL, Build.VERSION.RELEASE)
                );
                executeRpcRequest(
                        BuildConfig.SUPABASE_URL + "/rest/v1/rpc/register_push_subscription",
                        payload,
                        accessToken
                );
            } catch (Exception exception) {
                Log.w(TAG, "Failed to register watch push subscription", exception);
            }
        });
    }

    private static void executeRpcRequest(String urlString, JSONObject payload, String accessToken) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setDoOutput(true);
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Prefer", "return=minimal");

            OutputStream outputStream = connection.getOutputStream();
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
            writer.write(payload.toString());
            writer.flush();
            writer.close();
            outputStream.close();

            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new IllegalStateException(readStream(connection.getErrorStream()));
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void createNotificationChannel(Context context) {
        NotificationManager notificationManager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        deleteLegacyChannel(notificationManager, "messages");
        deleteLegacyChannel(notificationManager, "messages_wear");
        deleteLegacyChannel(notificationManager, "messages_alerts");
        deleteLegacyChannel(notificationManager, "wear_background_messages");
        deleteLegacyChannel(notificationManager, "watch_messages_alerts_v2");

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Direct Messenger alerts");
        channel.enableLights(true);
        channel.setLightColor(Color.CYAN);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{120, 50, 120});
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
        );
        notificationManager.createNotificationChannel(channel);
    }

    private static void deleteLegacyChannel(NotificationManager notificationManager, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || TextUtils.equals(channelId, CHANNEL_ID)) {
            return;
        }

        try {
            notificationManager.deleteNotificationChannel(channelId);
        } catch (Exception ignored) {
            // Best-effort cleanup only.
        }
    }

    private static void persistPushToken(Context context, String token) {
        getPrefs(context).edit().putString(PREF_PUSH_TOKEN, token).apply();
    }

    private static String getStoredPushToken(Context context) {
        return getPrefs(context).getString(PREF_PUSH_TOKEN, "");
    }

    private static void markMessageAsSeen(Context context, String messageId) {
        if (TextUtils.isEmpty(messageId)) {
            return;
        }

        getPrefs(context).edit().putString(PREF_LAST_MESSAGE_ID, messageId).apply();
    }

    private static boolean hasSeenMessage(Context context, String messageId) {
        if (TextUtils.isEmpty(messageId)) {
            return false;
        }

        return TextUtils.equals(
                getPrefs(context).getString(PREF_LAST_MESSAGE_ID, ""),
                messageId
        );
    }

    static void playAlertFeedback(Context context) {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager =
                        (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vibratorManager != null ? vibratorManager.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                VibrationEffect vibrationEffect =
                        VibrationEffect.createWaveform(new long[]{0, 120, 50, 120}, -1);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    vibrator.vibrate(
                            vibrationEffect,
                            VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION)
                    );
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(
                            vibrationEffect,
                            new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build()
                    );
                } else {
                    vibrator.vibrate(vibrationEffect);
                }
            }

            if (!playAlertTone(context)) {
                Uri notificationSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                Ringtone ringtone = RingtoneManager.getRingtone(context.getApplicationContext(), notificationSound);
                if (ringtone != null) {
                    ringtone.play();
                }
            }
        } catch (Exception exception) {
            Log.w(TAG, "Failed to play watch alert feedback", exception);
        }
    }

    private static boolean playAlertTone(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        int[] candidateStreams = new int[] {
                AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_MUSIC
        };

        for (int stream : candidateStreams) {
            try {
                if (audioManager != null && audioManager.getStreamVolume(stream) <= 0) {
                    continue;
                }

                ToneGenerator toneGenerator = new ToneGenerator(stream, 100);
                boolean started = toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP2, 300);
                if (!started) {
                    toneGenerator.release();
                    continue;
                }

                new Handler(Looper.getMainLooper()).postDelayed(toneGenerator::release, 500L);
                return true;
            } catch (Exception ignored) {
                // Try the next stream or fallback ringtone path.
            }
        }

        return false;
    }

    static String getAlertChannelId() {
        return CHANNEL_ID;
    }

    static void setAppVisible(Context context, boolean visible) {
        getPrefs(context).edit().putBoolean(PREF_APP_VISIBLE, visible).apply();
    }

    static boolean isAppVisible(Context context) {
        return getPrefs(context).getBoolean(PREF_APP_VISIBLE, false);
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) {
            return "";
        }

        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            builder.append(line);
        }
        reader.close();
        return builder.toString();
    }
}
