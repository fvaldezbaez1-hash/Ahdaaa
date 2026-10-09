package com.ahdaaa.adshield;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import org.junit.Test;

public class PacketsTest {
    private static byte[] dnsQuery(String name, int type) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(0x12); b.write(0x34); // id
        b.write(0x01); b.write(0x00); // RD
        b.write(0); b.write(1); // QDCOUNT
        for (int i = 0; i < 6; i++) b.write(0);
        for (String label : name.split("\\.")) {
            b.write(label.length());
            b.write(label.getBytes(), 0, label.length());
        }
        b.write(0);
        b.write(type >> 8); b.write(type);
        b.write(0); b.write(1);
        return b.toByteArray();
    }

    private static byte[] ipv4Udp(byte[] payload) {
        Packets.UdpPacket fake = new Packets.UdpPacket(
                new byte[] {10, 111, (byte) 222, 2}, new byte[] {10, 111, (byte) 222, 1}, 53, 40000, payload);
        // buildUdpReply swaps src/dst, so this yields 10.111.222.1:40000 -> 10.111.222.2:53
        return Packets.buildUdpReply(fake, payload);
    }

    @Test
    public void roundTripsUdp() {
        byte[] q = dnsQuery("ads.example.com", 1);
        byte[] pkt = ipv4Udp(q);
        assertEquals(0, Packets.ipChecksum(pkt, 0, 20));
        Packets.UdpPacket p = Packets.parseUdp(pkt, pkt.length);
        assertNotNull(p);
        assertEquals(53, p.dstPort);
        assertEquals(40000, p.srcPort);
        assertArrayEquals(q, p.payload);
        assertArrayEquals(new byte[] {10, 111, (byte) 222, 2}, p.dstAddr);
    }

    @Test
    public void rejectsNonUdp() {
        byte[] pkt = ipv4Udp(dnsQuery("a.com", 1));
        pkt[9] = 6; // TCP
        assertNull(Packets.parseUdp(pkt, pkt.length));
        assertNull(Packets.parseUdp(new byte[10], 10));
    }

    @Test
    public void parsesQuestionAndBuildsBlockedA() {
        byte[] q = dnsQuery("Ads.Example.com", 1);
        Packets.Question question = Packets.parseQuestion(q);
        assertNotNull(question);
        assertEquals("ads.example.com", question.name);
        assertEquals(1, question.type);

        byte[] ans = Packets.blockedAnswer(q, question);
        assertEquals(q.length + 16, ans.length);
        assertEquals(0x12, ans[0]);
        assertEquals((byte) 0x81, ans[2]); // QR + RD
        assertEquals(1, ans[7]); // ANCOUNT
        assertEquals(4, ans[ans.length - 5]); // rdlength
    }

    @Test
    public void blockedOtherTypeHasNoAnswer() {
        byte[] q = dnsQuery("ads.example.com", 65);
        byte[] ans = Packets.blockedAnswer(q, Packets.parseQuestion(q));
        assertEquals(q.length, ans.length);
        assertEquals(0, ans[7]);
    }

    @Test
    public void rejectsTruncatedQuestion() {
        byte[] q = dnsQuery("ads.example.com", 1);
        byte[] cut = java.util.Arrays.copyOf(q, q.length - 3);
        assertNull(Packets.parseQuestion(cut));
    }
}
