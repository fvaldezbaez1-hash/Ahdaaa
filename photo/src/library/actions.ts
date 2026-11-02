// Library actions that change the database. Ratings, flags and albums are
// plain field updates; recipe changes go out in one transaction so batch edits
// on thousands of photos stay quick, then thumbnails re-render in the background.
import type { EditRecipe, Preset, Variation } from '../edit/types'
import { deletePhotos, refreshThumbnail } from '../io/api'
import { db, uid } from '../io/db'
import type { PhotoRecord } from '../io/types'
import { applyPreset } from '../presets/catalog'
import { loadSettings, updateSettings } from '../state/settings'
import { photoKey, stampAlbum, stampPhotos, tombstone } from '../sync/stamps'
import { toast } from '../ui/toast'
import { isEdited, makeClipboard, pasteOnto, resetRecipe, type Clipboard } from './edits'
import { addKeywords, hasKeyword, removeKeywords } from './keywords'
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

/** Change photo info (rating, flag, keywords, albums) and stamp it for sync, in one transaction. */
const changeInfo = (ids: readonly string[], change: (p: PhotoRecord) => void) =>
  db.transaction('rw', db.photos, db.syncStamps, async () => {
    await db.photos.where(':id').anyOf(ids).modify(change)
    await stampPhotos(ids)
  })

export const setRating = (ids: readonly string[], rating: number) =>
  attempt("Couldn't rate", () =>
    changeInfo(ids, (p) => {
      p.rating = rating
    }),
  )

export const setFlag = (ids: readonly string[], flag: -1 | 0 | 1) =>
  attempt("Couldn't flag", () =>
    changeInfo(ids, (p) => {
      p.flag = flag
    }),
  )

// ---------- Keywords ----------

export const addKeywordsTo = (ids: readonly string[], words: readonly string[]) =>
  attempt("Couldn't add the keyword", () =>
    changeInfo(ids, (p) => {
      p.keywords = addKeywords(p.keywords, words)
    }),
  )

export const removeKeywordsFrom = (ids: readonly string[], words: readonly string[]) =>
  attempt("Couldn't remove the keyword", () =>
    changeInfo(ids, (p) => {
      const next = removeKeywords(p.keywords, words)
      if (next.length) p.keywords = next
      else delete p.keywords
    }),
  )

/** Every photo with `from` gets `to` instead (merging into `to` if it already has it). */
export async function renameKeyword(from: string, to: string) {
  const ids = (await db.photos.filter((p) => hasKeyword(p.keywords, from)).primaryKeys()) as string[]
  await attempt("Couldn't rename the keyword", () =>
    changeInfo(ids, (p) => {
      const at = (p.keywords ?? []).findIndex((k) => hasKeyword([k], from))
      const rest = removeKeywords(p.keywords, [from])
      p.keywords = hasKeyword(rest, to) ? rest : addKeywords([], [...rest.slice(0, at), to, ...rest.slice(at)])
    }),
  )
  return ids.length
}

export async function deleteKeyword(word: string) {
  const ids = (await db.photos.filter((p) => hasKeyword(p.keywords, word)).primaryKeys()) as string[]
  await removeKeywordsFrom(ids, [word])
  return ids.length
}

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
  if (!(await updateRecipes(ids, (p) => pasteOnto(p, clip)))) return
  toast(`Pasted edits onto ${plural(ids.length, 'photo')}`)
  await resolvePastedLenses(ids)
}

/**
 * Pasted lens corrections keep their amounts but not the source photo's profile: look up each
 * photo's own lens (from its camera data) now, so thumbnails and exports don't wait for the editor.
 */
async function resolvePastedLenses(ids: readonly string[]) {
  const { needsResolve } = await import('../editor/lens/lensState')
  const todo = (await db.photos.bulkGet([...ids])).filter((p): p is PhotoRecord => !!p && needsResolve(p.recipe))
  if (!todo.length) return
  const { resolveRecipeLens } = await import('../editor/lens/lensSync')
  const resolved = new Map<string, EditRecipe>()
  for (const p of todo) resolved.set(p.id, await resolveRecipeLens(p, p.recipe).catch(() => p.recipe))
  await updateRecipes([...resolved.keys()], (p) => resolved.get(p.id) ?? p.recipe)
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
    await db.transaction('rw', db.albums, db.syncStamps, async () => {
      await db.albums.add({ id, name: name.trim() || 'Untitled album', createdAt: Date.now() })
      await stampAlbum(id)
    })
    if (photoIds.length) await addToAlbum(photoIds, id)
    return true
  })
  return ok ? id : undefined
}

export const addToAlbum = (ids: readonly string[], albumId: string) =>
  attempt("Couldn't add to the album", () =>
    changeInfo(ids, (p) => {
      if (!p.albumIds.includes(albumId)) p.albumIds = [...p.albumIds, albumId]
    }),
  )

export const removeFromAlbum = (ids: readonly string[], albumId: string) =>
  attempt("Couldn't remove from the album", () =>
    changeInfo(ids, (p) => {
      p.albumIds = p.albumIds.filter((a) => a !== albumId)
    }),
  )

export const renameAlbum = (id: string, name: string) =>
  attempt("Couldn't rename the album", () =>
    db.transaction('rw', db.albums, db.syncStamps, async () => {
      await db.albums.update(id, { name: name.trim() || 'Untitled album' })
      await stampAlbum(id)
    }),
  )

/** Removes the album only; its photos stay in the library. */
export const deleteAlbum = (id: string) =>
  attempt("Couldn't delete the album", () =>
    db.transaction('rw', [db.albums, db.photos, db.syncStamps, db.tombstones], async () => {
      await db.albums.delete(id)
      await db.syncStamps.delete(`a:${id}`)
      await tombstone('album', [id])
      const ids = (await db.photos.where('albumIds').equals(id).primaryKeys()) as string[]
      await changeInfo(ids, (p) => {
        p.albumIds = p.albumIds.filter((a) => a !== id)
      })
    }),
  )

// ---------- Delete ----------

export async function removePhotos(ids: readonly string[]): Promise<boolean> {
  const ok = await attempt("Couldn't delete", async () => {
    // Remember what went, so syncing deletes it on other devices instead of bringing it back.
    const photos = (await db.photos.bulkGet([...ids])).filter((p): p is PhotoRecord => !!p)
    await db.transaction('rw', db.tombstones, db.syncStamps, async () => {
      await tombstone('photo', photos.map(photoKey))
      await db.syncStamps.bulkDelete(ids.map((id) => `p:${id}`))
    })
    await deletePhotos([...ids])
    return true
  })
  if (ok) toast(`Deleted ${plural(ids.length, 'photo')}`)
  return !!ok
}
