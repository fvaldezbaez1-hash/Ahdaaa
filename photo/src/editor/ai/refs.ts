import type { EditRecipe, LocalLayer, Mask, MaskShape, Retouch } from '../../edit/types'

// Which stored AI results (rasters) a recipe refers to: AI mask images,
// removal fills and the AI-denoised copy. Ids are '' until computed.

export type AiShape = Extract<MaskShape, { type: 'ai' }>
export type AiMask = Extract<Mask, { type: 'ai' }>

/** Every raster id the recipe uses, without duplicates or blanks. */
export function rasterRefs(r: Pick<EditRecipe, 'layers' | 'retouch' | 'denoise'>): string[] {
  const ids = new Set<string>()
  for (const l of r.layers) for (const m of l.masks) if (m.type === 'ai' && m.raster) ids.add(m.raster)
  for (const t of r.retouch) if (t.mode === 'remove' && t.fill) ids.add(t.fill)
  if (r.denoise?.raster) ids.add(r.denoise.raster)
  return [...ids]
}

/** What changed between two sets of references. */
export function refChanges(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const a = new Set(before), b = new Set(after)
  return { added: [...b].filter((id) => !a.has(id)), removed: [...a].filter((id) => !b.has(id)) }
}

/** True when an AI result has to be (re)computed: never made, or its stored image is gone (e.g. a restored backup). */
export const needsCompute = (id: string, missing: ReadonlySet<string>) => !id || missing.has(id)

/** AI results belong to one photo: pasted onto another they're blanked, to be recomputed there. */
export function blankRasters<T extends { layers?: LocalLayer[]; retouch?: Retouch[] }>(r: T): T {
  return {
    ...r,
    ...(r.layers && { layers: r.layers.map((l) => ({ ...l, masks: l.masks.map((m) => (m.type === 'ai' ? { ...m, raster: '' } : m)) })) }),
    ...(r.retouch && { retouch: r.retouch.map((t) => (t.mode === 'remove' ? { ...t, fill: '' } : t)) }),
  }
}
