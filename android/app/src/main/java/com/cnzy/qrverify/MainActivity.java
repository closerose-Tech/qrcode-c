package com.cnzy.qrverify;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

/**
 * 二维码测评 · 原生外壳
 * 页面资源通过 WebViewAssetLoader 以 https://appassets.androidplatform.net 提供服务，
 * 避免 file:// 源导致的画布污染与脚本限制，全部计算在 WebView 内完成。
 *
 * 相机：页面用 getUserMedia 直接取景（真取景，而非 input capture 退化的文件选择器）。
 * WebView 的 WebRTC 摄像头能力需要两件事同时满足：
 *   1) 宿主 App 已获得 CAMERA 运行时权限；
 *   2) WebChromeClient.onPermissionRequest 对 RESOURCE_VIDEO_CAPTURE 显式授予。
 * 授权结果通过 window.onCameraPermission(granted) 回调页面，页面据此重试或回退。
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 1001;
    private static final int REQ_CAM = 1002;
    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/web/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;   // getUserMedia 发起的摄像头请求
    private boolean pendingJsCallback;                // 是否需要在授权后回调页面

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);

        webView.setBackgroundColor(0xFFF4F5F7);

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(@NonNull WebView view,
                                                             @NonNull WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开图片来源", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            /** 页面 getUserMedia 会走到这里；必须先拿到系统相机权限再授予。 */
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (hasCameraPermission()) {
                        request.grant(request.getResources());
                        notifyPage(true);
                        return;
                    }
                    pendingWebPermission = request;
                    pendingJsCallback = true;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermission == request) {
                    pendingWebPermission = null;
                    pendingJsCallback = false;
                }
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.loadUrl(START_URL);
    }

    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    /** 回调页面：通知相机可用 / 不可用 */
    private void notifyPage(boolean granted) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript(
                "window.onCameraPermission&&window.onCameraPermission(" + granted + ")", null));
    }

    /** 供网页调用：原生打印、提示、相机授权 */
    private class Bridge {
        @JavascriptInterface
        public void printPage() {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                if (pm == null) return;
                String job = "二维码测评报告";
                pm.print(job, webView.createPrintDocumentAdapter(job),
                        new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        /**
         * 页面在启动取景前调用：已授权则立即回调 true；
         * 未授权则弹出系统授权框，结果通过 window.onCameraPermission 回传。
         */
        @JavascriptInterface
        public void requestCamera() {
            runOnUiThread(() -> {
                if (hasCameraPermission()) {
                    notifyPage(true);
                    return;
                }
                pendingJsCallback = true;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        if (requestCode == REQ_CAM) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;

            if (pendingWebPermission != null) {
                if (granted) pendingWebPermission.grant(pendingWebPermission.getResources());
                else pendingWebPermission.deny();
                pendingWebPermission = null;
            }
            if (pendingJsCallback) {
                pendingJsCallback = false;
                notifyPage(granted);
            }
            if (!granted) {
                Toast.makeText(this, "未授予相机权限，已切换为系统拍照 / 相册导入",
                        Toast.LENGTH_LONG).show();
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        // 离开前台立即停掉取景，避免摄像头常亮
        if (webView != null) {
            webView.evaluateJavascript(
                    "window.Camera&&window.Camera.close&&window.Camera.close()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
