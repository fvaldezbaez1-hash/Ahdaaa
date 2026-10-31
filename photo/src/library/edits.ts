// Copy / paste / reset of edit recipes between photos (pure).
import { defaultRecipe, isUnedited, normalizeRecipe } from '../edit/defaults'
import { blankRasters } from '../editor/ai/refs'
import type { EditRecipe, SourceKind } from '../edit/types'
import type { PhotoRecord } from '../io/types'

export type RecipePart = Exclude<keyof EditRecipe, 'v' | 'look'>

export const ALL_PARTS: readonly RecipePart[] = ['profile', 'treatment', 'wb', 'basic', 'curve', 'mixer', 'grading', 'detail', 'effects', 'geometry', 'layers', 'retouch']
/** What Copy/Paste carries by default: everything except the crop and rotation and the healing spots, which belong to each frame. */
export const DEFAULT_PARTS: readonly RecipePart[] = ALL_PARTS.filter((p) => p !== 'geometry' && p !== 'retouch')

export interface Clipboard {
  recipe: unknown
  parts: string[]
  at: number
}

type Target = Pick<PhotoRecord, 'recipe' | 'kind' | 'raw'>

export function makeClipboard(p: Target, parts: readonly RecipePart[] = DEFAULT_PARTS): Clipboard {
  return { recipe: structuredClone(p.recipe), parts: [...parts], at: Date.now() }
}

/** The clipboard doesn't say which kind of photo it came from; RAW white balance is in Kelvin, JPEG's is a ±100 shift. */
function kindOfRecipe(r: EditRecipe): SourceKind {
  return r.wb.temp >= 1000 ? 'raw' : 'display'
}

/**
 * Paste the clipboard's parts onto a photo. White balance only carries over
 * between photos of the same kind, except "As shot", which means each
 * photo's own camera white balance.
 */
export function pasteOnto(target: Target, clip: Clipboard): EditRecipe {
  const raw = (clip.recipe ?? {}) as Partial<EditRecipe>
  const srcKind = raw.wb && typeof raw.wb.temp === 'number' ? kindOfRecipe(raw as EditRecipe) : target.kind
  const src = normalizeRecipe(raw, srcKind)
  const next: EditRecipe = { ...target.recipe }
  const write = next as unknown as Record<RecipePart, unknown>
  for (const part of clip.parts) {
    if (!(ALL_PARTS as readonly string[]).includes(part)) continue
    if (part === 'wb') {
      if (src.wb.preset === 'asShot') next.wb = defaultRecipe(target.kind, target.raw?.asShot).wb
      else if (srcKind === target.kind) next.wb = { ...src.wb }
      continue
    }
    // AI masks and removals were computed for the photo they came from: blank them to recompute here.
    const value = part === 'layers' || part === 'retouch' ? blankRasters({ [part]: src[part] })[part] : src[part as RecipePart]
    write[part as RecipePart] = structuredClone(value)
  }
  // The look describes the tone settings, so it travels with them (not with a crop-only paste).
  if (clip.parts.some((p) => p !== 'geometry' && p !== 'retouch' && (ALL_PARTS as readonly string[]).includes(p))) next.look = src.look ? { ...src.look } : undefined
  return next
}

export function resetRecipe(target: Pick<PhotoRecord, 'kind' | 'raw'>): EditRecipe {
  return defaultRecipe(target.kind, target.raw?.asShot)
}

export function isEdited(target: Pick<PhotoRecord, 'kind' | 'raw'>, recipe: EditRecipe): boolean {
  return !isUnedited(recipe, target.kind, target.raw?.asShot)
}
