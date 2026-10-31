// The single definition of what the Perspective (Upright / Transform) sliders
// do, shared by the renderer, the Upright solver (src/upright) and the UI.
// Pure math, no imports beyond types.
//
// Coordinates: frame pixels (after quarter turns and flips, before straighten
// and crop), continuous, origin at the top-left corner, y down — the same
// space as engine/geometry.ts. The correction is a homography of that frame
// onto itself, built as:
//
//   corrected = C · Offset · Scale · Aspect · Rotate · Tilt · C⁻¹ · original
//
// C⁻¹ moves the frame centre to the origin. Tilt turns the photo's plane in
// 3-D in front of a pinhole camera whose focal length is the frame's long edge
// (a "normal" lens; Aspect absorbs the error for other lenses), then moves the
// centre back where it was:
//   vertical   −100…+100 → tilt about the horizontal axis, ±45°.
//              Negative widens the TOP (straightens verticals that converge
//              upwards: a building shot from below), positive widens the bottom.
//   horizontal −100…+100 → turn about the vertical axis, ±45°.
//              Negative widens the LEFT side, positive widens the right.
// Rotate: degrees, + = clockwise (as straighten). Aspect: + stretches
// vertically, − horizontally, area-preserving (±100 = ×2^±½ each way).
// Scale: % about the centre. Offset: % of the frame width / height.
import type { Mat3 } from '../color/matrices'
import type { Perspective } from './types'

export interface FrameSize {
  width: number
  height: number
}

/** Degrees of tilt at slider ±100. */
export const MAX_TILT = 45

export const NO_PERSPECTIVE: Perspective = { vertical: 0, horizontal: 0, rotate: 0, aspect: 0, scale: 100, offsetX: 0, offsetY: 0, mode: 'off', guides: [] }

export function isIdentityPerspective(p: Perspective | undefined): boolean {
  return !p || (p.vertical === 0 && p.horizontal === 0 && p.rotate === 0 && p.aspect === 0 && p.scale === 100 && p.offsetX === 0 && p.offsetY === 0)
}

/** The pinhole focal length (px) the tilt uses for a frame. */
export const tiltFocal = (frame: FrameSize): number => Math.max(frame.width, frame.height)

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o as Mat3
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

/** Map a point through a homography (row-major 3×3). */
export function applyHomography(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

const translate = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1]

/**
 * The tilt part alone, in centred pixel coordinates: K·R·K⁻¹ with the frame
 * centre kept at the origin. `ax` / `ay` are the rotations (radians) about the
 * horizontal and vertical axes.
 */
export function tiltHomography(ax: number, ay: number, f: number): Mat3 {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay)
  // R = Ry(ay) · Rx(ax): X' = R·(u, v, f)
  const Rx: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const R = mul3(Ry, Rx)
  const K: Mat3 = [f, 0, 0, 0, f, 0, 0, 0, 1]
  const Kinv: Mat3 = [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1]
  const H = mul3(K, mul3(R, Kinv))
  // Keep the centre where it was.
  const [ox, oy] = applyHomography(H, 0, 0)
  return mul3(translate(-ox, -oy), H)
}

/** Slider value → tilt angles in radians (see the header for signs). */
export function tiltAngles(p: Pick<Perspective, 'vertical' | 'horizontal'>): { ax: number; ay: number } {
  const k = ((MAX_TILT / 100) * Math.PI) / 180
  return { ax: -p.vertical * k, ay: p.horizontal * k }
}

/** Original frame px → corrected frame px. */
export function perspectiveMatrix(p: Perspective, frame: FrameSize): Mat3 {
  const W = frame.width, H = frame.height
  const { ax, ay } = tiltAngles(p)
  const tilt = tiltHomography(ax, ay, tiltFocal(frame))
  const a = (p.rotate * Math.PI) / 180
  // Clockwise on screen (y down) is the usual rotation matrix.
  const rot: Mat3 = [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]
  const e = 2 ** (p.aspect / 200)
  const aspect: Mat3 = [1 / e, 0, 0, 0, e, 0, 0, 0, 1]
  const s = p.scale / 100
  const scale: Mat3 = [s, 0, 0, 0, s, 0, 0, 0, 1]
  const offset = translate((p.offsetX / 100) * W, (p.offsetY / 100) * H)
  let m = mul3(rot, tilt)
  m = mul3(aspect, m)
  m = mul3(scale, m)
  m = mul3(offset, m)
  return mul3(translate(W / 2, H / 2), mul3(m, translate(-W / 2, -H / 2)))
}

/** Corrected frame px → original frame px: what a renderer samples with. */
export function perspectiveInverse(p: Perspective, frame: FrameSize): Mat3 {
  return inv3(perspectiveMatrix(p, frame))
}
