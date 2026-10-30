import type { Histogram } from './types'

/** 256-bin histograms of RGBA8 pixels (transparent ones — outside the image — are skipped). */
export function binHistogram(rgba: Uint8Array): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), luma = new Uint32Array(256)
  let n = 0, low = 0, high = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2]
    r[R]++
    g[G]++
    b[B]++
    luma[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++
    if (R === 0 || G === 0 || B === 0) low++
    if (R === 255 || G === 255 || B === 255) high++
    n++
  }
  return { r, g, b, luma, clippedLow: n ? low / n : 0, clippedHigh: n ? high / n : 0 }
}
