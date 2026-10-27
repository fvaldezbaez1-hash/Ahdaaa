import { db, TABLES, type TableName } from './db'
import type { Exercise, Photo, Workout } from './types'

export interface Backup {
  app: 'forge'
  version: 1
  exportedAt: number
  tables: Partial<Record<TableName, unknown[]>>
}

type StoredPhoto = Omit<Photo, 'blob'> & { blob: string }

async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

function dataUrlToBlob(url: string): Blob {
  const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s)
  if (!m) throw new Error('Bad photo data in backup.')
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: m[1] })
}

export async function makeBackup(opts: { photos: boolean }): Promise<Backup> {
  const tables: Backup['tables'] = {}
  for (const t of TABLES) {
    if (t === 'photos') {
      if (!opts.photos) continue
      const photos = await db.photos.toArray()
      tables.photos = await Promise.all(photos.map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob) })))
    } else {
      tables[t] = await db.table(t).toArray()
    }
  }
  return { app: 'forge', version: 1, exportedAt: Date.now(), tables }
}

/** Replaces everything on this phone with the backup's contents. */
export async function restoreBackup(raw: unknown): Promise<void> {
  const data = raw as Partial<Backup>
  if (!data || data.app !== 'forge' || typeof data.tables !== 'object' || data.tables === null)
    throw new Error('That file isn’t a Forge backup.')
  if ((data.version ?? 0) > 1) throw new Error('This backup is from a newer version of Forge. Update the app first.')
  const tables = data.tables
  const photos = tables.photos ? (tables.photos as StoredPhoto[]).map((p) => ({ ...p, blob: dataUrlToBlob(p.blob) })) : undefined

  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      // A backup made without photos leaves the photos already on the phone alone.
      if (t === 'photos' && !photos) continue
      await db.table(t).clear()
      const rows = t === 'photos' ? photos! : tables[t]
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkPut(rows)
    }
  })
}

/** Adds imported workouts, skipping any that are already here. */
export async function addImportedWorkouts(workouts: Workout[], newExercises: Exercise[]): Promise<{ added: number; skipped: number }> {
  return db.transaction('rw', db.workouts, db.exercises, async () => {
    const existing = await db.workouts.toArray()
    const isDup = (w: Workout) => existing.some((e) => e.name === w.name && Math.abs(e.start - w.start) < 60_000)
    const fresh = workouts.filter((w) => !isDup(w))
    const used = new Set(fresh.flatMap((w) => w.exercises.map((e) => e.exerciseId)))
    await db.exercises.bulkPut(newExercises.filter((e) => used.has(e.id)))
    await db.workouts.bulkPut(fresh)
    return { added: fresh.length, skipped: workouts.length - fresh.length }
  })
}
