import type { MaskShape, RemoveArea, RetouchSpot } from '../../edit/types'
import { dist, screenAngle, sourceAngle, type Pt, type Space } from './space'

// Where the on-photo handles of a mask or healing spot are, which one a
// pointer hits, and what dragging it does. All positions are CSS px in the
// photo box (see space.ts); results come back in mask coordinates.

export type LinearShape = Extract<MaskShape, { type: 'linear' }>
export type RadialShape = Extract<MaskShape, { type: 'radial' }>

export type HandleId = 'move' | 'start' | 'end' | 'rotate' | 'rx' | 'rx2' | 'ry' | 'ry2' | 'feather'

export interface Handle {
  id: HandleId
  x: number
  y: number
}

/** How far a rotate knob sits from what it turns (px). */
const KNOB = 28
/** Smallest radius / gradient a drag can make (px on screen). */
const MIN_PX = 6

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1
  return { x: a.x / l, y: a.y / l }
}
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x })
const rotate = (p: Pt, c: Pt, a: number): Pt => {
  const cos = Math.cos(a), sin = Math.sin(a), d = sub(p, c)
  return { x: c.x + d.x * cos - d.y * sin, y: c.y + d.x * sin + d.y * cos }
}

// ---- Linear gradient ----

export function linearLayout(m: LinearShape, s: Space) {
  const p1 = s.toPx({ x: m.x1, y: m.y1 }), p2 = s.toPx({ x: m.x2, y: m.y2 })
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const dir = unit(sub(p2, p1))
  const handles: Handle[] = [
    { id: 'move', ...mid },
    { id: 'start', ...p1 },
    { id: 'end', ...p2 },
    { id: 'rotate', ...add(mid, perp(dir), KNOB * 2) },
  ]
  return { p1, p2, mid, dir, handles }
}

export function createLinear(s: Space, from: Pt, to: Pt): LinearShape {
  const end = dist(from, to) < MIN_PX ? add(from, { x: 0, y: MIN_PX * 4 }) : to
  const a = s.toMask(from), b = s.toMask(end)
  return { type: 'linear', x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

export function dragLinear(m: LinearShape, s: Space, id: HandleId, from: Pt, to: Pt): LinearShape {
  const { p1, p2, mid } = linearLayout(m, s)
  const d = sub(to, from)
  let a = p1, b = p2
  if (id === 'move') {
    a = add(p1, d)
    b = add(p2, d)
  } else if (id === 'start') a = dist(to, p2) < MIN_PX ? p1 : to
  else if (id === 'end') b = dist(to, p1) < MIN_PX ? p2 : to
  else if (id === 'rotate') {
    const t = Math.atan2(to.y - mid.y, to.x - mid.x) - Math.atan2(from.y - mid.y, from.x - mid.x)
    a = rotate(p1, mid, t)
    b = rotate(p2, mid, t)
  }
  const ma = s.toMask(a), mb = s.toMask(b)
  return { ...m, x1: ma.x, y1: ma.y, x2: mb.x, y2: mb.y }
}

/** Between the start and end lines: dragging there moves the gradient. */
export function onLinear(m: LinearShape, s: Space, p: Pt): boolean {
  const { p1, p2 } = linearLayout(m, s)
  const len = dist(p1, p2)
  const t = dot(sub(p, p1), sub(p2, p1)) / (len * len || 1)
  return t >= 0 && t <= 1
}

// ---- Radial gradient ----

export function radialLayout(m: RadialShape, s: Space) {
  const c = s.toPx({ x: m.cx, y: m.cy })
  const a = screenAngle(s, m.angle)
  const ax = { x: Math.cos(a), y: Math.sin(a) }, ay = perp(ax)
  const rx = m.rx * s.scale, ry = m.ry * s.scale
  const inner = Math.max(0, 1 - m.feather / 100)
  const handles: Handle[] = [
    { id: 'rx', ...add(c, ax, rx) },
    { id: 'rx2', ...add(c, ax, -rx) },
    { id: 'ry', ...add(c, ay, ry) },
    { id: 'ry2', ...add(c, ay, -ry) },
    { id: 'rotate', ...add(c, ay, -(ry + KNOB)) },
    // On the inner (fully affected) ellipse, between the axes so it never sits on a radius handle.
    { id: 'feather', ...add(add(c, ax, rx * inner * Math.SQRT1_2), ay, ry * inner * Math.SQRT1_2) },
    { id: 'move', ...c },
  ]
  return { c, angle: a, ax, ay, rx, ry, inner, handles }
}

export function insideRadial(m: RadialShape, s: Space, p: Pt): boolean {
  const { c, ax, ay, rx, ry } = radialLayout(m, s)
  const d = sub(p, c)
  return (dot(d, ax) / rx) ** 2 + (dot(d, ay) / ry) ** 2 <= 1
}

/** Drag from the center outward: a circle whose radius follows the pointer. */
export function createRadial(s: Space, from: Pt, to: Pt): RadialShape {
  const c = s.toMask(from)
  const r = Math.max(dist(from, to), MIN_PX * 6) / s.scale
  return { type: 'radial', cx: c.x, cy: c.y, rx: r, ry: r, angle: 0, feather: 50 }
}

export function dragRadial(m: RadialShape, s: Space, id: HandleId, from: Pt, to: Pt, both = false): RadialShape {
  const { c, ax, ay, rx } = radialLayout(m, s)
  const min = MIN_PX / s.scale
  if (id === 'move') {
    const nc = s.toMask(add(c, sub(to, from)))
    return { ...m, cx: nc.x, cy: nc.y }
  }
  if (id === 'rx' || id === 'rx2' || id === 'ry' || id === 'ry2') {
    const axis = id[1] === 'x' ? ax : ay
    const r = Math.max(min, Math.abs(dot(sub(to, c), axis)) / s.scale)
    if (both) return { ...m, rx: r, ry: r }
    return id[1] === 'x' ? { ...m, rx: r } : { ...m, ry: r }
  }
  if (id === 'rotate') {
    const t = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x)
    const angle = sourceAngle(s, screenAngle(s, m.angle) + t)
    return { ...m, angle: Math.round(angle * 10) / 10 }
  }
  if (id === 'feather') {
    const d = sub(to, c)
    const t = Math.hypot(dot(d, ax) / rx, dot(d, ay) / (m.ry * s.scale))
    return { ...m, feather: Math.round(Math.min(100, Math.max(0, (1 - t) * 100))) }
  }
  return m
}

// ---- Shared ----

/** The handle within `reach` px of p (closest wins), else null. */
export function hitHandle(handles: Handle[], p: Pt, reach: number): HandleId | null {
  let best: HandleId | null = null, bestD = reach
  for (const h of handles) {
    const d = dist(h, p)
    if (d <= bestD) {
      best = h.id
      bestD = d
    }
  }
  return best
}

// ---- Healing spots ----

export type SpotPart = 'target' | 'source' | 'edge'

/** Which spot (newest first) and which part of it a pointer at p hits. */
export function hitSpot(spots: RetouchSpot[], s: Space, p: Pt, reach: number): { id: string; part: SpotPart } | null {
  for (let i = spots.length - 1; i >= 0; i--) {
    const sp = spots[i]
    const r = sp.r * s.scale
    const dt = dist(p, s.toPx({ x: sp.x, y: sp.y }))
    if (Math.abs(dt - r) <= Math.min(reach, r / 2)) return { id: sp.id, part: 'edge' }
    if (dt < r) return { id: sp.id, part: 'target' }
    if (dist(p, s.toPx({ x: sp.sx, y: sp.sy })) < r) return { id: sp.id, part: 'source' }
  }
  return null
}

export function dragSpot(sp: RetouchSpot, s: Space, part: SpotPart, from: Pt, to: Pt): RetouchSpot {
  if (part === 'edge') {
    const r = Math.max(MIN_PX, dist(to, s.toPx({ x: sp.x, y: sp.y }))) / s.scale
    return { ...sp, r }
  }
  const at = part === 'target' ? { x: sp.x, y: sp.y } : { x: sp.sx, y: sp.sy }
  const n = s.toMask(add(s.toPx(at), sub(to, from)))
  return part === 'target' ? { ...sp, x: n.x, y: n.y } : { ...sp, sx: n.x, sy: n.y }
}

// ---- AI removals ----

/** Where a removal's pin sits: the middle of its area. */
export const removalPin = (a: RemoveArea, s: Space): Pt => s.toPx({ x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2 })

/** The removal (newest first) whose pin is within `reach` px of p. */
export function hitRemoval(areas: RemoveArea[], s: Space, p: Pt, reach: number): string | null {
  for (let i = areas.length - 1; i >= 0; i--) if (dist(removalPin(areas[i], s), p) <= reach) return areas[i].id
  return null
}
