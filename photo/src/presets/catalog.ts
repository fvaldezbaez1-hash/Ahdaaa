// The built-in catalog: 20 collections × 5 hand-made looks = 100 presets. User, AI and Lightroom presets live in the
// database (db.presets). How a look applies is in apply.ts.
import type { Preset, Variation } from '../edit/types'
import type { CollectionDef } from './data/kit'
import { airy } from './data/airy'
import { architecture } from './data/architecture'
import { bw } from './data/bw'
import { cinematic } from './data/cinematic'
import { creative } from './data/creative'
import { essentials } from './data/essentials'
import { family } from './data/family'
import { film } from './data/film'
import { food } from './data/food'
import { landscape } from './data/landscape'
import { moody } from './data/moody'
import { nature } from './data/nature'
import { night } from './data/night'
import { portrait } from './data/portrait'
import { seasonal } from './data/seasonal'
import { sports } from './data/sports'
import { street } from './data/street'
import { travel } from './data/travel'
import { vintage } from './data/vintage'
import { wedding } from './data/wedding'

export { applyPreset, stripLook } from './apply'

export interface Collection {
  id: string
  name: string
  description: string
  presetIds: string[]
}

/** Looks no longer come in variations (Amount covers softer and stronger); kept for existing callers. */
export const VARIATIONS: { id: Variation; label: string }[] = [{ id: 'original', label: 'Original' }]

const DEFS: CollectionDef[] = [
  essentials, film, portrait, landscape, bw, cinematic, street, travel, food, wedding,
  night, vintage, seasonal, moody, airy, nature, architecture, sports, family, creative,
]

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

/** Built-in collections (20 × 5 = 100 looks). */
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

/** Does a look match every search term (name, collection, description, tags)? */
export function lookMatches(p: Preset, terms: readonly string[]): boolean {
  if (!terms.length) return true
  const text = `${p.name} ${collectionName(p.collection)} ${p.description ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase()
  return terms.every((t) => text.includes(t))
}

export const searchTerms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
