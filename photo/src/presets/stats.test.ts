import { describe, expect, it } from 'vitest'
import type { SourceColor, SourceImage } from '../engine/types'
import { builtinPresets } from './catalog'
import { photoStats, suggestLooks } from './stats'

const lin = (e: number) => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4)
const srgb: SourceColor = { kind: 'display', space: 'srgb-linear' }

/** A 120×80 test image: `top` color above `split` (0…1 of the height), `bottom` below, 8-bit sRGB. */
function image(top: number[], bottom: number[], split = 0.5): SourceImage {
  const w = 120, h = 80
  const data = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y < h * split ? top : bottom
      for (let k = 0; k < 3; k++) data[(y * w + x) * 3 + k] = Math.round(lin(c[k] / 255) * 65535)
    }
  return { width: w, height: h, data }
}

const top = (img: SourceImage) => suggestLooks(photoStats(img, srgb), builtinPresets())

describe('photoStats', () => {
  it('finds sky, foliage, water and skin', () => {
    expect(photoStats(image([120, 170, 230], [80, 140, 50]), srgb)).toMatchObject({ sky: expect.closeTo(0.5, 1), foliage: expect.closeTo(0.5, 1) })
    expect(photoStats(image([40, 140, 160], [40, 140, 160]), srgb).water).toBeCloseTo(1)
    expect(photoStats(image([200, 150, 120], [60, 50, 45], 0.6), srgb).skin).toBeGreaterThan(0.5)
  })
  it('measures brightness and contrast', () => {
    const dark = photoStats(image([20, 20, 25], [40, 38, 45]), srgb)
    const flat = photoStats(image([128, 128, 128], [140, 140, 140]), srgb)
    const hard = photoStats(image([5, 5, 5], [250, 250, 250]), srgb)
    expect(dark.brightness).toBeLessThan(0.3)
    expect(flat.contrast).toBeLessThan(0.1)
    expect(hard.contrast).toBeGreaterThan(0.8)
  })
})

describe('suggestLooks', () => {
  it('returns 12 varied suggestions, each with a reason', () => {
    const s = top(image([120, 170, 230], [80, 140, 50]))
    expect(s).toHaveLength(12)
    const per = new Map<string, number>()
    for (const x of s) per.set(x.preset.collection, (per.get(x.preset.collection) ?? 0) + 1)
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2)
    for (const x of s) expect(x.reason.length).toBeGreaterThan(10)
  })
  it('favors landscape looks for sky over green land', () => {
    const s = top(image([120, 170, 230], [80, 140, 50]))
    expect(s.slice(0, 4).some((x) => x.preset.tags?.includes('sky') || x.preset.tags?.includes('landscape'))).toBe(true)
  })
  it('favors portrait looks for skin and avoids surreal ones', () => {
    const s = top(image([200, 150, 120], [180, 130, 100], 0.6))
    expect(s[0].preset.tags).toEqual(expect.arrayContaining(['portrait']))
    expect(s[0].reason).toMatch(/skin/)
    expect(s.some((x) => x.preset.tags?.includes('surreal'))).toBe(false)
  })
  it('favors night looks for dark photos and not airy ones', () => {
    const s = top(image([15, 15, 30], [40, 30, 20]))
    expect(s.slice(0, 3).some((x) => x.preset.tags?.includes('night'))).toBe(true)
    expect(s.some((x) => x.preset.tags?.includes('airy'))).toBe(false)
  })
})
