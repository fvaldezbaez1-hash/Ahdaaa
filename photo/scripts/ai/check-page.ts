// Runs in headless Chromium (see check.mjs): drives the real src/ai API on real
// photos and hands PNGs + timings back to Node.
import type { BrushStroke } from '../../src/edit/types'
import type { RasterImage, RenderedImage, SourceColor, SourceImage } from '../../src/engine/types'
import * as ai from '../../src/ai'
import { call } from '../../src/ai/client'
import { autoGain, modelSpace, toModel, toRgba8 } from '../../src/ai/color'
import { setModelBase } from '../../src/ai/models'
import { rasterizeStrokes } from '../../src/ai/pixels'

// This page lives in scripts/ai/; the models are served at the site root (public/models).
setModelBase(new URL('/', location.href).href)
import { decodeFile } from '../../src/io/api'

declare global {
  interface Window {
    saveOutput(name: string, b64: string): Promise<void>
    runCheck(plan: Plan): Promise<unknown>
  }
}

interface Plan {
  photos: Record<string, string>
  steps: Step[]
  wasmOnly?: boolean
}
type Step =
  | { op: 'download'; model: string }
  | { op: 'segment'; photo: string; target: 'subject' | 'sky' | 'background' | 'person'; parts?: ('face' | 'body' | 'hair' | 'clothes' | 'accessories')[]; model?: string; name: string }
  | { op: 'select'; photo: string; points: { x: number; y: number; positive: boolean }[]; model?: string; name: string }
  | { op: 'inpaint'; photo: string; strokes: BrushStroke[]; name: string }
  | { op: 'denoise'; photo: string; crop?: { x: number; y: number; w: number; h: number }; noise?: number; name: string }
  | { op: 'upscale'; photo: string; crop?: { x: number; y: number; w: number; h: number }; name: string }

const decoded = new Map<string, { image: SourceImage; color: SourceColor }>()
async function photo(url: string) {
  let d = decoded.get(url)
  if (!d) {
    const blob = await (await fetch(url)).blob()
    const r = await decodeFile(blob, { fileName: url.split('/').pop()!, quality: 'full', maxLongEdge: 2048 })
    d = { image: r.image, color: r.color }
    decoded.set(url, d)
  }
  return d
}

/** Full-resolution decode (for removal and denoise). */
const full = new Map<string, { image: SourceImage; color: SourceColor }>()
async function fullPhoto(url: string) {
  let d = full.get(url)
  if (!d) {
    const blob = await (await fetch(url)).blob()
    const r = await decodeFile(blob, { fileName: url.split('/').pop()!, quality: 'full' })
    d = { image: r.image, color: r.color }
    full.set(url, d)
  }
  return d
}

function displayRgba(img: SourceImage, color: SourceColor, gain?: number): Uint8ClampedArray<ArrayBuffer> {
  const space = modelSpace(color, gain ?? autoGain(img.data, color))
  return toRgba8(toModel(img.data, space))
}

async function png(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Photo with the mask shown: masked area full colour + red tint, rest dimmed. Side by side with the bare mask. */
function overlay(img: SourceImage, color: SourceColor, mask: RasterImage): { rgba: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
  const base = displayRgba(img, color)
  const w = img.width, h = img.height
  const out = new Uint8ClampedArray(w * 2 * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / w)), my = Math.min(mask.height - 1, Math.floor((y * mask.height) / h))
      const m = (mask.data[my * mask.width + mx] as number) / 255
      const i = (y * w + x) * 4, o = (y * w * 2 + x) * 4, o2 = (y * w * 2 + w + x) * 4
      out[o] = base[i] * (0.35 + 0.65 * m) + 120 * m
      out[o + 1] = base[i + 1] * (0.35 + 0.65 * m) * (1 - 0.25 * m)
      out[o + 2] = base[i + 2] * (0.35 + 0.65 * m) * (1 - 0.25 * m)
      out[o + 3] = 255
      out[o2] = out[o2 + 1] = out[o2 + 2] = m * 255
      out[o2 + 3] = 255
    }
  return { rgba: out, w: w * 2, h }
}

/** Composite a removal fill into a copy of the source through the painted strokes (as the engine does, without its feathering). */
function composite(img: SourceImage, rect: { x: number; y: number; w: number; h: number }, fill: RasterImage, strokes: BrushStroke[]): SourceImage {
  const out = img.data.slice()
  const W = img.width, H = img.height
  const x0 = Math.round(rect.x * W), y0 = Math.round(rect.y * H), rw = Math.round(rect.w * W), rh = Math.round(rect.h * H)
  const mask = rasterizeStrokes(strokes, { x: x0 / W, y: y0 / H, w: rw / W, h: rh / H }, rw, rh, W, H)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      if (!mask[y * rw + x]) continue
      const fx = Math.min(fill.width - 1, Math.floor((x * fill.width) / rw)), fy = Math.min(fill.height - 1, Math.floor((y * fill.height) / rh))
      for (let c = 0; c < 3; c++) out[((y0 + y) * W + x0 + x) * 3 + c] = fill.data[(fy * fill.width + fx) * 3 + c]
    }
  return { ...img, data: out }
}

function crop(img: SourceImage, r: { x: number; y: number; w: number; h: number }): SourceImage {
  const data = new Uint16Array(r.w * r.h * 3)
  for (let y = 0; y < r.h; y++) data.set(img.data.subarray(((r.y + y) * img.width + r.x) * 3, ((r.y + y) * img.width + r.x + r.w) * 3), y * r.w * 3)
  return { width: r.w, height: r.h, data }
}

function sideBySide(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * 2 * h * 4)
  for (let y = 0; y < h; y++) {
    out.set(a.subarray(y * w * 4, (y + 1) * w * 4), y * w * 8)
    out.set(b.subarray(y * w * 4, (y + 1) * w * 4), y * w * 8 + w * 4)
  }
  return out
}

window.runCheck = async (plan: Plan) => {
  const log: Record<string, unknown>[] = []
  const support = await ai.aiSupport()
  log.push({ step: 'support', ...support })
  for (const s of plan.steps) {
    const t0 = performance.now()
    try {
      if (s.op === 'download') {
        let last = 0
        await ai.downloadModel(s.model, { onProgress: (l) => (last = l) })
        const info = await ai.modelFor('segment') // touches the store
        log.push({ step: `download ${s.model}`, bytes: last, ms: Math.round(performance.now() - t0), ok: !!info })
        continue
      }
      const url = plan.photos[s.photo]
      if (s.op === 'segment') {
        const { image, color } = await photo(url)
        const mask = await ai.segment(s.target, image, color, { parts: s.parts, model: s.model })
        const o = overlay(image, color, mask)
        await window.saveOutput(`${s.name}.png`, await png(o.rgba, o.w, o.h))
        log.push({ step: s.name, ...ai.lastRun(), total: Math.round(performance.now() - t0), size: `${mask.width}x${mask.height}`, heapMB: Math.round((await call('heap', undefined as never)) / 1e6) })
      } else if (s.op === 'select') {
        const { image, color } = await photo(url)
        const t = performance.now()
        const mask = await ai.selectObject(s.points, image, color, { model: s.model })
        const first = Math.round(performance.now() - t)
        const firstRun = ai.lastRun()
        const t2 = performance.now()
        await ai.selectObject(s.points, image, color, { model: s.model }) // second click on the same photo: decoder only
        const again = Math.round(performance.now() - t2)
        const o = overlay(image, color, mask)
        // Mark the clicks.
        for (const p of s.points) {
          const cx = Math.round(p.x * image.width), cy = Math.round(p.y * image.height)
          for (let dy = -4; dy <= 4; dy++)
            for (let dx = -4; dx <= 4; dx++) {
              const x = cx + dx, y = cy + dy
              if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
              const i = (y * o.w + x) * 4
              o.rgba[i] = p.positive ? 0 : 255
              o.rgba[i + 1] = p.positive ? 255 : 0
              o.rgba[i + 2] = 0
            }
        }
        await window.saveOutput(`${s.name}.png`, await png(o.rgba, o.w, o.h))
        log.push({ step: s.name, model: firstRun?.model, firstMs: first, firstEncodeMs: firstRun?.encodeMs, firstDecodeMs: firstRun?.decodeMs, againMs: again, againEncodeMs: ai.lastRun()?.encodeMs, againDecodeMs: ai.lastRun()?.decodeMs })
      } else if (s.op === 'inpaint') {
        const { image, color } = await fullPhoto(url)
        const r = await ai.inpaint(image, color, { strokes: s.strokes })
        const after = composite(image, r.rect, r.fill, s.strokes)
        const gain = autoGain(image.data, color)
        // Show the region around the rect at full resolution: before | after.
        const W = image.width, H = image.height
        const cx = (r.rect.x + r.rect.w / 2) * W, cy = (r.rect.y + r.rect.h / 2) * H
        const side = Math.min(W, H, Math.max(320, Math.round(Math.max(r.rect.w * W, r.rect.h * H) * 2)))
        const region = { x: Math.round(Math.min(W - side, Math.max(0, cx - side / 2))), y: Math.round(Math.min(H - side, Math.max(0, cy - side / 2))), w: side, h: side }
        const a = displayRgba(crop(image, region), color, gain), b = displayRgba(crop(after, region), color, gain)
        await window.saveOutput(`${s.name}.png`, await png(sideBySide(a, b, side, side), side * 2, side))
        log.push({ step: s.name, ...ai.lastRun(), total: Math.round(performance.now() - t0), rect: r.rect, fill: `${r.fill.width}x${r.fill.height}`, source: `${W}x${H}` })
      } else if (s.op === 'denoise') {
        const { image, color } = await fullPhoto(url)
        let src = s.crop ? crop(image, s.crop) : image
        if (s.noise) {
          // Synthetic camera-like noise (signal-dependent, in linear light), seeded.
          const d = src.data.slice()
          let seed = 12345
          const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
          for (let i = 0; i < d.length; i += 1) {
            const g = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd())
            const v = d[i] / 65535
            d[i] = Math.max(0, Math.min(65535, Math.round((v + g * Math.sqrt(s.noise * s.noise * 0.2 * v + (s.noise * 0.1) ** 2)) * 65535)))
          }
          src = { ...src, data: d }
        }
        const gain = autoGain(src.data, color)
        const out = await ai.denoise(src, color, { onProgress: () => undefined })
        const a = displayRgba(src, color, gain), b = displayRgba(out, color, gain)
        await window.saveOutput(`${s.name}.png`, await png(sideBySide(a, b, src.width, src.height), src.width * 2, src.height))
        log.push({ step: s.name, ...ai.lastRun(), size: `${src.width}x${src.height}`, msPerMp: Math.round((ai.lastRun()!.ms * 1e6) / (src.width * src.height)) })
      } else if (s.op === 'upscale') {
        const { image, color } = await photo(url)
        const src = s.crop ? crop(image, s.crop) : image
        const rgba = displayRgba(src, color, 1)
        const r: RenderedImage = { width: src.width, height: src.height, data: rgba, bitDepth: 8, colorSpace: 'srgb' }
        const up = await ai.upscale(r)
        // Left: browser bilinear 2×; right: Real-ESRGAN 2×.
        const c = new OffscreenCanvas(up.width, up.height)
        const g = c.getContext('2d')!
        g.imageSmoothingQuality = 'high'
        g.drawImage(await createImageBitmap(new ImageData(rgba, src.width, src.height)), 0, 0, up.width, up.height)
        const bil = g.getImageData(0, 0, up.width, up.height).data
        await window.saveOutput(`${s.name}.png`, await png(sideBySide(bil, up.data as Uint8ClampedArray, up.width, up.height), up.width * 2, up.height))
        log.push({ step: s.name, ...ai.lastRun(), size: `${src.width}x${src.height}`, msPerMp: Math.round((ai.lastRun()!.ms * 1e6) / (src.width * src.height)) })
      }
    } catch (e) {
      log.push({ step: 'name' in s ? s.name : s.op, error: `${(e as Error).name}: ${(e as Error).message}` })
    }
  }
  return log
}
