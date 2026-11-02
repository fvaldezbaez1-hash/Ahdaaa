// Lens corrections in lensfun's conventions (as src/lens resolves them): radii
// from the image centre, normalized to half the source's shorter side for
// distortion and TCA, to half its diagonal for vignetting. Pure math, shared by
// the geometry mapping (CPU) and mirrored in the shaders.

import type { LensCorrection, LensGeometry } from '../edit/types'
import type { FloatImage } from './image'

/** 0 = manual only, 1 = poly3, 2 = poly5, 3 = ptlens (lensfun distortion models). */
export interface Radial {
  model: 0 | 1 | 2 | 3
  /** Profile coefficients × amount: poly3 [k1], poly5 [k1, k2], ptlens [a, b, c]. */
  k: [number, number, number]
  /** Manual term, poly3 form (k1 < 0 fixes barrel). */
  manual: number
}

/** Manual distortion: k1 of the poly3 term at slider ±100. */
const MANUAL_K = 0.15

/** Distortion to correct, or null when there's none. */
export function radialOf(g: LensGeometry | undefined): Radial | null {
  if (!g) return null
  const p = g.profile && g.profile.amount > 0 ? g.profile : null
  const manual = (-g.manual / 100) * MANUAL_K
  if (!p && manual === 0) return null
  const a = p ? p.amount / 100 : 0
  const k = (p?.k ?? []).slice(0, 3).map((v) => v * a)
  while (k.length < 3) k.push(0)
  return { model: p ? ({ poly3: 1, poly5: 2, ptlens: 3 } as const)[p.model] : 0, k: k as [number, number, number], manual }
}

/** Distorted / undistorted radius at undistorted radius ru: the source is sampled at centre + (p − centre)·scale. */
export function distortionScale(m: Radial, ru: number): number {
  const r2 = ru * ru
  const [a, b, c] = m.k
  let s = 1
  if (m.model === 1) s = 1 - a + a * r2
  else if (m.model === 2) s = 1 + a * r2 + b * r2 * r2
  else if (m.model === 3) s = a * r2 * ru + b * r2 + c * ru + 1 - a - b - c
  return s * (1 - m.manual + m.manual * r2)
}

/** Undistorted radius whose distorted radius is rd (Newton; the models are monotonic where used). */
export function undistortRadius(m: Radial, rd: number): number {
  let ru = rd
  for (let i = 0; i < 20; i++) {
    const f = ru * distortionScale(m, ru) - rd
    const h = 1e-6 * Math.max(1, ru)
    const df = ((ru + h) * distortionScale(m, ru + h) - (ru - h) * distortionScale(m, ru - h)) / (2 * h)
    if (!(Math.abs(df) > 1e-12)) break
    const next = ru - f / df
    if (Math.abs(next - ru) < 1e-12) return next
    ru = next
  }
  return ru
}

/** Profile vignetting (lensfun "pa"): brightness gain at radius r (1 = half the diagonal). */
export function vignettingGain(k: [number, number, number], amount: number, r: number): number {
  const r2 = r * r
  return 1 / (1 + (amount / 100) * (k[0] * r2 + k[1] * r2 * r2 + k[2] * r2 * r2 * r2))
}

/** Manual vignetting compensation: + brightens the corners (by up to 1 stop), from `midpoint` outwards. ρ = radius / half diagonal. */
export function manualVignettingGain(amount: number, midpoint: number, rho: number): number {
  const a = (midpoint / 100) * 0.8
  const t = Math.min(1, Math.max(0, (rho - a) / (1 - a)))
  const w = t * t * (3 - 2 * t)
  return 2 ** ((amount / 100) * w * w)
}

/** Lateral CA (lensfun poly3 TCA, [v, c, b]): red / blue radius scale at the green position's radius r. */
export const tcaScale = (t: [number, number, number], r: number) => t[0] + t[1] * r + t[2] * r * r

/** What the develop pass needs for the lens corrections that aren't geometry, or null when there are none. */
export interface LensShading {
  /** Per-channel radial scales [v, c, b] for red and blue (green is the reference). */
  tcaR: [number, number, number]
  tcaB: [number, number, number]
  tca: boolean
  vignetting: { k: [number, number, number]; amount: number } | null
  manual: number
  midpoint: number
}

export function shadingOf(l: LensCorrection | undefined, autoCA: { r: number; b: number } | null): LensShading | null {
  if (!l) return null
  const prof = l.enabled
  const tca = prof && l.tca ? l.tca : null
  const auto = l.autoCA && autoCA ? autoCA : null
  const vig = prof && l.vignetting && l.vignetting.amount > 0 ? l.vignetting : null
  if (!tca && !auto && !vig && l.manualVignetting === 0) return null
  // Auto CA refines what the profile leaves: its scales multiply the profile's.
  const tcaR: [number, number, number] = tca ? [...tca.r] : [1, 0, 0]
  const tcaB: [number, number, number] = tca ? [...tca.b] : [1, 0, 0]
  if (auto) {
    tcaR.forEach((v, i) => (tcaR[i] = v * auto.r))
    tcaB.forEach((v, i) => (tcaB[i] = v * auto.b))
  }
  return { tcaR, tcaB, tca: !!(tca || auto), vignetting: vig, manual: l.manualVignetting, midpoint: l.manualVignettingMidpoint }
}

/**
 * Lateral chromatic aberration from the image itself: the red and blue radial scales that best
 * line their edges up with green's — maximum normalized correlation of radial gradients on strong,
 * mostly radial edges, searched ±0.5 % and refined with a parabola. `img` ≈ 1024 px (see autoCASize).
 */
export function estimateCA(img: FloatImage): { r: number; b: number } {
  const { width: W, height: H, data } = img
  const cx = W / 2, cy = H / 2, norm = Math.min(W, H) / 2
  const ch = (c: number) => {
    const o = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) o[i] = Math.log2(Math.max(data[i * 3 + c], 1e-4))
    return o
  }
  const [R, G, B] = [ch(0), ch(1), ch(2)]
  const at = (a: Float32Array, x: number, y: number) => {
    const fx = Math.min(W - 2.001, Math.max(0, x - 0.5)), fy = Math.min(H - 2.001, Math.max(0, y - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    const i = y0 * W + x0
    return (a[i] + (a[i + 1] - a[i]) * tx) * (1 - ty) + (a[i + W] + (a[i + W + 1] - a[i + W]) * tx) * ty
  }
  // Radial derivative (central difference along the radius) at a point.
  const radial = (a: Float32Array, x: number, y: number, ux: number, uy: number) => at(a, x + ux, y + uy) - at(a, x - ux, y - uy)
  const pts: { x: number; y: number; ux: number; uy: number; g: number }[] = []
  for (let y = 2; y < H - 2; y += 1)
    for (let x = 2; x < W - 2; x += 1) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy)
      if (r < 0.35 * norm) continue
      const ux = dx / r, uy = dy / r
      const gx = G[y * W + x + 1] - G[y * W + x - 1], gy = G[(y + 1) * W + x] - G[(y - 1) * W + x]
      const gm = Math.hypot(gx, gy)
      if (gm < 0.6 || Math.abs(gx * ux + gy * uy) < 0.8 * gm) continue
      pts.push({ x: x + 0.5, y: y + 0.5, ux, uy, g: radial(G, x + 0.5, y + 0.5, ux, uy) })
    }
  if (pts.length < 50) return { r: 1, b: 1 }
  pts.sort((a, b) => Math.abs(b.g) - Math.abs(a.g))
  const use = pts.slice(0, 6000)
  const best = (C: Float32Array) => {
    const ncc = (s: number) => {
      let sxy = 0, sxx = 0, syy = 0
      for (const p of use) {
        const x = cx + (p.x - cx) * s, y = cy + (p.y - cy) * s
        const c = radial(C, x, y, p.ux, p.uy)
        sxy += c * p.g
        sxx += c * c
        syy += p.g * p.g
      }
      return sxy / Math.sqrt(sxx * syy + 1e-12)
    }
    const step = 0.0001, n = 50
    let bi = 0, bv = -Infinity
    const vals: number[] = []
    for (let i = -n; i <= n; i++) {
      const v = ncc(1 + i * step)
      vals.push(v)
      if (v > bv) [bv, bi] = [v, i]
    }
    // Parabola through the best and its neighbours for sub-step precision.
    const k = bi + n
    if (k > 0 && k < vals.length - 1) {
      const a = vals[k - 1], b = vals[k], c = vals[k + 1], d = a - 2 * b + c
      if (d < 0) return 1 + (bi + (0.5 * (a - c)) / d) * step
    }
    return 1 + bi * step
  }
  return { r: best(R), b: best(B) }
}

/** Long edge of the copy auto CA is measured on (the same for preview and export, so both agree). */
export const AUTO_CA_EDGE = 1024
