import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import type { PhotoRecord } from '../io/types'
import { DEFAULT_PARTS, makeClipboard, pasteOnto, resetRecipe } from './edits'
import { bytesPerPixel, estimateBytes, exportName, outputSize, sizeChoiceOf } from './exportMath'
import {
  EMPTY_SELECTION,
  clickSelect,
  comparePhotos,
  countPhotos,
  effectiveSelection,
  formatBytes,
  formatCamera,
  formatExposure,
  formatMegapixels,
  formatShutter,
  gridLayout,
  importSummary,
  keyCommand,
  lastImportStart,
  moveSelect,
  queryPhotos,
  scrollToRow,
  selectAll,
  visibleRows,
  type KeyLike,
  type Query,
} from './library'

const DAY = 86_400_000

function photo(id: string, over: Partial<PhotoRecord> = {}): PhotoRecord {
  const kind = over.kind ?? 'raw'
  return {
    id,
    fileName: `${id}.ARW`,
    kind,
    mime: 'image/x-sony-arw',
    fileSize: 25e6,
    addedAt: 1000,
    takenAt: 1000,
    width: 6000,
    height: 4000,
    meta: { make: 'SONY', model: 'ILCE-7M4', lens: 'FE 24-70mm F2.8 GM II' },
    rating: 0,
    flag: 0,
    albumIds: [],
    recipe: defaultRecipe(kind, { temp: 5200, tint: 4 }),
    edited: false,
    thumbVersion: 1,
    raw: kind === 'raw' ? { rgbCam: [], camXyz: [], shotMul: [1, 1, 1], asShot: { temp: 5200, tint: 4 } } : undefined,
    ...over,
  }
}

const q = (over: Partial<Query> = {}): Query => ({ view: 'all', minRating: 0, search: '', sort: 'taken', lastImportAt: 0, ...over })

describe('queryPhotos', () => {
  const lib = [
    photo('a', { takenAt: 3 * DAY, addedAt: 10, rating: 5, flag: 1, edited: true, albumIds: ['trip'] }),
    photo('b', { takenAt: 1 * DAY, addedAt: 30, rating: 3, flag: -1, fileName: 'IMG_10.CR3', meta: { make: 'Canon', model: 'Canon EOS R5', lens: 'RF85mm F1.2 L' } }),
    photo('c', { takenAt: 2 * DAY, addedAt: 20, rating: 4, fileName: 'IMG_9.CR3', meta: { make: 'Canon', model: 'Canon EOS R5', lens: 'RF24-70mm' }, albumIds: ['trip'] }),
  ]
  const ids = (r: PhotoRecord[]) => r.map((p) => p.id)

  it('filters smart views and albums', () => {
    expect(ids(queryPhotos(lib, q({ view: 'picks' })))).toEqual(['a'])
    expect(ids(queryPhotos(lib, q({ view: 'rejected' })))).toEqual(['b'])
    expect(ids(queryPhotos(lib, q({ view: 'edited' })))).toEqual(['a'])
    expect(ids(queryPhotos(lib, q({ view: 'rated' })))).toEqual(['a', 'c', 'b'])
    expect(ids(queryPhotos(lib, q({ view: 'album:trip' })))).toEqual(['a', 'c'])
    expect(ids(queryPhotos(lib, q({ view: 'last', lastImportAt: 20 })))).toEqual(['c', 'b'])
  })

  it('applies the minimum rating', () => {
    expect(ids(queryPhotos(lib, q({ minRating: 4 })))).toEqual(['a', 'c'])
    expect(ids(queryPhotos(lib, q({ minRating: 5 })))).toEqual(['a'])
  })

  it('searches file name, camera and lens with every term', () => {
    expect(ids(queryPhotos(lib, q({ search: 'canon' })))).toEqual(['c', 'b'])
    expect(ids(queryPhotos(lib, q({ search: 'canon rf85' })))).toEqual(['b'])
    expect(ids(queryPhotos(lib, q({ search: '  GM  ' })))).toEqual(['a'])
    expect(ids(queryPhotos(lib, q({ search: 'img_9' })))).toEqual(['c'])
    expect(queryPhotos(lib, q({ search: 'nikon' }))).toEqual([])
  })

  it('sorts newest first, by rating, and by natural file name', () => {
    expect(ids(queryPhotos(lib, q({ sort: 'taken' })))).toEqual(['a', 'c', 'b'])
    expect(ids(queryPhotos(lib, q({ sort: 'added' })))).toEqual(['b', 'c', 'a'])
    expect(ids(queryPhotos(lib, q({ sort: 'rating' })))).toEqual(['a', 'c', 'b'])
    // a.ARW, then IMG_9 before IMG_10 (numeric order)
    expect(ids(queryPhotos(lib, q({ sort: 'name' })))).toEqual(['a', 'c', 'b'])
    expect(ids([...lib].sort(comparePhotos('name')))).toEqual(['a', 'c', 'b'])
  })

  it('counts views, albums (newest photo as cover) and bytes in one pass', () => {
    const c = countPhotos(lib, 20)
    expect(c.views).toEqual({ all: 3, last: 2, picks: 1, rejected: 1, rated: 3, edited: 1 })
    expect(c.albums.get('trip')).toMatchObject({ count: 2, cover: 'a' })
    expect(c.bytes).toBe(75e6)
    expect(c.raw).toBe(3)
  })
})

describe('lastImportStart', () => {
  it('uses the recorded time when there is one', () => expect(lastImportStart([1, 2, 3], 2)).toBe(2))
  it('otherwise takes the newest run of photos added close together', () => {
    const m = 60_000
    expect(lastImportStart([0, 5 * m, 100 * m, 101 * m, 120 * m])).toBe(100 * m)
    expect(lastImportStart([])).toBe(Infinity)
  })
})

describe('grid geometry', () => {
  it('fits columns of at least the minimum size and fills the row', () => {
    const l = gridLayout(1000, { minTile: 190, gap: 12, tileHeight: (w) => w })
    expect(l.cols).toBe(5)
    expect(l.tileW * 5 + 12 * 4).toBeCloseTo(1000)
    expect(l.rowH).toBeCloseTo(l.tileW + 12)
    expect(gridLayout(100, { minTile: 190, gap: 12, tileHeight: (w) => w }).cols).toBe(1)
    expect(gridLayout(358, { cols: 3, gap: 4, tileHeight: (w) => w }).tileW).toBeCloseTo(116.67, 1)
  })

  it('renders only the rows in view plus overscan', () => {
    expect(visibleRows(0, 800, 200, 1000, 2)).toEqual({ start: 0, end: 6 })
    expect(visibleRows(10_000, 800, 200, 1000, 2)).toEqual({ start: 48, end: 56 })
    expect(visibleRows(199_900, 800, 200, 1000, 2)).toEqual({ start: 997, end: 1000 })
    expect(visibleRows(-300, 800, 200, 10, 0)).toEqual({ start: 0, end: 4 })
    expect(visibleRows(0, 800, 200, 0)).toEqual({ start: 0, end: 0 })
  })

  it('scrolls just enough to reveal a row', () => {
    const l = gridLayout(1000, { minTile: 190, gap: 12, tileHeight: () => 100 })
    expect(scrollToRow(0, 0, 500, l, 0)).toBe(0)
    expect(scrollToRow(10, 0, 500, l, 16)).toBe(16 + 10 * 112 + 100 + 8 - 500)
    expect(scrollToRow(1, 400, 500, l, 0)).toBe(112 - 8)
    expect(scrollToRow(4, 200, 500, l, 0)).toBe(200)
  })
})

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  const sel = (ids: string[], focus: string | null = ids[0] ?? null, anchor = focus) => ({ ids: new Set(ids), focus, anchor })
  const list = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort()

  it('click selects one, toggle adds/removes, shift selects a range from the anchor', () => {
    let s = clickSelect(EMPTY_SELECTION, 'b', order, {})
    expect(list(s)).toEqual(['b'])
    s = clickSelect(s, 'e', order, { range: true })
    expect(list(s)).toEqual(['b', 'c', 'd', 'e'])
    expect(s.anchor).toBe('b')
    s = clickSelect(s, 'a', order, { range: true })
    expect(list(s)).toEqual(['a', 'b'])
    s = clickSelect(s, 'g', order, { toggle: true })
    expect(list(s)).toEqual(['a', 'b', 'g'])
    s = clickSelect(s, 'b', order, { toggle: true })
    expect(list(s)).toEqual(['a', 'g'])
    expect(s.anchor).toBe('b')
    s = clickSelect(s, 'd', order, { toggle: true, range: true })
    expect(list(s)).toEqual(['a', 'b', 'c', 'd', 'g'])
  })

  it('arrow keys move by one or a row, and Shift extends', () => {
    expect(moveSelect(EMPTY_SELECTION, order, 3, 'right', false).focus).toBe('a')
    expect(moveSelect(sel(['a']), order, 3, 'right', false).focus).toBe('b')
    expect(moveSelect(sel(['a']), order, 3, 'down', false).focus).toBe('d')
    expect(moveSelect(sel(['a']), order, 3, 'left', false).focus).toBe('a')
    expect(moveSelect(sel(['b']), order, 3, 'up', false).focus).toBe('b')
    // Last row is partial: down from e (row 2, col 2) has nowhere to go
    expect(moveSelect(sel(['e']), order, 3, 'down', false).focus).toBe('e')
    expect(moveSelect(sel(['d']), order, 3, 'down', false).focus).toBe('g')
    expect(moveSelect(sel(['d']), order, 3, 'end', false).focus).toBe('g')
    expect(moveSelect(sel(['d']), order, 3, 'home', false).focus).toBe('a')
    const ext = moveSelect(sel(['b']), order, 3, 'down', true)
    expect(list(ext)).toEqual(['b', 'c', 'd', 'e'])
    expect(ext.anchor).toBe('b')
  })

  it('select all keeps focus; actions target the visible selection or the focus', () => {
    const s = selectAll(order, sel(['c']))
    expect(s.ids.size).toBe(7)
    expect(s.focus).toBe('c')
    expect(effectiveSelection(sel(['g', 'a', 'x']), order)).toEqual(['a', 'g'])
    expect(effectiveSelection({ ids: new Set(), focus: 'c', anchor: 'c' }, order)).toEqual(['c'])
    expect(effectiveSelection({ ids: new Set(), focus: 'x', anchor: 'x' }, order)).toEqual([])
  })
})

describe('keyCommand', () => {
  const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })

  it('maps ratings, flags and navigation', () => {
    expect(keyCommand(k('3'), true)).toEqual({ type: 'rate', value: 3 })
    expect(keyCommand(k('0'), true)).toEqual({ type: 'rate', value: 0 })
    expect(keyCommand(k('6'), true)).toBeNull()
    expect(keyCommand(k('p'), true)).toEqual({ type: 'flag', value: 1 })
    expect(keyCommand(k('X'), true)).toEqual({ type: 'flag', value: -1 })
    expect(keyCommand(k('u'), true)).toEqual({ type: 'flag', value: 0 })
    expect(keyCommand(k('ArrowDown', { shiftKey: true }), true)).toEqual({ type: 'move', move: 'down', extend: true })
    expect(keyCommand(k('Enter'), true)).toEqual({ type: 'open' })
    expect(keyCommand(k('Backspace'), true)).toEqual({ type: 'delete' })
    expect(keyCommand(k('Delete'), false)).toEqual({ type: 'delete' })
    expect(keyCommand(k('Escape'), false)).toEqual({ type: 'clear' })
  })

  it('uses ⌘ on Apple and Ctrl elsewhere', () => {
    expect(keyCommand(k('a', { metaKey: true }), true)).toEqual({ type: 'selectAll' })
    expect(keyCommand(k('a', { ctrlKey: true }), true)).toBeNull()
    expect(keyCommand(k('c', { ctrlKey: true }), false)).toEqual({ type: 'copy' })
    expect(keyCommand(k('V', { ctrlKey: true }), false)).toEqual({ type: 'paste' })
    expect(keyCommand(k('c', { metaKey: true }), false)).toBeNull()
    // Browser shortcuts stay with the browser
    expect(keyCommand(k('r', { metaKey: true }), true)).toBeNull()
    expect(keyCommand(k('3', { altKey: true }), true)).toBeNull()
    expect(keyCommand(k('p', { shiftKey: true }), true)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats exposure like a camera', () => {
    expect(formatShutter(1 / 320)).toBe('1/320 s')
    expect(formatShutter(1 / 3)).toBe('1/3 s')
    expect(formatShutter(0.5)).toBe('0.5 s')
    expect(formatShutter(2.5)).toBe('2.5 s')
    const plain = (s: string) => s.replace(/\u00a0/g, ' ')
    expect(plain(formatExposure({ iso: 100, shutter: 1 / 320, aperture: 8, focalLength: 35 }))).toBe('ISO 100 · 1/320 s · ƒ/8 · 35 mm')
    expect(formatExposure({ iso: 100, focalLength: 35 })).toBe('ISO\u00a0100 · 35\u00a0mm')
    expect(formatExposure({ aperture: 2.8, focalLength: 85.4 })).toBe('ƒ/2.8 · 85\u00a0mm')
    expect(formatExposure({})).toBe('')
  })

  it('names cameras without repeating the maker', () => {
    expect(formatCamera({ make: 'Canon', model: 'Canon EOS R6 Mark II' })).toBe('Canon EOS R6 Mark II')
    expect(formatCamera({ make: 'NIKON CORPORATION', model: 'NIKON Z 8' })).toBe('NIKON Z 8')
    expect(formatCamera({ make: 'SONY', model: 'ILCE-7M4' })).toBe('SONY ILCE-7M4')
    expect(formatCamera({ make: 'Apple', model: 'iPhone 17 Pro' })).toBe('Apple iPhone 17 Pro')
    expect(formatCamera({ make: 'Hasselblad' })).toBe('Hasselblad')
    expect(formatCamera({})).toBe('')
  })

  it('formats sizes', () => {
    expect(formatBytes(48.2e6)).toBe('48.2 MB')
    expect(formatBytes(1.32e9)).toBe('1.3 GB')
    expect(formatBytes(820e3)).toBe('820 KB')
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatMegapixels(6000, 4000)).toBe('24 MP')
    expect(formatMegapixels(3024, 2268)).toBe('6.9 MP')
  })

  it('summarizes an import', () => {
    expect(importSummary(24, [], [], 0, false)).toBe('Imported 24 photos')
    expect(importSummary(1, [{ reason: 'Already in your library' }, { reason: 'Already in your library' }], [], 0, false)).toBe(
      'Imported 1 photo · 2 skipped (already in your library)',
    )
    expect(importSummary(0, [{ reason: 'A' }, { reason: 'B' }, { reason: 'B' }, { reason: 'C' }], [{}], 3, false)).toBe(
      'No photos imported · 4 skipped (2 b, 1 a, …) · 1 note · 3 other files ignored',
    )
    expect(importSummary(5, [], [], 0, true)).toBe('Import stopped after 5 photos')
  })
})

describe('export estimate', () => {
  const p = photo('a')
  it('computes the output size after crop, rotation and long-edge limit', () => {
    expect(outputSize(p)).toEqual({ width: 6000, height: 4000 })
    expect(outputSize(p, 2048)).toEqual({ width: 2048, height: 1365 })
    expect(outputSize(p, 9000)).toEqual({ width: 6000, height: 4000 })
    const rotated = { ...p, recipe: { ...p.recipe, geometry: { ...p.recipe.geometry, rotate: 1 as const, crop: { x: 0, y: 0, w: 0.5, h: 1 } } } }
    expect(outputSize(rotated)).toEqual({ width: 4000, height: 3000 })
  })

  it('estimates bytes per format', () => {
    expect(bytesPerPixel('jpeg', 92)).toBeGreaterThan(bytesPerPixel('jpeg', 80))
    expect(bytesPerPixel('jpeg', 100)).toBeLessThan(bytesPerPixel('png', 100))
    expect(bytesPerPixel('tiff16', 0)).toBe(6)
    expect(estimateBytes([p, p], { format: 'tiff16', quality: 92 })).toBe(2 * 24e6 * 6)
    const jpeg = estimateBytes([p], { format: 'jpeg', quality: 92 })
    expect(jpeg / 1e6).toBeGreaterThan(8)
    expect(jpeg / 1e6).toBeLessThan(16)
  })

  it('maps long edges to size choices and names files', () => {
    expect(sizeChoiceOf(undefined)).toBe('full')
    expect(sizeChoiceOf(2048)).toBe('2048')
    expect(sizeChoiceOf(1600)).toBe('custom')
    expect(exportName('IMG_0001.CR3', 'jpeg')).toBe('IMG_0001-lumen.jpg')
    expect(exportName('a.b.ARW', 'tiff16')).toBe('a.b-lumen.tif')
  })
})

describe('copy / paste edits', () => {
  const src = photo('src')
  src.recipe = {
    ...src.recipe,
    basic: { ...src.recipe.basic, exposure: 1.2, contrast: 20 },
    wb: { preset: 'custom', temp: 6100, tint: 10 },
    geometry: { ...src.recipe.geometry, angle: 3 },
    look: { presetId: 'warm', name: 'Warm', amount: 80, variation: 'original' },
  }

  it('copies everything except geometry by default', () => {
    expect(DEFAULT_PARTS).not.toContain('geometry')
    const clip = makeClipboard(src)
    const out = pasteOnto(photo('dst'), clip)
    expect(out.basic.exposure).toBe(1.2)
    expect(out.wb).toEqual({ preset: 'custom', temp: 6100, tint: 10 })
    expect(out.geometry.angle).toBe(0)
    expect(out.look?.name).toBe('Warm')
  })

  it("keeps each photo's own white balance for As Shot and across RAW/JPEG", () => {
    const asShot = { ...src, recipe: { ...src.recipe, wb: { preset: 'asShot' as const, temp: 5200, tint: 4 } } }
    const dst = photo('dst', { raw: { rgbCam: [], camXyz: [], shotMul: [1, 1, 1], asShot: { temp: 4300, tint: -2 } } })
    expect(pasteOnto(dst, makeClipboard(asShot)).wb).toEqual({ preset: 'asShot', temp: 4300, tint: -2 })
    const jpeg = photo('jpg', { kind: 'display', raw: undefined })
    expect(pasteOnto(jpeg, makeClipboard(src)).wb).toEqual(jpeg.recipe.wb)
    expect(pasteOnto(jpeg, makeClipboard(src)).basic.exposure).toBe(1.2)
  })

  it('pastes only the listed parts; crop-only leaves the look alone', () => {
    const clip = { ...makeClipboard(src), parts: ['geometry'] }
    const dst = photo('dst')
    const out = pasteOnto(dst, clip)
    expect(out.geometry.angle).toBe(3)
    expect(out.basic.exposure).toBe(0)
    expect(out.look).toBeUndefined()
  })

  it('resets to as shot', () => {
    expect(resetRecipe(src)).toEqual(defaultRecipe('raw', { temp: 5200, tint: 4 }))
  })
})
