package io.signalshare.app;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.provider.Settings;
import android.text.TextUtils;

import androidx.core.app.NotificationManagerCompat;

import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.TimeUnit;

final class PhoneNowPlayingHelper {
    static final String REQUEST_PATH = "/signalshare/now-playing/request";
    static final String STATE_PATH = "/signalshare/now-playing/state";
    static final String ACTION_PATH = "/signalshare/now-playing/action";
    static final String MEDIA_ACCESS_DEEP_LINK = "signalshare://media-access";
    static final String ACTION_PLAY_PAUSE = "play_pause";
    static final String ACTION_NEXT = "next";
    static final String ACTION_PREVIOUS = "previous";
    private static final String PREFS_NAME = "signalshare_now_playing";
    private static final String KEY_LAST_MEDIA_PACKAGE = "last_media_package";
    private static final String KEY_LAST_MEDIA_URI = "last_media_uri";
    private static final String SPOTIFY_PACKAGE_NAME = "com.spotify.music";

    private PhoneNowPlayingHelper() {
    }

    static Snapshot readSnapshot(Context context) {
        MediaController controller = getBestActiveController(context);
        if (!hasNotificationListenerAccess(context)) {
            return Snapshot.permissionRequired();
        }
        if (controller == null) {
            return Snapshot.idle(getRememberedMediaPackage(context), getRememberedMediaUri(context));
        }

        String title = extractNowPlayingTitle(controller.getMetadata());
        if (TextUtils.isEmpty(title)) {
            title = "Current playback";
        }

        String packageName = controller.getPackageName();
        rememberMediaPackage(context, packageName);
        String openUri = resolvePlayableOpenUri(controller.getMetadata(), packageName);
        rememberMediaUri(context, openUri);
        String creator = extractNowPlayingCreator(controller.getMetadata(), title);
        String appLabel = resolveMediaAppLabel(context, packageName);
        String stateLabel = resolvePlaybackStateLabel(controller.getPlaybackState());
        String artworkUri = extractNowPlayingArtworkUri(controller.getMetadata(), openUri);
        return Snapshot.active(title, buildMediaMeta(appLabel, creator, stateLabel), packageName, openUri, artworkUri);
    }

    static boolean performAction(Context context, String action) {
        if (TextUtils.isEmpty(action)) {
            return false;
        }

        MediaController controller = getBestActiveController(context);
        if (controller == null) {
            if (ACTION_PLAY_PAUSE.equals(action)) {
                return resumeLastMediaSession(context);
            }
            return launchSpotifyApp(context);
        }

        rememberMediaPackage(context, controller.getPackageName());
        MediaController.TransportControls controls = controller.getTransportControls();
        if (controls == null) {
            if (ACTION_PLAY_PAUSE.equals(action)) {
                return resumeLastMediaSession(context);
            }
            return launchSpotifyApp(context);
        }

        switch (action) {
            case ACTION_PREVIOUS:
                controls.skipToPrevious();
                return true;
            case ACTION_NEXT:
                controls.skipToNext();
                return true;
            case ACTION_PLAY_PAUSE:
                togglePlayback(controller, controls);
                return true;
            default:
                return false;
        }
    }

    private static boolean resumeLastMediaSession(Context context) {
        // 1. Try to trigger Spotify playback silently via its internal widget broadcast
        try {
            Intent spotifyIntent = new Intent("com.spotify.mobile.android.ui.widget.PLAY");
            spotifyIntent.setPackage(SPOTIFY_PACKAGE_NAME);
            context.sendBroadcast(spotifyIntent);
        } catch (Exception ignored) {}

        // 2. Try generic media play command (wakes up the last active player)
        android.media.AudioManager am = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            long eventTime = android.os.SystemClock.uptimeMillis();
            am.dispatchMediaKeyEvent(new android.view.KeyEvent(eventTime, eventTime, android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_MEDIA_PLAY, 0));
            am.dispatchMediaKeyEvent(new android.view.KeyEvent(eventTime, eventTime, android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_MEDIA_PLAY, 0));
            return true;
        }
        return false;
    }

    static boolean openActiveOrLastMediaApp(Context context, String preferredPackageName, String preferredUri) {
        MediaController controller = getBestActiveController(context);
        String currentPackageName = controller != null ? controller.getPackageName() : "";
        String currentOpenUri = controller != null
                ? resolvePlayableOpenUri(controller.getMetadata(), currentPackageName)
                : "";
        String resolvedPackageName = !TextUtils.isEmpty(preferredPackageName)
                ? preferredPackageName
                : currentPackageName;
        String resolvedOpenUri = !TextUtils.isEmpty(preferredUri)
                ? preferredUri
                : currentOpenUri;

        if (openPreferredMediaUri(context, resolvedPackageName, resolvedOpenUri)) {
            return true;
        }

        String targetPackage = resolveOpenableMediaPackage(context, resolvedPackageName);
        if (TextUtils.isEmpty(targetPackage)) {
            return false;
        }

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(targetPackage);
        if (launchIntent == null) {
            return false;
        }

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            context.startActivity(launchIntent);
            rememberMediaPackage(context, targetPackage);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean openExplicitMediaUri(Context context, String preferredPackageName, String preferredUri) {
        if (TextUtils.isEmpty(preferredUri)) {
            return false;
        }

        return openPreferredMediaUri(context, preferredPackageName, preferredUri);
    }

    static void pushSnapshotToConnectedNodes(Context context) {
        try {
            List<Node> nodes = Tasks.await(
                    Wearable.getNodeClient(context).getConnectedNodes(),
                    2,
                    TimeUnit.SECONDS
            );
            if (nodes == null || nodes.isEmpty()) {
                return;
            }

            byte[] payload = readSnapshot(context).toBytes();
            for (Node node : nodes) {
                if (node == null || TextUtils.isEmpty(node.getId())) {
                    continue;
                }
                Wearable.getMessageClient(context).sendMessage(node.getId(), STATE_PATH, payload);
            }
        } catch (Exception ignored) {
            // Best-effort push only.
        }
    }

    static boolean hasNotificationListenerAccess(Context context) {
        ComponentName listenerComponent = new ComponentName(context, PhoneNowPlayingNotificationListenerService.class);
        NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            try {
                return notificationManager.isNotificationListenerAccessGranted(listenerComponent);
            } catch (Exception ignored) {
                // Fall through to the package-level compatibility check.
            }
        }

        return NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
    }

    static Intent[] buildNotificationAccessIntents(Context context) {
        ComponentName listenerComponent = new ComponentName(context, PhoneNowPlayingNotificationListenerService.class);
        Intent detailIntent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listenerComponent.flattenToString());
        Intent listenerIntent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        Intent appNotificationIntent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        Intent appDetailsIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.getPackageName(), null));
        Intent settingsIntent = new Intent(Settings.ACTION_SETTINGS);
        return new Intent[]{detailIntent, listenerIntent, appNotificationIntent, appDetailsIntent, settingsIntent};
    }

    private static MediaController getBestActiveController(Context context) {
        if (!hasNotificationListenerAccess(context)) {
            return null;
        }

        MediaSessionManager mediaSessionManager = context.getSystemService(MediaSessionManager.class);
        if (mediaSessionManager == null) {
            return null;
        }

        List<MediaController> controllers;
        try {
            controllers = mediaSessionManager.getActiveSessions(
                    new ComponentName(context, PhoneNowPlayingNotificationListenerService.class)
            );
        } catch (SecurityException exception) {
            return null;
        }

        return selectBestMediaController(controllers);
    }

    private static void togglePlayback(MediaController controller, MediaController.TransportControls controls) {
        PlaybackState playbackState = controller.getPlaybackState();
        int state = playbackState != null ? playbackState.getState() : PlaybackState.STATE_NONE;
        switch (state) {
            case PlaybackState.STATE_PLAYING:
            case PlaybackState.STATE_BUFFERING:
            case PlaybackState.STATE_CONNECTING:
            case PlaybackState.STATE_FAST_FORWARDING:
            case PlaybackState.STATE_REWINDING:
            case PlaybackState.STATE_SKIPPING_TO_NEXT:
            case PlaybackState.STATE_SKIPPING_TO_PREVIOUS:
            case PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM:
                controls.pause();
                break;
            default:
                controls.play();
                break;
        }
    }

    private static MediaController selectBestMediaController(List<MediaController> controllers) {
        if (controllers == null || controllers.isEmpty()) {
            return null;
        }

        MediaController bestController = null;
        int bestScore = Integer.MIN_VALUE;
        for (MediaController controller : controllers) {
            if (controller == null) {
                continue;
            }

            int score = scoreMediaController(controller);
            if (score > bestScore) {
                bestController = controller;
                bestScore = score;
            }
        }

        return bestController;
    }

    private static int scoreMediaController(MediaController controller) {
        int score = 0;
        PlaybackState playbackState = controller.getPlaybackState();
        if (playbackState != null) {
            switch (playbackState.getState()) {
                case PlaybackState.STATE_PLAYING:
                    score += 400;
                    break;
                case PlaybackState.STATE_BUFFERING:
                    score += 320;
                    break;
                case PlaybackState.STATE_CONNECTING:
                    score += 240;
                    break;
                case PlaybackState.STATE_PAUSED:
                    score += 180;
                    break;
                case PlaybackState.STATE_FAST_FORWARDING:
                case PlaybackState.STATE_REWINDING:
                case PlaybackState.STATE_SKIPPING_TO_NEXT:
                case PlaybackState.STATE_SKIPPING_TO_PREVIOUS:
                case PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM:
                    score += 140;
                    break;
                default:
                    score += 40;
                    break;
            }
        }

        if (!TextUtils.isEmpty(extractNowPlayingTitle(controller.getMetadata()))) {
            score += 100;
        }

        if (!TextUtils.isEmpty(controller.getPackageName())) {
            score += 25;
        }

        return score;
    }

    private static String extractNowPlayingTitle(MediaMetadata metadata) {
        if (metadata == null) {
            return "";
        }

        String[] keys = new String[]{
                MediaMetadata.METADATA_KEY_DISPLAY_TITLE,
                MediaMetadata.METADATA_KEY_TITLE,
                MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
                MediaMetadata.METADATA_KEY_ARTIST,
                MediaMetadata.METADATA_KEY_ALBUM
        };

        for (String key : keys) {
            CharSequence value = metadata.getText(key);
            if (!TextUtils.isEmpty(value)) {
                return value.toString().trim();
            }
        }

        return "";
    }

    private static String extractNowPlayingCreator(MediaMetadata metadata, String title) {
        if (metadata == null) {
            return "";
        }

        String[] keys = new String[]{
                MediaMetadata.METADATA_KEY_ARTIST,
                MediaMetadata.METADATA_KEY_ALBUM_ARTIST,
                MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
                MediaMetadata.METADATA_KEY_DISPLAY_DESCRIPTION,
                MediaMetadata.METADATA_KEY_AUTHOR,
                MediaMetadata.METADATA_KEY_WRITER,
                MediaMetadata.METADATA_KEY_COMPOSER,
                MediaMetadata.METADATA_KEY_ALBUM
        };

        for (String key : keys) {
            CharSequence value = metadata.getText(key);
            if (TextUtils.isEmpty(value)) {
                continue;
            }

            String normalized = value.toString().trim();
            if (!TextUtils.isEmpty(normalized) && !TextUtils.equals(normalized, title)) {
                return normalized;
            }
        }

        return "";
    }

    private static String extractNowPlayingArtworkUri(MediaMetadata metadata, String openUri) {
        if (metadata != null) {
            String[] keys = new String[]{
                    MediaMetadata.METADATA_KEY_ART_URI,
                    MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
                    MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI
            };

            for (String key : keys) {
                String value = metadata.getString(key);
                if (!TextUtils.isEmpty(value)) {
                    return value;
                }
            }
        }

        if (!TextUtils.isEmpty(openUri)) {
            String videoId = extractYoutubeVideoId(openUri);
            if (!TextUtils.isEmpty(videoId)) {
                return "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg";
            }
        }

        return "";
    }

    private static String resolveMediaAppLabel(Context context, String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return "";
        }

        try {
            CharSequence label = context.getPackageManager().getApplicationLabel(
                    context.getPackageManager().getApplicationInfo(packageName, 0)
            );
            if (!TextUtils.isEmpty(label)) {
                return label.toString().trim();
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // Fall through to the raw package suffix when the app label is unavailable.
        }

        int lastDot = packageName.lastIndexOf('.');
        if (lastDot >= 0 && lastDot + 1 < packageName.length()) {
            return packageName.substring(lastDot + 1);
        }
        return packageName;
    }

    private static boolean openPreferredMediaUri(Context context, String preferredPackageName, String preferredUri) {
        String resolvedUri = !TextUtils.isEmpty(preferredUri) ? preferredUri : getRememberedMediaUri(context);
        if (TextUtils.isEmpty(resolvedUri)) {
            return false;
        }

        try {
            Intent packageIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(resolvedUri))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            if (!TextUtils.isEmpty(preferredPackageName)) {
                packageIntent.setPackage(preferredPackageName);
            }
            if (packageIntent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(packageIntent);
                rememberMediaUri(context, resolvedUri);
                if (!TextUtils.isEmpty(preferredPackageName)) {
                    rememberMediaPackage(context, preferredPackageName);
                }
                return true;
            }
        } catch (Exception ignored) {
            // Fall back to a generic ACTION_VIEW below.
        }

        try {
            Intent genericIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(resolvedUri))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            if (genericIntent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(genericIntent);
                rememberMediaUri(context, resolvedUri);
                return true;
            }
        } catch (Exception ignored) {
            return false;
        }

        return false;
    }

    private static String resolvePlayableOpenUri(MediaMetadata metadata, String packageName) {
        if (metadata == null) {
            return "";
        }

        String[] candidates = new String[]{
                metadata.getDescription() != null && metadata.getDescription().getMediaUri() != null
                        ? metadata.getDescription().getMediaUri().toString()
                        : "",
                metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_URI),
                metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)
        };

        for (String candidate : candidates) {
            String normalized = normalizePlayableOpenUri(candidate, packageName);
            if (!TextUtils.isEmpty(normalized)) {
                return normalized;
            }
        }

        return "";
    }

    private static String normalizePlayableOpenUri(String rawValue, String packageName) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        String normalizedPackage = TextUtils.isEmpty(packageName) ? "" : packageName.toLowerCase();
        if (normalizedPackage.contains("spotify")) {
            String spotifyUri = normalizeSpotifyOpenUri(value);
            if (!TextUtils.isEmpty(spotifyUri)) {
                return spotifyUri;
            }
        }

        if (normalizedPackage.contains("youtube")) {
            String youtubeUri = normalizeYoutubeOpenUri(value);
            if (!TextUtils.isEmpty(youtubeUri)) {
                return youtubeUri;
            }
        }

        try {
            Uri uri = Uri.parse(value);
            if (!TextUtils.isEmpty(uri.getScheme())) {
                return value;
            }
        } catch (Exception ignored) {
            // Try package-specific fallback normalization below.
        }

        return "";
    }

    private static String normalizeSpotifyOpenUri(String rawValue) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        if (value.startsWith("spotify:")) {
            return value;
        }

        String[] playableTypes = new String[]{"track", "album", "playlist", "artist", "episode", "show"};
        for (String playableType : playableTypes) {
            if (value.startsWith(playableType + ":")) {
                return "spotify:" + value;
            }
        }

        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            if ("spotify".equalsIgnoreCase(scheme)) {
                return value;
            }

            if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && uri.getHost() != null
                    && uri.getHost().toLowerCase().contains("spotify.com")) {
                List<String> segments = uri.getPathSegments();
                if (segments != null && segments.size() >= 2) {
                    String type = segments.get(0);
                    String id = segments.get(1);
                    for (String playableType : playableTypes) {
                        if (playableType.equals(type) && !TextUtils.isEmpty(id)) {
                            return "spotify:" + type + ":" + id;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            return "";
        }

        return "";
    }

    private static String normalizeYoutubeOpenUri(String rawValue) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        if (value.startsWith("vnd.youtube:")) {
            return value;
        }

        String videoId = extractYoutubeVideoId(value);
        if (!TextUtils.isEmpty(videoId)) {
            return "vnd.youtube:" + videoId;
        }

        return "";
    }

    private static String extractYoutubeVideoId(String rawValue) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (value.matches("^[A-Za-z0-9_-]{11}$")) {
            return value;
        }

        if (value.startsWith("vnd.youtube:")) {
            return trimYoutubeVideoId(value.substring("vnd.youtube:".length()));
        }

        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            if (TextUtils.isEmpty(host)) {
                return "";
            }

            host = host.toLowerCase();
            if (host.contains("youtu.be")) {
                String path = uri.getPath();
                if (!TextUtils.isEmpty(path)) {
                    return trimYoutubeVideoId(path.replace("/", ""));
                }
            }

            String queryVideoId = uri.getQueryParameter("v");
            if (!TextUtils.isEmpty(queryVideoId)) {
                return trimYoutubeVideoId(queryVideoId);
            }

            List<String> segments = uri.getPathSegments();
            if (segments == null || segments.isEmpty()) {
                return "";
            }

            for (int index = 0; index < segments.size(); index++) {
                String segment = segments.get(index);
                if ("embed".equals(segment) || "shorts".equals(segment) || "live".equals(segment)) {
                    if (index + 1 < segments.size()) {
                        return trimYoutubeVideoId(segments.get(index + 1));
                    }
                }
            }
        } catch (Exception ignored) {
            return "";
        }

        return "";
    }

    private static String trimYoutubeVideoId(String value) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        String trimmed = value.trim();
        if (trimmed.length() > 11) {
            trimmed = trimmed.substring(0, 11);
        }
        return trimmed;
    }

    private static String resolveOpenableMediaPackage(Context context, String preferredPackageName) {
        if (isLaunchablePackage(context, preferredPackageName)) {
            return preferredPackageName;
        }

        MediaController controller = getBestActiveController(context);
        if (controller != null) {
            String currentPackageName = controller.getPackageName();
            if (isLaunchablePackage(context, currentPackageName)) {
                rememberMediaPackage(context, currentPackageName);
                return currentPackageName;
            }
        }

        String rememberedPackageName = getRememberedMediaPackage(context);
        if (isLaunchablePackage(context, rememberedPackageName)) {
            return rememberedPackageName;
        }

        return "";
    }

    private static boolean launchSpotifyApp(Context context) {
        try {
            Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(SPOTIFY_PACKAGE_NAME);
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                context.startActivity(launchIntent);
                rememberMediaPackage(context, SPOTIFY_PACKAGE_NAME);
                return true;
            }
        } catch (Exception ignored) {
            // Fall through to the URI-based launch path.
        }

        try {
            Intent spotifyIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:"))
                    .setPackage(SPOTIFY_PACKAGE_NAME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            if (spotifyIntent.resolveActivity(context.getPackageManager()) != null) {
                context.startActivity(spotifyIntent);
                rememberMediaPackage(context, SPOTIFY_PACKAGE_NAME);
                rememberMediaUri(context, "spotify:");
                return true;
            }
        } catch (Exception ignored) {
            return false;
        }

        return false;
    }

    private static boolean isLaunchablePackage(Context context, String packageName) {
        return !TextUtils.isEmpty(packageName)
                && context.getPackageManager().getLaunchIntentForPackage(packageName) != null;
    }

    private static void rememberMediaPackage(Context context, String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return;
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_MEDIA_PACKAGE, packageName)
                .apply();
    }

    private static String getRememberedMediaPackage(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_LAST_MEDIA_PACKAGE, "");
    }

    private static void rememberMediaUri(Context context, String openUri) {
        if (TextUtils.isEmpty(openUri)) {
            return;
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_MEDIA_URI, openUri)
                .apply();
    }

    private static String getRememberedMediaUri(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_LAST_MEDIA_URI, "");
    }

    private static String resolvePlaybackStateLabel(PlaybackState playbackState) {
        if (playbackState == null) {
            return "Active";
        }

        switch (playbackState.getState()) {
            case PlaybackState.STATE_PLAYING:
                return "Playing";
            case PlaybackState.STATE_PAUSED:
                return "Paused";
            case PlaybackState.STATE_BUFFERING:
            case PlaybackState.STATE_CONNECTING:
                return "Buffering";
            default:
                return "Active";
        }
    }

    private static String buildMediaMeta(String appLabel, String creatorLabel, String stateLabel) {
        if (!TextUtils.isEmpty(creatorLabel)) {
            if (TextUtils.isEmpty(appLabel)) {
                return creatorLabel;
            }
            return appLabel + " - " + creatorLabel;
        }

        if (TextUtils.isEmpty(appLabel)) {
            return stateLabel;
        }
        if (TextUtils.isEmpty(stateLabel)) {
            return appLabel;
        }
        return appLabel + " - " + stateLabel;
    }

    static final class Snapshot {
        final String title;
        final String meta;
        final String appPackage;
        final String openUri;
        final String artworkUri;
        final boolean active;
        final boolean permissionRequired;

        private Snapshot(String title, String meta, String appPackage, String openUri, String artworkUri, boolean active, boolean permissionRequired) {
            this.title = title;
            this.meta = meta;
            this.appPackage = appPackage;
            this.openUri = openUri;
            this.artworkUri = artworkUri;
            this.active = active;
            this.permissionRequired = permissionRequired;
        }

        static Snapshot active(String title, String meta, String appPackage, String openUri, String artworkUri) {
            return new Snapshot(title, meta, appPackage, openUri, artworkUri, true, false);
        }

        static Snapshot idle(String appPackage, String openUri) {
            return new Snapshot("", "", appPackage, openUri, "", false, false);
        }

        static Snapshot permissionRequired() {
            return new Snapshot("", "", "", "", "", false, true);
        }

        byte[] toBytes() {
            try {
                JSONObject json = new JSONObject();
                json.put("title", title);
                json.put("meta", meta);
                json.put("appPackage", appPackage);
                json.put("openUri", openUri);
                json.put("artworkUri", artworkUri);
                json.put("active", active);
                json.put("permissionRequired", permissionRequired);
                return json.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            } catch (JSONException exception) {
                return "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            }
        }
    }
}
