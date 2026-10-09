package com.ahdaaa.adshield;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/** In-memory state shared between the VPN service and the screen. */
public final class Stats {
    private Stats() {}

    public static final class Entry {
        public final String domain;
        public final boolean blocked;
        public final long time;

        Entry(String domain, boolean blocked, long time) {
            this.domain = domain;
            this.blocked = blocked;
            this.time = time;
        }
    }

    private static final int MAX_RECENT = 150;
    private static final ArrayDeque<Entry> recent = new ArrayDeque<>();

    public static final AtomicLong queries = new AtomicLong();
    public static final AtomicLong blocked = new AtomicLong();
    /** Bumped whenever anything changes so the UI knows when to redraw. */
    public static final AtomicLong version = new AtomicLong();

    public static volatile boolean running;
    public static volatile int listSize;
    public static volatile String status = "";

    static void record(String domain, boolean wasBlocked) {
        queries.incrementAndGet();
        if (wasBlocked) blocked.incrementAndGet();
        synchronized (recent) {
            Entry last = recent.peekFirst();
            // Apps often ask for the same name twice (A + AAAA); show it once.
            if (last == null || !last.domain.equals(domain) || last.blocked != wasBlocked) {
                recent.addFirst(new Entry(domain, wasBlocked, System.currentTimeMillis()));
                while (recent.size() > MAX_RECENT) recent.removeLast();
            }
        }
        version.incrementAndGet();
    }

    public static List<Entry> recent() {
        synchronized (recent) {
            return new ArrayList<>(recent);
        }
    }

    static void changed() {
        version.incrementAndGet();
    }
}
