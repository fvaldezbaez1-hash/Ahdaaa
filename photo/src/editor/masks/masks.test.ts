import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../../edit/defaults'
import type { EditRecipe, Geometry, Mask, RetouchSpot } from '../../edit/types'
import { DEFAULT_PARTS, makeClipboard } from '../../library/edits'
import { editor } from '../../state/editor'
import { groupsFromParts, pasteGroups } from '../math/paste'
import { extendStroke, fallbackSource, maskDist, radiusToSize, sizeToRadius, spotsAlong } from './brush'
import {
  createLinear, createRadial, dragLinear, dragRadial, dragSpot, hitHandle, hitSpot, insideRadial, linearLayout, onLinear, radialLayout,
  type LinearShape, type RadialShape,
} from './handles'
import { duplicateLayer, moveLayer, newLayer, nextName, removeMask, setAdjust } from './model'
import { makeSpace, screenAngle, sourceAngle } from './space'

const SRC = { width: 3000, height: 2000 }
const geo = (g: Partial<Geometry> = {}): Geometry => ({ crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original', ...g })
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const nearPt = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => {
  near(a.x, b.x, eps)
  near(a.y, b.y, eps)
}

describe('mask ↔ screen coordinates', () => {
  it('maps the whole photo onto the box when nothing is cropped', () => {
    const s = makeSpace(SRC, geo(), { w: 600, h: 400 })
    nearPt(s.toPx({ x: 0, y: 0 }), { x: 0, y: 0 })
    nearPt(s.toPx({ x: 1, y: 1 }), { x: 600, y: 400 })
    near(s.scale, 600) // the long edge is 600 px on screen
    expect(s.mirrored).toBe(false)
  })

  it('follows the crop: the crop fills the box and lengths grow', () => {
    const s = makeSpace(SRC, geo({ crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }), { w: 600, h: 400 })
    nearPt(s.toPx({ x: 0.5, y: 0.5 }), { x: 0, y: 0 })
    nearPt(s.toPx({ x: 0.75, y: 0.75 }), { x: 300, y: 200 })
    near(s.scale, 1200)
  })

  it('follows quarter turns and flips', () => {
    // 90° clockwise: the source's top-left corner ends up top-right.
    const r = makeSpace(SRC, geo({ rotate: 1 }), { w: 400, h: 600 })
    nearPt(r.toPx({ x: 0, y: 0 }), { x: 400, y: 0 })
    near(r.angle, Math.PI / 2)
    const f = makeSpace(SRC, geo({ flipH: true }), { w: 600, h: 400 })
    nearPt(f.toPx({ x: 0, y: 0 }), { x: 600, y: 0 })
    expect(f.mirrored).toBe(true)
  })

  it('round-trips with straighten, crop and turn together', () => {
    const s = makeSpace(SRC, geo({ crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 }, angle: 7, rotate: 3, flipV: true }), { w: 500, h: 520 })
    for (const p of [{ x: 0.3, y: 0.4 }, { x: 0.55, y: 0.61 }, { x: 0.2, y: 0.7 }]) nearPt(s.toMask(s.toPx(p)), p, 1e-9)
    for (const deg of [0, 30, -75, 120]) near(sourceAngle(s, screenAngle(s, deg)), deg, 1e-9)
  })
})

describe('linear gradient handles', () => {
  const s = makeSpace(SRC, geo(), { w: 600, h: 400 })
  const m: LinearShape = { type: 'linear', x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.75 }

  it('puts the handles on the lines', () => {
    const { handles, mid } = linearLayout(m, s)
    nearPt(mid, { x: 300, y: 200 })
    expect(hitHandle(handles, { x: 302, y: 101 }, 10)).toBe('start')
    expect(hitHandle(handles, { x: 300, y: 298 }, 10)).toBe('end')
    expect(hitHandle(handles, { x: 300, y: 200 }, 10)).toBe('move')
    expect(hitHandle(handles, { x: 360, y: 260 }, 10)).toBeNull()
    expect(onLinear(m, s, { x: 50, y: 150 })).toBe(true)
    expect(onLinear(m, s, { x: 50, y: 350 })).toBe(false)
  })

  it('moves, reshapes and rotates', () => {
    const moved = dragLinear(m, s, 'move', { x: 300, y: 200 }, { x: 360, y: 220 })
    near(moved.x1, 0.6)
    near(moved.y2, 0.8)
    const end = dragLinear(m, s, 'end', { x: 300, y: 300 }, { x: 450, y: 300 })
    expect(end).toMatchObject({ x1: 0.5, y1: 0.25 })
    near(end.x2, 0.75)
    // A quarter turn clockwise around the middle: the gradient now runs right → left.
    const turned = dragLinear(m, s, 'rotate', { x: 300 + 56, y: 200 }, { x: 300, y: 200 + 56 })
    near(turned.x1, 0.5 + 100 / 600)
    near(turned.y1, 0.5)
  })

  it('creates from a drag', () => {
    expect(createLinear(s, { x: 60, y: 40 }, { x: 60, y: 200 })).toEqual({ type: 'linear', x1: 0.1, y1: 0.1, x2: 0.1, y2: 0.5 })
  })
})

describe('radial gradient handles', () => {
  const s = makeSpace(SRC, geo(), { w: 600, h: 400 })
  const m: RadialShape = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0, feather: 50 }

  it('puts radius, rotate and feather handles around the ellipse', () => {
    const { handles } = radialLayout(m, s)
    expect(hitHandle(handles, { x: 420, y: 200 }, 10)).toBe('rx')
    expect(hitHandle(handles, { x: 300, y: 140 }, 10)).toBe('ry2')
    expect(hitHandle(handles, { x: 300, y: 112 }, 10)).toBe('rotate')
    expect(hitHandle(handles, { x: 300 + 60 * Math.SQRT1_2, y: 200 + 30 * Math.SQRT1_2 }, 5)).toBe('feather')
    expect(insideRadial(m, s, { x: 400, y: 210 })).toBe(true)
    expect(insideRadial(m, s, { x: 300, y: 270 })).toBe(false)
  })

  it('resizes along its own axes, also when rotated', () => {
    near(dragRadial(m, s, 'rx', { x: 420, y: 200 }, { x: 480, y: 260 }).rx, 0.3)
    const tilted = { ...m, angle: 90 }
    // Turned 90°: the x radius now points down the screen.
    near(dragRadial(tilted, s, 'rx', { x: 300, y: 320 }, { x: 330, y: 380 }).rx, 0.3)
    const circle = dragRadial(m, s, 'ry', { x: 300, y: 260 }, { x: 300, y: 290 }, true)
    near(circle.rx, 0.15)
    near(circle.ry, 0.15)
  })

  it('rotates, feathers and moves', () => {
    near(dragRadial(m, s, 'rotate', { x: 300, y: 100 }, { x: 400, y: 200 }).angle, 90)
    expect(dragRadial(m, s, 'feather', { x: 0, y: 0 }, { x: 390, y: 200 }).feather).toBe(25)
    const moved = dragRadial(m, s, 'move', { x: 300, y: 200 }, { x: 330, y: 160 })
    near(moved.cx, 0.55)
    near(moved.cy, 0.4)
  })

  it('turns the other way on a mirrored photo', () => {
    const f = makeSpace(SRC, geo({ flipH: true }), { w: 600, h: 400 })
    near(dragRadial(m, f, 'rotate', { x: 300, y: 100 }, { x: 400, y: 200 }).angle, -90)
  })

  it('creates a circle from the center outward', () => {
    const c = createRadial(s, { x: 300, y: 200 }, { x: 300, y: 260 })
    expect(c).toMatchObject({ cx: 0.5, cy: 0.5, angle: 0 })
    near(c.rx, 0.1)
    near(c.ry, 0.1)
  })
})

describe('heal spots', () => {
  const s = makeSpace(SRC, geo(), { w: 600, h: 400 })
  const spot: RetouchSpot = { id: 'a', mode: 'heal', x: 0.25, y: 0.5, r: 0.05, sx: 0.75, sy: 0.5, feather: 50, opacity: 1 }

  it('tells the target, its edge and the source apart', () => {
    expect(hitSpot([spot], s, { x: 150, y: 200 }, 10)).toEqual({ id: 'a', part: 'target' })
    expect(hitSpot([spot], s, { x: 179, y: 200 }, 10)).toEqual({ id: 'a', part: 'edge' })
    expect(hitSpot([spot], s, { x: 450, y: 210 }, 10)).toEqual({ id: 'a', part: 'source' })
    expect(hitSpot([spot], s, { x: 300, y: 200 }, 10)).toBeNull()
  })

  it('moves the target or source, and resizes from the edge', () => {
    expect(dragSpot(spot, s, 'target', { x: 150, y: 200 }, { x: 210, y: 200 })).toMatchObject({ x: 0.35, sx: 0.75 })
    expect(dragSpot(spot, s, 'source', { x: 450, y: 200 }, { x: 450, y: 240 })).toMatchObject({ x: 0.25, sy: 0.6 })
    near(dragSpot(spot, s, 'edge', { x: 180, y: 200 }, { x: 210, y: 200 }).r, 0.1)
  })

  it('finds a fallback source that stays on the photo', () => {
    const right = fallbackSource(0.5, 0.5, 0.05, SRC)
    near(right.sx, 0.5 + (2.5 * 0.05 * 3000) / 3000)
    const nearRight = fallbackSource(0.95, 0.5, 0.05, SRC)
    expect(nearRight.sx).toBeLessThan(0.95)
    expect(nearRight.sx - 0.05).toBeGreaterThanOrEqual(0)
  })

  it('paints spots one radius apart with the same offset', () => {
    let n = 0
    const path = Array.from({ length: 30 }, (_, i) => ({ x: 0.25 + i * 0.01, y: 0.5 }))
    const out = spotsAlong(spot, path, SRC, () => `s${++n}`)
    expect(out.length).toBe(6)
    for (const sp of out) near(sp.sx - sp.x, 0.5)
    for (let i = 1; i < out.length; i++) expect(maskDist(out[i - 1], out[i], SRC)).toBeGreaterThanOrEqual(0.05 - 1e-9)
  })
})

describe('brush', () => {
  it('maps the size slider to a radius and back', () => {
    near(sizeToRadius(0), 0.002)
    near(sizeToRadius(100), 0.25)
    for (const v of [5, 35, 80]) near(radiusToSize(sizeToRadius(v)), v, 1e-9)
  })

  it('adds stroke points only when they move far enough', () => {
    const pts = [{ x: 0.5, y: 0.5 }]
    expect(extendStroke(pts, { x: 0.501, y: 0.5 }, 0.02, SRC)).toBeNull()
    expect(extendStroke(pts, { x: 0.51, y: 0.5 }, 0.02, SRC)).toHaveLength(2)
  })
})

describe('layers', () => {
  const r0 = defaultRecipe('display')
  const radial: Mask = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, angle: 0, feather: 50, id: 'm1', mode: 'add', invert: false }

  it('names new layers by kind, numbering repeats', () => {
    const a = newLayer([], 'radial', radial, { layer: 'L1', mask: 'm1' })
    expect(a.name).toBe('Radial')
    expect(nextName([a], 'Radial')).toBe('Radial 2')
    expect(a.masks[0]).toMatchObject({ id: 'm1', mode: 'add', invert: false })
  })

  it('drops a layer with its last mask and keeps the first mask additive', () => {
    const brush: Mask = { type: 'brush', strokes: [], id: 'm2', mode: 'subtract', invert: false }
    const r: EditRecipe = { ...r0, layers: [{ id: 'L', name: 'A', enabled: true, opacity: 1, masks: [radial, brush], adjust: { exposure: 1 } }] }
    const one = removeMask(r, 'L', 'm1')
    expect(one.layers[0].masks).toEqual([{ ...brush, mode: 'add' }])
    expect(removeMask(one, 'L', 'm2').layers).toEqual([])
  })

  it('duplicates with fresh ids and moves layers', () => {
    const r: EditRecipe = { ...r0, layers: [{ id: 'L', name: 'Sky', enabled: true, opacity: 1, masks: [radial], adjust: {} }, { id: 'K', name: 'Face', enabled: true, opacity: 1, masks: [radial], adjust: {} }] }
    let n = 0
    const d = duplicateLayer(r, 'L', () => `n${++n}`)
    expect(d.recipe.layers.map((l) => l.name)).toEqual(['Sky', 'Sky copy', 'Face'])
    expect(d.recipe.layers[1].masks[0].id).not.toBe('m1')
    expect(moveLayer(r, 'L', 1).layers.map((l) => l.id)).toEqual(['K', 'L'])
    expect(moveLayer(r, 'L', -1)).toBe(r)
  })

  it('drops adjustments set back to zero', () => {
    expect(setAdjust({ exposure: 1, contrast: 5 }, 'exposure', 0)).toEqual({ contrast: 5 })
    expect(setAdjust({}, 'color', { hue: 20, sat: 0 })).toEqual({})
  })
})

describe('undo grouping', () => {
  it('turns a whole brush stroke into one undo step', () => {
    const layer = newLayer([], 'brush', { type: 'brush', strokes: [] }, { layer: 'L', mask: 'b' })
    editor.open('p', { ...defaultRecipe('display'), layers: [layer] }, 'display')
    const stroke = { points: [{ x: 0.1, y: 0.1 }], r: 0.02, feather: 50, flow: 1 }
    for (let i = 0; i < 20; i++) {
      stroke.points = [...stroke.points, { x: 0.1 + i * 0.02, y: 0.1 }]
      editor.preview((r) => ({ ...r, layers: r.layers.map((l) => ({ ...l, masks: l.masks.map((m) => (m.type === 'brush' ? { ...m, strokes: [{ ...stroke }] } : m)) })) }))
    }
    editor.commit('Brush mask')
    const s = editor.getState()
    expect(s.history.map((h) => h.label)).toEqual(['Brush mask', 'Opened'])
    editor.undo()
    const m = editor.getState().recipe!.layers[0].masks[0]
    expect(m.type === 'brush' && m.strokes).toEqual([])
    editor.redo()
    const back = editor.getState().recipe!.layers[0].masks[0]
    expect(back.type === 'brush' && back.strokes[0].points).toHaveLength(21)
  })

  it('leaves no step for a cancelled gesture', () => {
    const before = editor.getState().recipe!
    editor.preview((r) => ({ ...r, retouch: [{ id: 'x', mode: 'heal', x: 0.5, y: 0.5, r: 0.02, sx: 0.6, sy: 0.5, feather: 50, opacity: 1 }] }))
    editor.preview(() => before)
    editor.commit('')
    expect(editor.getState().history[0].label).toBe('Redo')
    expect(editor.getState().recipe!.retouch).toEqual([])
  })
})

describe('copy & paste of masks and healing', () => {
  const src: EditRecipe = {
    ...defaultRecipe('display'),
    layers: [newLayer([], 'radial', { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, angle: 0, feather: 50 }, { layer: 'L', mask: 'm' })],
    retouch: [{ id: 's', mode: 'heal', x: 0.5, y: 0.5, r: 0.02, sx: 0.6, sy: 0.5, feather: 50, opacity: 1 }],
  }
  const clip = makeClipboard({ recipe: src, kind: 'display' })
  const target = { recipe: defaultRecipe('display'), kind: 'display' as const, raw: undefined }

  it('copies masks but not healing spots by default, like Lightroom', () => {
    expect(DEFAULT_PARTS).toContain('layers')
    expect(DEFAULT_PARTS).not.toContain('retouch')
    expect(groupsFromParts(clip.parts)).toContain('masks')
    expect(groupsFromParts(clip.parts)).not.toContain('retouch')
  })

  it('pastes each when chosen', () => {
    expect(pasteGroups(target, clip, ['masks']).layers).toEqual(src.layers)
    expect(pasteGroups(target, clip, ['masks']).retouch).toEqual([])
    expect(pasteGroups(target, clip, ['retouch']).retouch).toEqual(src.retouch)
  })
})
