import type { Geometry } from '../../edit/types'
import { maskToView, viewToMask, type Size } from '../../engine/geometry'

// Mask coordinates (0…1 of the oriented source; lengths in units of its long
// edge) ↔ CSS pixels inside the photo box on screen. Everything the masking and
// healing tools draw or hit-test goes through one of these, so handles follow
// the crop, rotation, flips, straighten, zoom and pan.

export interface Pt {
  x: number
  y: number
}

export interface Space {
  toPx(m: Pt): Pt
  toMask(p: Pt): Pt
  /** CSS px per unit of mask length (the source's long edge). */
  scale: number
  /** Screen angle (radians) of the source's +x axis. */
  angle: number
  /** The view mirrors the photo (one flip): angles turn the other way on screen. */
  mirrored: boolean
  /** Source size (px); only its aspect matters. */
  src: Size
  /** Photo box size (CSS px). */
  box: { w: number; h: number }
}

export function makeSpace(src: Size, g: Geometry, box: { w: number; h: number }): Space {
  const toPx = (m: Pt): Pt => {
    const v = maskToView(src, g, false, m.x, m.y)
    return { x: v.x * box.w, y: v.y * box.h }
  }
  const toMask = (p: Pt): Pt => viewToMask(src, g, false, p.x / box.w, p.y / box.h)
  const o = toPx({ x: 0.5, y: 0.5 }), ex = toPx({ x: 0.5 + 1 / src.width, y: 0.5 }), ey = toPx({ x: 0.5, y: 0.5 + 1 / src.height })
  const jx = { x: ex.x - o.x, y: ex.y - o.y }, jy = { x: ey.x - o.x, y: ey.y - o.y }
  return {
    toPx,
    toMask,
    scale: Math.hypot(jx.x, jx.y) * Math.max(src.width, src.height),
    angle: Math.atan2(jx.y, jx.x),
    mirrored: jx.x * jy.y - jx.y * jy.x < 0,
    src,
    box,
  }
}

/** Screen direction (radians) of a direction given in source degrees. */
export const screenAngle = (s: Space, deg: number) => s.angle + ((s.mirrored ? -deg : deg) * Math.PI) / 180

/** Source degrees of a screen direction (radians). */
export const sourceAngle = (s: Space, rad: number) => (((s.mirrored ? s.angle - rad : rad - s.angle) * 180) / Math.PI + 540) % 360 - 180

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
