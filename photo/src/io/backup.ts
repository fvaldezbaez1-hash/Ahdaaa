// Backup of everything the user made — recipes, ratings, flags, albums, user
// presets — without the originals. Browsers may evict site data (Safari does
// after weeks without use), so the library offers this file; after re-importing
// the originals, restoring re-attaches each recipe to the photo with the same
// file name, size and capture time.
import { defaultRecipe, isUnedited, normalizeRecipe } from '../edit/defaults'
import { db } from './db'
import type { AlbumRecord, PhotoRecord, UserPresetRecord } from './types'

type BackupPhoto = Omit<PhotoRecord, 'thumbVersion'>

export interface EditsBackup {
  app: 'lumen'
  type: 'edits'
  version: 1
  exportedAt: number
  photos: BackupPhoto[]
  albums: AlbumRecord[]
  presets: UserPresetRecord[]
}

export interface RestoreResult {
  /** Library photos that received edits from the backup. */
  updatedIds: string[]
  /** Backup entries with no matching photo in the library. */
  unmatched: number
  albumsAdded: number
  presetsAdded: number
}

const key = (p: { fileName: string; fileSize: number; takenAt: number }) => `${p.fileName}\u0000${p.fileSize}\u0000${p.takenAt}`

export async function backupEdits(): Promise<string> {
  const [photos, albums, presets] = await Promise.all([db.photos.toArray(), db.albums.toArray(), db.presets.toArray()])
  const backup: EditsBackup = {
    app: 'lumen',
    type: 'edits',
    version: 1,
    exportedAt: Date.now(),
    photos: photos.map(({ thumbVersion: _thumbVersion, ...rest }) => rest),
    albums,
    presets,
  }
  return JSON.stringify(backup)
}

function parse(json: string): EditsBackup {
  let b: Partial<EditsBackup>
  try {
    b = JSON.parse(json)
  } catch {
    throw new Error("This file isn't a Lumen backup.")
  }
  if (b?.app !== 'lumen' || b.type !== 'edits' || !Array.isArray(b.photos)) throw new Error("This file isn't a Lumen backup.")
  if (b.version !== 1) throw new Error('This backup was made by a newer version of Lumen.')
  return { ...b, albums: Array.isArray(b.albums) ? b.albums : [], presets: Array.isArray(b.presets) ? b.presets : [] } as EditsBackup
}

export async function restoreEdits(json: string): Promise<RestoreResult> {
  const b = parse(json)
  return db.transaction('rw', [db.photos, db.albums, db.presets], async () => {
    // Albums: same id → keep ours; same name → merge into ours; otherwise recreate.
    const albumMap = new Map<string, string>()
    let albumsAdded = 0
    const ours = await db.albums.toArray()
    for (const a of b.albums) {
      const match = ours.find((o) => o.id === a.id) ?? ours.find((o) => o.name === a.name)
      if (match) albumMap.set(a.id, match.id)
      else {
        await db.albums.add({ id: a.id, name: a.name, createdAt: a.createdAt })
        albumMap.set(a.id, a.id)
        albumsAdded++
      }
    }

    let presetsAdded = 0
    for (const p of b.presets) {
      if (p?.id && !(await db.presets.get(p.id))) {
        await db.presets.add(p)
        presetsAdded++
      }
    }

    const library = new Map((await db.photos.toArray()).map((p) => [key(p), p]))
    const updatedIds: string[] = []
    let unmatched = 0
    const covers = new Map<string, string>()
    for (const bp of b.photos) {
      const p = bp && library.get(key(bp))
      if (!p) {
        unmatched++
        continue
      }
      const asShot = p.raw?.asShot
      const recipe = normalizeRecipe(bp.recipe, p.kind, asShot)
      // A recipe from a RAW-developed copy doesn't fit an embedded-preview copy (or vice versa): white balance units differ.
      if (bp.kind !== p.kind) recipe.wb = defaultRecipe(p.kind, asShot).wb
      const albumIds = [...new Set([...p.albumIds, ...(bp.albumIds ?? []).map((id) => albumMap.get(id)).filter((id): id is string => !!id)])]
      await db.photos.update(p.id, {
        recipe,
        rating: bp.rating ?? p.rating,
        flag: bp.flag ?? p.flag,
        albumIds,
        edited: !isUnedited(recipe, p.kind, asShot),
        editedAt: bp.editedAt ?? p.editedAt,
      })
      updatedIds.push(p.id)
      for (const a of b.albums) if (a.coverId === bp.id && albumMap.has(a.id)) covers.set(albumMap.get(a.id)!, p.id)
    }
    for (const [albumId, photoId] of covers) {
      const a = await db.albums.get(albumId)
      if (a && !a.coverId) await db.albums.update(albumId, { coverId: photoId })
    }
    return { updatedIds, unmatched, albumsAdded, presetsAdded }
  })
}
