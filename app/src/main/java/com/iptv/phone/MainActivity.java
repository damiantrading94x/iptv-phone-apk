package com.iptv.phone;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.GestureDetector;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.MediaController;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

public class MainActivity extends Activity implements SurfaceHolder.Callback {

    private WebView webView;
    private SurfaceView surfaceView;
    private ExoPlayer player;
    private MediaController mediaController;
    private GestureDetector gestureDetector;
    private String pendingUrl;
    private String currentUrl;
    private int retryCount = 0;
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 1500;
    private final Handler watchdog = new Handler(Looper.getMainLooper());
    private static final long FREEZE_TIMEOUT_MS = 30000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen, edge-to-edge
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Immersive mode for phone
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        // FrameLayout: WebView behind, SurfaceView on top
        FrameLayout frame = new FrameLayout(this);

        webView = new WebView(this);
        frame.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        surfaceView = new SurfaceView(this);
        surfaceView.setVisibility(View.GONE);
        surfaceView.getHolder().addCallback(this);

        mediaController = new MediaController(this);
        mediaController.setAnchorView(surfaceView);
        mediaController.setMediaPlayer(new MediaController.MediaPlayerControl() {
            @Override public void start() {
                if (player != null) {
                    try { player.play(); } catch (Exception ignored) {}
                }
            }
            @Override public void pause() {
                if (player != null) {
                    try { player.pause(); } catch (Exception ignored) {}
                }
            }
            @Override public int getDuration() {
                if (player == null) return 0;
                try { return (int) player.getDuration(); } catch (Exception e) { return 0; }
            }
            @Override public int getCurrentPosition() {
                if (player == null) return 0;
                try { return (int) player.getCurrentPosition(); } catch (Exception e) { return 0; }
            }
            @Override public void seekTo(int pos) {
                if (player != null) {
                    try { player.seekTo(pos); } catch (Exception ignored) {}
                }
            }
            @Override public boolean isPlaying() {
                if (player == null) return false;
                try { return player.isPlaying(); } catch (Exception e) { return false; }
            }
            @Override public int getBufferPercentage() {
                if (player == null) return 0;
                try { return player.getBufferedPercentage(); } catch (Exception e) { return 0; }
            }
            @Override public boolean canPause() { return true; }
            @Override public boolean canSeekBackward() { return true; }
            @Override public boolean canSeekForward() { return true; }
            @Override public int getAudioSessionId() { return 0; }
        });

        gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                if (mediaController.isShowing()) {
                    mediaController.hide();
                } else {
                    mediaController.show(3000);
                }
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                if (surfaceView.getVisibility() == View.VISIBLE) {
                    stopNativePlayback();
                    surfaceView.setVisibility(View.GONE);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    webView.evaluateJavascript("if(window._onNativeBack) window._onNativeBack()", null);
                }
                return true;
            }
        });

        surfaceView.setOnTouchListener((v, event) -> {
            gestureDetector.onTouchEvent(event);
            return true;
        });

        frame.addView(surfaceView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(frame);

        // Configure WebView
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        try {
            ws.setAllowUniversalAccessFromFileURLs(true);
            ws.setAllowFileAccessFromFileURLs(true);
        } catch (Exception ignored) {}
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // JS interface for native video playback
        webView.addJavascriptInterface(new NativePlayer(), "NativePlayer");

        webView.loadUrl("file:///android_asset/web/index.html");
    }

    /** Called from JavaScript to play a stream URL natively */
    public class NativePlayer {
        @JavascriptInterface
        public void play(final String url) {
            runOnUiThread(() -> startNativePlayback(url));
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> stopNativePlayback());
        }

        @JavascriptInterface
        public void show() {
            runOnUiThread(() -> {
                surfaceView.setVisibility(View.VISIBLE);
                // Lock to landscape during playback
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            });
        }

        @JavascriptInterface
        public void hide() {
            runOnUiThread(() -> {
                surfaceView.setVisibility(View.GONE);
                // Unlock rotation when browsing
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            });
        }
    }

    private void startNativePlayback(String url) {
        stopNativePlayback();
        currentUrl = url;
        surfaceView.setVisibility(View.VISIBLE);

        if (surfaceView.getHolder().getSurface().isValid()) {
            doPlay(url);
        } else {
            pendingUrl = url;
        }
    }

    private void doPlay(String url) {
        try {
            if (player != null) {
                player.release();
            }

            // Aggressive buffer for spotty 4G/5G connections
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    15000,   // min buffer before playing
                    50000,   // max buffer (up to 50s)
                    2500,    // required buffer to start playback
                    5000     // required buffer to resume after rebuffering
                )
                .build();

            DefaultHttpDataSource.Factory dataSourceFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent("Mozilla/5.0")
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000)
                .setAllowCrossProtocolRedirects(true);

            DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(dataSourceFactory);

            player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .setLoadControl(loadControl)
                .build();

            player.setVideoSurface(surfaceView.getHolder().getSurface());

            MediaItem mediaItem = MediaItem.fromUri(Uri.parse(url));
            player.setMediaItem(mediaItem);

            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (playbackState == Player.STATE_READY) {
                        retryCount = 0;
                        cancelWatchdog();
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript(
                                "if(window._onNativeBuffering) window._onNativeBuffering(false)", null));
                            webView.post(() -> webView.evaluateJavascript(
                                "if(window._onNativePlaying) window._onNativePlaying()", null));
                        }
                    } else if (playbackState == Player.STATE_BUFFERING) {
                        startWatchdog();
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript(
                                "if(window._onNativeBuffering) window._onNativeBuffering(true)", null));
                        }
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    cancelWatchdog();
                    int code = error.errorCode;
                    // Auto-retry on transient errors
                    if (retryCount < MAX_RETRIES) {
                        retryCount++;
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript(
                                "if(window._onNativeReconnecting) window._onNativeReconnecting()", null));
                        }
                        watchdog.postDelayed(() -> {
                            if (currentUrl != null) startNativePlayback(currentUrl);
                        }, RETRY_DELAY_MS);
                        return;
                    }
                    // Retries exhausted
                    retryCount = 0;
                    surfaceView.setVisibility(View.GONE);
                    if (webView != null) {
                        webView.post(() -> webView.evaluateJavascript(
                            "if(window._onNativeError) window._onNativeError(" + code + ", 0)", null));
                    }
                }
            });

            player.prepare();
            player.play();
        } catch (Exception e) {
            e.printStackTrace();
            surfaceView.setVisibility(View.GONE);
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if(window._onNativeError) window._onNativeError(-1,0)", null));
            }
        }
    }

    private void stopNativePlayback() {
        pendingUrl = null;
        cancelWatchdog();
        if (mediaController != null && mediaController.isShowing()) {
            mediaController.hide();
        }
        if (player != null) {
            try {
                player.stop();
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
    }

    // SurfaceHolder callbacks
    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (pendingUrl != null) {
            String url = pendingUrl;
            pendingUrl = null;
            doPlay(url);
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}

    // ── Freeze detection watchdog ────────────────────────────
    private final Runnable watchdogRunnable = () -> {
        if (currentUrl != null && surfaceView.getVisibility() == View.VISIBLE) {
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if(window._onNativeReconnecting) window._onNativeReconnecting()", null));
            }
            startNativePlayback(currentUrl);
        }
    };

    private void startWatchdog() {
        cancelWatchdog();
        watchdog.postDelayed(watchdogRunnable, FREEZE_TIMEOUT_MS);
    }

    private void cancelWatchdog() {
        watchdog.removeCallbacks(watchdogRunnable);
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        stopNativePlayback();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (webView != null && keyCode == KeyEvent.KEYCODE_BACK) {
            // If native video is visible, hide it and go back to UI
            if (surfaceView.getVisibility() == View.VISIBLE) {
                stopNativePlayback();
                surfaceView.setVisibility(View.GONE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                webView.evaluateJavascript(
                    "if(window._onNativeBack) window._onNativeBack()", null);
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        stopNativePlayback();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
