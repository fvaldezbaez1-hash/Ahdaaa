import { useLiveQuery } from 'dexie-react-hooks'
import { kvGet, kvSet } from '../io/db'

// Assistant settings that aren't part of the shared Settings shape (yet).

export interface AssistantPrefs {
  /** A relay that forwards to api.openai.com, for when OpenAI blocks browser requests. */
  openaiBaseUrl?: string
}

const KEY = 'assistant.prefs'

export async function loadPrefs(): Promise<AssistantPrefs> {
  return (await kvGet<AssistantPrefs>(KEY)) ?? {}
}

export async function updatePrefs(patch: Partial<AssistantPrefs>): Promise<void> {
  await kvSet(KEY, { ...(await loadPrefs()), ...patch })
}

export function usePrefs(): AssistantPrefs | undefined {
  return useLiveQuery(loadPrefs, [])
}

/** https URL (or http on localhost, for testing a relay), without a trailing slash; undefined if invalid. */
export function cleanRelayUrl(raw: string): string | undefined {
  const t = raw.trim()
  if (!t) return undefined
  try {
    const u = new URL(t)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return undefined
    if (u.username || u.password) return undefined
    return u.href.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}
