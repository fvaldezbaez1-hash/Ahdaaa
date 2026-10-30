import { describe, expect, it } from 'vitest'
import { mat3, type Vec3 } from '../color/matrices'
import { rawWbRatio } from '../color/wb'
import { defaultRecipe } from '../edit/defaults'
import type { Geometry } from '../edit/types'
import { autoSettings, neutralEstimate } from './auto'
import { applyAffine, cropRectInUncropped, invertAffine, normalizedToSource, outputSize, outputToSource } from './geometry'
import { binHistogram } from './histogram'
import { areaDownscale, averagePixel, boxReduce } from './image'
import { bandWeights, buildCurveLut, frameParams, wheelDirection } from './params'
import { buildFilmicLut, contrastCurve, contrastExponent, displayShoulder, filmic, FILMIC, MID_GRAY, sampleToneLut, toneCurve, type ToneSpec } from './tone'
import { brushValue, combineMask, hueSat, layerVector, linearValue, radialValue, rangeColorValue, rangeLuminanceValue, activeLayers } from './masks'
import { findHealSource, retouchWindow } from './heal'
import type { SourceColor } from './types'

const geo = (g: Partial<Geometry> = {}): Geometry => ({ crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original', ...g })
const close = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps))
const src = { width: 400, height: 300 }

describe('geometry', () => {
  it('maps the output corners to the right source corners for quarter turns and flips', () => {
    // 90° clockwise: the output's top-left came from the source's bottom-left.
    close(normalizedToSource(src, geo({ rotate: 1 }), false, 0, 0), [0, 300])
    close(normalizedToSource(src, geo({ rotate: 2 }), false, 0, 0), [400, 300])
    close(normalizedToSource(src, geo({ rotate: 3 }), false, 0, 0), [400, 0])
    close(normalizedToSource(src, geo({ flipH: true }), false, 0, 0), [400, 0])
    close(normalizedToSource(src, geo({ rotate: 1, flipV: true }), false, 0, 0), [400, 300])
    expect(outputSize(src, geo({ rotate: 1 }))).toEqual({ width: 300, height: 400 })
  })
  it('crops in the rotated frame and keeps the crop center fixed when straightening', () => {
    const g = geo({ crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, angle: 10 })
    expect(outputSize(src, g)).toEqual({ width: 200, height: 75 })
    close(normalizedToSource(src, g, false, 0.5, 0.5), [200, 187.5], 1e-9)
    // Straightened clockwise: the output's right-middle point comes from slightly ABOVE in the source.
    expect(normalizedToSource(src, g, false, 1, 0.5)[1]).toBeLessThan(187.5)
  })
  it('places the crop box correctly inside the uncropped view', () => {
    const g = geo({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, angle: -12 })
    const r = cropRectInUncropped(src, g)
    const u = outputSize(src, g, true)
    // The crop's center, found through the uncropped mapping, is the same source point as the cropped center.
    const a = applyAffine(outputToSource(src, g, true, u), (r.x + r.w / 2) * u.width, (r.y + r.h / 2) * u.height)
    close(a, normalizedToSource(src, g, false, 0.5, 0.5), 0.02)
  })
  it('inverts affine maps', () => {
    const m = outputToSource(src, geo({ angle: 7, rotate: 3, flipH: true }), false, { width: 100, height: 80 })
    const p = applyAffine(m, 13, 27)
    close(applyAffine(invertAffine(m), p[0], p[1]), [13, 27], 1e-9)
  })
})

describe('tone', () => {
  it('filmic: middle gray ≈ 0.2, monotonic, white reached softly', () => {
    expect(filmic(MID_GRAY, FILMIC)).toBeCloseTo(0.2, 2)
    expect(filmic(1, FILMIC)).toBeGreaterThan(0.93)
    expect(filmic(4, FILMIC)).toBe(1)
    let prev = 0
    for (let x = 1e-4; x < 8; x *= 1.05) {
      const y = filmic(x, FILMIC)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })
  it('display sources are untouched at default and roll off highlights when brightened', () => {
    const spec: ToneSpec = { kind: 'display', filmic: FILMIC, xmax: 1, contrast: 0, whites: 0, blacks: 0 }
    const f = toneCurve(spec)
    for (const x of [0.001, 0.18, 0.9]) expect(f(x)).toBeCloseTo(x, 9)
    expect(displayShoulder(0.4, 2)).toBe(0.4)
    expect(displayShoulder(2, 2)).toBeCloseTo(1, 6)
    expect(displayShoulder(1, 2)).toBeLessThan(1)
  })
  it('contrast keeps its pivot and end points and stays monotonic', () => {
    for (const k of [-1, -0.4, 0.5, 1]) {
      expect(contrastCurve(0.46, k, 0.46)).toBeCloseTo(0.46, 6)
      let prev = 0
      for (let p = 0.001; p < 1; p += 0.01) {
        const y = contrastCurve(p, k, 0.46)
        expect(y).toBeGreaterThanOrEqual(prev)
        prev = y
      }
    }
    expect(contrastCurve(0.2, 1, 0.46)).toBeLessThan(0.2)
  })
  it('the filmic LUT reproduces the curve, and the contrast pivot is middle gray', () => {
    const lut = buildFilmicLut(FILMIC)
    for (const x of [1e-5, 0.003, 0.05, 0.18, 0.6, 1.3, 9]) expect(Math.abs(sampleToneLut(lut, x) - filmic(x, FILMIC))).toBeLessThan(2e-4)
    expect((filmic(MID_GRAY, FILMIC) ** (1 / 2.2)) ** contrastExponent('raw', FILMIC)).toBeCloseTo(0.5, 9)
  })
})

describe('params', () => {
  it('mixer bands form a partition of unity', () => {
    for (let h = 0; h < 360; h += 7) expect(bandWeights(h).reduce((a, b) => a + b)).toBeCloseTo(1, 9)
    expect(bandWeights(145)[3]).toBeCloseTo(1, 9)
  })
  it('a default display recipe is an identity pipeline', () => {
    const p = frameParams(defaultRecipe('display'), { kind: 'display', space: 'srgb-linear' })
    expect([p.contrast, p.whites, p.blacks, p.hueLut, p.curveLut, p.grading, p.saturation, p.vibrance, p.fade]).toEqual([0, 0, 0, null, null, null, 0, 0, 0])
  })
  it('RAW white balance at the as-shot temperature changes nothing', () => {
    const color: SourceColor = { kind: 'raw', space: 'camera', rgbCam: mat3([[1.9, -0.8, -0.1], [-0.2, 1.5, -0.3], [0, -0.5, 1.5]]), camXyz: mat3([[0.6972, -0.2408, -0.06], [-0.433, 1.2101, 0.2515], [-0.0388, 0.1277, 0.5847]]), shotMul: [2.5, 1, 1.5] }
    const r = defaultRecipe('raw')
    const ratio = rawWbRatio(color.camXyz!, color.shotMul!, r.wb.temp, r.wb.tint)
    close(frameParams(r, color).input.wbMul, ratio)
  })
  it('composes channel curves after the master curve', () => {
    const lut = buildCurveLut({ rgb: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }], r: [{ x: 0, y: 1 }, { x: 1, y: 0 }], g: [{ x: 0, y: 0 }, { x: 1, y: 1 }], b: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })!
    const n = lut.length / 4 - 1
    expect(lut[n * 4]).toBeCloseTo(0.5, 3) // r(master(1)) = 1 − 0.5
    expect(lut[n * 4 + 1]).toBeCloseTo(0.5, 3)
  })
  it('grading wheel hues point the right way in OKLab', () => {
    const [a, b] = wheelDirection(0) // red: +a
    expect(a).toBeGreaterThan(0.7)
    expect(wheelDirection(240)[1]).toBeLessThan(-0.7) // blue: −b
    expect(Math.hypot(a, b)).toBeCloseTo(1, 9)
  })
})

describe('image helpers', () => {
  const img = (w: number, h: number, f: (x: number, y: number) => Vec3) => {
    const data = new Uint16Array(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y).map((v) => Math.round(v * 65535)), (y * w + x) * 3)
    return { width: w, height: h, data }
  }
  it('area downscale preserves the mean exactly and box reduce averages blocks', () => {
    const im = img(30, 20, (x, y) => [x / 29, y / 19, 0.5])
    const d = areaDownscale(im, 7, 5)
    const mean = (a: ArrayLike<number>, c: number) => Array.from(a).filter((_, i) => i % 3 === c).reduce((s, v) => s + v, 0) / (a.length / 3)
    expect(mean(d.data, 0)).toBeCloseTo(0.5, 4)
    expect(boxReduce(img(4, 2, (x) => [x < 2 ? 0 : 1, 0, 0]), 2).data[3]).toBe(65535)
    expect(averagePixel(im, 15, 10, 1)![2]).toBeCloseTo(0.5, 4)
    expect(averagePixel(im, -5, 10, 1)).toBeNull()
  })
  it('auto white balance finds the cast of a tinted gray scene and stays moderate', () => {
    const cast: Vec3 = [1.15, 1, 0.8]
    const data = new Float32Array(64 * 64 * 3)
    for (let i = 0; i < 64 * 64; i++) {
      const v = 0.05 + (i % 64) / 100
      data.set([v * cast[0], v * cast[1], v * cast[2]], i * 3)
    }
    const est = neutralEstimate({ width: 64, height: 64, data })!
    expect(est[0] / est[1]).toBeCloseTo(1.15, 2)
    const a = autoSettings({ width: 64, height: 64, data }, { kind: 'display', space: 'srgb-linear' }, defaultRecipe('display'))
    expect(a.wb.temp).toBeLessThan(0) // warm cast → cooler correction
    expect(Math.abs(a.basic.exposure!)).toBeLessThanOrEqual(1.5)
  })
  it('histogram skips transparent pixels and counts clipping', () => {
    const h = binHistogram(new Uint8Array([255, 10, 10, 255, 0, 0, 0, 0, 128, 128, 128, 255]))
    expect(h.r[255]).toBe(1)
    expect(h.clippedHigh).toBeCloseTo(0.5)
    expect(h.luma.reduce((a, b) => a + b)).toBe(2)
  })
})

describe('mask coordinates', () => {
  it('round-trips between the view and the source through crop, rotate, flip and straighten', async () => {
    const { viewToMask, maskToView } = await import('./geometry')
    const src = { width: 6000, height: 4000 }
    const g: Geometry = { crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 }, angle: 7, rotate: 1, flipH: true, flipV: false, aspect: 'free' }
    for (const uncropped of [false, true]) {
      for (const [nx, ny] of [[0.5, 0.5], [0.1, 0.9], [0.8, 0.2]]) {
        const m = viewToMask(src, g, uncropped, nx, ny)
        expect(m.x).toBeGreaterThanOrEqual(0)
        expect(m.x).toBeLessThanOrEqual(1)
        const v = maskToView(src, g, uncropped, m.x, m.y)
        expect(v.x).toBeCloseTo(nx, 9)
        expect(v.y).toBeCloseTo(ny, 9)
      }
    }
    // No geometry: the view is the source.
    const id: Geometry = { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original' }
    const m = viewToMask(src, id, false, 0.25, 0.75)
    expect(m.x).toBeCloseTo(0.25, 9)
    expect(m.y).toBeCloseTo(0.75, 9)
  })
})

describe('masks', () => {
  it('linear: full on the first side, none past the second, smooth between', () => {
    expect(linearValue(0, 0, 10, 0, 20, 0)).toBe(1)
    expect(linearValue(25, 3, 10, 0, 20, 0)).toBe(0)
    expect(linearValue(15, 9, 10, 0, 20, 0)).toBeCloseTo(0.5, 9)
  })
  it('radial: full inside, feather falloff over the outer part, rotation and antialiasing', () => {
    const v = (x: number, y: number, f: number, angle = 0) => radialValue(x, y, 100, 100, 50, 20, angle, f, 0.01)
    expect(v(100, 100, 0.5)).toBe(1)
    expect(v(124, 100, 0.5)).toBe(1) // inside the unfeathered core (d = 0.48)
    expect(v(137.5, 100, 0.5)).toBeCloseTo(0.5, 6) // halfway through the soft band (d = 0.75)
    expect(v(151, 100, 0.5)).toBe(0)
    expect(v(100, 130, 0)).toBe(0) // ry = 20
    expect(v(100, 130, 0, 90)).toBe(1) // rotated 90°: the long axis is vertical
    expect(v(149.9, 100, 0)).toBeGreaterThan(0) // hard edge, still antialiased
    expect(v(149.9, 100, 0)).toBeLessThan(1)
  })
  it('combines in order: add = union, subtract, intersect, invert', () => {
    expect(combineMask(0, 0.3, 'subtract', false, true)).toBe(0.3) // the first mask always starts the layer
    expect(combineMask(0.4, 0.7, 'add', false, false)).toBe(0.7)
    expect(combineMask(0.8, 0.25, 'subtract', false, false)).toBeCloseTo(0.6, 9)
    expect(combineMask(0.8, 0.5, 'intersect', false, false)).toBeCloseTo(0.4, 9)
    expect(combineMask(0.8, 0.25, 'intersect', true, false)).toBeCloseTo(0.6, 9)
  })
  it('brush: strokes are unions at their flow, build up, and erase strokes remove', () => {
    const stroke = { points: [[0, 0], [100, 0]] as [number, number][], r: 10, feather: 0, flow: 0.5 }
    expect(brushValue(50, 0, [stroke], 0.5)).toBeCloseTo(0.5, 9) // overlapping segments don't stack within a stroke
    expect(brushValue(50, 0, [stroke, stroke], 0.5)).toBeCloseTo(0.75, 9) // a second stroke builds up
    expect(brushValue(50, 0, [stroke, { ...stroke, flow: 1, erase: true }], 0.5)).toBe(0)
    expect(brushValue(50, 20, [stroke], 0.5)).toBe(0)
    const soft = { ...stroke, feather: 0.5, flow: 1 }
    expect(brushValue(50, 4, [soft], 0.5)).toBe(1)
    expect(brushValue(50, 7.5, [soft], 0.5)).toBeCloseTo(0.5, 6)
  })
  it('range: selects by luminance and by color on a synthetic image', () => {
    const lum = [0.05, 0.3, 0.5, 0.7, 0.95].map((l) => rangeLuminanceValue(l, 40, 60, 0))
    expect(lum.map((v) => Math.round(v))).toEqual([0, 0, 1, 0, 0])
    // A blue sky pixel vs foliage and skin, sampled sky = hue 210°, sat 60.
    const pick = (r: number, g: number, b: number) => { const { h, s } = hueSat(r, g, b); return rangeColorValue(h, s, 210, 60, 20, 10) }
    expect(pick(0.35, 0.6, 0.9)).toBeGreaterThan(0.9)
    expect(pick(0.3, 0.6, 0.2)).toBe(0)
    expect(pick(0.9, 0.7, 0.6)).toBe(0)
    expect(hueSat(0.5, 0.5, 0.5).s).toBe(0)
  })
  it('layers: a layer without masks or changes does nothing; opacity scales its numbers', () => {
    const layer = { id: 'a', name: 'A', enabled: true, opacity: 0.5, masks: [{ id: 'm', type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 1, mode: 'add' as const, invert: false }], adjust: { exposure: 1, shadows: 40 } }
    expect(activeLayers([layer, { ...layer, adjust: {} }, { ...layer, masks: [] }])).toHaveLength(1)
    const v = layerVector(layer.adjust, layer.opacity)
    expect(v[0]).toBe(0.5)
    expect(v[3]).toBeCloseTo(0.2, 6)
  })
})

describe('healing', () => {
  // A smooth gradient with a dark blemish at (40, 40): the best source is clean gradient nearby.
  const W = 120, H = 80
  const data = new Uint16Array(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const base = 0.3 + (0.4 * x) / W
      const blemish = Math.hypot(x - 40, y - 40) < 4 ? 0.3 : 1
      // Stripes above the spot make that direction a bad match.
      const stripes = y < 30 && x > 30 && x < 50 && x % 4 < 2 ? 0.5 : 1
      data.set([0, 1, 2].map(() => Math.round(base * blemish * stripes * 65535)), (y * W + x) * 3)
    }
  const img = { width: W, height: H, data }
  it('finds a clean, similar patch near the spot, inside the image and away from other spots', () => {
    const r = 6 / W
    const s = findHealSource(img, [], 40 / W, 40 / H, r)!
    const dx = s.sx * W - 40, dy = s.sy * H - 40
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(1.5 * 6 - 1e-6)
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(4 * 6 + 1e-6)
    expect(dy).toBeGreaterThan(-8) // not from the striped area above
    expect(Math.abs(dx)).toBeLessThan(15) // similar brightness: along the gradient's iso-lines
    const other = { id: 'o', mode: 'heal' as const, x: s.sx, y: s.sy, r, sx: 0.9, sy: 0.5, feather: 50, opacity: 1 }
    const s2 = findHealSource(img, [other], 40 / W, 40 / H, r)!
    expect(Math.hypot(s2.sx * W - s.sx * W, s2.sy * H - s.sy * H)).toBeGreaterThan(2 * 6)
  })
  it('grows a window to include the sources its spots copy from', () => {
    const spot = { id: 's', mode: 'clone' as const, x: 0.1, y: 0.1, r: 0.01, sx: 0.8, sy: 0.8, feather: 0, opacity: 1 }
    const w = retouchWindow([spot], 1000, 1000, { x0: 0, y0: 0, x1: 200, y1: 200 })
    expect(w.x1).toBeGreaterThan(800)
    expect(retouchWindow([spot], 1000, 1000, { x0: 500, y0: 0, x1: 600, y1: 50 })).toEqual({ x0: 500, y0: 0, x1: 600, y1: 50 })
  })
})
