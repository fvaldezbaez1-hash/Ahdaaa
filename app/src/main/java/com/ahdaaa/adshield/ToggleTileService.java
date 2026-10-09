package com.ahdaaa.adshield;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick Settings tile: swipe down and tap to turn ad blocking on/off. */
public class ToggleTileService extends TileService {
    @Override
    public void onStartListening() {
        refresh(Stats.running);
    }

    @Override
    public void onClick() {
        if (Stats.running) {
            AdBlockService.stop(this);
            refresh(false);
        } else if (VpnService.prepare(this) == null) {
            AdBlockService.start(this);
            refresh(true);
        } else {
            // VPN permission not granted yet: open the app so the user can approve it.
            Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE));
            } else {
                startActivityAndCollapse(i);
            }
        }
    }

    private void refresh(boolean on) {
        Tile t = getQsTile();
        if (t == null) return;
        t.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.updateTile();
    }
}
