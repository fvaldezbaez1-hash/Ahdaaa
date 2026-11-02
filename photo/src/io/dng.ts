// Linear DNG files written by Lumen (HDR and panorama merges): 16-bit RGB
// LinearRaw in a SubIFD, a JPEG preview in IFD0 (Adobe's layout), EXIF copied
// from the first source and Software "Lumen". Opened like any RAW: LibRaw
// develops it; readLumenDng() reads it back exactly where LibRaw can't run.
//
// Colour: the data are white-balanced camera RGB (what Lumen's RAW decode
// produces). ColorMatrix1 is XYZ → that RGB (the source's XYZ → camera
// matrix with the as-shot multipliers applied), AsShotNeutral is 1, 1, 1,
// so LibRaw neither rescales nor clips the channels and the photo opens with
// the source's white balance. JPEG sources: linear sRGB and its matrix.
// BaselineExposure tells how many stops the data were scaled down to fit
// 16 bits (a DNG reader brightens by it; Lumen sets the recipe's exposure).
//
// Strips are uncompressed: LibRaw in the browser has no zlib, and Lumen's
// decode path must open what it writes. IFDs go at the end of the file so
// huge outputs can be written row by row.
import type { Mat3, Vec3 } from '../color/matrices'
import { exifDate } from './encode/exif'
import type { PhotoMeta } from './types'

const BYTE = 1, ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5, UNDEFINED = 7, SRATIONAL = 10
type Type = typeof BYTE | typeof ASCII | typeof SHORT | typeof LONG | typeof RATIONAL | typeof UNDEFINED | typeof SRATIONAL
const SIZE: Record<Type, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 }

interface Tag {
  tag: number
  type: Type
  /** RATIONAL / SRATIONAL: plain numbers (converted to fractions). ASCII: text. */
  value: number[] | string | Uint8Array
}
interface Ifd {
  tags: Tag[]
  /** Sub-directories referenced by a LONG pointer tag (SubIFDs 330, EXIF 34665). */
  children?: { tag: number; ifd: Ifd }[]
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/** A rational close to x: denominators 10000 (|x| < 200000) or 1. */
function toFraction(x: number): [number, number] {
  if (!Number.isFinite(x)) return [0, 1]
  if (Math.abs(x) < 200000) return [Math.round(x * 10000), 10000]
  return [Math.round(x), 1]
}

function payload(t: Tag): { count: number; bytes: number; write: (v: DataView, at: number) => void } {
  if (t.type === ASCII) {
    const b = enc.encode(t.value as string)
    return { count: b.length + 1, bytes: b.length + 1, write: (v, at) => b.forEach((x, i) => v.setUint8(at + i, x)) }
  }
  if (t.value instanceof Uint8Array) {
    const b = t.value
    return { count: b.length, bytes: b.length, write: (v, at) => b.forEach((x, i) => v.setUint8(at + i, x)) }
  }
  const vals = t.value as number[]
  const n = vals.length
  return {
    count: n,
    bytes: n * SIZE[t.type],
    write: (v, at) => {
      vals.forEach((x, i) => {
        if (t.type === BYTE || t.type === UNDEFINED) v.setUint8(at + i, x)
        else if (t.type === SHORT) v.setUint16(at + i * 2, x, true)
        else if (t.type === LONG) v.setUint32(at + i * 4, x >>> 0, true)
        else {
          const [num, den] = toFraction(t.type === RATIONAL ? Math.max(0, x) : x)
          if (t.type === RATIONAL) v.setUint32(at + i * 8, num, true)
          else v.setInt32(at + i * 8, num, true)
          v.setUint32(at + i * 8 + 4, den, true)
        }
      })
    },
  }
}

function ifdBytes(ifd: Ifd): number {
  let n = 2 + 12 * (ifd.tags.length + (ifd.children?.length ?? 0)) + 4
  for (const t of ifd.tags) {
    const b = payload(t).bytes
    if (b > 4) n += b + (b & 1)
  }
  return n + (ifd.children ?? []).reduce((s, c) => s + ifdBytes(c.ifd), 0)
}

/** Serialize an IFD tree to be placed at absolute file offset `base`. */
function serializeIfds(root: Ifd, base: number): Uint8Array {
  const out = new Uint8Array(ifdBytes(root))
  const v = new DataView(out.buffer)
  const write = (ifd: Ifd, at: number): number => {
    const own = 2 + 12 * (ifd.tags.length + (ifd.children?.length ?? 0)) + 4
    let data = at + own
    const entries: { tag: number; fill: (e: number) => void }[] = []
    for (const t of ifd.tags) {
      const p = payload(t)
      const where = p.bytes > 4 ? data : -1
      if (p.bytes > 4) data += p.bytes + (p.bytes & 1)
      entries.push({
        tag: t.tag,
        fill: (e) => {
          v.setUint16(e, t.tag, true)
          v.setUint16(e + 2, t.type, true)
          v.setUint32(e + 4, p.count, true)
          if (where < 0) p.write(v, e + 8)
          else {
            v.setUint32(e + 8, base + where, true)
            p.write(v, where)
          }
        },
      })
    }
    let next = data
    for (const c of ifd.children ?? []) {
      const childAt = next
      next = write(c.ifd, childAt)
      entries.push({
        tag: c.tag,
        fill: (e) => {
          v.setUint16(e, c.tag, true)
          v.setUint16(e + 2, LONG, true)
          v.setUint32(e + 4, 1, true)
          v.setUint32(e + 8, base + childAt, true)
        },
      })
    }
    entries.sort((a, b) => a.tag - b.tag)
    v.setUint16(at, entries.length, true)
    entries.forEach((e, i) => e.fill(at + 2 + i * 12))
    v.setUint32(at + 2 + entries.length * 12, 0, true)
    return next
  }
  write(root, 0)
  return out
}

export interface DngInfo {
  width: number
  height: number
  /** XYZ (D65) → the data's RGB. */
  colorMatrix: Mat3
  /** Default 1, 1, 1 (the data are already white-balanced). */
  asShotNeutral?: Vec3
  /** Stops a reader should brighten by (the data were scaled down to fit 16 bits). */
  baselineExposure: number
  /** EXIF orientation of the pixels (default 1: stored upright). */
  orientation?: number
  /** EXIF to keep (from the first source). */
  meta: PhotoMeta
  /** Shown by other apps as the camera ("Lumen HDR (SONY ILME-FX30)"). */
  uniqueCameraModel: string
  /** Embedded preview (baseline JPEG) for viewers that can't develop the raw data. */
  preview?: { jpeg: Uint8Array; width: number; height: number }
  now?: number
}

const LITTLE_ENDIAN_HOST = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1

/**
 * Writes a DNG row by row: give it the RGB16 rows in order (any number at a
 * time), then finish(). Memory stays at one strip beyond what the Blob holds.
 */
export class DngWriter {
  private readonly info: DngInfo
  private readonly rowsPerStrip: number
  private readonly parts: BlobPart[] = []
  private readonly stripBytes: number[] = []
  private pending: Uint16Array
  private pendingRows = 0
  private rows = 0
  private readonly previewBytes: number

  constructor(info: DngInfo) {
    this.info = info
    this.rowsPerStrip = Math.max(1, Math.min(info.height, Math.floor((1 << 20) / (info.width * 6))))
    this.pending = new Uint16Array(this.rowsPerStrip * info.width * 3)
    this.previewBytes = info.preview ? info.preview.jpeg.length + (info.preview.jpeg.length & 1) : 0
    if (info.preview) this.parts.push(info.preview.jpeg as Uint8Array<ArrayBuffer>, new Uint8Array(info.preview.jpeg.length & 1))
  }

  /** Append rows (interleaved RGB, width × rows × 3 values). */
  addRows(data: Uint16Array): void {
    const W = this.info.width * 3
    if (data.length % W) throw new Error('DNG rows must be whole rows')
    for (let o = 0; o < data.length; ) {
      const take = Math.min(data.length - o, (this.rowsPerStrip - this.pendingRows) * W)
      this.pending.set(data.subarray(o, o + take), this.pendingRows * W)
      this.pendingRows += take / W
      o += take
      if (this.pendingRows === this.rowsPerStrip) this.flush()
    }
  }

  private flush() {
    if (!this.pendingRows) return
    const n = this.pendingRows * this.info.width * 3
    const strip = this.pending.slice(0, n)
    const bytes = new Uint8Array(strip.buffer)
    if (!LITTLE_ENDIAN_HOST) for (let i = 0; i < bytes.length; i += 2) [bytes[i], bytes[i + 1]] = [bytes[i + 1], bytes[i]]
    this.parts.push(bytes)
    this.stripBytes.push(bytes.length)
    this.rows += this.pendingRows
    this.pendingRows = 0
  }

  finish(): Blob {
    this.flush()
    const i = this.info
    if (this.rows !== i.height) throw new Error(`DNG has ${this.rows} rows, expected ${i.height}`)
    const dataStart = 8 + this.previewBytes
    let at = dataStart
    const offsets = this.stripBytes.map((n) => {
      const o = at
      at += n
      return o
    })
    const ifdAt = at
    const m = i.meta
    const now = i.now ?? Date.now()
    const raw: Ifd = {
      tags: [
        { tag: 254, type: LONG, value: [0] },
        { tag: 256, type: LONG, value: [i.width] },
        { tag: 257, type: LONG, value: [i.height] },
        { tag: 258, type: SHORT, value: [16, 16, 16] },
        { tag: 259, type: SHORT, value: [1] },
        { tag: 262, type: SHORT, value: [34892] }, // LinearRaw
        { tag: 273, type: LONG, value: offsets },
        { tag: 277, type: SHORT, value: [3] },
        { tag: 278, type: LONG, value: [this.rowsPerStrip] },
        { tag: 279, type: LONG, value: this.stripBytes },
        { tag: 284, type: SHORT, value: [1] },
        { tag: 50717, type: LONG, value: [65535, 65535, 65535] }, // WhiteLevel
      ],
    }
    const exif: Tag[] = [{ tag: 0x9000, type: UNDEFINED, value: Uint8Array.from([0x30, 0x32, 0x33, 0x32]) }]
    if (m.shutter && m.shutter > 0) exif.push({ tag: 0x829a, type: RATIONAL, value: [m.shutter] })
    if (m.aperture && m.aperture > 0) exif.push({ tag: 0x829d, type: RATIONAL, value: [m.aperture] })
    if (m.iso && m.iso > 0) exif.push({ tag: 0x8827, type: SHORT, value: [Math.min(65535, Math.round(m.iso))] })
    if (m.takenAt) exif.push({ tag: 0x9003, type: ASCII, value: exifDate(m.takenAt) }, { tag: 0x9004, type: ASCII, value: exifDate(m.takenAt) })
    if (m.focalLength && m.focalLength > 0) exif.push({ tag: 0x920a, type: RATIONAL, value: [m.focalLength] })
    if (m.lens) exif.push({ tag: 0xa434, type: ASCII, value: m.lens })
    const cm = i.colorMatrix
    const n = i.asShotNeutral ?? [1, 1, 1]
    const ifd0Tags: Tag[] = [
      { tag: 274, type: SHORT, value: [i.orientation ?? 1] },
      { tag: 305, type: ASCII, value: 'Lumen' },
      { tag: 306, type: ASCII, value: exifDate(now) },
      { tag: 50706, type: BYTE, value: [1, 4, 0, 0] }, // DNGVersion
      { tag: 50707, type: BYTE, value: [1, 1, 0, 0] }, // DNGBackwardVersion
      { tag: 50708, type: ASCII, value: i.uniqueCameraModel },
      { tag: 50721, type: SRATIONAL, value: [...cm] }, // ColorMatrix1
      { tag: 50778, type: SHORT, value: [21] }, // CalibrationIlluminant1 = D65
      { tag: 50728, type: RATIONAL, value: [...n] }, // AsShotNeutral
      { tag: 50730, type: SRATIONAL, value: [i.baselineExposure] }, // BaselineExposure
    ]
    if (m.make) ifd0Tags.push({ tag: 271, type: ASCII, value: m.make })
    if (m.model) ifd0Tags.push({ tag: 272, type: ASCII, value: m.model })
    if (m.artist) ifd0Tags.push({ tag: 315, type: ASCII, value: m.artist })
    if (m.copyright) ifd0Tags.push({ tag: 33432, type: ASCII, value: m.copyright })
    if (i.preview) {
      ifd0Tags.push(
        { tag: 254, type: LONG, value: [1] }, // reduced-resolution preview; the raw image is in the SubIFD
        { tag: 256, type: LONG, value: [i.preview.width] },
        { tag: 257, type: LONG, value: [i.preview.height] },
        { tag: 258, type: SHORT, value: [8, 8, 8] },
        { tag: 259, type: SHORT, value: [7] }, // JPEG
        { tag: 262, type: SHORT, value: [6] }, // YCbCr
        { tag: 273, type: LONG, value: [8] },
        { tag: 277, type: SHORT, value: [3] },
        { tag: 278, type: LONG, value: [i.preview.height] },
        { tag: 279, type: LONG, value: [i.preview.jpeg.length] },
        { tag: 284, type: SHORT, value: [1] },
      )
    }
    // Without a preview the raw image is IFD0 itself.
    const root: Ifd = i.preview
      ? { tags: ifd0Tags, children: [{ tag: 330, ifd: raw }, { tag: 34665, ifd: { tags: exif } }] }
      : { tags: [...raw.tags, ...ifd0Tags], children: [{ tag: 34665, ifd: { tags: exif } }] }
    const ifds = serializeIfds(root, ifdAt)
    const header = new Uint8Array(8)
    const hv = new DataView(header.buffer)
    header.set([0x49, 0x49, 42, 0])
    hv.setUint32(4, ifdAt, true)
    return new Blob([header, ...this.parts, ifds as Uint8Array<ArrayBuffer>], { type: 'image/x-adobe-dng' })
  }
}

/** Write a whole image at once. */
export function writeDng(data: Uint16Array, info: DngInfo): Blob {
  const w = new DngWriter(info)
  w.addRows(data)
  return w.finish()
}

// ---------- reading back (Lumen's own files) ----------

export interface LumenDng {
  width: number
  height: number
  data: Uint16Array
  colorMatrix: Mat3
  asShotNeutral: Vec3
  baselineExposure: number
  orientation: number
  software: string
  make?: string
  model?: string
  uniqueCameraModel?: string
}

/**
 * Read an uncompressed 16-bit LinearRaw DNG (what DngWriter makes). Returns
 * null for any other file (other DNGs go through LibRaw).
 */
export function readLumenDng(buf: ArrayBuffer): LumenDng | null {
  const v = new DataView(buf)
  if (buf.byteLength < 8 || v.getUint16(0) !== 0x4949 || v.getUint16(2, true) !== 42) return null
  const read = (at: number) => {
    const tags = new Map<number, { type: number; count: number; at: number }>()
    const n = v.getUint16(at, true)
    for (let k = 0; k < n; k++) {
      const e = at + 2 + k * 12
      const type = v.getUint16(e + 2, true), count = v.getUint32(e + 4, true)
      const size = (SIZE[type as Type] ?? 1) * count
      tags.set(v.getUint16(e, true), { type, count, at: size > 4 ? v.getUint32(e + 8, true) : e + 8 })
    }
    return tags
  }
  type Tags = ReturnType<typeof read>
  const nums = (t: Tags, tag: number): number[] => {
    const e = t.get(tag)
    if (!e) return []
    const out: number[] = []
    for (let k = 0; k < e.count; k++) {
      if (e.type === SHORT) out.push(v.getUint16(e.at + k * 2, true))
      else if (e.type === LONG) out.push(v.getUint32(e.at + k * 4, true))
      else if (e.type === RATIONAL) out.push(v.getUint32(e.at + k * 8, true) / (v.getUint32(e.at + k * 8 + 4, true) || 1))
      else if (e.type === SRATIONAL) out.push(v.getInt32(e.at + k * 8, true) / (v.getInt32(e.at + k * 8 + 4, true) || 1))
      else out.push(v.getUint8(e.at + k))
    }
    return out
  }
  const str = (t: Tags, tag: number): string | undefined => {
    const e = t.get(tag)
    return e ? dec.decode(new Uint8Array(buf, e.at, e.count)).replace(/\0+$/, '') : undefined
  }
  const ifd0 = read(v.getUint32(4, true))
  const software = str(ifd0, 305) ?? ''
  const sub = nums(ifd0, 330)[0]
  const rawIfd = sub ? read(sub) : ifd0
  if (nums(rawIfd, 262)[0] !== 34892 || nums(rawIfd, 259)[0] !== 1 || nums(rawIfd, 277)[0] !== 3 || nums(rawIfd, 258).some((b) => b !== 16)) return null
  const width = nums(rawIfd, 256)[0], height = nums(rawIfd, 257)[0]
  const offsets = nums(rawIfd, 273), counts = nums(rawIfd, 279)
  const data = new Uint16Array(width * height * 3)
  const bytes = new Uint8Array(data.buffer)
  let o = 0
  offsets.forEach((off, k) => {
    bytes.set(new Uint8Array(buf, off, counts[k]), o)
    o += counts[k]
  })
  if (o !== bytes.length) return null
  if (!LITTLE_ENDIAN_HOST) for (let k = 0; k < bytes.length; k += 2) [bytes[k], bytes[k + 1]] = [bytes[k + 1], bytes[k]]
  const cm = nums(ifd0, 50721)
  const n = nums(ifd0, 50728)
  return {
    width,
    height,
    data,
    colorMatrix: (cm.length === 9 ? cm : [1, 0, 0, 0, 1, 0, 0, 0, 1]) as Mat3,
    asShotNeutral: (n.length === 3 ? n : [1, 1, 1]) as Vec3,
    baselineExposure: nums(ifd0, 50730)[0] ?? 0,
    orientation: nums(ifd0, 274)[0] ?? 1,
    software,
    make: str(ifd0, 271),
    model: str(ifd0, 272),
    uniqueCameraModel: str(ifd0, 50708),
  }
}
