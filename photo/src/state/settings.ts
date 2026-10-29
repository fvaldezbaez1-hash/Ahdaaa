import { useLiveQuery } from 'dexie-react-hooks'
import { db, kvGet, kvSet } from '../io/db'
import type { ExportOptions } from '../io/types'

export type AiProvider = 'openai' | 'google' | 'anthropic'

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  ai: {
    enabled: boolean
    provider: AiProvider
    /** API keys the user pasted in. Stored only on this device. */
    keys: Partial<Record<AiProvider, string>>
    /** Optional model override per provider (otherwise the adapter's default). */
    models: Partial<Record<AiProvider, string>>
  }
  export: ExportOptions
  favoritePresets: string[]
  /** Copied settings for "paste edits". */
  clipboard?: { recipe: unknown; parts: string[]; at: number }
  onboarded: boolean
}

export function defaultSettings(): Settings {
  return {
    theme: 'dark',
    ai: { enabled: true, provider: 'openai', keys: {}, models: {} },
    export: { format: 'jpeg', quality: 92, colorSpace: 'srgb', keepMetadata: true, stripLocation: true },
    favoritePresets: [],
    onboarded: false,
  }
}

const KEY = 'settings'

export async function loadSettings(): Promise<Settings> {
  const s = await kvGet<Partial<Settings>>(KEY)
  const d = defaultSettings()
  return { ...d, ...s, ai: { ...d.ai, ...s?.ai }, export: { ...d.export, ...s?.export } }
}

export async function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): Promise<Settings> {
  return db.transaction('rw', db.kv, async () => {
    const cur = await loadSettings()
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    await kvSet(KEY, next)
    return next
  })
}

/** Live settings (undefined while loading). */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => loadSettings(), [])
}
