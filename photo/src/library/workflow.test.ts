import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../edit/defaults'
import type { ExportOptions, PhotoRecord } from '../io/types'
import { allPresets, BUILTIN_PRESETS, deletePreset, presetNamed, presetSummary, renamePreset, sameOptions, savePreset, uniquePresetName } from './exportPresets'
import { DEFAULT_TEMPLATE, renderFileName, sanitizeFileName, unknownTokens } from './fileNames'
import { addKeywords, cleanKeywords, countKeywords, normalizeKeyword, parseKeywords, removeKeywords, sharedKeywords, suggestKeywords } from './keywords'
import { matchesSearch, queryPhotos, searchTerms, surveyColumns } from './library'

const photo = (over: Partial<PhotoRecord> = {}): PhotoRecord => ({
  id: 'p1',
  fileName: 'IMG_0042.CR3',
  kind: 'raw',
  mime: 'image/x-canon-cr3',
  fileSize: 1000,
  addedAt: 1,
  takenAt: new Date(2026, 6, 4, 9, 5, 7).getTime(),
  width: 6000,
  height: 4000,
  meta: { make: 'Canon', model: 'Canon EOS R5' },
  rating: 4,
  flag: 0,
  albumIds: [],
  recipe: defaultRecipe('display'),
  edited: false,
  thumbVersion: 1,
  ...over,
})

describe('keywords', () => {
  it('normalizes: trims, collapses spaces, drops separators and control characters, caps the length', () => {
    expect(normalizeKeyword('  Golden   hour ')).toBe('Golden hour')
    expect(normalizeKeyword('a,b;c|d')).toBe('a b c d')
    expect(normalizeKeyword('tab\there\n')).toBe('tab here')
    expect(normalizeKeyword('   ')).toBe('')
    expect(normalizeKeyword('x'.repeat(100))).toHaveLength(64)
  })

  it('parses typed lists and keeps the first spelling, ignoring case', () => {
    expect(parseKeywords('Paris, paris; Eiffel Tower\nnight,,')).toEqual(['Paris', 'Eiffel Tower', 'night'])
    expect(addKeywords(['Paris'], ['PARIS', 'France'])).toEqual(['Paris', 'France'])
    expect(addKeywords(undefined, [' a ', ''])).toEqual(['a'])
    expect(removeKeywords(['Paris', 'France'], ['paris'])).toEqual(['France'])
    expect(cleanKeywords(['a', 'A', 3, null, ' b '] as unknown[])).toEqual(['a', 'b'])
  })

  it('counts across photos (most used spelling names it, else the first seen), A→Z', () => {
    const c = countKeywords([{ keywords: ['beach', 'Sun'] }, { keywords: ['Beach'] }, { keywords: ['Beach', 'sun'] }, {}])
    expect(c).toEqual([
      { name: 'Beach', count: 3 },
      { name: 'Sun', count: 2 },
    ])
  })

  it('suggests prefix matches first, then word and substring matches, by use', () => {
    const known = [
      { name: 'Beach', count: 3 },
      { name: 'Bear', count: 9 },
      { name: 'Sandy beach', count: 1 },
      { name: 'Embed', count: 5 },
    ]
    expect(suggestKeywords('be', known)).toEqual(['Bear', 'Beach', 'Sandy beach', 'Embed'])
    expect(suggestKeywords('be', known, ['bear'])).toEqual(['Beach', 'Sandy beach', 'Embed'])
    expect(suggestKeywords('', known, [], 2)).toEqual(['Bear', 'Embed'])
  })

  it('splits keywords of several photos into shared and partial', () => {
    expect(sharedKeywords([['a', 'b'], ['B', 'c'], ['b']])).toEqual({ all: ['b'], some: ['a', 'c'] })
  })

  it('search matches keywords; keyword views filter case-insensitively', () => {
    const p = photo({ keywords: ['Golden hour', 'Lisbon'] })
    expect(matchesSearch(p, searchTerms('lisbon canon'))).toBe(true)
    expect(matchesSearch(p, searchTerms('porto'))).toBe(false)
    const q = { view: 'keyword:lisbon' as const, minRating: 0 as const, search: '', sort: 'taken' as const, lastImportAt: 0 }
    expect(queryPhotos([p, photo({ id: 'p2' })], q).map((x) => x.id)).toEqual(['p1'])
  })
})

describe('file name templates', () => {
  const p = photo({ keywords: ['Beach', 'Family'] })
  it('replaces every token', () => {
    expect(renderFileName('{name}-{date}_{time}', p, { seq: 1, total: 1 })).toBe('IMG_0042-2026-07-04_090507')
    expect(renderFileName('Trip {seq} {camera} {rating}★ {keywords}', p, { seq: 7, total: 20 })).toBe('Trip 007 Canon EOS R5 4★ Beach-Family')
    expect(renderFileName('{seq}', p, { seq: 12, total: 1500 })).toBe('0012')
    expect(renderFileName(DEFAULT_TEMPLATE, p, { seq: 1, total: 1 })).toBe('IMG_0042-lumen')
  })
  it('makes names every file system accepts, never empty', () => {
    expect(sanitizeFileName('a/b\\c:d*e?"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i')
    expect(sanitizeFileName('  ..hidden. ')).toBe('hidden')
    expect(renderFileName('{keywords}', photo(), { seq: 1, total: 1 })).toBe('IMG_0042')
    expect(renderFileName('', p, { seq: 1, total: 1 })).toBe('IMG_0042')
    expect(renderFileName('x'.repeat(300), p, { seq: 1, total: 1 })).toHaveLength(120)
  })
  it('keeps unknown tokens literally and reports them', () => {
    expect(renderFileName('{name}-{place}', p, { seq: 1, total: 1 })).toBe('IMG_0042-{place}')
    expect(unknownTokens('{name}-{place}-{SEQ}')).toEqual(['{place}'])
  })
})

describe('export presets', () => {
  const opts: ExportOptions = { format: 'jpeg', quality: 80, colorSpace: 'srgb', keepMetadata: true, stripLocation: true, longEdge: 1600, fileName: '{name}-proof' }

  it('ships built-ins that can be told apart from custom settings', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(3)
    expect(new Set(BUILTIN_PRESETS.map((p) => p.name)).size).toBe(BUILTIN_PRESETS.length)
    const web = BUILTIN_PRESETS.find((p) => p.id === 'builtin:web')!
    expect(sameOptions(web.options, { ...web.options })).toBe(true)
    expect(sameOptions(web.options, { ...web.options, quality: 86 })).toBe(false)
    // Quality doesn't matter for TIFF; a missing template is the default one.
    const tiff = { ...opts, format: 'tiff16' as const, fileName: undefined }
    expect(sameOptions(tiff, { ...tiff, quality: 10, fileName: DEFAULT_TEMPLATE })).toBe(true)
    expect(presetSummary(web.options)).toBe('JPEG 85 · 2048 px · sRGB')
  })

  it('saves, numbers name clashes, or replaces on request', () => {
    let list = savePreset([], 'Proofs', opts, 'a', { now: 1 })
    expect(list).toEqual([{ id: 'a', name: 'Proofs', options: opts, updatedAt: 1 }])
    list = savePreset(list, 'proofs', { ...opts, quality: 70 }, 'b', { now: 2 })
    expect(list.map((p) => p.name)).toEqual(['Proofs', 'proofs 2'])
    list = savePreset(list, 'PROOFS', { ...opts, quality: 60 }, 'c', { replace: true, now: 3 })
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ id: 'a', options: { quality: 60 }, updatedAt: 3 })
    // A built-in's name: always a number.
    expect(savePreset([], 'Web JPEG', opts, 'd')[0].name).toBe('Web JPEG 2')
    expect(presetNamed(list, ' proofs ')?.id).toBe('a')
  })

  it('renames (unique, not against itself) and deletes', () => {
    const list = [
      { id: 'a', name: 'One', options: opts },
      { id: 'b', name: 'Two', options: opts },
    ]
    expect(renamePreset(list, 'a', 'two', 5).find((p) => p.id === 'a')).toMatchObject({ name: 'two 2', updatedAt: 5 })
    expect(renamePreset(list, 'a', 'ONE', 5).find((p) => p.id === 'a')?.name).toBe('ONE')
    expect(deletePreset(list, 'a').map((p) => p.id)).toEqual(['b'])
    expect(uniquePresetName('  ', [])).toBe('Export preset')
    expect(uniquePresetName('Web JPEG 2', allPresets([{ id: 'x', name: 'Web JPEG 2', options: opts }]))).toBe('Web JPEG 3')
  })
})

describe('survey layout', () => {
  it('picks the column count that makes cells largest', () => {
    expect(surveyColumns(1, 1200, 800)).toBe(1)
    expect(surveyColumns(2, 1200, 800)).toBe(2)
    expect(surveyColumns(4, 1200, 800)).toBe(2)
    expect(surveyColumns(6, 1400, 700)).toBe(3)
    expect(surveyColumns(2, 400, 900)).toBe(1)
  })
})
