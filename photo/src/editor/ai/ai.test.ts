import { describe, expect, it } from 'vitest'
import { defaultRecipe } from '../../edit/defaults'
import type { EditRecipe, Mask, RemoveArea } from '../../edit/types'
import type { RasterImage, RenderedImage } from '../../engine/types'
import { cropRendered } from '../../io/export'
import { makeClipboard, pasteOnto } from '../../library/edits'
import { hitRemoval, removalPin } from '../masks/handles'
import { makeSpace } from '../masks/space'
import { ai, rastersFor, setAiCore, type AiCore } from './core'
import { aiBusy, cancelAi, confirmDownload, runAi } from './jobs'
import { blankRasters, needsCompute, rasterRefs, refChanges } from './refs'
import { upscaledSize } from './sizes'

const aiMask = (raster: string): Mask => ({ type: 'ai', target: 'sky', raster, model: 'm', id: `m-${raster}`, mode: 'add', invert: false })
const removal = (fill: string): RemoveArea => ({ id: `r-${fill}`, mode: 'remove', strokes: [{ points: [{ x: 0.5, y: 0.5 }], r: 0.02, feather: 30, flow: 1 }], rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, fill, model: 'migan' })

function recipe(): EditRecipe {
  const r = defaultRecipe('display')
  return {
    ...r,
    layers: [{ id: 'L', name: 'Sky', enabled: true, opacity: 1, masks: [aiMask('a'), aiMask(''), aiMask('a')], adjust: {} }],
    retouch: [removal('f'), { id: 's', mode: 'heal', x: 0.1, y: 0.1, r: 0.01, sx: 0.2, sy: 0.1, feather: 50, opacity: 1 }],
    denoise: { amount: 50, raster: 'd', model: 'scunet' },
  }
}

describe('raster bookkeeping', () => {
  it('lists every stored result a recipe uses, once, skipping blanks', () => {
    expect(rasterRefs(recipe()).sort()).toEqual(['a', 'd', 'f'])
    expect(rasterRefs(defaultRecipe('display'))).toEqual([])
  })

  it('tells what to hand to and take from the engine', () => {
    expect(refChanges(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
    expect(refChanges([], [])).toEqual({ added: [], removed: [] })
  })

  it('needs computing when never made or gone from storage', () => {
    const missing = new Set(['gone'])
    expect(needsCompute('', missing)).toBe(true)
    expect(needsCompute('gone', missing)).toBe(true)
    expect(needsCompute('here', missing)).toBe(false)
  })

  it('blanks AI results that travel to another photo, keeping everything else', () => {
    const r = blankRasters(recipe())
    expect(rasterRefs({ ...r, denoise: undefined })).toEqual([])
    expect(r.layers[0].masks[0]).toMatchObject({ type: 'ai', target: 'sky', raster: '' })
    expect(r.retouch[1]).toEqual(recipe().retouch[1])
  })

  it('pastes masks and removals without the source photo’s results', () => {
    const clip = makeClipboard({ recipe: recipe(), kind: 'display' }, ['layers', 'retouch'])
    const out = pasteOnto({ recipe: defaultRecipe('display'), kind: 'display', raw: undefined }, clip)
    expect(out.layers).toHaveLength(1)
    expect(rasterRefs(out)).toEqual([])
    expect(out.denoise).toBeUndefined()
  })
})

describe('removal pins', () => {
  it('sit in the middle of the removed area and can be hit', () => {
    const s = makeSpace({ width: 3000, height: 2000 }, { crop: { x: 0, y: 0, w: 1, h: 1 }, angle: 0, rotate: 0, flipH: false, flipV: false, aspect: 'original' }, { w: 600, h: 400 })
    const a = removal('f')
    expect(removalPin(a, s)).toEqual({ x: 300, y: 200 })
    expect(hitRemoval([a], s, { x: 305, y: 196 }, 10)).toBe('r-f')
    expect(hitRemoval([a], s, { x: 330, y: 200 }, 10)).toBeNull()
  })
})

describe('export sizes', () => {
  it('doubles, then fits the long edge', () => {
    expect(upscaledSize({ width: 3000, height: 2000 })).toEqual({ width: 6000, height: 4000 })
    expect(upscaledSize({ width: 3000, height: 2000 }, 4000)).toEqual({ width: 4000, height: 2667 })
    expect(upscaledSize({ width: 1000, height: 1500 }, 8000)).toEqual({ width: 2000, height: 3000 })
  })

  it('crops the pixel an odd long edge gains', () => {
    const r: RenderedImage = { width: 4, height: 3, bitDepth: 8, colorSpace: 'srgb', data: new Uint8ClampedArray(Array.from({ length: 48 }, (_, i) => i)) }
    const c = cropRendered(r, 3, 2)
    expect([c.width, c.height]).toEqual([3, 2])
    expect(Array.from(c.data.slice(0, 4))).toEqual([0, 1, 2, 3])
    expect(Array.from(c.data.slice(12, 16))).toEqual([16, 17, 18, 19])
    expect(cropRendered(r, 4, 3)).toBe(r)
  })
})

/** A scripted AI core for the job runner. */
function fakeCore(over: Partial<AiCore> = {}): AiCore {
  const store = new Map<string, RasterImage>()
  const mask: RasterImage = { width: 2, height: 2, channels: 1, data: new Uint8Array([0, 255, 255, 0]) }
  return {
    support: async () => ({ available: true }),
    modelsFor: async () => [{ id: 'sky', name: 'Sky', bytes: 1000, downloaded: true }],
    downloadModel: async () => undefined,
    listModels: async () => [],
    deleteModel: async () => undefined,
    segment: async () => mask,
    selectObject: async () => mask,
    inpaint: async () => ({ rect: { x: 0, y: 0, w: 1, h: 1 }, fill: { width: 1, height: 1, channels: 3, data: new Uint16Array(3) } }),
    denoise: async (img) => img,
    upscale: async (img) => img,
    putRaster: async (photo, kind, img) => {
      const id = `${photo}-${kind}-${store.size}`
      store.set(id, img)
      return id
    },
    getRaster: async (id) => store.get(id),
    pruneRasters: async () => undefined,
    ...over,
  }
}

describe('AI jobs', () => {
  it('runs and reports the models used', async () => {
    setAiCore(fakeCore())
    const res = await runAi({ scope: 'mask', label: 'Finding the sky…', task: 'segment', target: 'sky', run: (c, o) => c.segment('sky', { width: 1, height: 1, data: new Uint16Array(3) }, { kind: 'display', space: 'srgb-linear' }, o) })
    expect(res?.model).toBe('sky')
    expect(res?.value.channels).toBe(1)
    expect(aiBusy()).toBe(false)
  })

  it('asks before downloading, and does nothing when declined', async () => {
    let downloads = 0
    setAiCore(fakeCore({ modelsFor: async () => [{ id: 'big', name: 'Subject', bytes: 9e7, downloaded: false }], downloadModel: async () => void downloads++ }))
    const pending = runAi({ scope: 'mask', label: 'x', task: 'segment', run: async () => 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(aiBusy()).toBe(true)
    confirmDownload(false)
    expect(await pending).toBeNull()
    expect(downloads).toBe(0)
  })

  it('downloads after consent, and stops on cancel', async () => {
    let downloads = 0
    setAiCore(fakeCore({ modelsFor: async () => [{ id: 'big', name: 'Subject', bytes: 9e7, downloaded: false }], downloadModel: async () => void downloads++ }))
    const ok = runAi({ scope: 'mask', label: 'x', task: 'segment', run: async () => 7 })
    await new Promise((r) => setTimeout(r, 0))
    confirmDownload(true)
    expect((await ok)?.value).toBe(7)
    expect(downloads).toBe(1)

    setAiCore(fakeCore({ segment: (_t, _i, _c, o) => new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')))) }))
    const slow = runAi({ scope: 'mask', label: 'x', task: 'segment', run: (c, o) => c.segment('sky', { width: 1, height: 1, data: new Uint16Array(3) }, { kind: 'display', space: 'srgb-linear' }, o) })
    await new Promise((r) => setTimeout(r, 0))
    cancelAi()
    expect(await slow).toBeNull()
    expect(aiBusy()).toBe(false)
  })

  it('loads the results a recipe needs for off-screen renders', async () => {
    setAiCore(fakeCore())
    const core = await ai()
    const id = await core.putRaster('p', 'mask', { width: 1, height: 1, channels: 1, data: new Uint8Array(1) })
    const r = { ...defaultRecipe('display'), layers: [{ id: 'L', name: 'Sky', enabled: true, opacity: 1, masks: [aiMask(id), aiMask('missing')], adjust: {} }] }
    expect([...(await rastersFor(r)).keys()]).toEqual([id])
  })
})
