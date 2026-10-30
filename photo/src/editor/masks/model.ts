import type { EditRecipe, LocalAdjust, LocalLayer, Mask, MaskShape } from '../../edit/types'

// Local adjustment layers and their masks, as pure recipe updates.

export type MaskKind = 'brush' | 'linear' | 'radial' | 'luminance' | 'color'

export const MASK_KINDS: { kind: MaskKind; label: string; name: string }[] = [
  { kind: 'brush', label: 'Brush', name: 'Brush' },
  { kind: 'linear', label: 'Linear gradient', name: 'Linear' },
  { kind: 'radial', label: 'Radial gradient', name: 'Radial' },
  { kind: 'luminance', label: 'Luminance range', name: 'Luminance' },
  { kind: 'color', label: 'Color range', name: 'Color' },
]

/** Phase 3 (on-device AI): listed in the menu, not available yet. */
export const AI_KINDS = [
  { target: 'subject', label: 'Subject' },
  { target: 'sky', label: 'Sky' },
  { target: 'background', label: 'Background' },
  { target: 'person', label: 'People' },
] as const

export function kindOf(m: MaskShape): MaskKind | 'ai' {
  return m.type === 'range' ? m.range : m.type
}

export function maskLabel(m: MaskShape): string {
  if (m.type === 'ai') return AI_KINDS.find((a) => a.target === m.target)?.label ?? 'AI'
  return MASK_KINDS.find((k) => k.kind === kindOf(m))!.label
}

/** "Radial", then "Radial 2", "Radial 3"… */
export function nextName(layers: LocalLayer[], base: string): string {
  const taken = new Set(layers.map((l) => l.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function newLayer(layers: LocalLayer[], kind: MaskKind, shape: MaskShape, ids: { layer: string; mask: string }): LocalLayer {
  return {
    id: ids.layer,
    name: nextName(layers, MASK_KINDS.find((k) => k.kind === kind)!.name),
    enabled: true,
    opacity: 1,
    masks: [{ ...shape, id: ids.mask, mode: 'add', invert: false } as Mask],
    adjust: {},
  }
}

export function updateLayer(r: EditRecipe, id: string, fn: (l: LocalLayer) => LocalLayer): EditRecipe {
  return { ...r, layers: r.layers.map((l) => (l.id === id ? fn(l) : l)) }
}

export function updateMask(r: EditRecipe, layerId: string, maskId: string, fn: (m: Mask) => Mask): EditRecipe {
  return updateLayer(r, layerId, (l) => ({ ...l, masks: l.masks.map((m) => (m.id === maskId ? fn(m) : m)) }))
}

export function addMask(r: EditRecipe, layerId: string, mask: Mask): EditRecipe {
  return updateLayer(r, layerId, (l) => ({ ...l, masks: [...l.masks, mask] }))
}

/** Removing a layer's last mask removes the layer (an empty mask selects nothing). */
export function removeMask(r: EditRecipe, layerId: string, maskId: string): EditRecipe {
  const layer = r.layers.find((l) => l.id === layerId)
  if (!layer) return r
  if (layer.masks.length <= 1) return removeLayer(r, layerId)
  const masks = layer.masks.filter((m) => m.id !== maskId)
  // The first mask is always the base the others add to or cut from.
  if (masks[0].mode !== 'add') masks[0] = { ...masks[0], mode: 'add' }
  return updateLayer(r, layerId, (l) => ({ ...l, masks }))
}

export function removeLayer(r: EditRecipe, id: string): EditRecipe {
  return { ...r, layers: r.layers.filter((l) => l.id !== id) }
}

export function duplicateLayer(r: EditRecipe, id: string, newId: () => string): { recipe: EditRecipe; id: string | null } {
  const i = r.layers.findIndex((l) => l.id === id)
  if (i < 0) return { recipe: r, id: null }
  const src = r.layers[i]
  const copy: LocalLayer = { ...structuredClone(src), id: newId(), name: nextName(r.layers, `${src.name} copy`) }
  copy.masks = copy.masks.map((m) => ({ ...m, id: newId() }))
  return { recipe: { ...r, layers: [...r.layers.slice(0, i + 1), copy, ...r.layers.slice(i + 1)] }, id: copy.id }
}

/** Layers apply in order; −1 moves earlier (under), +1 later (on top). */
export function moveLayer(r: EditRecipe, id: string, dir: -1 | 1): EditRecipe {
  const i = r.layers.findIndex((l) => l.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= r.layers.length) return r
  const layers = r.layers.slice()
  ;[layers[i], layers[j]] = [layers[j], layers[i]]
  return { ...r, layers }
}

/** Set one local adjustment; 0 (or no color) removes the field, since missing = no change. */
export function setAdjust<K extends keyof LocalAdjust>(a: LocalAdjust, key: K, value: LocalAdjust[K] | undefined): LocalAdjust {
  const next = { ...a }
  if (value === undefined || value === 0 || (typeof value === 'object' && value.sat === 0)) delete next[key]
  else next[key] = value
  return next
}

export const isAdjusted = (a: LocalAdjust) => Object.keys(a).length > 0
