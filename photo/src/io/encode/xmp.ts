// Keywords in exported files, where Lightroom, Bridge, Apple Photos, Windows
// and stock sites look for them: an XMP packet (dc:subject) and, for JPEG and
// TIFF, the older IPTC-IIM record (2:25 Keywords, UTF-8). Phase 5.

const enc = new TextEncoder()

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** UTF-8 XMP packet with the keywords as dc:subject (an unordered bag, as Adobe writes it). */
export function xmpPacket(keywords: readonly string[]): Uint8Array {
  const items = keywords.map((k) => `     <rdf:li>${escapeXml(k)}</rdf:li>`).join('\n')
  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumen">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:subject>
    <rdf:Bag>
${items}
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  return enc.encode(xml)
}

/** Trim to at most `max` UTF-8 bytes without splitting a character. */
function utf8Max(s: string, max: number): Uint8Array {
  let b = enc.encode(s)
  while (b.length > max) {
    s = s.slice(0, -1)
    b = enc.encode(s)
  }
  return b
}

/** IPTC-IIM: record version, UTF-8 marker (1:90 ESC % G) and one 2:25 dataset per keyword (64 bytes max each). */
export function iptcKeywords(keywords: readonly string[]): Uint8Array {
  const sets: Uint8Array[] = []
  const dataset = (record: number, tag: number, data: Uint8Array) => {
    const out = new Uint8Array(5 + data.length)
    out.set([0x1c, record, tag, data.length >> 8, data.length & 255])
    out.set(data, 5)
    sets.push(out)
  }
  dataset(1, 90, Uint8Array.of(0x1b, 0x25, 0x47))
  dataset(2, 0, Uint8Array.of(0, 4))
  for (const k of keywords) dataset(2, 25, utf8Max(k, 64))
  const out = new Uint8Array(sets.reduce((n, s) => n + s.length, 0))
  let o = 0
  for (const s of sets) {
    out.set(s, o)
    o += s.length
  }
  return out
}

/** The Photoshop image resource block JPEG keeps IPTC in (APP13 "Photoshop 3.0"): one 8BIM 0x0404 resource. */
export function photoshopIptc(iptc: Uint8Array): Uint8Array {
  const pad = iptc.length & 1
  const out = new Uint8Array(12 + iptc.length + pad)
  out.set([0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0, 0]) // "8BIM", id 0x0404, empty Pascal name (padded to 2)
  new DataView(out.buffer).setUint32(8, iptc.length)
  out.set(iptc, 12)
  return out
}
