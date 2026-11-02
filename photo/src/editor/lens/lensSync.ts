import { useEffect, useSyncExternalStore } from 'react'
import { editor } from '../../state/editor'
import type { Session } from '../session'
import { needsResolve, withoutProfile, withProfile } from './lensState'

// Finding the photo's camera and lens in the lens database (loaded on first
// use) and resolving the profile at the photo's focal length and aperture.
// Shown in the Lens panel; a photo with profile corrections on but nothing
// resolved yet (a paste, a new import) is resolved when it opens.

type LensModule = typeof import('../../lens')
type CameraInfo = NonNullable<Awaited<ReturnType<LensModule['findCamera']>>>
export type LensInfo = NonNullable<Awaited<ReturnType<LensModule['lensInfo']>>>

let loading: Promise<LensModule> | null = null
export const loadLens = () => (loading ??= import('../../lens'))

export interface LensStatus {
  state: 'idle' | 'looking' | 'ready' | 'error'
  camera?: CameraInfo | null
  /** The profile in use, or the best match for the photo when profiles are off. */
  lens?: LensInfo | null
  /** Picked from the focal length and aperture (the photo doesn't name its lens). */
  guessed?: boolean
  message?: string
}

let status: LensStatus = { state: 'idle' }
const listeners = new Set<() => void>()
const set = (s: LensStatus) => {
  status = s
  listeners.forEach((l) => l())
}

export function useLensStatus(): LensStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => status,
  )
}

/** The photo's camera and its best lens match (null if the database doesn't know them). */
async function detect(session: Session): Promise<{ m: LensModule; camera: CameraInfo | null; best: (LensInfo & { guessed: boolean }) | null }> {
  const m = await loadLens()
  const camera = await m.findCamera(session.record.meta)
  const best = (await m.findLens(session.record.meta, { camera }))[0] ?? null
  return { m, camera, best }
}

async function resolve(session: Session, m: LensModule, camera: CameraInfo | null, lensId: string) {
  const { meta, width, height } = session.record
  return m.resolveLens(lensId, meta.focalLength ?? 0, meta.aperture ?? 0, undefined, { cropFactor: camera?.cropFactor, width, height })
}

const still = (session: Session) => editor.getState().photoId === session.id

/** Turn profile corrections on: find the lens (unless `lensId` is given), resolve it, one undo step. */
export async function enableProfile(session: Session, lensId?: string, label?: string) {
  set({ ...status, state: 'looking' })
  try {
    const { m, camera, best } = await detect(session)
    const id = lensId ?? editor.getState().recipe?.lens.profileId ?? best?.id
    const resolved = id ? await resolve(session, m, camera, id) : null
    if (!still(session)) return
    const lens = resolved?.lens ?? null
    editor.apply((r) => withProfile(r, resolved), label ?? (lens ? `Lens profile: ${lens.model}` : 'Lens profile on'))
    set({ state: 'ready', camera, lens, guessed: !lensId && !!best?.guessed && lens?.id === best?.id })
  } catch (e) {
    set({ state: 'error', message: (e as Error).message })
  }
}

export function disableProfile() {
  editor.apply(withoutProfile, 'Lens profile off')
}

/** The Lens panel and photo open: show what was found; resolve when the recipe asks for it. */
export function useLensSync(session: Session | null) {
  useEffect(() => {
    if (!session) return
    set({ state: 'idle' })
    const r = editor.getState().recipe
    if (!r) return
    if (needsResolve(r)) {
      void enableProfile(session, r.lens.profileId || undefined, 'Lens profile found')
      return
    }
    // Profiles off: look the lens up only when the panel asks (see lookUp), not on every open.
    if (!r.lens.enabled) return
    void loadLens()
      .then(async (m) => {
        const camera = await m.findCamera(session.record.meta)
        const lens = (await m.lensInfo(r.lens.profileId)) ?? null
        if (still(session)) set({ state: 'ready', camera, lens, guessed: false })
      })
      .catch((e: Error) => set({ state: 'error', message: e.message }))
  }, [session])
}

/** The Lens panel opened with profiles off: say which lens would be used. */
export function lookUp(session: Session) {
  if (status.state !== 'idle') return
  set({ state: 'looking' })
  void detect(session)
    .then(({ camera, best }) => still(session) && set({ state: 'ready', camera, lens: best, guessed: !!best?.guessed }))
    .catch((e: Error) => set({ state: 'error', message: e.message }))
}

export const lensName = (l: { maker: string; model: string }) => (l.model.toLowerCase().startsWith(l.maker.toLowerCase()) ? l.model : `${l.maker} ${l.model}`.trim())
