import { inflateSync } from 'node:zlib'
import exifr from 'exifr'
import * as UTIF from 'utif2'
import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32'
import { exifTiff, type ExifInput } from './exif'
import { displayP3Profile } from './icc'
import { insertJpegSegments } from './jpeg'
import { encodePng } from './png'
import { encodeTiff16 } from './tiff'

const meta: ExifInput['meta'] = {
  make: 'SONY',
  model: 'ILME-FX30',
  lens: 'E 18-135mm F3.5-5.6 OSS',
  iso: 800,
  shutter: 1 / 250,
  aperture: 5.6,
  focalLength: 35,
  takenAt: new Date(2023, 3, 29, 0, 1, 20).getTime(),
  gps: { lat: -33.8568, lon: 151.2153, alt: 12.5 },
  artist: 'Ada',
}

const input = (includeGps: boolean): ExifInput => ({ meta, width: 600, height: 400, colorSpace: 'srgb', includeGps, now: Date.UTC(2026, 0, 2) })

/** Smallest JPEG-shaped container exifr will read: SOI, our segments, EOI. */
const fakeJpeg = (exif: Uint8Array, icc?: Uint8Array) => Buffer.concat(insertJpegSegments(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), exif, icc))

function chunks(png: Uint8Array) {
  const out: { type: string; data: Uint8Array }[] = []
  const v = new DataView(png.buffer, png.byteOffset)
  for (let at = 8; at < png.length; ) {
    const len = v.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + len)
    expect(v.getUint32(at + 8 + len), `${type} CRC`).toBe(crc32(png.subarray(at + 4, at + 8 + len)))
    out.push({ type, data })
    at += 12 + len
  }
  return out
}

function unfilter(raw: Uint8Array, rowBytes: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (rowBytes + 1)]
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[y * (rowBytes + 1) + 1 + i]
      const a = i >= bpp ? out[y * rowBytes + i - bpp] : 0
      const b = y ? out[(y - 1) * rowBytes + i] : 0
      const c = y && i >= bpp ? out[(y - 1) * rowBytes + i - bpp] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]
      out[y * rowBytes + i] = (x + pred) & 255
    }
  }
  return out
}

/** A smooth gradient with noise, so every PNG filter gets picked somewhere. */
function testImage<T extends Uint8ClampedArray | Uint16Array>(make: (n: number) => T, w: number, h: number, max: number): T {
  const px = make(w * h * 4)
  let seed = 7
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const x = i % w, y = Math.floor(i / w)
    px[i * 4] = Math.round((x / w) * max)
    px[i * 4 + 1] = Math.round((y / h) * max)
    px[i * 4 + 2] = seed % (max + 1)
    px[i * 4 + 3] = max
  }
  return px
}

describe('EXIF writer', () => {
  it('round-trips through exifr', async () => {
    const t = await exifr.parse(fakeJpeg(exifTiff(input(true))), { gps: true, reviveValues: true, translateValues: false })
    expect(t.Make).toBe('SONY')
    expect(t.Model).toBe('ILME-FX30')
    expect(t.LensModel).toBe('E 18-135mm F3.5-5.6 OSS')
    expect(t.ISO).toBe(800)
    expect(t.ExposureTime).toBeCloseTo(1 / 250, 6)
    expect(t.FNumber).toBeCloseTo(5.6)
    expect(t.FocalLength).toBe(35)
    expect(t.Orientation).toBe(1)
    expect(t.Software).toBe('Lumen')
    expect(t.Artist).toBe('Ada')
    expect(t.ColorSpace).toBe(1)
    expect(t.ExifImageWidth).toBe(600)
    expect((t.DateTimeOriginal as Date).getTime()).toBe(meta.takenAt)
    expect(t.latitude).toBeCloseTo(-33.8568, 4)
    expect(t.longitude).toBeCloseTo(151.2153, 4)
    expect(t.GPSAltitude).toBeCloseTo(12.5)
  })

  it('leaves GPS out when location is stripped', async () => {
    const t = await exifr.parse(fakeJpeg(exifTiff(input(false))), { gps: true })
    expect(t.Make).toBe('SONY')
    expect(t.latitude).toBeUndefined()
    expect(t.GPSLatitude).toBeUndefined()
  })
})

describe('ICC profile', () => {
  const icc = displayP3Profile()
  const v = new DataView(icc.buffer)
  const sig = (at: number) => String.fromCharCode(...icc.subarray(at, at + 4))
  const tags = new Map<string, number>()
  for (let i = 0; i < v.getUint32(128); i++) tags.set(sig(132 + i * 12), v.getUint32(136 + i * 12))
  const xyz = (name: string) => [0, 1, 2].map((k) => v.getInt32(tags.get(name)! + 8 + k * 4) / 65536)

  it('has a valid v4 display header and the required tags', () => {
    expect(v.getUint32(0)).toBe(icc.length)
    expect(icc.length % 4).toBe(0)
    expect(v.getUint32(8)).toBe(0x04300000)
    expect([sig(12), sig(16), sig(20), sig(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp'])
    for (const t of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'chad']) expect(tags.has(t), t).toBe(true)
    expect(sig(tags.get('rTRC')!)).toBe('para')
    expect(v.getUint16(tags.get('rTRC')! + 8)).toBe(3)
  })

  it('primaries add up to the D50 white and match Display P3', () => {
    const [r, g, b] = [xyz('rXYZ'), xyz('gXYZ'), xyz('bXYZ')]
    const white = [0, 1, 2].map((k) => r[k] + g[k] + b[k])
    expect(white[0]).toBeCloseTo(0.9642, 3)
    expect(white[1]).toBeCloseTo(1, 3)
    expect(white[2]).toBeCloseTo(0.8249, 3)
    // Published D50-adapted Display P3 red primary.
    expect(r[0]).toBeCloseTo(0.5151, 3)
    expect(r[1]).toBeCloseTo(0.2412, 3)
  })

  it('is embedded in JPEG APP2', () => {
    const jpeg = Buffer.concat(insertJpegSegments(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), undefined, icc))
    expect(jpeg.subarray(6, 18).toString('latin1')).toBe('ICC_PROFILE\0')
    expect(jpeg.readUInt16BE(4)).toBe(2 + 14 + icc.length)
  })
})

describe('PNG writer', () => {
  for (const bits of [8, 16] as const) {
    it(`${bits}-bit: valid chunks, pixels survive inflate + unfilter`, async () => {
      const w = 97, h = 61
      const rgba = bits === 8 ? testImage((n) => new Uint8ClampedArray(n), w, h, 255) : testImage((n) => new Uint16Array(n), w, h, 65535)
      const png = new Uint8Array(await (await encodePng(rgba, w, h, { icc: { name: 'Display P3', data: displayP3Profile() }, exif: exifTiff(input(false)) })).arrayBuffer())
      const cs = chunks(png)
      expect(cs.map((c) => c.type)).toEqual(['IHDR', 'iCCP', 'eXIf', ...cs.slice(3, -1).map(() => 'IDAT'), 'IEND'])
      const ihdr = new DataView(cs[0].data.buffer, cs[0].data.byteOffset)
      expect([ihdr.getUint32(0), ihdr.getUint32(4), cs[0].data[8], cs[0].data[9]]).toEqual([w, h, bits, 2])
      expect(inflateSync(cs[1].data.subarray('Display P3'.length + 2)).equals(Buffer.from(displayP3Profile()))).toBe(true)
      const bpp = bits === 8 ? 3 : 6
      const raw = unfilter(inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data))), w * bpp, h, bpp)
      for (let i = 0; i < w * h; i++)
        for (let c = 0; c < 3; c++) {
          const got = bits === 8 ? raw[i * 3 + c] : (raw[i * 6 + c * 2] << 8) | raw[i * 6 + c * 2 + 1]
          if (got !== rgba[i * 4 + c]) throw new Error(`pixel ${i} channel ${c}: ${got} ≠ ${rgba[i * 4 + c]}`)
        }
      expect((await exifr.parse(Buffer.from(png), { tiff: true })).Software).toBe('Lumen')
    })
  }

  it('writes an sRGB chunk when no profile is given', async () => {
    const png = new Uint8Array(await (await encodePng(new Uint8ClampedArray(16), 2, 2, { srgb: true })).arrayBuffer())
    expect(chunks(png).map((c) => c.type)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
  })
})

describe('TIFF writer', () => {
  for (const compress of [true, false]) {
    it(`16-bit RGB ${compress ? 'deflate+predictor' : 'uncompressed'} decodes back exactly, with EXIF and ICC`, async () => {
      const w = 300, h = 1900 // several strips
      const rgba = testImage((n) => new Uint16Array(n), w, h, 65535)
      const buf = await (await encodeTiff16(rgba, w, h, { compress, icc: displayP3Profile(), exif: { ...input(true), width: w, height: h } })).arrayBuffer()
      const [ifd] = UTIF.decode(buf)
      expect(ifd.t258).toEqual([16, 16, 16])
      expect(ifd.t259).toEqual([compress ? 8 : 1])
      expect((ifd.t34675 as unknown as Uint8Array).length).toBe(displayP3Profile().length)
      UTIF.decodeImage(buf, ifd)
      const px = new DataView(ifd.data.buffer, ifd.data.byteOffset)
      for (let i = 0; i < w * h; i++)
        for (let c = 0; c < 3; c++) {
          const got = px.getUint16((i * 3 + c) * 2, true)
          if (got !== rgba[i * 4 + c]) throw new Error(`pixel ${i} channel ${c}: ${got} ≠ ${rgba[i * 4 + c]}`)
        }
      const t = await exifr.parse(Buffer.from(buf), { gps: true })
      expect(t.Model).toBe('ILME-FX30')
      expect(t.ISO).toBe(800)
      expect(t.latitude).toBeCloseTo(-33.8568, 4)
    })
  }
})
