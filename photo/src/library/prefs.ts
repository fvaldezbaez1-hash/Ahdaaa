import { useCallback, useState } from 'react'

// Per-device view preferences (sort, filters, thumbnail size). Browser storage
// can be unavailable (private mode), so every access falls back to the default.
const PREFIX = 'lumen.library.'

export function readPref<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const v: unknown = JSON.parse(raw)
    return !valid || valid(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export function usePref<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback, valid))
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(v))
      } catch {
        // Not persisted; the choice still applies for this visit.
      }
    },
    [key],
  )
  return [value, set]
}
