// Engine lab: loaded by check.mjs in headless Chromium. Exposes window.lab.
import LibRaw from 'libraw-wasm'
import { createEngine } from '/src/engine/index.ts'
import { renderTiled } from '/src/engine/export.ts'
import { detectCaps, Gpu } from '/src/engine/gl.ts'
import { boxReduce } from '/src/engine/image.ts'
import { linearizeLibraw } from '/src/io/raw/curve.ts'
import { findEmbeddedJpeg } from '/src/io/raw/embedded.ts'
import { defaultRecipe, normalizeRecipe } from '/src/edit/defaults.ts'
import { mat3 } from '/src/color/matrices.ts'
import { rawWbForNeutral, relativeWbForNeutral, tempTintFromMultipliers } from '/src/color/wb.ts'

const photos = {}
/** Stored AI results (Phase 3), given to the engine and to every export. */
const rasters = new Map()
const canvas = document.createElement('canvas')
document.body.append(canvas)
const engine = createEngine(canvas)

const toLinear = new Float32Array(256).map((_, i) => {
  const e = i / 255
  return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4
})

async function loadJpeg(name, url) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const data = new Uint16Array(bmp.width * bmp.height * 3)
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) for (let k = 0; k < 3; k++) data[j + k] = Math.round(toLinear[px[i + k]] * 65535)
  photos[name] = { image: { width: bmp.width, height: bmp.height, data }, color: { kind: 'display', space: 'srgb-linear' }, rgba: px }
  return { width: bmp.width, height: bmp.height }
}

async function loadRaw(name, url, opts = {}) {
  const t0 = performance.now()
  const raw = new LibRaw()
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  await raw.open(bytes.slice(), { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3, halfSize: true })
  const meta = await raw.metadata(true)
  const img = await raw.imageData()
  raw.dispose()
  const c = meta.color_data
  const rgbCam = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.rgb_cam[r][k])))
  const camXyz = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.cam_xyz[r][k])))
  const m = c.cam_mul
  const shotMul = [m[0] / m[1], 1, m[2] / m[1]]
  const data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer)
  // Like the app's decode path: undo the curve libraw-wasm applies (opts.curved keeps it, as before the fix).
  if (!opts.curved) linearizeLibraw(data)
  photos[name] = { image: { width: img.width, height: img.height, data, fullWidth: img.width * 2 }, color: { kind: 'raw', space: 'camera', rgbCam, camXyz, shotMul }, bytes }
  return { width: img.width, height: img.height, ms: Math.round(performance.now() - t0), asShot: tempTintFromMultipliers(camXyz, shotMul), shotMul }
}

/** A recipe for a photo: default + overrides (deep-merged by normalizeRecipe). */
function recipeFor(name, patch = {}) {
  const p = photos[name]
  const asShot = p.color.kind === 'raw' ? tempTintFromMultipliers(p.color.camXyz, p.color.shotMul) : undefined
  const d = defaultRecipe(p.color.kind, asShot)
  return normalizeRecipe({ ...d, ...patch, basic: { ...d.basic, ...patch.basic }, wb: { ...d.wb, ...patch.wb }, geometry: { ...d.geometry, ...patch.geometry } }, p.color.kind, asShot)
}

async function toPng(r) {
  const c = new OffscreenCanvas(r.width, r.height)
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), r.width, r.height), 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  const b = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Export render; returns size, clipped fraction, timing and optionally a PNG. */
async function exportRender(name, patch, opts = {}) {
  const p = photos[name]
  const t0 = performance.now()
  const r = await engine.renderImage(recipeFor(name, patch), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: opts.maxLongEdge, rasters })
  const ms = Math.round(performance.now() - t0)
  let clipped = 0, sum = 0
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i] >= 254 || r.data[i + 1] >= 254 || r.data[i + 2] >= 254) clipped++
    sum += r.data[i] + r.data[i + 1] + r.data[i + 2]
  }
  const n = r.data.length / 4
  window.lastRender = r
  return { width: r.width, height: r.height, ms, clipped: clipped / n, mean: sum / n / 3, png: opts.png ? await toPng(r) : undefined }
}

/** Max / mean |Δ| between the default render and the decoded JPEG. */
async function jpegIdentity(name) {
  const p = photos[name]
  const r = await engine.renderImage(recipeFor(name), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  let max = 0, sum = 0, n = 0
  for (let i = 0; i < r.data.length; i += 4)
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(r.data[i + k] - p.rgba[i + k])
      max = Math.max(max, d)
      sum += d
      n++
    }
  // The interactive canvas path too (canvas sized to the image → 1:1).
  engine.setSource(p.image, p.color)
  engine.resize(p.image.width, p.image.height)
  engine.render(recipeFor(name))
  const gl = canvas.getContext('webgl2')
  const px = new Uint8Array(p.image.width * p.image.height * 4)
  gl.readPixels(0, 0, p.image.width, p.image.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let cmax = 0
  for (let y = 0; y < p.image.height; y++)
    for (let x = 0; x < p.image.width; x++) {
      const a = ((p.image.height - 1 - y) * p.image.width + x) * 4, b = (y * p.image.width + x) * 4
      for (let k = 0; k < 3; k++) cmax = Math.max(cmax, Math.abs(px[a + k] - p.rgba[b + k]))
    }
  return { max, mean: sum / n, canvasMax: cmax }
}

/** Median linear ratio of exposure +1 vs default over midtone pixels. */
async function exposureRatio(name) {
  const p = photos[name]
  const a = await engine.renderImage(recipeFor(name), p.image, p.color, { bitDepth: 16, colorSpace: 'srgb', rasters })
  const b = await engine.renderImage(recipeFor(name, { basic: { exposure: 1 } }), p.image, p.color, { bitDepth: 16, colorSpace: 'srgb', rasters })
  const lin = (v) => { const e = v / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4 }
  const ratios = []
  for (let i = 0; i < a.data.length; i += 4) {
    const y0 = lin(a.data[i + 1]), y1 = lin(b.data[i + 1])
    if (y0 > 0.04 && y0 < 0.3) ratios.push(y1 / y0)
  }
  ratios.sort((x, y) => x - y)
  return { median: ratios[ratios.length >> 1], n: ratios.length }
}

/** Eyedropper on a tinted gray patch: the patch must come out neutral. */
async function eyedropper(name) {
  const p = photos[name]
  const raw = p.color.kind === 'raw'
  const W = 64, H = 64
  const tint = raw ? [0.42, 0.35, 0.3] : [0.22, 0.18, 0.13]
  const data = new Uint16Array(W * H * 3)
  for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) data[i * 3 + k] = Math.round(tint[k] * 65535)
  const image = { width: W, height: H, data }
  engine.setSource(image, p.color)
  engine.resize(W, H)
  const base = recipeFor(name)
  engine.render(base)
  const s = engine.samplePixel(0.5, 0.5, 4)
  const wb = raw ? rawWbForNeutral(p.color.camXyz, p.color.shotMul, s) : relativeWbForNeutral(s)
  const r = await engine.renderImage({ ...base, wb: { preset: 'custom', ...wb } }, image, p.color, { bitDepth: 16, colorSpace: 'srgb', rasters })
  const c = [r.data[0], r.data[1], r.data[2]].map((v) => v / 65535)
  return { sample: s, wb, out: c, spread: Math.max(...c) - Math.min(...c) }
}

/** Tiled vs single-tile render of the same recipe (straightened + rotated so tiles cut through rotated content). */
async function tiling(name, patch) {
  const p = photos[name]
  const c2 = new OffscreenCanvas(1, 1)
  const gl = c2.getContext('webgl2')
  const gpu = new Gpu(gl, detectCaps(gl))
  const recipe = recipeFor(name, patch)
  const opts = { bitDepth: 16, colorSpace: 'srgb', rasters }
  const t0 = performance.now()
  const a = await renderTiled(gpu, recipe, p.image, p.color, opts, 8192)
  const t1 = performance.now()
  const b = await renderTiled(gpu, recipe, p.image, p.color, opts, 300)
  const t2 = performance.now()
  let max = 0, sum = 0, big = 0, at = null
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i])
    if (d > max) at = { x: (i >> 2) % a.width, y: Math.floor((i >> 2) / a.width), ch: i & 3, a: a.data[i], b: b.data[i] }
    max = Math.max(max, d)
    if (d > 256) big++
    sum += d
  }
  const B = 100, cols = Math.ceil(a.width / B), map = []
  for (let by = 0; by < Math.ceil(a.height / B); by++) {
    let row = ''
    for (let bx = 0; bx < cols; bx++) {
      let m = 0
      for (let y = by * B; y < Math.min(a.height, by * B + B); y++)
        for (let x = bx * B; x < Math.min(a.width, bx * B + B); x++)
          for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[(y * a.width + x) * 4 + k] - b.data[(y * a.width + x) * 4 + k]))
      row += m > 4096 ? '#' : m > 256 ? '+' : m > 32 ? '.' : ' '
    }
    map.push(row)
  }
  console.log('diffmap\n' + map.join('\n'))
  window.tilePair = [a, b]
  engine.setSource(p.image, p.color)
  const expected = engine.outputSize(recipe)
  gpu.dispose()
  return { size: [a.width, a.height], expected: [expected.width, expected.height], maxDiff16: max, at, big, meanDiff16: sum / a.data.length, singleMs: Math.round(t1 - t0), tiledMs: Math.round(t2 - t1) }
}

/** Interactive render timing: slider drags (exposure / tone only) after a warm-up. */
async function timing(name, cw, ch, patch = {}) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  engine.resize(cw, ch)
  const gl = canvas.getContext('webgl2')
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  let t = performance.now()
  engine.render(recipeFor(name, patch))
  sync()
  const first = performance.now() - t
  const times = []
  const layered = (i) => patch.layers ? { ...patch, layers: patch.layers.map((l, k) => (k ? l : { ...l, adjust: { ...l.adjust, exposure: (l.adjust.exposure ?? 0) + i * 0.1 } })) } : { ...patch, basic: { exposure: i * 0.1, shadows: i * 5 } }
  for (let i = 0; i < 6; i++) {
    t = performance.now()
    engine.render(recipeFor(name, layered(i)))
    sync()
    times.push(performance.now() - t)
  }
  t = performance.now()
  engine.render(recipeFor(name, layered(5)))
  sync()
  const same = performance.now() - t
  t = performance.now()
  engine.render(recipeFor(name, { ...patch, wb: { temp: 4000, tint: 5 } }))
  sync()
  const wbMs = performance.now() - t
  t = performance.now()
  const h = engine.histogram()
  const histMs = performance.now() - t
  const auto = engine.auto(recipeFor(name))
  engine.render(recipeFor(name, patch), { maskOverlay: patch.layers?.[1]?.id })
  sync()
  return { first: Math.round(first), unchanged: Math.round(same), slider: Math.round(times.reduce((a, b) => a + b) / times.length), wb: Math.round(wbMs), hist: Math.round(histMs), clippedHigh: h.clippedHigh, auto }
}

/** Interactive canvas snapshot (PNG of the drawing buffer). */
async function canvasShot(name, patch, opts, cw, ch) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  engine.resize(cw, ch)
  engine.render(recipeFor(name, patch), opts)
  // Read in the same task as render(): the drawing buffer isn't preserved after compositing.
  return canvas.toDataURL('image/png').split(',')[1]
}

/** Lose and restore the WebGL context; the engine must re-upload and render again. */
async function contextLoss(name) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  engine.resize(400, 300)
  engine.render(recipeFor(name))
  const gl = canvas.getContext('webgl2')
  const ext = gl.getExtension('WEBGL_lose_context')
  const restored = new Promise((res) => engine.onContextRestored(res))
  const lost = new Promise((res) => canvas.addEventListener('webglcontextlost', res, { once: true }))
  const within = (pr, step) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out waiting for ' + step)), 10000))])
  ext.loseContext()
  await within(lost, 'webglcontextlost')
  await new Promise((r) => setTimeout(r, 100)) // restoring during the lost event's dispatch is not allowed
  ext.restoreContext()
  await within(restored, 'onContextRestored')
  engine.render(recipeFor(name))
  const px = new Uint8Array(4)
  gl.readPixels(200, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  return { hasSource: engine.hasSource(), center: Array.from(px) }
}

/** Full-resolution RAW decode + 16-bit export. */
async function fullExport(url) {
  const raw = new LibRaw()
  await raw.open(new Uint8Array(await (await fetch(url)).arrayBuffer()), { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3 })
  const meta = await raw.metadata(true)
  const img = await raw.imageData()
  raw.dispose()
  linearizeLibraw(img.data)
  const c = meta.color_data
  const color = { kind: 'raw', space: 'camera', rgbCam: mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.rgb_cam[r][k]))), camXyz: mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.cam_xyz[r][k]))), shotMul: [c.cam_mul[0] / c.cam_mul[1], 1, c.cam_mul[2] / c.cam_mul[1]] }
  photos.full = { image: { width: img.width, height: img.height, data: img.data }, color }
  const t0 = performance.now()
  let ticks = 0
  const r = await engine.renderImage(recipeFor('full', { basic: { shadows: 30, clarity: 20 } }), photos.full.image, color, { bitDepth: 16, colorSpace: 'srgb', onProgress: () => ticks++ })
  return { width: r.width, height: r.height, ms: Math.round(performance.now() - t0), tiles: ticks, type: r.data.constructor.name }
}

/** 100 % view (renderRegion on the full source, working copy at half size) must match the export pixel for pixel. */
async function regionCheck(name, patch, x, y) {
  const p = photos[name]
  const full = p.image
  const working = { ...boxReduce(full, 2), fullWidth: full.fullWidth }
  const recipe = recipeFor(name, patch)
  engine.setSource(working, p.color)
  engine.setFullSource(full)
  engine.resize(640, 480)
  const t0 = performance.now()
  engine.renderRegion(recipe, x, y)
  const gl = canvas.getContext('webgl2')
  const px = new Uint8Array(640 * 480 * 4)
  gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const ms = Math.round(performance.now() - t0)
  const ex = await engine.renderImage(recipe, full, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  let max = 0, sum = 0
  for (let j = 0; j < 480; j++)
    for (let i = 0; i < 640; i++) {
      const a = ((479 - j) * 640 + i) * 4, b = ((y + j) * ex.width + x + i) * 4
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(px[a + k] - ex.data[b + k])
        max = Math.max(max, d)
        sum += d
      }
    }
  const size = engine.regionOutputSize(recipe)
  const sample = engine.samplePixel(0.5, 0.5, 2)
  engine.setFullSource(null)
  return { size: [size.width, size.height], export: [ex.width, ex.height], maxDiff: max, meanDiff: sum / (640 * 480 * 3), ms, sample }
}

/** Interactive canvas at 1:1 (fit = 1) vs the export of the same image: same pipeline, same pixels. */
async function canvasParity(name, patch) {
  const p = photos[name]
  const recipe = recipeFor(name, patch)
  engine.setSource(p.image, p.color)
  const out = engine.outputSize(recipe)
  engine.resize(out.width, out.height)
  engine.render(recipe)
  const gl = canvas.getContext('webgl2')
  const px = new Uint8Array(out.width * out.height * 4)
  gl.readPixels(0, 0, out.width, out.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const ex = await engine.renderImage(recipe, p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  let max = 0, sum = 0, over2 = 0
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++)
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(px[((out.height - 1 - y) * out.width + x) * 4 + k] - ex.data[(y * out.width + x) * 4 + k])
        max = Math.max(max, d)
        sum += d
        if (d > 2) over2++
      }
  return { size: [out.width, out.height], maxDiff: max, meanDiff: sum / (out.width * out.height * 3), over2 }
}

/** Heal a small feature with the engine's own source search; before/after crops and stats. */
async function healCheck(name, x, y, r) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  const base = recipeFor(name)
  const src = engine.findHealSource(base, x, y, r)
  const spot = { id: 'h1', mode: 'heal', x, y, r, sx: src.sx, sy: src.sy, feather: 30, opacity: 1 }
  const a = await engine.renderImage(base, p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  const b = await engine.renderImage({ ...base, retouch: [spot] }, p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  const W = a.width, L = Math.max(W, a.height), cx = x * W, cy = y * a.height, R = r * L
  const lum = (img, i) => 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
  const stats = (img) => {
    let inS = 0, inN = 0, inSq = 0, ringS = 0, ringN = 0
    for (let j = Math.floor(cy - 2 * R); j <= cy + 2 * R; j++)
      for (let i = Math.floor(cx - 2 * R); i <= cx + 2 * R; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy), v = lum(img, (j * W + i) * 4)
        if (d < R * 0.8) { inS += v; inSq += v * v; inN++ } else if (d > R * 1.2 && d < R * 2) { ringS += v; ringN++ }
      }
    const m = inS / inN
    return { inside: Math.round(m * 10) / 10, std: Math.round(Math.sqrt(inSq / inN - m * m) * 10) / 10, ring: Math.round((ringS / ringN) * 10) / 10 }
  }
  // Crops (±3 r) side by side, ×4.
  const c = Math.ceil(3 * R), side = 2 * c, z = 4
  const comp = new Uint8ClampedArray(side * z * 2 * side * z * 4)
  ;[a, b].forEach((img, k) => {
    for (let j = 0; j < side * z; j++)
      for (let i = 0; i < side * z; i++) {
        const sx = Math.min(W - 1, Math.max(0, Math.floor(cx) - c + Math.floor(i / z))), sy = Math.min(img.height - 1, Math.max(0, Math.floor(cy) - c + Math.floor(j / z)))
        const o = (j * side * z * 2 + k * side * z + i) * 4, q = (sy * W + sx) * 4
        comp.set([img.data[q], img.data[q + 1], img.data[q + 2], 255], o)
      }
  })
  return { source: src, before: stats(a), after: stats(b), png: await toPng({ width: side * z * 2, height: side * z, data: comp }) }
}

/** The presets panel's live previews: one small engine renders every visible look, again after each edit. */
async function previewTiming(name, n = 12) {
  const { builtinPresets } = await import('/src/presets/catalog.ts')
  const { applyPreset } = await import('/src/presets/apply.ts')
  const p = photos[name]
  const k = Math.max(1, Math.floor(Math.max(p.image.width, p.image.height) / 360))
  const image = { ...boxReduce(p.image, k), fullWidth: p.image.fullWidth ?? p.image.width }
  const c = new OffscreenCanvas(1, 1)
  const e = createEngine(c)
  const gl = c.getContext('webgl2')
  e.setSource(image, p.color)
  const looks = builtinPresets().slice(0, n)
  const pass = (exposure) => {
    const t = performance.now()
    for (const look of looks) {
      const r = applyPreset(recipeFor(name, { basic: { exposure } }), look, 100, 'original', p.color.kind)
      const out = e.outputSize(r)
      e.resize(out.width, out.height)
      e.render(r)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    }
    return Math.round((performance.now() - t) / looks.length)
  }
  const cold = pass(0)
  const edit = pass(0.1)
  const again = pass(0.2)
  e.dispose()
  return { size: [image.width, image.height], looks: looks.length, msPerLook: { cold, afterEdit: edit, again } }
}

/** samplePixel(…, { developed: true }) = the photo developed without its layers, display-encoded. */
async function developedSample(name, patch, nx, ny) {
  const p = photos[name]
  const recipe = recipeFor(name, patch)
  engine.setSource(p.image, p.color)
  const out = engine.outputSize(recipe)
  engine.resize(out.width, out.height)
  engine.render(recipe)
  const s = engine.samplePixel(nx, ny, 2, { developed: true })
  const ex = await engine.renderImage({ ...recipe, layers: [] }, p.image, p.color, { bitDepth: 16, colorSpace: 'srgb', rasters })
  const x = Math.floor(nx * ex.width), y = Math.floor(ny * ex.height), m = [0, 0, 0]
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) for (let k = 0; k < 3; k++) m[k] += ex.data[((y + j) * ex.width + x + i) * 4 + k] / 65535 / 25
  return { developed: s, exportWithoutLayers: m, maxDiff: Math.max(...m.map((v, k) => Math.abs(v - s[k]))) }
}

function setRaster(id, img) {
  rasters.set(id, img)
  engine.setRaster(id, img)
}

/** Synthetic AI results: a soft blob mask, photo-21's sky (thresholded), a removal fill, a denoised ARW. */
async function setupRasters() {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const bw = 256, bh = 171, blob = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) blob[y * bw + x] = Math.round(255 * (1 - ss(0.22, 0.3, Math.hypot(x / bw - 0.55, (y - bh * 0.45) / bw))))
  setRaster('blob', { width: bw, height: bh, channels: 1, data: blob })
  // Sky of the lighthouse: bluish and bright in the upper part, at 1/4 resolution like a model's output.
  const j = photos['photo-21.jpg'], W = 768, H = 512, sw = W / 4, sh = H / 4, sky = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let n = 0
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++) {
          const o = ((y * 4 + dy) * W + x * 4 + dx) * 4, r = j.rgba[o], g = j.rgba[o + 1], b = j.rgba[o + 2]
          if (b > r + 15 && (r + g + b) / 3 > 90 && y * 4 < H * 0.62) n++
        }
      sky[y * sw + x] = Math.round((n / 16) * 255)
    }
  setRaster('sky', { width: sw, height: sh, channels: 1, data: sky })
  // Removal fill: the ARW's rect averaged 8× — a smooth, grain-free stand-in for an inpainting result.
  const a = photos.arw.image, rect = { x: 0.075, y: 0.27, w: 0.07, h: 0.09 }
  const rx = Math.round(rect.x * a.width), ry = Math.round(rect.y * a.height), rw = Math.round(rect.w * a.width), rh = Math.round(rect.h * a.height)
  const fw = Math.ceil(rw / 8), fh = Math.ceil(rh / 8), fill = new Uint16Array(fw * fh * 3)
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
          const sx = Math.min(a.width - 1, rx + x * 8 + dx), sy = Math.min(a.height - 1, ry + y * 8 + dy)
          sum += a.data[(sy * a.width + sx) * 3 + c]
          n++
        }
        fill[(y * fw + x) * 3 + c] = Math.round(sum / n)
      }
  setRaster('fill', { width: fw, height: fh, channels: 3, data: fill })
  // "Denoised" ARW: a 5×5 box blur of it.
  const d = new Uint16Array(a.data.length), tmp = new Float32Array(a.data.length)
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) for (let c = 0; c < 3; c++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) sum += a.data[(y * a.width + Math.min(a.width - 1, Math.max(0, x + k))) * 3 + c]
    tmp[(y * a.width + x) * 3 + c] = sum / 5
  }
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) for (let c = 0; c < 3; c++) {
    let sum = 0
    for (let k = -2; k <= 2; k++) sum += tmp[(Math.min(a.height - 1, Math.max(0, y + k)) * a.width + x) * 3 + c]
    d[(y * a.width + x) * 3 + c] = Math.round(sum / 5)
  }
  photos.arwDenoised = { image: { width: a.width, height: a.height, data: d, fullWidth: a.fullWidth }, color: photos.arw.color }
  setRaster('dn', { width: a.width, height: a.height, channels: 3, data: d })
  return { rect: [rx, ry, rw, rh], fill: [fw, fh] }
}

/** Mean absolute 3×3 high-pass of an RGBA image (grain / detail energy) inside a rect. */
function grain(img, x0, y0, x1, y1) {
  ;[x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round)
  let s = 0, n = 0
  for (let y = Math.max(1, y0); y < Math.min(img.height - 1, y1); y++)
    for (let x = Math.max(1, x0); x < Math.min(img.width - 1, x1); x++) {
      const o = (y * img.width + x) * 4
      let m = 0
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) m += img.data[o + (j * img.width + i) * 4 + 1]
      s += Math.abs(img.data[o + 1] - m / 8)
      n++
    }
  return s / Math.max(1, n)
}

/** Denoise blend: amount 0 = the photo, 100 = the denoised raster as the photo, 50 between. */
async function denoiseCheck() {
  const p = photos.arw
  const at = async (amount) => engine.renderImage(recipeFor('arw', { denoise: { amount, raster: 'dn', model: 'test' } }), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: 1200, rasters })
  const plain = await engine.renderImage(recipeFor('arw'), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: 1200, rasters })
  const asSource = await engine.renderImage(recipeFor('arw'), photos.arwDenoised.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: 1200, rasters })
  const [a0, a50, a100] = [await at(0), await at(50), await at(100)]
  const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a.data[i] - b.data[i])); return m }
  const g = (img) => Math.round(grain(img, 0, 0, img.width, img.height) * 100) / 100
  return { amount0VsPlain: maxDiff(a0, plain), amount100VsDenoisedSource: maxDiff(a100, asSource), grain: { 0: g(a0), 50: g(a50), 100: g(a100) } }
}

/** Removal on the ARW: before / after crops (×2) and the grain inside vs around the filled area. */
async function removalCheck(patch, rectPx) {
  const p = photos.arw
  const a = await engine.renderImage(recipeFor('arw'), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  const b = await engine.renderImage(recipeFor('arw', patch), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  const [rx, ry, rw, rh] = rectPx, e = Math.round(Math.max(rw, rh) * 0.4)
  const inner = grain(b, rx + rw * 0.3, ry + rh * 0.3, rx + rw * 0.7, ry + rh * 0.7)
  const around = (img) => (grain(img, rx - e, ry - e, rx, ry + rh + e) + grain(img, rx + rw, ry - e, rx + rw + e, ry + rh + e)) / 2
  const cw = rw + 2 * e, ch = rh + 2 * e, z = 2, comp = new Uint8ClampedArray(cw * z * 2 * ch * z * 4)
  ;[a, b].forEach((img, k) => {
    for (let y = 0; y < ch * z; y++)
      for (let x = 0; x < cw * z; x++) {
        const sx = Math.min(img.width - 1, Math.max(0, rx - e + Math.floor(x / z))), sy = Math.min(img.height - 1, Math.max(0, ry - e + Math.floor(y / z)))
        const q = (sy * img.width + sx) * 4
        comp.set([img.data[q], img.data[q + 1], img.data[q + 2], 255], (y * cw * z * 2 + k * cw * z + x) * 4)
      }
  })
  return { grainInside: Math.round(inner * 100) / 100, grainAround: Math.round(around(b) * 100) / 100, png: await toPng({ width: cw * z * 2, height: ch * z, data: comp }) }
}

/** Max difference between the export of a recipe and of the default recipe (no-op edits must be exact). */
async function vsPlain(name, patch) {
  const p = photos[name]
  const a = await engine.renderImage(recipeFor(name), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  const b = await engine.renderImage(recipeFor(name, patch), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
  let m = 0
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]))
  return { maxDiff: m }
}

/** FNV-1a hashes of a fixed set of renders (export + interactive canvas): proves defaults are bit-identical across versions. */
async function hashes(patches) {
  const fnv = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619) >>> 0; return h.toString(16) }
  const out = {}
  for (const [key, name, patch] of patches) {
    const p = photos[name]
    const r = await engine.renderImage(recipeFor(name, patch), p.image, p.color, { bitDepth: 16, colorSpace: 'srgb', maxLongEdge: 1000, rasters })
    engine.setSource(p.image, p.color)
    engine.resize(900, 600)
    engine.render(recipeFor(name, patch))
    const gl = canvas.getContext('webgl2'), px = new Uint8Array(900 * 600 * 4)
    gl.readPixels(0, 0, 900, 600, gl.RGBA, gl.UNSIGNED_BYTE, px)
    out[key] = fnv(new Uint8Array(r.data.buffer)) + '/' + fnv(px)
  }
  return out
}

/** Synthetic test charts (display kind): a grid of dark lines seen through a known lens or perspective. */
async function makeGrid(name, kind, param) {
  const { radialOf, undistortRadius } = await import('/src/engine/lens.ts')
  const { perspectiveMatrix, applyHomography } = await import('/src/edit/perspective.ts')
  const W = 1500, H = 1000, cx = W / 2, cy = H / 2, norm = Math.min(W, H) / 2
  const radial = kind === 'barrel' ? radialOf(param) : null
  const Hm = kind === 'keystone' ? perspectiveMatrix(param, { width: W, height: H }) : null
  const data = new Uint16Array(W * H * 3)
  const line = (u) => { const d = Math.abs(((u % 100) + 100) % 100 - 50); return Math.min(1, Math.max(0, (50 - d - 1.5) / 1.2)) }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let ux = x + 0.5, uy = y + 0.5
      if (radial) {
        const dx = ux - cx, dy = uy - cy, rd = Math.hypot(dx, dy) / norm
        const k = rd > 0 ? undistortRadius(radial, rd) / rd : 1
        ux = cx + dx * k
        uy = cy + dy * k
      } else if (Hm) [ux, uy] = applyHomography(Hm, ux, uy)
      // Dark lines every 100 px (centred on multiples of 100, 3 px wide) on a light ground.
      const dark = 1 - line(ux - 50) * line(uy - 50)
      const v = Math.round((0.75 - 0.7 * dark) * 65535)
      data.set([v, v, v], (y * W + x) * 3)
    }
  photos[name] = { image: { width: W, height: H, data }, color: { kind: 'display', space: 'srgb-linear' } }
}

/** Straightness of the grid's vertical and horizontal lines in a render: max deviation (px) from a fitted straight line. */
function straightness(img) {
  // Transparent pixels (outside the photo after the correction) count as light: only real lines are dark.
  const lum = (x, y) => { const o = (y * img.width + x) * 4; return img.data[o + 3] < 255 ? 255 : img.data[o + 1] }
  const track = (vertical) => {
    const len = vertical ? img.height : img.width, across = vertical ? img.width : img.height
    const at = (a, t) => (vertical ? lum(a, t) : lum(t, a))
    // Line centres on a scanline between grid lines: narrow dark runs.
    const mid = Math.floor(len / 2) + 25, starts = []
    for (let a = 2; a < across - 10; a++) if (at(a, mid) < 110 && at(a - 1, mid) >= 110 && at(a + 8, mid) >= 110) starts.push(a)
    let worst = 0, slope = 0
    for (const s0 of starts) {
      let a = s0 + 1
      const pts = []
      for (const dir of [1, -1])
        for (let t = mid, prev = a; t >= len * 0.12 && t < len * 0.88; t += dir * 5) {
          let sw = 0, sa = 0
          for (let k = Math.round(prev) - 8; k <= Math.round(prev) + 8; k++) if (k > 0 && k < across) { const w = Math.max(0, 200 - at(k, t)); sw += w; sa += w * k }
          if (sw < 50) break
          prev = sa / sw
          pts.push([t, prev])
        }
      if (pts.length < 20) continue
      const n = pts.length, mt = pts.reduce((s, p) => s + p[0], 0) / n, ma = pts.reduce((s, p) => s + p[1], 0) / n
      const b = pts.reduce((s, p) => s + (p[0] - mt) * (p[1] - ma), 0) / pts.reduce((s, p) => s + (p[0] - mt) ** 2, 0)
      for (const p of pts) worst = Math.max(worst, Math.abs(p[1] - (ma + b * (p[0] - mt))))
      slope = Math.max(slope, Math.abs(b))
    }
    return { dev: Math.round(worst * 100) / 100, slope: Math.round(slope * 1e4) / 1e4 }
  }
  return { vertical: track(true), horizontal: track(false) }
}

/** Render a chart without and with a correction; how straight its lines come out. */
async function lineTest(name, patch) {
  const p = photos[name]
  const opts = { bitDepth: 8, colorSpace: 'srgb', rasters }
  const a = await engine.renderImage(recipeFor(name), p.image, p.color, opts)
  const b = await engine.renderImage(recipeFor(name, patch), p.image, p.color, opts)
  return { before: straightness(a), after: straightness(b), pngBefore: await toPng(a), pngAfter: await toPng(b) }
}

/** Auto CA on a synthetic chart whose red channel is magnified by `s` (blue by 1/s). */
async function autoCATest(s) {
  const { estimateCA, AUTO_CA_EDGE } = await import('/src/engine/lens.ts')
  const { areaDownscale, lowResSize } = await import('/src/engine/image.ts')
  await makeGrid('ca', 'none', null)
  const g = photos.ca.image, W = g.width, H = g.height, d = new Uint16Array(g.data.length)
  const at = (x, y) => g.data[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3]
  // Bilinear, so the synthetic CA is a true sub-pixel radial scale.
  const bil = (x, y) => {
    const fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    return Math.round((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty)
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2, o = (y * W + x) * 3
      d[o] = bil(W / 2 + dx / s, H / 2 + dy / s)
      d[o + 1] = g.data[o + 1]
      d[o + 2] = bil(W / 2 + dx * s, H / 2 + dy * s)
    }
  const img = { width: W, height: H, data: d }
  const ls = lowResSize(W, H, AUTO_CA_EDGE)
  return estimateCA(areaDownscale(img, ls.width, ls.height))
}

/** Defringe: a bright patch with a purple border; how much of the border's colour survives. */
async function defringeTest() {
  const W = 400, H = 300, d = new Uint16Array(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inBox = x > 150 && x < 250 && y > 100 && y < 200, border = !inBox && x > 147 && x < 253 && y > 97 && y < 203
      const c = inBox ? [0.95, 0.95, 0.95] : border ? [0.25, 0.05, 0.35] : [0.02, 0.02, 0.02]
      d.set(c.map((v) => Math.round(v * 65535)), (y * W + x) * 3)
    }
  photos.fringe = { image: { width: W, height: H, data: d }, color: { kind: 'display', space: 'srgb-linear' } }
  const chroma = async (patch) => {
    const r = await engine.renderImage(recipeFor('fringe', patch), photos.fringe.image, photos.fringe.color, { bitDepth: 8, colorSpace: 'srgb', rasters })
    const o = (150 * W + 148) * 4
    return Math.max(r.data[o], r.data[o + 1], r.data[o + 2]) - Math.min(r.data[o], r.data[o + 1], r.data[o + 2])
  }
  const lens = (purple) => ({ lens: { enabled: false, profileId: '', vignetting: null, tca: null, autoCA: false, manualVignetting: 0, manualVignettingMidpoint: 50, defringe: { purple, purpleHue: [260, 330], green: 0, greenHue: [70, 120] } } })
  return { before: await chroma(lens(0)), after: await chroma(lens(20)) }
}

/** 'before' / 'split' on a photo scaled down to fit: the before half must be drawn (opaque, not black). */
async function beforeVisible(name, cw, ch) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  engine.resize(cw, ch)
  const gl = canvas.getContext('webgl2')
  const stats = (view) => {
    engine.render(recipeFor(name, { basic: { exposure: 1 } }), { view, split: 0.5 })
    const px = new Uint8Array(cw * ch * 4)
    gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px)
    // Left and right quarters of the middle row band.
    const half = (x0, x1) => {
      let a = 0, l = 0, n = 0
      for (let y = Math.floor(ch * 0.4); y < ch * 0.6; y++) for (let x = Math.floor(x0); x < x1; x++) { const o = (y * cw + x) * 4; a += px[o + 3]; l += px[o + 1]; n++ }
      return { alpha: Math.round(a / n), green: Math.round(l / n) }
    }
    return { left: half(cw * 0.1, cw * 0.35), right: half(cw * 0.65, cw * 0.9) }
  }
  return { after: stats('after'), before: stats('before'), split: stats('split') }
}

/** Luminance statistics (Rec.709 luma of encoded sRGB, 0…255) of RGBA pixels. */
function lumaStats(rgba) {
  const v = []
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 127) v.push(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2])
  v.sort((a, b) => a - b)
  const q = (p) => Math.round(v[Math.min(v.length - 1, Math.floor(p * v.length))] * 10) / 10
  const curve = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95].map(q)
  return { mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, p5: curve[0], p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: curve[10], curve }
}

/** The default render of a RAW vs the camera's own JPEG (its embedded preview): brightness and contrast. */
async function cameraCompare(name, patch = {}) {
  const p = photos[name]
  const e = findEmbeddedJpeg(p.bytes)
  const bmp = await createImageBitmap(new Blob([p.bytes.subarray(e.offset, e.offset + e.length)], { type: 'image/jpeg' }))
  const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const cam = lumaStats(ctx.getImageData(0, 0, bmp.width, bmp.height).data)
  const r = await engine.renderImage(recipeFor(name, patch), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: Math.max(bmp.width, bmp.height), rasters })
  const ours = lumaStats(r.data)
  // Midtones: mean |Δ| of the luminance percentile curves between 20 % and 80 %.
  const mid = ours.curve.slice(2, 9).reduce((s, v, i) => s + Math.abs(v - cam.curve[i + 2]), 0) / 7
  return { camera: { ...cam, curve: undefined }, ours: { ...ours, curve: undefined }, midtoneDiff: Math.round(mid * 10) / 10, cameraSize: [bmp.width, bmp.height], png: patch.png ? await toPng(r) : undefined }
}

const asShot = (name) => tempTintFromMultipliers(photos[name].color.camXyz, photos[name].color.shotMul)

/** 12 small renders of a photo (profiles, Auto, built-in presets) in one PNG, labelled in the console. */
async function contactSheet(name) {
  const { builtinPresets } = await import('/src/presets/catalog.ts')
  const { applyPreset } = await import('/src/presets/apply.ts')
  const p = photos[name]
  const presets = builtinPresets()
  const pick = [0, 25, 60, 95, 130, 170].map((i) => presets[i % presets.length])
  engine.setSource(p.image, p.color)
  const auto = engine.auto(recipeFor(name))
  const recipes = [
    ['default', recipeFor(name)], ['neutral', recipeFor(name, { profile: 'neutral' })], ['vivid', recipeFor(name, { profile: 'vivid' })],
    ['flat', recipeFor(name, { profile: 'flat' })], ['mono', recipeFor(name, { profile: 'mono' })],
    ['auto', recipeFor(name, { basic: { ...recipeFor(name).basic, ...auto.basic }, wb: { preset: 'auto', ...auto.wb } })],
    ...pick.map((pr) => [pr.name, applyPreset(recipeFor(name), pr, 100, 'original', p.color.kind)]),
  ]
  const tw = 400, th = 267, sheet = new Uint8ClampedArray(tw * 4 * th * 3 * 4)
  for (let k = 0; k < recipes.length; k++) {
    const r = await engine.renderImage(recipes[k][1], p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: tw, rasters })
    const ox = (k % 4) * tw, oy = Math.floor(k / 4) * th
    for (let y = 0; y < Math.min(th, r.height); y++) sheet.set(r.data.subarray(y * r.width * 4, (y * r.width + Math.min(tw, r.width)) * 4), ((oy + y) * tw * 4 + ox) * 4)
  }
  console.log('diffmap sheet: ' + recipes.map((r) => r[0]).join(' | ') + ' | auto=' + JSON.stringify(auto))
  return toPng({ width: tw * 4, height: th * 3, data: sheet })
}

window.lab = { contactSheet, asShot, cameraCompare, beforeVisible, makeGrid, lineTest, autoCATest, defringeTest, hashes, vsPlain, setupRasters, denoiseCheck, removalCheck, developedSample, previewTiming, contextLoss, fullExport, regionCheck, canvasParity, healCheck, tilePng: async (i) => { const r = window.tilePair[i]; const d = new Uint8ClampedArray(r.data.length); for (let j = 0; j < d.length; j++) d[j] = r.data[j] >> 8; return toPng({ ...r, data: d }) }, loadJpeg, loadRaw, exportRender, jpegIdentity, exposureRatio, eyedropper, tiling, timing, canvasShot, supported: engine.supported }
window.ready = true
