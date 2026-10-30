// Area downscaling for interleaved RGB images. Every output pixel is the exact
// coverage-weighted average of the source pixels under it, which is what a
// camera sensor with bigger pixels would have recorded — as long as the input
// is linear light. Rows are fed one at a time so callers can stream strips
// (canvas readback, RAW output) without holding a second full-size copy.

export interface Size {
  width: number
  height: number
}

/** Size that fits `maxLongEdge` (never upscales). */
export function fitLongEdge(width: number, height: number, maxLongEdge?: number): Size {
  if (!maxLongEdge || Math.max(width, height) <= maxLongEdge) return { width, height }
  const s = maxLongEdge / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }
}

export class AreaResampler {
  readonly out: Uint16Array
  private readonly acc: Float32Array
  private readonly row: Float32Array
  /** Per contribution: source column and weight (fraction of that source pixel). */
  private readonly xSrc: Int32Array
  private readonly xW: Float32Array
  /** Per output column: first contribution index (length outW + 1). */
  private readonly xStart: Int32Array
  private readonly norm: number
  private readonly srcH: number
  private readonly outW: number
  private readonly outH: number
  private srcRow = 0
  private outRow = 0

  constructor(srcW: number, srcH: number, outW: number, outH: number) {
    this.srcH = srcH
    this.outW = outW
    this.outH = outH
    if (outW > srcW || outH > srcH) throw new Error('AreaResampler only downscales')
    this.out = new Uint16Array(outW * outH * 3)
    this.acc = new Float32Array(outW * 3)
    this.row = new Float32Array(outW * 3)
    // Integer coordinates: source pixel i spans [i·outW, (i+1)·outW), output
    // pixel o spans [o·srcW, (o+1)·srcW). Overlaps are exact, so rows always
    // finish cleanly however awkward the ratio.
    const src: number[] = []
    const w: number[] = []
    this.xStart = new Int32Array(outW + 1)
    for (let o = 0; o < outW; o++) {
      this.xStart[o] = src.length
      const a = o * srcW, b = a + srcW
      for (let i = Math.floor(a / outW); i * outW < b; i++) {
        const ov = Math.min(b, (i + 1) * outW) - Math.max(a, i * outW)
        if (ov > 0) {
          src.push(i)
          w.push(ov / outW)
        }
      }
    }
    this.xStart[outW] = src.length
    this.xSrc = Int32Array.from(src)
    this.xW = Float32Array.from(w)
    this.norm = (outW / srcW) * (outH / srcH)
  }

  get done(): boolean {
    return this.outRow >= this.outH
  }

  /** Add the next source row: `srcW` RGB triplets starting at `offset`. */
  pushRow(data: ArrayLike<number>, offset: number): void {
    const { row, acc, xSrc, xW, xStart, outW } = this
    for (let o = 0, k = 0; o < outW; o++) {
      let r = 0, g = 0, b = 0
      for (const end = xStart[o + 1]; k < end; k++) {
        const i = offset + xSrc[k] * 3, wk = xW[k]
        r += data[i] * wk
        g += data[i + 1] * wk
        b += data[i + 2] * wk
      }
      row[o * 3] = r
      row[o * 3 + 1] = g
      row[o * 3 + 2] = b
    }
    const a = this.srcRow * this.outH, end = a + this.outH
    this.srcRow++
    while (this.outRow < this.outH) {
      const oa = this.outRow * this.srcH, ob = oa + this.srcH
      const ov = Math.min(end, ob) - Math.max(a, oa)
      if (ov > 0) {
        const wy = ov / this.outH
        for (let i = 0; i < acc.length; i++) acc[i] += row[i] * wy
      }
      if (end < ob) break
      this.emit()
      if (end === ob) break
    }
  }

  private emit(): void {
    const { acc, out, norm } = this
    const base = this.outRow * acc.length
    for (let i = 0; i < acc.length; i++) {
      const v = Math.round(acc[i] * norm)
      out[base + i] = v > 65535 ? 65535 : v < 0 ? 0 : v
    }
    acc.fill(0)
    this.outRow++
  }
}

/** Downscale a whole interleaved RGB16 image (returns the input when no scaling is needed). */
export function resampleRgb16(data: Uint16Array, width: number, height: number, maxLongEdge?: number): { data: Uint16Array } & Size {
  const size = fitLongEdge(width, height, maxLongEdge)
  if (size.width === width && size.height === height) return { data, width, height }
  const r = new AreaResampler(width, height, size.width, size.height)
  for (let y = 0; y < height; y++) r.pushRow(data, y * width * 3)
  return { data: r.out, ...size }
}
