// Preset catalog and how presets apply to a recipe. OWNER: presets agent —
// replace the stubs; keep these signatures (editor and AI import them).
import type { EditRecipe, Preset, SourceKind, Variation } from '../edit/types'

export interface Collection {
  id: string
  name: string
  description: string
  presetIds: string[]
}

export const VARIATIONS: { id: Variation; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'warmer', label: 'Warmer' },
  { id: 'cooler', label: 'Cooler' },
  { id: 'softer', label: 'Softer' },
  { id: 'stronger', label: 'Stronger' },
]

/** Built-in collections (200 looks; ×5 variations = 1,000 presets). */
export function collections(): Collection[] {
  return []
}

/** Built-in looks. User/AI/Lightroom presets live in the database (db.presets). */
export function builtinPresets(): Preset[] {
  return []
}

export function findBuiltin(_id: string): Preset | undefined {
  return undefined
}

/**
 * Apply a look to a recipe. `amount` is 0…200 (%). Keeps crop/geometry and
 * anything the preset doesn't set. White balance shifts relative to the
 * recipe's current values. Records `look` on the result.
 */
export function applyPreset(recipe: EditRecipe, _preset: Preset, _amount: number, _variation: Variation, _kind: SourceKind): EditRecipe {
  return recipe
}
