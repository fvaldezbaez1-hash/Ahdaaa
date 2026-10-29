// Last-resort RAW support: find the largest JPEG the camera embedded in the
// file (most RAWs carry a 1–2 MP or full-size preview). Container-agnostic —
// scans for SOI markers and validates each candidate by walking its segments —
// so it works for TIFF-based RAWs, CR3, RAF and the rest alike.

export interface EmbeddedJpeg {
  offset: number
  length: number
  width: number
  height: number
}

/** Baseline / extended / progressive 8-bit Huffman JPEGs — what browsers decode. Lossless RAW payloads (SOF3) don't qualify. */
const DECODABLE_SOF = new Set([0xc0, 0xc1, 0xc2])

/** Walk one JPEG starting at `p`; returns its extent and size, or undefined if it isn't a decodable JPEG. */
function parseJpeg(b: Uint8Array, p: number): EmbeddedJpeg | undefined {
  const n = b.length
  let i = p + 2, width = 0, height = 0, scanned = false
  while (i + 1 < n) {
    if (b[i] !== 0xff) return undefined
    const m = b[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    if (m === 0xd9) return width && height && scanned ? { offset: p, length: i + 2 - p, width, height } : undefined
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2
      continue
    }
    if (i + 3 >= n) return undefined
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2) return undefined
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const comps = b[i + 9]
      if (!DECODABLE_SOF.has(m) || b[i + 4] !== 8 || (comps !== 3 && comps !== 1)) return undefined
      height = (b[i + 5] << 8) | b[i + 6]
      width = (b[i + 7] << 8) | b[i + 8]
    }
    i += 2 + len
    if (m === 0xda) {
      if (!width) return undefined
      scanned = true
      // Entropy-coded data: skip to the next real marker (FF00 is a stuffed byte, FFD0–D7 restarts).
      while (i + 1 < n && !(b[i] === 0xff && b[i + 1] !== 0 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++
    }
  }
  return undefined
}

export function findEmbeddedJpeg(bytes: Uint8Array, minPixels = 160 * 120): EmbeddedJpeg | undefined {
  let best: EmbeddedJpeg | undefined
  for (let p = bytes.indexOf(0xff); p >= 0 && p + 3 < bytes.length; p = bytes.indexOf(0xff, p + 1)) {
    if (bytes[p + 1] !== 0xd8 || bytes[p + 2] !== 0xff) continue
    const j = parseJpeg(bytes, p)
    if (!j) continue
    if (j.width * j.height >= minPixels && (!best || j.width * j.height > best.width * best.height)) best = j
    p += j.length - 1 // nested thumbnails live inside this one's APP1
  }
  return best
}

/** Drop APP1 (EXIF/XMP) so the browser doesn't apply an orientation we apply ourselves. */
export function stripApp1(jpeg: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)]
  let i = 2
  while (i + 3 < jpeg.length && jpeg[i] === 0xff && jpeg[i + 1] !== 0xda) {
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3]
    if (jpeg[i + 1] !== 0xe1) parts.push(jpeg.subarray(i, i + 2 + len))
    i += 2 + len
  }
  parts.push(jpeg.subarray(i))
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of parts) {
    out.set(x, o)
    o += x.length
  }
  return out
}
