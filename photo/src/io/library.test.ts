import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import { backupEdits, restoreEdits } from './backup'
import { db } from './db'
import type { DecodeRequest } from './decoder'
import { exportPhotos, sourceEdgeFor } from './export'
import { deletePhotos, importFiles, refreshThumbnail, saveRecipe } from './library'
import type { ExportFile } from './save'
import { seams } from './seams'
import type { DecodedPhoto, PhotoRecord } from './types'

const TAKEN = new Date(2024, 4, 1, 12, 0, 0).getTime()
const decodes: DecodeRequest[] = []

function fakeDecoded(req: DecodeRequest): DecodedPhoto {
  const raw = /\.arw$/i.test(req.fileName)
  const edge = Math.min(req.maxLongEdge ?? 6000, 6000)
  const w = edge, h = Math.round((edge * 2) / 3)
  return {
    image: { width: w, height: h, data: new Uint16Array(3) },
    color: raw ? { kind: 'raw', space: 'camera' } : { kind: 'display', space: 'srgb-linear' },
    fullWidth: 6000,
    fullHeight: 4000,
    meta: /notime/.test(req.fileName) ? { make: 'Test' } : { make: 'Test', takenAt: TAKEN },
    kind: raw ? 'raw' : 'display',
    ...(raw ? { raw: { rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], camXyz: [1, 0, 0, 0, 1, 0, 0, 0, 1], shotMul: [2, 1, 1.5], asShot: { temp: 5123, tint: 7 } } } : {}),
    ...(/broken/.test(req.fileName) ? { previewOnly: true, notice: 'preview only' } : {}),
  }
}

const file = (name: string, size = 1000, lastModified = 1_700_000_000_000) => new File([new Uint8Array(size)], name, { lastModified })

beforeEach(async () => {
  decodes.length = 0
  seams.decode = async (blob, req) => {
    if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (/corrupt/.test(req.fileName)) throw new Error("This RAW format isn't supported yet: .ARW")
    decodes.push({ ...req, signal: undefined })
    expect(blob.size).toBeGreaterThan(0)
    return fakeDecoded(req)
  }
  seams.thumbnail = async (d) => ({ blob: new Blob(['thumb']), width: 512, height: Math.round((512 * d.fullHeight) / d.fullWidth) })
  await Promise.all([db.photos.clear(), db.originals.clear(), db.thumbs.clear(), db.albums.clear(), db.presets.clear()])
})

describe('import', () => {
  it('stores record, original and thumbnail; skips unsupported, failures and duplicates', async () => {
    await db.albums.add({ id: 'al', name: 'Trip', createdAt: 1 })
    const progress: number[] = []
    const r = await importFiles([file('a.ARW'), file('notes.txt'), file('b.jpg'), file('a.ARW'), file('corrupt.ARW'), file('a.ARW', 999)], {
      albumId: 'al',
      onProgress: (p) => progress.push(p.done),
    })
    expect(r.added).toHaveLength(3)
    expect(r.skipped).toEqual([
      { name: 'notes.txt', reason: "This file type isn't supported" },
      { name: 'a.ARW', reason: 'Already in your library' },
      { name: 'corrupt.ARW', reason: "This RAW format isn't supported yet: .ARW" },
    ])
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(decodes.every((d) => d.quality === 'preview' && d.maxLongEdge === 2560)).toBe(true)

    const a = (await db.photos.get(r.added[0]))!
    expect(a).toMatchObject({ fileName: 'a.ARW', kind: 'raw', mime: 'image/x-arw', fileSize: 1000, takenAt: TAKEN, width: 6000, height: 4000, rating: 0, flag: 0, albumIds: ['al'], edited: false, thumbVersion: 1 })
    expect(a.recipe).toEqual(defaultRecipe('raw', { temp: 5123, tint: 7 }))
    expect(a.raw?.asShot).toEqual({ temp: 5123, tint: 7 })
    expect('editedAt' in a).toBe(false)
    expect((await db.originals.get(a.id))!.blob.size).toBe(1000)
    expect(await db.thumbs.get(a.id)).toMatchObject({ width: 512, height: 341 })
    expect((await db.albums.get('al'))!.coverId).toBe(a.id)

    const b = (await db.photos.get(r.added[1]))!
    expect(b).toMatchObject({ kind: 'display', mime: 'image/jpeg' })
    expect(b.raw).toBeUndefined()
  })

  it('falls back to the file date, flags preview-only RAWs and reports notices', async () => {
    const r = await importFiles([file('notime.jpg', 10, 1234), file('broken.ARW')])
    expect((await db.photos.get(r.added[0]))!.takenAt).toBe(1234)
    expect((await db.photos.get(r.added[1]))!.previewOnly).toBe(true)
    expect(r.notices).toEqual([{ name: 'broken.ARW', message: 'preview only' }])
  })

  it('stops between files when aborted', async () => {
    const ac = new AbortController()
    const r = await importFiles([file('1.jpg'), file('2.jpg'), file('3.jpg')], { onProgress: (p) => p.done === 1 && ac.abort(), signal: ac.signal })
    expect(r.added).toHaveLength(1)
  })
})

describe('recipes, thumbnails, deletion', () => {
  it('saveRecipe tracks the edited flag; refreshThumbnail bumps the version', async () => {
    const [id] = (await importFiles([file('a.ARW')])).added
    const rec = (await db.photos.get(id))!
    await saveRecipe(id, { ...rec.recipe, basic: { ...rec.recipe.basic, exposure: 1 } })
    expect((await db.photos.get(id))!).toMatchObject({ edited: true })
    expect((await db.photos.get(id))!.editedAt).toBeGreaterThan(0)
    await saveRecipe(id, rec.recipe)
    expect((await db.photos.get(id))!.edited).toBe(false)

    await Promise.all([refreshThumbnail(id), refreshThumbnail(id), refreshThumbnail(id)])
    expect((await db.photos.get(id))!.thumbVersion).toBe(3) // one render + one coalesced re-run
    expect(decodes.at(-1)).toMatchObject({ quality: 'preview', maxLongEdge: 1024, fullSize: { width: 6000, height: 4000 } })
  })

  it('deletePhotos removes everything and moves album covers', async () => {
    await db.albums.add({ id: 'al', name: 'Trip', createdAt: 1 })
    const [a, b] = (await importFiles([file('a.jpg'), file('b.jpg', 5)], { albumId: 'al' })).added
    expect((await db.albums.get('al'))!.coverId).toBe(a)
    await deletePhotos([a])
    expect(await db.photos.get(a)).toBeUndefined()
    expect(await db.originals.get(a)).toBeUndefined()
    expect(await db.thumbs.get(a)).toBeUndefined()
    expect((await db.albums.get('al'))!.coverId).toBe(b)
    await deletePhotos([b])
    expect((await db.albums.get('al'))!.coverId).toBeUndefined()
  })
})

describe('export plumbing', () => {
  it('decodes only as much as the output needs', () => {
    const p = { width: 6000, height: 4000, recipe: defaultRecipe('raw') } as PhotoRecord
    expect(sourceEdgeFor(p, undefined)).toBeUndefined()
    expect(sourceEdgeFor(p, 2048)).toBe(2048)
    expect(sourceEdgeFor(p, 8000)).toBeUndefined()
    const cropped = { ...p, recipe: { ...p.recipe, geometry: { ...p.recipe.geometry, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } } }
    expect(sourceEdgeFor(cropped, 2048)).toBe(4096)
  })

  it('renders, encodes and names files; failures are collected', async () => {
    const [a, b] = (await importFiles([file('IMG_1.ARW'), file('IMG_1.jpg')])).added
    const out: ExportFile[] = []
    seams.sink = { write: async (f) => void out.push(f), finish: async () => undefined }
    seams.render = async (_r, d, o) => {
      if (d.kind === 'display') throw new Error('GPU lost')
      expect(o).toMatchObject({ maxLongEdge: 2048, bitDepth: 8, colorSpace: 'display-p3' })
      return { width: 2048, height: 1365, data: new Uint8ClampedArray(2048 * 1365 * 4), bitDepth: 8, colorSpace: 'display-p3' }
    }
    seams.encode = async (args) => {
      expect(args.exif?.includeGps).toBe(false)
      expect(args.exif?.meta.make).toBe('Test')
      return new Blob([args.format])
    }
    const progress: number[] = []
    const r = await exportPhotos([a, b, 'missing'], { format: 'jpeg', quality: 90, longEdge: 2048, colorSpace: 'display-p3', keepMetadata: true, stripLocation: true }, (p) => progress.push(p.done + p.fraction))
    seams.sink = null
    expect(r).toEqual({ saved: 1, failed: [{ name: 'IMG_1.jpg', reason: 'GPU lost' }] })
    expect(out.map((f) => f.name)).toEqual(['IMG_1-lumen.jpg'])
    expect(decodes.at(-2)).toMatchObject({ quality: 'full', maxLongEdge: 2048 })
    expect(progress.at(-1)).toBe(3)
  })
})

describe('backup', () => {
  it('restores recipes, ratings and albums onto re-imported photos', async () => {
    await db.albums.add({ id: 'al', name: 'Trip', createdAt: 1, coverId: 'x' })
    await db.presets.add({ id: 'p1', name: 'Mine', collection: 'mine', data: {}, source: 'user', createdAt: 1 })
    const [id] = (await importFiles([file('a.ARW')], { albumId: 'al' })).added
    await db.albums.update('al', { coverId: id })
    const rec = (await db.photos.get(id))!
    await saveRecipe(id, { ...rec.recipe, basic: { ...rec.recipe.basic, contrast: 30 } })
    await db.photos.update(id, { rating: 4, flag: 1 })
    const json = await backupEdits()

    // Storage evicted, originals re-imported.
    await Promise.all([db.photos.clear(), db.originals.clear(), db.thumbs.clear(), db.albums.clear(), db.presets.clear()])
    const [fresh] = (await importFiles([file('a.ARW'), file('other.jpg')])).added
    const r = await restoreEdits(json)
    expect(r).toEqual({ updatedIds: [fresh], unmatched: 0, albumsAdded: 1, presetsAdded: 1 })
    const p = (await db.photos.get(fresh))!
    expect(p).toMatchObject({ rating: 4, flag: 1, edited: true, albumIds: ['al'] })
    expect(p.recipe.basic.contrast).toBe(30)
    expect((await db.albums.get('al'))!.coverId).toBe(fresh)
    await expect(restoreEdits('{"app":"other"}')).rejects.toThrow("isn't a Lumen backup")
  })
})
