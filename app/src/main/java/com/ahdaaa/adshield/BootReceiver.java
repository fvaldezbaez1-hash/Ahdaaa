package com.ahdaaa.adshield;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;

/** Turns blocking back on after a reboot or app update if it was on before. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Lists.wantsOn(context)) return;
        if (VpnService.prepare(context) != null) return; // permission was revoked
        AdBlockService.start(context);
    }
}
