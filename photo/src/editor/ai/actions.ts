import { isSpot, spotsOf } from '../../edit/retouch'
import type { AiTarget, BrushStroke, Mask, MaskMode, PersonPart, RemoveArea } from '../../edit/types'
import type { RasterImage } from '../../engine/types'
import { loadFullResolution } from '../../io/api'
import { uid } from '../../io/db'
import { editor } from '../../state/editor'
import { addMask, maskLabel, newLayer, updateMask } from '../masks/model'
import type { Session } from '../session'
import { view } from '../view'
import { ai, type RasterKind } from './core'
import { runAi } from './jobs'
import type { AiShape } from './refs'
import { provideRaster } from './rasterSync'

// The AI edits: each runs the model (with download consent and progress, see
// jobs.ts), stores the result, and lands in the recipe as one undo step.

const DETECTING: Record<AiTarget, string> = {
  subject: 'Finding the subject…',
  sky: 'Finding the sky…',
  background: 'Finding the background…',
  person: 'Finding people…',
  object: 'Selecting the object…',
}

/** The photo may have changed while the model ran; results only land on the one they were made for. */
const still = (session: Session) => editor.getState().photoId === session.id

async function store(photoId: string, kind: RasterKind, img: RasterImage): Promise<string> {
  const id = await (await ai()).putRaster(photoId, kind, img)
  provideRaster(id, img)
  return id
}

type Segmentable = Exclude<AiTarget, 'object'>

async function segment(session: Session, target: Segmentable, parts: PersonPart[] | undefined) {
  const { image, color } = session.photo
  const res = await runAi({ scope: 'mask', label: DETECTING[target], task: 'segment', target, parts, run: (core, o) => core.segment(target, image, color, { ...o, parts }) })
  if (!res) return null
  return { raster: await store(session.id, 'mask', res.value), model: res.model }
}

/** Subject / sky / background / people: a new layer, or (with `layerId`) another mask in that layer. */
export async function createAiMask(session: Session, target: Segmentable, opts: { parts?: PersonPart[]; layerId?: string; mode?: MaskMode } = {}) {
  const made = await segment(session, target, opts.parts)
  if (!made || !still(session)) return
  const shape: AiShape = { type: 'ai', target, ...(opts.parts && { parts: opts.parts }), raster: made.raster, model: made.model }
  const maskId = uid()
  if (opts.layerId) {
    const layerId = opts.layerId
    const mask = { ...shape, id: maskId, mode: opts.mode ?? 'add', invert: false } as Mask
    editor.apply((r) => addMask(r, layerId, mask), `${opts.mode === 'subtract' ? 'Subtract' : opts.mode === 'intersect' ? 'Intersect' : 'Add'} ${maskLabel(shape).toLowerCase()}`)
    view.set({ tool: 'mask', layer: layerId, mask: maskId })
    return
  }
  const r = editor.getState().recipe
  if (!r) return
  const layer = newLayer(r.layers, shape, { layer: uid(), mask: maskId })
  editor.apply((x) => ({ ...x, layers: [...x.layers, layer] }), `${maskLabel(shape)} mask`)
  view.set({ tool: 'mask', layer: layer.id, mask: maskId, placing: null, rangePick: false })
}

/** Select object: an empty object mask that clicks on the photo then shape. */
export function createObjectMask(opts: { layerId?: string; mode?: MaskMode } = {}) {
  const r = editor.getState().recipe
  if (!r) return
  const shape: AiShape = { type: 'ai', target: 'object', points: [], raster: '', model: '' }
  const maskId = uid()
  if (opts.layerId) {
    const layerId = opts.layerId
    editor.apply((x) => addMask(x, layerId, { ...shape, id: maskId, mode: opts.mode ?? 'add', invert: false } as Mask), 'Select object')
    view.set({ tool: 'mask', layer: layerId, mask: maskId })
    return
  }
  const layer = newLayer(r.layers, shape, { layer: uid(), mask: maskId })
  editor.apply((x) => ({ ...x, layers: [...x.layers, layer] }), 'Select object')
  view.set({ tool: 'mask', layer: layer.id, mask: maskId, placing: null, rangePick: false })
}

const aiMaskAt = (layerId: string, maskId: string) => {
  const m = editor.getState().recipe?.layers.find((l) => l.id === layerId)?.masks.find((x) => x.id === maskId)
  return m?.type === 'ai' ? m : null
}

/** A click on the photo while an object mask is selected: include (or with Alt, exclude) that spot. */
export async function addObjectPoint(session: Session, layerId: string, maskId: string, point: { x: number; y: number; positive: boolean }) {
  const m = aiMaskAt(layerId, maskId)
  if (!m || m.target !== 'object') return
  const points = [...(m.points ?? []), point]
  const { image, color } = session.photo
  const res = await runAi({ scope: 'mask', label: DETECTING.object, task: 'object', target: 'object', run: (core, o) => core.selectObject(points, image, color, o) })
  if (!res) return
  const raster = await store(session.id, 'mask', res.value)
  if (!still(session)) return
  editor.apply((r) => updateMask(r, layerId, maskId, (x) => ({ ...x, points, raster, model: res.model }) as Mask), point.positive ? 'Add to object' : 'Remove from object')
}

/** Compute again an AI mask whose stored result is missing (or was never made). */
export async function recomputeAiMask(session: Session, layerId: string, maskId: string) {
  const m = aiMaskAt(layerId, maskId)
  if (!m) return
  let made: { raster: string; model: string } | null
  if (m.target === 'object') {
    if (!m.points?.length) return
    const points = m.points
    const { image, color } = session.photo
    const res = await runAi({ scope: 'mask', label: DETECTING.object, task: 'object', target: 'object', run: (core, o) => core.selectObject(points, image, color, o) })
    made = res && { raster: await store(session.id, 'mask', res.value), model: res.model }
  } else made = await segment(session, m.target, m.parts)
  if (!made || !still(session)) return
  const { raster, model } = made
  editor.apply((r) => updateMask(r, layerId, maskId, (x) => ({ ...x, raster, model }) as Mask), `Recompute ${maskLabel(m).toLowerCase()} mask`)
}

// ---- Object removal ----

async function inpaint(session: Session, strokes: BrushStroke[]) {
  const { image, color } = session.photo
  const res = await runAi({ scope: 'remove', label: 'Removing…', task: 'inpaint', run: (core, o) => core.inpaint(image, color, { ...o, strokes }) })
  if (!res) return null
  return { rect: res.value.rect, fill: await store(session.id, 'fill', res.value.fill), model: res.model }
}

/** Fill the painted area; the painted strokes stay on screen meanwhile. */
export async function removeObject(session: Session, strokes: BrushStroke[]) {
  view.set({ removing: strokes })
  try {
    const made = await inpaint(session, strokes)
    if (!made || !still(session)) return
    const area: RemoveArea = { id: uid(), mode: 'remove', strokes, ...made }
    // Removals apply before heal / clone spots.
    editor.apply((r) => ({ ...r, retouch: [...r.retouch.filter((t) => !isSpot(t)), area, ...spotsOf(r.retouch)] }), 'Remove object')
    view.set({ spot: area.id })
  } finally {
    view.set({ removing: null })
  }
}

export async function recomputeRemoval(session: Session, id: string) {
  const area = editor.getState().recipe?.retouch.find((t): t is RemoveArea => t.id === id && t.mode === 'remove')
  if (!area) return
  const made = await inpaint(session, area.strokes)
  if (!made || !still(session)) return
  editor.apply((r) => ({ ...r, retouch: r.retouch.map((t) => (t.id === id ? { ...area, ...made } : t)) }), 'Recompute removal')
}

export function deleteRetouch(id: string, label: string) {
  editor.apply((r) => ({ ...r, retouch: r.retouch.filter((t) => t.id !== id) }), label)
  if (view.get().spot === id) view.set({ spot: null })
}

// ---- AI Denoise ----

export const DENOISE_DEFAULT = 50

/** Denoise the full-resolution photo; the result blends in by Amount. */
export async function runDenoise(session: Session) {
  const res = await runAi({
    scope: 'denoise',
    label: 'Denoising…',
    task: 'denoise',
    run: async (core, o) => {
      const full = await loadFullResolution(session.id, o.signal)
      return core.denoise(full.image, full.color, o)
    },
  })
  if (!res) return
  const img = res.value
  const raster = await store(session.id, 'denoise', { width: img.width, height: img.height, channels: 3, data: img.data })
  if (!still(session)) return
  const amount = editor.getState().recipe?.denoise?.amount ?? DENOISE_DEFAULT
  editor.apply((r) => ({ ...r, denoise: { amount, raster, model: res.model } }), 'AI Denoise')
}

export function removeDenoise() {
  editor.apply((r) => ({ ...r, denoise: undefined }), 'Remove AI Denoise')
}
