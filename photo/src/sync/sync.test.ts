import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { db, kvSet } from '../io/db'
import type { PhotoRecord } from '../io/types'
import { addKeywordsTo, createAlbum, removePhotos, setRating } from '../library/actions'
import { parseCatalog } from './catalog'
import { devicePath, memoryFolder, rasterPath } from './folder'
import { exportSyncFile, importSyncFile, syncFolder } from './sync'

// Two (then three) devices taking turns with one sync folder, each with its own library.

const TAKEN = new Date(2025, 5, 1, 10, 0, 0).getTime()
// Toasts go to a window event.
vi.stubGlobal('window', new EventTarget())

function rec(id: string, over: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: 'DSC_0001.jpg',
    kind: 'display',
    mime: 'image/jpeg',
    fileSize: 4242,
    addedAt: Date.now() - 86_400_000,
    takenAt: TAKEN,
    width: 300,
    height: 200,
    meta: {},
    rating: 0,
    flag: 0,
    albumIds: [],
    recipe: defaultRecipe('display'),
    edited: false,
    thumbVersion: 1,
    ...over,
  }
}

async function becomeDevice(id: string) {
  await Promise.all(db.tables.map((t) => t.clear()))
  await kvSet('sync.device', { id, name: `Device ${id}` })
}

const edited = (exposure: number) => ({ ...defaultRecipe('display'), basic: { ...defaultRecipe('display').basic, exposure }, denoise: { amount: 60, raster: 'r1', model: 'test' } })

describe('folder sync between devices', () => {
  const folder = memoryFolder()

  it('carries edits, info, albums, AI results and originals across, and a second sync changes nothing', async () => {
    // Device A edits a photo, rates it, tags it and puts it in an album; it has an AI denoise result.
    await becomeDevice('A')
    await db.photos.add(rec('a1', { recipe: edited(1.5), edited: true, editedAt: Date.now() }))
    await db.originals.add({ id: 'a1', blob: new Blob(['original bytes'], { type: 'image/jpeg' }) })
    await db.rasters.add({ id: 'r1', photoId: 'a1', kind: 'denoise', width: 2, height: 2, channels: 3, depth: 16, codec: 'delta-deflate', data: Uint8Array.of(1, 2, 3), createdAt: 1 })
    await setRating(['a1'], 4)
    await addKeywordsTo(['a1'], ['Lisbon', 'tram'])
    const album = await createAlbum('Portugal', ['a1'])
    let r = await syncFolder(folder, { includeOriginals: true })
    expect(r.devices).toBe(0)
    expect(await folder.exists(devicePath('A'))).toBe(true)
    expect(await folder.exists(rasterPath('r1'))).toBe(true)
    expect([...folder.files.keys()].some((k) => k.startsWith('originals/a1/'))).toBe(true)

    // Device B has the same photo (imported separately: another id), unedited, plus one of its own.
    await becomeDevice('B')
    await db.photos.bulkAdd([rec('b1'), rec('b2', { fileName: 'other.jpg' })])
    r = await syncFolder(folder, { includeOriginals: false })
    expect(r.devices).toBe(1)
    expect(r.result.updated).toBe(1)
    const b1 = (await db.photos.get('b1'))!
    expect([b1.recipe.basic.exposure, b1.rating, b1.keywords, b1.albumIds]).toEqual([1.5, 4, ['Lisbon', 'tram'], [album]])
    expect((await db.albums.get(album!))?.name).toBe('Portugal')
    // The AI result arrived, stored under B's id for the photo.
    expect((await db.rasters.get('r1'))?.photoId).toBe('b1')
    expect(await db.photos.get('b2')).toBeTruthy()

    // Syncing again: nothing to do.
    r = await syncFolder(folder, { includeOriginals: false })
    expect([r.result.updated, r.result.created, r.result.deleted]).toEqual([0, 0, 0])

    // B deletes its own photo; its catalog says so.
    await removePhotos(['b2'])
    await syncFolder(folder, { includeOriginals: false })
    const bCat = parseCatalog(JSON.parse(await (await folder.read(devicePath('B')))!.text()))
    expect(bCat.tombstones.map((t) => t.kind)).toContain('photo')
  })

  it('a new device gets the photos from synced originals, minus what was deleted', async () => {
    await becomeDevice('C')
    // C also had other.jpg (imported before B deleted it): it goes.
    await db.photos.add(rec('c2', { fileName: 'other.jpg', addedAt: Date.now() - 10 * 86_400_000 }))
    const r = await syncFolder(folder, { includeOriginals: false })
    expect(r.devices).toBe(2)
    expect(r.result.created).toBe(1)
    expect(r.result.deleted).toBe(1)
    const photos = await db.photos.toArray()
    expect(photos.map((p) => [p.fileName, p.rating, p.keywords])).toEqual([['DSC_0001.jpg', 4, ['Lisbon', 'tram']]])
    expect(await (await db.originals.get(photos[0].id))!.blob.text()).toBe('original bytes')
    expect(await db.albums.count()).toBe(1)
  })

  it('a sync file merges on a device without the folder (and only once)', async () => {
    const text = await exportSyncFile()
    await becomeDevice('D')
    await db.photos.add(rec('d1'))
    const msg = await importSyncFile(text)
    expect(msg).toMatch(/1 updated/)
    const d1 = (await db.photos.get('d1'))!
    expect([d1.recipe.basic.exposure, d1.rating]).toEqual([1.5, 4])
    // The AI result came inline.
    expect((await db.rasters.get('r1'))?.photoId).toBe('d1')
    expect(await importSyncFile(text)).toMatch(/already in step/)
  })
})
