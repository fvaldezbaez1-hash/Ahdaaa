import { useMemo, useState } from 'react'
import { defaultRecipe } from '../../edit/defaults'
import type { EditRecipe } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { LIGHT_KEYS, PRESENCE_KEYS } from '../math/paste'

// The adjustment groups shown as panel sections: how to tell they changed
// and how to reset just them.

export type PartId = 'wb' | 'light' | 'presence' | 'texture' | 'vibrance' | 'curve' | 'mixer' | 'grading' | 'detail' | 'effects'

/** Structural equality for recipe pieces (plain numbers, strings, arrays, objects). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const pickBasic = (keys: readonly string[]) => ({
  changed: (r: EditRecipe, d: EditRecipe) => keys.some((k) => r.basic[k as keyof EditRecipe['basic']] !== d.basic[k as keyof EditRecipe['basic']]),
  reset: (r: EditRecipe, d: EditRecipe): EditRecipe => ({ ...r, basic: { ...r.basic, ...Object.fromEntries(keys.map((k) => [k, d.basic[k as keyof EditRecipe['basic']]])) } }),
})

export const PARTS: Record<PartId, { title: string; changed: (r: EditRecipe, d: EditRecipe) => boolean; reset: (r: EditRecipe, d: EditRecipe) => EditRecipe }> = {
  wb: { title: 'White balance', changed: (r, d) => !same(r.wb, d.wb), reset: (r, d) => ({ ...r, wb: d.wb }) },
  light: { title: 'Light', ...pickBasic(LIGHT_KEYS) },
  presence: { title: 'Presence', ...pickBasic(PRESENCE_KEYS) },
  // The phone splits Presence: texture/clarity/dehaze under Effects, vibrance/saturation under Color.
  texture: { title: 'Texture', ...pickBasic(['texture', 'clarity', 'dehaze']) },
  vibrance: { title: 'Vibrance', ...pickBasic(['vibrance', 'saturation']) },
  curve: { title: 'Tone curve', changed: (r, d) => !same(r.curve, d.curve), reset: (r, d) => ({ ...r, curve: d.curve }) },
  mixer: {
    title: 'Color mixer',
    changed: (r, d) => (r.treatment === 'bw' ? !same(r.mixer.bw, d.mixer.bw) : !same({ ...r.mixer, bw: 0 }, { ...d.mixer, bw: 0 })),
    reset: (r, d) => ({ ...r, mixer: r.treatment === 'bw' ? { ...r.mixer, bw: d.mixer.bw } : { ...d.mixer, bw: r.mixer.bw } }),
  },
  grading: { title: 'Color grading', changed: (r, d) => !same(r.grading, d.grading), reset: (r, d) => ({ ...r, grading: d.grading }) },
  detail: { title: 'Detail', changed: (r, d) => !same(r.detail, d.detail), reset: (r, d) => ({ ...r, detail: d.detail }) },
  effects: { title: 'Effects', changed: (r, d) => !same(r.effects, d.effects), reset: (r, d) => ({ ...r, effects: d.effects }) },
}

/** The as-imported recipe of the open photo (what reset goes back to). */
export function useDefaults(): EditRecipe {
  const kind = useEditor((s) => s.kind)
  const asShot = useEditor((s) => s.asShot)
  return useMemo(() => defaultRecipe(kind, asShot), [kind, asShot])
}

export function usePartChanged(ids: PartId[]): boolean {
  const d = useDefaults()
  return useEditor((s) => !!s.recipe && ids.some((id) => PARTS[id].changed(s.recipe!, d)))
}

export function resetParts(ids: PartId[], label: string) {
  const s = editor.getState()
  const d = defaultRecipe(s.kind, s.asShot)
  editor.apply((r) => ids.reduce((acc, id) => PARTS[id].reset(acc, d), r), label)
}

const OPEN_KEY = 'lumen.editor.sections'
const DEFAULT_OPEN: Record<string, boolean> = { wb: true, light: true, presence: true }

function readOpen(): Record<string, boolean> {
  try {
    return { ...DEFAULT_OPEN, ...JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_OPEN }
  }
}

/** Collapsible section state, remembered on this device. */
export function useSectionOpen(id: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => !!readOpen()[id])
  return [
    open,
    (next: boolean) => {
      setOpen(next)
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: next }))
      } catch {
        // Private mode: the section just won't remember.
      }
    },
  ]
}
