package online.laboon.dorong;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Runs in the page on Android back. Returns "web" when the page should handle it
     * (a match iframe / overlay is open, or a listener called preventDefault on the
     * 'backbutton' event), otherwise "exit".
     */
    private static final String BACK_JS =
        "(function(){try{" +
        "function fire(t){var e;try{e=new CustomEvent('backbutton',{cancelable:true});}" +
        "catch(x){e=t.document.createEvent('Event');e.initEvent('backbutton',true,true);}return !t.dispatchEvent(e);}" +
        "if(fire(document)||fire(window))return 'web';" +
        "var fs=document.getElementsByTagName('iframe');" +
        "for(var i=0;i<fs.length;i++){var f=fs[i],r=f.getBoundingClientRect(),cs=getComputedStyle(f);" +
        "if(r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'){" +
        "try{var w=f.contentWindow;fire(w.document);}catch(x){}return 'web';}}" +
        "return 'exit';}catch(e){return 'exit';}})()";

    private boolean exitDialogShowing = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep the screen on while the game is in the foreground (no WAKE_LOCK permission needed).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // W-35 경로 분리: OTA 묶음에 없는 파일은 APK 안 기본 파일에서 읽는다(묶음 = 바뀐 파일만 → 기기에 www 전체를 복사하지 않음)
        if (getBridge() != null) getBridge().setWebViewClient(new OtaAssetFallback(getBridge()));

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            WebSettings s = webView.getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setDomStorageEnabled(true);
            s.setJavaScriptEnabled(true);
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            webView.setBackgroundColor(0xFFF6D6DC);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) { confirmExit(); return; }
                wv.evaluateJavascript(BACK_JS, value -> {
                    if (value == null || !value.contains("web")) confirmExit();
                });
            }
        });

        hideSystemBars();
    }

    private void confirmExit() {
        if (exitDialogShowing || isFinishing()) return;
        exitDialogShowing = true;
        new AlertDialog.Builder(this)
            .setTitle("느림마을")
            .setMessage("느림마을을 닫을까요?")
            .setNegativeButton("더 놀기", (d, w) -> d.dismiss())
            .setPositiveButton("닫기", (d, w) -> finish())
            .setOnDismissListener(d -> { exitDialogShowing = false; hideSystemBars(); })
            .show();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }
}
