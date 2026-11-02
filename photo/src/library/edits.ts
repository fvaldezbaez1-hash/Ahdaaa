// Copy / paste / reset of edit recipes between photos (pure).
import { defaultRecipe, isUnedited, normalizeRecipe } from '../edit/defaults'
import { blankRasters } from '../editor/ai/refs'
import { blankProfile } from '../editor/lens/lensState'
import type { EditRecipe, SourceKind } from '../edit/types'
import type { PhotoRecord } from '../io/types'

/**
 * Top-level recipe keys, plus 'transform' (geometry.perspective). 'geometry' is the crop, rotation and
 * straighten only; lens distortion travels with 'lens' and perspective with 'transform'.
 */
export type RecipePart = Exclude<keyof EditRecipe, 'v' | 'look'> | 'transform'

export const ALL_PARTS: readonly RecipePart[] = ['profile', 'treatment', 'wb', 'basic', 'curve', 'levels', 'mixer', 'colorEditor', 'grading', 'detail', 'effects', 'lens', 'transform', 'geometry', 'layers', 'retouch']
/** What Copy/Paste carries by default: everything except what belongs to each frame (crop, perspective, healing). */
export const DEFAULT_PARTS: readonly RecipePart[] = ALL_PARTS.filter((p) => p !== 'geometry' && p !== 'retouch' && p !== 'transform')
const FRAME_PARTS: readonly string[] = ['geometry', 'retouch', 'transform']

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
  const write = next as unknown as Record<string, unknown>
  for (const part of clip.parts as RecipePart[]) {
    if (!ALL_PARTS.includes(part)) continue
    if (part === 'wb') {
      if (src.wb.preset === 'asShot') next.wb = defaultRecipe(target.kind, target.raw?.asShot).wb
      else if (srcKind === target.kind) next.wb = { ...src.wb }
      continue
    }
    if (part === 'transform') {
      next.geometry = { ...next.geometry, perspective: structuredClone(src.geometry.perspective) }
      continue
    }
    if (part === 'geometry') {
      next.geometry = { ...structuredClone(src.geometry), lens: next.geometry.lens, perspective: next.geometry.perspective }
      continue
    }
    if (part === 'lens') {
      // A lens profile is found per photo (its lens and focal length): keep the choices, find it again there.
      const pasted = blankProfile({ lens: src.lens, geometry: src.geometry })
      next.lens = structuredClone(pasted.lens)
      next.geometry = { ...next.geometry, lens: structuredClone(pasted.geometry.lens) }
      continue
    }
    // AI masks and removals were computed for the photo they came from: blank them to recompute here.
    const value = part === 'layers' || part === 'retouch' ? blankRasters({ [part]: src[part] })[part] : src[part]
    write[part] = structuredClone(value)
  }
  // The look describes the tone settings, so it travels with them (not with a crop-only paste).
  if (clip.parts.some((p) => !FRAME_PARTS.includes(p) && (ALL_PARTS as readonly string[]).includes(p))) next.look = src.look ? { ...src.look } : undefined
  return next
}

export function resetRecipe(target: Pick<PhotoRecord, 'kind' | 'raw'>): EditRecipe {
  return defaultRecipe(target.kind, target.raw?.asShot)
}

export function isEdited(target: Pick<PhotoRecord, 'kind' | 'raw'>, recipe: EditRecipe): boolean {
  return !isUnedited(recipe, target.kind, target.raw?.asShot)
}
