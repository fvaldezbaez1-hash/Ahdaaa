// From line segments to Perspective slider values. The sliders are fitted
// through src/edit/perspective.ts itself, so what the solver promises is
// exactly what the renderer draws.
import { applyHomography, perspectiveMatrix, type FrameSize } from '../edit/perspective'
import type { Perspective } from '../edit/types'
import type { Segment } from './lines'

export type UprightMode = 'auto' | 'level' | 'vertical' | 'full'

/** A segment the fit should make vertical or horizontal. */
export interface Target {
  x1: number
  y1: number
  x2: number
  y2: number
  weight: number
  dir: 'vertical' | 'horizontal'
}

export interface Sliders {
  vertical: number
  horizontal: number
  rotate: number
}

const DEG = Math.PI / 180

/** Direction of a segment in (−90°, 90°], 0 = horizontal. */
export function segmentAngle(s: { x1: number; y1: number; x2: number; y2: number }): number {
  let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
  if (a <= -Math.PI / 2) a += Math.PI
  if (a > Math.PI / 2) a -= Math.PI
  return a
}

export function perspectiveOf(s: Sliders, base?: Partial<Perspective>): Perspective {
  return { vertical: s.vertical, horizontal: s.horizontal, rotate: s.rotate, aspect: 0, scale: 100, offsetX: 0, offsetY: 0, mode: 'manual', guides: [], ...base }
}

/** How far (radians) a target misses its direction after the correction. */
export function residual(H: ReturnType<typeof perspectiveMatrix>, t: Target): number {
  const [x1, y1] = applyHomography(H, t.x1, t.y1)
  const [x2, y2] = applyHomography(H, t.x2, t.y2)
  const a = segmentAngle({ x1, y1, x2, y2 })
  return t.dir === 'horizontal' ? a : a > 0 ? a - Math.PI / 2 : a + Math.PI / 2
}

function cost(s: Sliders, targets: readonly Target[], frame: FrameSize, reg: number): number {
  const H = perspectiveMatrix(perspectiveOf(s), frame)
  let c = 0
  for (const t of targets) {
    const e = residual(H, t)
    c += t.weight * e * e
  }
  return c + reg * (s.vertical * s.vertical + s.horizontal * s.horizontal)
}

/** Nelder–Mead over the free sliders. */
function minimize(f: (x: number[]) => number, x0: number[], step: number[], iterations = 400): number[] {
  const n = x0.length
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))]
  let vals = pts.map(f)
  for (let it = 0; it < iterations; it++) {
    const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
    pts = idx.map((i) => pts[i])
    vals = idx.map((i) => vals[i])
    if (Math.abs(vals[n] - vals[0]) < 1e-14 * (1 + Math.abs(vals[0])) && it > 20) break
    const c = new Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n
    const at = (k: number) => c.map((v, j) => v + k * (pts[n][j] - v))
    const r = at(-1), fr = f(r)
    if (fr < vals[0]) {
      const e = at(-2), fe = f(e)
      ;[pts[n], vals[n]] = fe < fr ? [e, fe] : [r, fr]
    } else if (fr < vals[n - 1]) [pts[n], vals[n]] = [r, fr]
    else {
      const k = at(fr < vals[n] ? -0.5 : 0.5), fk = f(k)
      if (fk < Math.min(fr, vals[n])) [pts[n], vals[n]] = [k, fk]
      else
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]))
          vals[i] = f(pts[i])
        }
    }
  }
  return pts[vals.indexOf(Math.min(...vals))]
}

/** Fit the chosen sliders (the others stay 0) so the targets line up. */
export function fitSliders(targets: readonly Target[], frame: FrameSize, free: (keyof Sliders)[], start: Partial<Sliders> = {}, reg = 1e-9): Sliders {
  const base: Sliders = { vertical: 0, horizontal: 0, rotate: 0, ...start }
  if (!targets.length || !free.length) return base
  const x0 = free.map((k) => base[k])
  const toSliders = (x: number[]): Sliders => {
    const s = { ...base }
    free.forEach((k, i) => (s[k] = x[i]))
    return s
  }
  // Two starts (as is, and from the level estimate) guard against a local minimum.
  let best = minimize((x) => cost(toSliders(x), targets, frame, reg), x0, free.map((k) => (k === 'rotate' ? 1 : 5)))
  const again = minimize((x) => cost(toSliders(x), targets, frame, reg), best, free.map((k) => (k === 'rotate' ? 0.2 : 1)))
  if (cost(toSliders(again), targets, frame, reg) <= cost(toSliders(best), targets, frame, reg)) best = again
  return toSliders(best)
}

// ---------- which segments to straighten ----------

/** Homogeneous line through a segment, in coordinates centred on the frame and scaled by `f`. */
function lineOf(s: Segment, cx: number, cy: number, f: number): [number, number, number] {
  const a: [number, number, number] = [(s.x1 - cx) / f, (s.y1 - cy) / f, 1]
  const b: [number, number, number] = [(s.x2 - cx) / f, (s.y2 - cy) / f, 1]
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Angle between a segment and the direction from its middle to a (homogeneous) vanishing point. */
function vpError(s: Segment, v: [number, number, number], cx: number, cy: number, f: number): number {
  const mx = ((s.x1 + s.x2) / 2 - cx) / f, my = ((s.y1 + s.y2) / 2 - cy) / f
  const dx = v[0] - mx * v[2], dy = v[1] - my * v[2]
  const sx = s.x2 - s.x1, sy = s.y2 - s.y1
  const c = Math.abs(dx * sx + dy * sy) / (Math.hypot(dx, dy) * Math.hypot(sx, sy) || 1)
  return Math.acos(Math.min(1, c))
}

/** Deterministic pseudo-random numbers (the same photo always gives the same answer). */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/**
 * The family of segments that meets in one vanishing point (RANSAC over
 * pairs, weighted by length). Returns the inliers and their total length.
 */
export function vanishingFamily(cands: readonly Segment[], frame: FrameSize, tolerance = 1.5 * DEG): Family {
  if (cands.length < 2) return { inliers: [...cands], support: cands.reduce((n, s) => n + s.length, 0), vp: null }
  const cx = frame.width / 2, cy = frame.height / 2, f = Math.max(frame.width, frame.height)
  const lines = cands.map((s) => lineOf(s, cx, cy, f))
  const total = cands.reduce((n, s) => n + s.length, 0)
  const rand = rng(cands.length * 7919 + Math.round(total))
  const pick = () => {
    let r = rand() * total
    for (let i = 0; i < cands.length; i++) if ((r -= cands[i].length) <= 0) return i
    return cands.length - 1
  }
  let best: Segment[] = []
  let bestSupport = 0
  let bestVp: [number, number, number] | null = null
  for (let it = 0; it < 400; it++) {
    const i = pick(), j = pick()
    if (i === j) continue
    const a = lines[i], b = lines[j]
    const v: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const norm = Math.hypot(...v)
    if (!norm) continue
    const inl = cands.filter((s) => vpError(s, v, cx, cy, f) < Math.max(tolerance, 1.5 / s.length))
    const sup = inl.reduce((n, s) => n + s.length, 0)
    if (sup > bestSupport) {
      bestSupport = sup
      best = inl
      bestVp = [v[0] / norm, v[1] / norm, v[2] / norm]
    }
  }
  return { inliers: best, support: bestSupport, vp: bestVp }
}

export interface Family {
  inliers: Segment[]
  support: number
  /** Vanishing point, homogeneous, in frame coordinates centred and divided by the long edge (null: unknown). */
  vp: [number, number, number] | null
}

/** Spread of the segments' middles across the frame: x for verticals, y for horizontals (fraction of that side). */
export function spread(segs: readonly Segment[], frame: FrameSize, axis: 'x' | 'y'): number {
  if (!segs.length) return 0
  const v = segs.map((s) => (axis === 'x' ? (s.x1 + s.x2) / 2 / frame.width : (s.y1 + s.y2) / 2 / frame.height))
  return Math.max(...v) - Math.min(...v)
}

/** Whether a family's vanishing point lies well outside the frame (or at infinity). */
export function vpOutside(f: Family, frame: FrameSize): boolean {
  if (!f.vp) return false
  const [x, y, w] = f.vp
  if (Math.abs(w) < 1e-9) return true
  const long = Math.max(frame.width, frame.height)
  return Math.abs(x / w) > (0.5 * frame.width) / long + 0.25 || Math.abs(y / w) > (0.5 * frame.height) / long + 0.25
}

/** Weighted median of values. */
export function weightedMedian(values: readonly { v: number; w: number }[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a.v - b.v)
  const half = s.reduce((n, x) => n + x.w, 0) / 2
  let acc = 0
  for (const x of s) if ((acc += x.w) >= half) return x.v
  return s[s.length - 1].v
}

export interface Analysis {
  vertical: Family
  horizontal: Family
  /** The vertical family is real perspective evidence: several lines spread across the frame. */
  verticalOk: boolean
  /** Likewise for the horizontal family (spread vertically, converging outside the frame). */
  horizontalOk: boolean
  /** Rotation (degrees, + = clockwise) that levels the photo. */
  level: number
}

/** Split segments into a vertical and a horizontal family, judge the evidence, and estimate the level. */
export function analyse(segments: readonly Segment[], frame: FrameSize): Analysis {
  const vert = segments.filter((s) => Math.abs(segmentAngle(s)) > 60 * DEG)
  const horiz = segments.filter((s) => Math.abs(segmentAngle(s)) < 35 * DEG)
  const vertical = vanishingFamily(vert, frame)
  const horizontal = vanishingFamily(horiz, frame)
  // One tapering object (a lighthouse, a tree trunk) isn't perspective: its edges sit close together.
  const verticalOk = vertical.inliers.length >= 3 && spread(vertical.inliers, frame, 'x') >= 0.2 && vertical.support >= 0.3 * frame.height
  const horizontalOk = horizontal.inliers.length >= 4 && spread(horizontal.inliers, frame, 'y') >= 0.2 && vpOutside(horizontal, frame)
  let level = 0
  if (verticalOk) level = fitSliders(targetsOf(vertical.inliers, 'vertical'), frame, ['vertical', 'rotate']).rotate
  else {
    // The horizon / near-horizontal lines.
    const nearH = horiz.filter((s) => Math.abs(segmentAngle(s)) < 10 * DEG).map((s) => ({ v: -segmentAngle(s) / DEG, w: s.length }))
    if (nearH.reduce((n, x) => n + x.w, 0) >= 0.5 * Math.max(frame.width, frame.height)) level = weightedMedian(nearH)
  }
  return { vertical, horizontal, verticalOk, horizontalOk, level: level || 0 }
}

const targetsOf = (segs: readonly Segment[], dir: 'vertical' | 'horizontal'): Target[] => segs.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, weight: s.length, dir }))

const clampRotate = (r: number) => Math.max(-10, Math.min(10, r))

/**
 * Slider values for an Upright mode.
 * - level: rotation only.
 * - vertical: converging verticals made parallel (and levelled by them).
 * - full: verticals and the main horizontal family both straightened.
 * - auto: balanced and conservative: verticals only when there is clear
 *   evidence and the tilt is plausible (≤ 30°), horizontals only when strong
 *   and modest (≤ 15°), otherwise just level.
 */
export function solveMode(a: Analysis, frame: FrameSize, mode: UprightMode): Sliders {
  const long = Math.max(frame.width, frame.height)
  const level: Sliders = { vertical: 0, horizontal: 0, rotate: clampRotate(a.level) }
  if (mode === 'level') return level
  const vT = targetsOf(a.vertical.inliers, 'vertical')
  const hT = targetsOf(a.horizontal.inliers, 'horizontal')
  const clamp = (s: Sliders): Sliders => ({ vertical: Math.max(-100, Math.min(100, s.vertical)), horizontal: Math.max(-100, Math.min(100, s.horizontal)), rotate: clampRotate(s.rotate) })
  const vFit = a.verticalOk ? fitSliders(vT, frame, ['vertical', 'rotate'], { rotate: level.rotate }) : null
  /** Verticals and horizontals together, if the horizontals agree with the verticals and fit well. */
  const both = (maxH: number): Sliders | null => {
    if (!a.horizontalOk) return null
    const f = vFit ? fitSliders([...vT, ...hT], frame, ['vertical', 'horizontal', 'rotate'], vFit) : fitSliders(hT, frame, ['horizontal', 'rotate'], { rotate: level.rotate })
    if (Math.abs(f.horizontal) > maxH) return null
    if (vFit && Math.abs(f.vertical - vFit.vertical) > 10) return null
    const H = perspectiveMatrix(perspectiveOf(f), frame)
    const rms = (ts: Target[]) => Math.sqrt(ts.reduce((n, t) => n + t.weight * residual(H, t) ** 2, 0) / Math.max(1e-9, ts.reduce((n, t) => n + t.weight, 0)))
    if (rms(hT) > 1.2 * DEG || (vFit && rms(vT) > 1.2 * DEG)) return null
    return f
  }
  if (mode === 'vertical') return vFit ? clamp(vFit) : level
  if (mode === 'full') return clamp(both(75) ?? vFit ?? level)
  // auto: verticals when the evidence is clear and the tilt plausible (≤ 30°); horizontals only when strong and modest (≤ 15°).
  if (!vFit || a.vertical.support < 0.5 * frame.height || Math.abs(vFit.vertical) > (30 / 45) * 100) return level
  const strongH = a.horizontal.inliers.length >= 6 && a.horizontal.support >= 0.8 * long
  return clamp((strongH && both((15 / 45) * 100)) || vFit)
}

/**
 * The zoom (scale %, ≥ 100) at which the corrected photo covers the whole
 * frame (no empty corners): Lightroom's "Constrain crop".
 */
export function constrainScale(p: Perspective, frame: FrameSize): number {
  const covers = (scale: number) => {
    const H = perspectiveMatrix({ ...p, scale }, frame)
    const quad = [
      [0, 0],
      [frame.width, 0],
      [frame.width, frame.height],
      [0, frame.height],
    ].map(([x, y]) => applyHomography(H, x, y))
    // Every frame corner inside the (convex) corrected outline of the photo.
    const corners = [
      [0, 0],
      [frame.width, 0],
      [frame.width, frame.height],
      [0, frame.height],
    ]
    return corners.every(([x, y]) => {
      let sign = 0
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % 4]
        const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax))
        if (c && sign && c !== sign) return false
        if (c) sign = c
      }
      return true
    })
  }
  let lo = p.scale, hi = p.scale
  if (covers(lo)) return Math.round(lo)
  while (!covers(hi) && hi < 400) hi *= 1.25
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (covers(mid)) hi = mid
    else lo = mid
  }
  return Math.min(150, Math.ceil(hi))
}
