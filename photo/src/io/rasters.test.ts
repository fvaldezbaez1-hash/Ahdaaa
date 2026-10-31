import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import type { EditRecipe } from '../edit/types'
import type { RasterImage } from '../engine/types'
import { db } from './db'
import { deletePhotos } from './library'
import { deleteRasters, getRaster, packRaster, pruneRasters, putRaster, rasterBytes, recipeRasterIds, unpackRaster } from './rasters'

const mask = (w: number, h: number): RasterImage => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x > w / 2 ? 255 : (x * 7 + y) & 0xff
  return { width: w, height: h, channels: 1, data }
}
const fill = (w: number, h: number): RasterImage => {
  const data = new Uint16Array(w * h * 3)
  for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) & 0xffff
  return { width: w, height: h, channels: 3, data }
}

describe('raster packing', () => {
  it('is lossless for 8-bit masks and 16-bit RGB', () => {
    for (const img of [mask(37, 21), fill(19, 11), { width: 1, height: 1, channels: 3 as const, data: Uint16Array.of(0, 65535, 1) }]) {
      const depth = img.data instanceof Uint8Array ? 8 : 16
      const back = unpackRaster(packRaster(img), img.width, img.height, img.channels, depth)
      expect(back.data).toEqual(img.data)
      expect(back.data.constructor).toBe(img.data.constructor)
    }
  })

  it('makes smooth data compressible (deltas are small)', () => {
    const data = new Uint16Array(64 * 3).map((_, i) => 30000 + Math.floor(i / 3) * 4)
    const packed = packRaster({ width: 64, height: 1, channels: 3, data })
    // After the first pixel every delta is 4: high bytes 0, low bytes 4.
    expect(packed.subarray(3, 64 * 3).every((v) => v === 0)).toBe(true)
    expect(packed.subarray(64 * 3 + 3).every((v) => v === 4)).toBe(true)
  })
})

describe('raster store', () => {
  it('stores, reads back, prunes and deletes', async () => {
    const a = await putRaster('p1', 'mask', mask(64, 48))
    const b = await putRaster('p1', 'fill', fill(20, 10))
    const c = await putRaster('p2', 'denoise', fill(8, 8))
    expect(await getRaster(a)).toEqual(mask(64, 48))
    expect(await getRaster(b)).toEqual(fill(20, 10))
    expect(await getRaster('')).toBeUndefined()
    expect(await getRaster('missing')).toBeUndefined()
    expect(await rasterBytes('p1')).toBeGreaterThan(0)

    // Keep only what the recipe (or the undo history) still refers to; other photos are untouched.
    expect(await pruneRasters('p1', [a])).toBe(1)
    expect(await getRaster(a)).toBeDefined()
    expect(await getRaster(b)).toBeUndefined()
    expect(await getRaster(c)).toBeDefined()

    await deleteRasters([a])
    expect(await getRaster(a)).toBeUndefined()
  })

  it('rejects data that does not match its size', async () => {
    await expect(putRaster('p', 'mask', { width: 4, height: 4, channels: 1, data: new Uint8Array(3) })).rejects.toThrow()
  })

  it('lists the ids a recipe refers to', () => {
    const r: EditRecipe = defaultRecipe('raw', { temp: 5000, tint: 0 })
    r.layers = [{ id: 'l', name: 'Sky', enabled: true, opacity: 1, adjust: {}, masks: [{ id: 'm', mode: 'add', invert: false, type: 'ai', target: 'sky', raster: 'r1', model: 'x' }, { id: 'n', mode: 'add', invert: false, type: 'ai', target: 'object', raster: '', model: '' }] }]
    r.retouch = [{ id: 't', mode: 'remove', strokes: [], rect: { x: 0, y: 0, w: 1, h: 1 }, fill: 'r2', model: 'migan-512' }]
    r.denoise = { amount: 50, raster: 'r3', model: 'scunet-real' }
    expect([...recipeRasterIds(r)].sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('deleting a photo deletes its rasters', async () => {
    const recipe = defaultRecipe('display')
    await db.photos.add({ id: 'gone', fileName: 'a.jpg', kind: 'display', mime: 'image/jpeg', fileSize: 1, addedAt: 0, takenAt: 0, width: 1, height: 1, meta: {}, rating: 0, flag: 0, albumIds: [], recipe, edited: false, thumbVersion: 1 })
    const id = await putRaster('gone', 'mask', mask(4, 4))
    const other = await putRaster('kept', 'mask', mask(4, 4))
    await deletePhotos(['gone'])
    expect(await getRaster(id)).toBeUndefined()
    expect(await getRaster(other)).toBeDefined()
  })
})
