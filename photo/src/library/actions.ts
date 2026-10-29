// Library actions that change the database. Ratings, flags and albums are
// plain field updates; recipe changes go out in one transaction so batch edits
// on thousands of photos stay quick, then thumbnails re-render in the background.
import type { EditRecipe, Preset, Variation } from '../edit/types'
import { deletePhotos, refreshThumbnail } from '../io/api'
import { db, uid } from '../io/db'
import type { PhotoRecord } from '../io/types'
import { applyPreset } from '../presets/catalog'
import { loadSettings, updateSettings } from '../state/settings'
import { toast } from '../ui/toast'
import { isEdited, makeClipboard, pasteOnto, resetRecipe, type Clipboard } from './edits'
import { plural } from './library'

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Run an action; on failure tell the user instead of throwing. */
export async function attempt<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    toast(`${what}: ${errorMessage(e)}`, 4000)
    return undefined
  }
}

// ---------- Thumbnails ----------

const pendingThumbs = new Set<string>()
let draining = false

/** Re-render thumbnails one at a time so a big batch never blocks editing or scrolling. */
export function queueThumbnails(ids: readonly string[]) {
  ids.forEach((id) => pendingThumbs.add(id))
  if (draining) return
  draining = true
  void (async () => {
    while (pendingThumbs.size) {
      const id = pendingThumbs.values().next().value as string
      pendingThumbs.delete(id)
      // Failure (photo deleted meanwhile, renderer unavailable) leaves the previous thumbnail.
      await refreshThumbnail(id).catch(() => {})
    }
    draining = false
  })()
}

// ---------- Ratings, flags ----------

export const setRating = (ids: readonly string[], rating: number) =>
  attempt("Couldn't rate", () => db.photos.where(':id').anyOf(ids).modify({ rating }))

export const setFlag = (ids: readonly string[], flag: -1 | 0 | 1) =>
  attempt("Couldn't flag", () => db.photos.where(':id').anyOf(ids).modify({ flag }))

// ---------- Recipes ----------

export async function updateRecipes(ids: readonly string[], change: (p: PhotoRecord) => EditRecipe): Promise<boolean> {
  const ok = await attempt("Couldn't save edits", () =>
    db.transaction('rw', db.photos, async () => {
      const now = Date.now()
      const photos = (await db.photos.bulkGet([...ids])).filter((p): p is PhotoRecord => !!p)
      await db.photos.bulkPut(
        photos.map((p) => {
          const recipe = change(p)
          return { ...p, recipe, edited: isEdited(p, recipe), editedAt: now }
        }),
      )
      return true
    }),
  )
  if (ok) queueThumbnails(ids)
  return !!ok
}

export async function copyEdits(p: PhotoRecord) {
  await attempt("Couldn't copy", () => updateSettings({ clipboard: makeClipboard(p) }))
  toast(`Copied edits from ${p.fileName}`)
}

export async function pasteEdits(ids: readonly string[]) {
  const clip = (await loadSettings()).clipboard as Clipboard | undefined
  if (!clip) {
    toast('Nothing to paste yet. Copy a photo’s edits first.')
    return
  }
  if (await updateRecipes(ids, (p) => pasteOnto(p, clip))) toast(`Pasted edits onto ${plural(ids.length, 'photo')}`)
}

export async function resetEdits(ids: readonly string[]) {
  if (await updateRecipes(ids, resetRecipe)) toast(`Reset ${plural(ids.length, 'photo')} to as shot`)
}

export async function applyPresetTo(ids: readonly string[], preset: Preset, amount: number, variation: Variation) {
  if (await updateRecipes(ids, (p) => applyPreset(p.recipe, preset, amount, variation, p.kind))) toast(`Applied ${preset.name} to ${plural(ids.length, 'photo')}`)
}

// ---------- Albums ----------

export async function createAlbum(name: string, photoIds: readonly string[] = []): Promise<string | undefined> {
  const id = uid()
  const ok = await attempt("Couldn't create the album", async () => {
    await db.albums.add({ id, name: name.trim() || 'Untitled album', createdAt: Date.now() })
    if (photoIds.length) await addToAlbum(photoIds, id)
    return true
  })
  return ok ? id : undefined
}

export const addToAlbum = (ids: readonly string[], albumId: string) =>
  attempt("Couldn't add to the album", () =>
    db.photos.where(':id').anyOf(ids).modify((p) => {
      if (!p.albumIds.includes(albumId)) p.albumIds = [...p.albumIds, albumId]
    }),
  )

export const removeFromAlbum = (ids: readonly string[], albumId: string) =>
  attempt("Couldn't remove from the album", () =>
    db.photos.where(':id').anyOf(ids).modify((p) => {
      p.albumIds = p.albumIds.filter((a) => a !== albumId)
    }),
  )

export const renameAlbum = (id: string, name: string) => attempt("Couldn't rename the album", () => db.albums.update(id, { name: name.trim() || 'Untitled album' }))

/** Removes the album only; its photos stay in the library. */
export const deleteAlbum = (id: string) =>
  attempt("Couldn't delete the album", () =>
    db.transaction('rw', db.albums, db.photos, async () => {
      await db.albums.delete(id)
      await db.photos.where('albumIds').equals(id).modify((p) => {
        p.albumIds = p.albumIds.filter((a) => a !== id)
      })
    }),
  )

// ---------- Delete ----------

export async function removePhotos(ids: readonly string[]): Promise<boolean> {
  const ok = await attempt("Couldn't delete", async () => {
    await deletePhotos([...ids])
    return true
  })
  if (ok) toast(`Deleted ${plural(ids.length, 'photo')}`)
  return !!ok
}
