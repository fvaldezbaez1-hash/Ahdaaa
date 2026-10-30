import type { Mask, MaskShape, RetouchSpot } from '../../edit/types'
import { uid } from '../../io/db'
import { editor } from '../../state/editor'
import type { Session } from '../session'
import type { StageTool, ToolPointer } from '../stage/toolBus'
import { view } from '../view'
import { extendStroke, fallbackSource, sizeToRadius, spotsAlong } from './brush'
import {
  createLinear, createRadial, dragLinear, dragRadial, dragSpot, hitHandle, hitSpot, insideRadial, linearLayout, onLinear, radialLayout,
  type HandleId, type SpotPart,
} from './handles'
import { updateMask } from './model'
import { describeSample } from './sample'
import { makeSpace, type Pt, type Space } from './space'

// What a single pointer does on the photo while masking or healing. Every
// gesture previews live and ends as one undo step.

type BrushStroke = Extract<MaskShape, { type: 'brush' }>['strokes'][number]

/** Where the brush / spot ring is drawn (photo-box CSS px), or null to hide it. */
export type CursorFn = (c: { x: number; y: number; r: number; inner: number } | null) => void

const reachFor = (p: ToolPointer) => (p.touch ? 22 : 10)
const srcOf = (session: Session) => ({ width: session.record.width, height: session.record.height })

function selection() {
  const r = editor.getState().recipe
  const v = view.get()
  const layer = r?.layers.find((l) => l.id === v.layer)
  const mask = layer?.masks.find((m) => m.id === v.mask) ?? layer?.masks[0]
  return r && layer && mask ? { r, layer, mask } : null
}

type MaskDrag =
  | { kind: 'paint'; layer: string; mask: Mask & { type: 'brush' }; stroke: BrushStroke; s: Space }
  | { kind: 'handle'; layer: string; mask: Mask; id: HandleId; from: Pt; s: Space }
  | { kind: 'place'; layer: string; mask: Mask; from: Pt; moved: boolean; s: Space }

const LABEL: Record<string, string> = { linear: 'Linear gradient', radial: 'Radial gradient' }

export function createMaskTool(session: Session, cursor: CursorFn): StageTool {
  const src = srcOf(session)
  let drag: MaskDrag | null = null

  const ring = (p: ToolPointer | null) => {
    const sel = selection()
    if (!p || !sel || sel.mask.type !== 'brush' || view.get().rangePick) return cursor(null)
    const b = view.get().brush
    const s = makeSpace(src, sel.r.geometry, p.box)
    const r = sizeToRadius(b.size) * s.scale
    cursor({ x: p.x, y: p.y, r, inner: r * (1 - b.feather / 100) })
  }

  const write = (layer: string, mask: Mask) => editor.preview((r) => updateMask(r, layer, mask.id, () => mask))

  return {
    down(p) {
      const sel = selection()
      if (!sel) return false
      const { r, layer, mask } = sel
      const s = makeSpace(src, r.geometry, p.box)
      const v = view.get()
      if (mask.type === 'range' && v.rangePick) {
        const c = (session.engine.canvas as HTMLCanvasElement).getBoundingClientRect()
        const sample = session.engine.samplePixel((p.clientX - c.left) / c.width, (p.clientY - c.top) / c.height, 4)
        view.set({ rangePick: false })
        if (!sample) return true
        const d = describeSample(sample, session.photo.color)
        const next: Mask = mask.range === 'luminance' ? { ...mask, low: Math.max(0, d.lum - 20), high: Math.min(100, d.lum + 20) } : { ...mask, hue: d.hue, sat: d.sat }
        editor.apply((x) => updateMask(x, layer.id, mask.id, () => next), mask.range === 'luminance' ? 'Pick brightness range' : 'Pick color range')
        return true
      }
      if (mask.type === 'brush') {
        const b = v.brush
        const stroke: BrushStroke = { points: [s.toMask(p)], r: sizeToRadius(b.size), feather: b.feather, flow: b.flow / 100 }
        if (b.erase || p.alt) stroke.erase = true
        drag = { kind: 'paint', layer: layer.id, mask, stroke, s }
        write(layer.id, { ...mask, strokes: [...mask.strokes, stroke] })
        return true
      }
      if (mask.type === 'linear' || mask.type === 'radial') {
        if (v.placing === mask.type) {
          drag = { kind: 'place', layer: layer.id, mask, from: p, moved: false, s }
          return true
        }
        const handles = mask.type === 'linear' ? linearLayout(mask, s).handles : radialLayout(mask, s).handles
        const id = hitHandle(handles, p, reachFor(p)) ?? ((mask.type === 'radial' ? insideRadial(mask, s, p) : onLinear(mask, s, p)) ? 'move' : null)
        if (!id) return false
        drag = { kind: 'handle', layer: layer.id, mask, id, from: p, s }
        return true
      }
      return false
    },
    move(p) {
      const d = drag
      if (!d) return ring(p)
      if (d.kind === 'paint') {
        const pts = extendStroke(d.stroke.points, d.s.toMask(p), d.stroke.r, src)
        if (!pts) return ring(p)
        d.stroke = { ...d.stroke, points: pts }
        write(d.layer, { ...d.mask, strokes: [...d.mask.strokes, d.stroke] })
        ring(p)
      } else if (d.kind === 'handle') {
        const m = d.mask
        if (m.type === 'linear') write(d.layer, { ...m, ...dragLinear(m, d.s, d.id, d.from, p) })
        else if (m.type === 'radial') write(d.layer, { ...m, ...dragRadial(m, d.s, d.id, d.from, p, p.shift) })
      } else {
        if (!d.moved && Math.hypot(p.x - d.from.x, p.y - d.from.y) < 4) return
        d.moved = true
        write(d.layer, { ...d.mask, ...(d.mask.type === 'linear' ? createLinear(d.s, d.from, p) : createRadial(d.s, d.from, p)) })
      }
    },
    up(p) {
      const d = drag
      drag = null
      if (!d) return
      if (d.kind === 'paint') return editor.commit(d.stroke.erase ? 'Erase brush mask' : 'Brush mask')
      if (d.kind === 'handle') return editor.commit(d.id === 'move' ? `Move ${LABEL[d.mask.type].toLowerCase()}` : LABEL[d.mask.type])
      // A tap while placing puts the default gradient there.
      if (!d.moved) {
        const m = d.mask
        if (m.type === 'radial') write(d.layer, { ...m, ...dragRadial(m, d.s, 'move', d.s.toPx({ x: m.cx, y: m.cy }), p) })
        else if (m.type === 'linear') write(d.layer, { ...m, ...dragLinear(m, d.s, 'move', linearLayout(m, d.s).mid, p) })
      }
      view.set({ placing: null })
      editor.commit(LABEL[d.mask.type])
    },
    cancel() {
      if (!drag) return
      const { layer, mask } = drag
      drag = null
      write(layer, mask)
      editor.commit('')
    },
    hover: ring,
  }
}

type SpotDrag =
  | { kind: 'spot'; id: string; part: SpotPart; start: RetouchSpot; from: Pt; s: Space }
  | { kind: 'paint'; first: RetouchSpot; base: RetouchSpot[]; path: Pt[]; s: Space }

const writeSpots = (spots: RetouchSpot[]) => editor.preview((r) => ({ ...r, retouch: spots }))

export function createHealTool(session: Session, cursor: CursorFn): StageTool {
  const src = srcOf(session)
  let drag: SpotDrag | null = null

  const ring = (p: ToolPointer | null) => {
    const r = editor.getState().recipe
    if (!p || !r) return cursor(null)
    const s = makeSpace(src, r.geometry, p.box)
    if (hitSpot(r.retouch, s, p, reachFor(p))) return cursor(null)
    const h = view.get().heal
    const rad = sizeToRadius(h.size) * s.scale
    cursor({ x: p.x, y: p.y, r: rad, inner: rad * (1 - h.feather / 100) })
  }

  return {
    down(p) {
      const r = editor.getState().recipe
      if (!r) return false
      const s = makeSpace(src, r.geometry, p.box)
      const hit = hitSpot(r.retouch, s, p, reachFor(p))
      if (hit) {
        const start = r.retouch.find((sp) => sp.id === hit.id)!
        view.set({ spot: hit.id })
        drag = { kind: 'spot', id: hit.id, part: hit.part, start, from: p, s }
        return true
      }
      const h = view.get().heal
      const m = s.toMask(p)
      const rad = sizeToRadius(h.size)
      const found = session.engine.findHealSource?.(r, m.x, m.y, rad) ?? null
      const from = found ?? fallbackSource(m.x, m.y, rad, src)
      const first: RetouchSpot = { id: uid(), mode: h.mode, x: m.x, y: m.y, r: rad, sx: from.sx, sy: from.sy, feather: h.feather, opacity: h.opacity / 100 }
      drag = { kind: 'paint', first, base: r.retouch, path: [], s }
      view.set({ spot: first.id })
      cursor(null)
      writeSpots([...r.retouch, first])
      return true
    },
    move(p) {
      const d = drag
      if (!d) return ring(p)
      if (d.kind === 'spot') {
        const moved = dragSpot(d.start, d.s, d.part, d.from, p)
        writeSpots((editor.getState().recipe?.retouch ?? []).map((sp) => (sp.id === d.id ? moved : sp)))
      } else {
        d.path.push(d.s.toMask(p))
        writeSpots([...d.base, ...spotsAlong(d.first, d.path, src, uid)])
      }
    },
    up() {
      const d = drag
      drag = null
      if (!d) return
      if (d.kind === 'spot') return editor.commit(d.part === 'edge' ? 'Heal spot size' : d.part === 'source' ? 'Move heal source' : 'Move heal spot')
      const n = (editor.getState().recipe?.retouch.length ?? 0) - d.base.length
      const what = d.first.mode === 'heal' ? 'Heal' : 'Clone'
      editor.commit(n > 1 ? `${what} stroke` : `${what} spot`)
    },
    cancel() {
      const d = drag
      drag = null
      if (!d) return
      writeSpots(d.kind === 'spot' ? (editor.getState().recipe?.retouch ?? []).map((sp) => (sp.id === d.id ? d.start : sp)) : d.base)
      editor.commit('')
      if (d.kind === 'paint') view.set({ spot: null })
    },
    hover: ring,
  }
}
