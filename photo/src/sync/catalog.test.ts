import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import type { ExportPreset } from '../library/exportPresets'
import { emptyCatalog, mergeCatalogs, parseCatalog, planApply, planIsEmpty, TOMBSTONE_DAYS, type Catalog, type SyncAlbum, type SyncPhoto } from './catalog'
import { backupAsCatalog } from './sync'

const NOW = 1_800_000_000_000
/** Recent times (tombstones older than TOMBSTONE_DAYS are forgotten). */
const T = (ms: number) => NOW - 100_000 + ms

function photo(key: string, over: Partial<SyncPhoto> = {}): SyncPhoto {
  return {
    key,
    id: `id-${key}`,
    fileName: `${key}.jpg`,
    fileSize: 100,
    takenAt: 1,
    addedAt: 10,
    kind: 'display',
    mime: 'image/jpeg',
    width: 300,
    height: 200,
    meta: {},
    recipe: defaultRecipe('display'),
    edited: false,
    editedAt: 0,
    rating: 0,
    flag: 0,
    keywords: [],
    albumIds: [],
    infoAt: 0,
    ...over,
  }
}

const exposure = (v: number) => ({ ...defaultRecipe('display'), basic: { ...defaultRecipe('display').basic, exposure: v } })

function catalog(device: string, parts: Partial<Catalog> = {}): Catalog {
  return { ...emptyCatalog(device, device, NOW), ...parts }
}

/** The merge without its write time (for comparing merges). */
const content = (c: Catalog) => ({ ...c, writtenAt: 0 })

describe('sync merge: photos', () => {
  it('the newest edit wins, per photo; info travels separately', () => {
    const a = catalog('A', { photos: [photo('x', { recipe: exposure(1), edited: true, editedAt: 100, rating: 5, infoAt: 50 }), photo('y', { recipe: exposure(0.3), edited: true, editedAt: 300 })] })
    const b = catalog('B', { photos: [photo('x', { id: 'b-x', recipe: exposure(-1), edited: true, editedAt: 200, rating: 2, infoAt: 40 }), photo('y', { id: 'b-y', editedAt: 0, rating: 3, flag: 1, keywords: ['sea'], infoAt: 400 })] })
    const m = mergeCatalogs(a, [b], NOW)
    const x = m.photos.find((p) => p.key === 'x')!, y = m.photos.find((p) => p.key === 'y')!
    // x: B's edit is newer, A's rating is newer.
    expect([x.recipe.basic.exposure, x.editedAt, x.rating, x.infoAt]).toEqual([-1, 200, 5, 50])
    // y: A's edit, B's info. This device's id stays.
    expect([y.recipe.basic.exposure, y.rating, y.flag, y.keywords, y.id]).toEqual([0.3, 3, 1, ['sea'], 'id-y'])
  })

  it('a tie keeps this device’s version', () => {
    const a = catalog('A', { photos: [photo('x', { recipe: exposure(1), editedAt: 100, rating: 1, infoAt: 7 })] })
    const b = catalog('B', { photos: [photo('x', { recipe: exposure(2), editedAt: 100, rating: 4, infoAt: 7 })] })
    const m = mergeCatalogs(a, [b], NOW)
    expect([m.photos[0].recipe.basic.exposure, m.photos[0].rating]).toEqual([1, 1])
  })

  it('a photo only another device has stays in the catalog; it is created here only with a synced original', () => {
    const a = catalog('A')
    const b = catalog('B', { photos: [photo('x'), photo('y', { original: 'originals/id-y/y.jpg' })] })
    const m = mergeCatalogs(a, [b], NOW)
    expect(m.photos.map((p) => p.key)).toEqual(['x', 'y'])
    const plan = planApply(a, m)
    expect(plan.creates.map((p) => p.key)).toEqual(['y'])
    expect(plan.elsewhere).toBe(1)
  })
})

describe('sync merge: deletions', () => {
  it('deleting wins over older changes and spreads; later changes or a re-import win over the deletion', () => {
    const tomb = { kind: 'photo' as const, key: 'x', at: T(500) }
    const a = catalog('A', { tombstones: [tomb, { kind: 'photo', key: 'y', at: T(500) }, { kind: 'photo', key: 'z', at: T(500) }] })
    const b = catalog('B', {
      photos: [
        photo('x', { editedAt: T(400), infoAt: T(300) }), // changed before the deletion: goes
        photo('y', { editedAt: T(600) }), // edited after: stays
        photo('z', { addedAt: T(700) }), // imported again after: stays
      ],
    })
    const m = mergeCatalogs(a, [b], NOW)
    expect(m.photos.map((p) => p.key)).toEqual(['y', 'z'])
    // On B, the merge deletes x.
    const onB = mergeCatalogs(b, [a], NOW)
    expect(planApply(b, onB).deletes).toEqual(['x'])
    expect(onB.tombstones).toContainEqual(tomb)
  })

  it('forgets tombstones after a while', () => {
    const old = NOW - (TOMBSTONE_DAYS + 1) * 86_400_000
    const m = mergeCatalogs(catalog('A', { tombstones: [{ kind: 'photo', key: 'x', at: old }] }), [catalog('B', { photos: [photo('x')] })], NOW)
    expect(m.tombstones).toEqual([])
    expect(m.photos).toHaveLength(1)
  })
})

describe('sync merge: albums', () => {
  const album = (id: string, name: string, at: number, over: Partial<SyncAlbum> = {}): SyncAlbum => ({ id, name, createdAt: at, at, ...over })

  it('the same name made on two devices becomes one album (the smaller id), photos follow', () => {
    const a = catalog('A', { albums: [album('a2', 'Trip', 1)], photos: [photo('x', { albumIds: ['a2'], infoAt: 5 })] })
    const b = catalog('B', { albums: [album('a1', 'trip', 2)], photos: [photo('y', { albumIds: ['a1'], infoAt: 5 })] })
    const m = mergeCatalogs(a, [b], NOW)
    expect(m.albums.map((x) => [x.id, x.name])).toEqual([['a1', 'trip']])
    expect(m.photos.map((p) => p.albumIds)).toEqual([['a1'], ['a1']])
    const plan = planApply(a, m)
    expect(plan.albumsDelete).toEqual(['a2'])
    expect(plan.albumsPut.map((x) => x.id)).toEqual(['a1'])
    expect(plan.infos.map((p) => p.key)).toEqual(['x'])
  })

  it('the newest rename wins; a deleted album goes unless renamed after', () => {
    const a = catalog('A', { albums: [album('k', 'Old', 1, { at: T(50) }), album('d', 'Gone', 1, { at: T(10) })], tombstones: [{ kind: 'album', key: 'e', at: T(30) }] })
    const b = catalog('B', { albums: [album('k', 'New', 1, { at: T(60) }), album('e', 'Kept', 1, { at: T(40) })], tombstones: [{ kind: 'album', key: 'd', at: T(20) }] })
    const m = mergeCatalogs(a, [b], NOW)
    expect(m.albums.map((x) => x.name).sort()).toEqual(['Kept', 'New'])
  })
})

describe('sync merge: presets', () => {
  const ep = (id: string, name: string, updatedAt: number): ExportPreset => ({ id, name, updatedAt, options: { format: 'jpeg', quality: 90, colorSpace: 'srgb', keepMetadata: true, stripLocation: true } })
  it('export presets: newest change wins, deletions spread; user presets are kept from every device', () => {
    const a = catalog('A', { exportPresets: [ep('p', 'Proofs', 5), ep('q', 'Old', 1)], presets: [{ id: 'u1', name: 'Mine', collection: 'mine', source: 'user', createdAt: 1 } as Catalog['presets'][number]] })
    const b = catalog('B', { exportPresets: [ep('p', 'Client proofs', 9)], tombstones: [{ kind: 'exportPreset', key: 'q', at: T(3) }], presets: [{ id: 'u2', name: 'Theirs', collection: 'mine', source: 'user', createdAt: 2 } as Catalog['presets'][number]] })
    const m = mergeCatalogs(a, [b], NOW)
    expect(m.exportPresets.map((p) => p.name)).toEqual(['Client proofs'])
    expect(m.presets.map((p) => p.id)).toEqual(['u1', 'u2'])
    expect(planApply(a, m).presetsAdd.map((p) => p.id)).toEqual(['u2'])
  })
})

describe('sync merge: properties', () => {
  const a = catalog('A', {
    photos: [photo('x', { recipe: exposure(1), editedAt: 100, keywords: ['a'], infoAt: 9 }), photo('w', { albumIds: ['al'], infoAt: 3 })],
    albums: [{ id: 'al', name: 'Album', createdAt: 1, at: 1, coverKey: 'w' }],
    tombstones: [{ kind: 'photo', key: 'gone', at: T(50) }],
  })
  const b = catalog('B', { photos: [photo('x', { recipe: exposure(2), editedAt: 200, keywords: ['b'], infoAt: 4 }), photo('gone', { editedAt: 20 }), photo('v', { original: 'originals/v/v.jpg' })] })
  const c = catalog('C', { photos: [photo('x', { rating: 3, infoAt: 30 })], albums: [{ id: 'zz', name: 'album', createdAt: 5, at: 5 }] })

  it('is idempotent: merging the result again changes nothing', () => {
    const m = mergeCatalogs(a, [b, c], NOW)
    expect(content(mergeCatalogs(m, [b, c], NOW))).toEqual(content(m))
    expect(content(mergeCatalogs(m, [m], NOW))).toEqual(content(m))
    // Once applied (the merge is this device's state), there is nothing left to do.
    expect(planIsEmpty(planApply(m, mergeCatalogs(m, [b, c], NOW)))).toBe(true)
    expect(m.photos.map((p) => p.key)).not.toContain('gone')
  })

  it('doesn’t depend on the order other devices are read in, and every device ends up the same', () => {
    expect(content(mergeCatalogs(a, [b, c], NOW))).toEqual(content(mergeCatalogs(a, [c, b], NOW)))
    const fromA = mergeCatalogs(a, [b, c], NOW), fromC = mergeCatalogs(c, [a, b], NOW)
    const shape = (m: Catalog) => m.photos.map((p) => [p.key, p.recipe.basic.exposure, p.rating, p.keywords, p.albumIds])
    expect(shape(fromA)).toEqual(shape(fromC))
    expect(fromA.albums.map((x) => x.id)).toEqual(fromC.albums.map((x) => x.id))
  })

  it('reads catalogs loosely and refuses what it can’t use', () => {
    expect(() => parseCatalog({ app: 'other' })).toThrow(/isn't a Lumen sync file/)
    expect(() => parseCatalog({ ...emptyCatalog('x'), version: 99 })).toThrow(/newer version/)
    const c2 = parseCatalog({ app: 'lumen', type: 'sync', version: 1, photos: [photo('x'), { nope: 1 }] })
    expect(c2.photos).toHaveLength(1)
    expect(c2.albums).toEqual([])
  })

  it('an edits backup merges like a sync file', () => {
    const backup = {
      app: 'lumen' as const,
      type: 'edits' as const,
      version: 1 as const,
      exportedAt: 1000,
      photos: [{ ...photo('x'), id: 'old', fileName: 'x.jpg', fileSize: 100, takenAt: 1, recipe: exposure(0.7), edited: true, editedAt: 900, rating: 4, flag: 1 as const, albumIds: [], keywords: ['K'] }],
      albums: [],
      presets: [],
    }
    const cat = backupAsCatalog(backup as unknown as Parameters<typeof backupAsCatalog>[0])
    const local = catalog('A', { photos: [photo('x.jpg\u0000100\u0000', { fileName: 'x.jpg' })] })
    const m = mergeCatalogs(local, [cat], NOW)
    expect([m.photos[0].recipe.basic.exposure, m.photos[0].rating, m.photos[0].keywords]).toEqual([0.7, 4, ['K']])
  })
})
