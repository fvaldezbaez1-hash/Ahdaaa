package com.ahdaaa.adshield;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.StringReader;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

public class BlocklistTest {
    private static Blocklist parse(String text) throws Exception {
        Set<String> block = new HashSet<>();
        Set<String> allow = new HashSet<>();
        Blocklist.parse(new StringReader(text), block, allow);
        return new Blocklist(new HashSet<>(), new HashSet<>(), allow, block);
    }

    @Test
    public void parsesHostsFormat() throws Exception {
        Blocklist b = parse("# comment\n127.0.0.1 localhost\n0.0.0.0 ads.example.com tracker.example.org # trailing\n");
        assertTrue(b.isBlocked("ads.example.com"));
        assertTrue(b.isBlocked("tracker.example.org"));
        assertFalse(b.isBlocked("localhost"));
        assertFalse(b.isBlocked("example.com"));
        assertEquals(2, b.size());
    }

    @Test
    public void parsesDomainAndAdblockFormats() throws Exception {
        Blocklist b = parse("doubleclick.net\n*.wild.com\n||adserver.io^\n||x.com^$third-party\n@@||ok.adserver.io^\n||a*.com^\n");
        assertTrue(b.isBlocked("doubleclick.net"));
        assertTrue(b.isBlocked("stats.g.doubleclick.net"));
        assertTrue(b.isBlocked("cdn.wild.com"));
        assertTrue(b.isBlocked("adserver.io"));
        assertFalse(b.isBlocked("ok.adserver.io"));
        assertFalse(b.isBlocked("x.com"));
        assertEquals(3, b.size());
    }

    @Test
    public void userRulesWin() {
        Set<String> listBlock = new HashSet<>();
        listBlock.add("example.com");
        Set<String> userAllow = new HashSet<>();
        userAllow.add("good.example.com");
        Set<String> userBlock = new HashSet<>();
        userBlock.add("bad.net");
        Blocklist b = new Blocklist(userAllow, userBlock, new HashSet<>(), listBlock);
        assertTrue(b.isBlocked("www.example.com"));
        assertFalse(b.isBlocked("good.example.com"));
        assertFalse(b.isBlocked("cdn.good.example.com"));
        assertTrue(b.isBlocked("BAD.net."));
        assertFalse(b.isBlocked("notbad.net"));
    }
}
