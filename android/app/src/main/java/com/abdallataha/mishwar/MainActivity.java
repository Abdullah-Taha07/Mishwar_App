package com.abdallataha.mishwar;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Installable, in-app Android experience for Mishwar.
 * The trusted HTTPS application runs inside this APK, not in an external browser.
 * Service-side features still need the Internet and their configured backend.
 * No JavaScript bridge or arbitrary in-app web origin is exposed.
 */
public class MainActivity extends Activity {
  private static final int FILE_REQUEST = 4101;
  private static final int LOCATION_REQUEST = 4102;
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private GeolocationPermissions.Callback locationCallback;
  private String locationOrigin;

  private int dp(float value) {
    return (int) (value * getResources().getDisplayMetrics().density + .5f);
  }

  private String trustedHost() {
    return Uri.parse(getString(R.string.launch_url)).getHost();
  }

  private boolean trusted(Uri uri) {
    return uri != null && "https".equalsIgnoreCase(uri.getScheme())
      && trustedHost().equalsIgnoreCase(uri.getEncodedAuthority());
  }

  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setStatusBarColor(Color.rgb(8, 51, 68));
    getWindow().setNavigationBarColor(Color.rgb(8, 51, 68));

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.WHITE);
    root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

    LinearLayout toolbar = new LinearLayout(this);
    toolbar.setOrientation(LinearLayout.HORIZONTAL);
    toolbar.setGravity(Gravity.CENTER_VERTICAL);
    toolbar.setPadding(dp(12), 0, dp(12), 0);
    toolbar.setBackgroundColor(Color.rgb(8, 51, 68));

    TextView name = new TextView(this);
    name.setText(getString(R.string.app_name));
    name.setTextColor(Color.WHITE);
    name.setTextSize(14);
    name.setGravity(Gravity.CENTER_VERTICAL);
    toolbar.addView(name, new LinearLayout.LayoutParams(0, dp(42), 1));

    Button share = new Button(this);
    share.setAllCaps(false);
    share.setText("مشاركة ⋮");
    share.setTextColor(Color.WHITE);
    share.setTextSize(12);
    share.setBackgroundColor(Color.rgb(23, 89, 108));
    share.setContentDescription("مشاركة ملف تطبيق مشوار أو رابطه");
    share.setOnClickListener(v -> openShareMenu());
    toolbar.addView(share, new LinearLayout.LayoutParams(dp(106), dp(38)));
    root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(44)));

    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true); // Needed for a user-selected image/PDF upload.
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setUserAgentString(settings.getUserAgentString() + " MishwarAndroid/0.4.0");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (!request.isForMainFrame()) return false;
        Uri target = request.getUrl();
        if (trusted(target)) return false;
        if ("mishwar-app".equals(target.getScheme()) && "share".equals(target.getHost())) {
          shareApk();
          return true;
        }
        if ("mishwar-app".equals(target.getScheme()) && "share-link".equals(target.getHost())) {
          shareLink();
          return true;
        }
        String scheme = target.getScheme();
        if ("https".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)
            || "mailto".equalsIgnoreCase(scheme)) {
          try { startActivity(new Intent(Intent.ACTION_VIEW, target)); }
          catch (RuntimeException ignored) { Toast.makeText(MainActivity.this, "تعذر فتح الرابط", Toast.LENGTH_SHORT).show(); }
        }
        return true; // Never load an arbitrary website or unsafe scheme into our app.
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
          FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try {
          Intent chooser = params.createIntent();
          chooser.addCategory(Intent.CATEGORY_OPENABLE);
          startActivityForResult(chooser, FILE_REQUEST);
          return true;
        } catch (RuntimeException error) {
          fileCallback = null;
          callback.onReceiveValue(null);
          Toast.makeText(MainActivity.this, "تعذر فتح الملفات", Toast.LENGTH_SHORT).show();
          return true;
        }
      }
      @Override public void onGeolocationPermissionsShowPrompt(String origin,
          GeolocationPermissions.Callback callback) {
        Uri uri = Uri.parse(origin);
        if (!trusted(uri)) { callback.invoke(origin, false, false); return; }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
          callback.invoke(origin, true, false);
          return;
        }
        if (locationCallback != null) locationCallback.invoke(locationOrigin, false, false);
        locationCallback = callback;
        locationOrigin = origin;
        requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION }, LOCATION_REQUEST);
      }
    });
    root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(root);
    web.loadUrl(getString(R.string.launch_url));

    Uri incoming = getIntent() == null ? null : getIntent().getData();
    if (incoming != null && "mishwar-app".equals(incoming.getScheme())) {
      if ("share".equals(incoming.getHost())) shareApk();
      if ("share-link".equals(incoming.getHost())) shareLink();
    }
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    Uri incoming = intent == null ? null : intent.getData();
    if (incoming != null && "mishwar-app".equals(incoming.getScheme())) {
      if ("share".equals(incoming.getHost())) shareApk();
      if ("share-link".equals(incoming.getHost())) shareLink();
    }
  }

  private void openShareMenu() {
    new AlertDialog.Builder(this)
      .setTitle("مشاركة " + getString(R.string.app_name))
      .setItems(new String[] { "إرسال ملف APK مباشرة", "مشاركة رابط التطبيق", "نسخ رابط التثبيت" },
        (dialog, selected) -> {
          if (selected == 0) shareApk();
          else if (selected == 1) shareLink();
          else {
            android.content.ClipboardManager clipboard = (android.content.ClipboardManager)
                getSystemService(CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Mishwar", installUrl()));
            Toast.makeText(this, "تم نسخ رابط التطبيق", Toast.LENGTH_SHORT).show();
          }
        }).show();
  }

  private String installUrl() { return getString(R.string.launch_url) + "install.html"; }

  /** Shares our own installed, signed APK by read-only content URI, never a secret file. */
  private void shareApk() {
    try {
      Uri apk = Uri.parse("content://" + getPackageName() + ".apkshare/application.apk");
      Intent send = new Intent(Intent.ACTION_SEND);
      send.setType("application/vnd.android.package-archive");
      send.putExtra(Intent.EXTRA_STREAM, apk);
      send.setClipData(android.content.ClipData.newUri(getContentResolver(), "Mishwar APK", apk));
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      startActivity(Intent.createChooser(send, "إرسال ملف تطبيق مشوار"));
    } catch (RuntimeException error) {
      Toast.makeText(this, "تعذرت مشاركة ملف APK على هذا الجهاز", Toast.LENGTH_LONG).show();
    }
  }

  private void shareLink() {
    Intent send = new Intent(Intent.ACTION_SEND);
    send.setType("text/plain");
    send.putExtra(Intent.EXTRA_SUBJECT, getString(R.string.app_name));
    send.putExtra(Intent.EXTRA_TEXT, "تطبيق " + getString(R.string.app_name) + "\n" + installUrl());
    startActivity(Intent.createChooser(send, "مشاركة رابط مشوار"));
  }

  @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == FILE_REQUEST && fileCallback != null) {
      ValueCallback<Uri[]> old = fileCallback;
      fileCallback = null;
      old.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
    }
  }

  @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode == LOCATION_REQUEST && locationCallback != null) {
      boolean granted = false;
      for (int result : results) if (result == PackageManager.PERMISSION_GRANTED) granted = true;
      locationCallback.invoke(locationOrigin, granted, false);
      locationCallback = null;
      locationOrigin = null;
    }
  }

  @Override public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
  @Override protected void onPause() {
    if (web != null) web.onPause();
    super.onPause();
  }
  @Override protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
  }
  @Override protected void onDestroy() {
    if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
    if (locationCallback != null) {
      locationCallback.invoke(locationOrigin, false, false);
      locationCallback = null;
    }
    if (web != null) {
      web.stopLoading();
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
