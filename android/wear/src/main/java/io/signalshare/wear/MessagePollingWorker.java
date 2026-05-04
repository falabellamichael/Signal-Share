package io.signalshare.wear;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MessagePollingWorker extends Worker {
    private static final String CHANNEL_ID = "watch_messages_alerts_v3";
    private static final String CHANNEL_NAME = "Messages";
    private static final String PREF_LAST_MESSAGE_ID = "last_message_id_seen";
    private static final String PREF_PUSH_TOKEN = "watch_push_token";

    public MessagePollingWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        // Legacy fallback disabled now that watch push notifications are live.
        return Result.success();
    }

    private void showNotification(String title, String body, String threadId) {
        NotificationManager nm = (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.enableLights(true);
        channel.setLightColor(Color.BLUE);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{120, 50, 120});
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
        );
        nm.createNotificationChannel(channel);

        Intent intent = new Intent(getApplicationContext(), MainActivity.class);
        intent.putExtra("threadId", threadId);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        PendingIntent pi = PendingIntent.getActivity(getApplicationContext(), threadId.hashCode(), intent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                .setSmallIcon(R.drawable.wear_app_icon)
                .setContentTitle(title)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVibrate(new long[]{120, 50, 120})
                .setSilent(false);

        if (!TextUtils.isEmpty(body)) {
            builder.setContentText(body);
        }

        nm.notify(threadId.hashCode(), builder.build());
        WatchPushManager.playAlertFeedback(getApplicationContext());
    }

    private JSONArray fetchThreads(String userId, String accessToken) throws Exception {
        String filter = String.format(Locale.US, "(user_one_id.eq.%s,user_two_id.eq.%s)", userId, userId);
        String urlString = BuildConfig.SUPABASE_URL + "/rest/v1/direct_threads?select=id,updated_at&or=" + filter + "&order=updated_at.desc&limit=1";
        return new JSONArray(executeGetRequest(urlString, accessToken));
    }

    private JSONArray fetchLatestMessages(String threadId, String accessToken) throws Exception {
        String urlString = BuildConfig.SUPABASE_URL + "/rest/v1/messages?select=id,sender_id,body,created_at&thread_id=eq." + threadId + "&order=created_at.desc&limit=1";
        return new JSONArray(executeGetRequest(urlString, accessToken));
    }

    private String executeGetRequest(String urlString, String accessToken) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
        conn.setRequestProperty("Authorization", "Bearer " + accessToken);

        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
        
        BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        conn.disconnect();
        
        return sb.toString();
    }
}
