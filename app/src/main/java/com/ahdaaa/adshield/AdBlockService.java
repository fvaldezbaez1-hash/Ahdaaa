package com.ahdaaa.adshield;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructPollfd;
import android.util.Log;

import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Local "VPN" that only captures DNS traffic. Every DNS lookup on the phone is
 * checked against the blocklist: ad/tracker domains get answered with 0.0.0.0
 * right here, everything else is forwarded to a real DNS server. No other
 * traffic goes through the app, so it costs almost no battery or speed.
 */
public class AdBlockService extends VpnService {
    private static final String TAG = "AdShield";
    public static final String ACTION_START = "com.ahdaaa.adshield.START";
    public static final String ACTION_STOP = "com.ahdaaa.adshield.STOP";
    public static final String ACTION_RELOAD = "com.ahdaaa.adshield.RELOAD";

    private static final String VPN_ADDRESS = "10.111.222.1";
    private static final String DNS_ADDRESS = "10.111.222.2";
    private static final String CHANNEL_ID = "status";
    private static final int NOTIFICATION_ID = 1;

    private ParcelFileDescriptor tun;
    private Thread worker;
    private volatile boolean running;
    private volatile Blocklist blocklist = Blocklist.EMPTY;
    private volatile InetAddress[] upstream = new InetAddress[0];
    private FileOutputStream tunOut;
    private final Object writeLock = new Object();
    private ThreadPoolExecutor forwardPool;
    private ScheduledExecutorService background;

    public static void start(Context c) {
        c.startForegroundService(new Intent(c, AdBlockService.class).setAction(ACTION_START));
    }

    public static void stop(Context c) {
        c.startService(new Intent(c, AdBlockService.class).setAction(ACTION_STOP));
    }

    public static void reload(Context c) {
        if (Stats.running) c.startService(new Intent(c, AdBlockService.class).setAction(ACTION_RELOAD));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            Lists.setWantsOn(this, false);
            shutdown();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_RELOAD.equals(action)) {
            if (running) {
                background.execute(() -> reloadSettings(true));
                return START_STICKY;
            }
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        // ACTION_START, a restart after being killed, or Always-on VPN.
        startInForeground();
        if (!running && !startVpn()) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onRevoke() {
        // Another VPN app took over, or the user turned us off in system settings.
        Lists.setWantsOn(this, false);
        shutdown();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    private boolean startVpn() {
        Builder b = new Builder()
                .setSession(getString(R.string.app_name))
                .addAddress(VPN_ADDRESS, 24)
                .addDnsServer(DNS_ADDRESS)
                .addRoute(DNS_ADDRESS, 32) // only DNS enters the tunnel
                .setConfigureIntent(openAppIntent());
        b.allowFamily(OsConstants.AF_INET);
        b.allowFamily(OsConstants.AF_INET6);
        if (Build.VERSION.SDK_INT >= 29) b.setMetered(false);
        try {
            // Our own list downloads must not loop through ourselves.
            b.addDisallowedApplication(getPackageName());
        } catch (PackageManager.NameNotFoundException ignored) {
        }

        try {
            tun = b.establish();
        } catch (Exception e) {
            Log.e(TAG, "establish failed", e);
            tun = null;
        }
        if (tun == null) return false; // VPN permission not granted

        tunOut = new FileOutputStream(tun.getFileDescriptor());
        forwardPool = new ThreadPoolExecutor(24, 24, 30, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(1000), new ThreadPoolExecutor.DiscardPolicy());
        forwardPool.allowCoreThreadTimeOut(true);
        background = Executors.newSingleThreadScheduledExecutor();

        running = true;
        Stats.running = true;
        Lists.setWantsOn(this, true);
        Stats.changed();

        worker = new Thread(this::readLoop, "AdShield-tun");
        worker.start();

        background.execute(() -> {
            reloadSettings(false);
            refreshListsIfNeeded();
        });
        background.scheduleWithFixedDelay(this::refreshListsIfNeeded, 6, 6, TimeUnit.HOURS);
        background.scheduleWithFixedDelay(this::updateNotification, 15, 15, TimeUnit.SECONDS);
        return true;
    }

    private void shutdown() {
        if (!running && tun == null) return;
        running = false;
        if (worker != null) {
            worker.interrupt();
            try {
                worker.join(2000);
            } catch (InterruptedException ignored) {
            }
            worker = null;
        }
        if (background != null) background.shutdownNow();
        if (forwardPool != null) forwardPool.shutdownNow();
        if (tun != null) {
            try {
                tun.close();
            } catch (IOException ignored) {
            }
            tun = null;
        }
        Stats.running = false;
        Stats.status = "";
        Stats.changed();
    }

    // ---- Blocklist ----

    private void reloadSettings(boolean silent) {
        int up = Lists.upstreamIndex(this);
        InetAddress[] servers = new InetAddress[Lists.UPSTREAMS[up].servers.length];
        try {
            for (int i = 0; i < servers.length; i++) {
                servers[i] = InetAddress.getByName(Lists.UPSTREAMS[up].servers[i]); // numeric, no lookup
            }
            upstream = servers;
        } catch (IOException e) {
            Log.e(TAG, "bad upstream", e);
        }
        if (!silent) setStatus(getString(R.string.status_loading));
        Blocklist loaded = Lists.load(this);
        blocklist = loaded;
        Stats.listSize = loaded.size();
        setStatus(getString(R.string.status_protected));
        updateNotification();
    }

    private void refreshListsIfNeeded() {
        if (!running || !Lists.needsUpdate(this)) return;
        setStatus(getString(R.string.status_downloading));
        int ok = Lists.downloadAll(this);
        if (!running) return;
        if (ok > 0) {
            reloadSettings(true);
        } else {
            setStatus(getString(R.string.status_download_failed));
        }
    }

    private void setStatus(String s) {
        Stats.status = s;
        Stats.changed();
    }

    // ---- Packet loop ----

    private void readLoop() {
        FileDescriptor fd = tun.getFileDescriptor();
        FileInputStream in = new FileInputStream(fd);
        StructPollfd pollfd = new StructPollfd();
        pollfd.fd = fd;
        pollfd.events = (short) OsConstants.POLLIN;
        StructPollfd[] polls = {pollfd};
        byte[] buf = new byte[32767];

        while (running) {
            try {
                pollfd.revents = 0;
                if (Os.poll(polls, 1000) == 0) continue;
                if ((pollfd.revents & (OsConstants.POLLERR | OsConstants.POLLHUP | OsConstants.POLLNVAL)) != 0) break;
                int n = in.read(buf);
                if (n > 0) handlePacket(buf, n);
            } catch (ErrnoException e) {
                if (e.errno == OsConstants.EINTR) continue;
                Log.w(TAG, "poll failed", e);
                break;
            } catch (IOException e) {
                if (running) Log.w(TAG, "read failed", e);
                break;
            } catch (RuntimeException e) {
                Log.e(TAG, "bad packet", e); // never let one odd packet kill blocking
            }
        }
    }

    private void handlePacket(byte[] buf, int len) {
        Packets.UdpPacket p = Packets.parseUdp(buf, len);
        if (p == null || p.dstPort != Packets.DNS_PORT) return;
        Packets.Question q = Packets.parseQuestion(p.payload);
        if (q == null) return;

        boolean blocked = blocklist.isBlocked(q.name);
        if (!q.name.endsWith(".arpa")) Stats.record(q.name, blocked);
        if (blocked) {
            writeToTun(Packets.buildUdpReply(p, Packets.blockedAnswer(p.payload, q)));
        } else {
            forwardPool.execute(() -> forward(p));
        }
    }

    private void forward(Packets.UdpPacket p) {
        InetAddress[] servers = upstream;
        try (DatagramSocket socket = new DatagramSocket()) {
            protect(socket); // send outside the tunnel
            socket.setSoTimeout(2500);
            byte[] resp = new byte[4096];
            for (int attempt = 0; attempt < servers.length * 2 && running; attempt++) {
                InetAddress server = servers[attempt % servers.length];
                socket.send(new DatagramPacket(p.payload, p.payload.length, server, Packets.DNS_PORT));
                DatagramPacket r = new DatagramPacket(resp, resp.length);
                try {
                    socket.receive(r);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                writeToTun(Packets.buildUdpReply(p, Arrays.copyOf(resp, r.getLength())));
                return;
            }
        } catch (IOException e) {
            // Offline or network switching; the app will simply retry its lookup.
        }
    }

    private void writeToTun(byte[] packet) {
        synchronized (writeLock) {
            if (!running) return;
            try {
                tunOut.write(packet);
            } catch (IOException e) {
                Log.w(TAG, "write failed", e);
            }
        }
    }

    // ---- Notification ----

    private PendingIntent openAppIntent() {
        return PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID,
                    getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent stopIntent = PendingIntent.getService(this, 1,
                new Intent(this, AdBlockService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_shield)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(getString(R.string.notification_text, Stats.blocked.get()))
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null, getString(R.string.turn_off), stopIntent).build())
                .build();
    }

    private void startInForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateNotification() {
        if (!running) return;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
    }
}
