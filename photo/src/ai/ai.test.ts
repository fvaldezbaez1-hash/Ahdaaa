import { describe, expect, it } from 'vitest'
import type { BrushStroke } from '../edit/types'
import type { SourceColor } from '../engine/types'
import { autoGain, fromModel, fromModelFloat, modelSpace, srgbDecode, srgbEncode, toModel, toPlanar, fromPlanar } from './color'
import { planInpaint, rectInModel, strokesBounds } from './inpaintPlan'
import { sha256Hex } from './models'
import { boxBlur, guidedFilter, rasterizeStrokes, resize } from './pixels'
import { MODELS, modelBytes, modelEntry } from './registry'
import { skyMask } from './sky'
import { axisWeights, BandAssembler, cropInterleaved, tileGrid, tileStarts } from './tiling'

const RAW_COLOR: SourceColor = {
  kind: 'raw',
  space: 'camera',
  // A typical camera matrix (rows sum to 1, so white stays white).
  rgbCam: [1.73, -0.62, -0.11, -0.19, 1.52, -0.33, 0.03, -0.51, 1.48],
  shotMul: [2, 1, 1.5],
}
const SRGB: SourceColor = { kind: 'display', space: 'srgb-linear' }

describe('registry', () => {
  it('has unique ids and files, sha256 hashes and permissive licences', () => {
    const ids = new Set<string>(), files = new Set<string>()
    for (const m of MODELS) {
      expect(ids.has(m.id)).toBe(false)
      ids.add(m.id)
      expect(['Apache-2.0', 'MIT', 'BSD-3-Clause']).toContain(m.licence)
      expect(m.files.length).toBeGreaterThan(0)
      for (const f of m.files) {
        expect(files.has(f.file)).toBe(false)
        files.add(f.file)
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(f.source.sha256).toMatch(/^[0-9a-f]{64}$/)
        // GitHub Pages refuses files over 100 MB.
        expect(f.bytes).toBeLessThan(100e6)
        expect(f.source.urls.length).toBeGreaterThan(0)
        for (const u of f.source.urls) expect(u).toMatch(/^https:\/\//)
        // File names carry the hash, so a new version never collides with a cached old one.
        expect(f.file).toContain(f.sha256.slice(0, 8))
        if (!f.source.convert) expect(f.source.sha256).toBe(f.sha256)
      }
    }
  })

  it('keeps the whole set well inside a 1 GB Pages site', () => {
    const total = MODELS.reduce((n, m) => n + modelBytes(m), 0)
    expect(total).toBeLessThan(400e6)
  })

  it('has a model for every task the API runs', () => {
    for (const t of ['person', 'object', 'subject', 'depth', 'inpaint', 'denoise', 'upscale']) expect(MODELS.some((m) => m.task === t)).toBe(true)
    expect(modelEntry('nope')).toBeUndefined()
    expect(modelBytes(modelEntry('mp-selfie-multiclass')!)).toBe(16371837 + 781618)
  })
})

describe('sha256', () => {
  it('matches known digests', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('model color space', () => {
  it('sRGB transfer functions invert each other', () => {
    for (let v = 0; v <= 1; v += 0.01) expect(srgbDecode(srgbEncode(v))).toBeCloseTo(v, 6)
  })

  const ramp = () => {
    // In-gamut, unclipped colors: built in linear sRGB, then taken to camera space.
    const n = 4096
    const srgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const t = i / n
      srgb[i * 3] = 0.05 + 0.4 * t
      srgb[i * 3 + 1] = 0.08 + 0.3 * ((i * 7) % n) / n
      srgb[i * 3 + 2] = 0.03 + 0.25 * ((i * 13) % n) / n
    }
    return srgb
  }

  it('round-trips display (linear sRGB) sources', () => {
    const lin = ramp()
    const src = Uint16Array.from(lin, (v) => Math.round(v * 65535))
    const space = modelSpace(SRGB, autoGain(src, SRGB))
    expect(space.gain).toBe(1)
    const back = fromModel(toModel(src, space), space)
    let worst = 0
    for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(back[i] - src[i]))
    expect(worst).toBeLessThanOrEqual(3)
  })

  it('round-trips RAW camera sources through rgbCam and the exposure gain', () => {
    const m = RAW_COLOR.rgbCam!
    const lin = ramp()
    // camera = rgbCam⁻¹ · sRGB
    const space0 = modelSpace(RAW_COLOR)
    const cam = space0.fromSrgb!
    const src = new Uint16Array(lin.length)
    for (let i = 0; i < lin.length; i += 3) {
      const [r, g, b] = [lin[i], lin[i + 1], lin[i + 2]]
      src[i] = Math.round((cam[0] * r + cam[1] * g + cam[2] * b) * 65535)
      src[i + 1] = Math.round((cam[3] * r + cam[4] * g + cam[5] * b) * 65535)
      src[i + 2] = Math.round((cam[6] * r + cam[7] * g + cam[8] * b) * 65535)
    }
    const gain = autoGain(src, RAW_COLOR)
    expect(gain).toBeGreaterThan(1)
    const space = modelSpace(RAW_COLOR, gain)
    const model = toModel(src, space)
    // What the model sees is sRGB-encoded (gain applied) and in range.
    for (const v of model) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of model) expect(v).toBeLessThanOrEqual(1)
    expect(model[0]).toBeCloseTo(srgbEncode(Math.min(1, lin[0] * gain)), 2)
    const back = fromModel(model, space)
    let worst = 0
    for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(back[i] - src[i]))
    expect(worst).toBeLessThanOrEqual(8) // a few 16-bit steps (LUT quantization × matrix)
    expect(m).toBe(RAW_COLOR.rgbCam)
  })

  it('applies a model change, not its clipping, in source space', () => {
    // A highlight above what the model can see comes back unchanged when the model changes nothing.
    const src = Uint16Array.of(65535, 65535, 65535, 1000, 2000, 3000)
    const space = modelSpace(RAW_COLOR, 4)
    const seen = toModel(src, space)
    const a = fromModelFloat(seen, space), b = fromModelFloat(seen, space)
    for (let i = 0; i < src.length; i++) expect(src[i] + a[i] - b[i]).toBe(src[i])
  })

  it('converts between interleaved and planar layouts', () => {
    const rgb = Float32Array.of(1, 2, 3, 4, 5, 6)
    expect([...toPlanar(rgb, 2)]).toEqual([1, 4, 2, 5, 3, 6])
    expect([...fromPlanar(toPlanar(rgb, 2), 2)]).toEqual([...rgb])
    expect([...toPlanar(rgb, 2, [1, 1, 1], [2, 2, 2])]).toEqual([0, 1.5, 0.5, 2, 1, 2.5])
  })
})

describe('tiling', () => {
  it('covers every pixel with overlapping tiles that end flush', () => {
    for (const [len, size, overlap] of [[100, 256, 32], [256, 256, 32], [257, 256, 32], [1000, 256, 32], [6000, 512, 32]]) {
      const s = tileStarts(len, size, overlap)
      expect(s[0]).toBe(0)
      expect(s.at(-1)! + Math.min(size, len)).toBe(len)
      for (let i = 1; i < s.length; i++) {
        expect(s[i]).toBeGreaterThan(s[i - 1])
        // consecutive tiles overlap by at least `overlap`
        expect(s[i - 1] + size - s[i]).toBeGreaterThanOrEqual(overlap)
      }
    }
    const grid = tileGrid(1000, 700, 256, 32)
    const hit = new Uint8Array(1000 * 700)
    for (const row of grid) {
      for (const t of row) {
        expect(t.y).toBe(row[0].y)
        for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) hit[y * 1000 + x] = 1
      }
    }
    expect(hit.every((v) => v === 1)).toBe(true)
  })

  it('ramps weights only on sides with a neighbour, never to zero', () => {
    const inner = axisWeights(100, 256, 1000, 16)
    expect(inner[0]).toBeLessThan(0.1)
    expect(inner[128]).toBe(1)
    expect(inner[255]).toBeLessThan(0.1)
    const first = axisWeights(0, 256, 1000, 16)
    expect(first[0]).toBe(1)
    for (const v of inner) expect(v).toBeGreaterThan(0)
  })

  it('assembles overlapping tiles seamlessly (a smooth image comes back exactly)', () => {
    const W = 300, H = 200, C = 3
    const img = new Float32Array(W * H * C)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < C; c++) img[(y * W + x) * C + c] = x * 0.5 + y * 0.25 + c
    const out = new Float32Array(W * H * C)
    const rowsSeen: number[] = []
    const asm = new BandAssembler(W, H, C, 8, (y, row) => {
      rowsSeen.push(y)
      out.set(row, y * W * C)
    })
    const grid = tileGrid(W, H, 96, 16)
    for (let j = 0; j < grid.length; j++) {
      for (const t of grid[j]) asm.add(t, cropInterleaved(img, W, C, t))
      asm.flush(j + 1 < grid.length ? grid[j + 1][0].y : H)
    }
    expect(rowsSeen).toEqual(Array.from({ length: H }, (_, i) => i))
    let worst = 0
    for (let i = 0; i < img.length; i++) worst = Math.max(worst, Math.abs(out[i] - img[i]))
    expect(worst).toBeLessThan(1e-3)
  })

  it('blends disagreeing tiles smoothly across the overlap', () => {
    const W = 200, H = 10
    const vals: number[] = []
    const asm = new BandAssembler(W, H, 1, 16, (y, row) => y === 5 && vals.push(...row))
    const grid = tileGrid(W, H, 120, 40)
    grid[0].forEach((t, k) => asm.add(t, new Float32Array(t.w * t.h).fill(k * 10)))
    asm.flush(H)
    // From 0 to 10 without jumps bigger than a ramp step.
    for (let i = 1; i < vals.length; i++) expect(Math.abs(vals[i] - vals[i - 1])).toBeLessThan(1.5)
    expect(vals[0]).toBe(0)
    expect(vals.at(-1)).toBe(10)
  })
})

describe('object removal geometry', () => {
  const stroke = (pts: [number, number][], r: number, erase = false): BrushStroke => ({ points: pts.map(([x, y]) => ({ x, y })), r, feather: 30, flow: 1, erase })

  it('covers the painted strokes, with context, at full resolution', () => {
    const W = 6000, H = 4000
    const plan = planInpaint([stroke([[0.5, 0.5], [0.52, 0.5]], 0.005)], W, H)!
    const b = strokesBounds([stroke([[0.5, 0.5], [0.52, 0.5]], 0.005)], W, H)!
    // The rect contains the painted extent.
    expect(plan.rectPx.x).toBeLessThanOrEqual(b.x0)
    expect(plan.rectPx.x + plan.rectPx.w).toBeGreaterThanOrEqual(b.x1)
    expect(plan.rect.x).toBeCloseTo(plan.rectPx.x / W, 9)
    // A small hole: a 512 crop at full resolution, so the fill is as sharp as the source.
    expect(plan.crop.w).toBe(512)
    expect(plan.fill.width).toBe(plan.rectPx.w)
    // The crop contains the rect and stays inside the image.
    expect(plan.crop.x).toBeLessThanOrEqual(plan.rectPx.x)
    expect(plan.crop.x + plan.crop.w).toBeGreaterThanOrEqual(plan.rectPx.x + plan.rectPx.w)
    const m = rectInModel(plan)
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.w).toBeLessThanOrEqual(512 + 1e-9)
  })

  it('downscales big holes to the model size and stores the fill at that resolution', () => {
    const W = 6000, H = 4000
    const plan = planInpaint([stroke([[0.2, 0.3], [0.6, 0.6]], 0.03)], W, H)!
    expect(plan.crop.w).toBeGreaterThan(512)
    expect(plan.crop.w).toBeLessThanOrEqual(W)
    expect(plan.crop.h).toBeLessThanOrEqual(H)
    const scale = Math.max(plan.crop.w, plan.crop.h) / 512
    expect(plan.fill.width).toBeCloseTo(plan.rectPx.w / (plan.crop.w / 512), -1)
    expect(plan.fill.width).toBeLessThan(plan.rectPx.w)
    expect(scale).toBeGreaterThan(1)
  })

  it('clamps at the image border and handles images smaller than the model', () => {
    const plan = planInpaint([stroke([[0.02, 0.02]], 0.05)], 400, 300)!
    expect(plan.crop).toEqual({ x: 0, y: 0, w: 400, h: 300 })
    expect(plan.rectPx.x).toBe(0)
    expect(plan.fill).toEqual({ width: plan.rectPx.w, height: plan.rectPx.h })
    expect(planInpaint([], 400, 300)).toBeNull()
    expect(planInpaint([stroke([[0.5, 0.5]], 0.1, true)], 400, 300)).toBeNull()
  })

  it('rasterizes strokes in source coordinates; erase clears', () => {
    const W = 200, H = 100
    const m = rasterizeStrokes([stroke([[0.25, 0.5], [0.75, 0.5]], 0.05)], { x: 0, y: 0, w: 1, h: 1 }, W, H, W, H)
    expect(m[50 * W + 100]).toBe(1)
    expect(m[50 * W + 20]).toBe(0) // left of the stroke (r = 10 px)
    expect(m[10 * W + 100]).toBe(0)
    const e = rasterizeStrokes([stroke([[0.25, 0.5], [0.75, 0.5]], 0.05), stroke([[0.5, 0.5]], 0.02, true)], { x: 0, y: 0, w: 1, h: 1 }, W, H, W, H)
    expect(e[50 * W + 100]).toBe(0)
    expect(e[50 * W + 60]).toBe(1)
    // A sub-area at another resolution sees the same strokes.
    const half = rasterizeStrokes([stroke([[0.25, 0.5], [0.75, 0.5]], 0.05)], { x: 0.5, y: 0, w: 0.5, h: 1 }, 50, 50, W, H)
    expect(half[25 * 50 + 10]).toBe(1)
    expect(half[25 * 50 + 49]).toBe(0)
  })
})

describe('pixels', () => {
  it('resizes and blurs without shifting the image', () => {
    const src = Float32Array.from({ length: 16 }, (_, i) => i % 4)
    const up = resize(src, 4, 4, 8, 8)
    expect(up[0]).toBe(0)
    expect(up[7]).toBe(3)
    const flat = boxBlur(new Float32Array(100).fill(0.5), 10, 10, 3)
    for (const v of flat) expect(v).toBeCloseTo(0.5, 6)
  })

  it('guided filter keeps a mask edge on the image edge', () => {
    const W = 64, H = 16
    const guide = new Float32Array(W * H), mask = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        guide[y * W + x] = x < 32 ? 0.1 : 0.9
        mask[y * W + x] = x < 28 ? 0 : 1 // coarse mask, 4 px off the real edge
      }
    const q = guidedFilter(guide, mask, W, H, 6, 1e-4)
    expect(q[8 * W + 20]).toBeLessThan(0.15)
    expect(q[8 * W + 40]).toBeGreaterThan(0.85)
  })

  it('finds a smooth bright sky reaching the top, not the ground', () => {
    const W = 96, H = 64
    const rgb = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3
        if (y < 30) rgb.set([0.45, 0.6, 0.85], i) // blue sky
        else rgb.set([0.3 + 0.2 * (((x * 7 + y * 13) % 5) / 5), 0.35, 0.15], i) // textured ground
      }
    const grey = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) grey[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]
    const m = skyMask(rgb, grey, W, H, null)
    expect(m[10 * W + 40]).toBeGreaterThan(0.9)
    expect(m[50 * W + 40]).toBeLessThan(0.1)
    // With depth saying the top is near (no sky), nothing is selected.
    const near = { disparity: new Float32Array(32 * 32).fill(1), size: 32 }
    const none = skyMask(rgb, grey, W, H, near)
    expect(Math.max(...none)).toBeLessThan(0.1)
  })
})
