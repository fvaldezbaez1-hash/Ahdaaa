import { describe, expect, it } from 'vitest'
import { cropRectInUncropped } from '../../engine/geometry'
import type { Geometry, Rect } from '../../edit/types'
import {
  aspectRatio, cropToView, DEFAULT_GEOMETRY, fitAspect, fits, fitsView, flip, frameSize, levelAngle, maxScale, moveView,
  resizeView, rotateQuarter, shrinkToFit, viewSize, viewToCrop, type Box, type Handle,
} from './geometry'

const F = { w: 3000, h: 2000 }
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const nearRect = (a: Rect | Box, b: Rect | Box, eps = 1e-6) => (['x', 'y', 'w', 'h'] as const).forEach((k) => near(a[k], b[k], eps))
const full: Rect = { x: 0, y: 0, w: 1, h: 1 }

describe('frame and view', () => {
  it('swaps the frame on odd quarter turns', () => {
    expect(frameSize({ w: 30, h: 20 }, 1)).toEqual({ w: 20, h: 30 })
    expect(frameSize({ w: 30, h: 20 }, 2)).toEqual({ w: 30, h: 20 })
  })

  it('knows the aspect presets', () => {
    expect(aspectRatio('free', F)).toBeNull()
    expect(aspectRatio('original', F)).toBe(1.5)
    expect(aspectRatio('4:5', F)).toBe(0.8)
    expect(aspectRatio('16:9', F)).toBeCloseTo(16 / 9)
  })

  it('maps crops to the view and back', () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }
    for (const angle of [0, 7.5, -20, 45]) nearRect(viewToCrop(cropToView(crop, angle, F), angle, F), crop)
  })

  it('places the crop in the view exactly where the engine draws it', () => {
    const g: Geometry = { ...DEFAULT_GEOMETRY, crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, angle: 12 }
    const v = viewSize(F, g.angle)
    const box = cropToView(g.crop, g.angle, F)
    const engine = cropRectInUncropped({ width: F.w, height: F.h }, g)
    nearRect({ x: box.x / v.w, y: box.y / v.h, w: box.w / v.w, h: box.h / v.h }, engine)
  })
})

describe('keeping the crop on the photo', () => {
  it('accepts the full frame only when level', () => {
    expect(fits(full, 0, F)).toBe(true)
    expect(fits(full, 3, F)).toBe(false)
  })

  it('shrinks around the center when straightened (3:2 at 10° keeps ~80%)', () => {
    const r = shrinkToFit(full, 10, F)
    near(r.w, 0.8031, 1e-3)
    near(r.x + r.w / 2, 0.5)
    near(r.w / r.h, 1)
    expect(fits(r, 10, F)).toBe(true)
    expect(maxScale(r, 10, F)).toBeCloseTo(1, 6)
  })

  it('never grows a crop that already fits', () => {
    const small = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }
    expect(shrinkToFit(small, 5, F)).toEqual(small)
  })

  it('keeps every resize inside the straightened photo', () => {
    const angle = 8
    const start = cropToView(shrinkToFit(full, angle, F), angle, F)
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Handle[]) {
      for (const ratio of [null, 1.5]) {
        const b = resizeView(start, h, 900, -700, ratio, angle, F, 50)
        expect(fitsView(b, angle, F)).toBe(true)
        const c = resizeView(start, h, -900, 700, ratio, angle, F, 50)
        expect(fitsView(c, angle, F)).toBe(true)
      }
    }
  })
})

describe('resizing from the handles', () => {
  const s: Box = { x: 1000, y: 600, w: 900, h: 600 }

  it('moves only the dragged edges when free', () => {
    expect(resizeView(s, 'e', 100, 50, null, 0, F, 20)).toEqual({ x: 1000, y: 600, w: 1000, h: 600 })
    expect(resizeView(s, 'nw', -100, -50, null, 0, F, 20)).toEqual({ x: 900, y: 550, w: 1000, h: 650 })
  })

  it('stops at the photo edge and slides along it', () => {
    const b = resizeView(s, 'se', 5000, 100, null, 0, F, 20)
    near(b.x + b.w, 3000, 1e-3)
    near(b.y + b.h, 1300)
  })

  it('never shrinks below the minimum or flips over', () => {
    const b = resizeView(s, 'w', 5000, 0, null, 0, F, 20)
    near(b.w, 20)
    near(b.x + b.w, 1900)
  })

  it('keeps the ratio and the opposite corner from every corner', () => {
    const anchors: Record<string, [number, number]> = { se: [s.x, s.y], nw: [s.x + s.w, s.y + s.h], ne: [s.x, s.y + s.h], sw: [s.x + s.w, s.y] }
    for (const [h, [ax, ay]] of Object.entries(anchors)) {
      const sx = h.includes('e') ? 1 : -1, sy = h.includes('s') ? 1 : -1
      const b = resizeView(s, h as Handle, 120 * sx, 30 * sy, 1.5, 0, F, 20)
      near(b.w / b.h, 1.5)
      near(b.w, 1020)
      near(h.includes('e') ? b.x : b.x + b.w, ax)
      near(h.includes('s') ? b.y : b.y + b.h, ay)
    }
  })

  it('keeps the ratio and the opposite edge from every edge, centered on the other axis', () => {
    const e = resizeView(s, 'e', 150, 0, 1.5, 0, F, 20)
    expect(e).toEqual({ x: 1000, y: 550, w: 1050, h: 700 })
    const n = resizeView(s, 'n', 0, -60, 1.5, 0, F, 20)
    near(n.y + n.h, 1200)
    near(n.h, 660)
    near(n.x + n.w / 2, 1450)
  })

  it('stops a locked resize where the photo ends', () => {
    const b = resizeView(s, 'se', 3000, 3000, 1.5, 0, F, 20)
    near(b.w / b.h, 1.5)
    near(b.x + b.w, 3000, 1e-3)
    expect(b.y + b.h).toBeLessThan(2000)
  })
})

describe('moving and reshaping', () => {
  it('moves freely inside and clamps per axis at the edges', () => {
    const s: Box = { x: 100, y: 100, w: 1000, h: 500 }
    expect(moveView(s, 50, 60, 0, F)).toEqual({ x: 150, y: 160, w: 1000, h: 500 })
    const b = moveView(s, -500, 300, 0, F)
    near(b.x, 0, 1e-3)
    near(b.y, 400)
  })

  it('fits the largest crop of a new aspect, as near the old center as possible', () => {
    const sq = fitAspect(full, 1, 0, F)
    nearRect(sq, { x: 1 / 6, y: 0, w: 2 / 3, h: 1 })
    const left = fitAspect({ x: 0, y: 0.25, w: 0.2, h: 0.5 }, 1, 0, F)
    near(left.x, 0)
    near(left.h, 1)
    const tilted = fitAspect(full, 1.5, 10, F)
    expect(fits(tilted, 10, F)).toBe(true)
    near(tilted.w * F.w / (tilted.h * F.h), 1.5)
  })
})

describe('rotate and flip', () => {
  const g: Geometry = { crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.5 }, angle: 4, rotate: 0, flipH: true, flipV: false, aspect: '3:2' }

  it('maps the crop with a quarter turn and swaps flips and aspect', () => {
    const r = rotateQuarter(g, 1)
    nearRect(r.crop, { x: 0.3, y: 0.1, w: 0.5, h: 0.3 })
    expect(r).toMatchObject({ rotate: 1, flipH: false, flipV: true, aspect: '2:3', angle: 4 })
    nearRect(rotateQuarter(g, -1).crop, { x: 0.2, y: 0.6, w: 0.5, h: 0.3 })
    expect(rotateQuarter(g, -1).rotate).toBe(3)
  })

  it('comes back after four turns, or a turn and its opposite', () => {
    let r = g
    for (let i = 0; i < 4; i++) r = rotateQuarter(r, 1)
    nearRect(r.crop, g.crop)
    expect({ ...r, crop: g.crop }).toEqual(g)
    const back = rotateQuarter(rotateQuarter(g, 1), -1)
    nearRect(back.crop, g.crop)
    expect(back.rotate).toBe(0)
  })

  it('mirrors the crop and the straighten angle', () => {
    const h = flip(g, 'h')
    nearRect(h.crop, { x: 0.6, y: 0.2, w: 0.3, h: 0.5 })
    expect(h).toMatchObject({ flipH: false, angle: -4 })
    const v = flip(g, 'v')
    nearRect(v.crop, { x: 0.1, y: 0.3, w: 0.3, h: 0.5 })
    const twice = flip(flip(g, 'v'), 'v')
    nearRect(twice.crop, g.crop)
    expect({ ...twice, crop: g.crop }).toEqual(g)
  })

  it('agrees with the engine about where a rotated crop is', () => {
    const r = rotateQuarter({ ...g, angle: 0 }, 1)
    const src = { width: F.w, height: F.h }
    const before = cropRectInUncropped(src, { ...g, angle: 0 })
    const after = cropRectInUncropped(src, r)
    // A clockwise turn moves the crop's left edge to the top.
    near(after.y, before.x)
    near(after.x, 1 - before.y - before.h)
  })
})

describe('level line', () => {
  it('levels a tilted horizon', () => {
    expect(levelAngle(0, 0, 0, 100, 10)).toBeCloseTo(-5.7, 1)
    expect(levelAngle(2, 100, 10, 0, 0)).toBeCloseTo(-3.7, 1)
  })

  it('makes a near-vertical line plumb', () => {
    expect(levelAngle(0, 0, 0, 10, 100)).toBeCloseTo(5.7, 1)
  })

  it('stays within ±45°', () => {
    expect(levelAngle(40, 0, 0, 100, -30)).toBe(45)
  })
})
