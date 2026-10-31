// Sky selection: a depth model plus what skies look like.
//
// Depth Anything V2 puts the sky at (nearly) zero disparity. A pixel is sky
// when it is that far away, is reached from the top of the frame through
// such pixels, and looks like sky (smooth; blue, grey-white or sunset bright),
// which keeps out distant mountains and sea at the horizon. Far, sky-coloured
// regions that trees cut off from the main sky (gaps between branches) are
// added when their colour matches it. Edges are then snapped to the photo.
//
// Limits: night skies and skies with heavy texture (dense, dark storm clouds)
// are often missed; distant snowy peaks or haze can leak in; a photo without
// sky gives an empty (or near-empty) mask, as it should.
import { boxBlur, contrast, downscale, fit, floodFrom, guidedFilter, morph, resize } from './pixels'

export interface Depth {
  /** Relative inverse depth (bigger = closer), size × size, stretched over the photo. */
  disparity: Float32Array
  size: number
}

export function skyMask(rgb: Float32Array, grey: Float32Array, w: number, h: number, depth: Depth | null): Float32Array {
  const { width: sw, height: sh } = fit(w, h, 384)
  const n = sw * sh
  const c = downscale(rgb, w, h, sw, sh, 3)
  const y = downscale(grey, w, h, sw, sh, 1)

  // Local contrast (std of grey over 5×5): skies are smooth.
  const sq = y.map((v) => v * v)
  const m1 = boxBlur(y, sw, sh, 2), m2 = boxBlur(sq, sw, sh, 2)
  const tex = new Float32Array(n)
  for (let i = 0; i < n; i++) tex[i] = Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]))

  let far: Float32Array | null = null
  if (depth) {
    const d = resize(depth.disparity, depth.size, depth.size, sw, sh)
    const sorted = Float32Array.from(d).sort()
    const top = sorted[Math.floor(sorted.length * 0.99)] || 1
    far = d.map((v) => v / top)
  }

  const looksLikeSky = (i: number) => {
    const r = c[i * 3], g = c[i * 3 + 1], b = c[i * 3 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx > 0 ? (mx - mn) / mx : 0
    const blue = b >= r - 0.02 && b >= g - 0.06 && y[i] > 0.2
    const pale = y[i] > 0.45 && sat < 0.35
    const glow = y[i] > 0.4 && r > b // sunset / sunrise
    return blue || pale || glow
  }
  const candidate = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (far) candidate[i] = +((far[i] < 0.025 && y[i] > 0.08) || (far[i] < 0.1 && tex[i] < 0.05 && looksLikeSky(i)))
    else candidate[i] = +(tex[i] < 0.035 && looksLikeSky(i))
  }

  // Reached from the top edge (and the top 2 % of rows, for frames whose very top is a branch).
  const seeds: number[] = []
  for (let i = 0; i < Math.max(sw, Math.round(sh * 0.02) * sw); i++) seeds.push(i)
  const sky = floodFrom(sw, sh, seeds, (i) => candidate[i] === 1)

  // Gaps in foliage etc.: far and the same colour as the connected sky.
  let count = 0
  const mean = [0, 0, 0]
  for (let i = 0; i < n; i++)
    if (sky[i]) {
      count++
      for (let k = 0; k < 3; k++) mean[k] += c[i * 3 + k]
    }
  if (!count) return new Float32Array(w * h)
  for (let k = 0; k < 3; k++) mean[k] /= count
  if (far)
    for (let i = 0; i < n; i++)
      if (!sky[i] && candidate[i] && far[i] < 0.03) {
        const dist = Math.hypot(c[i * 3] - mean[0], c[i * 3 + 1] - mean[1], c[i * 3 + 2] - mean[2])
        if (dist < 0.12) sky[i] = 1
      }

  // Tiny specks aren't sky decisions worth keeping: close 1-px gaps, drop isolated pixels.
  let m: Float32Array = Float32Array.from(sky)
  m = morph(morph(m, sw, sh, 1, 'dilate'), sw, sh, 1, 'erode')
  // Full size, then snap to the photo's edges (branches, roof lines).
  const up = resize(m, sw, sh, w, h)
  const r = Math.max(2, Math.round(Math.max(w, h) / 200))
  return contrast(guidedFilter(grey, up, w, h, r, 4e-4), 0.25, 0.75)
}
