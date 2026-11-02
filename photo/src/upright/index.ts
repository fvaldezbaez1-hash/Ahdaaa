// Upright: automatic and guided perspective correction (Lightroom-style
// modes) that returns Perspective slider values. Pure TypeScript on the CPU;
// the slider → homography mapping is src/edit/perspective.ts, shared with the
// renderer. Load lazily: `await import('../upright')`.
import { frameSize, frameToSource, invertAffine, applyAffine } from '../engine/geometry'
import type { FrameSize } from '../edit/perspective'
import type { Geometry, Perspective, UprightGuide } from '../edit/types'
import type { SourceColor, SourceImage } from '../engine/types'
import { resampleRgb16 } from '../io/decode/resample'
import { detectSegments, type Segment } from './lines'
import { analyse, constrainScale, fitSliders, perspectiveOf, segmentAngle, solveMode, type Target, type UprightMode } from './solve'

export type { Segment } from './lines'
export type { UprightMode } from './solve'
export { constrainScale } from './solve'

export interface UprightOptions {
  /** Zoom in so no empty corners show (Lightroom's "Constrain crop"). Default false: scale stays 100. */
  constrain?: boolean
  /** Long edge of the grey copy the lines are found in (default 1000). */
  analysisEdge?: number
}

/**
 * A grey (perceptual) copy of the photo in FRAME orientation (quarter turns
 * and flips applied, as Perspective sees it), about `maxEdge` px on the long edge.
 */
export function frameGrey(image: SourceImage, color: SourceColor, geometry: Geometry, maxEdge = 1000): { grey: Float32Array; width: number; height: number } {
  const small = resampleRgb16(image.data, image.width, image.height, maxEdge)
  const sw = small.width, sh = small.height
  // Luminance (Rec. 709 weights of linear sRGB; RAW goes through its camera matrix).
  const m = color.space === 'camera' ? color.rgbCam : undefined
  const k = m ? [0.2126 * m[0] + 0.7152 * m[3] + 0.0722 * m[6], 0.2126 * m[1] + 0.7152 * m[4] + 0.0722 * m[7], 0.2126 * m[2] + 0.7152 * m[5] + 0.0722 * m[8]] : [0.2126, 0.7152, 0.0722]
  const y = new Float32Array(sw * sh)
  for (let i = 0; i < y.length; i++) y[i] = Math.max(0, (k[0] * small.data[i * 3] + k[1] * small.data[i * 3 + 1] + k[2] * small.data[i * 3 + 2]) / 65535)
  // Exposure-normalize (99th percentile → 1) and encode like a display would, so edges in shadows count too.
  const sorted = Float32Array.from(y.filter((_, i) => i % 7 === 0)).sort()
  const top = sorted[Math.floor(sorted.length * 0.99)] || 1
  for (let i = 0; i < y.length; i++) y[i] = Math.min(1, y[i] / top) ** (1 / 2.2)
  const f = frameSize({ width: sw, height: sh }, geometry)
  const toSrc = frameToSource({ width: sw, height: sh }, geometry)
  const grey = new Float32Array(f.width * f.height)
  for (let fy = 0; fy < f.height; fy++)
    for (let fx = 0; fx < f.width; fx++) {
      const [sx, sy] = applyAffine(toSrc, fx + 0.5, fy + 0.5)
      grey[fy * f.width + fx] = y[Math.min(sh - 1, Math.max(0, Math.floor(sy))) * sw + Math.min(sw - 1, Math.max(0, Math.floor(sx)))]
    }
  return { grey, width: f.width, height: f.height }
}

/** Straight line segments of the photo, in frame pixels of a copy `frame` large (for drawing them over the photo too). */
export function uprightLines(image: SourceImage, color: SourceColor, geometry: Geometry, maxEdge = 1000): { segments: Segment[]; frame: FrameSize } {
  const g = frameGrey(image, color, geometry, maxEdge)
  return { segments: detectSegments(g.grey, g.width, g.height), frame: { width: g.width, height: g.height } }
}

/**
 * Upright for a photo: Perspective slider values for `mode` (see solveMode).
 * `image` is the working-size source (any size works; it's analysed at about
 * 1000 px), `geometry` the photo's geometry (its quarter turns and flips set
 * the frame; its own perspective is ignored). Straighten (geometry.angle) is
 * separate and isn't changed: Upright's rotation lives in Perspective.rotate.
 */
export function solveUpright(image: SourceImage, color: SourceColor, mode: UprightMode, geometry: Geometry, opts: UprightOptions = {}): Perspective {
  const { segments, frame } = uprightLines(image, color, geometry, opts.analysisEdge)
  const s = solveMode(analyse(segments, frame), frame, mode)
  const p = perspectiveOf(round(s), { mode })
  return opts.constrain ? { ...p, scale: constrainScale(p, frame) } : p
}

/**
 * Guided Upright: 1–4 lines the person drew (mask coordinates) along things
 * that should be vertical or horizontal (whichever each is closer to).
 * One guide: rotation only. Two vertical (or two horizontal) guides: that
 * keystone plus rotation. Otherwise all three, smallest change that fits.
 * `source` is the photo's size (any resolution with the right aspect ratio).
 */
export function solveGuided(guides: UprightGuide[], geometry: Geometry, source: { width: number; height: number }, opts: { constrain?: boolean } = {}): Perspective {
  const frame = frameSize(source, geometry)
  const toFrame = invertAffine(frameToSource(source, geometry))
  const targets: Target[] = guides.map((g) => {
    const [x1, y1] = applyAffine(toFrame, g.x1 * source.width, g.y1 * source.height)
    const [x2, y2] = applyAffine(toFrame, g.x2 * source.width, g.y2 * source.height)
    return { x1, y1, x2, y2, weight: 1, dir: Math.abs(segmentAngle({ x1, y1, x2, y2 })) > Math.PI / 4 ? 'vertical' : 'horizontal' }
  })
  const nv = targets.filter((t) => t.dir === 'vertical').length, nh = targets.length - nv
  const free: ('vertical' | 'horizontal' | 'rotate')[] =
    targets.length <= 1 ? ['rotate'] : !nh ? ['vertical', 'rotate'] : !nv ? ['horizontal', 'rotate'] : ['vertical', 'horizontal', 'rotate']
  const s = fitSliders(targets, frame, free, {}, targets.length === 2 && nv && nh ? 1e-6 : 1e-9)
  const clamp = { vertical: Math.max(-100, Math.min(100, s.vertical)), horizontal: Math.max(-100, Math.min(100, s.horizontal)), rotate: Math.max(-10, Math.min(10, s.rotate)) }
  const p = perspectiveOf(round(clamp), { mode: 'guided', guides })
  return opts.constrain ? { ...p, scale: constrainScale(p, frame) } : p
}

/** Slider precision: 0.1 (the UI shows whole numbers; the sub-unit keeps lines straight). */
function round(s: { vertical: number; horizontal: number; rotate: number }) {
  const r = (v: number) => Math.round(v * 10) / 10 || 0
  return { vertical: r(s.vertical), horizontal: r(s.horizontal), rotate: Math.round(s.rotate * 100) / 100 || 0 }
}
