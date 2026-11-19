package online.laboon.dorong.referrer;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google Play Install Referrer (W-35 / W-34 #3). The app calls get() once after first launch and stores
 * utm_source · utm_campaign · gclid on the account. Never throws into the game: every failure is a reject.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {
    @PluginMethod
    public void get(final PluginCall call) {
        final InstallReferrerClient client;
        try {
            client = InstallReferrerClient.newBuilder(getContext()).build();
        } catch (Throwable t) {
            call.reject("referrer client failed: " + t.getMessage());
            return;
        }
        try {
            client.startConnection(new InstallReferrerStateListener() {
                private boolean done = false;

                @Override
                public void onInstallReferrerSetupFinished(int code) {
                    if (done) return;
                    done = true;
                    try {
                        if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails d = client.getInstallReferrer();
                            JSObject ret = new JSObject();
                            ret.put("referrer", d.getInstallReferrer() == null ? "" : d.getInstallReferrer());
                            ret.put("clickTs", d.getReferrerClickTimestampSeconds());
                            ret.put("installTs", d.getInstallBeginTimestampSeconds());
                            call.resolve(ret);
                        } else {
                            call.reject("referrer unavailable: " + code);
                        }
                    } catch (Throwable t) {
                        call.reject("referrer failed: " + t.getMessage());
                    } finally {
                        try { client.endConnection(); } catch (Throwable ignored) { }
                    }
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    if (done) return;
                    done = true;
                    call.reject("referrer service disconnected");
                }
            });
        } catch (Throwable t) {
            call.reject("referrer connect failed: " + t.getMessage());
        }
    }
}
