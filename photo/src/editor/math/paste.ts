import { normalizeRecipe } from '../../edit/defaults'
import type { EditRecipe } from '../../edit/types'
import type { Clipboard, RecipePart } from '../../library/edits'
import { pasteOnto } from '../../library/edits'
import type { PhotoRecord } from '../../io/types'

// The editor's "Paste settings" groups. They map onto the library's clipboard
// parts (top-level recipe keys), except Light and Presence, which split
// `basic` so either can be pasted alone.

export type PasteGroup = 'look' | 'wb' | 'light' | 'presence' | 'curve' | 'mixer' | 'grading' | 'detail' | 'effects' | 'masks' | 'retouch' | 'crop'

export const PASTE_GROUPS: { id: PasteGroup; label: string }[] = [
  { id: 'look', label: 'Profile & treatment' },
  { id: 'wb', label: 'White balance' },
  { id: 'light', label: 'Light' },
  { id: 'presence', label: 'Presence' },
  { id: 'curve', label: 'Tone curve' },
  { id: 'mixer', label: 'Color mixer' },
  { id: 'grading', label: 'Color grading' },
  { id: 'detail', label: 'Detail' },
  { id: 'effects', label: 'Effects' },
  { id: 'masks', label: 'Masks' },
  { id: 'retouch', label: 'Healing spots' },
  { id: 'crop', label: 'Crop & rotation' },
]

export const LIGHT_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const
export const PRESENCE_KEYS = ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] as const

const DIRECT: Partial<Record<PasteGroup, RecipePart[]>> = {
  look: ['profile', 'treatment'],
  wb: ['wb'],
  curve: ['curve'],
  mixer: ['mixer'],
  grading: ['grading'],
  detail: ['detail'],
  effects: ['effects'],
  masks: ['layers'],
  retouch: ['retouch'],
  crop: ['geometry'],
}

/** Groups to preselect for a clipboard written by the library or the editor. */
export function groupsFromParts(parts: string[]): PasteGroup[] {
  const has = (p: string) => parts.includes(p)
  return PASTE_GROUPS.map((g) => g.id).filter((g) =>
    g === 'light' || g === 'presence' ? has('basic') : (DIRECT[g] ?? []).some(has),
  )
}

/** Library clipboard parts for a set of groups (Light or Presence alone still needs `basic`). */
export function partsFromGroups(groups: PasteGroup[]): RecipePart[] {
  const parts = new Set<RecipePart>()
  for (const g of groups) {
    if (g === 'light' || g === 'presence') parts.add('basic')
    else DIRECT[g]?.forEach((p) => parts.add(p))
  }
  return [...parts]
}

/** Paste the chosen groups of the clipboard onto the photo being edited. */
export function pasteGroups(target: Pick<PhotoRecord, 'recipe' | 'kind' | 'raw'>, clip: Clipboard, groups: PasteGroup[]): EditRecipe {
  const both = groups.includes('light') && groups.includes('presence')
  const parts = partsFromGroups(groups).filter((p) => both || p !== 'basic')
  const next = pasteOnto(target, { ...clip, parts })
  if (both || !(groups.includes('light') || groups.includes('presence'))) return next
  const raw = (clip.recipe ?? {}) as Partial<EditRecipe>
  const src = normalizeRecipe(raw, target.kind).basic
  const keys = groups.includes('light') ? LIGHT_KEYS : PRESENCE_KEYS
  const basic = { ...next.basic }
  for (const k of keys) basic[k] = src[k]
  return { ...next, basic }
}
