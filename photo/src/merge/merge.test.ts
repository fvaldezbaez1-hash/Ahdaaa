import { describe, expect, it } from 'vitest'
import { detectFeatures, matchFeatures } from './features'
import { apply3, homographyFrom, mul3, ransac, rng, rodrigues, transpose3, type M3 } from './geometry'
import { alignToReference, ghostMasks, HdrAccumulator, unclipped } from './hdr'
import { librawCurve, librawInverse } from './linearize'
import { blendTile, gainCompensation, largestRectangle, PanoMapper, planPanorama, type PanoPlan, type RenderSource } from './pano'

/** A textured scene: random rectangles (corners for features) over a smooth gradient, as a function of (u, v). */
function scene(seed = 3) {
  const r = rng(seed)
  const rects = Array.from({ length: 160 }, () => ({ x: r() * 2 - 1, y: r() * 2 - 1, w: 0.02 + r() * 0.12, h: 0.02 + r() * 0.12, v: 0.1 + r() * 0.8 }))
  return (u: number, v: number) => {
    let s = 0.35 + 0.15 * Math.sin(u * 3) * Math.cos(v * 2)
    for (const q of rects) if (u >= q.x && u < q.x + q.w && v >= q.y && v < q.y + q.h) s = q.v
    return s
  }
}

/** Render a grey image of the scene through a pixel → (u, v) map, 2×2 supersampled. */
function render(w: number, h: number, map: (x: number, y: number) => [number, number], f = scene()): Float32Array {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const [u, v] = map(x + dx, y + dy)
        s += f(u, v)
      }
      out[y * w + x] = s / 4
    }
  return out
}

describe('geometry', () => {
  it('recovers a homography from matches with 30 % outliers', () => {
    const H: M3 = [1.02, 0.05, 12, -0.03, 0.98, -7, 1e-4, -5e-5, 1]
    const r = rng(9)
    const matches = Array.from({ length: 200 }, (_, i) => {
      const x = r() * 800, y = r() * 600
      const [u, v] = apply3(H, x, y)
      return i % 10 < 3 ? { x1: x, y1: y, x2: r() * 800, y2: r() * 600 } : { x1: x, y1: y, x2: u + (r() - 0.5) * 0.4, y2: v + (r() - 0.5) * 0.4 }
    })
    const res = ransac(matches, 'homography', 1.5)!
    expect(res.inliers.length).toBeGreaterThanOrEqual(135)
    for (const [x, y] of [[0, 0], [800, 0], [400, 300], [800, 600]]) {
      const [a, b] = apply3(H, x, y), [c, d] = apply3(res.model, x, y)
      expect(Math.hypot(a - c, b - d)).toBeLessThan(0.5)
    }
    expect(homographyFrom(matches.slice(0, 3))).toBeNull()
  })
})

describe('alignment', () => {
  it('finds a small shift and rotation between brackets, despite the exposure difference', () => {
    const W = 360, H = 240
    const t: M3 = (() => {
      const a = (1.2 * Math.PI) / 180
      return [Math.cos(a), -Math.sin(a), 6.5, Math.sin(a), Math.cos(a), -4.25, 0, 0, 1]
    })()
    const ref = render(W, H, (x, y) => [x / W * 2 - 1, y / H * 2 - 1])
    // The frame: same scene seen through t (ref px → frame px), a stop brighter, its highlights clipped.
    const tinv = inv(t)
    const frame = render(W, H, (x, y) => {
      const [u, v] = apply3(tinv, x, y)
      return [u / W * 2 - 1, v / H * 2 - 1]
    }).map((v) => Math.min(1, v * 2))
    const { transform, inliers } = alignToReference(frame, ref, W, H, 2)
    expect(inliers).toBeGreaterThan(20)
    for (const [x, y] of [[50, 50], [300, 60], [180, 200]]) {
      const [a, b] = apply3(t, x, y), [c, d] = apply3(transform, x, y)
      expect(Math.hypot(a - c, b - d)).toBeLessThan(0.6)
    }
  })
})

function inv(m: M3): M3 {
  const d = m[0] * m[4] - m[1] * m[3]
  return [m[4] / d, -m[1] / d, (m[1] * m[5] - m[4] * m[2]) / d, -m[3] / d, m[0] / d, (m[3] * m[2] - m[0] * m[5]) / d, 0, 0, 1]
}

describe('HDR merge', () => {
  const ID: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const lut = Float32Array.from({ length: 65536 }, (_, i) => i / 65535)
  const W = 64, H = 32
  /** Radiance spanning 0.002 … 8 (12 stops), per pixel. */
  const radiance = (x: number, y: number) => 0.002 * 2 ** ((x / (W - 1)) * 12) * (1 + 0.1 * (y / H))
  const frameOf = (k: number, noise = 0) => {
    const r = rng(Math.round(k * 1000))
    const data = new Uint16Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (let c = 0; c < 3; c++) {
          const v = Math.min(1, radiance(x, y) * k * (1 + noise * (r() - 0.5)))
          data[(y * W + x) * 3 + c] = Math.round(v * 65535)
        }
    return { data, width: W, height: H }
  }

  it('recovers radiance across 12 stops from three brackets (−2, 0, +2 EV)', () => {
    const acc = new HdrAccumulator(W, H)
    const ks = [0.25, 1, 4]
    ks.forEach((k, i) => acc.add(frameOf(k), lut, { k, transform: ID, whiteBalance: [1, 1, 1], darkest: i === 0 }))
    const px = [0, 0, 0]
    let worst = 0
    for (let y = 0; y < H; y += 3)
      for (let x = 0; x < W; x++) {
        const R = radiance(x, y)
        // Below the darkest usable level of the brightest frame there's nothing to recover.
        if (R * 4 < 2 / 65535 * 50 || R * 0.25 > 0.97) continue
        acc.radiance(y * W + x, px)
        worst = Math.max(worst, Math.abs(px[1] - R) / R)
      }
    expect(worst).toBeLessThan(0.02)
    // Highlights clipped in the reference (R up to ~3.9) come from the short exposure.
    acc.radiance(5 * W + (W - 3), px)
    expect(px[1]).toBeGreaterThan(3)
  })

  it('weights fall to zero at clipping', () => {
    expect(unclipped(0.5)).toBe(1)
    expect(unclipped(0.97)).toBe(0)
    expect(unclipped(0.9)).toBeGreaterThan(0)
    expect(unclipped(0.9)).toBeLessThan(1)
  })

  it('deghosting leaves out a frame where something moved', () => {
    const k = [0.5, 1, 2]
    const base = (kk: number) => new Float32Array(W * H * 3).fill(Math.min(1, 0.2 * kk))
    const frames = k.map((kk) => ({ rgb: base(kk), k: kk, transform: ID }))
    // Something bright passes through the +1 EV frame.
    for (let y = 10; y < 20; y++) for (let x = 20; x < 30; x++) for (let c = 0; c < 3; c++) frames[2].rgb[(y * W + x) * 3 + c] = 0.05
    const masks = ghostMasks(frames, 1, W, H, 'medium')
    expect(masks[1].every((v) => v === 1)).toBe(true)
    expect(masks[2][15 * W + 25]).toBeLessThan(0.2)
    expect(masks[2][5 * W + 50]).toBeGreaterThan(0.9)
    expect(masks[0][15 * W + 25]).toBeGreaterThan(0.9)
    expect(ghostMasks(frames, 1, W, H, 'off')[2][15 * W + 25]).toBe(1)
  })
})

describe('LibRaw curve', () => {
  it('inverts LibRaw’s BT.709 output curve', () => {
    const c = librawCurve(), inv = librawInverse()
    // Exact in the toe; within the curve's own step (≤ 2.3 codes) near white.
    for (const i of [0, 10, 300, 2000]) expect(Math.abs(inv[c[i]] - i)).toBeLessThan(1)
    for (const i of [10000, 40000, 65000]) expect(Math.abs(inv[c[i]] - i)).toBeLessThan(2.5)
    expect(c[300]).toBeCloseTo(300 * 4.5, -1) // the linear toe
  })
})

describe('panorama', () => {
  // Three photos of a scene on a sphere, 30° apart, through a pinhole camera (f = 420 px).
  const W = 400, H = 300, F = 420
  const world = scene(5)
  const toWorld = (d: number[]) => [Math.atan2(d[0], d[2]), Math.asin(d[1] / Math.hypot(d[0], d[1], d[2]))] as [number, number]
  const yaws = [-30, 0, 30].map((a) => (a * Math.PI) / 180)
  const cams = yaws.map((a, i) => mul3(rodrigues([0.02 * (i - 1), 0, 0]), rodrigues([0, -a, 0]))) // R: world → camera (a little pitch too)
  const photo = (R: M3, gain = 1) =>
    render(W, H, (x, y) => {
      const c = [(x - W / 2) / F, (y - H / 2) / F, 1]
      const Rt = transpose3(R)
      const d = [Rt[0] * c[0] + Rt[1] * c[1] + Rt[2] * c[2], Rt[3] * c[0] + Rt[4] * c[1] + Rt[5] * c[2], Rt[6] * c[0] + Rt[7] * c[1] + Rt[8] * c[2]]
      return toWorld(d)
    }, (u, v) => world(u * 1.5, v * 1.5) * gain)
  const greys = cams.map((R) => photo(R))

  let plan: PanoPlan
  it('registers the photos: focal length and relative rotations', () => {
    plan = planPanorama(greys.map((g) => ({ grey: g, width: W, height: H })), 'cylindrical')
    expect(plan.pairs.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(plan.f - F) / F).toBeLessThan(0.05)
    // Relative yaw between neighbours ≈ 30°.
    const rel = (a: number, b: number) => {
      const M = mul3(plan.cameras[a].R, transpose3(plan.cameras[b].R))
      return (Math.acos(Math.min(1, (M[0] + M[4] + M[8] - 1) / 2)) * 180) / Math.PI
    }
    expect(Math.abs(rel(0, 1) - 30)).toBeLessThan(0.5)
    expect(Math.abs(rel(1, 2) - 30)).toBeLessThan(0.5)
    expect(plan.rms).toBeLessThan(1)
    expect(plan.span[0]).toBeGreaterThan(90)
  })

  it('evens out exposure and blends without seams', () => {
    const gainsTrue = [1, 1.25, 0.85]
    const imgs = cams.map((R, i) => photo(R, gainsTrue[i]))
    const sources: RenderSource[] = imgs.map((g) => ({ data: Float32Array.from({ length: g.length * 3 }, (_, k) => g[Math.floor(k / 3)]), width: W, height: H, gain: [1, 1, 1] }))
    const mapper = new PanoMapper(plan, 0.5, [1, 1, 1])
    const gains = gainCompensation(mapper, sources, 2)
    // Relative gains undo the exposure differences (overall level is free).
    expect(gains[1] / gains[0]).toBeCloseTo(1 / 1.25, 1)
    expect(gains[2] / gains[0]).toBeCloseTo(1 / 0.85, 1)
    const fixed = sources.map((s, i) => ({ ...s, gain: [gains[i], gains[i], gains[i]] }))
    const { rgb, covered } = blendTile(mapper, fixed, 0, 0, mapper.width, mapper.height, 4)
    // No seams: along the middle row, neighbouring pixels never jump more than the scene itself does.
    const y = Math.floor(mapper.height / 2)
    let jumps = 0
    for (let x = 1; x < mapper.width; x++) {
      if (!covered[y * mapper.width + x] || !covered[y * mapper.width + x - 1]) continue
      if (Math.abs(rgb[(y * mapper.width + x) * 3] - rgb[(y * mapper.width + x - 1) * 3]) > 0.5) jumps++
    }
    expect(jumps).toBeLessThan(mapper.width * 0.05)
    const crop = largestRectangle(covered, mapper.width, mapper.height)
    expect(crop.w).toBeGreaterThan(0.8)
    expect(crop.h).toBeGreaterThan(0.6)
  })

  it('largest rectangle of a mask', () => {
    const w = 10, h = 6
    const m = new Uint8Array(w * h).fill(1)
    for (let x = 0; x < w; x++) m[x] = 0 // top row empty
    m[5 * w + 0] = 0
    // Rows 1–5 without the blocked first column (9 × 5) beat rows 1–4 full width (10 × 4).
    expect(largestRectangle(m, w, h)).toEqual({ x: 1 / 10, y: 1 / 6, w: 9 / 10, h: 5 / 6 })
  })
})

// Silence unused import warnings for helpers kept for future tests.
void detectFeatures
void matchFeatures
