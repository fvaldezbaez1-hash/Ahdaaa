package com.ahdaaa.adshield;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Domain block/allow rules. A rule for "example.com" also covers every
 * subdomain such as "ads.example.com". Pure Java so it can be unit tested.
 *
 * <p>Priority: your allowlist, then your blocklist, then exceptions from the
 * downloaded lists, then the downloaded lists themselves.
 */
public final class Blocklist {
    public static final Blocklist EMPTY = new Blocklist(
            Collections.emptySet(), Collections.emptySet(),
            Collections.emptySet(), Collections.emptySet());

    private final Set<String> userAllow;
    private final Set<String> userBlock;
    private final Set<String> listAllow;
    private final Set<String> listBlock;

    public Blocklist(Set<String> userAllow, Set<String> userBlock,
                     Set<String> listAllow, Set<String> listBlock) {
        this.userAllow = userAllow;
        this.userBlock = userBlock;
        this.listAllow = listAllow;
        this.listBlock = listBlock;
    }

    public int size() {
        return listBlock.size() + userBlock.size();
    }

    public boolean isBlocked(String domain) {
        String d = normalize(domain);
        if (d == null) return false;
        if (matches(userAllow, d)) return false;
        if (matches(userBlock, d)) return true;
        if (matches(listAllow, d)) return false;
        return matches(listBlock, d);
    }

    private static boolean matches(Set<String> rules, String domain) {
        if (rules.isEmpty()) return false;
        String d = domain;
        while (true) {
            if (rules.contains(d)) return true;
            int dot = d.indexOf('.');
            if (dot < 0) return false;
            d = d.substring(dot + 1);
        }
    }

    /** Lowercases, trims a trailing dot, and rejects anything that isn't a hostname. */
    public static String normalize(String s) {
        if (s == null) return null;
        s = s.trim().toLowerCase(Locale.ROOT);
        if (s.startsWith("*.")) s = s.substring(2);
        if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        if (s.isEmpty() || s.length() > 253 || s.indexOf('.') < 0) return null;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == '_';
            if (!ok) return null;
        }
        if (s.startsWith(".") || s.contains("..")) return null;
        return s;
    }

    private static final Set<String> IGNORED = new HashSet<>(java.util.Arrays.asList(
            "localhost", "localhost.localdomain", "local", "broadcasthost",
            "ip6-localhost", "ip6-loopback", "0.0.0.0"));

    /**
     * Reads a list in any of the common formats into the given sets:
     * hosts files ("0.0.0.0 ads.example.com"), plain domain lists, and
     * Adblock-style DNS rules ("||ads.example.com^", "@@||ok.example.com^").
     */
    public static void parse(Reader reader, Set<String> block, Set<String> allow) throws IOException {
        BufferedReader r = reader instanceof BufferedReader ? (BufferedReader) reader : new BufferedReader(reader);
        String line;
        while ((line = r.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty() || line.charAt(0) == '#' || line.charAt(0) == '!' || line.charAt(0) == '[') continue;

            if (line.startsWith("@@||")) {
                String d = adblockDomain(line.substring(4));
                if (d != null) allow.add(d);
                continue;
            }
            if (line.startsWith("||")) {
                String d = adblockDomain(line.substring(2));
                if (d != null) block.add(d);
                continue;
            }

            int hash = line.indexOf('#');
            if (hash >= 0) line = line.substring(0, hash).trim();
            String[] parts = line.split("\\s+");
            if (parts.length == 1) {
                addDomain(parts[0], block);
            } else if (isSinkholeAddress(parts[0])) {
                for (int i = 1; i < parts.length; i++) addDomain(parts[i], block);
            }
        }
    }

    private static boolean isSinkholeAddress(String s) {
        return s.equals("0.0.0.0") || s.equals("127.0.0.1") || s.equals("::") || s.equals("::1");
    }

    private static void addDomain(String raw, Set<String> into) {
        if (IGNORED.contains(raw)) return;
        String d = normalize(raw);
        if (d != null) into.add(d);
    }

    /** "ads.example.com^" or "ads.example.com^$important" -> "ads.example.com"; anything fancier is skipped. */
    private static String adblockDomain(String rest) {
        int caret = rest.indexOf('^');
        if (caret < 0) return null;
        String tail = rest.substring(caret + 1);
        if (!tail.isEmpty() && !tail.equals("$important")) return null;
        String d = rest.substring(0, caret);
        if (d.contains("*") || d.contains("/")) return null;
        return normalize(d);
    }
}
