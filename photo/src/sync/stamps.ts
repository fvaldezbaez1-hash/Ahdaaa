// When things last changed on this device, for sync's "newest change wins".
// Recipe edits carry their own time (PhotoRecord.editedAt); ratings, flags,
// keywords and album membership are stamped here, as are album names. Deleted
// photos, albums and export presets leave a tombstone so other devices delete
// them too instead of bringing them back.
import { db, type Tombstone } from '../io/db'
import type { PhotoRecord } from '../io/types'

/**
 * Same photo on any device: file name, size and the capture time from its metadata. A photo
 * without one (screenshots, some exports) matches on name and size alone — its fallback
 * time is the file's date, which differs between copies of the same file.
 */
export const photoKey = (p: Pick<PhotoRecord, 'fileName' | 'fileSize'> & { meta?: Pick<PhotoRecord['meta'], 'takenAt'> }) => `${p.fileName}\u0000${p.fileSize}\u0000${p.meta?.takenAt ?? ''}`

export const photoStampId = (id: string) => `p:${id}`
export const albumStampId = (id: string) => `a:${id}`

/** Call inside a transaction that includes db.syncStamps. */
export function stampPhotos(ids: readonly string[], at = Date.now()) {
  return db.syncStamps.bulkPut(ids.map((id) => ({ id: photoStampId(id), at })))
}

export function stampAlbum(id: string, at = Date.now()) {
  return db.syncStamps.put({ id: albumStampId(id), at })
}

export function tombstone(kind: Tombstone['kind'], keys: readonly string[], at = Date.now()) {
  return db.tombstones.bulkPut(keys.map((key) => ({ id: `${kind}:${key}`, kind, key, at })))
}
