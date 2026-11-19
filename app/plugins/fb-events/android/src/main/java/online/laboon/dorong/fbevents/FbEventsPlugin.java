package online.laboon.dorong.fbevents;

import android.app.Application;
import android.os.Bundle;
import android.util.Log;

import com.facebook.FacebookSdk;
import com.facebook.appevents.AppEventsLogger;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.math.BigDecimal;
import java.util.Currency;
import java.util.Iterator;

/**
 * Meta App Events bridge.
 * Policy: SDK auto-init ON, AutoLogAppEventsEnabled=true (manifest meta-data), AdvertiserIDCollectionEnabled=true.
 * W-52: installs / app opens are logged by the SDK's automatic logging (with Meta ad install attribution).
 * The manual activateApp call was removed — with auto logging off, Meta counted 0 installs from ads (DB had 28).
 * 1.4.5: @capgo/capacitor-social-login removes facebook-core's FacebookInitProvider (tools:node="remove"),
 * so the SDK never auto-initialized on Android — no install/activate event ever reached Meta (only iOS showed up).
 * We now initialize the SDK here (plugins load in MainActivity.onCreate, before the first onResume) and register
 * activateApp so automatic logging (install · app open · install-referrer attribution) runs.
 */
@CapacitorPlugin(name = "FbEvents")
public class FbEventsPlugin extends Plugin {
    private static final String TAG = "FbEvents";
    private AppEventsLogger logger;

    @Override
    public void load() {
        try {
            Application app = (Application) getContext().getApplicationContext();
            if (!FacebookSdk.isInitialized()) {
                FacebookSdk.setAutoInitEnabled(true);
                FacebookSdk.sdkInitialize(app);
            }
            FacebookSdk.setAutoLogAppEventsEnabled(true);
            FacebookSdk.setAdvertiserIDCollectionEnabled(true);
            AppEventsLogger.activateApp(app);
            logger = AppEventsLogger.newLogger(app);
            Log.i(TAG, "Meta SDK initialized (auto log on)");
        } catch (Throwable t) {
            // Never let analytics crash the game (e.g. placeholder app id not replaced yet).
            Log.w(TAG, "Meta logger init failed", t);
        }
    }

    @PluginMethod
    public void logEvent(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) {
            call.reject("name is required");
            return;
        }
        if (logger == null) {
            call.reject("Meta SDK not initialized");
            return;
        }
        try {
            logger.logEvent(name, toBundle(call.getObject("params")));
            call.resolve();
        } catch (Throwable t) {
            call.reject("logEvent failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void logPurchase(PluginCall call) {
        Double amount = call.getDouble("amount");
        String currency = call.getString("currency");
        if (amount == null || !(amount > 0) || currency == null || currency.isEmpty()) {
            call.reject("amount (>0) and currency are required");
            return;
        }
        if (logger == null) {
            call.reject("Meta SDK not initialized");
            return;
        }
        try {
            logger.logPurchase(BigDecimal.valueOf(amount), Currency.getInstance(currency.toUpperCase()), toBundle(call.getObject("params")));
            call.resolve();
        } catch (Throwable t) {
            call.reject("logPurchase failed: " + t.getMessage());
        }
    }

    private static Bundle toBundle(JSObject obj) {
        Bundle b = new Bundle();
        if (obj == null) return b;
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Object v = obj.opt(k);
            if (v instanceof Integer || v instanceof Long) {
                b.putLong(k, ((Number) v).longValue());
            } else if (v instanceof Number) {
                b.putDouble(k, ((Number) v).doubleValue());
            } else if (v instanceof Boolean) {
                b.putString(k, v.toString());
            } else if (v != null && v != org.json.JSONObject.NULL) {
                b.putString(k, v.toString());
            }
        }
        return b;
    }
}
