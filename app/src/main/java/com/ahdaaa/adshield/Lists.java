package com.ahdaaa.adshield;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.io.StringReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.FileInputStream;
import java.util.HashSet;
import java.util.Set;

/** Blocklist sources, settings, downloading and loading. */
public final class Lists {
    private Lists() {}

    private static final String TAG = "AdShield";
    static final long REFRESH_INTERVAL_MS = 3L * 24 * 60 * 60 * 1000; // every 3 days

    public static final class Source {
        public final String id;
        public final String name;
        public final String description;
        public final String url;
        public final boolean defaultOn;

        Source(String id, String name, String description, String url, boolean defaultOn) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.url = url;
            this.defaultOn = defaultOn;
        }
    }

    public static final Source[] SOURCES = {
            new Source("hagezi_pro", "HaGeZi Multi PRO",
                    "Ads, trackers, malware, scams. Recommended.",
                    "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/pro.txt", true),
            new Source("stevenblack", "StevenBlack Unified",
                    "Classic ads + malware hosts list.",
                    "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts", true),
            new Source("adguard_dns", "AdGuard DNS filter",
                    "AdGuard's mobile ads + tracker list.",
                    "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt", false),
            new Source("oisd_big", "OISD Big",
                    "Very large list, maximum blocking.",
                    "https://big.oisd.nl/", false),
            new Source("adaway", "AdAway",
                    "Small mobile-focused ad list.",
                    "https://adaway.org/hosts.txt", false),
            new Source("hagezi_tif", "HaGeZi Threat Intelligence",
                    "Extra malware, phishing and scam protection.",
                    "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/tif.txt", false),
    };

    public static final class Upstream {
        public final String name;
        public final String[] servers;

        Upstream(String name, String... servers) {
            this.name = name;
            this.servers = servers;
        }
    }

    public static final Upstream[] UPSTREAMS = {
            new Upstream("Cloudflare (fast, private)", "1.1.1.1", "1.0.0.1"),
            new Upstream("AdGuard DNS (extra ad blocking)", "94.140.14.14", "94.140.15.15"),
            new Upstream("Quad9 (blocks malware)", "9.9.9.9", "149.112.112.112"),
            new Upstream("Google", "8.8.8.8", "8.8.4.4"),
    };

    // ---- Settings ----

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    public static boolean isSourceEnabled(Context c, Source s) {
        return prefs(c).getBoolean("src_" + s.id, s.defaultOn);
    }

    public static void setSourceEnabled(Context c, Source s, boolean on) {
        prefs(c).edit().putBoolean("src_" + s.id, on).apply();
    }

    public static int upstreamIndex(Context c) {
        int i = prefs(c).getInt("upstream", 0);
        return i >= 0 && i < UPSTREAMS.length ? i : 0;
    }

    public static void setUpstreamIndex(Context c, int i) {
        prefs(c).edit().putInt("upstream", i).apply();
    }

    public static String userAllow(Context c) {
        return prefs(c).getString("user_allow", "");
    }

    public static String userBlock(Context c) {
        return prefs(c).getString("user_block", "");
    }

    public static void setUserLists(Context c, String allow, String block) {
        prefs(c).edit().putString("user_allow", allow).putString("user_block", block).apply();
    }

    /** Adds one domain to the user allow or block list (removing it from the other). */
    public static void addUserRule(Context c, String domain, boolean block) {
        Set<String> allow = lines(userAllow(c));
        Set<String> blocked = lines(userBlock(c));
        if (block) {
            allow.remove(domain);
            blocked.add(domain);
        } else {
            blocked.remove(domain);
            allow.add(domain);
        }
        setUserLists(c, String.join("\n", allow), String.join("\n", blocked));
    }

    private static Set<String> lines(String text) {
        Set<String> out = new java.util.LinkedHashSet<>();
        for (String l : text.split("\n")) {
            String d = Blocklist.normalize(l);
            if (d != null) out.add(d);
        }
        return out;
    }

    /** Whether the user wants protection on (used to restart after reboot). */
    public static boolean wantsOn(Context c) {
        return prefs(c).getBoolean("wants_on", false);
    }

    public static void setWantsOn(Context c, boolean on) {
        prefs(c).edit().putBoolean("wants_on", on).apply();
    }

    public static long lastUpdated(Context c) {
        return prefs(c).getLong("last_updated", 0);
    }

    // ---- Downloading ----

    private static File listDir(Context c) {
        File d = new File(c.getFilesDir(), "lists");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static File fileFor(Context c, Source s) {
        return new File(listDir(c), s.id + ".txt");
    }

    /** True if any enabled list is missing or the lists are older than the refresh interval. */
    public static boolean needsUpdate(Context c) {
        if (System.currentTimeMillis() - lastUpdated(c) > REFRESH_INTERVAL_MS) return true;
        for (Source s : SOURCES) {
            if (isSourceEnabled(c, s) && !fileFor(c, s).exists()) return true;
        }
        return false;
    }

    /** Downloads every enabled list. Returns how many succeeded. Blocking; call off the UI thread. */
    public static synchronized int downloadAll(Context c) {
        int ok = 0;
        for (Source s : SOURCES) {
            if (!isSourceEnabled(c, s)) continue;
            try {
                download(s.url, fileFor(c, s));
                ok++;
            } catch (IOException e) {
                Log.w(TAG, "Download failed: " + s.url, e);
            }
        }
        if (ok > 0) prefs(c).edit().putLong("last_updated", System.currentTimeMillis()).apply();
        return ok;
    }

    private static void download(String url, File dest) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("User-Agent", "AdShield/1.0 (Android)");
        try {
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            File tmp = new File(dest.getPath() + ".tmp");
            long total = 0;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
            }
            if (total < 100) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                throw new IOException("Suspiciously small list");
            }
            if (!tmp.renameTo(dest)) throw new IOException("Rename failed");
        } finally {
            conn.disconnect();
        }
    }

    // ---- Loading ----

    /** Builds the blocklist from the built-in seed, downloaded lists and user rules. */
    public static Blocklist load(Context c) {
        Set<String> block = new HashSet<>();
        Set<String> allow = new HashSet<>();
        try (Reader r = new InputStreamReader(c.getAssets().open("seed.txt"), StandardCharsets.UTF_8)) {
            Blocklist.parse(r, block, allow);
        } catch (IOException e) {
            Log.w(TAG, "Seed list missing", e);
        }
        for (Source s : SOURCES) {
            File f = fileFor(c, s);
            if (!isSourceEnabled(c, s) || !f.exists()) continue;
            try (Reader r = new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8)) {
                Blocklist.parse(r, block, allow);
            } catch (IOException e) {
                Log.w(TAG, "Failed to read " + f, e);
            }
        }
        Set<String> userAllow = new HashSet<>();
        Set<String> userBlock = new HashSet<>();
        Set<String> ignored = new HashSet<>();
        try {
            Blocklist.parse(new StringReader(userAllow(c)), userAllow, ignored);
            Blocklist.parse(new StringReader(userBlock(c)), userBlock, ignored);
        } catch (IOException ignoredException) {
            // StringReader doesn't throw
        }
        return new Blocklist(userAllow, userBlock, allow, block);
    }
}
