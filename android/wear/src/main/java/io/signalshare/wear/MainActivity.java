package io.signalshare.wear;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationManagerCompat;
import androidx.wear.widget.ConfirmationOverlay;
import androidx.wear.remote.interactions.RemoteActivityHelper;
import androidx.wear.widget.SwipeDismissFrameLayout;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.google.android.gms.wearable.MessageClient;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Wearable;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;
    private static final String PREFS_NAME = "signal_share_wear";
    private static final String PREF_ACCESS_TOKEN = "access_token";
    private static final String PREF_REFRESH_TOKEN = "refresh_token";
    private static final String PREF_ACCESS_TOKEN_EXPIRES_AT = "access_token_expires_at";
    private static final String PREF_USER_ID = "user_id";
    private static final String PREF_USER_EMAIL = "user_email";
    private static final String PREF_THEME = "theme";
    private static final String PREF_THREAD_READ_AT_PREFIX = "thread_read_at_";
    private static final String WORK_NAME = "supabase_message_polling";
    private static final String PHONE_NOW_PLAYING_REQUEST_PATH = "/signalshare/now-playing/request";
    private static final String PHONE_NOW_PLAYING_STATE_PATH = "/signalshare/now-playing/state";
    private static final String PHONE_NOW_PLAYING_ACTION_PATH = "/signalshare/now-playing/action";
    private static final String PHONE_MEDIA_ACCESS_DEEP_LINK = "signalshare://media-access";
    private static final String PHONE_MEDIA_OPEN_DEEP_LINK = "signalshare://open-media";
    private static final String PHONE_MEDIA_ACTION_PLAY_PAUSE = "play_pause";
    private static final String PHONE_MEDIA_ACTION_NEXT = "next";
    private static final String PHONE_MEDIA_ACTION_PREVIOUS = "previous";
    private static final long MESSAGES_REFRESH_INTERVAL_MS = 5000L;
    private static final long SESSION_REFRESH_SKEW_MS = 60000L;
    private static final long MEDIA_ACTION_REFRESH_DELAY_MS = 250L;
    private static final long MEDIA_ACTION_REFRESH_FOLLOW_UP_DELAY_MS = 1000L;
    private static final long MEDIA_ACTION_REFRESH_FINAL_DELAY_MS = 2200L;
    private static final long POSTED_MEDIA_RECENT_OPEN_WINDOW_MS = 30000L;
    private static final long PHONE_NOW_PLAYING_TIMEOUT_MS = 5000L;
    private static final float ROTARY_SCROLL_SENSITIVITY = 0.35f;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SharedPreferences sharedPreferences;
    private RemoteActivityHelper remoteActivityHelper;

    private SwipeDismissFrameLayout wearRoot;
    private View brandBadge;
    private ScrollView homeScroll;
    private ScrollView pageScroll;
    private View feedCard;
    private View messagesCard;
    private View mediaCard;
    private View settingsCard;
    private View feedOpenPanel;
    private LinearLayout feedPagePanel;
    private LinearLayout messagesPanel;
    private LinearLayout mediaPanel;
    private LinearLayout settingsPanel;
    private LinearLayout messagesAuthGroup;
    private LinearLayout messagesThreadList;
    private TextView pageTitle;
    private TextView pageBody;
    private TextView brandGlyph;
    private TextView homeTitle;
    private TextView homeBadge;
    private TextView homeTagline;
    private TextView feedCardTitle;
    private TextView feedSummary;
    private TextView feedMeta;
    private TextView feedOpenTitle;
    private TextView feedOpenSummary;
    private TextView feedOpenMeta;
    private TextView feedPostLabel;
    private TextView feedPageSummary;
    private TextView feedPageMeta;
    private TextView messagesCardTitle;
    private TextView messagesSummary;
    private TextView messagesMeta;
    private TextView mediaCardTitle;
    private TextView mediaSummary;
    private TextView mediaMeta;
    private TextView settingsTitle;
    private TextView settingsMeta;
    private TextView messagesPanelMeta;
    private TextView messagesConversationPreview;
    private TextView messagesPanelTitle;
    private TextView mediaPanelTitle;
    private TextView mediaPanelMeta;
    private ImageView feedPreviewImage;
    private ImageView feedPageImage;
    private ImageView feedOpenImage;
    private EditText watchEmailInput;
    private EditText watchPasswordInput;
    private EditText watchMessageInput;
    private Button backHomeButton;
    private Button backToThreadsButton;
    private Button watchSignOutButton;
    private Button themeMidnightButton;
    private Button themeTideButton;
    private Button themeEmberButton;
    private Button themeGlacierButton;
    private Button themeGroveButton;
    private Button themeSolarButton;
    private Button notificationSettingsButton;
    private Button toggleWatchNotificationsButton;
    private Button watchSignInButton;
    private Button watchSendMessageButton;
    private Button openPhoneButton;
    private Button openSpotifyButton;
    private Button refreshButton;

    private SessionState sessionState;
    private FeedPost latestPost;
    private FeedPost latestUserPost;
    private FeedPost spotlightPost;
    private final Map<String, ProfileRecord> profilesById = new HashMap<>();
    private final Map<String, Integer> unreadCountsByThread = new HashMap<>();
    private final List<ThreadRecord> threadRecords = new ArrayList<>();
    private final List<MessageRecord> activeMessages = new ArrayList<>();
    private String activeThreadId;
    private String lastInboxTopThreadSignature = "";
    private Section activeSection = Section.FEED;
    private ThemeOption currentTheme = ThemeOption.MIDNIGHT;
    private boolean messagesRefreshInFlight;
    private boolean phoneNowPlayingAvailable;
    private boolean awaitingPhoneNowPlayingResponse;
    private float rotaryScrollCarry;
    private String lastPostedMediaOpenUri = "";
    private long lastPostedMediaOpenAtMs;
    private NowPlayingSnapshot lastNowPlayingSnapshot = NowPlayingSnapshot.idle(false, "", "");
    private final Runnable mediaActionRefreshRunnable = this::refreshNowPlayingState;
    private final Runnable phoneNowPlayingTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (!awaitingPhoneNowPlayingResponse) {
                return;
            }

            awaitingPhoneNowPlayingResponse = false;
            NowPlayingSnapshot unavailableSnapshot = NowPlayingSnapshot.phoneUnavailable();
            lastNowPlayingSnapshot = unavailableSnapshot;
            renderNowPlayingState(unavailableSnapshot);
        }
    };
    private final MessageClient.OnMessageReceivedListener nowPlayingMessageListener = new MessageClient.OnMessageReceivedListener() {
        @Override
        public void onMessageReceived(@NonNull MessageEvent messageEvent) {
            if (!PHONE_NOW_PLAYING_STATE_PATH.equals(messageEvent.getPath())) {
                return;
            }

            NowPlayingSnapshot snapshot = parsePhoneNowPlayingSnapshot(messageEvent.getData());
            mainHandler.post(() -> {
                awaitingPhoneNowPlayingResponse = false;
                mainHandler.removeCallbacks(phoneNowPlayingTimeoutRunnable);
                phoneNowPlayingAvailable = true;
                lastNowPlayingSnapshot = snapshot;
                renderNowPlayingState(snapshot);
            });
        }
    };

    private final Runnable messagesRefreshRunnable = new Runnable() {
        @Override
        public void run() {
            if (!shouldAutoRefreshMessages()) {
                return;
            }

            refreshMessagesLive();
            mainHandler.postDelayed(this, MESSAGES_REFRESH_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        sharedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        remoteActivityHelper = new RemoteActivityHelper(this, executor);
        bindViews();
        applyTheme(loadTheme(), false);
        restoreSession();
        WatchPushManager.ensureInitialized(this);
        bindInteractions();
        bindSwipeBackNavigation();
        requestNotificationPermissionIfNeeded();
        renderSignedOutState();
        updateMediaCardState(getString(R.string.media_card_ready), getString(R.string.media_meta_default));
        showHome();
        refreshNowPlayingState();

        if (sessionState != null) {
            loadMessageThreads(false, true);
            startMessagesAutoRefresh();
        }

        handleIntent(getIntent());

        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (!handleBackNavigation()) {
                    finish();
                }
            }
        });
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (handleRotaryScroll(event)) {
            return true;
        }

        return super.dispatchGenericMotionEvent(event);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String threadId = intent.getStringExtra("threadId");
        if (!TextUtils.isEmpty(threadId) && sessionState != null) {
            activateSection(Section.MESSAGES);
            activeThreadId = threadId;
            renderConversation();
            loadMessagesForThread(threadId, false);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }

        requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST_CODE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        WatchPushManager.setAppVisible(this, true);
        stopBackgroundPolling();
        Wearable.getMessageClient(this).addListener(nowPlayingMessageListener);
        if (homeScroll.getVisibility() == View.VISIBLE) {
            loadLatestFeed();
        }
        refreshNowPlayingState();
    }

    @Override
    protected void onPause() {
        WatchPushManager.setAppVisible(this, false);
        Wearable.getMessageClient(this).removeListener(nowPlayingMessageListener);
        awaitingPhoneNowPlayingResponse = false;
        mainHandler.removeCallbacks(mediaActionRefreshRunnable);
        mainHandler.removeCallbacks(phoneNowPlayingTimeoutRunnable);
        super.onPause();
        stopBackgroundPolling();
    }

    private void startBackgroundPolling() {
        stopBackgroundPolling();
    }

    private void stopBackgroundPolling() {
        WorkManager.getInstance(this).cancelUniqueWork(WORK_NAME);
    }

    @Override
    protected void onDestroy() {
        stopMessagesAutoRefresh();
        executor.shutdownNow();
        super.onDestroy();
    }

    private void bindViews() {
        wearRoot = findViewById(R.id.wearRoot);
        brandBadge = findViewById(R.id.brandBadge);
        homeScroll = findViewById(R.id.homeScroll);
        pageScroll = findViewById(R.id.pageScroll);
        feedCard = findViewById(R.id.feedCard);
        messagesCard = findViewById(R.id.messagesCard);
        mediaCard = findViewById(R.id.mediaCard);
        settingsCard = findViewById(R.id.settingsCard);
        feedOpenPanel = findViewById(R.id.feedOpenPanel);
        feedPagePanel = findViewById(R.id.feedPagePanel);
        messagesPanel = findViewById(R.id.messagesPanel);
        mediaPanel = findViewById(R.id.mediaPanel);
        settingsPanel = findViewById(R.id.settingsPanel);
        messagesAuthGroup = findViewById(R.id.messagesAuthGroup);
        messagesThreadList = findViewById(R.id.messagesThreadList);
        pageTitle = findViewById(R.id.pageTitle);
        pageBody = findViewById(R.id.pageBody);
        brandGlyph = findViewById(R.id.brandGlyph);
        homeTitle = findViewById(R.id.homeTitle);
        homeBadge = findViewById(R.id.homeBadge);
        homeTagline = findViewById(R.id.homeTagline);
        feedCardTitle = findViewById(R.id.feedCardTitle);
        feedSummary = findViewById(R.id.feedSummary);
        feedMeta = findViewById(R.id.feedMeta);
        feedOpenTitle = findViewById(R.id.feedOpenTitle);
        feedOpenSummary = findViewById(R.id.feedOpenSummary);
        feedOpenMeta = findViewById(R.id.feedOpenMeta);
        feedPostLabel = findViewById(R.id.feedPostLabel);
        feedPageSummary = findViewById(R.id.feedPageSummary);
        feedPageMeta = findViewById(R.id.feedPageMeta);
        messagesCardTitle = findViewById(R.id.messagesCardTitle);
        messagesSummary = findViewById(R.id.messagesSummary);
        messagesMeta = findViewById(R.id.messagesMeta);
        mediaCardTitle = findViewById(R.id.mediaCardTitle);
        mediaSummary = findViewById(R.id.mediaSummary);
        mediaMeta = findViewById(R.id.mediaMeta);
        settingsTitle = findViewById(R.id.settingsTitle);
        settingsMeta = findViewById(R.id.settingsMeta);
        messagesPanelTitle = findViewById(R.id.messagesPanelTitle);
        messagesPanelMeta = findViewById(R.id.messagesPanelMeta);
        messagesConversationPreview = findViewById(R.id.messagesConversationPreview);
        mediaPanelTitle = findViewById(R.id.mediaPanelTitle);
        mediaPanelMeta = findViewById(R.id.mediaPanelMeta);
        feedPreviewImage = findViewById(R.id.feedPreviewImage);
        feedPageImage = findViewById(R.id.feedPageImage);
        feedOpenImage = findViewById(R.id.feedOpenImage);
        watchEmailInput = findViewById(R.id.watchEmailInput);
        watchPasswordInput = findViewById(R.id.watchPasswordInput);
        watchMessageInput = findViewById(R.id.watchMessageInput);
        backHomeButton = findViewById(R.id.backHomeButton);
        backToThreadsButton = findViewById(R.id.backToThreadsButton);
        watchSignOutButton = findViewById(R.id.watchSignOutButton);
        themeMidnightButton = findViewById(R.id.themeMidnightButton);
        themeTideButton = findViewById(R.id.themeTideButton);
        themeEmberButton = findViewById(R.id.themeEmberButton);
        themeGlacierButton = findViewById(R.id.themeGlacierButton);
        themeGroveButton = findViewById(R.id.themeGroveButton);
        themeSolarButton = findViewById(R.id.themeSolarButton);
        notificationSettingsButton = findViewById(R.id.notificationSettingsButton);
        toggleWatchNotificationsButton = findViewById(R.id.toggleWatchNotificationsButton);
        watchSignInButton = findViewById(R.id.watchSignInButton);
        watchSendMessageButton = findViewById(R.id.watchSendMessageButton);
        openPhoneButton = findViewById(R.id.openPhoneButton);
        openSpotifyButton = findViewById(R.id.openSpotifyButton);
        refreshButton = findViewById(R.id.refreshButton);
    }

    private void bindInteractions() {
        feedCard.setOnClickListener(view -> activateSection(Section.FEED));
        feedOpenPanel.setOnClickListener(view -> openLatestUserPostOnPhone());
        feedPagePanel.setOnClickListener(view -> openLatestPostOnPhone());
        messagesCard.setOnClickListener(view -> activateSection(Section.MESSAGES));
        mediaCard.setOnClickListener(view -> activateSection(Section.MEDIA));
        settingsCard.setOnClickListener(view -> activateSection(Section.SETTINGS));
        backHomeButton.setOnClickListener(view -> showHome());
        backToThreadsButton.setOnClickListener(view -> navigateBackToInbox());

        themeMidnightButton.setOnClickListener(view -> applyTheme(ThemeOption.MIDNIGHT, true));
        themeTideButton.setOnClickListener(view -> applyTheme(ThemeOption.TIDE, true));
        themeEmberButton.setOnClickListener(view -> applyTheme(ThemeOption.EMBER, true));
        themeGlacierButton.setOnClickListener(view -> applyTheme(ThemeOption.GLACIER, true));
        themeGroveButton.setOnClickListener(view -> applyTheme(ThemeOption.GROVE, true));
        themeSolarButton.setOnClickListener(view -> applyTheme(ThemeOption.SOLAR, true));
        notificationSettingsButton.setOnClickListener(view -> openNotificationAlertSettings());
        toggleWatchNotificationsButton.setOnClickListener(view -> toggleWatchNotifications());

        watchSignInButton.setOnClickListener(view -> {
            if (sessionState != null) {
                clearSession();
                renderSignedOutState();
                showToast(getString(R.string.messages_signed_out));
            } else {
                signInWatch();
            }
        });

        watchSignOutButton.setOnClickListener(view -> {
            clearSession();
            renderSignedOutState();
            showToast(getString(R.string.messages_signed_out));
        });

        watchSendMessageButton.setOnClickListener(view -> sendWatchMessage());
        findViewById(R.id.homeMediaPreviousButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_PREVIOUS));
        findViewById(R.id.homeMediaPlayPauseButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        findViewById(R.id.homeMediaNextButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_NEXT));
        findViewById(R.id.mediaPreviousButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_PREVIOUS));
        findViewById(R.id.mediaPlayPauseButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        findViewById(R.id.mediaNextButton).setOnClickListener(view -> sendMediaAction(KeyEvent.KEYCODE_MEDIA_NEXT));
        openPhoneButton.setOnClickListener(view -> openForCurrentSection());
        openSpotifyButton.setOnClickListener(view -> openSpotifyOnWatch());
        refreshButton.setOnClickListener(view -> refreshCurrentSection());
    }

    private void showHome() {
        stopMessagesAutoRefresh();
        homeScroll.setVisibility(View.VISIBLE);
        pageScroll.setVisibility(View.GONE);
        feedCard.setAlpha(1f);
        messagesCard.setAlpha(1f);
        mediaCard.setAlpha(1f);
        settingsCard.setAlpha(1f);
        homeScroll.post(() -> homeScroll.smoothScrollTo(0, 0));

        // Refresh messages once to update the home card summary
        if (sessionState != null) {
            loadMessageThreads(false, true);
        }

        loadLatestFeed();
        refreshNowPlayingState();
    }

    private void activateSection(Section section) {
        activeSection = section;
        if (section != Section.MESSAGES) {
            stopMessagesAutoRefresh();
        } else {
            // Clear notifications when entering the messages section
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancelAll();
            }
        }
        homeScroll.setVisibility(View.GONE);
        pageScroll.setVisibility(View.VISIBLE);
        feedOpenPanel.setVisibility(section == Section.FEED ? View.VISIBLE : View.GONE);
        feedPagePanel.setVisibility(section == Section.FEED ? View.VISIBLE : View.GONE);
        messagesPanel.setVisibility(section == Section.MESSAGES ? View.VISIBLE : View.GONE);
        mediaPanel.setVisibility(section == Section.MEDIA ? View.VISIBLE : View.GONE);
        settingsPanel.setVisibility(section == Section.SETTINGS ? View.VISIBLE : View.GONE);
        openPhoneButton.setVisibility(section == Section.SETTINGS ? View.GONE : View.VISIBLE);
        openSpotifyButton.setVisibility(section == Section.MEDIA ? View.VISIBLE : View.GONE);
        refreshButton.setVisibility(section == Section.SETTINGS ? View.GONE : View.VISIBLE);
        pageBody.setVisibility(section == Section.SETTINGS ? View.GONE : View.VISIBLE);

        if (section == Section.FEED) {
            pageTitle.setText(R.string.feed_title);
            pageBody.setText(latestPost != null ? latestPost.captionOrFallback() : getString(R.string.feed_detail));
            openPhoneButton.setText(R.string.open_phone);
            refreshButton.setText(R.string.refresh);
            renderFeedSection();
        } else if (section == Section.MESSAGES) {
            pageTitle.setText(R.string.messages_title);
            pageBody.setText(R.string.messages_detail);
            openPhoneButton.setText(R.string.open_phone);
            refreshButton.setText(R.string.refresh);
            if (sessionState == null) {
                renderSignedOutState();
            } else {
                loadMessageThreads(true, false);
                startMessagesAutoRefresh();
            }
        } else if (section == Section.MEDIA) {
            pageTitle.setText(R.string.media_title);
            pageBody.setText(R.string.media_detail);
            openPhoneButton.setText(R.string.open_phone);
            refreshButton.setText(R.string.refresh);
            refreshNowPlayingState();
        } else {
            pageTitle.setText(R.string.settings_title);
            pageBody.setText("");
            updateWatchNotificationsButtonUI();
        }

        pageScroll.post(() -> pageScroll.smoothScrollTo(0, 0));
    }

    private ThemeOption loadTheme() {
        String stored = sharedPreferences.getString(PREF_THEME, ThemeOption.MIDNIGHT.name());
        try {
            return ThemeOption.valueOf(stored);
        } catch (IllegalArgumentException exception) {
            return ThemeOption.MIDNIGHT;
        }
    }

    private void applyTheme(ThemeOption theme, boolean persist) {
        currentTheme = theme;
        if (persist) {
            sharedPreferences.edit().putString(PREF_THEME, theme.name()).apply();
        }

        wearRoot.setBackground(createBackgroundDrawable(theme.backgroundStart, theme.backgroundEnd, 0f, GradientDrawable.RECTANGLE, 0));
        brandBadge.setBackground(createBadgeDrawable(theme));
        brandGlyph.setTextColor(Color.parseColor(theme.badgeTextColor));

        View[] cards = new View[]{feedCard, messagesCard, mediaCard, settingsCard, feedOpenPanel, feedPagePanel, messagesPanel, mediaPanel, settingsPanel};
        for (View card : cards) {
            if (card != null) {
                card.setBackground(createCardDrawable(theme.cardStart, theme.cardEnd, theme.cardStroke));
            }
        }

        feedPreviewImage.setBackground(createInputDrawable(theme.inputFill, theme.inputStroke, 16f));
        feedPageImage.setBackground(createInputDrawable(theme.inputFill, theme.inputStroke, 18f));
        feedOpenImage.setBackground(createInputDrawable(theme.inputFill, theme.inputStroke, 18f));

        Button[] secondaryButtons = new Button[]{
                backHomeButton,
                backToThreadsButton,
                watchSignOutButton,
                notificationSettingsButton,
                openSpotifyButton,
                refreshButton,
                findViewById(R.id.homeMediaPreviousButton),
                findViewById(R.id.homeMediaNextButton),
                findViewById(R.id.mediaPreviousButton),
                findViewById(R.id.mediaNextButton)
        };
        for (Button button : secondaryButtons) {
            if (button != null) {
                styleButton(button, false, theme);
            }
        }

        Button[] primaryButtons = new Button[]{
                watchSignInButton,
                watchSendMessageButton,
                openPhoneButton,
                findViewById(R.id.homeMediaPlayPauseButton),
                findViewById(R.id.mediaPlayPauseButton)
        };
        for (Button button : primaryButtons) {
            if (button != null) {
                styleButton(button, true, theme);
            }
        }

        styleButton(themeMidnightButton, theme == ThemeOption.MIDNIGHT, theme);
        styleButton(themeTideButton, theme == ThemeOption.TIDE, theme);
        styleButton(themeEmberButton, theme == ThemeOption.EMBER, theme);
        styleButton(themeGlacierButton, theme == ThemeOption.GLACIER, theme);
        styleButton(themeGroveButton, theme == ThemeOption.GROVE, theme);
        styleButton(themeSolarButton, theme == ThemeOption.SOLAR, theme);

        EditText[] inputs = new EditText[]{watchEmailInput, watchPasswordInput, watchMessageInput};
        for (EditText input : inputs) {
            if (input != null) {
                input.setBackground(createInputDrawable(theme.inputFill, theme.inputStroke, 14f));
                input.setTextColor(Color.parseColor(theme.textPrimary));
                input.setHintTextColor(Color.parseColor(theme.hintColor));
            }
        }

        int textPrimary = Color.parseColor(theme.textPrimary);
        int textSecondary = Color.parseColor(theme.textSecondary);
        int accentColor = Color.parseColor(theme.accentColor);
        homeTitle.setTextColor(textPrimary);
        homeTagline.setTextColor(textSecondary);
        pageTitle.setTextColor(textPrimary);
        pageBody.setTextColor(textSecondary);
        feedCardTitle.setTextColor(textPrimary);
        feedSummary.setTextColor(textSecondary);
        feedMeta.setTextColor(accentColor);
        feedOpenTitle.setTextColor(textPrimary);
        feedOpenSummary.setTextColor(textSecondary);
        feedOpenMeta.setTextColor(accentColor);
        feedPostLabel.setTextColor(textPrimary);
        feedPageSummary.setTextColor(textPrimary);
        feedPageMeta.setTextColor(accentColor);
        messagesMeta.setTextColor(accentColor);
        messagesCardTitle.setTextColor(textPrimary);
        messagesSummary.setTextColor(textSecondary);
        mediaCardTitle.setTextColor(textPrimary);
        mediaSummary.setTextColor(textSecondary);
        mediaMeta.setTextColor(accentColor);
        settingsTitle.setTextColor(textPrimary);
        settingsMeta.setTextColor(accentColor);
        messagesPanelTitle.setTextColor(textPrimary);
        messagesPanelMeta.setTextColor(textSecondary);
        messagesConversationPreview.setBackground(createInputDrawable(theme.inputFill, theme.inputStroke, 14f));
        messagesConversationPreview.setTextColor(textPrimary);
        mediaPanelTitle.setTextColor(textPrimary);
        mediaPanelMeta.setTextColor(textSecondary);
        homeBadge.setTextColor(accentColor);

        settingsMeta.setText("THEME: " + theme.label.toUpperCase(Locale.US));
    }

    private GradientDrawable createBackgroundDrawable(String startColor, String endColor, float cornerRadius, int shape, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.parseColor(startColor), Color.parseColor(endColor)}
        );
        drawable.setShape(shape);
        if (cornerRadius > 0f) {
            drawable.setCornerRadius(dp(cornerRadius));
        }
        if (strokeColor != 0) {
            drawable.setStroke(dp(1), strokeColor);
        }
        return drawable;
    }

    private GradientDrawable createCardDrawable(String startColor, String endColor, String strokeColor) {
        GradientDrawable drawable = createBackgroundDrawable(startColor, endColor, 20f, GradientDrawable.RECTANGLE, Color.parseColor(strokeColor));
        return drawable;
    }

    private GradientDrawable createBadgeDrawable(ThemeOption theme) {
        GradientDrawable drawable = createBackgroundDrawable(
                theme.badgeStart,
                theme.badgeEnd,
                38f,
                GradientDrawable.OVAL,
                Color.parseColor(theme.badgeStroke)
        );
        return drawable;
    }

    private GradientDrawable createInputDrawable(String fillColor, String strokeColor, float cornerRadius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(dp(cornerRadius));
        drawable.setColor(Color.parseColor(fillColor));
        drawable.setStroke(dp(1), Color.parseColor(strokeColor));
        return drawable;
    }

    private void styleButton(Button button, boolean primary, ThemeOption theme) {
        if (button == null) {
            return;
        }

        if (primary) {
            button.setBackground(createBackgroundDrawable(
                    theme.primaryStart,
                    theme.primaryEnd,
                    22f,
                    GradientDrawable.RECTANGLE,
                    0
            ));
        } else {
            button.setBackground(createInputDrawable(theme.secondaryFill, theme.secondaryStroke, 22f));
        }
        button.setTextColor(Color.parseColor(theme.buttonTextColor));
    }

    private void refreshCurrentSection() {
        if (activeSection == Section.FEED) {
            loadLatestFeed();
            return;
        }

        if (activeSection == Section.MESSAGES) {
            if (sessionState == null) {
                renderSignedOutState();
            } else {
                loadMessageThreads(false, false);
            }
            return;
        }

        if (activeSection == Section.MEDIA) {
            refreshNowPlayingState();
        }
    }

    private void startMessagesAutoRefresh() {
        if (!shouldAutoRefreshMessages()) {
            return;
        }

        mainHandler.removeCallbacks(messagesRefreshRunnable);
        mainHandler.postDelayed(messagesRefreshRunnable, MESSAGES_REFRESH_INTERVAL_MS);
    }

    private void stopMessagesAutoRefresh() {
        mainHandler.removeCallbacks(messagesRefreshRunnable);
        messagesRefreshInFlight = false;
    }

    private boolean shouldAutoRefreshMessages() {
        return sessionState != null
                && (activeSection == Section.MESSAGES || homeScroll.getVisibility() == View.VISIBLE);
    }

    private void refreshMessagesLive() {
        if (!shouldAutoRefreshMessages() || messagesRefreshInFlight) {
            return;
        }

        loadMessageThreads(false, true);
    }

    private void openForCurrentSection() {
        if (activeSection == Section.FEED) {
            openFeedOnPhone();
            return;
        }

        if (activeSection == Section.MEDIA) {
            if (lastNowPlayingSnapshot.permissionRequired) {
                if (lastNowPlayingSnapshot.remoteSource || phoneNowPlayingAvailable) {
                    openUrl(PHONE_MEDIA_ACCESS_DEEP_LINK, BuildConfig.SIGNAL_SHARE_URL);
                } else {
                    openNotificationAccessSettings();
                }
                return;
            }

            openCurrentMediaOnPhone(lastNowPlayingSnapshot.openUri, lastNowPlayingSnapshot.appPackage);
            return;
        }

        String url = BuildConfig.SIGNAL_SHARE_URL;
        if (activeSection == Section.MESSAGES) {
            String appUrl = "signalshare://messages";
            if (!TextUtils.isEmpty(activeThreadId)) {
                url += "#messages/" + activeThreadId;
                appUrl += "/" + activeThreadId;
            } else {
                url += "#messages";
            }
            openUrl(appUrl, url);
            return;
        } else {
            url += "#feed";
        }
        openUrl(url);
    }

    private void openFeedOnPhone() {
        openUrl("signalshare://feed", BuildConfig.SIGNAL_SHARE_URL + "#feed");
    }

    private void openUrl(String url) {
        openUrl(url, url);
    }

    private void openUrl(String appUrl, String fallbackUrl) {
        Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes -> {
            if (nodes.isEmpty()) {
                openUrlLocal(fallbackUrl);
                return;
            }

            Intent intent = new Intent(Intent.ACTION_VIEW)
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .setData(Uri.parse(appUrl))
                    .setPackage("io.signalshare.app");

            ListenableFuture<Void> result = remoteActivityHelper.startRemoteActivity(intent);
            Futures.addCallback(result, new FutureCallback<Void>() {
                @Override
                public void onSuccess(Void result) {
                    mainHandler.post(() -> showConfirmation(ConfirmationOverlay.OPEN_ON_PHONE_ANIMATION, getString(R.string.open_phone_success)));
                }

                @Override
                public void onFailure(@NonNull Throwable t) {
                    // If app-specific handoff fails, try generic browser handoff
                    Intent fallbackIntent = new Intent(Intent.ACTION_VIEW)
                            .addCategory(Intent.CATEGORY_BROWSABLE)
                            .setData(Uri.parse(fallbackUrl));

                    ListenableFuture<Void> fallbackResult = remoteActivityHelper.startRemoteActivity(fallbackIntent);
                    Futures.addCallback(fallbackResult, new FutureCallback<Void>() {
                        @Override
                        public void onSuccess(Void result) {
                            mainHandler.post(() -> showConfirmation(ConfirmationOverlay.OPEN_ON_PHONE_ANIMATION, getString(R.string.open_phone_success)));
                        }

                        @Override
                        public void onFailure(@NonNull Throwable fallbackT) {
                            mainHandler.post(() -> openUrlLocal(fallbackUrl));
                        }
                    }, executor);
                }
            }, executor);
        });
    }

    private void bindSwipeBackNavigation() {
        wearRoot.setSwipeable(true);
        wearRoot.addCallback(new SwipeDismissFrameLayout.Callback() {
            @Override
            public void onDismissed(SwipeDismissFrameLayout layout) {
                if (!handleBackNavigation()) {
                    finish();
                }
            }
        });
    }

    private void navigateBackToInbox() {
        activeThreadId = null;
        activeMessages.clear();
        renderThreadButtons();
        loadMessageThreads(false, true);
    }

    private boolean handleBackNavigation() {
        if (pageScroll.getVisibility() != View.VISIBLE) {
            return false;
        }

        if (activeSection == Section.MESSAGES && !TextUtils.isEmpty(activeThreadId)) {
            navigateBackToInbox();
            return true;
        }

        showHome();
        return true;
    }

    private boolean handleRotaryScroll(MotionEvent event) {
        if (event == null
                || event.getAction() != MotionEvent.ACTION_SCROLL
                || (event.getSource() & InputDevice.SOURCE_ROTARY_ENCODER) != InputDevice.SOURCE_ROTARY_ENCODER) {
            return false;
        }

        ScrollView targetScroll = getActiveScrollTarget();
        if (targetScroll == null || targetScroll.getChildCount() == 0) {
            return false;
        }

        float axisValue = event.getAxisValue(MotionEvent.AXIS_SCROLL);
        if (axisValue == 0f) {
            return false;
        }

        float scrollFactor = ViewConfiguration.get(this).getScaledVerticalScrollFactor();
        float requestedDelta = (-axisValue * scrollFactor * ROTARY_SCROLL_SENSITIVITY) + rotaryScrollCarry;
        int deltaPixels = (int) requestedDelta;
        rotaryScrollCarry = requestedDelta - deltaPixels;

        if (deltaPixels == 0) {
            return true;
        }

        int direction = deltaPixels > 0 ? 1 : -1;
        if (!targetScroll.canScrollVertically(direction)) {
            rotaryScrollCarry = 0f;
            return false;
        }

        targetScroll.scrollBy(0, deltaPixels);
        return true;
    }

    private ScrollView getActiveScrollTarget() {
        if (homeScroll != null && homeScroll.getVisibility() == View.VISIBLE) {
            return homeScroll;
        }

        if (pageScroll != null && pageScroll.getVisibility() == View.VISIBLE) {
            return pageScroll;
        }

        return null;
    }

    private void openUrlLocal(String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException exception) {
            Toast.makeText(this, R.string.open_phone_unavailable, Toast.LENGTH_SHORT).show();
        }
    }

    private void openSpotifyOnWatch() {
        Intent launchIntent = findSpotifyLaunchIntent();
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(launchIntent);
                return;
            } catch (ActivityNotFoundException ignored) {
                // Fall through to URI-based launch.
            }
        }

        Intent spotifyIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:"));
        spotifyIntent.setPackage("com.spotify.music");
        try {
            startActivity(spotifyIntent);
            return;
        } catch (ActivityNotFoundException ignored) {
            // Fall through to generic URI launch.
        }

        Intent genericSpotifyIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:"));
        try {
            startActivity(genericSpotifyIntent);
            return;
        } catch (ActivityNotFoundException ignored) {
            // Fall through to the unavailable toast.
        }

        showToast(getString(R.string.open_spotify_unavailable));
    }

    private void openLatestUserPostOnPhone() {
        openFeedPostMediaOnPhone(latestUserPost);
    }

    private void openLatestPostOnPhone() {
        openFeedPostMediaOnPhone(latestPost);
    }

    private void openFeedPostMediaOnPhone(FeedPost target) {
        String mediaUrl = resolveFeedPostMediaUrl(target);
        if (target == null || TextUtils.isEmpty(mediaUrl)) {
            showToast(getString(R.string.feed_empty));
            return;
        }

        String preferredPackageName = resolveFeedPostPackage(target);
        String normalizedMediaUri = normalizePostedMediaOpenUri(mediaUrl, preferredPackageName);
        if (isPostedMediaAlreadyPlaying(normalizedMediaUri) || isRecentPostedMediaOpen(normalizedMediaUri)) {
            showToast(getString(R.string.posted_media_already_playing));
            scheduleMediaActionRefreshes();
            return;
        }

        rememberPostedMediaOpen(normalizedMediaUri);
        openPostedMediaUrlOnPhone(mediaUrl, preferredPackageName);
    }

    private boolean isPostedMediaAlreadyPlaying(String normalizedMediaUri) {
        if (TextUtils.isEmpty(normalizedMediaUri) || lastNowPlayingSnapshot == null || !lastNowPlayingSnapshot.active) {
            return false;
        }

        String currentOpenUri = normalizePostedMediaOpenUri(
                lastNowPlayingSnapshot.openUri,
                lastNowPlayingSnapshot.appPackage
        );
        return mediaOpenUrisMatch(normalizedMediaUri, currentOpenUri);
    }

    private boolean isRecentPostedMediaOpen(String normalizedMediaUri) {
        if (TextUtils.isEmpty(normalizedMediaUri) || TextUtils.isEmpty(lastPostedMediaOpenUri)) {
            return false;
        }

        long elapsedMs = System.currentTimeMillis() - lastPostedMediaOpenAtMs;
        return elapsedMs >= 0
                && elapsedMs <= POSTED_MEDIA_RECENT_OPEN_WINDOW_MS
                && mediaOpenUrisMatch(normalizedMediaUri, lastPostedMediaOpenUri);
    }

    private void rememberPostedMediaOpen(String normalizedMediaUri) {
        if (TextUtils.isEmpty(normalizedMediaUri)) {
            return;
        }

        lastPostedMediaOpenUri = normalizedMediaUri;
        lastPostedMediaOpenAtMs = System.currentTimeMillis();
    }

    private boolean mediaOpenUrisMatch(String firstUri, String secondUri) {
        return !TextUtils.isEmpty(firstUri)
                && !TextUtils.isEmpty(secondUri)
                && TextUtils.equals(firstUri, secondUri);
    }

    private String normalizePostedMediaOpenUri(String rawValue, String packageName) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        String youtubeUri = normalizeYoutubeOpenUri(value);
        if (!TextUtils.isEmpty(youtubeUri)) {
            return youtubeUri;
        }

        String spotifyUri = normalizeSpotifyOpenUri(value);
        if (!TextUtils.isEmpty(spotifyUri)) {
            return spotifyUri;
        }

        return normalizePhoneMediaOpenUri(value);
    }

    private String resolveFeedPostMediaUrl(FeedPost post) {
        if (post == null) {
            return "";
        }

        if ("youtube".equals(post.sourceKind)) {
            if (!TextUtils.isEmpty(post.externalUrl)) {
                return post.externalUrl;
            }
            String videoId = post.resolveYoutubeVideoId();
            if (!TextUtils.isEmpty(videoId)) {
                return "https://www.youtube.com/watch?v=" + videoId;
            }
        }

        if ("spotify".equals(post.sourceKind)) {
            String spotifyUrl = resolveSpotifyWebUrl(post);
            if (!TextUtils.isEmpty(spotifyUrl)) {
                return spotifyUrl;
            }
        }

        return post.handoffUrl();
    }

    private String resolveSpotifyWebUrl(FeedPost post) {
        if (post == null) {
            return "";
        }

        if (!TextUtils.isEmpty(post.externalUrl)) {
            return post.externalUrl;
        }

        String candidate = !TextUtils.isEmpty(post.mediaUrl) ? post.mediaUrl : post.handoffUrl();
        if (TextUtils.isEmpty(candidate)) {
            return "";
        }

        try {
            Uri uri = Uri.parse(candidate);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && host != null
                    && host.toLowerCase(Locale.US).contains("spotify.com")) {
                List<String> segments = uri.getPathSegments();
                if (segments == null || segments.isEmpty()) {
                    return candidate;
                }

                int typeIndex = "embed".equals(segments.get(0)) ? 1 : 0;
                if (segments.size() > typeIndex + 1) {
                    return "https://open.spotify.com/" + segments.get(typeIndex) + "/" + segments.get(typeIndex + 1);
                }

                return candidate;
            }
        } catch (Exception ignored) {
            return "";
        }

        return "";
    }

    private String resolveFeedPostPackage(FeedPost post) {
        if (post == null || TextUtils.isEmpty(post.sourceKind)) {
            return "";
        }

        if ("youtube".equals(post.sourceKind)) {
            return "com.google.android.youtube";
        }

        if ("spotify".equals(post.sourceKind)) {
            return "com.spotify.music";
        }

        return "";
    }

    private Intent findSpotifyLaunchIntent() {
        PackageManager packageManager = getPackageManager();
        Intent launcherQuery = new Intent(Intent.ACTION_MAIN);
        launcherQuery.addCategory(Intent.CATEGORY_LAUNCHER);
        launcherQuery.setPackage("com.spotify.music");

        List<ResolveInfo> launchers = packageManager.queryIntentActivities(launcherQuery, 0);
        for (ResolveInfo resolveInfo : launchers) {
            if (resolveInfo == null || resolveInfo.activityInfo == null) {
                continue;
            }

            Intent explicitIntent = new Intent(Intent.ACTION_MAIN);
            explicitIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            explicitIntent.setComponent(new ComponentName(
                    resolveInfo.activityInfo.packageName,
                    resolveInfo.activityInfo.name
            ));
            explicitIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return explicitIntent;
        }

        return packageManager.getLaunchIntentForPackage("com.spotify.music");
    }

    private void showConfirmation(int animationType, CharSequence message) {
        new ConfirmationOverlay()
                .setType(animationType)
                .setMessage(message)
                .showOn(this);
    }

    private void loadLatestFeed() {
        feedSummary.setText(R.string.feed_loading);
        feedMeta.setText(R.string.feed_meta_default);
        feedPreviewImage.setImageResource(android.R.color.transparent);
        feedPageSummary.setText(R.string.feed_loading);
        feedPageMeta.setText(R.string.feed_meta_default);
        feedPageImage.setImageResource(android.R.color.transparent);
        feedOpenImage.setImageResource(android.R.color.transparent);
        feedOpenImage.setVisibility(View.GONE);
        setLatestPostTileEnabled(false);

        executor.execute(() -> {
            try {
                SessionState feedSession = sessionState;
                List<FeedPost> posts = fetchRecentFeedPosts();
                FeedPost fetchedUserPost = null;
                try {
                    fetchedUserPost = fetchLatestUserFeedPost(feedSession);
                } catch (Exception ignored) {
                    // Keep the public feed usable even if the signed-in post lookup fails.
                }
                FeedPost userPost = fetchedUserPost;
                mainHandler.post(() -> {
                    boolean sameUser = (feedSession == null && sessionState == null)
                            || (feedSession != null
                            && sessionState != null
                            && TextUtils.equals(feedSession.userId, sessionState.userId));
                    if (posts.isEmpty()) {
                        latestPost = null;
                        spotlightPost = null;
                    } else {
                        latestPost = posts.get(0);
                        spotlightPost = findSpotlightPost(posts);
                    }
                    latestUserPost = sameUser ? userPost : null;
                    renderFeedSection();
                });
            } catch (Exception exception) {
                mainHandler.post(() -> {
                    latestPost = null;
                    latestUserPost = null;
                    spotlightPost = null;
                    feedSummary.setText(R.string.feed_failed);
                    feedMeta.setText(R.string.feed_meta_default);
                    feedPreviewImage.setImageResource(android.R.color.transparent);
                    feedPageSummary.setText(R.string.feed_failed);
                    feedPageMeta.setText(R.string.feed_meta_default);
                    feedPageImage.setImageResource(android.R.color.transparent);
                    feedOpenImage.setImageResource(android.R.color.transparent);
                    feedOpenImage.setVisibility(View.GONE);
                    setLatestPostTileEnabled(false);
                    if (activeSection == Section.FEED && pageScroll.getVisibility() == View.VISIBLE) {
                        pageBody.setText(R.string.feed_failed);
                    }
                });
            }
        });
    }

    private void renderFeedSection() {
        boolean hasLatestFeed = latestPost != null;
        feedPagePanel.setEnabled(hasLatestFeed);
        feedPagePanel.setClickable(hasLatestFeed);
        feedPagePanel.setFocusable(hasLatestFeed);
        feedPagePanel.setAlpha(hasLatestFeed ? 1f : 0.72f);
        renderHomeFeedCard(latestPost);
        renderLatestPostPanel(latestPost);
        renderFeedHandoffPanel(latestUserPost);
    }

    private void renderHomeFeedCard(FeedPost post) {
        if (post == null) {
            feedSummary.setText(R.string.feed_empty);
            feedMeta.setText(R.string.feed_meta_default);
            feedPreviewImage.setImageResource(android.R.color.transparent);
            return;
        }

        feedSummary.setText(post.title);
        feedMeta.setText(String.format(Locale.US, "%s - %s", uppercase(post.mediaKind), post.creator));
        loadPostImage(post, feedPreviewImage);
    }

    private void renderLatestPostPanel(FeedPost post) {
        if (post == null) {
            feedPageSummary.setText(R.string.feed_empty);
            feedPageMeta.setText(R.string.feed_meta_default);
            feedPageImage.setImageResource(android.R.color.transparent);
            if (activeSection == Section.FEED && pageScroll.getVisibility() == View.VISIBLE) {
                pageBody.setText(R.string.feed_empty);
            }
            return;
        }

        feedPageSummary.setText(post.title);
        // Shorten description snippet to keep it small as requested
        String snippet = excerpt(post.captionOrFallback(), 60);
        feedPageMeta.setText(String.format(Locale.US, "%s - %s\n\n%s", uppercase(post.mediaKind), post.creator, snippet));

        if (activeSection == Section.FEED && pageScroll.getVisibility() == View.VISIBLE) {
            pageBody.setText(post.captionOrFallback());
        }
        loadPostImage(post, feedPageImage);
    }

    private void renderFeedHandoffPanel(FeedPost post) {
        boolean enabled = post != null && !TextUtils.isEmpty(resolveFeedPostMediaUrl(post));
        feedOpenPanel.setEnabled(enabled);
        feedOpenPanel.setClickable(enabled);
        feedOpenPanel.setFocusable(enabled);
        feedOpenPanel.setAlpha(enabled ? 1f : 0.72f);

        if (post != null) {
            feedOpenTitle.setText(R.string.feed_latest_post_title);
            feedOpenSummary.setText(post.title);
            feedOpenMeta.setText(String.format(Locale.US, "%s - %s", uppercase(post.mediaKind), post.creator));
            feedOpenImage.setVisibility(View.VISIBLE);
            loadPostImage(post, feedOpenImage);
        } else {
            feedOpenTitle.setText(R.string.feed_latest_post_title);
            feedOpenSummary.setText(sessionState == null
                    ? R.string.feed_latest_user_post_signed_out
                    : R.string.feed_latest_user_post_empty);
            feedOpenMeta.setText(R.string.feed_latest_user_post_meta);
            feedOpenImage.setImageResource(android.R.color.transparent);
            feedOpenImage.setVisibility(View.GONE);
        }
    }

    private void loadPostImage(FeedPost post, ImageView imageView) {
        executor.execute(() -> {
            String previewUrl = "";
            for (String candidateUrl : post.previewImageUrls()) {
                Bitmap candidateBitmap = downloadBitmap(candidateUrl);
                if (candidateBitmap != null) {
                    mainHandler.post(() -> imageView.setImageBitmap(candidateBitmap));
                    return;
                }
                previewUrl = candidateUrl;
            }

            if (TextUtils.isEmpty(previewUrl) && "spotify".equals(post.sourceKind) && !TextUtils.isEmpty(post.externalUrl)) {
                try {
                    JSONObject oembed = executeObjectRequest("https://open.spotify.com/oembed?url=" + Uri.encode(post.externalUrl), "GET", null, null, null);
                    previewUrl = oembed.optString("thumbnail_url");
                } catch (Exception ignored) {}
            }

            if (TextUtils.isEmpty(previewUrl)) {
                mainHandler.post(() -> imageView.setImageResource(android.R.color.transparent));
                return;
            }

            Bitmap bitmap = downloadBitmap(previewUrl);
            mainHandler.post(() -> {
                if (bitmap != null) {
                    imageView.setImageBitmap(bitmap);
                } else {
                    imageView.setImageResource(android.R.color.transparent);
                }
            });
        });
    }

    private void setLatestPostTileEnabled(boolean enabled) {
        feedOpenPanel.setEnabled(enabled);
        feedOpenPanel.setClickable(enabled);
        feedOpenPanel.setFocusable(enabled);
        feedOpenPanel.setAlpha(enabled ? 1f : 0.72f);
        feedPagePanel.setEnabled(enabled);
        feedPagePanel.setClickable(enabled);
        feedPagePanel.setFocusable(enabled);
        feedPagePanel.setAlpha(enabled ? 1f : 0.72f);
    }

    private void signInWatch() {
        final String email = watchEmailInput.getText().toString().trim().toLowerCase(Locale.US);
        final String password = watchPasswordInput.getText().toString();

        if (TextUtils.isEmpty(email) || TextUtils.isEmpty(password)) {
            showToast(getString(R.string.sign_in_failed));
            return;
        }

        messagesPanelMeta.setText(R.string.messages_signing_in);
        watchSignInButton.setEnabled(false);

        executor.execute(() -> {
            try {
                SessionState newSession = authenticateWithSupabase(email, password);
                mainHandler.post(() -> {
                    saveSession(newSession);
                    watchSignInButton.setEnabled(true);
                    loadLatestFeed();
                    loadMessageThreads(true, false);
                    startMessagesAutoRefresh();
                });
            } catch (Exception exception) {
                mainHandler.post(() -> {
                    watchSignInButton.setEnabled(true);
                    messagesPanelMeta.setText(R.string.sign_in_failed);
                    showToast(getString(R.string.sign_in_failed));
                });
            }
        });
    }

    private void loadMessageThreads(boolean resetSelection, boolean silent) {
        if (sessionState == null) {
            renderSignedOutState();
            return;
        }

        if (messagesRefreshInFlight) {
            return;
        }

        messagesRefreshInFlight = true;
        if (!silent) {
            messagesPanelMeta.setText(R.string.messages_loading_threads);
            messagesSummary.setText(R.string.messages_card_ready);
        }

        Map<String, String> previousThreadUpdates = snapshotThreadUpdates();
        executor.execute(() -> {
            try {
                SessionState messageSession = sessionState;
                List<ThreadRecord> threads = fetchThreads();
                Map<String, ProfileRecord> profileMap = fetchProfiles();
                Map<String, Integer> fetchedUnreadCounts;
                try {
                    fetchedUnreadCounts = fetchUnreadMessageCounts(threads, messageSession);
                } catch (Exception ignored) {
                    fetchedUnreadCounts = Collections.emptyMap();
                }
                final Map<String, Integer> unreadCounts = fetchedUnreadCounts;
                Map<String, MessageRecord> changedThreadMessages = silent
                        ? fetchLatestMessagesForChangedThreads(threads, previousThreadUpdates)
                        : Collections.emptyMap();

                mainHandler.post(() -> {
                    messagesRefreshInFlight = false;
                    if (messageSession == null
                            || sessionState == null
                            || !TextUtils.equals(messageSession.userId, sessionState.userId)) {
                        return;
                    }
                    profilesById.clear();
                    profilesById.putAll(profileMap);
                    threadRecords.clear();
                    threadRecords.addAll(threads);
                    unreadCountsByThread.clear();
                    unreadCountsByThread.putAll(unreadCounts);
                    lastInboxTopThreadSignature = getTopThreadSignature(threadRecords);
                    renderThreadButtons();

                    if (threadRecords.isEmpty()) {
                        lastInboxTopThreadSignature = "";
                        activeThreadId = null;
                        renderEmptyMessagesState();
                        return;
                    }

                    notifyForIncomingMessages(changedThreadMessages);

                    boolean threadChanged = false;
                    if (resetSelection) {
                        activeThreadId = threadRecords.get(0).id;
                        threadChanged = true;
                    } else if (!TextUtils.isEmpty(activeThreadId) && findThread(activeThreadId) == null) {
                        activeThreadId = threadRecords.get(0).id;
                        threadChanged = true;
                    }

                    if (TextUtils.isEmpty(activeThreadId)) {
                        activeMessages.clear();
                        renderThreadButtons();
                        return;
                    }

                    loadMessagesForThread(activeThreadId, silent && !threadChanged);
                });
            } catch (Exception exception) {
                mainHandler.post(() -> {
                    messagesRefreshInFlight = false;
                    if (isAuthenticationFailure(exception)) {
                        handleExpiredWatchSession();
                        return;
                    }
                    messagesPanelMeta.setText(R.string.threads_failed);
                    messagesSummary.setText(R.string.threads_failed);
                    messagesMeta.setText(R.string.messages_meta_default);
                    renderEmptyMessagesState();
                });
            }
        });
    }

    private void renderThreadButtons() {
        messagesThreadList.removeAllViews();

        if (sessionState == null) {
            messagesThreadList.setVisibility(View.GONE);
            watchSignOutButton.setVisibility(View.GONE);
            backToThreadsButton.setVisibility(View.GONE);
            return;
        }

        boolean showingConversation = !TextUtils.isEmpty(activeThreadId);
        watchSignInButton.setText(R.string.messages_signed_out);
        messagesAuthGroup.setVisibility(View.GONE);

        if (!showingConversation) {
            renderInboxState();
        }

        if (threadRecords.isEmpty()) {
            messagesSummary.setText(R.string.messages_card_empty);
            if (!showingConversation) {
                messagesThreadList.setVisibility(View.GONE);
                messagesPanelMeta.setText(R.string.messages_no_threads);
            }
            return;
        }

        messagesSummary.setText(R.string.messages_card_ready);
        for (ThreadRecord thread : threadRecords) {
            Button button = new Button(this);
            button.setAllCaps(false);
            styleButton(button, false, currentTheme);
            button.setTextSize(11f);
            button.setPadding(dp(12), dp(12), dp(12), dp(12));
            button.setText(getThreadLabel(thread));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
            );
            if (messagesThreadList.getChildCount() > 0) {
                params.topMargin = dp(8);
            }
            button.setLayoutParams(params);
            button.setOnClickListener(view -> {
                activeThreadId = thread.id;
                renderConversation();
                loadMessagesForThread(thread.id, false);
            });
            messagesThreadList.addView(button);
        }
    }

    private void renderInboxState() {
        watchMessageInput.setVisibility(View.GONE);
        watchSendMessageButton.setVisibility(View.GONE);
        messagesConversationPreview.setVisibility(View.GONE);
        String unreadLabel = formatUnreadMessageCount(getUnreadMessageCount());
        messagesPanelMeta.setText(unreadLabel);
        messagesMeta.setText(unreadLabel);
        messagesThreadList.setVisibility(View.VISIBLE);
        watchSignOutButton.setVisibility(View.VISIBLE);
        backToThreadsButton.setVisibility(View.GONE);
    }

    private int getUnreadMessageCount() {
        int total = 0;
        for (Integer count : unreadCountsByThread.values()) {
            if (count != null && count > 0) {
                total += count;
            }
        }
        return total;
    }

    private String formatUnreadMessageCount(int count) {
        if (count <= 0) {
            return getString(R.string.messages_unread_none);
        }
        if (count == 1) {
            return getString(R.string.messages_unread_one);
        }
        return getString(R.string.messages_unread_count, count);
    }

    private void renderUnreadMessageCount() {
        String unreadLabel = formatUnreadMessageCount(getUnreadMessageCount());
        messagesMeta.setText(unreadLabel);
        if (sessionState != null) {
            messagesPanelMeta.setText(unreadLabel);
        }
    }

    private String getTopThreadSignature(List<ThreadRecord> threads) {
        if (threads == null || threads.isEmpty()) {
            return "";
        }

        ThreadRecord topThread = threads.get(0);
        return topThread.id + ":" + topThread.updatedAt;
    }

    private void loadMessagesForThread(String threadId, boolean silent) {
        if (sessionState == null || TextUtils.isEmpty(threadId)) {
            renderEmptyMessagesState();
            return;
        }

        if (!silent) {
            messagesPanelMeta.setText(R.string.messages_loading_threads);
        }

        executor.execute(() -> {
            try {
                List<MessageRecord> messages = fetchMessages(threadId);
                mainHandler.post(() -> {
                    if (!threadId.equals(activeThreadId)) {
                        return;
                    }

                    MessageRecord previousLatestMessage = getLatestMessage(activeMessages);
                    MessageRecord latestMessage = getLatestMessage(messages);
                    boolean changed = activeMessages.size() != messages.size();
                    if (!changed && !activeMessages.isEmpty()) {
                        String lastIdBefore = activeMessages.get(activeMessages.size() - 1).id;
                        String lastIdAfter = messages.get(messages.size() - 1).id;
                        if (!lastIdBefore.equals(lastIdAfter)) {
                            changed = true;
                        }
                    }

                    boolean shouldMarkRead = !silent || isThreadVisible(threadId);
                    if (changed) {
                        if (silent
                                && latestMessage != null
                                && (previousLatestMessage == null
                                || !TextUtils.equals(previousLatestMessage.id, latestMessage.id))) {
                            notifyForIncomingMessage(latestMessage);
                        }

                        activeMessages.clear();
                        activeMessages.addAll(messages);
                        if (shouldMarkRead) {
                            markThreadRead(threadId, messages);
                        }
                        renderConversation();
                    } else if (!silent) {
                        markThreadRead(threadId, messages);
                        renderConversation();
                    }
                });
            } catch (Exception exception) {
                mainHandler.post(() -> {
                    if (isAuthenticationFailure(exception)) {
                        handleExpiredWatchSession();
                        return;
                    }

                    if (!silent) {
                        messagesPanelMeta.setText(R.string.messages_failed);
                        messagesSummary.setText(R.string.messages_failed);
                        renderEmptyMessagesState();
                    }
                });
            }
        });
    }

    private void renderConversation() {
        boolean hasThread = !TextUtils.isEmpty(activeThreadId);
        watchMessageInput.setVisibility(hasThread ? View.VISIBLE : View.GONE);
        watchSendMessageButton.setVisibility(hasThread ? View.VISIBLE : View.GONE);
        messagesConversationPreview.setVisibility(hasThread ? View.VISIBLE : View.GONE);
        backToThreadsButton.setVisibility(hasThread ? View.VISIBLE : View.GONE);
        messagesThreadList.setVisibility(hasThread ? View.GONE : View.VISIBLE);
        watchSignOutButton.setVisibility(hasThread ? View.GONE : View.VISIBLE);

        if (!hasThread) {
            renderEmptyMessagesState();
            return;
        }

        ThreadRecord activeThread = findThread(activeThreadId);
        String partnerName = getThreadPartnerName(activeThread);
        String unreadLabel = formatUnreadMessageCount(getUnreadMessageCount());
        messagesPanelMeta.setText(unreadLabel);
        messagesMeta.setText(unreadLabel);

        if (activeMessages.isEmpty()) {
            messagesSummary.setText(R.string.messages_card_ready);
            messagesConversationPreview.setText(R.string.messages_preview_default);
            return;
        }

        MessageRecord lastMessage = activeMessages.get(activeMessages.size() - 1);
        messagesSummary.setText(excerpt(TextUtils.isEmpty(lastMessage.body) ? "[attachment]" : lastMessage.body));

        StringBuilder preview = new StringBuilder();
        int start = Math.max(0, activeMessages.size() - 4);
        for (int index = start; index < activeMessages.size(); index++) {
            MessageRecord message = activeMessages.get(index);
            String sender = sessionState != null && message.senderId.equals(sessionState.userId)
                    ? "You"
                    : partnerName;
            preview.append(sender)
                    .append(": ")
                    .append(TextUtils.isEmpty(message.body) ? "[attachment]" : message.body);
            if (index < activeMessages.size() - 1) {
                preview.append("\n\n");
            }
        }
        messagesConversationPreview.setText(preview.toString());
        ensureLatestMessageVisible();
    }

    private boolean isThreadVisible(String threadId) {
        return activeSection == Section.MESSAGES
                && pageScroll.getVisibility() == View.VISIBLE
                && !TextUtils.isEmpty(threadId)
                && TextUtils.equals(threadId, activeThreadId);
    }

    private void markThreadRead(String threadId, List<MessageRecord> messages) {
        if (sharedPreferences == null || sessionState == null || TextUtils.isEmpty(threadId) || messages == null) {
            return;
        }

        String latestCreatedAt = "";
        for (MessageRecord message : messages) {
            if (message != null && !TextUtils.isEmpty(message.createdAt)) {
                latestCreatedAt = message.createdAt;
            }
        }

        if (TextUtils.isEmpty(latestCreatedAt)) {
            return;
        }

        sharedPreferences.edit()
                .putString(getThreadReadAtPreferenceKey(sessionState.userId, threadId), latestCreatedAt)
                .apply();
        unreadCountsByThread.put(threadId, 0);
    }

    private void playNotificationFeedback() {
        try {
            // Vibrate
            Vibrator vibrator;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vibratorManager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null) {
                vibrator.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE));
            }

            // Play notification sound
            Uri notification = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            Ringtone r = RingtoneManager.getRingtone(getApplicationContext(), notification);
            if (r != null) {
                r.play();
            }
        } catch (Exception e) {
            android.util.Log.e("SignalShareWear", "Failed to play notification feedback", e);
        }
    }

    private void renderEmptyMessagesState() {
        messagesConversationPreview.setVisibility(View.VISIBLE);
        messagesConversationPreview.setText(R.string.messages_no_threads);
        watchMessageInput.setVisibility(View.GONE);
        watchSendMessageButton.setVisibility(View.GONE);
        backToThreadsButton.setVisibility(!TextUtils.isEmpty(activeThreadId) ? View.VISIBLE : View.GONE);
        if (sessionState != null) {
            messagesSummary.setText(R.string.messages_card_empty);
            messagesMeta.setText(formatUnreadMessageCount(getUnreadMessageCount()));
        }
    }

    private void ensureLatestMessageVisible() {
        if (activeSection != Section.MESSAGES || pageScroll.getVisibility() != View.VISIBLE) {
            return;
        }

        pageScroll.post(() -> pageScroll.fullScroll(View.FOCUS_DOWN));
    }

    private void renderSignedOutState() {
        stopMessagesAutoRefresh();
        lastInboxTopThreadSignature = "";
        messagesSummary.setText(R.string.messages_card_signed_out);
        messagesMeta.setText(R.string.messages_meta_default);
        messagesPanelMeta.setText(R.string.messages_panel_default);
        messagesAuthGroup.setVisibility(View.VISIBLE);
        messagesThreadList.setVisibility(View.GONE);
        watchSignOutButton.setVisibility(View.GONE);
        backToThreadsButton.setVisibility(View.GONE);
        messagesConversationPreview.setVisibility(View.GONE);
        watchMessageInput.setVisibility(View.GONE);
        watchSendMessageButton.setVisibility(View.GONE);
        watchSignInButton.setText(R.string.watch_sign_in);
        activeThreadId = null;
        threadRecords.clear();
        activeMessages.clear();
        messagesThreadList.removeAllViews();
    }

    private void sendWatchMessage() {
        final String messageBody = watchMessageInput.getText().toString().trim();
        if (sessionState == null || TextUtils.isEmpty(activeThreadId) || TextUtils.isEmpty(messageBody)) {
            showToast(getString(R.string.messages_send_error));
            return;
        }

        watchSendMessageButton.setEnabled(false);
        executor.execute(() -> {
            try {
                postMessage(activeThreadId, messageBody);
                List<MessageRecord> messages = fetchMessages(activeThreadId);
                mainHandler.post(() -> {
                    watchSendMessageButton.setEnabled(true);
                    watchMessageInput.setText("");
                    activeMessages.clear();
                    activeMessages.addAll(messages);
                    markThreadRead(activeThreadId, messages);
                    renderConversation();
                    showToast(getString(R.string.messages_refresh_done));
                });
            } catch (Exception exception) {
                mainHandler.post(() -> {
                    watchSendMessageButton.setEnabled(true);
                    if (isAuthenticationFailure(exception)) {
                        handleExpiredWatchSession();
                        return;
                    }
                    showToast(getString(R.string.messages_send_error));
                });
            }
        });
    }

    private void refreshNowPlayingState() {
        Wearable.getNodeClient(this).getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    phoneNowPlayingAvailable = nodes != null && !nodes.isEmpty();
                    if (phoneNowPlayingAvailable) {
                        if (lastNowPlayingSnapshot.remoteSource) {
                            renderNowPlayingState(lastNowPlayingSnapshot);
                        } else {
                            renderPhoneNowPlayingLoadingState();
                        }
                        requestPhoneNowPlayingSnapshot(nodes.get(0).getId());
                        return;
                    }

                    NowPlayingSnapshot localSnapshot = readLocalNowPlayingSnapshot();
                    lastNowPlayingSnapshot = localSnapshot;
                    renderNowPlayingState(localSnapshot);
                })
                .addOnFailureListener(exception -> {
                    phoneNowPlayingAvailable = false;
                    NowPlayingSnapshot localSnapshot = readLocalNowPlayingSnapshot();
                    lastNowPlayingSnapshot = localSnapshot;
                    renderNowPlayingState(localSnapshot);
                });
    }

    private void renderNowPlayingState(NowPlayingSnapshot snapshot) {
        lastNowPlayingSnapshot = snapshot;

        if (snapshot.permissionRequired) {
            updateMediaCardState(
                    getString(R.string.media_access_title),
                    getString(R.string.media_access_meta)
            );
            mediaPanelTitle.setText(R.string.media_access_title);
            mediaPanelMeta.setText(R.string.media_access_summary);
            if (activeSection == Section.MEDIA) {
                pageBody.setText(R.string.media_access_summary);
                openPhoneButton.setText(R.string.media_access_button);
            }
            return;
        }

        if (snapshot.phoneUnavailable) {
            updateMediaCardState(
                    getString(R.string.media_card_phone_unavailable),
                    getString(R.string.media_phone_meta)
            );
            mediaPanelTitle.setText(R.string.media_panel_title);
            mediaPanelMeta.setText(R.string.media_panel_phone_unavailable);
            if (activeSection == Section.MEDIA) {
                pageBody.setText(R.string.media_panel_phone_unavailable);
                openPhoneButton.setText(R.string.open_phone);
            }
            return;
        }

        if (snapshot.active) {
            updateMediaCardState(snapshot.title, snapshot.meta);
            mediaPanelTitle.setText(snapshot.title);
            mediaPanelMeta.setText(snapshot.meta);
            if (activeSection == Section.MEDIA) {
                pageBody.setText(R.string.media_detail);
                openPhoneButton.setText(R.string.open_phone);
            }
            return;
        }

        updateMediaCardState(
                getString(R.string.media_card_idle),
                getString(R.string.media_meta_default)
        );
        mediaPanelTitle.setText(R.string.media_panel_title);
        mediaPanelMeta.setText(R.string.media_panel_idle);
        if (activeSection == Section.MEDIA) {
            pageBody.setText(R.string.media_panel_idle);
            openPhoneButton.setText(R.string.open_phone);
        }
    }

    private void renderPhoneNowPlayingLoadingState() {
        updateMediaCardState(
                getString(R.string.media_card_syncing_phone),
                getString(R.string.media_phone_meta)
        );
        mediaPanelTitle.setText(R.string.media_panel_title);
        mediaPanelMeta.setText(R.string.media_panel_syncing_phone);
        if (activeSection == Section.MEDIA) {
            pageBody.setText(R.string.media_panel_syncing_phone);
            openPhoneButton.setText(R.string.open_phone);
        }
    }

    private void requestPhoneNowPlayingSnapshot(String nodeId) {
        awaitingPhoneNowPlayingResponse = true;
        mainHandler.removeCallbacks(phoneNowPlayingTimeoutRunnable);
        mainHandler.postDelayed(phoneNowPlayingTimeoutRunnable, PHONE_NOW_PLAYING_TIMEOUT_MS);
        Wearable.getMessageClient(this)
                .sendMessage(nodeId, PHONE_NOW_PLAYING_REQUEST_PATH, new byte[0])
                .addOnFailureListener(exception -> {
                    phoneNowPlayingAvailable = false;
                    awaitingPhoneNowPlayingResponse = false;
                    mainHandler.removeCallbacks(phoneNowPlayingTimeoutRunnable);
                    NowPlayingSnapshot localSnapshot = readLocalNowPlayingSnapshot();
                    mainHandler.post(() -> {
                        lastNowPlayingSnapshot = localSnapshot;
                        renderNowPlayingState(localSnapshot);
                    });
                });
    }

    private void openCurrentMediaOnPhone(String openUri, String preferredPackageName) {
        String normalizedOpenUri = normalizePhoneMediaOpenUri(openUri);
        String resolvedPackageName = resolvePhoneMediaPackage(normalizedOpenUri, preferredPackageName);
        Uri.Builder appUriBuilder = Uri.parse(PHONE_MEDIA_OPEN_DEEP_LINK).buildUpon();
        if (!TextUtils.isEmpty(resolvedPackageName)) {
            appUriBuilder.appendQueryParameter("package", resolvedPackageName);
        }
        if (!TextUtils.isEmpty(normalizedOpenUri)) {
            appUriBuilder.appendQueryParameter("uri", normalizedOpenUri);
        }

        openPhoneAppDeepLink(appUriBuilder.build());
    }

    private void openPostedMediaUrlOnPhone(String mediaUrl, String preferredPackageName) {
        Intent packageIntent = new Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(Uri.parse(mediaUrl));
        if (!TextUtils.isEmpty(preferredPackageName)) {
            packageIntent.setPackage(preferredPackageName);
        }

        ListenableFuture<Void> packageResult = remoteActivityHelper.startRemoteActivity(packageIntent);
        Futures.addCallback(packageResult, new FutureCallback<Void>() {
            @Override
            public void onSuccess(Void unused) {
                mainHandler.post(() -> {
                        showConfirmation(
                                ConfirmationOverlay.OPEN_ON_PHONE_ANIMATION,
                                getString(R.string.open_phone_success)
                        );
                        scheduleMediaActionRefreshes();
                });
            }

            @Override
            public void onFailure(@NonNull Throwable throwable) {
                Intent genericIntent = new Intent(Intent.ACTION_VIEW)
                        .addCategory(Intent.CATEGORY_BROWSABLE)
                        .setData(Uri.parse(mediaUrl));

                ListenableFuture<Void> genericResult = remoteActivityHelper.startRemoteActivity(genericIntent);
                Futures.addCallback(genericResult, new FutureCallback<Void>() {
                    @Override
                    public void onSuccess(Void unused) {
                        mainHandler.post(() -> {
                                showConfirmation(
                                        ConfirmationOverlay.OPEN_ON_PHONE_ANIMATION,
                                        getString(R.string.open_phone_success)
                                );
                                scheduleMediaActionRefreshes();
                        });
                    }

                    @Override
                    public void onFailure(@NonNull Throwable genericThrowable) {
                        mainHandler.post(() -> openUrlLocal(mediaUrl));
                    }
                }, executor);
            }
        }, executor);
    }

    private void openPhoneAppDeepLink(Uri appUri) {
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setData(appUri)
                .setPackage("io.signalshare.app");

        ListenableFuture<Void> result = remoteActivityHelper.startRemoteActivity(intent);
        Futures.addCallback(result, new FutureCallback<Void>() {
            @Override
            public void onSuccess(Void unused) {
                mainHandler.post(() ->
                        showConfirmation(
                                ConfirmationOverlay.OPEN_ON_PHONE_ANIMATION,
                                getString(R.string.open_phone_success)
                        )
                );
            }

            @Override
            public void onFailure(@NonNull Throwable throwable) {
                mainHandler.post(() -> showToast(getString(R.string.media_panel_phone_unavailable)));
            }
        }, executor);
    }

    private String normalizePhoneMediaOpenUri(String openUri) {
        if (TextUtils.isEmpty(openUri)) {
            return "";
        }

        if (openUri.startsWith("vnd.youtube:") || openUri.startsWith("spotify:")) {
            return openUri;
        }

        String youtubeVideoId = extractYoutubeVideoId(openUri);
        if (!TextUtils.isEmpty(youtubeVideoId)) {
            return "vnd.youtube:" + youtubeVideoId;
        }

        try {
            Uri uri = Uri.parse(openUri);
            String scheme = uri.getScheme();
            if (!TextUtils.isEmpty(scheme)) {
                return openUri;
            }
        } catch (Exception ignored) {
            return "";
        }

        return "";
    }

    private String resolvePhoneMediaPackage(String openUri, String preferredPackageName) {
        if (TextUtils.isEmpty(openUri)) {
            return preferredPackageName;
        }

        if (openUri.startsWith("vnd.youtube:")) {
            return "com.google.android.youtube";
        }

        if (openUri.startsWith("spotify:")) {
            return "com.spotify.music";
        }

        return preferredPackageName;
    }

    private NowPlayingSnapshot parsePhoneNowPlayingSnapshot(byte[] payload) {
        try {
            JSONObject json = new JSONObject(new String(payload, StandardCharsets.UTF_8));
            boolean permissionRequired = json.optBoolean("permissionRequired", false);
            boolean active = json.optBoolean("active", false);
            String appPackage = json.optString("appPackage", "");
            String openUri = json.optString("openUri", "");
            if (permissionRequired) {
                return NowPlayingSnapshot.permissionRequired(true);
            }
            if (active) {
                return NowPlayingSnapshot.active(
                        json.optString("title", getString(R.string.media_unknown_title)),
                        json.optString("meta", getString(R.string.media_phone_meta)),
                        true,
                        appPackage,
                        openUri
                );
            }
            return NowPlayingSnapshot.idle(true, appPackage, openUri);
        } catch (Exception ignored) {
            // Fall through to the idle phone snapshot.
        }

        return NowPlayingSnapshot.idle(true, "", "");
    }

    private NowPlayingSnapshot readLocalNowPlayingSnapshot() {
        if (!hasNowPlayingAccess()) {
            return NowPlayingSnapshot.permissionRequired(false);
        }

        MediaSessionManager mediaSessionManager = getSystemService(MediaSessionManager.class);
        if (mediaSessionManager == null) {
            return NowPlayingSnapshot.idle(false, "", "");
        }

        List<MediaController> controllers;
        try {
            controllers = mediaSessionManager.getActiveSessions(
                    new ComponentName(this, SignalShareNotificationListenerService.class)
            );
        } catch (SecurityException exception) {
            return NowPlayingSnapshot.permissionRequired(false);
        }

        MediaController controller = selectBestMediaController(controllers);
        if (controller == null) {
            return NowPlayingSnapshot.idle(false, "", "");
        }

        String title = extractNowPlayingTitle(controller.getMetadata());
        if (TextUtils.isEmpty(title)) {
            title = getString(R.string.media_unknown_title);
        }

        String packageName = controller.getPackageName();
        String creator = extractNowPlayingCreator(controller.getMetadata(), title);
        String appLabel = resolveMediaAppLabel(packageName);
        String stateLabel = resolvePlaybackStateLabel(controller.getPlaybackState());
        String openUri = resolveLocalPlayableOpenUri(controller);
        return NowPlayingSnapshot.active(title, buildMediaMeta(appLabel, creator, stateLabel), false, packageName, openUri);
    }

    private String resolveLocalPlayableOpenUri(MediaController controller) {
        if (controller == null) {
            return "";
        }

        String packageName = controller.getPackageName();
        if (!TextUtils.isEmpty(packageName) && packageName.toLowerCase(Locale.US).contains("spotify")) {
            return resolveSpotifyOpenUri(controller.getMetadata());
        }

        if (!TextUtils.isEmpty(packageName) && packageName.toLowerCase(Locale.US).contains("youtube")) {
            return resolveYoutubeOpenUri(controller.getMetadata());
        }

        MediaMetadata metadata = controller.getMetadata();
        if (metadata == null) {
            return "";
        }

        if (metadata.getDescription() != null && metadata.getDescription().getMediaUri() != null) {
            return metadata.getDescription().getMediaUri().toString();
        }

        String mediaUri = metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_URI);
        if (!TextUtils.isEmpty(mediaUri)) {
            return mediaUri;
        }

        return "";
    }

    private boolean hasNowPlayingAccess() {
        ComponentName listenerComponent = new ComponentName(this, SignalShareNotificationListenerService.class);
        NotificationManager notificationManager = getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            try {
                return notificationManager.isNotificationListenerAccessGranted(listenerComponent);
            } catch (Exception ignored) {
                // Fall through to the compat package-level check on older or quirky builds.
            }
        }

        return NotificationManagerCompat.getEnabledListenerPackages(this).contains(getPackageName());
    }

    private void openNotificationAccessSettings() {
        ComponentName listenerComponent = new ComponentName(this, SignalShareNotificationListenerService.class);

        List<Intent> candidateIntents = new ArrayList<>();
        Intent detailIntent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listenerComponent.flattenToString());
        candidateIntents.add(detailIntent);
        candidateIntents.add(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        candidateIntents.add(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        candidateIntents.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", getPackageName(), null)));
        candidateIntents.add(new Intent(Settings.ACTION_SETTINGS));

        for (Intent intent : candidateIntents) {
            if (canHandleIntent(intent)) {
                try {
                    startActivity(intent);
                    return;
                } catch (ActivityNotFoundException ignored) {
                    // Try the next fallback.
                }
            }
        }

        showToast(getString(R.string.media_access_unavailable));
    }

    private void openNotificationAlertSettings() {
        List<Intent> candidateIntents = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            candidateIntents.add(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, WatchPushManager.getAlertChannelId()));
        }
        candidateIntents.add(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        candidateIntents.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", getPackageName(), null)));
        candidateIntents.add(new Intent(Settings.ACTION_SETTINGS));

        for (Intent intent : candidateIntents) {
            if (!canHandleIntent(intent)) {
                continue;
            }

            try {
                startActivity(intent);
                return;
            } catch (ActivityNotFoundException ignored) {
                // Try the next fallback.
            }
        }

        showToast(getString(R.string.notification_settings_unavailable));
    }

    private boolean canHandleIntent(Intent intent) {
        return intent.resolveActivity(getPackageManager()) != null;
    }

    private MediaController selectBestMediaController(List<MediaController> controllers) {
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

    private int scoreMediaController(MediaController controller) {
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

    private String extractNowPlayingTitle(MediaMetadata metadata) {
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

    private String extractNowPlayingCreator(MediaMetadata metadata, String title) {
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

    private String resolveMediaAppLabel(String packageName) {
        if (TextUtils.isEmpty(packageName)) {
            return "";
        }

        try {
            CharSequence label = getPackageManager().getApplicationLabel(
                    getPackageManager().getApplicationInfo(packageName, 0)
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

    private String resolveActiveWatchSpotifyUri() {
        if (!hasNowPlayingAccess()) {
            return "";
        }

        MediaSessionManager mediaSessionManager = getSystemService(MediaSessionManager.class);
        if (mediaSessionManager == null) {
            return "";
        }

        List<MediaController> controllers;
        try {
            controllers = mediaSessionManager.getActiveSessions(
                    new ComponentName(this, SignalShareNotificationListenerService.class)
            );
        } catch (SecurityException exception) {
            return "";
        }

        MediaController controller = selectBestMediaController(controllers);
        if (controller == null) {
            return "";
        }

        String packageName = controller.getPackageName();
        if (TextUtils.isEmpty(packageName) || !packageName.toLowerCase().contains("spotify")) {
            return "";
        }

        return resolveSpotifyOpenUri(controller.getMetadata());
    }

    private String resolveSpotifyOpenUri(MediaMetadata metadata) {
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
            String normalized = normalizeSpotifyOpenUri(candidate);
            if (!TextUtils.isEmpty(normalized)) {
                return normalized;
            }
        }

        return "";
    }

    private String resolveYoutubeOpenUri(MediaMetadata metadata) {
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
            String normalized = normalizeYoutubeOpenUri(candidate);
            if (!TextUtils.isEmpty(normalized)) {
                return normalized;
            }
        }

        return "";
    }

    private String normalizeYoutubeOpenUri(String rawValue) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        if (value.startsWith("vnd.youtube:") || value.startsWith("https://") || value.startsWith("http://")) {
            String youtubeVideoId = extractYoutubeVideoId(value);
            return TextUtils.isEmpty(youtubeVideoId) ? "" : "vnd.youtube:" + youtubeVideoId;
        }

        String videoId = extractYoutubeVideoId(value);
        if (!TextUtils.isEmpty(videoId)) {
            return "vnd.youtube:" + videoId;
        }

        return "";
    }

    private String extractYoutubeVideoId(String rawValue) {
        if (TextUtils.isEmpty(rawValue)) {
            return "";
        }

        String value = rawValue.trim();
        if (value.matches("^[A-Za-z0-9_-]{11}$")) {
            return value;
        }

        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            if (TextUtils.isEmpty(host)) {
                return "";
            }

            host = host.toLowerCase(Locale.US);
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

    private String trimYoutubeVideoId(String value) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }

        String trimmed = value.trim();
        if (trimmed.length() > 11) {
            trimmed = trimmed.substring(0, 11);
        }
        return trimmed;
    }

    private String normalizeSpotifyOpenUri(String rawValue) {
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
                return value;
            }
        } catch (Exception ignored) {
            // Fall through to the empty result.
        }

        return "";
    }

    private String resolvePlaybackStateLabel(PlaybackState playbackState) {
        if (playbackState == null) {
            return getString(R.string.media_state_active);
        }

        switch (playbackState.getState()) {
            case PlaybackState.STATE_PLAYING:
                return getString(R.string.media_state_playing);
            case PlaybackState.STATE_PAUSED:
                return getString(R.string.media_state_paused);
            case PlaybackState.STATE_BUFFERING:
            case PlaybackState.STATE_CONNECTING:
                return getString(R.string.media_state_buffering);
            default:
                return getString(R.string.media_state_active);
        }
    }

    private String buildMediaMeta(String appLabel, String creatorLabel, String stateLabel) {
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

    private void sendMediaAction(int keyCode) {
        boolean usePhoneMediaBridge = !lastNowPlayingSnapshot.phoneUnavailable
                && (lastNowPlayingSnapshot.remoteSource || phoneNowPlayingAvailable);

        if (!lastNowPlayingSnapshot.active) {
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && usePhoneMediaBridge) {
                sendPhoneMediaAction(keyCode);
            } else {
                if (usePhoneMediaBridge) {
                    launchSpotifyOnPhone();
                } else {
                    openSpotifyOnWatch();
                }
            }
            scheduleMediaActionRefreshes();
            return;
        }

        if (usePhoneMediaBridge) {
            sendPhoneMediaAction(keyCode);
        } else {
            dispatchLocalMediaAction(keyCode);
        }
        showToast(getString(R.string.media_action_done));
        scheduleMediaActionRefreshes();
    }

    private void sendPhoneMediaAction(int keyCode) {
        String action = resolvePhoneMediaAction(keyCode);
        if (TextUtils.isEmpty(action)) {
            dispatchLocalMediaAction(keyCode);
            return;
        }

        Wearable.getNodeClient(this).getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    if (nodes == null || nodes.isEmpty()) {
                        phoneNowPlayingAvailable = false;
                        return;
                    }

                    Wearable.getMessageClient(this)
                            .sendMessage(
                                    nodes.get(0).getId(),
                                    PHONE_NOW_PLAYING_ACTION_PATH,
                                    action.getBytes(StandardCharsets.UTF_8)
                            )
                            .addOnFailureListener(exception -> {
                                phoneNowPlayingAvailable = false;
                            });
                })
                .addOnFailureListener(exception -> {
                    phoneNowPlayingAvailable = false;
                });
    }

    private void launchSpotifyOnPhone() {
        Uri appUri = Uri.parse(PHONE_MEDIA_OPEN_DEEP_LINK)
                .buildUpon()
                .appendQueryParameter("package", "com.spotify.music")
                .appendQueryParameter("uri", "spotify:")
                .build();
        openPhoneAppDeepLink(appUri);
    }

    private String resolvePhoneMediaAction(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return PHONE_MEDIA_ACTION_PREVIOUS;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                return PHONE_MEDIA_ACTION_NEXT;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                return PHONE_MEDIA_ACTION_PLAY_PAUSE;
            default:
                return "";
        }
    }

    private void dispatchLocalMediaAction(int keyCode) {
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return;
        }

        long eventTime = System.currentTimeMillis();
        audioManager.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_DOWN, keyCode, 0));
        audioManager.dispatchMediaKeyEvent(new KeyEvent(eventTime, eventTime, KeyEvent.ACTION_UP, keyCode, 0));
    }

    private void scheduleMediaActionRefreshes() {
        mainHandler.removeCallbacks(mediaActionRefreshRunnable);
        refreshNowPlayingState();
        mainHandler.postDelayed(mediaActionRefreshRunnable, MEDIA_ACTION_REFRESH_DELAY_MS);
        mainHandler.postDelayed(mediaActionRefreshRunnable, MEDIA_ACTION_REFRESH_FOLLOW_UP_DELAY_MS);
        mainHandler.postDelayed(mediaActionRefreshRunnable, MEDIA_ACTION_REFRESH_FINAL_DELAY_MS);
    }

    private void updateMediaCardState(String summary, String meta) {
        mediaSummary.setText(summary);
        mediaMeta.setText(meta);
    }

    private SessionState authenticateWithSupabase(String email, String password) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("email", email);
        payload.put("password", password);

        JSONObject response = executeObjectRequest(
                BuildConfig.SUPABASE_URL + "/auth/v1/token?grant_type=password",
                "POST",
                payload,
                null,
                null
        );

        JSONObject user = response.getJSONObject("user");
        return new SessionState(
                response.getString("access_token"),
                user.getString("id"),
                user.optString("email", email),
                response.optString("refresh_token", ""),
                computeSessionExpiry(response)
        );
    }

    private long computeSessionExpiry(JSONObject response) {
        long expiresInSeconds = response.optLong("expires_in", 0L);
        if (expiresInSeconds <= 0L) {
            return 0L;
        }
        return System.currentTimeMillis() + (expiresInSeconds * 1000L);
    }

    private boolean isSessionExpiringSoon(SessionState session) {
        return session != null
                && session.accessTokenExpiresAtMs > 0L
                && System.currentTimeMillis() >= (session.accessTokenExpiresAtMs - SESSION_REFRESH_SKEW_MS);
    }

    private SessionState getAuthorizedSession(String accessToken) throws Exception {
        if (sessionState == null || TextUtils.isEmpty(accessToken) || !accessToken.equals(sessionState.accessToken)) {
            return null;
        }

        if (isSessionExpiringSoon(sessionState)) {
            return refreshSupabaseSession(sessionState);
        }

        return sessionState;
    }

    private SessionState refreshSupabaseSession(SessionState currentSession) throws Exception {
        if (currentSession == null || TextUtils.isEmpty(currentSession.refreshToken)) {
            throw new IllegalStateException(getString(R.string.messages_session_expired));
        }

        JSONObject payload = new JSONObject();
        payload.put("refresh_token", currentSession.refreshToken);

        JSONObject response = executeObjectRequest(
                BuildConfig.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
                "POST",
                payload,
                null,
                null
        );

        JSONObject user = response.getJSONObject("user");
        SessionState refreshedSession = new SessionState(
                response.getString("access_token"),
                user.getString("id"),
                user.optString("email", currentSession.email),
                response.optString("refresh_token", currentSession.refreshToken),
                computeSessionExpiry(response)
        );
        persistSession(refreshedSession);
        return refreshedSession;
    }

    private List<FeedPost> fetchRecentFeedPosts() throws Exception {
        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/posts")
                .buildUpon()
                .appendQueryParameter("select", "id,author_id,title,creator,caption,media_kind,source_kind,media_url,external_url,external_id,likes,created_at")
                .appendQueryParameter("order", "created_at.desc")
                .appendQueryParameter("limit", "20")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), null);
        List<FeedPost> posts = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            posts.add(parseFeedPost(array.getJSONObject(i)));
        }
        return posts;
    }

    private FeedPost fetchLatestUserFeedPost(SessionState activeSession) throws Exception {
        if (activeSession == null || TextUtils.isEmpty(activeSession.userId)) {
            return null;
        }

        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/posts")
                .buildUpon()
                .appendQueryParameter("select", "id,author_id,title,creator,caption,media_kind,source_kind,media_url,external_url,external_id,likes,created_at")
                .appendQueryParameter("author_id", "eq." + activeSession.userId)
                .appendQueryParameter("order", "created_at.desc")
                .appendQueryParameter("limit", "1")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), activeSession.accessToken);
        if (array.length() == 0) {
            return null;
        }

        return parseFeedPost(array.getJSONObject(0));
    }

    private FeedPost parseFeedPost(JSONObject row) {
        return new FeedPost(
                row.optString("id"),
                row.optString("author_id"),
                row.optString("title"),
                row.optString("creator"),
                row.optString("caption"),
                row.optString("media_kind"),
                row.optString("source_kind"),
                row.optString("media_url"),
                row.optString("external_url"),
                row.optString("external_id"),
                row.optInt("likes", 0)
        );
    }

    private FeedPost findSpotlightPost(List<FeedPost> posts) {
        if (posts.isEmpty()) return null;
        FeedPost best = posts.get(0);
        for (FeedPost post : posts) {
            if (post.likes > best.likes) {
                best = post;
            }
        }
        return best;
    }

    private Map<String, ProfileRecord> fetchProfiles() throws Exception {
        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/profiles")
                .buildUpon()
                .appendQueryParameter("select", "id,display_name,email")
                .appendQueryParameter("order", "display_name.asc")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), sessionState != null ? sessionState.accessToken : null);
        Map<String, ProfileRecord> profiles = new HashMap<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject row = array.getJSONObject(index);
            String id = row.optString("id");
            if (!TextUtils.isEmpty(id)) {
                profiles.put(id, new ProfileRecord(
                        id,
                        row.optString("display_name"),
                        row.optString("email")
                ));
            }
        }
        return profiles;
    }

    private List<ThreadRecord> fetchThreads() throws Exception {
        String filterValue = String.format(Locale.US, "(user_one_id.eq.%s,user_two_id.eq.%s)", sessionState.userId, sessionState.userId);
        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/direct_threads")
                .buildUpon()
                .appendQueryParameter("select", "id,user_one_id,user_two_id,updated_at")
                .appendQueryParameter("or", filterValue)
                .appendQueryParameter("order", "updated_at.desc")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), sessionState.accessToken);
        List<ThreadRecord> result = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject row = array.getJSONObject(index);
            result.add(new ThreadRecord(
                    row.optString("id"),
                    row.optString("user_one_id"),
                    row.optString("user_two_id"),
                    row.optString("updated_at")
            ));
        }
        return result;
    }

    private Map<String, Integer> fetchUnreadMessageCounts(
            List<ThreadRecord> threads,
            SessionState activeSession
    ) throws Exception {
        Map<String, Integer> counts = new HashMap<>();
        if (threads == null || threads.isEmpty() || activeSession == null || TextUtils.isEmpty(activeSession.userId)) {
            return counts;
        }

        for (ThreadRecord thread : threads) {
            if (thread == null || TextUtils.isEmpty(thread.id)) {
                continue;
            }

            Uri.Builder builder = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/messages")
                    .buildUpon()
                    .appendQueryParameter("select", "id")
                    .appendQueryParameter("thread_id", "eq." + thread.id)
                    .appendQueryParameter("sender_id", "neq." + activeSession.userId)
                    .appendQueryParameter("limit", "1000");

            String readAt = sharedPreferences != null
                    ? sharedPreferences.getString(getThreadReadAtPreferenceKey(activeSession.userId, thread.id), "")
                    : "";
            if (!TextUtils.isEmpty(readAt)) {
                builder.appendQueryParameter("created_at", "gt." + readAt);
            }

            JSONArray array = executeArrayRequest(builder.build().toString(), activeSession.accessToken);
            counts.put(thread.id, array.length());
        }

        return counts;
    }

    private String getThreadReadAtPreferenceKey(String userId, String threadId) {
        return PREF_THREAD_READ_AT_PREFIX + userId + "_" + threadId;
    }

    private List<MessageRecord> fetchMessages(String threadId) throws Exception {
        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/messages")
                .buildUpon()
                .appendQueryParameter("select", "id,thread_id,sender_id,body,created_at")
                .appendQueryParameter("thread_id", "eq." + threadId)
                .appendQueryParameter("order", "created_at.desc")
                .appendQueryParameter("limit", "20")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), sessionState.accessToken);
        List<MessageRecord> result = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject row = array.getJSONObject(index);
            result.add(new MessageRecord(
                    row.optString("id"),
                    row.optString("thread_id"),
                    row.optString("sender_id"),
                    row.optString("body"),
                    row.optString("created_at")
            ));
        }
        Collections.reverse(result);
        return result;
    }

    private MessageRecord fetchLatestMessage(String threadId) throws Exception {
        Uri uri = Uri.parse(BuildConfig.SUPABASE_URL + "/rest/v1/messages")
                .buildUpon()
                .appendQueryParameter("select", "id,thread_id,sender_id,body,created_at")
                .appendQueryParameter("thread_id", "eq." + threadId)
                .appendQueryParameter("order", "created_at.desc")
                .appendQueryParameter("limit", "1")
                .build();

        JSONArray array = executeArrayRequest(uri.toString(), sessionState.accessToken);
        if (array.length() == 0) {
            return null;
        }

        JSONObject row = array.getJSONObject(0);
        return new MessageRecord(
                row.optString("id"),
                row.optString("thread_id"),
                row.optString("sender_id"),
                row.optString("body"),
                row.optString("created_at")
        );
    }

    private void postMessage(String threadId, String body) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("thread_id", threadId);
        payload.put("sender_id", sessionState.userId);
        payload.put("body", body);

        executeRequest(
                BuildConfig.SUPABASE_URL + "/rest/v1/messages",
                "POST",
                payload,
                sessionState.accessToken,
                "return=minimal"
        );
    }

    private JSONArray executeArrayRequest(String url, String accessToken) throws Exception {
        return new JSONArray(executeRequest(url, "GET", null, accessToken, null));
    }

    private JSONObject executeObjectRequest(
            String url,
            String method,
            JSONObject body,
            String accessToken,
            String preferHeader
    ) throws Exception {
        return new JSONObject(executeRequest(url, method, body, accessToken, preferHeader));
    }

    private String executeRequest(
            String urlString,
            String method,
            JSONObject body,
            String accessToken,
            String preferHeader
    ) throws Exception {
        return executeRequest(urlString, method, body, accessToken, preferHeader, true);
    }

    private String executeRequest(
            String urlString,
            String method,
            JSONObject body,
            String accessToken,
            String preferHeader,
            boolean allowRetryOnAuthFailure
    ) throws Exception {
        SessionState authorizedSession = getAuthorizedSession(accessToken);
        String requestAccessToken = authorizedSession != null ? authorizedSession.accessToken : accessToken;
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
        connection.setRequestProperty(
                "Authorization",
                "Bearer " + (TextUtils.isEmpty(requestAccessToken) ? BuildConfig.SUPABASE_ANON_KEY : requestAccessToken)
        );

        if (!TextUtils.isEmpty(preferHeader)) {
            connection.setRequestProperty("Prefer", preferHeader);
        }

        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            OutputStream outputStream = connection.getOutputStream();
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
            writer.write(body.toString());
            writer.flush();
            writer.close();
            outputStream.close();
        }

        int statusCode = connection.getResponseCode();
        InputStream stream = statusCode >= 200 && statusCode < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
        String response = readStream(stream);
        connection.disconnect();

        if (statusCode >= 200 && statusCode < 300) {
            return response;
        }

        if (allowRetryOnAuthFailure
                && isAuthenticationFailure(statusCode, response)
                && sessionState != null
                && !TextUtils.isEmpty(requestAccessToken)
                && requestAccessToken.equals(sessionState.accessToken)
                && !TextUtils.isEmpty(sessionState.refreshToken)) {
            SessionState refreshedSession = refreshSupabaseSession(sessionState);
            return executeRequest(urlString, method, body, refreshedSession.accessToken, preferHeader, false);
        }

        throw new HttpResponseException(statusCode, response);
    }

    private String readStream(InputStream stream) throws Exception {
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

    private Bitmap downloadBitmap(String urlString) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.connect();
            InputStream stream = new BufferedInputStream(connection.getInputStream());
            Bitmap bitmap = BitmapFactory.decodeStream(stream);
            stream.close();
            connection.disconnect();
            return bitmap;
        } catch (Exception ignored) {
            return null;
        }
    }

    private void persistSession(SessionState session) {
        sharedPreferences.edit()
                .putString(PREF_ACCESS_TOKEN, session.accessToken)
                .putString(PREF_REFRESH_TOKEN, session.refreshToken)
                .putLong(PREF_ACCESS_TOKEN_EXPIRES_AT, session.accessTokenExpiresAtMs)
                .putString(PREF_USER_ID, session.userId)
                .putString(PREF_USER_EMAIL, session.email)
                .apply();
        sessionState = session;
        WatchPushManager.ensureInitialized(this);
    }

    private void saveSession(SessionState session) {
        persistSession(session);
        watchEmailInput.setText(session.email);
        watchPasswordInput.setText("");
    }

    private void restoreSession() {
        String accessToken = sharedPreferences.getString(PREF_ACCESS_TOKEN, "");
        String refreshToken = sharedPreferences.getString(PREF_REFRESH_TOKEN, "");
        long accessTokenExpiresAtMs = sharedPreferences.getLong(PREF_ACCESS_TOKEN_EXPIRES_AT, 0L);
        String userId = sharedPreferences.getString(PREF_USER_ID, "");
        String email = sharedPreferences.getString(PREF_USER_EMAIL, "");
        if (!TextUtils.isEmpty(accessToken) && !TextUtils.isEmpty(userId)) {
            sessionState = new SessionState(accessToken, userId, email, refreshToken, accessTokenExpiresAtMs);
            watchEmailInput.setText(email);
            WatchPushManager.ensureInitialized(this);
        }
    }

    private void clearSession() {
        String previousAccessToken = sessionState != null ? sessionState.accessToken : sharedPreferences.getString(PREF_ACCESS_TOKEN, "");
        WatchPushManager.unregisterPushSubscription(this, previousAccessToken);
        sharedPreferences.edit().clear().apply();
        sessionState = null;
        latestUserPost = null;
        lastInboxTopThreadSignature = "";
        watchPasswordInput.setText("");
        watchMessageInput.setText("");
    }

    private boolean isAuthenticationFailure(Exception exception) {
        if (exception instanceof HttpResponseException) {
            HttpResponseException responseException = (HttpResponseException) exception;
            return isAuthenticationFailure(responseException.statusCode, responseException.responseBody);
        }

        String message = exception.getMessage();
        if (TextUtils.isEmpty(message)) {
            return false;
        }

        String normalized = message.toLowerCase(Locale.US);
        return normalized.contains("jwt")
                || normalized.contains("token")
                || normalized.contains("session")
                || normalized.contains("auth");
    }

    private boolean isAuthenticationFailure(int statusCode, String responseBody) {
        if (statusCode == 401 || statusCode == 403) {
            return true;
        }

        if (TextUtils.isEmpty(responseBody)) {
            return false;
        }

        String normalized = responseBody.toLowerCase(Locale.US);
        return normalized.contains("jwt")
                || normalized.contains("token")
                || normalized.contains("session")
                || normalized.contains("auth");
    }

    private void handleExpiredWatchSession() {
        clearSession();
        renderSignedOutState();
        messagesPanelMeta.setText(R.string.messages_session_expired);
        messagesConversationPreview.setVisibility(View.VISIBLE);
        messagesConversationPreview.setText(R.string.messages_session_expired);
        showToast(getString(R.string.messages_session_expired));
    }

    private ThreadRecord findThread(String threadId) {
        for (ThreadRecord thread : threadRecords) {
            if (thread.id.equals(threadId)) {
                return thread;
            }
        }
        return null;
    }

    private Map<String, String> snapshotThreadUpdates() {
        Map<String, String> snapshot = new HashMap<>();
        for (ThreadRecord thread : threadRecords) {
            snapshot.put(thread.id, thread.updatedAt);
        }
        return snapshot;
    }

    private Map<String, MessageRecord> fetchLatestMessagesForChangedThreads(
            List<ThreadRecord> threads,
            Map<String, String> previousThreadUpdates
    ) throws Exception {
        if (previousThreadUpdates.isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, MessageRecord> changedThreadMessages = new HashMap<>();
        for (ThreadRecord thread : threads) {
            String previousUpdatedAt = previousThreadUpdates.get(thread.id);
            if (previousThreadUpdates.containsKey(thread.id)
                    && TextUtils.equals(previousUpdatedAt, thread.updatedAt)) {
                continue;
            }

            MessageRecord latestMessage = fetchLatestMessage(thread.id);
            if (latestMessage != null) {
                changedThreadMessages.put(thread.id, latestMessage);
            }
        }
        return changedThreadMessages;
    }

    private String getThreadLabel(ThreadRecord thread) {
        if (thread == null) {
            return getString(R.string.messages_thread_prefix);
        }
        return getThreadPartnerName(thread);
    }

    private String getThreadPartnerName(ThreadRecord thread) {
        if (thread == null || sessionState == null) {
            return getString(R.string.messages_thread_prefix);
        }

        String partnerId = sessionState.userId.equals(thread.userOneId) ? thread.userTwoId : thread.userOneId;
        ProfileRecord profile = profilesById.get(partnerId);
        if (profile != null) {
            String resolvedDisplayName = resolveWatchDisplayName(profile.displayName, profile.email);
            if (!TextUtils.isEmpty(resolvedDisplayName)) {
                return resolvedDisplayName;
            }
            if (!TextUtils.isEmpty(profile.email)) {
                return prettifyEmailName(profile.email);
            }
        }
        return getString(R.string.messages_thread_prefix);
    }

    private String resolveWatchDisplayName(String displayName, String email) {
        if (!TextUtils.isEmpty(displayName)) {
            String trimmedDisplayName = displayName.trim();
            if (!TextUtils.isEmpty(trimmedDisplayName) && !trimmedDisplayName.contains("@")) {
                return trimmedDisplayName;
            }
        }
        return prettifyEmailName(email);
    }

    private String prettifyEmailName(String email) {
        if (TextUtils.isEmpty(email)) {
            return "";
        }

        String[] parts = email.trim().split("@", 2);
        String localPart = parts.length > 0 ? parts[0] : "";
        if (TextUtils.isEmpty(localPart)) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        for (String token : localPart.replaceAll("[._-]+", " ").trim().split("\\s+")) {
            if (TextUtils.isEmpty(token)) {
                continue;
            }
            if (builder.length() > 0) {
                builder.append(' ');
            }
            builder.append(Character.toUpperCase(token.charAt(0)));
            if (token.length() > 1) {
                builder.append(token.substring(1));
            }
        }

        return builder.toString().trim();
    }

    private void notifyForIncomingMessages(Map<String, MessageRecord> changedThreadMessages) {
        for (MessageRecord message : changedThreadMessages.values()) {
            notifyForIncomingMessage(message);
        }
    }

    private void notifyForIncomingMessage(MessageRecord message) {
        if (sessionState == null || message == null || TextUtils.isEmpty(message.id)) {
            return;
        }

        if (TextUtils.equals(sessionState.userId, message.senderId)) {
            return;
        }

        WatchPushManager.showIncomingMessageNotification(
                this,
                "New message",
                "",
                message.threadId,
                message.id
        );
    }

    private MessageRecord getLatestMessage(List<MessageRecord> messages) {
        if (messages == null || messages.isEmpty()) {
            return null;
        }

        return messages.get(messages.size() - 1);
    }

    private String uppercase(String value) {
        return TextUtils.isEmpty(value) ? "MEDIA" : value.toUpperCase(Locale.US);
    }

    private String excerpt(String value) {
        return excerpt(value, 44);
    }

    private String excerpt(String value, int maxLength) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }
        String normalized = value.replace('\n', ' ').trim();
        if (normalized.length() <= maxLength) {
            return normalized;
        }
        return normalized.substring(0, maxLength - 3) + "...";
    }

    private void showToast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private int dp(float value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private enum ThemeOption {
        MIDNIGHT(
                "Midnight",
                "#081017",
                "#111C25",
                "#0C151D",
                "#111A24",
                "#223748",
                "#69C9FF",
                "#33C39C",
                "#131D27",
                "#294050",
                "#0B141C",
                "#294050",
                "#89D8FF",
                "#FFFFFF",
                "#C2CFD9",
                "#FFFFFF",
                "#7D93A5",
                "#1B3040",
                "#234558",
                "#4D7E98",
                "#4D7E98"
        ),
        TIDE(
                "Tide",
                "#F7F0E6",
                "#E5D0B8",
                "#FFFFFF",
                "#FFFFFF",
                "#D4B89A",
                "#E0BC94",
                "#C9915F",
                "#F3E4D2",
                "#D0B394",
                "#FFFFFF",
                "#D0B394",
                "#A87649",
                "#000000",
                "#444444",
                "#000000",
                "#777777",
                "#FFF6EA",
                "#E8D5C0",
                "#C9A47B",
                "#C9A47B"
        ),
        EMBER(
                "Ember",
                "#110B0B",
                "#221316",
                "#1C1214",
                "#26181A",
                "#5B3538",
                "#F0A24A",
                "#D76A4A",
                "#221517",
                "#5B3538",
                "#160F11",
                "#5B3538",
                "#F0B36A",
                "#FFFFFF",
                "#D1BBB8",
                "#FFFFFF",
                "#9E7A74",
                "#2A1612",
                "#40211C",
                "#6E4038",
                "#8A5446"
        ),
        GLACIER(
                "Glacier",
                "#EAF6FF",
                "#C8E6F7",
                "#FFFFFF",
                "#F4FBFF",
                "#9CC6DE",
                "#7CC6EC",
                "#4B96D1",
                "#E6F4FC",
                "#9CC6DE",
                "#FFFFFF",
                "#9CC6DE",
                "#2F82B2",
                "#0E2433",
                "#4B6475",
                "#0E2433",
                "#7B98AA",
                "#FFFFFF",
                "#DCEFFB",
                "#98C8E6",
                "#98C8E6"
        ),
        GROVE(
                "Grove",
                "#0E1710",
                "#1A2B1E",
                "#132017",
                "#1D2F22",
                "#3F6A4A",
                "#89C66B",
                "#4F9A78",
                "#18251B",
                "#3F6A4A",
                "#101A12",
                "#3F6A4A",
                "#9FE18A",
                "#F7FFF4",
                "#C9D9C6",
                "#F7FFF4",
                "#91A58F",
                "#1A2B17",
                "#254228",
                "#4E7B52",
                "#4E7B52"
        ),
        SOLAR(
                "Solar",
                "#1B1407",
                "#34240D",
                "#241908",
                "#3B2810",
                "#8A5A1F",
                "#F2B84B",
                "#E58934",
                "#2B1E0C",
                "#8A5A1F",
                "#201607",
                "#8A5A1F",
                "#FFD07C",
                "#FFF8E8",
                "#E2C99D",
                "#FFF8E8",
                "#B3945C",
                "#36230B",
                "#5A3810",
                "#A96D20",
                "#A96D20"
        );

        final String label;
        final String backgroundStart;
        final String backgroundEnd;
        final String cardStart;
        final String cardEnd;
        final String cardStroke;
        final String primaryStart;
        final String primaryEnd;
        final String secondaryFill;
        final String secondaryStroke;
        final String inputFill;
        final String inputStroke;
        final String accentColor;
        final String textPrimary;
        final String textSecondary;
        final String buttonTextColor;
        final String hintColor;
        final String badgeTextColor;
        final String badgeStart;
        final String badgeEnd;
        final String badgeStroke;

        ThemeOption(
                String label,
                String backgroundStart,
                String backgroundEnd,
                String cardStart,
                String cardEnd,
                String cardStroke,
                String primaryStart,
                String primaryEnd,
                String secondaryFill,
                String secondaryStroke,
                String inputFill,
                String inputStroke,
                String accentColor,
                String textPrimary,
                String textSecondary,
                String buttonTextColor,
                String hintColor,
                String badgeTextColor,
                String badgeStart,
                String badgeEnd,
                String badgeStroke
        ) {
            this.label = label;
            this.backgroundStart = backgroundStart;
            this.backgroundEnd = backgroundEnd;
            this.cardStart = cardStart;
            this.cardEnd = cardEnd;
            this.cardStroke = cardStroke;
            this.primaryStart = primaryStart;
            this.primaryEnd = primaryEnd;
            this.secondaryFill = secondaryFill;
            this.secondaryStroke = secondaryStroke;
            this.inputFill = inputFill;
            this.inputStroke = inputStroke;
            this.accentColor = accentColor;
            this.textPrimary = textPrimary;
            this.textSecondary = textSecondary;
            this.buttonTextColor = buttonTextColor;
            this.hintColor = hintColor;
            this.badgeTextColor = badgeTextColor;
            this.badgeStart = badgeStart;
            this.badgeEnd = badgeEnd;
            this.badgeStroke = badgeStroke;
        }
    }

    private enum Section {
        FEED,
        MESSAGES,
        MEDIA,
        SETTINGS
    }

    private static final class SessionState {
        final String accessToken;
        final String userId;
        final String email;
        final String refreshToken;
        final long accessTokenExpiresAtMs;

        SessionState(String accessToken, String userId, String email, String refreshToken, long accessTokenExpiresAtMs) {
            this.accessToken = accessToken;
            this.userId = userId;
            this.email = email;
            this.refreshToken = refreshToken;
            this.accessTokenExpiresAtMs = accessTokenExpiresAtMs;
        }
    }

    private static final class HttpResponseException extends Exception {
        final int statusCode;
        final String responseBody;

        HttpResponseException(int statusCode, String responseBody) {
            super(TextUtils.isEmpty(responseBody) ? ("HTTP " + statusCode) : responseBody);
            this.statusCode = statusCode;
            this.responseBody = responseBody;
        }
    }

    private void toggleWatchNotifications() {
        boolean current = WatchPushManager.isWatchNotificationsEnabled(this);
        WatchPushManager.setWatchNotificationsEnabled(this, !current);
        updateWatchNotificationsButtonUI();
        showToast(getString(!current ? R.string.watch_notifications_toggle_on : R.string.watch_notifications_toggle_off));
    }

    private void updateWatchNotificationsButtonUI() {
        if (toggleWatchNotificationsButton == null) return;
        boolean enabled = WatchPushManager.isWatchNotificationsEnabled(this);
        toggleWatchNotificationsButton.setText(enabled ? R.string.watch_notifications_toggle_on : R.string.watch_notifications_toggle_off);
        styleButton(toggleWatchNotificationsButton, enabled, currentTheme);
    }

    private static final class FeedPost {
        final String id;
        final String authorId;
        final String title;
        final String creator;
        final String caption;
        final String mediaKind;
        final String sourceKind;
        final String mediaUrl;
        final String externalUrl;
        final String externalId;
        final int likes;

        FeedPost(
                String id,
                String authorId,
                String title,
                String creator,
                String caption,
                String mediaKind,
                String sourceKind,
                String mediaUrl,
                String externalUrl,
                String externalId,
                int likes
        ) {
            this.id = id;
            this.authorId = authorId;
            this.title = title;
            this.creator = creator;
            this.caption = caption;
            this.mediaKind = mediaKind;
            this.sourceKind = sourceKind;
            this.mediaUrl = mediaUrl;
            this.externalUrl = externalUrl;
            this.externalId = externalId;
            this.likes = likes;
        }

        String captionOrFallback() {
            return TextUtils.isEmpty(caption) ? title : caption;
        }

        boolean hasImage() {
            return !previewImageUrls().isEmpty();
        }

        List<String> previewImageUrls() {
            List<String> urls = new ArrayList<>();

            if (("image".equals(mediaKind) || "video".equals(mediaKind)) && !TextUtils.isEmpty(mediaUrl)) {
                urls.add(mediaUrl);
            }

            if ("youtube".equals(sourceKind)) {
                String videoId = resolveYoutubeVideoId();
                if (!TextUtils.isEmpty(videoId)) {
                    urls.add("https://i.ytimg.com/vi/" + videoId + "/maxresdefault.jpg");
                    urls.add("https://i.ytimg.com/vi/" + videoId + "/sddefault.jpg");
                    urls.add("https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg");
                    urls.add("https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg");
                }
            }

            return urls;
        }

        private String resolveYoutubeVideoId() {
            if (!TextUtils.isEmpty(externalId)) {
                return externalId;
            }

            String parsedExternalUrlId = parseYoutubeVideoIdFromUrl(externalUrl);
            if (!TextUtils.isEmpty(parsedExternalUrlId)) {
                return parsedExternalUrlId;
            }

            return parseYoutubeVideoIdFromUrl(mediaUrl);
        }

        String handoffUrl() {
            if (!TextUtils.isEmpty(externalUrl)) {
                return externalUrl;
            }
            if (!TextUtils.isEmpty(mediaUrl)) {
                return mediaUrl;
            }
            return "";
        }

        private String parseYoutubeVideoIdFromUrl(String rawUrl) {
            if (TextUtils.isEmpty(rawUrl)) {
                return "";
            }

            try {
                Uri uri = Uri.parse(rawUrl);
                String host = uri.getHost();
                if (TextUtils.isEmpty(host)) {
                    return "";
                }

                host = host.toLowerCase(Locale.US);
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

        private String trimYoutubeVideoId(String value) {
            if (TextUtils.isEmpty(value)) {
                return "";
            }

            String trimmed = value.trim();
            if (trimmed.length() > 11) {
                trimmed = trimmed.substring(0, 11);
            }
            return trimmed;
        }
    }

    private static final class ProfileRecord {
        final String id;
        final String displayName;
        final String email;

        ProfileRecord(String id, String displayName, String email) {
            this.id = id;
            this.displayName = displayName;
            this.email = email;
        }
    }

    private static final class ThreadRecord {
        final String id;
        final String userOneId;
        final String userTwoId;
        final String updatedAt;

        ThreadRecord(String id, String userOneId, String userTwoId, String updatedAt) {
            this.id = id;
            this.userOneId = userOneId;
            this.userTwoId = userTwoId;
            this.updatedAt = updatedAt;
        }
    }

    private static final class MessageRecord {
        final String id;
        final String threadId;
        final String senderId;
        final String body;
        final String createdAt;

        MessageRecord(String id, String threadId, String senderId, String body, String createdAt) {
            this.id = id;
            this.threadId = threadId;
            this.senderId = senderId;
            this.body = body;
            this.createdAt = createdAt;
        }
    }

    private static final class NowPlayingSnapshot {
        final String title;
        final String meta;
        final String appPackage;
        final String openUri;
        final boolean active;
        final boolean permissionRequired;
        final boolean remoteSource;
        final boolean phoneUnavailable;

        private NowPlayingSnapshot(String title, String meta, String appPackage, String openUri, boolean active, boolean permissionRequired, boolean remoteSource, boolean phoneUnavailable) {
            this.title = title;
            this.meta = meta;
            this.appPackage = appPackage;
            this.openUri = openUri;
            this.active = active;
            this.permissionRequired = permissionRequired;
            this.remoteSource = remoteSource;
            this.phoneUnavailable = phoneUnavailable;
        }

        static NowPlayingSnapshot active(String title, String meta, boolean remoteSource, String appPackage, String openUri) {
            return new NowPlayingSnapshot(title, meta, appPackage, openUri, true, false, remoteSource, false);
        }

        static NowPlayingSnapshot idle(boolean remoteSource, String appPackage, String openUri) {
            return new NowPlayingSnapshot("", "", appPackage, openUri, false, false, remoteSource, false);
        }

        static NowPlayingSnapshot permissionRequired(boolean remoteSource) {
            return new NowPlayingSnapshot("", "", "", "", false, true, remoteSource, false);
        }

        static NowPlayingSnapshot phoneUnavailable() {
            return new NowPlayingSnapshot("", "", "", "", false, false, true, true);
        }
    }
}
