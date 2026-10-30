// Local-adjustment masks on the CPU: the reference math for the GLSL in
// localShaders.ts (kept identical, unit-tested here) and the numbers each layer
// hands the shaders. Positions are source pixels; see Mask in edit/types.ts.

import type { LocalAdjust, LocalLayer, Mask, MaskMode } from '../edit/types'
import { wheelDirection } from './params'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Linear gradient: full effect on the (x1, y1) side, none from (x2, y2) on. */
export function linearValue(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return 1
  return 1 - smoothstep(0, 1, ((px - x1) * dx + (py - y1) * dy) / len2)
}

/**
 * Ellipse at (cx, cy) with radii rx, ry (px), rotated `angle`° clockwise; full inside,
 * fading to none over the outer `feather` (0…1) of the radius. `aa` = one pixel in radius
 * units, the minimum softness so hard edges are antialiased at any resolution.
 */
export function radialValue(px: number, py: number, cx: number, cy: number, rx: number, ry: number, angle: number, feather: number, aa: number): number {
  const a = (angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const dx = px - cx, dy = py - cy
  const d = Math.hypot((c * dx + s * dy) / rx, (-s * dx + c * dy) / ry)
  return 1 - smoothstep(1 - Math.max(feather, aa), 1, d)
}

/** Brush dab / segment: distance falloff with a soft outer `feather` (0…1) part of r (px); aa in px. */
export function segmentValue(px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number, feather: number, aa: number): number {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len2) : 0
  const d = Math.hypot(px - ax - t * dx, py - ay - t * dy)
  return 1 - smoothstep(Math.max(0, r - Math.max(feather * r, aa)), r, d)
}

export interface StrokePx {
  points: [number, number][]
  r: number
  feather: number
  flow: number
  erase?: boolean
}

/**
 * Brush mask at a point. A stroke covers the union (max) of its segments at `flow`;
 * strokes build up like paint (screen), erase strokes take away (multiply by 1 − s).
 */
export function brushValue(px: number, py: number, strokes: StrokePx[], aa: number): number {
  let acc = 0
  for (const s of strokes) {
    let m = 0
    const pts = s.points.length === 1 ? [s.points[0], s.points[0]] : s.points
    for (let i = 0; i + 1 < pts.length; i++) m = Math.max(m, segmentValue(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], s.r, s.feather, aa))
    const v = m * s.flow
    acc = s.erase ? acc * (1 - v) : acc + (1 - acc) * v
  }
  return acc
}

/** Luminance range: display-encoded luminance l (0…1) against low/high/smooth (0…100). */
export function rangeLuminanceValue(l: number, low: number, high: number, smooth: number): number {
  const s = (smooth / 100) * 0.3 + 0.002
  return smoothstep(low / 100 - s, low / 100, l) * (1 - smoothstep(high / 100, high / 100 + s, l))
}

/** HSV of display-encoded RGB: hue in degrees, saturation 0…1. */
export function hueSat(r: number, g: number, b: number): { h: number; s: number } {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d <= 1e-9) return { h: 0, s: 0 }
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: mx > 0 ? d / mx : 0 }
}

/**
 * Color range: distance on the hue/saturation disk between the pixel and the sampled color
 * (hue 0…360, sat 0…100); `tolerance` 0…100 is the radius of full selection, `smooth` its falloff.
 */
export function rangeColorValue(h: number, s: number, hue: number, sat: number, tolerance: number, smooth: number): number {
  const a = (h * Math.PI) / 180, b = (hue * Math.PI) / 180
  const d = Math.hypot(s * Math.cos(a) - (sat / 100) * Math.cos(b), s * Math.sin(a) - (sat / 100) * Math.sin(b))
  const t = (tolerance / 100) * 0.5
  return 1 - smoothstep(t, t + (smooth / 100) * 0.4 + 0.01, d)
}

/** Combine a mask value into the layer's running mask (the first mask always starts it). */
export function combineMask(prev: number, v: number, mode: MaskMode, invert: boolean, first: boolean): number {
  const x = invert ? 1 - v : v
  if (first) return x
  if (mode === 'subtract') return prev * (1 - x)
  if (mode === 'intersect') return prev * x
  return Math.max(prev, x)
}

/** Masks the renderer draws (AI masks arrive in Phase 3). */
export const drawableMasks = (masks: Mask[]) => masks.filter((m) => m.type !== 'ai')

/** Numbers per layer, 4 × vec4 in the shaders' order. */
export const LAYER_FLOATS = 16

/**
 * What a layer adds at full mask, × opacity: [exposure, contrast, highlights, shadows],
 * [whites, blacks, texture, clarity], [dehaze, saturation, sharpness, noise],
 * [temp, tint, color a, color b] — sliders as fractions (±1), exposure in stops,
 * color as an OKLab (a, b) push.
 */
export function layerVector(a: LocalAdjust, opacity: number): Float32Array {
  const n = (v: number | undefined) => (v ?? 0) / 100
  const [ca, cb] = a.color && a.color.sat > 0 ? wheelDirection(a.color.hue).map((v) => v * (a.color!.sat / 100) * 0.1) : [0, 0]
  const v = [a.exposure ?? 0, n(a.contrast), n(a.highlights), n(a.shadows), n(a.whites), n(a.blacks), n(a.texture), n(a.clarity),
    n(a.dehaze), n(a.saturation), n(a.sharpness), n(a.noise), n(a.temp), n(a.tint), ca, cb]
  return new Float32Array(v.map((x) => x * opacity))
}

/** Layers that change something somewhere. */
export function activeLayers(layers: LocalLayer[] | undefined): LocalLayer[] {
  return (layers ?? []).filter((l) => l.enabled && l.opacity > 0 && drawableMasks(l.masks).length > 0 && layerVector(l.adjust, 1).some((x) => x !== 0))
}

/** Which of the 16 parameters any active layer uses (so the passes they need run). */
export function layerUsage(layers: LocalLayer[]): boolean[] {
  const used = new Array<boolean>(LAYER_FLOATS).fill(false)
  for (const l of layers) layerVector(l.adjust, 1).forEach((x, i) => (used[i] ||= x !== 0))
  return used
}
