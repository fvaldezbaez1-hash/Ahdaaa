import { useEffect } from 'react'
import { refreshThumbnail, saveRecipe } from '../io/api'
import { editor } from '../state/editor'
import { toast } from '../ui/toast'

// Saves the recipe ~400 ms after the last committed change and re-renders the
// library thumbnail ~1.5 s after it; both flush when the editor closes or the
// app goes to the background.

const SAVE_MS = 400
const THUMB_MS = 1500

/** JSON of the recipe last written for each photo (so reopening can tell whether it changed elsewhere). */
export const lastSaved = new Map<string, string>()

let warned = false

export function usePersistence(id: string, active: boolean) {
  useEffect(() => {
    if (!active) return
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let thumbTimer: ReturnType<typeof setTimeout> | undefined
    let thumbDue = false
    let version = editor.getState().version

    const save = async () => {
      clearTimeout(saveTimer)
      const { photoId, recipe } = editor.getState()
      if (photoId !== id || !recipe) return
      const json = JSON.stringify(recipe)
      if (json === lastSaved.get(id)) return
      lastSaved.set(id, json)
      thumbDue = true
      try {
        await saveRecipe(id, recipe)
      } catch {
        lastSaved.delete(id)
        if (!warned) toast('Couldn’t save your edit. Check the free space on this device.', 5000)
        warned = true
      }
    }
    const thumb = async () => {
      clearTimeout(thumbTimer)
      await save()
      if (!thumbDue) return
      thumbDue = false
      void refreshThumbnail(id).catch(() => undefined)
    }
    const flush = () => void thumb()

    const unsubscribe = editor.subscribe(() => {
      const s = editor.getState()
      if (s.version === version || s.photoId !== id) return
      version = s.version
      clearTimeout(saveTimer)
      clearTimeout(thumbTimer)
      saveTimer = setTimeout(() => void save(), SAVE_MS)
      thumbTimer = setTimeout(flush, THUMB_MS)
    })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    // A recipe that differs from the stored one (kept in memory from earlier) is saved right away.
    saveTimer = setTimeout(() => void save(), SAVE_MS)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [id, active])
}
