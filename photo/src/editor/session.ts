import { createContext, useContext, useEffect, useState } from 'react'
import { normalizeRecipe } from '../edit/defaults'
import { createEngine } from '../engine'
import type { Engine } from '../engine/types'
import { loadWorking } from '../io/api'
import { db, kvSet } from '../io/db'
import type { DecodedPhoto, PhotoRecord } from '../io/types'
import { editor } from '../state/editor'
import { lastSaved } from './persistence'
import { view } from './view'

// Opening a photo for editing: its record, the working-size decode, and a
// render engine on a canvas the stage adopts (the canvas outlives layout
// switches, so rotating a tablet doesn't lose the WebGL context).

export interface Session {
  id: string
  record: PhotoRecord
  photo: DecodedPhoto
  engine: Engine
}

export type SessionStatus =
  | { state: 'loading' }
  | { state: 'ready'; session: Session }
  | { state: 'error'; reason: 'missing' | 'unsupported' | 'decode' | 'engine'; message: string }

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside the editor')
  return s
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useEditorSession(id: string): { status: SessionStatus; retry: () => void } {
  const [status, setStatus] = useState<SessionStatus>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let engine: Engine | null = null
    setStatus({ state: 'loading' })
    view.reset()
    const fail = (reason: 'missing' | 'unsupported' | 'decode' | 'engine', message: string) => {
      if (!cancelled) setStatus({ state: 'error', reason, message })
    }
    void (async () => {
      const record = await db.photos.get(id)
      if (cancelled) return
      if (!record) return fail('missing', 'This photo is no longer in your library.')
      try {
        engine = createEngine(document.createElement('canvas'))
      } catch (e) {
        return fail('engine', errorText(e))
      }
      if (!engine.supported) return fail('unsupported', 'Your browser can’t run the editor: it needs WebGL2.')
      let photo: DecodedPhoto
      try {
        photo = await loadWorking(id)
      } catch (e) {
        return fail('decode', errorText(e))
      }
      if (cancelled) return
      engine.setSource(photo.image, photo.color)
      // Coming back to the photo that's still open keeps its undo history, unless it was changed elsewhere meanwhile.
      const s = editor.getState()
      const stored = JSON.stringify(record.recipe)
      if (s.photoId !== id || !s.recipe || lastSaved.get(id) !== stored) {
        editor.open(id, normalizeRecipe(record.recipe, record.kind, record.raw?.asShot), record.kind, record.raw?.asShot)
      }
      lastSaved.set(id, stored)
      void kvSet('lastPhoto', id).catch(() => undefined)
      setStatus({ state: 'ready', session: { id, record, photo, engine } })
    })()
    return () => {
      cancelled = true
      engine?.dispose()
    }
  }, [id, attempt])

  return { status, retry: () => setAttempt((a) => a + 1) }
}
