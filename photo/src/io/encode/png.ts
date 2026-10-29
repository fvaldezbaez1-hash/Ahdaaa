// PNG encoder for 8- and 16-bit RGB. Rows get the adaptive filter libpng uses
// (smallest sum of absolute filtered bytes) and are streamed through the
// platform deflate, so a 50 MP export never needs a second full-size buffer.
import { crc32 } from './crc32'
import { createDeflater, deflate } from './deflate'

export interface PngOptions {
  /** Embedded ICC profile (iCCP). */
  icc?: { name: string; data: Uint8Array }
  /** Mark the pixels as sRGB (sRGB chunk) when no ICC profile is given. */
  srgb?: boolean
  /** TIFF-structured EXIF block (eXIf). */
  exif?: Uint8Array
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  out.set(latin1(type), 4)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Choose and apply a filter for one row; writes filter byte + filtered row into `out`. */
function filterRow(cur: Uint8Array, prev: Uint8Array | null, bpp: number, out: Uint8Array, scratch: Uint8Array): void {
  const n = cur.length
  let best = Infinity
  for (let f = 0; f < 5; f++) {
    if (prev === null && (f === 2 || f === 4)) continue // Up/Paeth add nothing on the first row
    let sum = 0
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      let p: number
      switch (f) {
        case 0: p = cur[i]; break
        case 1: p = cur[i] - a; break
        case 2: p = cur[i] - b; break
        case 3: p = cur[i] - ((a + b) >> 1); break
        default: {
          const c = prev && i >= bpp ? prev[i - bpp] : 0
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
          p = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
      }
      const byte = p & 255
      scratch[i] = byte
      sum += byte < 128 ? byte : 256 - byte
      if (sum >= best) break
    }
    if (sum < best) {
      best = sum
      out[0] = f
      out.set(scratch.subarray(0, n), 1)
    }
  }
}

/** Encode RGBA pixels (alpha dropped; exports are opaque). Uint16Array input → 16-bit PNG. */
export async function encodePng(rgba: Uint8Array | Uint8ClampedArray | Uint16Array, width: number, height: number, opts: PngOptions = {}): Promise<Blob> {
  const sixteen = rgba instanceof Uint16Array
  const bpp = sixteen ? 6 : 3
  const rowBytes = width * bpp
  const parts: BlobPart[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])]

  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr.set([sixteen ? 16 : 8, 2, 0, 0, 0], 8)
  parts.push(chunk('IHDR', ihdr))
  if (opts.icc) {
    const z = await deflate(opts.icc.data)
    const body = new Uint8Array(opts.icc.name.length + 2 + z.length)
    body.set(latin1(opts.icc.name))
    body.set(z, opts.icc.name.length + 2) // name, NUL, compression method 0
    parts.push(chunk('iCCP', body))
  } else if (opts.srgb) parts.push(chunk('sRGB', Uint8Array.of(0)))
  if (opts.exif) parts.push(chunk('eXIf', opts.exif))

  const deflater = createDeflater()
  let cur = new Uint8Array(rowBytes), prev = new Uint8Array(rowBytes)
  const scratch = new Uint8Array(rowBytes)
  const rowsPerWrite = Math.max(1, Math.floor((1 << 20) / (rowBytes + 1)))
  let batch = new Uint8Array(rowsPerWrite * (rowBytes + 1)), inBatch = 0
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    if (sixteen) {
      for (let x = 0, o = 0, i = src; x < width; x++, i += 4) {
        for (let c = 0; c < 3; c++, o += 2) {
          const v = rgba[i + c]
          cur[o] = v >> 8
          cur[o + 1] = v & 255
        }
      }
    } else {
      for (let x = 0, o = 0, i = src; x < width; x++, i += 4, o += 3) {
        cur[o] = rgba[i]
        cur[o + 1] = rgba[i + 1]
        cur[o + 2] = rgba[i + 2]
      }
    }
    filterRow(cur, y ? prev : null, bpp, batch.subarray(inBatch * (rowBytes + 1)), scratch)
    ;[cur, prev] = [prev, cur]
    if (++inBatch === rowsPerWrite || y === height - 1) {
      await deflater.write(batch.subarray(0, inBatch * (rowBytes + 1)))
      batch = new Uint8Array(rowsPerWrite * (rowBytes + 1)) // the stream may still read the previous one
      inBatch = 0
    }
  }
  // Group the stream's small output chunks into ~1 MB IDATs.
  let group: Uint8Array[] = [], groupBytes = 0
  const flush = () => {
    if (!groupBytes) return
    const data = new Uint8Array(groupBytes)
    let o = 0
    for (const g of group) {
      data.set(g, o)
      o += g.length
    }
    parts.push(chunk('IDAT', data))
    group = []
    groupBytes = 0
  }
  for (const c of await deflater.finish()) {
    group.push(c)
    groupBytes += c.length
    if (groupBytes >= 1 << 20) flush()
  }
  flush()
  parts.push(chunk('IEND', new Uint8Array(0)))
  return new Blob(parts, { type: 'image/png' })
}
