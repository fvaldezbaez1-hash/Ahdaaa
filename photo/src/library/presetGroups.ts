import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { Preset } from '../edit/types'
import { db } from '../io/db'
import { builtinPresets, collections } from '../presets/catalog'

export interface PresetGroup {
  id: string
  name: string
  presets: Preset[]
}

/** The user's own presets first, then every built-in collection in catalog order. */
export function usePresetGroups(): PresetGroup[] {
  const mine = useLiveQuery(() => db.presets.orderBy('createdAt').reverse().toArray(), [])
  const builtin = useMemo(() => {
    const byId = new Map(builtinPresets().map((p) => [p.id, p]))
    return collections()
      .map((c) => ({ id: c.id, name: c.name, presets: c.presetIds.map((id) => byId.get(id)).filter((p): p is Preset => !!p) }))
      .filter((g) => g.presets.length > 0)
  }, [])
  return useMemo(() => (mine?.length ? [{ id: 'mine', name: 'Your presets', presets: mine }, ...builtin] : builtin), [mine, builtin])
}
