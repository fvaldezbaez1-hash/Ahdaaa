// What each model does, inside the AI worker: convert to the model's input,
// run it, turn the output into a mask / fill / tile. One large model resident
// at a time on phones.
import type { ImageSegmenter, InteractiveSegmenter, InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision'
import type { PersonPart } from '../../edit/types'
import type { SourceColor } from '../../engine/types'
import { lowMemory } from '../../io/platform'
import { autoGain, fromModelFloat, modelSpace, toModel, toPlanar, toRgba8, type ModelSpace } from '../color'
import { readModelFile } from '../models'
import { contrast, downscale, fit, guidedFilter, luma, morph, resize, toMask8 } from '../pixels'
import { modelEntry } from '../registry'
import { skyMask } from '../sky'
import * as mediapipe from './mediapipe'
import { createSession, read, run, type Backend, type OrtModel } from './ort'

export interface Img {
  width: number
  height: number
  data: Uint16Array
}

export interface MaskResult {
  mask: Uint8Array
  width: number
  height: number
  backend: Backend
}

// ---------- model residency ----------

type Loaded =
  | { kind: 'ort'; m: OrtModel }
  | { kind: 'segmenter'; s: ImageSegmenter }
  | { kind: 'interactive'; s: InteractiveSegmenter; imageKey?: string }
  | { kind: 'legacy'; s: InteractiveSegmenterLegacy }
const loaded = new Map<string, Loaded>()
/** Bytes handed over by the main thread when Cache Storage isn't available. */
const handed = new Map<string, ArrayBuffer[]>()

export function provideFiles(id: string, files: ArrayBuffer[]) {
  handed.set(id, files)
}

async function fileBytes(id: string, index: number): Promise<ArrayBuffer> {
  return handed.get(id)?.[index] ?? readModelFile(id, index)
}

function close(id: string) {
  const l = loaded.get(id)
  if (!l) return
  loaded.delete(id)
  if (l.kind === 'ort') void l.m.session.release()
  else l.s.close()
}

export function releaseAll() {
  for (const id of [...loaded.keys()]) close(id)
}

/** Phones keep one model at a time (iOS kills the page at ~1.5–2 GB including the GPU). */
function makeRoom(id: string) {
  if (!lowMemory()) return
  for (const k of [...loaded.keys()]) if (k !== id) close(k)
}

async function ortModel(id: string, wasmOnly = false): Promise<OrtModel> {
  const l = loaded.get(id)
  if (l?.kind === 'ort') return l.m
  makeRoom(id)
  const m = await createSession(await fileBytes(id, 0), { lowMemory: lowMemory(), wasmOnly })
  loaded.set(id, { kind: 'ort', m })
  return m
}

async function segmenter(key: string, id: string, index: number): Promise<ImageSegmenter> {
  const l = loaded.get(key)
  if (l?.kind === 'segmenter') return l.s
  makeRoom(key)
  const s = await mediapipe.imageSegmenter(await fileBytes(id, index))
  loaded.set(key, { kind: 'segmenter', s })
  return s
}

// ---------- shared ----------

interface Prepared {
  w: number
  h: number
  /** Model-space RGB, interleaved, 0…1. */
  rgb: Float32Array
  grey: Float32Array
}

function prepare(img: Img, color: SourceColor): Prepared {
  const space = modelSpace(color, autoGain(img.data, color))
  const rgb = toModel(img.data, space)
  return { w: img.width, h: img.height, rgb, grey: luma(rgb) }
}

/** Snap a coarse mask (any size) to the photo's edges at the prepared size. */
function refine(p: Prepared, coarse: Float32Array, cw: number, ch: number, strength = 1): Float32Array {
  const m = cw === p.w && ch === p.h ? coarse : resize(coarse, cw, ch, p.w, p.h)
  const r = Math.max(2, Math.round((Math.max(p.w, p.h) / 256) * strength))
  return guidedFilter(p.grey, m, p.w, p.h, r, 1e-3)
}

function imageData(p: Prepared): ImageData {
  return new ImageData(toRgba8(p.rgb), p.w, p.h)
}

const normalizeMinMax = (a: Float32Array) => {
  let lo = Infinity, hi = -Infinity
  for (const v of a) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const k = hi > lo ? 1 / (hi - lo) : 0
  return a.map((v) => (v - lo) * k)
}

// ---------- subject / background ----------

const SUBJECT_INPUT: Record<string, { size: number; mean: number[]; std: number[] }> = {
  u2netp: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
  'isnet-general': { size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1] },
}

async function subject(p: Prepared, modelId: string): Promise<{ mask: Float32Array; backend: Backend }> {
  const cfg = SUBJECT_INPUT[modelId]
  const m = await ortModel(modelId)
  const s = cfg.size
  const small = downscale(p.rgb, p.w, p.h, s, s, 3)
  // As the models were trained (rembg): scale so the brightest value is 1, then normalize.
  let max = 0
  for (const v of small) if (v > max) max = v
  if (max > 0) for (let i = 0; i < small.length; i++) small[i] /= max
  const out = await run(m, { [m.session.inputNames[0]]: { type: 'float32', data: toPlanar(small, s * s, cfg.mean, cfg.std), dims: [1, 3, s, s] } })
  const pred = normalizeMinMax(await read<Float32Array>(out[m.session.outputNames[0]]))
  for (const t of Object.values(out)) t.dispose()
  // Firm up the model's soft guess, then follow the photo's edges.
  const mask = contrast(refine(p, contrast(pred, 0.15, 0.85), s, s), 0.2, 0.8)
  return { mask, backend: m.backend }
}

// ---------- people ----------

/** selfie_multiclass_256x256 classes. */
const PART_CLASS: Record<PersonPart, number> = { hair: 1, body: 2, face: 3, clothes: 4, accessories: 5 }

async function multiclass(modelId: string, data: ImageData): Promise<Float32Array[]> {
  const s = await segmenter(`${modelId}#0`, modelId, 0)
  const r = s.segment(data)
  const masks = (r.confidenceMasks ?? []).map((m) => m.getAsFloat32Array().slice())
  r.close()
  return masks
}

async function people(p: Prepared, modelId: string, parts: PersonPart[] | undefined): Promise<Float32Array> {
  const classes = parts?.length ? parts.map((x) => PART_CLASS[x]) : null
  const pick = (masks: Float32Array[], n: number) => {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      if (!classes) out[i] = 1 - masks[0][i]
      else for (const c of classes) out[i] += masks[c][i]
    }
    return out
  }
  const work = fit(p.w, p.h, 1024)
  const small: Prepared = work.width === p.w ? p : { w: work.width, h: work.height, rgb: downscale(p.rgb, p.w, p.h, work.width, work.height, 3), grey: new Float32Array(0) }
  const whole = await multiclass(modelId, imageData(small))
  let mask = pick(whole, small.w * small.h)

  // Small people: look again at a square crop around them (the model sees 256×256).
  const person = whole[0].map((v) => 1 - v)
  let x0 = small.w, y0 = small.h, x1 = -1, y1 = -1
  for (let y = 0; y < small.h; y++)
    for (let x = 0; x < small.w; x++)
      if (person[y * small.w + x] > 0.5) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  if (x1 >= 0 && (x1 - x0) * (y1 - y0) < 0.35 * small.w * small.h) {
    const side = Math.min(Math.max(small.w, small.h), Math.round(Math.max(x1 - x0, y1 - y0) * 1.3) + 16)
    const cw = Math.min(small.w, side), ch = Math.min(small.h, side)
    const cx = Math.round(Math.min(small.w - cw, Math.max(0, (x0 + x1) / 2 - cw / 2)))
    const cy = Math.round(Math.min(small.h - ch, Math.max(0, (y0 + y1) / 2 - ch / 2)))
    const crop = new Float32Array(cw * ch * 3)
    for (let y = 0; y < ch; y++) crop.set(small.rgb.subarray(((cy + y) * small.w + cx) * 3, ((cy + y) * small.w + cx + cw) * 3), y * cw * 3)
    const zoomed = await multiclass(modelId, new ImageData(toRgba8(crop), cw, ch))
    const z = pick(zoomed, cw * ch)
    // Inside the crop the closer look wins (feathered over 8 px at the crop's border).
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const edge = Math.min(x, y, cw - 1 - x, ch - 1 - y)
        const t = cx + x === 0 || cy + y === 0 || cx + x === small.w - 1 || cy + y === small.h - 1 ? 1 : Math.min(1, edge / 8)
        const i = (cy + y) * small.w + cx + x
        mask[i] = mask[i] * (1 - t) + z[y * cw + x] * t
      }
  }

  if (classes?.includes(PART_CLASS.hair) && (modelEntry(modelId)?.files.length ?? 0) > 1) {
    // The dedicated hair model has finer strands; keep it near people only.
    const hs = await segmenter(`${modelId}#1`, modelId, 1)
    const r = hs.segment(imageData(small))
    const hair = r.confidenceMasks?.[1]?.getAsFloat32Array()
    if (hair) {
      const near = morph(person, small.w, small.h, Math.round(Math.max(small.w, small.h) / 64), 'dilate')
      for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], Math.min(hair[i], near[i]))
    }
    r.close()
  }
  for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, mask[i])
  return contrast(refine(p, mask, small.w, small.h, 0.75), 0.1, 0.9)
}

// ---------- sky ----------

async function depth(p: Prepared, modelId: string): Promise<{ disparity: Float32Array; size: number; backend: Backend }> {
  const m = await ortModel(modelId)
  const s = 518
  const small = resize(p.rgb, p.w, p.h, s, s, 3)
  const out = await run(m, { [m.session.inputNames[0]]: { type: 'float32', data: toPlanar(small, s * s, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]), dims: [1, 3, s, s] } })
  const d = await read<Float32Array>(out[m.session.outputNames[0]])
  for (const t of Object.values(out)) t.dispose()
  return { disparity: d.slice(), size: s, backend: m.backend }
}

// ---------- public ops ----------

export async function segment(args: { target: 'subject' | 'background' | 'person' | 'sky'; parts?: PersonPart[]; image: Img; color: SourceColor; modelId: string }): Promise<MaskResult> {
  const p = prepare(args.image, args.color)
  let mask: Float32Array
  let backend: Backend = 'wasm'
  if (args.target === 'person') mask = await people(p, args.modelId, args.parts)
  else if (args.target === 'sky') {
    const d = await depth(p, args.modelId)
    backend = d.backend
    mask = skyMask(p.rgb, p.grey, p.w, p.h, d)
  } else {
    const r = await subject(p, args.modelId)
    backend = r.backend
    mask = args.target === 'background' ? r.mask.map((v) => 1 - v) : r.mask
  }
  return { mask: toMask8(mask), width: p.w, height: p.h, backend }
}

export async function selectObject(args: { points: { x: number; y: number; positive: boolean }[]; image?: Img; imageKey: string; color: SourceColor; modelId: string }): Promise<MaskResult & { encodeMs: number; decodeMs: number }> {
  const t0 = performance.now()
  let encodeMs = 0
  if (modelEntry(args.modelId)?.files[0].file.endsWith('.tflite')) return { ...(await selectLegacy(args)), encodeMs: 0, decodeMs: performance.now() - t0 }
  let l = loaded.get(args.modelId)
  if (l?.kind !== 'interactive') {
    makeRoom(args.modelId)
    l = { kind: 'interactive', s: await mediapipe.interactiveSegmenter(await fileBytes(args.modelId, 0)) }
    loaded.set(args.modelId, l)
  }
  let size = { w: 0, h: 0 }
  if (l.imageKey !== args.imageKey) {
    if (!args.image) throw new Error('needs-image')
    const p = prepare(args.image, args.color)
    const t = performance.now()
    l.s.setImage(imageData(p))
    encodeMs = performance.now() - t
    l.imageKey = args.imageKey
    lastSize.set(args.modelId, (size = { w: p.w, h: p.h }))
  } else size = lastSize.get(args.modelId) ?? size
  const t1 = performance.now()
  const strokes = args.points.map((pt) => ({ brushMode: pt.positive ? mediapipe.BRUSH.positive : mediapipe.BRUSH.negative, point: [{ x: pt.x, y: pt.y }], isCompleted: true }))
  const m = l.s.segment(strokes)
  const f = m.hasFloat32Array() || !m.hasUint8Array() ? m.getAsFloat32Array().slice() : Float32Array.from(m.getAsUint8Array(), (v) => v / 255)
  const w = m.width, h = m.height
  m.close()
  const decodeMs = performance.now() - t1
  // Stored at the size the image was given (the model's own output may be smaller).
  const mask = w === size.w && h === size.h ? f : resize(f, w, h, size.w || w, size.h || h)
  return { mask: toMask8(mask), width: size.w || w, height: size.h || h, backend: 'wasm', encodeMs, decodeMs }
}

/** Magic Touch v1: one model run per selection, positive points as a scribble; negative points cut out what a click there would select. */
async function selectLegacy(args: { points: { x: number; y: number; positive: boolean }[]; image?: Img; color: SourceColor; modelId: string }): Promise<MaskResult> {
  if (!args.image) throw new Error('needs-image')
  const key = `${args.modelId}#legacy`
  let l = loaded.get(key)
  if (l?.kind !== 'legacy') {
    makeRoom(key)
    l = { kind: 'legacy', s: await mediapipe.legacyInteractiveSegmenter(await fileBytes(args.modelId, 0)) }
    loaded.set(key, l)
  }
  const s = l.s
  const p = prepare(args.image, args.color)
  const data = imageData(p)
  const one = (pts: { x: number; y: number }[]) => {
    let out: Float32Array = new Float32Array(p.w * p.h)
    s.segment(data, pts.length === 1 ? { keypoint: pts[0] } : { scribble: pts }, (r) => {
      const m = r.confidenceMasks?.[0]
      if (m) out = m.width === p.w && m.height === p.h ? m.getAsFloat32Array().slice() : resize(m.getAsFloat32Array(), m.width, m.height, p.w, p.h)
    })
    return out
  }
  const pos = args.points.filter((x) => x.positive), neg = args.points.filter((x) => !x.positive)
  const mask = pos.length ? one(pos) : new Float32Array(p.w * p.h)
  for (const n of neg) {
    const cut = one([n])
    for (let i = 0; i < mask.length; i++) mask[i] = Math.min(mask[i], 1 - cut[i])
  }
  return { mask: toMask8(refine(p, mask, p.w, p.h, 0.5)), width: p.w, height: p.h, backend: 'wasm' }
}
const lastSize = new Map<string, { w: number; h: number }>()

/** MI-GAN on a model-size crop (512²): `hole` 1 = fill. Returns the fill (source space) over `rect` (model pixels), resized to `out`. */
export async function inpaint(args: { crop: Img; hole: Uint8Array; color: SourceColor; rect: { x: number; y: number; w: number; h: number }; out: { width: number; height: number }; modelId: string }): Promise<{ fill: Uint16Array; backend: Backend }> {
  const { width: s, height: s2 } = args.crop
  if (s !== s2) throw new Error('Inpainting expects a square crop')
  const space = modelSpace(args.color, autoGain(args.crop.data, args.color))
  const rgb = toModel(args.crop.data, space)
  const n = s * s
  const image = new Uint8Array(n * 3)
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) image[c * n + p] = Math.round(rgb[p * 3 + c] * 255)
  const mask = new Uint8Array(n)
  for (let p = 0; p < n; p++) mask[p] = args.hole[p] ? 0 : 255
  const m = await ortModel(args.modelId)
  const out = await run(m, { image: { type: 'uint8', data: image, dims: [1, 3, s, s] }, mask: { type: 'uint8', data: mask, dims: [1, 1, s, s] } })
  const res = await read<Uint8Array>(out[m.session.outputNames[0]])
  for (const t of Object.values(out)) t.dispose()
  // Model output → float RGB (dithered by ±½ step so pushed shadows don't band) → the rect → fill size.
  const f = new Float32Array(n * 3)
  let seed = 0x9e3779b9
  for (let c = 0; c < 3; c++)
    for (let p = 0; p < n; p++) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      const v = res[c * n + p]
      f[p * 3 + c] = Math.min(255, Math.max(0, v + (v > 0 && v < 255 ? ((seed >>> 0) / 4294967296 - 0.5) : 0))) / 255
    }
  const fill = sampleRect(f, s, s, args.rect, args.out.width, args.out.height)
  const src = fromModelFloat(fill, space)
  const u16 = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i++) u16[i] = Math.min(65535, Math.max(0, Math.round(src[i])))
  return { fill: u16, backend: m.backend }
}

/** Bilinear samples of the region `r` (pixel coordinates) of an interleaved RGB image, at ow × oh. */
export function sampleRect(rgb: Float32Array, w: number, h: number, r: { x: number; y: number; w: number; h: number }, ow: number, oh: number): Float32Array {
  const out = new Float32Array(ow * oh * 3)
  for (let y = 0; y < oh; y++) {
    const fy = Math.min(h - 1, Math.max(0, r.y + ((y + 0.5) * r.h) / oh - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < ow; x++) {
      const fx = Math.min(w - 1, Math.max(0, r.x + ((x + 0.5) * r.w) / ow - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      for (let c = 0; c < 3; c++) {
        const a = rgb[(y0 * w + x0) * 3 + c], b = rgb[(y0 * w + x1) * 3 + c], d = rgb[(y1 * w + x0) * 3 + c], e = rgb[(y1 * w + x1) * 3 + c]
        out[(y * ow + x) * 3 + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
      }
    }
  }
  return out
}

/**
 * SCUNet on one tile. Returns source-space floats: the original plus the
 * model's change (so clipped highlights and out-of-gamut colors survive).
 */
export async function denoiseTile(args: { tile: Img; color: SourceColor; gain: number; modelId: string }): Promise<{ data: Float32Array; backend: Backend }> {
  const { width: w, height: h, data } = args.tile
  const space: ModelSpace = modelSpace(args.color, args.gain)
  const rgb = toModel(data, space)
  const m = await ortModel(args.modelId)
  const n = w * h
  const out = await run(m, { [m.session.inputNames[0]]: { type: 'float32', data: toPlanar(rgb, n), dims: [1, 3, h, w] } })
  const den = await read<Float32Array>(out[m.session.outputNames[0]])
  const inter = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) inter[p * 3 + c] = den[c * n + p]
  for (const t of Object.values(out)) t.dispose()
  const a = fromModelFloat(inter, space)
  const b = fromModelFloat(rgb, space)
  for (let i = 0; i < a.length; i++) a[i] = data[i] + a[i] - b[i]
  return { data: a, backend: m.backend }
}

/** Real-ESRGAN ×2 on one tile of display-encoded RGB 0…1 (interleaved). */
export async function upscaleTile(args: { rgb: Float32Array; width: number; height: number; modelId: string }): Promise<{ data: Float32Array; backend: Backend }> {
  const { width: w, height: h } = args
  const m = await ortModel(args.modelId)
  const out = await run(m, { input: { type: 'float32', data: toPlanar(args.rgb, w * h), dims: [1, 3, h, w] } })
  const up = await read<Float32Array>(out[m.session.outputNames[0]])
  for (const t of Object.values(out)) t.dispose()
  const n = 4 * w * h
  const inter = new Float32Array(n * 3)
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) inter[p * 3 + c] = Math.min(1, Math.max(0, up[c * n + p]))
  return { data: inter, backend: m.backend }
}
