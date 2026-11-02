import { describe, expect, it } from 'vitest'
import { applyHomography, perspectiveInverse, perspectiveMatrix, NO_PERSPECTIVE } from '../edit/perspective'
import type { Geometry, Perspective } from '../edit/types'
import type { SourceColor, SourceImage } from '../engine/types'
import { constrainScale, frameGrey, solveGuided, solveUpright, uprightLines } from './index'
import { detectSegments } from './lines'

const COLOR: SourceColor = { kind: 'display', space: 'srgb-linear' }
const GEO: Geometry = { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original' }
const P = (p: Partial<Perspective>): Perspective => ({ ...NO_PERSPECTIVE, mode: 'manual', ...p })

/**
 * A facade (a grid of dark lines on a light wall, sky above) as the camera saw it:
 * every pixel of the photo is looked up where `truth` would move it. Correcting
 * the photo with `truth` makes the grid square again.
 */
function keystoned(truth: Perspective, W = 960, H = 640): SourceImage {
  const M = perspectiveMatrix(truth, { width: W, height: H })
  const data = new Uint16Array(W * H * 3)
  const pattern = (x: number, y: number) => {
    if (x < 90 || x > W - 90 || y < 70 || y > H - 50) return 0.85 // sky / ground
    const gx = (((x - 90) % 78) + 78) % 78, gy = (((y - 70) % 58) + 58) % 58
    return gx < 4 || gy < 4 ? 0.08 : 0.55
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0
      // 3×3 supersampling for clean edges.
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          const [cx, cy] = applyHomography(M, x + (i + 0.5) / 3, y + (j + 0.5) / 3)
          v += pattern(cx, cy)
        }
      const lin = (v / 9) ** 2.2
      data.fill(Math.round(lin * 65535), (y * W + x) * 3, (y * W + x) * 3 + 3)
    }
  return { width: W, height: H, data }
}

describe('line segments', () => {
  it('finds straight edges with sub-pixel precision', () => {
    const W = 300, H = 200
    const grey = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // A dark slanted band from (40, 30) to (260, 170), and a light background.
        const d = Math.abs((x + 0.5 - 40) * 140 - (y + 0.5 - 30) * 220) / Math.hypot(220, 140)
        grey[y * W + x] = d < 4 ? 0.1 : 0.8
      }
    const segs = detectSegments(grey, W, H).filter((s) => s.length > 100)
    expect(segs.length).toBeGreaterThanOrEqual(2) // the band's two edges
    for (const s of segs) {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const err = Math.abs(Math.sin(a - Math.atan2(140, 220)))
      expect(err).toBeLessThan(0.01) // < 0.6°
    }
  })
})

describe('Upright on a synthetic keystoned facade (known answer)', () => {
  it('vertical: recovers the keystone and the roll', () => {
    const truth = P({ vertical: -30, rotate: 2 })
    const p = solveUpright(keystoned(truth), COLOR, 'vertical', GEO)
    expect(p.mode).toBe('vertical')
    expect(Math.abs(p.vertical - truth.vertical)).toBeLessThan(1.5) // < 0.7° of tilt
    expect(Math.abs(p.rotate - truth.rotate)).toBeLessThan(0.2)
    expect(p.horizontal).toBe(0)
    expect(p.scale).toBe(100)
  })

  it('full: recovers vertical, horizontal and rotation together', () => {
    const truth = P({ vertical: 22, horizontal: -18, rotate: -3 })
    const p = solveUpright(keystoned(truth), COLOR, 'full', GEO)
    expect(Math.abs(p.vertical - truth.vertical)).toBeLessThan(2)
    expect(Math.abs(p.horizontal - truth.horizontal)).toBeLessThan(2)
    expect(Math.abs(p.rotate - truth.rotate)).toBeLessThan(0.3)
  })

  it('level: rotation only', () => {
    const p = solveUpright(keystoned(P({ rotate: 4 })), COLOR, 'level', GEO)
    expect(Math.abs(p.rotate - 4)).toBeLessThan(0.2)
    expect(p.vertical).toBe(0)
    expect(p.horizontal).toBe(0)
  })

  it('auto: corrects clear, moderate keystoning; leaves a straight photo alone', () => {
    const p = solveUpright(keystoned(P({ vertical: -25, horizontal: 10, rotate: 1 })), COLOR, 'auto', GEO)
    expect(Math.abs(p.vertical + 25)).toBeLessThan(2)
    expect(Math.abs(p.horizontal - 10)).toBeLessThan(2.5)
    const straight = solveUpright(keystoned(P({})), COLOR, 'auto', GEO)
    expect(Math.abs(straight.vertical)).toBeLessThan(1)
    expect(Math.abs(straight.horizontal)).toBeLessThan(1)
    expect(Math.abs(straight.rotate)).toBeLessThan(0.1)
  })

  it('works in the frame: a photo stored sideways (quarter turn) gives the same answer', () => {
    const truth = P({ vertical: -30, rotate: 2 })
    const img = keystoned(truth)
    // Store it rotated 90° counter-clockwise; geometry.rotate = 1 turns it back.
    const W = img.width, H = img.height
    const side = new Uint16Array(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) side.set(img.data.subarray((y * W + x) * 3, (y * W + x) * 3 + 3), ((W - 1 - x) * H + y) * 3)
    const p = solveUpright({ width: H, height: W, data: side }, COLOR, 'vertical', { ...GEO, rotate: 1 })
    expect(Math.abs(p.vertical - truth.vertical)).toBeLessThan(1.5)
    expect(Math.abs(p.rotate - truth.rotate)).toBeLessThan(0.2)
    const g = frameGrey({ width: H, height: W, data: side }, COLOR, { ...GEO, rotate: 1 })
    expect([g.width, g.height]).toEqual([960, 640])
  })

  it('finds no lines (and changes nothing) in a featureless photo', () => {
    const flat: SourceImage = { width: 400, height: 300, data: new Uint16Array(400 * 300 * 3).fill(20000) }
    expect(uprightLines(flat, COLOR, GEO).segments).toEqual([])
    const p = solveUpright(flat, COLOR, 'auto', GEO)
    expect([p.vertical, p.horizontal, p.rotate]).toEqual([0, 0, 0])
  })
})

describe('Guided Upright', () => {
  const W = 3000, H = 2000
  const truth = P({ vertical: -35, horizontal: 12, rotate: -2.5 })
  const back = perspectiveInverse(truth, { width: W, height: H })
  /** A line that is vertical / horizontal after the truth correction, as it appears in the photo (mask coordinates). */
  const guide = (x1: number, y1: number, x2: number, y2: number) => {
    const [a, b] = applyHomography(back, x1, y1)
    const [c, d] = applyHomography(back, x2, y2)
    return { x1: a / W, y1: b / H, x2: c / W, y2: d / H }
  }

  it('two vertical guides fix the keystone and the roll', () => {
    const t = P({ vertical: -35, rotate: -2.5 })
    const bk = perspectiveInverse(t, { width: W, height: H })
    const g = (x1: number, y1: number, x2: number, y2: number) => {
      const [a, b] = applyHomography(bk, x1, y1)
      const [c, d] = applyHomography(bk, x2, y2)
      return { x1: a / W, y1: b / H, x2: c / W, y2: d / H }
    }
    const p = solveGuided([g(700, 300, 700, 1700), g(2300, 400, 2300, 1600)], GEO, { width: W, height: H })
    expect(p.mode).toBe('guided')
    expect(p.guides).toHaveLength(2)
    expect(Math.abs(p.vertical + 35)).toBeLessThan(0.15)
    expect(Math.abs(p.rotate + 2.5)).toBeLessThan(0.02)
    expect(p.horizontal).toBe(0)
  })

  it('four guides recover all three', () => {
    const p = solveGuided([guide(600, 300, 600, 1700), guide(2400, 300, 2400, 1700), guide(500, 400, 2500, 400), guide(500, 1600, 2500, 1600)], GEO, { width: W, height: H })
    expect(Math.abs(p.vertical - truth.vertical)).toBeLessThan(0.15)
    expect(Math.abs(p.horizontal - truth.horizontal)).toBeLessThan(0.15)
    expect(Math.abs(p.rotate - truth.rotate)).toBeLessThan(0.02)
  })

  it('one guide only levels', () => {
    const p = solveGuided([{ x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 + (0.8 * Math.tan((3 * Math.PI) / 180) * W) / H }], GEO, { width: W, height: H })
    expect(Math.abs(p.rotate + 3)).toBeLessThan(0.02)
    expect([p.vertical, p.horizontal]).toEqual([0, 0])
  })
})

describe('constrain crop', () => {
  it('zooms just enough to hide the empty corners', () => {
    const frame = { width: 1500, height: 1000 }
    const p = P({ vertical: -40, rotate: 3 })
    const s = constrainScale(p, frame)
    expect(s).toBeGreaterThan(100)
    expect(s).toBeLessThanOrEqual(150)
    expect(constrainScale(P({}), frame)).toBe(100)
    // At that scale the frame corners map back inside the photo.
    const inv = perspectiveInverse({ ...p, scale: s }, frame)
    for (const [x, y] of [[0, 0], [1500, 0], [1500, 1000], [0, 1000]]) {
      const [u, v] = applyHomography(inv, x, y)
      expect(u).toBeGreaterThanOrEqual(-1)
      expect(u).toBeLessThanOrEqual(1501)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1001)
    }
  })
})
