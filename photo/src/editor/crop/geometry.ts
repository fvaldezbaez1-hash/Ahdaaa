import type { AspectId, Geometry, Rect } from '../../edit/types'

// Crop & straighten math.
//
// "Frame" = the photo after quarter turns and flips (W×H pixels). The stored
// crop is a normalized rect in the frame; straightening rotates the content
// clockwise by `angle` around the crop center, so the output is the crop rect
// filled with frame pixels p = c + R(−angle)·(q − c).
//
// The crop tool shows the whole straightened frame (its bounding box, the
// "view") with the crop drawn axis-aligned on top. Every function below works
// in pixels of the frame (or of the view, which has the same scale).

export interface Size {
  w: number
  h: number
}

/** Axis-aligned rectangle in view pixels. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const ASPECTS: { id: AspectId; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'free', label: 'Free' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
]

export const DEFAULT_GEOMETRY: Geometry = { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original' }
export const MAX_ANGLE = 45

const rad = (deg: number) => (deg * Math.PI) / 180

/** Frame size after quarter turns (flips don't change it). */
export function frameSize(src: Size, rotate: number): Size {
  return rotate % 2 ? { w: src.h, h: src.w } : { w: src.w, h: src.h }
}

/** Width ÷ height of an aspect preset in pixels; null = free. */
export function aspectRatio(aspect: AspectId, frame: Size): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return frame.w / frame.h
  const [a, b] = aspect.split(':').map(Number)
  return a / b
}

/** Bounding box of the frame rotated by `angle`: what the crop tool shows. */
export function viewSize(frame: Size, angle: number): Size {
  const c = Math.abs(Math.cos(rad(angle))), s = Math.abs(Math.sin(rad(angle)))
  return { w: frame.w * c + frame.h * s, h: frame.w * s + frame.h * c }
}

/** Stored crop → its axis-aligned box in the view. */
export function cropToView(crop: Rect, angle: number, frame: Size): Box {
  const v = viewSize(frame, angle)
  const dx = (crop.x + crop.w / 2 - 0.5) * frame.w, dy = (crop.y + crop.h / 2 - 0.5) * frame.h
  const cos = Math.cos(rad(angle)), sin = Math.sin(rad(angle))
  const w = crop.w * frame.w, h = crop.h * frame.h
  return { x: v.w / 2 + cos * dx - sin * dy - w / 2, y: v.h / 2 + sin * dx + cos * dy - h / 2, w, h }
}

/** Box in the view → stored crop (normalized, frame space). */
export function viewToCrop(box: Box, angle: number, frame: Size): Rect {
  const v = viewSize(frame, angle)
  const dx = box.x + box.w / 2 - v.w / 2, dy = box.y + box.h / 2 - v.h / 2
  const cos = Math.cos(rad(angle)), sin = Math.sin(rad(angle))
  const cx = (cos * dx + sin * dy) / frame.w + 0.5, cy = (-sin * dx + cos * dy) / frame.h + 0.5
  const w = box.w / frame.w, h = box.h / frame.h
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** How far the straightened crop reaches from its center, per unit of half-width / half-height. */
function reach(hw: number, hh: number, angle: number) {
  const c = Math.abs(Math.cos(rad(angle))), s = Math.abs(Math.sin(rad(angle)))
  return { ex: hw * c + hh * s, ey: hw * s + hh * c }
}

/** Largest factor the crop can be scaled by around its center and stay inside the photo. */
export function maxScale(crop: Rect, angle: number, frame: Size): number {
  const cx = (crop.x + crop.w / 2) * frame.w, cy = (crop.y + crop.h / 2) * frame.h
  const { ex, ey } = reach((crop.w * frame.w) / 2, (crop.h * frame.h) / 2, angle)
  const kx = ex > 0 ? Math.min(cx, frame.w - cx) / ex : Infinity
  const ky = ey > 0 ? Math.min(cy, frame.h - cy) / ey : Infinity
  return Math.max(0, Math.min(kx, ky))
}

/** True when every corner of the straightened crop lies on the photo. */
export function fits(crop: Rect, angle: number, frame: Size): boolean {
  return maxScale(crop, angle, frame) >= 1 - 1e-6
}

export function fitsView(box: Box, angle: number, frame: Size): boolean {
  return fits(viewToCrop(box, angle, frame), angle, frame)
}

/** Shrink (never grow) the crop around its center until it fits at `angle`. */
export function shrinkToFit(crop: Rect, angle: number, frame: Size): Rect {
  const k = Math.min(1, maxScale(crop, angle, frame))
  if (k >= 1) return crop
  const w = crop.w * k, h = crop.h * k
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h }
}

/** Largest t in [0, 1] for which ok(t) holds, assuming ok is monotone and ok(0). */
function search(ok: (t: number) => boolean): number {
  if (ok(1)) return 1
  let lo = 0, hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Move the crop box by (dx, dy) view pixels, sliding along the photo's edges. */
export function moveView(s: Box, dx: number, dy: number, angle: number, frame: Size): Box {
  const at = (tx: number, ty: number): Box => ({ ...s, x: s.x + dx * tx, y: s.y + dy * ty })
  const tx = search((t) => fitsView(at(t, 0), angle, frame))
  const ty = search((t) => fitsView(at(tx, t), angle, frame))
  return at(tx, ty)
}

/**
 * Drag a handle by (dx, dy) view pixels. With a ratio the opposite corner (or
 * edge) stays put and the box keeps its shape; the result always fits.
 */
export function resizeView(s: Box, handle: Handle, dx: number, dy: number, ratio: number | null, angle: number, frame: Size, min: number): Box {
  const ok = (b: Box) => fitsView(b, angle, frame)
  const W = handle.includes('w'), E = handle.includes('e'), N = handle.includes('n'), S = handle.includes('s')

  if (ratio === null) {
    const at = (tx: number, ty: number): Box => {
      let l = s.x, r = s.x + s.w, t = s.y, b = s.y + s.h
      if (W) l = Math.min(l + dx * tx, r - min)
      if (E) r = Math.max(r + dx * tx, l + min)
      if (N) t = Math.min(t + dy * ty, b - min)
      if (S) b = Math.max(b + dy * ty, t + min)
      return { x: l, y: t, w: r - l, h: b - t }
    }
    const tx = search((t) => ok(at(t, 0)))
    const ty = search((t) => ok(at(tx, t)))
    return at(tx, ty)
  }

  const minW = Math.max(min, min * ratio)
  let w: number
  if ((W || E) && (N || S)) w = Math.max(s.w + (E ? dx : -dx), (s.h + (S ? dy : -dy)) * ratio)
  else if (W || E) w = s.w + (E ? dx : -dx)
  else w = (s.h + (S ? dy : -dy)) * ratio
  w = Math.max(minW, w)

  const at = (width: number): Box => {
    const h = width / ratio
    const x = W ? s.x + s.w - width : E ? s.x : s.x + (s.w - width) / 2
    const y = N ? s.y + s.h - h : S ? s.y : s.y + (s.h - h) / 2
    return { x, y, w: width, h }
  }
  if (ok(at(w)) || w <= s.w) return at(w)
  // A smaller box from the same anchor sits inside a larger one, so validity is monotone in size.
  return at(s.w + (w - s.w) * search((t) => ok(at(s.w + (w - s.w) * t))))
}

/** The largest crop of a ratio, placed as close to the current crop's center as it can go. */
export function fitAspect(crop: Rect, ratio: number, angle: number, frame: Size): Rect {
  // Unit box (half-height 1) centered on the photo, scaled up until it touches an edge.
  const unit: Rect = { x: 0.5 - ratio / frame.w, y: 0.5 - 1 / frame.h, w: (2 * ratio) / frame.w, h: 2 / frame.h }
  const k = maxScale(unit, angle, frame)
  const w = unit.w * k, h = unit.h * k
  const centered: Rect = { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h }
  const from = cropToView(centered, angle, frame), to = cropToView(crop, angle, frame)
  const moved = moveView(from, to.x + to.w / 2 - (from.x + from.w / 2), to.y + to.h / 2 - (from.y + from.h / 2), angle, frame)
  return viewToCrop(moved, angle, frame)
}

const SWAP: Partial<Record<AspectId, AspectId>> = { '4:5': '5:4', '5:4': '4:5', '3:2': '2:3', '2:3': '3:2', '16:9': '9:16', '9:16': '16:9', '4:3': '3:4', '3:4': '4:3', '5:7': 'free' }

/** Turn the whole result a quarter turn (1 = clockwise). Flips swap because they apply after the turn. */
export function rotateQuarter(g: Geometry, dir: 1 | -1): Geometry {
  const { x, y, w, h } = g.crop
  return {
    ...g,
    crop: dir === 1 ? { x: 1 - y - h, y: x, w: h, h: w } : { x: y, y: 1 - x - w, w: h, h: w },
    rotate: ((g.rotate + dir + 4) % 4) as Geometry['rotate'],
    flipH: g.flipV,
    flipV: g.flipH,
    aspect: SWAP[g.aspect] ?? g.aspect,
  }
}

/** Mirror the result. Mirroring reverses the direction of the straighten angle. */
export function flip(g: Geometry, axis: 'h' | 'v'): Geometry {
  const { x, y, w, h } = g.crop
  return axis === 'h'
    ? { ...g, crop: { x: 1 - x - w, y, w, h }, angle: -g.angle || 0, flipH: !g.flipH }
    : { ...g, crop: { x, y: 1 - y - h, w, h }, angle: -g.angle || 0, flipV: !g.flipV }
}

/** Straighten angle that makes the line (x1,y1)→(x2,y2), drawn on the view, level (or plumb). */
export function levelAngle(current: number, x1: number, y1: number, x2: number, y2: number): number {
  let a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  if (a > 90) a -= 180
  if (a <= -90) a += 180
  if (Math.abs(a) > 45) a -= Math.sign(a) * 90
  return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.round((current - a) * 10) / 10))
}
