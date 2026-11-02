// Crop / rotate / flip / straighten math shared by the renderer, the export
// tiler, the eyedropper and the crop tool. Pixel coordinates are continuous:
// pixel (i, j) covers [i, i+1) × [j, j+1), so its center is (i + 0.5, j + 0.5).
//
// Order (see Geometry in edit/types.ts): lens distortion correction (the source
// keeps its size) → quarter turns → flips → the "frame" → perspective (a
// homography of the frame onto itself: the frame keeps its size, the image moves
// inside it) → the crop rect lives in that frame; the image is rotated by `angle`
// (clockwise) around the crop center and the axis-aligned crop rect is cut out.
// Output sizes therefore don't depend on lens or perspective.

import type { Mat3 } from '../color/matrices'
import { applyHomography, inv3, isIdentityPerspective, mul3, perspectiveInverse } from '../edit/perspective'
import type { Geometry, Rect } from '../edit/types'
import { distortionScale, radialOf, undistortRadius, type Radial } from './lens'

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

const toMat3 = (a: Affine): Mat3 => [a[0], a[1], a[2], a[3], a[4], a[5], 0, 0, 1]

/** Radial lens warp in source px: corrected (undistorted) → the photo's own (distorted) pixels. */
export interface LensWarp {
  cx: number
  cy: number
  /** Px per unit radius: half the source's shorter side (lensfun). */
  norm: number
  radial: Radial
}

/**
 * Output px → source px, through crop / straighten, perspective, rotate / flip and lens correction.
 * `P` maps output px to corrected-source px (a homography; affine without perspective), then
 * `lens` (if any) bends that to the photo's own pixels. `affine` = no perspective and no lens:
 * the mapping is exactly the plain affine one, and the renderer uses its exact paths.
 */
export interface Mapping {
  P: Mat3
  lens: LensWarp | null
  affine: boolean
  toSource(x: number, y: number): [number, number]
  fromSource(X: number, Y: number): [number, number]
  /** Source-px bounding box of an output rectangle (its edges are sampled: lines may bend). */
  bounds(x0: number, y0: number, x1: number, y1: number): { x0: number; y0: number; x1: number; y1: number }
}

export function lensWarp(src: Size, g: Geometry): LensWarp | null {
  const radial = radialOf(g.lens)
  return radial ? { cx: src.width / 2, cy: src.height / 2, norm: Math.min(src.width, src.height) / 2, radial } : null
}

/** A mapping from a homography (and optional lens warp). */
export function mappingOf(P: Mat3, lens: LensWarp | null): Mapping {
  const affine = !lens && P[6] === 0 && P[7] === 0 && P[8] === 1
  const Pinv = inv3(P)
  const toSource = (x: number, y: number): [number, number] => {
    const [cx, cy] = affine ? applyAffine(P.slice(0, 6) as Affine, x, y) : applyHomography(P, x, y)
    if (!lens) return [cx, cy]
    const dx = cx - lens.cx, dy = cy - lens.cy
    const k = distortionScale(lens.radial, Math.hypot(dx, dy) / lens.norm)
    return [lens.cx + dx * k, lens.cy + dy * k]
  }
  const fromSource = (X: number, Y: number): [number, number] => {
    let cx = X, cy = Y
    if (lens) {
      const dx = X - lens.cx, dy = Y - lens.cy, rd = Math.hypot(dx, dy) / lens.norm
      const k = rd > 0 ? undistortRadius(lens.radial, rd) / rd : 1 / distortionScale(lens.radial, 0)
      cx = lens.cx + dx * k
      cy = lens.cy + dy * k
    }
    return affine ? applyAffine(invertAffine(P.slice(0, 6) as Affine), cx, cy) : applyHomography(Pinv, cx, cy)
  }
  const bounds = (x0: number, y0: number, x1: number, y1: number) => {
    if (affine) return mapBounds(P.slice(0, 6) as Affine, x0, y0, x1, y1)
    const xs: number[] = [], ys: number[] = []
    const n = 32
    for (let i = 0; i <= n; i++) {
      const t = i / n
      for (const [x, y] of [[x0 + (x1 - x0) * t, y0], [x0 + (x1 - x0) * t, y1], [x0, y0 + (y1 - y0) * t], [x1, y0 + (y1 - y0) * t]]) {
        const [X, Y] = toSource(x, y)
        xs.push(X)
        ys.push(Y)
      }
    }
    // Sampling can miss a bulge between samples by a fraction of a pixel: pad.
    return { x0: Math.min(...xs) - 2, y0: Math.min(...ys) - 2, x1: Math.max(...xs) + 2, y1: Math.max(...ys) + 2 }
  }
  return { P, lens, affine, toSource, fromSource, bounds }
}

/** A plain affine mapping (e.g. scaled-source texture px → source px). */
export const affineMapping = (a: Affine): Mapping => mappingOf(toMat3(a), null)

/** Source px per output px around an output point (the mapping's local scale). */
export function localScale(m: Mapping, x: number, y: number): number {
  if (m.affine) return Math.sqrt(Math.abs(m.P[0] * m.P[4] - m.P[1] * m.P[3]))
  const [X, Y] = m.toSource(x, y), [Xx, Yx] = m.toSource(x + 1, y), [Xy, Yy] = m.toSource(x, y + 1)
  return Math.sqrt(Math.abs((Xx - X) * (Yy - Y) - (Xy - X) * (Yx - Y)))
}

/** Output px (in an image of size `out`) → source px, through everything (see Mapping). */
export function outputMapping(src: Size, g: Geometry, uncropped: boolean, out: Size): Mapping {
  const toFrame = toMat3(outputToFrame(src, g, uncropped, out))
  const frameToSrc = toMat3(frameToSource(src, g))
  const P = isIdentityPerspective(g.perspective)
    ? toMat3(composeAffine(frameToSource(src, g), outputToFrame(src, g, uncropped, out)))
    : mul3(frameToSrc, mul3(perspectiveInverse(g.perspective!, frameSize(src, g)), toFrame))
  return mappingOf(P, lensWarp(src, g))
}

/** Normalized (0…1) position in the rendered frame → source px. */
export function normalizedToSource(src: Size, g: Geometry, uncropped: boolean, nx: number, ny: number): [number, number] {
  return outputMapping(src, g, uncropped, { width: 1, height: 1 }).toSource(nx, ny)
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
  const [x, y] = outputMapping(src, g, uncropped, { width: 1, height: 1 }).fromSource(mx * src.width, my * src.height)
  return { x, y }
}
