// The built-in catalog: 20 collections × 10 looks = 200 looks, and with the
// 5 variations, 1,000 presets. User, AI and Lightroom presets live in the
// database (db.presets). How a look applies is in apply.ts.
import type { Preset, Variation } from '../edit/types'
import type { CollectionDef } from './data/kit'
import { essentials } from './data/essentials'
import { film } from './data/film'

export { applyPreset, stripLook } from './apply'

export interface Collection {
  id: string
  name: string
  description: string
  presetIds: string[]
}

export const VARIATIONS: { id: Variation; label: string; short: string }[] = [
  { id: 'original', label: 'Original', short: 'Orig' },
  { id: 'warmer', label: 'Warmer', short: 'Warm' },
  { id: 'cooler', label: 'Cooler', short: 'Cool' },
  { id: 'softer', label: 'Softer', short: 'Soft' },
  { id: 'stronger', label: 'Stronger', short: 'Bold' },
]

const DEFS: CollectionDef[] = [essentials, film]

const PRESETS: Preset[] = DEFS.flatMap((c) =>
  c.looks.map((l) => ({
    id: `${c.id}-${l.slug}`,
    name: l.name,
    collection: c.id,
    description: l.description,
    tags: l.tags,
    // Built-in color looks always render in color, even on a photo set to B&W.
    data: { treatment: 'color', ...l.data },
  })),
)
const BY_ID = new Map(PRESETS.map((p) => [p.id, p]))
const COLLECTIONS: Collection[] = DEFS.map((c) => ({ id: c.id, name: c.name, description: c.description, presetIds: c.looks.map((l) => `${c.id}-${l.slug}`) }))

/** Built-in collections (200 looks; ×5 variations = 1,000 presets). */
export function collections(): Collection[] {
  return COLLECTIONS
}

/** Built-in looks. User/AI/Lightroom presets live in the database (db.presets). */
export function builtinPresets(): Preset[] {
  return PRESETS
}

export function findBuiltin(id: string): Preset | undefined {
  return BY_ID.get(id)
}

export function collectionName(id: string): string {
  return id === 'mine' ? 'My presets' : id === 'lightroom' ? 'From Lightroom' : (COLLECTIONS.find((c) => c.id === id)?.name ?? id)
}
