// Healing on the CPU side: where to take a patch from (findHealSource) and which
// part of the source a window of the image needs once spots copy pixels around.

import type { Retouch, RetouchSpot } from '../edit/types'
import type { SourceImage } from './types'

/** Bilinear sample of a Uint16 RGB image (0…1), clamped to the edges. */
function sample(img: SourceImage, x: number, y: number, out: number[], o: number) {
  const fx = Math.min(img.width - 1.001, Math.max(0, x - 0.5)), fy = Math.min(img.height - 1.001, Math.max(0, y - 0.5))
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
  const d = img.data, w = img.width
  for (let c = 0; c < 3; c++) {
    const a = d[(y0 * w + x0) * 3 + c], b = d[(y0 * w + x0 + 1) * 3 + c]
    const e = d[((y0 + 1) * w + x0) * 3 + c], f = d[((y0 + 1) * w + x0 + 1) * 3 + c]
    const v = (a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty
    out[o + c] = Math.log2(v / 65535 + 1e-4)
  }
}

const RING_ANGLES = 32
const RING_RADII = [1.15, 1.35, 1.6]

/** Log colors on an annulus around (cx, cy) (px), the spot's "surroundings". */
function ring(img: SourceImage, cx: number, cy: number, R: number): number[] {
  const out: number[] = []
  for (const k of RING_RADII)
    for (let i = 0; i < RING_ANGLES; i++) {
      const a = (2 * Math.PI * i) / RING_ANGLES
      sample(img, cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k, out, out.length)
    }
  return out
}

/** Log colors inside the circle. */
function disk(img: SourceImage, cx: number, cy: number, R: number): number[] {
  const out: number[] = []
  for (const k of [0, 0.35, 0.7])
    for (let i = 0; i < (k ? 12 : 1); i++) {
      const a = (2 * Math.PI * i) / 12
      sample(img, cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k, out, out.length)
    }
  return out
}

/**
 * Best place to heal the spot at (x, y) radius r (mask coordinates) from: on rings of
 * 1.5…4 r around it, the patch whose surroundings match the spot's surroundings and whose
 * inside looks like them (no other blemish), not overlapping other spots, inside the image.
 */
export function findHealSource(img: SourceImage, spots: RetouchSpot[], x: number, y: number, r: number): { sx: number; sy: number } | null {
  const W = img.width, H = img.height, L = Math.max(W, H)
  const px = x * W, py = y * H, R = r * L
  if (!(R >= 0.5)) return null
  const target = ring(img, px, py, R)
  const n = target.length / 3
  const mean = [0, 0, 0]
  for (let i = 0; i < target.length; i++) mean[i % 3] += target[i] / n
  const others = spots.filter((s) => Math.hypot(s.x * W - px, s.y * H - py) > 1e-6 || Math.abs(s.r * L - R) > 1e-6)
  let best: { sx: number; sy: number } | null = null, bestCost = Infinity
  for (const k of [1.5, 2, 2.5, 3, 3.5, 4]) {
    const count = Math.max(12, Math.round((2 * Math.PI * k) / 0.45))
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * (i + (k % 1 ? 0.5 : 0))) / count
      const cx = px + Math.cos(a) * k * R, cy = py + Math.sin(a) * k * R
      const edge = R * RING_RADII[RING_RADII.length - 1]
      if (cx - edge < 0 || cy - edge < 0 || cx + edge > W || cy + edge > H) continue
      if (others.some((s) => Math.hypot(s.x * W - cx, s.y * H - cy) < (s.r * L + R) * 1.05 || Math.hypot(s.sx * W - cx, s.sy * H - cy) < (s.r * L + R) * 1.05)) continue
      const cand = ring(img, cx, cy, R)
      let cost = 0
      for (let j = 0; j < cand.length; j++) cost += (cand[j] - target[j]) ** 2
      cost /= n
      const inside = disk(img, cx, cy, R)
      let ci = 0
      for (let j = 0; j < inside.length; j++) ci += (inside[j] - mean[j % 3]) ** 2
      cost += (0.5 * ci) / (inside.length / 3)
      // Overlapping the spot itself would copy the blemish: prefer patches that clear it.
      if (k < 2.05) cost *= 1.5
      if (cost < bestCost) {
        bestCost = cost
        best = { sx: cx / W, sy: cy / H }
      }
    }
  }
  return best
}

/** Margin (source px) around a removal's rectangle (w × h source px) where its grain level is measured. */
export const removalRing = (w: number, h: number) => Math.max(4, 0.12 * Math.max(w, h))

/**
 * Grow a source-pixel window so it holds everything the retouching inside it reads: the circles
 * spots copy from (and what those were healed from, and so on), and a removal's whole area with
 * the ring its grain level is measured on. Tiles then retouch exactly like the whole image.
 */
export function retouchWindow(items: readonly Retouch[], W: number, H: number, win: { x0: number; y0: number; x1: number; y1: number }) {
  const L = Math.max(W, H)
  const w = { ...win }
  const grow = (n: { x0: number; y0: number; x1: number; y1: number }) => {
    if (n.x0 >= w.x0 && n.y0 >= w.y0 && n.x1 <= w.x1 && n.y1 <= w.y1) return false
    Object.assign(w, { x0: Math.min(w.x0, n.x0), y0: Math.min(w.y0, n.y0), x1: Math.max(w.x1, n.x1), y1: Math.max(w.y1, n.y1) })
    return true
  }
  // A spot reads its source circle and a ring around both circles (heal matching).
  const reach = (s: RetouchSpot) => s.r * L * 1.35 + 3
  for (let pass = 0; pass <= items.length; pass++) {
    let grew = false
    for (const s of items) {
      if (s.mode === 'remove') {
        const rw = s.rect.w * W, rh = s.rect.h * H, e = removalRing(rw, rh) + 4
        const r = { x0: s.rect.x * W - e, y0: s.rect.y * H - e, x1: s.rect.x * W + rw + e, y1: s.rect.y * H + rh + e }
        if (r.x1 >= w.x0 && r.x0 <= w.x1 && r.y1 >= w.y0 && r.y0 <= w.y1 && grow(r)) grew = true
        continue
      }
      const e = reach(s)
      const dx = s.x * W, dy = s.y * H
      if (dx + e < w.x0 || dx - e > w.x1 || dy + e < w.y0 || dy - e > w.y1) continue
      const sx = s.sx * W, sy = s.sy * H
      if (grow({ x0: Math.min(sx, dx) - e, y0: Math.min(sy, dy) - e, x1: Math.max(sx, dx) + e, y1: Math.max(sy, dy) + e })) grew = true
    }
    if (!grew) break
  }
  return { x0: Math.max(0, w.x0), y0: Math.max(0, w.y0), x1: Math.min(W, w.x1), y1: Math.min(H, w.y1) }
}
