// Minimal TIFF structure writer: a tree of IFDs (image file directories) laid
// out after the 8-byte header, values > 4 bytes in each IFD's data area. Used
// for the EXIF block of JPEG/PNG exports and for 16-bit TIFF files.

export const BYTE = 1, ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5, UNDEFINED = 7

export type TagType = typeof BYTE | typeof ASCII | typeof SHORT | typeof LONG | typeof RATIONAL | typeof UNDEFINED

export interface Tag {
  tag: number
  type: TagType
  /** ASCII: the text. RATIONAL: flat [num, den, num, den…]. Others: the values. */
  value: string | number[] | Uint8Array
}

export interface Ifd {
  tags: Tag[]
  /** Pointers to child IFDs (EXIF 0x8769, GPS 0x8825). */
  children?: { tag: number; ifd: Ifd }[]
}

const TYPE_SIZE: Record<TagType, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }

export const ascii = (tag: number, text: string): Tag => ({ tag, type: ASCII, value: text })
export const short = (tag: number, ...v: number[]): Tag => ({ tag, type: SHORT, value: v })
export const long = (tag: number, ...v: number[]): Tag => ({ tag, type: LONG, value: v })
export const rational = (tag: number, ...v: number[]): Tag => ({ tag, type: RATIONAL, value: v })

/** Rational with a fixed denominator (non-negative values only). */
export const frac = (x: number, den: number): [number, number] => [Math.max(0, Math.round(x * den)), den]

const enc = new TextEncoder()

function payload(t: Tag): Uint8Array | number[] {
  if (t.type === ASCII) {
    const b = enc.encode(t.value as string)
    const out = new Uint8Array(b.length + 1)
    out.set(b)
    return out
  }
  return t.value as number[] | Uint8Array
}

function count(t: Tag, p: Uint8Array | number[]): number {
  return t.type === RATIONAL ? p.length / 2 : p.length
}

function byteLength(t: Tag, p: Uint8Array | number[]): number {
  return count(t, p) * TYPE_SIZE[t.type]
}

function ifdSize(ifd: Ifd): number {
  let size = 2 + 12 * (ifd.tags.length + (ifd.children?.length ?? 0)) + 4
  for (const t of ifd.tags) {
    const n = byteLength(t, payload(t))
    if (n > 4) size += n + (n & 1)
  }
  return size
}

/** Serialized size of the tree, header included — stable for a given set of tags/counts. */
export function tiffSize(root: Ifd): number {
  const walk = (ifd: Ifd): number => ifdSize(ifd) + (ifd.children ?? []).reduce((s, c) => s + walk(c.ifd), 0)
  return 8 + walk(root)
}

export function serializeTiff(root: Ifd, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(tiffSize(root))
  const v = new DataView(out.buffer)
  const le = littleEndian
  out.set(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42])
  v.setUint32(4, 8, le)

  const writeValues = (t: Tag, p: Uint8Array | number[], at: number) => {
    const size = TYPE_SIZE[t.type]
    for (let i = 0; i < p.length; i++) {
      const x = p[i]
      if (size === 1) v.setUint8(at + i, x)
      else if (t.type === SHORT) v.setUint16(at + i * 2, x, le)
      else v.setUint32(at + i * 4, x >>> 0, le)
    }
  }

  const writeIfd = (ifd: Ifd, at: number): number => {
    let dataAt = at + 2 + 12 * (ifd.tags.length + (ifd.children?.length ?? 0)) + 4
    let next = at + ifdSize(ifd)
    const entries: { tag: number; write: (e: number) => void }[] = []
    for (const t of ifd.tags) {
      entries.push({
        tag: t.tag,
        write: (e) => {
          const p = payload(t)
          const n = byteLength(t, p)
          v.setUint16(e, t.tag, le)
          v.setUint16(e + 2, t.type, le)
          v.setUint32(e + 4, count(t, p), le)
          if (n <= 4) writeValues(t, p, e + 8)
          else {
            v.setUint32(e + 8, dataAt, le)
            writeValues(t, p, dataAt)
            dataAt += n + (n & 1)
          }
        },
      })
    }
    for (const c of ifd.children ?? []) {
      const childAt = next
      next = writeIfd(c.ifd, childAt)
      entries.push({
        tag: c.tag,
        write: (e) => {
          v.setUint16(e, c.tag, le)
          v.setUint16(e + 2, LONG, le)
          v.setUint32(e + 4, 1, le)
          v.setUint32(e + 8, childAt, le)
        },
      })
    }
    entries.sort((a, b) => a.tag - b.tag)
    v.setUint16(at, entries.length, le)
    entries.forEach((e, i) => e.write(at + 2 + i * 12))
    v.setUint32(at + 2 + entries.length * 12, 0, le)
    return next
  }

  writeIfd(root, 8)
  return out
}
