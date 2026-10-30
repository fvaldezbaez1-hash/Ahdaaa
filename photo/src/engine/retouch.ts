// Heal / clone spots and AI removals, applied in order to the source pixels (in
// source orientation, before white balance and everything else), so every later
// stage, every tile and the 100 % view see the same retouched photo.

import type { RemoveArea, Retouch, RetouchSpot } from '../edit/types'
import type { Size } from './geometry'
import type { Gpu, Target } from './gl'
import { removalRing } from './heal'
import { rasterizeBrush } from './local'
import { BLEND, COPY, NOISE_LEVEL, REMOVE, RING, RING_SAMPLES, SPOT } from './localShaders'
import { newSourceId, type ScaledSource } from './pipeline'
import type { Rasters } from './rasters'
import type { RasterImage, SourceImage } from './types'

/** A 3-channel raster (e.g. the denoised source) as a SourceImage. */
export function rasterAsSource(r: RasterImage): SourceImage {
  return { width: r.width, height: r.height, data: r.data instanceof Uint16Array ? r.data : Uint16Array.from(r.data, (v) => v * 257) }
}

/** AI noise reduction: mix(source, denoised, amount) of two windows scaled the same way. */
export function blendDenoised(gpu: Gpu, src: ScaledSource, denoised: ScaledSource, amount: number): ScaledSource {
  const t = gpu.target(src.tex.width, src.tex.height, 'rgba16f')
  gpu.program('blend', BLEND).tex('u_a', src.tex, 0).tex('u_b', denoised.tex, 1).f('u_t', Math.min(1, Math.max(0, amount)))
  gpu.draw(t)
  return { tex: t, x0: src.x0, y0: src.y0, scale: src.scale, id: newSourceId() }
}

/** A retouched copy of `src` (a window of the source at some scale; see ScaledSource). */
export function applyRetouch(gpu: Gpu, src: ScaledSource, items: readonly Retouch[], full: Size, rasters?: Rasters): ScaledSource {
  const { width: W, height: H } = src.tex
  const t = gpu.target(W, H, 'rgba16f', true)
  gpu.program('copy', COPY).tex('u_src', src.tex, 0).i('u_origin', 0, 0)
  gpu.draw(t)
  const L = Math.max(full.width, full.height), k = src.scale
  for (const item of items) {
    if (item.mode === 'remove') {
      removeArea(gpu, t, src, item, full, rasters)
      continue
    }
    const s: RetouchSpot = item
    const r = s.r * L * k
    if (!(r >= 0.5) || !(s.opacity > 0)) continue
    const dx = s.x * full.width * k - src.x0, dy = s.y * full.height * k - src.y0
    const sx = s.sx * full.width * k - src.x0, sy = s.sy * full.height * k - src.y0
    const x0 = Math.max(0, Math.floor(dx - r - 1)), y0 = Math.max(0, Math.floor(dy - r - 1))
    const x1 = Math.min(W, Math.ceil(dx + r + 1)), y1 = Math.min(H, Math.ceil(dy + r + 1))
    if (x1 <= x0 || y1 <= y0) continue
    let ring: Target | null = null
    if (s.mode === 'heal') {
      ring = gpu.target(RING_SAMPLES, 1, 'rgba32f')
      gpu.program('ring', RING).tex('u_img', t, 0).f('u_size', W, H).f('u_dst', dx, dy).f('u_src', sx, sy).f('u_r', r)
      gpu.draw(ring)
    }
    // Heal into a patch, then copy it back: a pass can't read and write the same texture.
    const patch = gpu.target(x1 - x0, y1 - y0, 'rgba16f')
    gpu.program('spot', SPOT).tex('u_img', t, 0).tex('u_ring', ring ?? gpu.dummy(), 1).f('u_size', W, H).f('u_origin', x0, y0)
      .f('u_dst', dx, dy).f('u_src', sx, sy).f('u_r', r).f('u_feather', s.feather / 100).f('u_opacity', Math.min(1, s.opacity)).b('u_heal', s.mode === 'heal')
    gpu.draw(patch)
    gpu.program('copy', COPY).tex('u_src', patch, 0).i('u_origin', x0, y0)
    gpu.drawRect(t, x0, y0, x1 - x0, y1 - y0)
    gpu.free(patch)
    gpu.free(ring)
  }
  return { tex: t, x0: src.x0, y0: src.y0, scale: src.scale, id: newSourceId() }
}

/** AI removal: the stored fill, grain matched to the surroundings, blended in through the strokes. */
function removeArea(gpu: Gpu, t: Target, src: ScaledSource, a: RemoveArea, full: Size, rasters?: Rasters) {
  const fill = rasters?.texture(a.fill)
  if (!fill || fill.img.channels !== 3 || !a.strokes.length) return
  const k = src.scale
  const rx = a.rect.x * full.width * k - src.x0, ry = a.rect.y * full.height * k - src.y0
  const rw = a.rect.w * full.width * k, rh = a.rect.h * full.height * k
  const x0 = Math.max(0, Math.floor(rx)), y0 = Math.max(0, Math.floor(ry))
  const x1 = Math.min(t.width, Math.ceil(rx + rw)), y1 = Math.min(t.height, Math.ceil(ry + rh))
  if (x1 <= x0 || y1 <= y0 || rw < 0.5 || rh < 0.5) return
  // The grain level is measured on a ring around the area, at this resolution (so preview, 100 % and tiles agree).
  const e = removalRing(rw / k, rh / k) * k
  const level = gpu.target(1, 1, 'rgba32f')
  gpu.program('noiseLevel', NOISE_LEVEL).tex('u_img', t, 0).f('u_ring', rx - e, ry - e, rx + rw + e, ry + rh + e)
  gpu.draw(level)
  const w = x1 - x0, h = y1 - y0
  const mask = rasterizeBrush(gpu, { region: { x: x0, y: y0, w, h }, toSource: [1 / k, 0, src.x0 / k, 0, 1 / k, src.y0 / k], fullSize: full }, a.strokes, w, h)
  const patch = gpu.target(w, h, 'rgba16f')
  gpu.program('remove', REMOVE).tex('u_img', t, 0).tex('u_mask', mask, 1).tex('u_level', level, 2).tex('u_fill', fill.tex, 3)
    .i('u_fillSize', fill.img.width, fill.img.height).f('u_rect', rx, ry, rw, rh).f('u_origin', x0, y0).f('u_abs', src.x0, src.y0)
  gpu.draw(patch)
  gpu.program('copy', COPY).tex('u_src', patch, 0).i('u_origin', x0, y0)
  gpu.drawRect(t, x0, y0, w, h)
  gpu.free(patch)
  gpu.free(mask)
  gpu.free(level)
}
