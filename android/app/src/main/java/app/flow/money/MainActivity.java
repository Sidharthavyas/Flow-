package app.flow.money;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQUEST_WRITE_STORAGE = 4201;
    private static final int REQUEST_NOTIFICATIONS = 4202;
    private static final int REQUEST_SMS = 4203;

    private WebView webView;
    private ProgressBar progressBar;
    private PendingDownload pendingDownload;
    private final String appUrl = BuildConfig.APP_URL;
    private final String appHost = parseHost(BuildConfig.APP_URL);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        }

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setIndeterminate(false);
        progressBar.setProgressTintList(ColorStateList.valueOf(getColor(R.color.flow_accent)));
        progressBar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        progressBar.setVisibility(View.GONE);

        root.setBackgroundColor(getColor(R.color.flow_background));
        applySystemBarInsets(root);

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(2), Gravity.TOP
        );
        root.addView(progressBar, progressParams);
        setContentView(root);

        configureWebView();
        NudgeReceiver.schedule(this);
        NudgeReceiver.scheduleTestOnce(this);
        requestNotificationPermission();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(appUrl);
        }
    }


    private void applySystemBarInsets(View root) {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(
                        insets.getSystemWindowInsetLeft(),
                        insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(),
                        insets.getSystemWindowInsetBottom()
                );
            }
            return insets;
        });
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " FlowAndroid/1.1");

        webView.setBackgroundColor(getColor(R.color.flow_background));
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, false);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setWebViewClient(new FlowWebViewClient());
        webView.setDownloadListener(new FlowDownloadListener());
        // Lets the Flow web page (Profile → Bank SMS) switch SMS auto-add on and off. Only Flow pages load in this WebView.
        webView.addJavascriptInterface(new FlowBridge(), "FlowAndroid");
    }

    private class FlowWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progressBar.setProgress(5);
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                progressBar.setVisibility(View.GONE);
                showOfflinePage();
            }
        }
    }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();

        if (scheme == null) return false;

        if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && host != null && host.equalsIgnoreCase(appHost)) {
            return false;
        }

        Intent intent;
        if ("intent".equalsIgnoreCase(scheme)) {
            try {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
            } catch (URISyntaxException e) {
                return true;
            }
        } else {
            intent = new Intent(Intent.ACTION_VIEW, uri);
        }

        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private class FlowDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                    String mimeType, long contentLength) {
            Uri uri = Uri.parse(url);
            if (uri.getHost() == null || !uri.getHost().equalsIgnoreCase(appHost)) {
                handleNavigation(uri);
                return;
            }

            pendingDownload = new PendingDownload(url, userAgent, contentDisposition, mimeType);

            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                    && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQUEST_WRITE_STORAGE
                );
                return;
            }

            enqueuePendingDownload();
        }
    }

    private void enqueuePendingDownload() {
        if (pendingDownload == null) return;

        String fileName = uniqueDownloadName(URLUtil.guessFileName(
                pendingDownload.url,
                pendingDownload.contentDisposition,
                pendingDownload.mimeType
        ));

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(pendingDownload.url));
        String cookie = CookieManager.getInstance().getCookie(pendingDownload.url);
        if (cookie != null && !cookie.isEmpty()) {
            request.addRequestHeader("Cookie", cookie);
        }
        if (pendingDownload.userAgent != null) {
            request.addRequestHeader("User-Agent", pendingDownload.userAgent);
        }
        request.setTitle(fileName);
        request.setDescription("Flow export");
        if (pendingDownload.mimeType != null && !pendingDownload.mimeType.isEmpty()) {
            request.setMimeType(pendingDownload.mimeType);
        }
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(false);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        manager.enqueue(request);
        Toast.makeText(this, R.string.download_started, Toast.LENGTH_LONG).show();
        pendingDownload = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_SMS) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            SmsSync.setEnabled(this, granted);
            getSharedPreferences("flow_sms", MODE_PRIVATE).edit().putBoolean("asked", true).apply();
            sendSmsStatus();
            return;
        }
        if (requestCode == REQUEST_WRITE_STORAGE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                enqueuePendingDownload();
            } else {
                pendingDownload = null;
                Toast.makeText(this, R.string.download_permission_denied, Toast.LENGTH_LONG).show();
            }
        }
    }


    private String uniqueDownloadName(String original) {
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        int dot = original.lastIndexOf('.');
        if (dot > 0 && dot < original.length() - 1) {
            return original.substring(0, dot) + "-" + stamp + original.substring(dot);
        }
        return original + "-" + stamp;
    }

    private void showOfflinePage() {
        String escapedUrl = appUrl.replace("'", "\\'");
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;background:#f4f4f2;color:#1e1e1b;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}"
                + ".card{width:min(100%,420px);background:#fff;border:1px solid #e7e6e1;border-radius:28px;padding:28px;box-sizing:border-box;box-shadow:0 20px 60px rgba(31,27,20,.08)}"
                + ".mark{width:54px;height:54px;border-radius:50%;background:#de8841;display:grid;place-items:center;font-weight:800;font-size:27px;margin-bottom:22px}"
                + "h1{font-size:30px;letter-spacing:-.04em;margin:0 0 8px}p{color:#6d6b66;line-height:1.5;margin:0 0 20px}"
                + "button{width:100%;height:52px;border:0;border-radius:16px;background:#de8841;color:#3c2513;font-weight:750;font-size:15px}</style></head>"
                + "<body><div class='card'><div class='mark'>F</div><h1>Flow is offline</h1>"
                + "<p>This private app needs an internet connection because your data and login live on the Flow server.</p>"
                + "<button onclick=\"location.href='" + escapedUrl + "'\">Retry</button></div></body></html>";
        webView.loadDataWithBaseURL(appUrl, html, "text/html", "UTF-8", null);
    }

    private static String parseHost(String url) {
        Uri uri = Uri.parse(url);
        String host = uri.getHost();
        return host == null ? "" : host;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    private boolean smsAskedBefore() {
        return getSharedPreferences("flow_sms", MODE_PRIVATE).getBoolean("asked", false);
    }

    private boolean hasSmsPermission() {
        return checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private String smsStatus() {
        if (!hasSmsPermission()) return SmsSync.isEnabled(this) || smsAskedBefore() ? "denied" : "off";
        return SmsSync.isEnabled(this) ? "on" : "off";
    }

    /** Tells the Profile page the new state after the permission dialog. */
    private void sendSmsStatus() {
        if (webView == null) return;
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('flow-sms-status',{detail:'" + smsStatus() + "'}))", null);
    }

    /** Exposed to the Flow web page as window.FlowAndroid. */
    private class FlowBridge {
        @JavascriptInterface
        public String smsStatus() {
            return MainActivity.this.smsStatus();
        }

        @JavascriptInterface
        public void enableSms() {
            runOnUiThread(() -> {
                if (!isFlowPage()) return;
                getSharedPreferences("flow_sms", MODE_PRIVATE).edit().putBoolean("userOff", false).apply();
                if (hasSmsPermission()) {
                    SmsSync.setEnabled(MainActivity.this, true);
                    sendSmsStatus();
                } else if (smsAskedBefore() && !shouldShowRequestPermissionRationale(Manifest.permission.RECEIVE_SMS)) {
                    // Android won't show the dialog again after "Don't allow" twice: open Flow's app settings instead.
                    Intent settings = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null));
                    try {
                        startActivity(settings);
                    } catch (ActivityNotFoundException ignored) {
                        Toast.makeText(MainActivity.this, R.string.sms_permission_settings, Toast.LENGTH_LONG).show();
                    }
                } else {
                    requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, REQUEST_SMS);
                }
            });
        }

        @JavascriptInterface
        public void disableSms() {
            runOnUiThread(() -> {
                if (!isFlowPage()) return;
                SmsSync.setEnabled(MainActivity.this, false);
                getSharedPreferences("flow_sms", MODE_PRIVATE).edit().putBoolean("userOff", true).apply();
                sendSmsStatus();
            });
        }
    }

    private boolean isFlowPage() {
        String url = webView == null ? null : webView.getUrl();
        String host = url == null ? null : Uri.parse(url).getHost();
        return host != null && host.equalsIgnoreCase(appHost);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Payments that arrived while offline or signed out are sent as soon as Flow is opened.
        if (SmsSync.isEnabled(this)) SmsSync.flushAsync(this);
        // Coming back from Android settings after allowing SMS: switch on and tell the page.
        if (hasSmsPermission() && smsAskedBefore() && !SmsSync.isEnabled(this) && !getSharedPreferences("flow_sms", MODE_PRIVATE).getBoolean("userOff", false)) {
            SmsSync.setEnabled(this, true);
        }
        sendSmsStatus();
    }

    @Override
    protected void onPause() {
        // Persist the login cookie so the 9 PM nudge can use it even after the app is closed.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private static class PendingDownload {
        final String url;
        final String userAgent;
        final String contentDisposition;
        final String mimeType;

        PendingDownload(String url, String userAgent, String contentDisposition, String mimeType) {
            this.url = url;
            this.userAgent = userAgent;
            this.contentDisposition = contentDisposition;
            this.mimeType = mimeType;
        }
    }
}
