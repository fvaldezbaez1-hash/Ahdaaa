// Where an object removal reads from and writes to, at full resolution.
//
// The fill covers `rect` (the painted strokes plus a small margin, in mask
// coordinates). The model sees `crop`: the rect with generous context around
// it, at least the model's size, scaled to model × model. The fill is stored
// at the resolution the model actually produced (never more than the
// source's), and the engine composites it through the feathered strokes.
import type { BrushStroke, Rect } from '../edit/types'
import type { Tile } from './tiling'

export interface InpaintPlan {
  /** What the fill covers, normalized to the source (0…1). */
  rect: Rect
  /** The same in source pixels. */
  rectPx: Tile
  /** Source pixels the model sees. */
  crop: Tile
  /** Model input size (square). */
  model: number
  /** Size of the fill raster. */
  fill: { width: number; height: number }
}

/** Painted extent of the strokes in source pixels (erase strokes don't add), or null if nothing is painted. */
export function strokesBounds(strokes: readonly BrushStroke[], srcW: number, srcH: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const long = Math.max(srcW, srcH)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of strokes) {
    if (s.erase) continue
    const r = s.r * long
    for (const p of s.points) {
      x0 = Math.min(x0, p.x * srcW - r)
      y0 = Math.min(y0, p.y * srcH - r)
      x1 = Math.max(x1, p.x * srcW + r)
      y1 = Math.max(y1, p.y * srcH + r)
    }
  }
  return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null
}

export function planInpaint(strokes: readonly BrushStroke[], srcW: number, srcH: number, model = 512): InpaintPlan | null {
  const b = strokesBounds(strokes, srcW, srcH)
  if (!b) return null
  const margin = Math.max(2, 0.03 * Math.max(b.x1 - b.x0, b.y1 - b.y0))
  const rx0 = Math.max(0, Math.floor(b.x0 - margin)), ry0 = Math.max(0, Math.floor(b.y0 - margin))
  const rx1 = Math.min(srcW, Math.ceil(b.x1 + margin)), ry1 = Math.min(srcH, Math.ceil(b.y1 + margin))
  if (rx1 <= rx0 || ry1 <= ry0) return null
  const rectPx = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 }

  // Context: half the hole's size on each side (at least 64 px), at least the model's size.
  const long = Math.max(rectPx.w, rectPx.h)
  const side = Math.max(model, Math.ceil(long + 2 * Math.max(64, long / 2)))
  const cw = Math.min(srcW, side), ch = Math.min(srcH, side)
  const cx = rectPx.x + rectPx.w / 2, cy = rectPx.y + rectPx.h / 2
  const x = Math.round(Math.min(srcW - cw, Math.max(0, cx - cw / 2)))
  const y = Math.round(Math.min(srcH - ch, Math.max(0, cy - ch / 2)))
  const crop = { x, y, w: cw, h: ch }

  // The model's output has max(1, crop / model) source pixels per pixel.
  const sx = Math.max(1, cw / model), sy = Math.max(1, ch / model)
  const fill = { width: Math.max(1, Math.round(rectPx.w / sx)), height: Math.max(1, Math.round(rectPx.h / sy)) }
  const rect = { x: rectPx.x / srcW, y: rectPx.y / srcH, w: rectPx.w / srcW, h: rectPx.h / srcH }
  return { rect, rectPx, crop, model, fill }
}

/** The rect's position inside the crop, in model pixels (for sampling the model's output). */
export function rectInModel(plan: InpaintPlan): { x: number; y: number; w: number; h: number } {
  const kx = plan.model / plan.crop.w, ky = plan.model / plan.crop.h
  return { x: (plan.rectPx.x - plan.crop.x) * kx, y: (plan.rectPx.y - plan.crop.y) * ky, w: plan.rectPx.w * kx, h: plan.rectPx.h * ky }
}
