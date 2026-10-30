// Crop / rotate / flip / straighten math shared by the renderer, the export
// tiler, the eyedropper and the crop tool. Pixel coordinates are continuous:
// pixel (i, j) covers [i, i+1) × [j, j+1), so its center is (i + 0.5, j + 0.5).
//
// Order (see Geometry in edit/types.ts): quarter turns → flips → the "frame";
// the crop rect lives in the frame; the image is rotated by `angle` (clockwise)
// around the crop center and the axis-aligned crop rect is cut out of it.

import type { Geometry, Rect } from '../edit/types'

export interface Size {
  width: number
  height: number
}

/** Affine map [a, b, c, d, e, f]: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine = [number, number, number, number, number, number]

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

/** m ∘ n: apply n first, then m. */
export function composeAffine(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[1] * n[3], m[0] * n[1] + m[1] * n[4], m[0] * n[2] + m[1] * n[5] + m[2],
    m[3] * n[0] + m[4] * n[3], m[3] * n[1] + m[4] * n[4], m[3] * n[2] + m[4] * n[5] + m[5],
  ]
}

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3]
  const a = m[4] / det, b = -m[1] / det, d = -m[3] / det, e = m[0] / det
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])]
}

/** Size after the quarter turns. */
export function frameSize(src: Size, g: Pick<Geometry, 'rotate'>): Size {
  return g.rotate % 2 ? { width: src.height, height: src.width } : { width: src.width, height: src.height }
}

/** Frame px → source px: undo the flips, then the quarter turns. */
export function frameToSource(src: Size, g: Geometry): Affine {
  const f = frameSize(src, g)
  const flip: Affine = [g.flipH ? -1 : 1, 0, g.flipH ? f.width : 0, 0, g.flipV ? -1 : 1, g.flipV ? f.height : 0]
  const W = src.width, H = src.height
  const turns: Affine[] = [
    [1, 0, 0, 0, 1, 0],
    [0, 1, 0, -1, 0, H], // 90° cw: frame (x, y) came from source (y, H − x)
    [-1, 0, W, 0, -1, H],
    [0, -1, W, 1, 0, 0],
  ]
  return composeAffine(turns[g.rotate], flip)
}

/** Unrounded size of the whole straightened frame (bounding box of the rotated frame). */
function uncroppedExtent(f: Size, angle: number): Size {
  const a = (angle * Math.PI) / 180
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
  return { width: f.width * c + f.height * s, height: f.width * s + f.height * c }
}

/** Pixel size of the rendered result for a source of size `src`. */
export function outputSize(src: Size, g: Geometry, uncropped = false): Size {
  const f = frameSize(src, g)
  const e = uncropped ? uncroppedExtent(f, g.angle) : { width: g.crop.w * f.width, height: g.crop.h * f.height }
  return { width: Math.max(1, Math.round(e.width)), height: Math.max(1, Math.round(e.height)) }
}

/**
 * Output px → frame px, for an output image of size `out` (any resolution:
 * the mapping is scaled so the output always covers exactly the crop / frame).
 */
export function outputToFrame(src: Size, g: Geometry, uncropped: boolean, out: Size): Affine {
  const f = frameSize(src, g)
  const a = (g.angle * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  let w: number, h: number, cx: number, cy: number
  if (uncropped) {
    ;({ width: w, height: h } = uncroppedExtent(f, g.angle))
    cx = f.width / 2
    cy = f.height / 2
  } else {
    w = g.crop.w * f.width
    h = g.crop.h * f.height
    cx = (g.crop.x + g.crop.w / 2) * f.width
    cy = (g.crop.y + g.crop.h / 2) * f.height
  }
  const kx = w / out.width, ky = h / out.height
  // frame = center + R(−angle)·(q·k − size/2); R(−θ) = [cos, sin; −sin, cos] in y-down coordinates.
  return [cos * kx, sin * ky, cx - (cos * w) / 2 - (sin * h) / 2, -sin * kx, cos * ky, cy + (sin * w) / 2 - (cos * h) / 2]
}

/** Output px (in an image of size `out`) → source px. */
export function outputToSource(src: Size, g: Geometry, uncropped: boolean, out: Size): Affine {
  return composeAffine(frameToSource(src, g), outputToFrame(src, g, uncropped, out))
}

/** Normalized (0…1) position in the rendered frame → source px. */
export function normalizedToSource(src: Size, g: Geometry, uncropped: boolean, nx: number, ny: number): [number, number] {
  return applyAffine(outputToSource(src, g, uncropped, { width: 1, height: 1 }), nx, ny)
}

/**
 * Where the crop rectangle sits inside the `uncropped` render, normalized 0…1 —
 * for drawing the crop box over the straightened full frame.
 */
export function cropRectInUncropped(src: Size, g: Geometry): Rect {
  const f = frameSize(src, g)
  const u = uncroppedExtent(f, g.angle)
  const a = (g.angle * Math.PI) / 180
  const vx = (g.crop.x + g.crop.w / 2) * f.width - f.width / 2
  const vy = (g.crop.y + g.crop.h / 2) * f.height - f.height / 2
  const ox = u.width / 2 + Math.cos(a) * vx - Math.sin(a) * vy
  const oy = u.height / 2 + Math.sin(a) * vx + Math.cos(a) * vy
  const w = g.crop.w * f.width, h = g.crop.h * f.height
  return { x: (ox - w / 2) / u.width, y: (oy - h / 2) / u.height, w: w / u.width, h: h / u.height }
}

/** Axis-aligned bounding box of a rectangle mapped through an affine map. */
export function mapBounds(m: Affine, x0: number, y0: number, x1: number, y1: number): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [applyAffine(m, x0, y0), applyAffine(m, x1, y0), applyAffine(m, x0, y1), applyAffine(m, x1, y1)]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Normalized point of the rendered view (0…1) → mask coordinates (0…1 of the source; see Mask in edit/types). */
export function viewToMask(src: Size, g: Geometry, uncropped: boolean, nx: number, ny: number): { x: number; y: number } {
  const [x, y] = normalizedToSource(src, g, uncropped, nx, ny)
  return { x: x / src.width, y: y / src.height }
}

/** Mask coordinates → normalized point of the rendered view (0…1; outside that range when cropped away). */
export function maskToView(src: Size, g: Geometry, uncropped: boolean, mx: number, my: number): { x: number; y: number } {
  const [x, y] = applyAffine(invertAffine(outputToSource(src, g, uncropped, { width: 1, height: 1 })), mx * src.width, my * src.height)
  return { x, y }
}
