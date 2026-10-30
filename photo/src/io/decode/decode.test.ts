import { describe, expect, it } from 'vitest'
import { orientRgb16 } from './orient'
import { AreaResampler, fitLongEdge, resampleRgb16 } from './resample'
import { linearToSrgb, srgbToLinear } from './srgb'

describe('area resampler', () => {
  it('preserves the mean exactly for awkward ratios', () => {
    const w = 37, h = 23
    const src = new Uint16Array(w * h * 3)
    for (let i = 0; i < src.length; i++) src[i] = (i * 7919) % 65536
    const r = new AreaResampler(w, h, 10, 7)
    for (let y = 0; y < h; y++) r.pushRow(src, y * w * 3)
    expect(r.done).toBe(true)
    const mean = (a: Uint16Array, c: number) => a.filter((_, i) => i % 3 === c).reduce((s, v) => s + v, 0) / (a.length / 3)
    for (let c = 0; c < 3; c++) expect(Math.abs(mean(r.out, c) - mean(src, c))).toBeLessThan(2)
  })

  it('averages 2×2 blocks exactly', () => {
    const src = Uint16Array.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 300, 300, 300])
    expect([...resampleRgb16(src, 2, 2, 1).data]).toEqual([150, 150, 150])
  })

  it('fits the long edge without upscaling', () => {
    expect(fitLongEdge(6000, 4000, 2560)).toEqual({ width: 2560, height: 1707 })
    expect(fitLongEdge(4000, 6000, 2560)).toEqual({ width: 1707, height: 2560 })
    expect(fitLongEdge(800, 600, 2560)).toEqual({ width: 800, height: 600 })
  })
})

describe('orientation', () => {
  // 3×2 image, pixel value = its index; read back which source pixel lands where.
  const src = new Uint16Array(18).map((_, i) => Math.floor(i / 3))
  const px = (o: number) => {
    const r = orientRgb16(src, 3, 2, o)
    return { w: r.width, h: r.height, p: [...r.data.filter((_, i) => i % 3 === 0)] }
  }
  it('matches the EXIF definitions', () => {
    expect(px(1)).toEqual({ w: 3, h: 2, p: [0, 1, 2, 3, 4, 5] })
    expect(px(2)).toEqual({ w: 3, h: 2, p: [2, 1, 0, 5, 4, 3] })
    expect(px(3)).toEqual({ w: 3, h: 2, p: [5, 4, 3, 2, 1, 0] })
    expect(px(4)).toEqual({ w: 3, h: 2, p: [3, 4, 5, 0, 1, 2] })
    expect(px(5)).toEqual({ w: 2, h: 3, p: [0, 3, 1, 4, 2, 5] })
    expect(px(6)).toEqual({ w: 2, h: 3, p: [3, 0, 4, 1, 5, 2] })
    expect(px(7)).toEqual({ w: 2, h: 3, p: [5, 2, 4, 1, 3, 0] })
    expect(px(8)).toEqual({ w: 2, h: 3, p: [2, 5, 1, 4, 0, 3] })
  })
})

it('sRGB transfer round-trips', () => {
  for (const v of [0, 0.001, 0.04, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 9)
})
