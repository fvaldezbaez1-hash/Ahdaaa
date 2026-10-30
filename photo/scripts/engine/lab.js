// Engine lab: loaded by check.mjs in headless Chromium. Exposes window.lab.
import LibRaw from 'libraw-wasm'
import { createEngine } from '/src/engine/index.ts'
import { renderTiled } from '/src/engine/export.ts'
import { detectCaps, Gpu } from '/src/engine/gl.ts'
import { defaultRecipe, normalizeRecipe } from '/src/edit/defaults.ts'
import { mat3 } from '/src/color/matrices.ts'
import { rawWbForNeutral, relativeWbForNeutral, tempTintFromMultipliers } from '/src/color/wb.ts'

const photos = {}
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

async function loadRaw(name, url) {
  const t0 = performance.now()
  const raw = new LibRaw()
  await raw.open(new Uint8Array(await (await fetch(url)).arrayBuffer()), { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3, halfSize: true })
  const meta = await raw.metadata(true)
  const img = await raw.imageData()
  raw.dispose()
  const c = meta.color_data
  const rgbCam = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.rgb_cam[r][k])))
  const camXyz = mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.cam_xyz[r][k])))
  const m = c.cam_mul
  const shotMul = [m[0] / m[1], 1, m[2] / m[1]]
  const data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer)
  photos[name] = { image: { width: img.width, height: img.height, data, fullWidth: img.width * 2 }, color: { kind: 'raw', space: 'camera', rgbCam, camXyz, shotMul } }
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
  const r = await engine.renderImage(recipeFor(name, patch), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb', maxLongEdge: opts.maxLongEdge })
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
  const r = await engine.renderImage(recipeFor(name), p.image, p.color, { bitDepth: 8, colorSpace: 'srgb' })
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
  const a = await engine.renderImage(recipeFor(name), p.image, p.color, { bitDepth: 16, colorSpace: 'srgb' })
  const b = await engine.renderImage(recipeFor(name, { basic: { exposure: 1 } }), p.image, p.color, { bitDepth: 16, colorSpace: 'srgb' })
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
  const r = await engine.renderImage({ ...base, wb: { preset: 'custom', ...wb } }, image, p.color, { bitDepth: 16, colorSpace: 'srgb' })
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
  const opts = { bitDepth: 16, colorSpace: 'srgb' }
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
async function timing(name, cw, ch) {
  const p = photos[name]
  engine.setSource(p.image, p.color)
  engine.resize(cw, ch)
  const gl = canvas.getContext('webgl2')
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  let t = performance.now()
  engine.render(recipeFor(name))
  sync()
  const first = performance.now() - t
  const times = []
  for (let i = 0; i < 6; i++) {
    t = performance.now()
    engine.render(recipeFor(name, { basic: { exposure: i * 0.1, shadows: i * 5 } }))
    sync()
    times.push(performance.now() - t)
  }
  t = performance.now()
  engine.render(recipeFor(name, { basic: { exposure: 0.5, shadows: 25 } }))
  sync()
  const same = performance.now() - t
  t = performance.now()
  engine.render(recipeFor(name, { wb: { temp: 4000, tint: 5 } }))
  sync()
  const wbMs = performance.now() - t
  t = performance.now()
  const h = engine.histogram()
  const histMs = performance.now() - t
  const auto = engine.auto(recipeFor(name))
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
  const c = meta.color_data
  const color = { kind: 'raw', space: 'camera', rgbCam: mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.rgb_cam[r][k]))), camXyz: mat3([0, 1, 2].map((r) => [0, 1, 2].map((k) => c.cam_xyz[r][k]))), shotMul: [c.cam_mul[0] / c.cam_mul[1], 1, c.cam_mul[2] / c.cam_mul[1]] }
  photos.full = { image: { width: img.width, height: img.height, data: img.data }, color }
  const t0 = performance.now()
  let ticks = 0
  const r = await engine.renderImage(recipeFor('full', { basic: { shadows: 30, clarity: 20 } }), photos.full.image, color, { bitDepth: 16, colorSpace: 'srgb', onProgress: () => ticks++ })
  return { width: r.width, height: r.height, ms: Math.round(performance.now() - t0), tiles: ticks, type: r.data.constructor.name }
}

window.lab = { contextLoss, fullExport, tilePng: async (i) => { const r = window.tilePair[i]; const d = new Uint8ClampedArray(r.data.length); for (let j = 0; j < d.length; j++) d[j] = r.data[j] >> 8; return toPng({ ...r, data: d }) }, loadJpeg, loadRaw, exportRender, jpegIdentity, exposureRatio, eyedropper, tiling, timing, canvasShot, supported: engine.supported }
window.ready = true
