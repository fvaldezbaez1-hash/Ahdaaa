// Heal / clone spots, applied in order to the source pixels (in source
// orientation, before white balance and everything else), so every later stage,
// every tile and the 100 % view see the same retouched photo.

import type { RetouchSpot } from '../edit/types'
import type { Size } from './geometry'
import type { Gpu, Target } from './gl'
import { COPY, RING, RING_SAMPLES, SPOT } from './localShaders'
import { newSourceId, type ScaledSource } from './pipeline'

/** A retouched copy of `src` (a window of the source at some scale; see ScaledSource). */
export function applySpots(gpu: Gpu, src: ScaledSource, spots: RetouchSpot[], full: Size): ScaledSource {
  const { width: W, height: H } = src.tex
  const t = gpu.target(W, H, 'rgba16f', true)
  gpu.program('copy', COPY).tex('u_src', src.tex, 0).i('u_origin', 0, 0)
  gpu.draw(t)
  const L = Math.max(full.width, full.height), k = src.scale
  for (const s of spots) {
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
