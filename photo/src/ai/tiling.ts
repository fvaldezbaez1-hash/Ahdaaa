// Tiled processing of images too large for a model at once: overlapping tiles
// in rows, blended with weights that ramp across each overlap, assembled one
// band of rows at a time so a 24 MP image never needs full-size float buffers.

export interface Tile {
  x: number
  y: number
  w: number
  h: number
}

/** Tile starts along one axis: `size`-long tiles, overlapping by at least `overlap`, the last one flush with the end. */
export function tileStarts(length: number, size: number, overlap: number): number[] {
  if (length <= size) return [0]
  const step = Math.max(1, size - overlap)
  const n = Math.ceil((length - size) / step) + 1
  // Spread evenly so every overlap is at least `overlap` (and about equal).
  const starts: number[] = []
  for (let i = 0; i < n; i++) starts.push(Math.round((i * (length - size)) / (n - 1)))
  return starts
}

/** Row-major tiles covering width × height (each at most size × size). */
export function tileGrid(width: number, height: number, size: number, overlap: number): Tile[][] {
  const xs = tileStarts(width, size, overlap)
  const ys = tileStarts(height, size, overlap)
  return ys.map((y) => xs.map((x) => ({ x, y, w: Math.min(size, width - x), h: Math.min(size, height - y) })))
}

/**
 * Blend weight along one axis inside a tile: 1 in the middle, ramping down
 * linearly over `ramp` pixels on sides that have a neighbouring tile (never 0,
 * so every pixel keeps some weight).
 */
export function axisWeights(start: number, len: number, total: number, ramp: number): Float32Array {
  const w = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let v = 1
    if (start > 0 && ramp > 0) v = Math.min(v, (i + 0.5) / ramp)
    if (start + len < total && ramp > 0) v = Math.min(v, (len - i - 0.5) / ramp)
    w[i] = Math.max(1e-3, Math.min(1, v))
  }
  return w
}

/** Scale a tile (e.g. into a ×2 output). */
export function scaleTile(t: Tile, s: number): Tile {
  return { x: t.x * s, y: t.y * s, w: t.w * s, h: t.h * s }
}

/**
 * Accumulates weighted tiles of `channels` floats per pixel and writes
 * finished rows through `write(y, row)` (row = width × channels, already
 * normalized). Tiles must arrive row by row (all tiles of one row share y/h).
 */
export class BandAssembler {
  private readonly width: number
  private readonly height: number
  private readonly channels: number
  private readonly ramp: number
  private readonly write: (y: number, row: Float32Array) => void
  private y0 = 0
  private acc: Float32Array
  private wsum: Float32Array
  private rows = 0

  constructor(width: number, height: number, channels: number, ramp: number, write: (y: number, row: Float32Array) => void) {
    this.width = width
    this.height = height
    this.channels = channels
    this.ramp = ramp
    this.write = write
    this.acc = new Float32Array(0)
    this.wsum = new Float32Array(0)
  }

  /** Make the band cover rows [y0, end). */
  private cover(end: number) {
    const need = end - this.y0
    if (need <= this.rows) return
    const acc = new Float32Array(need * this.width * this.channels)
    const wsum = new Float32Array(need * this.width)
    acc.set(this.acc.subarray(0, this.rows * this.width * this.channels))
    wsum.set(this.wsum.subarray(0, this.rows * this.width))
    this.acc = acc
    this.wsum = wsum
    this.rows = need
  }

  add(t: Tile, data: Float32Array) {
    if (t.y < this.y0) throw new Error('Tiles must arrive row by row')
    this.cover(t.y + t.h)
    const wx = axisWeights(t.x, t.w, this.width, this.ramp)
    const wy = axisWeights(t.y, t.h, this.height, this.ramp)
    const c = this.channels
    for (let j = 0; j < t.h; j++) {
      const row = (t.y + j - this.y0) * this.width
      for (let i = 0; i < t.w; i++) {
        const w = wx[i] * wy[j]
        const p = row + t.x + i
        this.wsum[p] += w
        const s = (j * t.w + i) * c
        for (let k = 0; k < c; k++) this.acc[p * c + k] += data[s + k] * w
      }
    }
  }

  /** Rows above `y` are final: write them and drop them from the band. */
  flush(y: number) {
    const end = Math.min(y, this.height)
    const c = this.channels
    const row = new Float32Array(this.width * c)
    for (let r = this.y0; r < end; r++) {
      const off = (r - this.y0) * this.width
      for (let i = 0; i < this.width; i++) {
        const w = this.wsum[off + i] || 1
        for (let k = 0; k < c; k++) row[i * c + k] = this.acc[(off + i) * c + k] / w
      }
      this.write(r, row)
    }
    const drop = end - this.y0
    if (drop <= 0) return
    const keep = Math.max(0, this.rows - drop)
    this.acc.copyWithin(0, drop * this.width * c, this.rows * this.width * c)
    this.wsum.copyWithin(0, drop * this.width, this.rows * this.width)
    this.acc.fill(0, keep * this.width * c)
    this.wsum.fill(0, keep * this.width)
    this.rows = keep
    this.y0 = end
  }
}

/** Copy a tile out of an interleaved image. */
export function cropInterleaved<T extends Uint16Array | Uint8Array | Uint8ClampedArray | Float32Array>(data: T, width: number, channels: number, t: Tile): T {
  const C = data.constructor as new (n: number) => T
  const out = new C(t.w * t.h * channels)
  for (let j = 0; j < t.h; j++) {
    const s = ((t.y + j) * width + t.x) * channels
    out.set(data.subarray(s, s + t.w * channels) as unknown as ArrayLike<number>, j * t.w * channels)
  }
  return out
}
