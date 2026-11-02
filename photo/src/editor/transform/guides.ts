import type { UprightGuide } from '../../edit/types'
import { dist, type Pt, type Space } from '../masks/space'

// Guided Upright: up to four lines drawn along things that should be vertical
// or horizontal, in mask coordinates (so they stay on the photo whatever the
// view). Editing them is pure; the solver turns them into Perspective values.

export const MAX_GUIDES = 4
/** Shorter lines (on screen, px) are taps, not guides. */
export const MIN_LENGTH = 12

export type GuideHit = { i: number; part: 'p1' | 'p2' | 'line' }

/** Add a guide; the oldest goes once there are four. */
export function addGuide(guides: UprightGuide[], g: UprightGuide): UprightGuide[] {
  return [...guides, g].slice(-MAX_GUIDES)
}

export function moveGuide(guides: UprightGuide[], hit: GuideHit, from: Pt, to: Pt): UprightGuide[] {
  return guides.map((g, i) => {
    if (i !== hit.i) return g
    if (hit.part === 'p1') return { ...g, x1: to.x, y1: to.y }
    if (hit.part === 'p2') return { ...g, x2: to.x, y2: to.y }
    const dx = to.x - from.x, dy = to.y - from.y
    return { x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy }
  })
}

export const removeGuide = (guides: UprightGuide[], i: number) => guides.filter((_, k) => k !== i)

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** Which guide a pointer at p (screen px) touches: an end (to stretch it) or the line (to move it). Newest first. */
export function hitGuide(guides: UprightGuide[], s: Space, p: Pt, reach: number): GuideHit | null {
  for (let i = guides.length - 1; i >= 0; i--) {
    const a = s.toPx({ x: guides[i].x1, y: guides[i].y1 }), b = s.toPx({ x: guides[i].x2, y: guides[i].y2 })
    if (dist(a, p) <= reach) return { i, part: 'p1' }
    if (dist(b, p) <= reach) return { i, part: 'p2' }
    if (segDist(p, a, b) <= reach / 2) return { i, part: 'line' }
  }
  return null
}

/** Whether a guide (as drawn on screen) reads as a vertical or a horizontal. */
export function guideDirection(g: UprightGuide, s: Space): 'vertical' | 'horizontal' {
  const a = s.toPx({ x: g.x1, y: g.y1 }), b = s.toPx({ x: g.x2, y: g.y2 })
  return Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 'vertical' : 'horizontal'
}
