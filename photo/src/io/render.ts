// The off-screen render engine shared by thumbnails, exports and AI previews
// (the editor has its own on-screen one). Created on first use, released when
// idle so its GPU memory doesn't linger.
import type { EditRecipe } from '../edit/types'
import { rastersFor } from '../editor/ai/core'
import { createEngine } from '../engine'
import type { Engine, ExportRenderOptions, RenderedImage } from '../engine/types'
import type { DecodedPhoto, ThumbRecord } from './types'
import { work } from './worker'

export const THUMB_LONG_EDGE = 512
const THUMB_QUALITY = 0.82
const IDLE_MS = 30_000

let engine: Engine | null = null
let unavailable = false
let idleTimer: ReturnType<typeof setTimeout> | undefined

function acquire(): Engine | null {
  clearTimeout(idleTimer)
  if (engine || unavailable) return engine
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    const e = createEngine(canvas)
    if (e.supported) engine = e
    else {
      e.dispose()
      unavailable = true
    }
  } catch {
    unavailable = true
  }
  return engine
}

function release() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    engine?.dispose()
    engine = null
  }, IDLE_MS)
}

/** Render a recipe off-screen, with the AI results it refers to. Throws when this device can't render (no WebGL 2). */
export async function renderPhoto(recipe: EditRecipe, d: DecodedPhoto, opts: ExportRenderOptions): Promise<RenderedImage> {
  const e = acquire()
  if (!e) throw new Error("This device can't render photos: WebGL 2 isn't available.")
  try {
    return await e.renderImage(recipe, d.image, d.color, { ...opts, rasters: opts.rasters ?? (await rastersFor(recipe)) })
  } finally {
    release()
  }
}

/**
 * Grid thumbnail of the edited photo. Without a working engine it falls back
 * to a plain conversion of the source (recipe not applied) so the library
 * still shows something.
 */
export async function makeThumbnail(d: DecodedPhoto, recipe: EditRecipe): Promise<Omit<ThumbRecord, 'id'>> {
  try {
    const r = await renderPhoto(recipe, d, { maxLongEdge: THUMB_LONG_EDGE, bitDepth: 8, colorSpace: 'srgb' })
    const rgba = r.data as Uint8ClampedArray<ArrayBuffer>
    return { blob: await work('rgbaToJpeg', { rgba, width: r.width, height: r.height, quality: THUMB_QUALITY }), width: r.width, height: r.height }
  } catch {
    // Fall through to the plain preview.
  }
  const matrix = d.color.space === 'camera' ? d.color.rgbCam : undefined
  return work('linearToJpeg', { image: d.image, matrix, maxLongEdge: THUMB_LONG_EDGE, quality: THUMB_QUALITY })
}
