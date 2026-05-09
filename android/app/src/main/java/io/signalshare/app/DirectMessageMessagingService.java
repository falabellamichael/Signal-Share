package io.signalshare.app;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.Manifest;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class DirectMessageMessagingService extends MessagingService {
    private static final String CHANNEL_ID = "messages_alerts";
    private static final String CHANNEL_NAME = "Messages";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        // Always call super to ensure Capacitor JS listeners receive the event
        super.onMessageReceived(remoteMessage);

        if (isDirectMessage(remoteMessage)) {
            // Only show native notification if the app is NOT in the foreground.
            // When in foreground, the Web/JS layer handles the notification UI.
            if (!isAppInForeground()) {
                showDirectMessageNotification(remoteMessage);
            }
        }
    }

    private boolean isAppInForeground() {
        ActivityManager.RunningAppProcessInfo appProcessInfo = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(appProcessInfo);
        return (appProcessInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
                appProcessInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
    }

    private boolean isDirectMessage(RemoteMessage remoteMessage) {
        return TextUtils.equals("direct-message", remoteMessage.getData().get("type"));
    }

    private void showDirectMessageNotification(RemoteMessage remoteMessage) {
        createNotificationChannel();

        String title = remoteMessage.getData().get("title");
        String body = remoteMessage.getData().get("body");
        String threadId = remoteMessage.getData().get("threadId");
        String messageId = remoteMessage.getData().get("messageId");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(TextUtils.isEmpty(title) ? "New message" : title)
                .setAutoCancel(true)
                .setLocalOnly(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
                .setVibrate(new long[]{120, 50, 120})
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(createContentIntent(threadId));

        if (!TextUtils.isEmpty(body)) {
            builder.setContentText(body);
        }

        int notificationId = !TextUtils.isEmpty(messageId)
                ? messageId.hashCode()
                : (!TextUtils.isEmpty(threadId) ? threadId.hashCode() : (int) System.currentTimeMillis());
        
        // Check if we have permission to post notifications (required for Android 13+)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(this).notify(notificationId, builder.build());
        }
    }

    private PendingIntent createContentIntent(String threadId) {
        String deepLink = "signalshare://messages";
        if (!TextUtils.isEmpty(threadId)) {
            deepLink += "/" + Uri.encode(threadId);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(deepLink));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int requestCode = !TextUtils.isEmpty(threadId) ? threadId.hashCode() : 0;
        return PendingIntent.getActivity(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Direct Messenger alerts");
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
}
