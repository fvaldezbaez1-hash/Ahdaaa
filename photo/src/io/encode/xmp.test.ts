import { describe, expect, it } from 'vitest'
import { readKeywords } from '../decode/exif'
import { insertJpegSegments } from './jpeg'
import { encodePng } from './png'
import { iptcKeywords, xmpPacket } from './xmp'

const tinyJpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
const KEYWORDS = ['Beach', 'Família & friends', '<odd> "quoted"', '東京']

describe('keywords in exported files', () => {
  it('a JPEG carries them as XMP and UTF-8 IPTC, and they read back', async () => {
    const parts = insertJpegSegments(tinyJpeg, undefined, undefined, KEYWORDS)
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
    const k = await readKeywords(bytes)
    // XMP first, then the same keywords again from IPTC (the importer drops duplicates).
    expect(k.slice(0, 4)).toEqual(KEYWORDS)
    expect(k.slice(4)).toEqual(KEYWORDS)
  })

  it('no keywords: no extra segments', () => {
    expect(insertJpegSegments(tinyJpeg, undefined, undefined, [])).toHaveLength(2)
  })

  it('a PNG carries them in an iTXt XMP chunk', async () => {
    const png = await encodePng(new Uint8Array(4 * 4), 2, 2, { keywords: ['Night', 'Café'] })
    const bytes = new Uint8Array(await png.arrayBuffer())
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('iTXtXML:com.adobe.xmp')
    expect(text).toContain('<rdf:li>Café</rdf:li>')
  })

  it('XMP escapes markup; IPTC keeps each keyword within 64 bytes', () => {
    const xml = new TextDecoder().decode(xmpPacket(['a & b <c>']))
    expect(xml).toContain('<rdf:li>a &amp; b &lt;c&gt;</rdf:li>')
    const iptc = iptcKeywords(['é'.repeat(40)])
    // Datasets: 1:90 (3 bytes), 2:00 (2 bytes), then 2:25 whose length is ≤ 64 and doesn't split a character.
    const len = (iptc[5 + 3 + 5 + 2 + 3] << 8) | iptc[5 + 3 + 5 + 2 + 4]
    expect(len).toBe(64)
  })
})

describe('keywords in TIFF exports', () => {
  it('a 16-bit TIFF carries XMP and IPTC tags that read back', async () => {
    const { encodeTiff16 } = await import('./tiff')
    const tif = await encodeTiff16(new Uint16Array(4 * 4), 2, 2, { keywords: ['Snow', 'Zürich'] })
    const k = await readKeywords(new Uint8Array(await tif.arrayBuffer()))
    expect(k).toContain('Snow')
    expect(k).toContain('Zürich')
  })
})
