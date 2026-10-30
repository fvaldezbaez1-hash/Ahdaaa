// Local layers on the GPU: each layer's combined mask for the current region
// (cached per layer, rebuilt only when that layer's masks change), and the
// per-pixel sum of what the layers add to the sliders (4 RGBA targets).

import type { LocalLayer, Mask } from '../edit/types'
import { applyAffine, invertAffine, type Affine, type Size } from './geometry'
import type { Gpu, Target } from './gl'
import { LOCAL, MASK, SEGMENT_FRAG, SEGMENT_VERT, STROKE } from './localShaders'
import { drawableMasks, layerVector } from './masks'
import type { Rect, StageCache } from './pipeline'

export interface MaskFrame {
  region: Rect
  /** Output px → full-resolution source px. */
  toSource: Affine
  fullSize: Size
  outLuma: number[]
}

interface Stage {
  target: Target
  version: number
}

// Serializing big brush masks on every frame would cost more than the render: the editor
// replaces objects it changes, so an unchanged mask list keeps its key.
const keys = new WeakMap<object, string>()
function keyOf(o: object): string {
  let k = keys.get(o)
  if (k === undefined) {
    k = JSON.stringify(o)
    keys.set(o, k)
  }
  return k
}

const MODES = { add: 0, subtract: 1, intersect: 2 }

/** Each layer's combined mask (0…1) over the region. `base` = the photo developed without layers, for range masks. */
export function layerMasks(gpu: Gpu, cache: StageCache, f: MaskFrame, layers: LocalLayer[], base: Stage | null): Map<string, Stage> {
  const out = new Map<string, Stage>()
  for (const layer of layers) {
    const masks = drawableMasks(layer.masks)
    const usesBase = masks.some((m) => m.type === 'range')
    const key = JSON.stringify([keyOf(layer.masks), f.region, f.toSource, f.fullSize, usesBase ? base?.version : 0])
    out.set(layer.id, cache.run('mask:' + layer.id, key, f.region.w, f.region.h, 'r16f', false, (t) => drawMasks(gpu, f, masks, base?.target ?? null, t)))
  }
  cache.prune('mask:', new Set(layers.map((l) => 'mask:' + l.id)))
  return out
}

function drawMasks(gpu: Gpu, f: MaskFrame, masks: Mask[], base: Target | null, out: Target) {
  const { w: W, h: H } = f.region
  const m = f.toSource
  const px = Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]))
  const SW = f.fullSize.width, SH = f.fullSize.height, L = Math.max(SW, SH)
  let prev: Target | null = null
  masks.forEach((mask, i) => {
    const dst = i === masks.length - 1 ? out : gpu.target(W, H, 'r16f')
    const brush = mask.type === 'brush' ? rasterizeBrush(gpu, f, mask, W, H) : null
    const p = gpu.program('mask', MASK)
    p.tex('u_prev', prev ?? gpu.dummy(), 0).tex('u_brush', brush ?? gpu.dummy(), 1).tex('u_base', base ?? gpu.dummy(), 2)
      .b('u_first', i === 0).i('u_mode', MODES[mask.mode] ?? 0).b('u_invert', mask.invert)
      .m3('u_toSource', [m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1]).f('u_regionOrigin', f.region.x, f.region.y).f('u_px', px).f('u_outLuma', f.outLuma[0], f.outLuma[1], f.outLuma[2])
    if (mask.type === 'linear') p.i('u_type', 0).f('u_a', mask.x1 * SW, mask.y1 * SH, mask.x2 * SW, mask.y2 * SH)
    else if (mask.type === 'radial') p.i('u_type', 1).f('u_a', mask.cx * SW, mask.cy * SH, Math.max(1e-6, mask.rx * L), Math.max(1e-6, mask.ry * L)).f('u_b', (mask.angle * Math.PI) / 180, mask.feather / 100, 0, 0)
    else if (mask.type === 'brush') p.i('u_type', 2)
    else if (mask.type === 'range' && mask.range === 'color') p.i('u_type', 4).f('u_a', ((mask.hue ?? 0) * Math.PI) / 180, (mask.sat ?? 0) / 100, mask.high / 100, mask.smooth / 100)
    else if (mask.type === 'range') p.i('u_type', 3).f('u_a', mask.low / 100, mask.high / 100, mask.smooth / 100, 0)
    gpu.draw(dst)
    gpu.free(brush)
    gpu.free(prev)
    prev = dst === out ? null : dst
  })
}

/**
 * Brush strokes as capsules in region pixels (exact distance, so any resolution and any tile
 * agrees). A stroke is the union (max) of its segments at `flow`; strokes build up (screen)
 * or erase (× 1 − s) in order.
 */
function rasterizeBrush(gpu: Gpu, f: MaskFrame, mask: Extract<Mask, { type: 'brush' }>, W: number, H: number): Target {
  const acc = gpu.target(W, H, 'r16f')
  gpu.clear(acc)
  const inv = invertAffine(f.toSource)
  const SW = f.fullSize.width, SH = f.fullSize.height, L = Math.max(SW, SH)
  const px = Math.sqrt(Math.abs(f.toSource[0] * f.toSource[4] - f.toSource[1] * f.toSource[3]))
  const segs: number[] = []
  const draws: { start: number; count: number; r: number; inner: number; flow: number; erase: boolean; box: number[] }[] = []
  for (const s of mask.strokes) {
    const r = (s.r * L) / px
    if (!(r > 0.05) || !s.points.length || s.flow <= 0) continue
    const pts = s.points.map((q) => {
      const [x, y] = applyAffine(inv, q.x * SW, q.y * SH)
      return [x - f.region.x, y - f.region.y]
    })
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
    const box = [Math.max(0, Math.floor(Math.min(...xs) - r - 2)), Math.max(0, Math.floor(Math.min(...ys) - r - 2)), Math.min(W, Math.ceil(Math.max(...xs) + r + 2)), Math.min(H, Math.ceil(Math.max(...ys) + r + 2))]
    if (box[2] <= box[0] || box[3] <= box[1]) continue
    const start = segs.length / 4
    const list = pts.length === 1 ? [pts[0], pts[0]] : pts
    for (let i = 0; i + 1 < list.length; i++) segs.push(list[i][0], list[i][1], list[i + 1][0], list[i + 1][1])
    draws.push({ start, count: list.length - 1, r, inner: Math.max(0, r - Math.max((s.feather / 100) * r, 1)), flow: Math.min(1, s.flow), erase: !!s.erase, box })
  }
  if (!draws.length) return acc
  const n = segs.length / 4, tw = Math.min(4096, n), th = Math.ceil(n / 4096)
  const data = new Float32Array(tw * th * 4)
  data.set(segs)
  const segTex = gpu.uploadFloat(data, tw, th, 4)
  const stroke = gpu.target(W, H, 'r16f')
  for (const d of draws) {
    gpu.clear(stroke)
    gpu.blend('max')
    gpu.program('segment', SEGMENT_FRAG, SEGMENT_VERT).tex('u_segs', segTex, 0).i('u_start', d.start).f('u_size', W, H).f('u_r', d.r).f('u_inner', d.inner)
    gpu.drawInstanced(stroke, 6, d.count)
    gpu.blend(d.erase ? 'erase' : 'screen')
    gpu.program('stroke', STROKE).tex('u_stroke', stroke, 0).f('u_flow', d.flow)
    gpu.drawRect(acc, d.box[0], d.box[1], d.box[2] - d.box[0], d.box[3] - d.box[1])
    gpu.blend('none')
  }
  gpu.free(stroke)
  gpu.destroy(segTex)
  return acc
}

/** Per pixel: Σ mask × opacity × the layer's 16 numbers (see layerVector), in 4 RGBA16F targets. */
export function localParams(gpu: Gpu, cache: StageCache, layers: LocalLayer[], masks: Map<string, Stage>, W: number, H: number) {
  const vectors = layers.map((l) => layerVector(l.adjust, Math.min(1, l.opacity)))
  const key = JSON.stringify([layers.map((l) => masks.get(l.id)!.version), vectors.map((v) => Array.from(v))])
  return cache.runMulti('local', key, W, H, 4, (fbo) => {
    gpu.clearMulti(fbo, W, H, 4)
    gpu.blend('add')
    layers.forEach((l, i) => {
      gpu.program('local', LOCAL).tex('u_mask', masks.get(l.id)!.target, 0).v4a('u_v', vectors[i])
      gpu.drawMulti(fbo, W, H)
    })
    gpu.blend('none')
  })
}
