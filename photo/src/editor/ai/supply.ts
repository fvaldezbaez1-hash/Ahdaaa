import type { EditRecipe } from '../../edit/types'
import type { Engine } from '../../engine/types'
import { ai } from './core'
import { rasterRefs } from './refs'

const given = new WeakMap<Engine, Set<string>>()

/**
 * For engines outside the editor (preset previews): hand over exactly the AI
 * results a recipe uses, and drop the rest. Leaves out the AI-denoised copy,
 * a full-resolution image that a preview tile doesn't need.
 */
export async function supplyRasters(engine: Engine, recipe: EditRecipe): Promise<void> {
  if (!engine.setRaster) return
  const want = rasterRefs({ ...recipe, denoise: undefined })
  const have = given.get(engine) ?? new Set<string>()
  if (!want.length && !have.size) return
  const next = new Set<string>()
  for (const id of have) if (!want.includes(id)) engine.setRaster(id, null)
  const core = await ai()
  for (const id of want) {
    if (have.has(id)) next.add(id)
    else {
      const img = await core.getRaster(id).catch(() => undefined)
      if (img) {
        engine.setRaster(id, img)
        next.add(id)
      }
    }
  }
  given.set(engine, next)
}
