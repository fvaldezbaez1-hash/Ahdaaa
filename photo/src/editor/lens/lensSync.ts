import { useEffect, useSyncExternalStore } from 'react'
import type { EditRecipe } from '../../edit/types'
import type { PhotoRecord } from '../../io/types'
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

type Photo = Pick<PhotoRecord, 'meta' | 'width' | 'height'>

/** The photo's camera and its best lens match (null if the database doesn't know them). */
async function detect(photo: Photo): Promise<{ m: LensModule; camera: CameraInfo | null; best: (LensInfo & { guessed: boolean }) | null }> {
  const m = await loadLens()
  const camera = await m.findCamera(photo.meta)
  const best = (await m.findLens(photo.meta, { camera }))[0] ?? null
  return { m, camera, best }
}

function resolve(photo: Photo, m: LensModule, camera: CameraInfo | null, lensId: string) {
  const { meta, width, height } = photo
  return m.resolveLens(lensId, meta.focalLength ?? 0, meta.aperture ?? 0, undefined, { cropFactor: camera?.cropFactor, width, height })
}

/**
 * For the library (a batch paste, exporting a photo never opened in the editor): the recipe
 * with its lens profile found when it asks for one (see needsResolve), else unchanged.
 */
export async function resolveRecipeLens(photo: Photo, r: EditRecipe): Promise<EditRecipe> {
  if (!needsResolve(r)) return r
  const { m, camera, best } = await detect(photo)
  const id = r.lens.profileId || best?.id
  return withProfile(r, id ? await resolve(photo, m, camera, id) : null)
}

const still = (session: Session) => editor.getState().photoId === session.id

// Lens settings a resolve already ran for (found or not), so "nothing found" doesn't retry in a loop.
const tried = new WeakSet<object>()
let busy = 0

/** Turn profile corrections on: find the lens (unless `lensId` is given), resolve it, one undo step. */
export async function enableProfile(session: Session, lensId?: string, label?: string) {
  set({ ...status, state: 'looking' })
  busy++
  try {
    const { m, camera, best } = await detect(session.record)
    const id = lensId || editor.getState().recipe?.lens.profileId || best?.id
    const resolved = id ? await resolve(session.record, m, camera, id) : null
    if (!still(session)) return
    const lens = resolved?.lens ?? null
    editor.apply((r) => withProfile(r, resolved), label ?? (lens ? `Lens profile: ${lens.model}` : 'Lens profile on'))
    const now = editor.getState().recipe
    if (now) tried.add(now.lens)
    set({ state: 'ready', camera, lens, guessed: !lensId && !!best?.guessed && lens?.id === best?.id })
  } catch (e) {
    set({ state: 'error', message: (e as Error).message })
  } finally {
    busy--
  }
}

/** Resolve when the recipe asks for it (opened or pasted with profiles on), once per lens setting. */
function maybeResolve(session: Session) {
  const r = editor.getState().recipe
  if (!r || busy || !still(session) || !needsResolve(r) || tried.has(r.lens)) return
  tried.add(r.lens)
  void enableProfile(session, r.lens.profileId || undefined, 'Lens profile found')
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
    const unsubscribe = editor.subscribe(() => maybeResolve(session))
    if (needsResolve(r)) maybeResolve(session)
    // Profiles off: look the lens up only when the panel asks (see lookUp), not on every open.
    else if (r.lens.enabled)
      void loadLens()
        .then(async (m) => {
          const camera = await m.findCamera(session.record.meta)
          const lens = (await m.lensInfo(r.lens.profileId)) ?? null
          if (still(session)) set({ state: 'ready', camera, lens, guessed: false })
        })
        .catch((e: Error) => set({ state: 'error', message: e.message }))
    return () => void unsubscribe()
  }, [session])
}

/** The Lens panel opened with profiles off: say which lens would be used. */
export function lookUp(session: Session) {
  if (status.state !== 'idle') return
  set({ state: 'looking' })
  void detect(session.record)
    .then(({ camera, best }) => still(session) && set({ state: 'ready', camera, lens: best, guessed: !!best?.guessed }))
    .catch((e: Error) => set({ state: 'error', message: e.message }))
}

/** "Canon EOS 5D Mark II", not "Canon Canon EOS 5D Mark II" (lenses and cameras alike). */
export const lensName = (l: { maker: string; model: string }) => (l.model.toLowerCase().startsWith(l.maker.toLowerCase()) ? l.model : `${l.maker} ${l.model}`.trim())
