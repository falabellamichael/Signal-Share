package io.signalshare.app;

import androidx.annotation.NonNull;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;

import java.nio.charset.StandardCharsets;

public final class PhoneNowPlayingWearService extends WearableListenerService {
    @Override
    public void onMessageReceived(@NonNull MessageEvent messageEvent) {
        if (PhoneNowPlayingHelper.REQUEST_PATH.equals(messageEvent.getPath())) {
            byte[] payload = PhoneNowPlayingHelper.readSnapshot(this).toBytes();
            Wearable.getMessageClient(this).sendMessage(
                    messageEvent.getSourceNodeId(),
                    PhoneNowPlayingHelper.STATE_PATH,
                    payload
            );
            return;
        }

        if (PhoneNowPlayingHelper.ACTION_PATH.equals(messageEvent.getPath())) {
            String action = new String(messageEvent.getData(), StandardCharsets.UTF_8);
            PhoneNowPlayingHelper.performAction(this, action);
            return;
        }

        if (!PhoneNowPlayingHelper.REQUEST_PATH.equals(messageEvent.getPath())) {
            super.onMessageReceived(messageEvent);
        }
    }
}
