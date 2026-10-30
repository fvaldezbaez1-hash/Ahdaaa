import type { EditRecipe } from './types'

// Read/write recipe fields by dotted path ("basic.exposure", "mixer.sat.blue").
// Used by sliders, presets and the AI assistant's tools.

export function getPath(r: EditRecipe, path: string): unknown {
  let cur: unknown = r
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Immutable set: returns a new recipe with only the objects along the path copied. */
export function setPath(r: EditRecipe, path: string, value: unknown): EditRecipe {
  const keys = path.split('.')
  const write = (obj: unknown, i: number): unknown => {
    const base = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>
    const copy: Record<string, unknown> = Array.isArray(base) ? ([...base] as unknown as Record<string, unknown>) : { ...base }
    copy[keys[i]] = i === keys.length - 1 ? value : write(base[keys[i]], i + 1)
    return copy
  }
  return write(r, 0) as EditRecipe
}

export function getNumber(r: EditRecipe, path: string): number {
  const v = getPath(r, path)
  return typeof v === 'number' ? v : 0
}
