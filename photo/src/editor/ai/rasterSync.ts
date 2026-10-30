import { useEffect, useSyncExternalStore } from 'react'
import type { RasterImage } from '../../engine/types'
import { editor } from '../../state/editor'
import type { Session } from '../session'
import { stageControl } from '../stage/stageView'
import { ai } from './core'
import { rasterRefs, refChanges } from './refs'

// Keeps the editor's engine supplied with the AI results its recipe refers to:
// handed over when referenced (undo, redo, paste, a new result), dropped when
// not. Stored results that can't be found are "missing" (the UI offers to
// recompute them). Unreferenced results are pruned a while after each change.

const PRUNE_MS = 4000
/** Results this big (an AI-denoised full-resolution copy) aren't kept around once unused. */
const KEEP_BYTES = 32e6

let cache = new Map<string, RasterImage>()
let missing = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** A result just computed: use it without a trip to storage. */
export function provideRaster(id: string, img: RasterImage) {
  cache.set(id, img)
  if (missing.delete(id)) {
    missing = new Set(missing)
    emit()
  }
}

/** Ids the recipe refers to whose stored result is gone. */
export function useMissingRasters(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => missing,
  )
}

export function useRasterSync(session: Session | null) {
  useEffect(() => {
    if (!session) return
    const { engine, id: photoId } = session
    cache = new Map()
    missing = new Set()
    let given = new Set<string>()
    /** Every result referenced this session: undo/redo can bring any of them back. */
    const seen = new Set<string>()
    let alive = true
    let pruneTimer: ReturnType<typeof setTimeout> | undefined
    let version = editor.getState().version

    const hand = (id: string, img: RasterImage | undefined) => {
      if (!alive || !given.has(id)) return
      if (img) {
        cache.set(id, img)
        engine.setRaster?.(id, img)
        stageControl.request()
      } else if (!missing.has(id)) {
        missing = new Set(missing).add(id)
        emit()
      }
    }

    const sync = () => {
      const s = editor.getState()
      if (s.photoId !== photoId || !s.recipe) return
      const refs = rasterRefs(s.recipe)
      refs.forEach((id) => seen.add(id))
      const { added, removed } = refChanges(given, refs)
      given = new Set(refs)
      for (const id of removed) {
        engine.setRaster?.(id, null)
        const img = cache.get(id)
        if (img && img.data.byteLength > KEEP_BYTES) cache.delete(id)
      }
      for (const id of added) {
        const img = cache.get(id)
        if (img) hand(id, img)
        else void ai().then((core) => core.getRaster(id)).then((r) => hand(id, r), () => hand(id, undefined))
      }
      if (s.version !== version) {
        version = s.version
        clearTimeout(pruneTimer)
        pruneTimer = setTimeout(prune, PRUNE_MS)
      }
    }
    const prune = () => void ai().then((core) => core.pruneRasters(photoId, seen)).catch(() => undefined)

    sync()
    const unsubscribe = editor.subscribe(sync)
    return () => {
      alive = false
      unsubscribe()
      clearTimeout(pruneTimer)
      prune()
    }
  }, [session])
}
