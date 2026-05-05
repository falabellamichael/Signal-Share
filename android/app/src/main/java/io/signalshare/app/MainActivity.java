package io.signalshare.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 1001;
    private SwipeRefreshLayout swipeRefreshLayout;
    private boolean isRefreshEnabled = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        createNotificationChannel();

        // Set up pull-to-refresh by wrapping the Capacitor WebView
        mainHandler.postDelayed(() -> {
            if (getBridge() == null) return;
            WebView webView = getBridge().getWebView();
            if (webView == null) return;

            // Add Javascript interface to control native refresh
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void setPullToRefreshEnabled(boolean enabled) {
                    mainHandler.post(() -> {
                        isRefreshEnabled = enabled;
                        if (swipeRefreshLayout != null) {
                            swipeRefreshLayout.setEnabled(enabled);
                        }
                    });
                }
            }, "NativeBridge");

            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent instanceof SwipeRefreshLayout) {
                swipeRefreshLayout = (SwipeRefreshLayout) parent;
            } else if (parent != null) {
                swipeRefreshLayout = new SwipeRefreshLayout(MainActivity.this);
                swipeRefreshLayout.setLayoutParams(new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                ));

                int index = parent.indexOfChild(webView);
                parent.removeView(webView);
                
                swipeRefreshLayout.addView(webView, new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                ));
                
                parent.addView(swipeRefreshLayout, index);
            }

            if (swipeRefreshLayout != null) {
                // Initial state should respect what JS might have already requested
                swipeRefreshLayout.setEnabled(isRefreshEnabled);
                swipeRefreshLayout.setOnChildScrollUpCallback((refreshLayout, child) -> {
                    // When JS marks an overlay as active, keep SwipeRefreshLayout from
                    // intercepting overlay scroll gestures as page-level pull-to-refresh.
                    if (!isRefreshEnabled) return true;
                    return webView.canScrollVertically(-1);
                });

                swipeRefreshLayout.setOnRefreshListener(() -> {
                    // Safety check: if JS has requested disabled, don't refresh
                    if (!isRefreshEnabled) {
                        swipeRefreshLayout.setRefreshing(false);
                        return;
                    }
                    webView.reload();
                    swipeRefreshLayout.postDelayed(() -> swipeRefreshLayout.setRefreshing(false), 1200);
                });
            }

            webView.evaluateJavascript(
                    "window.dispatchEvent(new Event('signal:nativeBridgeReady'));",
                    null
            );
        }, 100);

        PhoneNowPlayingHelper.pushSnapshotToConnectedNodes(this);
        requestNotificationPermission();
        handleIntent(getIntent());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel channel = new android.app.NotificationChannel(
                    "messages_alerts",
                    "Messages",
                    android.app.NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Direct Messenger alerts");
            android.app.NotificationManager notificationManager = getSystemService(android.app.NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(this, new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST_CODE);
            }
        }
    }

    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                // Permission granted, re-sync push notifications in JS
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript("if (typeof safelyEnsurePushNotificationRegistration === 'function') safelyEnsurePushNotificationRegistration({ prompt: false });", null);
                }
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PhoneNowPlayingHelper.pushSnapshotToConnectedNodes(this);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        Uri data = intent.getData();
        if (data == null) {
            return;
        }

        if (!"signalshare".equals(data.getScheme())) {
            return;
        }

        String host = data.getHost();
        if ("media-access".equals(host)) {
            openNowPlayingAccessSettings();
            return;
        }

        if ("open-media".equals(host)) {
            openNowPlayingMediaApp(
                    data.getQueryParameter("package"),
                    data.getQueryParameter("uri"),
                    data.getBooleanQueryParameter("explicit", false)
            );
        }
    }

    private void openNowPlayingAccessSettings() {
        for (Intent settingsIntent : PhoneNowPlayingHelper.buildNotificationAccessIntents(this)) {
            if (settingsIntent.resolveActivity(getPackageManager()) == null) {
                continue;
            }

            try {
                startActivity(settingsIntent);
                return;
            } catch (Exception ignored) {
                // Try the next fallback.
            }
        }
    }

    private void openNowPlayingMediaApp(String preferredPackageName, String preferredUri, boolean explicit) {
        if (explicit) {
            PhoneNowPlayingHelper.openExplicitMediaUri(this, preferredPackageName, preferredUri);
            return;
        }

        PhoneNowPlayingHelper.openActiveOrLastMediaApp(this, preferredPackageName, preferredUri);
    }
}
