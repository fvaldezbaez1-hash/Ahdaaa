import { uid } from '../../io/db'
import { editor } from '../../state/editor'
import type { EditRecipe, Mask, MaskShape, RetouchSpot } from '../../edit/types'
import { finishCrop, isCropping } from '../crop/cropTool'
import { stageControl } from '../stage/stageView'
import { view } from '../view'
import { radiusToSize, sizeToRadius } from './brush'
import { createLinear, createRadial } from './handles'
import { addMask, maskLabel, MASK_KINDS, newLayer, removeMask, type MaskKind } from './model'
import { makeSpace, sourceAngle, type Pt } from './space'

// Entering and leaving the masking and healing tools, and the one-step edits
// their panels make.

export function enterMasks(layerId?: string) {
  if (isCropping()) finishCrop()
  const layers = editor.getState().recipe?.layers ?? []
  const layer = layers.find((l) => l.id === (layerId ?? view.get().layer)) ?? layers[layers.length - 1]
  view.set({ tool: 'mask', layer: layer?.id ?? null, mask: layer?.masks[0]?.id ?? null, eyedropper: false, placing: null, rangePick: false })
}

export function enterHeal() {
  if (isCropping()) finishCrop()
  view.set({ tool: 'heal', eyedropper: false, placing: null, rangePick: false })
}

export function exitTool() {
  view.set({ tool: null, placing: null, rangePick: false })
}

/**
 * A new mask's shape, placed in the part of the photo on screen: gradients
 * start in the middle of the view, sized to it, and look level on screen.
 */
export function defaultShape(kind: MaskKind, src: { width: number; height: number }, r: EditRecipe): MaskShape {
  if (kind === 'brush') return { type: 'brush', strokes: [] }
  if (kind === 'luminance') return { type: 'range', range: 'luminance', low: 60, high: 100, smooth: 30 }
  if (kind === 'color') return { type: 'range', range: 'color', low: 0, high: 30, smooth: 30, hue: 210, sat: 50 }
  const lay = stageControl.layout()
  const box = lay && lay.box.w > 0 ? lay.box : { x: 0, y: 0, w: 1000, h: 1000 * (src.height / src.width) }
  const stage = lay?.stage ?? { w: box.w, h: box.h }
  const s = makeSpace(src, r.geometry, { w: box.w, h: box.h })
  // The visible part of the photo, in photo-box px.
  const x0 = Math.max(0, -box.x), y0 = Math.max(0, -box.y)
  const x1 = Math.min(box.w, stage.w - box.x), y1 = Math.min(box.h, stage.h - box.y)
  const c: Pt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  const size = Math.max(40, Math.min(x1 - x0, y1 - y0))
  if (kind === 'linear') return createLinear(s, { x: c.x, y: c.y - size * 0.4 }, c)
  const radial = createRadial(s, c, c)
  return { ...radial, rx: (size * 0.34) / s.scale, ry: (size * 0.26) / s.scale, angle: Math.round(sourceAngle(s, 0)) }
}

const toMask = (shape: MaskShape, mode: Mask['mode'] = 'add'): Mask => ({ ...shape, id: uid(), mode, invert: false }) as Mask

/** New layer with one mask of `kind`; it becomes the selection. Gradients can then be drawn on the photo. */
export function createLayer(kind: MaskKind, src: { width: number; height: number }) {
  const r = editor.getState().recipe
  if (!r) return
  const ids = { layer: uid(), mask: uid() }
  const layer = newLayer(r.layers, kind, defaultShape(kind, src, r), ids)
  editor.apply((x) => ({ ...x, layers: [...x.layers, layer] }), `New ${MASK_KINDS.find((k) => k.kind === kind)!.label.toLowerCase()} mask`)
  view.set({ tool: 'mask', layer: layer.id, mask: ids.mask, placing: kind === 'linear' || kind === 'radial' ? kind : null, rangePick: kind === 'color' })
}

/** Another mask in the selected layer, combined with `mode`. */
export function addMaskToLayer(layerId: string, kind: MaskKind, mode: Mask['mode'], src: { width: number; height: number }) {
  const r = editor.getState().recipe
  if (!r) return
  const mask = toMask(defaultShape(kind, src, r), mode)
  editor.apply((x) => addMask(x, layerId, mask), `${mode === 'add' ? 'Add' : mode === 'subtract' ? 'Subtract' : 'Intersect'} ${maskLabel(mask).toLowerCase()}`)
  view.set({ layer: layerId, mask: mask.id, placing: kind === 'linear' || kind === 'radial' ? kind : null, rangePick: kind === 'color' })
}

export function deleteMask(layerId: string, maskId: string) {
  const r = editor.getState().recipe
  const layer = r?.layers.find((l) => l.id === layerId)
  const mask = layer?.masks.find((m) => m.id === maskId)
  if (!r || !layer || !mask) return
  editor.apply((x) => removeMask(x, layerId, maskId), layer.masks.length > 1 ? `Delete ${maskLabel(mask).toLowerCase()} mask` : `Delete ${layer.name}`)
  const next = editor.getState().recipe?.layers.find((l) => l.id === layerId)
  view.set({ layer: next ? layerId : null, mask: next?.masks[0]?.id ?? null, placing: null, rangePick: false })
}

// ---- Healing ----

export function updateSpots(fn: (spots: RetouchSpot[]) => RetouchSpot[], label: string) {
  editor.apply((r) => ({ ...r, retouch: fn(r.retouch) }), label)
}

export function deleteSpot(id: string | null) {
  if (!id) return
  updateSpots((spots) => spots.filter((s) => s.id !== id), 'Delete heal spot')
  view.set({ spot: null })
}

/** [ and ]: brush or spot size by a step; also resizes the selected spot. */
export function nudgeSize(dir: 1 | -1) {
  const v = view.get()
  if (v.tool === 'heal') {
    const spot = editor.getState().recipe?.retouch.find((s) => s.id === v.spot)
    const size = Math.min(100, Math.max(1, (spot ? radiusToSize(spot.r) : v.heal.size) + dir * 5))
    view.set({ heal: { ...v.heal, size } })
    if (spot) updateSpots((spots) => spots.map((s) => (s.id === spot.id ? { ...s, r: sizeToRadius(size) } : s)), 'Heal spot size')
  } else if (v.tool === 'mask') view.set({ brush: { ...v.brush, size: Math.min(100, Math.max(1, v.brush.size + dir * 5)) } })
}
