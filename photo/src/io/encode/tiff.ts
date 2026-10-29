// 16-bit RGB TIFF writer: little-endian, Adobe Deflate with horizontal
// differencing (predictor 2) in ~1 MB strips — what Lightroom calls "ZIP" — with
// EXIF and ICC tags. Strips are compressed one at a time to bound memory.
import { createDeflater, concat } from './deflate'
import { exifParts, type ExifInput } from './exif'
import { ascii, long, rational, serializeTiff, short, tiffSize, UNDEFINED, type Ifd, type Tag } from './tiffIfd'

const LITTLE_ENDIAN_HOST = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1

export interface TiffOptions {
  exif?: ExifInput
  icc?: Uint8Array
  /** Default true (deflate + predictor). */
  compress?: boolean
}

/** Encode RGBA16 pixels (alpha dropped) as a 16-bit RGB TIFF. */
export async function encodeTiff16(rgba: Uint16Array, width: number, height: number, opts: TiffOptions = {}): Promise<Blob> {
  const compress = opts.compress ?? true
  const rowSamples = width * 3
  const rowsPerStrip = Math.max(1, Math.floor((1 << 20) / (rowSamples * 2)))
  const strips: Uint8Array[] = []
  const row = new Uint16Array(rowSamples)
  for (let y0 = 0; y0 < height; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y0)
    const samples = new Uint16Array(rows * rowSamples)
    for (let r = 0; r < rows; r++) {
      const src = (y0 + r) * width * 4
      const o = r * rowSamples
      for (let x = 0; x < width; x++) {
        row[x * 3] = rgba[src + x * 4]
        row[x * 3 + 1] = rgba[src + x * 4 + 1]
        row[x * 3 + 2] = rgba[src + x * 4 + 2]
      }
      // Predictor 2: each sample minus the same channel of the previous pixel (mod 2^16).
      for (let i = 0; i < rowSamples; i++) samples[o + i] = compress && i >= 3 ? row[i] - row[i - 3] : row[i]
    }
    const strip = new Uint8Array(samples.buffer)
    if (!LITTLE_ENDIAN_HOST) for (let i = 0; i < strip.length; i += 2) [strip[i], strip[i + 1]] = [strip[i + 1], strip[i]]
    if (compress) {
      const d = createDeflater()
      await d.write(strip)
      strips.push(concat(await d.finish()))
    } else strips.push(strip)
  }

  const meta = opts.exif ? exifParts(opts.exif) : { tags: [ascii(0x0131, 'Lumen')], children: [] }
  const ifd = (offsets: number[]): Ifd => {
    const tags = new Map<number, Tag>()
    for (const t of meta.tags) tags.set(t.tag, t)
    for (const t of [
      long(254, 0),
      long(256, width),
      long(257, height),
      short(258, 16, 16, 16),
      short(259, compress ? 8 : 1),
      short(262, 2),
      long(273, ...offsets),
      short(274, 1),
      short(277, 3),
      long(278, rowsPerStrip),
      long(279, ...strips.map((s) => s.length)),
      rational(282, 300, 1),
      rational(283, 300, 1),
      short(284, 1),
      short(296, 2),
      ...(compress ? [short(317, 2)] : []),
      ...(opts.icc ? [{ tag: 34675, type: UNDEFINED, value: opts.icc } satisfies Tag] : []),
    ])
      tags.set(t.tag, t)
    return { tags: [...tags.values()], children: meta.children }
  }
  // Header and directories first, then the strips (sizes don't depend on offset values).
  let at = tiffSize(ifd(strips.map(() => 0)))
  const offsets = strips.map((s) => {
    const o = at
    at += s.length
    return o
  })
  return new Blob([serializeTiff(ifd(offsets), true) as Uint8Array<ArrayBuffer>, ...(strips as Uint8Array<ArrayBuffer>[])], { type: 'image/tiff' })
}
