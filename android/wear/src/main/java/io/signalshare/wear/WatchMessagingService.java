package io.signalshare.wear;

import android.text.TextUtils;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class WatchMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        WatchPushManager.handleNewToken(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String title = data.get("title");
        String body = data.get("body");
        String threadId = data.get("threadId");
        String messageId = data.get("messageId");

        if (TextUtils.isEmpty(title) && remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
        }
        if (TextUtils.isEmpty(body) && remoteMessage.getNotification() != null) {
            body = remoteMessage.getNotification().getBody();
        }

        WatchPushManager.showIncomingMessageNotification(
            this,
            TextUtils.isEmpty(title) ? "New message" : title,
            body,
            threadId,
            messageId
        );
    }
}
