package io.signalshare.app;

import android.service.notification.StatusBarNotification;
import android.service.notification.NotificationListenerService;

public final class PhoneNowPlayingNotificationListenerService extends NotificationListenerService {
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        PhoneNowPlayingHelper.pushSnapshotToConnectedNodes(this);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        super.onNotificationPosted(sbn);
        PhoneNowPlayingHelper.pushSnapshotToConnectedNodes(this);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        super.onNotificationRemoved(sbn);
        PhoneNowPlayingHelper.pushSnapshotToConnectedNodes(this);
    }
}
