// Engine checks in headless Chromium (SwiftShader WebGL2): numeric tests plus
// PNG renders for eyeballing. Run from photo/:
//   node scripts/engine/check.mjs [--samples DIR] [--jpegs DIR] [--out DIR] [checks…]
// checks: identity exposure eyedropper highlights tiling timing region context renders (default: all but
// 'full', the slow full-resolution RAW decode + export); 'look <name…>' renders only matching files
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d)
const scratch = '/tmp/claude-0/-home-user-Ahdaaa/cf4d7424-a810-59a5-8866-82dcbe7ba388/scratchpad'
const samples = resolve(opt('--samples', join(scratch, 'samples')))
const jpegs = resolve(opt('--jpegs', join(scratch, 'lumen-assets')))
const outDir = resolve(opt('--out', join(scratch, 'agents/engine')))
const want = (c) => args.length === 0 || args.includes(c)
mkdirSync(outDir, { recursive: true })

const server = await createServer({ root: resolve('.'), configFile: false, logLevel: 'error', server: { port: 5201 }, optimizeDeps: { entries: ['scripts/engine/index.html'], exclude: ['libraw-wasm'] } })
await server.listen()
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('diffmap')) && console.log('console', m.text().slice(0, 4000)))
await page.route('**/sample/*', (r) => r.fulfill({ path: join(samples, decodeURIComponent(r.request().url().split('/sample/')[1])) }))
await page.route('**/jpeg/*', (r) => r.fulfill({ path: join(jpegs, decodeURIComponent(r.request().url().split('/jpeg/')[1])) }))
await page.goto('http://localhost:5201/scripts/engine/index.html')
await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
const lab = (fn, ...a) => page.evaluate(([fn, a]) => window.lab[fn](...a), [fn, a])
const save = (name, b64) => b64 && writeFileSync(join(outDir, name + '.png'), Buffer.from(b64, 'base64'))
const ok = (cond, label, detail) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, JSON.stringify(detail))

console.log('supported', await page.evaluate(() => window.lab.supported))
const jpegList = ['photo-01.jpg', 'photo-03.jpg', 'photo-05.jpg', 'photo-21.jpg']
for (const j of jpegList) await lab('loadJpeg', j, '/jpeg/' + j)
const needRaw = want('local') || want('region') || want('highlights') || want('eyedropper') || want('tiling') || want('timing') || want('renders') || want('look')
if (needRaw) {
  console.log('arw', JSON.stringify(await lab('loadRaw', 'arw', '/sample/example-sony.ARW')))
  console.log('nef', JSON.stringify(await lab('loadRaw', 'nef', '/sample/iss030e122639.NEF')))
}

if (want('identity'))
  for (const j of jpegList) {
    const r = await lab('jpegIdentity', j)
    ok(r.max <= 1 && r.canvasMax <= 1, `JPEG identity ${j}`, r)
  }

if (want('exposure')) {
  const r = await lab('exposureRatio', 'photo-03.jpg')
  ok(Math.abs(r.median - 2) < 0.12, 'exposure +1 ≈ ×2 in midtones (JPEG)', r)
}

if (want('eyedropper')) {
  for (const n of ['arw', 'photo-01.jpg']) {
    const r = await lab('eyedropper', n)
    ok(r.spread < 0.01, `eyedropper neutralizes a tinted gray (${n})`, r)
  }
}

if (want('highlights')) {
  // +1.5 EV pushes the sky past white; highlights −100 must bring that detail back from scene values > 1.
  const a = await lab('exportRender', 'arw', { basic: { exposure: 1.5 } }, { maxLongEdge: 1600 })
  const b = await lab('exportRender', 'arw', { basic: { exposure: 1.5, highlights: -100 } }, { maxLongEdge: 1600 })
  ok(b.clipped < a.clipped * 0.5, 'highlights −100 reduces clipped area (ARW at +1.5 EV)', { default: a.clipped, hl100: b.clipped })
}

if (want('tiling')) {
  const g = { geometry: { crop: { x: 0.08, y: 0.1, w: 0.8, h: 0.7 }, angle: 7.5, rotate: 1, flipH: true, flipV: false, aspect: 'free' } }
  const r = await lab('tiling', 'nef', { ...g, basic: { clarity: 60, texture: 40, shadows: 50, dehaze: 30 }, detail: { sharpen: 60, radius: 1.2, detail: 25, masking: 20, noise: 40, noiseDetail: 50, colorNoise: 40 }, effects: { vignette: -40, vignetteMidpoint: 50, vignetteRoundness: 0, vignetteFeather: 50, grain: 30, grainSize: 25, grainRoughness: 50, fade: 0 } })
  ok(r.size[0] === r.expected[0] && r.size[1] === r.expected[1], 'renderImage size == outputSize (crop + rotate + flip + straighten)', r)
  ok(r.maxDiff16 <= 320 && r.meanDiff16 < 0.5, 'tiled export == single tile (16-bit, ≤ ~1/255)', r)
  save('tiling-single', await lab('tilePng', 0))
  save('tiling-tiled', await lab('tilePng', 1))
}

if (want('timing')) {
  const r = await lab('timing', 'arw', 1600, 1000)
  console.log('timing (SwiftShader, ARW half-size 6.4 MP into 1600×1000)', JSON.stringify(r))
}

if (want('region')) {
  const edit = { basic: { clarity: 40, shadows: 30, texture: 30 }, geometry: { crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, angle: 3, rotate: 0, flipH: false, flipV: false, aspect: 'free' } }
  const r = await lab('regionCheck', 'arw', edit, 900, 700)
  ok(r.maxDiff <= 2 && r.meanDiff < 0.6 && r.size[0] === r.export[0], '100 % view (renderRegion) == export pixels', r)
}

// Phase 2: five local layers of every mask kind, plus heal / clone spots.
const mask = (id, m, mode = 'add', invert = false) => ({ id, mode, invert, ...m })
const LAYERS = [
  { id: 'sky', name: 'Darken sky', enabled: true, opacity: 1, adjust: { exposure: -1.2, highlights: -60, saturation: 20, temp: -15 },
    masks: [mask('m1', { type: 'radial', cx: 0.85, cy: 0.06, rx: 0.32, ry: 0.2, angle: -12, feather: 70 })] },
  { id: 'dodge', name: 'Dodge bridge', enabled: true, opacity: 1, adjust: { exposure: 0.8, shadows: 40, clarity: 30 },
    masks: [mask('b1', { type: 'brush', strokes: [
      { points: [0.2, 0.25, 0.3, 0.35, 0.42, 0.5, 0.6].map((x) => ({ x, y: 0.62 - 0.55 * (x - 0.2) * (0.62 - x) * 2.2 })), r: 0.025, feather: 60, flow: 0.8 },
      { points: [{ x: 0.445, y: 0.54 }, { x: 0.445, y: 0.6 }], r: 0.012, feather: 20, flow: 1, erase: true },
    ] })] },
  { id: 'low', name: 'Lift dark water', enabled: true, opacity: 0.8, adjust: { shadows: 50, color: { hue: 30, sat: 30 }, whites: 10, blacks: -10 },
    masks: [mask('r1', { type: 'range', range: 'luminance', low: 0, high: 30, smooth: 40 }), mask('l1', { type: 'linear', x1: 0.5, y1: 1, x2: 0.5, y2: 0.6 }, 'intersect')] },
  { id: 'green', name: 'Calm greens', enabled: true, opacity: 1, adjust: { saturation: -35, temp: 20, tint: -10 },
    masks: [mask('c1', { type: 'range', range: 'color', hue: 90, sat: 60, low: 0, high: 35, smooth: 30 })] },
  { id: 'soft', name: 'Soften edges', enabled: true, opacity: 1, adjust: { sharpness: -60, noise: 50, contrast: -30, texture: -40, dehaze: 20 },
    masks: [mask('s1', { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.45, ry: 0.32, angle: 0, feather: 60 }, 'add', true)] },
]
const SPOTS = [
  { id: 'h1', mode: 'heal', x: 0.414, y: 0.714, r: 0.013, sx: 0.37, sy: 0.74, feather: 30, opacity: 1 },
  // A clone from far away: in the tiled export the source lies in another tile.
  { id: 'c1', mode: 'clone', x: 0.12, y: 0.2, r: 0.02, sx: 0.8, sy: 0.85, feather: 30, opacity: 1 },
]
const LOCAL = { layers: LAYERS, retouch: SPOTS }

if (want('local')) {
  const a = await lab('canvasParity', 'arw', LOCAL)
  ok(a.maxDiff <= 2, 'masks + spots: interactive canvas (1:1) == export', a)
  const b = await lab('regionCheck', 'arw', LOCAL, 1500, 1500)
  ok(b.maxDiff <= 2 && b.meanDiff < 0.6, 'masks + spots: 100 % view == export', b)
  const c = await lab('tiling', 'arw', LOCAL)
  ok(c.maxDiff16 <= 320 && c.meanDiff16 < 0.5, 'masks + spots: tiled export == single tile (16-bit)', c)
  const h = await lab('healCheck', 'arw', 0.414, 0.714, 0.013)
  save('heal-duck', h.png)
  // The feature's texture is gone (spread back to water level) and the brightness matches the surroundings.
  ok(h.after.std < h.before.std * 0.5 && Math.abs(h.after.inside - h.after.ring) < 8, 'heal spot removes a small feature', { ...h, png: undefined })
  const t = await lab('timing', 'arw', 1600, 1000, LOCAL)
  console.log('timing with 5 layers + 2 spots (SwiftShader, 1600×1000)', JSON.stringify(t))
}

if (want('context')) {
  const r = await lab('contextLoss', 'photo-21.jpg')
  ok(r.hasSource && r.center[3] === 255 && r.center[0] > 0, 'context lost → restored → renders again', r)
}

if (args.includes('full')) {
  const arw = await lab('fullExport', '/sample/example-sony.ARW')
  ok(arw.width === 6240 && arw.height === 4168, 'full-resolution 16-bit export of the 26 MP ARW', arw)
  const nef = await lab('fullExport', '/sample/iss030e122639.NEF')
  ok(nef.width >= 4200, 'full-resolution 16-bit export of the 12 MP NEF', nef)
}

if (want('renders') || want('look')) {
  let R = async (file, name, patch, maxLongEdge = 1400) => {
    const r = await lab('exportRender', name, patch, { maxLongEdge, png: true })
    save(file, r.png)
    console.log('render', file, JSON.stringify({ ...r, png: undefined }))
  }
  const only = args.filter((a) => !['renders', 'look', 'identity', 'exposure', 'eyedropper', 'highlights', 'tiling', 'timing', 'region', 'context', 'full', 'local'].includes(a))
  const R0 = R
  R = async (file, ...rest) => (only.length === 0 || only.some((o) => file.includes(o))) && R0(file, ...rest)
  await R('arw-default', 'arw', {})
  await R('nef-default', 'nef', {})
  await R('arw-hl-100-sh+100', 'arw', { basic: { highlights: -100, shadows: 100 } })
  await R('nef-hl-100-sh+100', 'nef', { basic: { highlights: -100, shadows: 100, exposure: 0.5 } })
  await R('arw-clarity+100', 'arw', { basic: { clarity: 100 } })
  await R('arw-clarity-100', 'arw', { basic: { clarity: -100 } })
  await R('arw-texture+100', 'arw', { basic: { texture: 100 } }, 2400)
  await R('arw-dehaze+70', 'arw', { basic: { dehaze: 70 } })
  await R('arw-dehaze-60', 'arw', { basic: { dehaze: -60 } })
  await R('arw-bw', 'arw', { treatment: 'bw', basic: { contrast: 20 } })
  await R('arw-grading', 'arw', { grading: { shadows: { hue: 200, sat: 40, lum: 0 }, midtones: { hue: 0, sat: 0, lum: 0 }, highlights: { hue: 40, sat: 35, lum: 0 }, global: { hue: 0, sat: 0, lum: 0 }, blending: 50, balance: 0 } })
  await R('arw-vignette-grain', 'arw', { effects: { vignette: -60, vignetteMidpoint: 40, vignetteRoundness: 0, vignetteFeather: 60, grain: 50, grainSize: 30, grainRoughness: 50, fade: 0 } })
  await R('arw-crop-straighten', 'arw', { geometry: { crop: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, angle: -8, rotate: 0, flipH: false, flipV: false, aspect: 'free' } })
  await R('arw-wb-3200', 'arw', { wb: { preset: 'custom', temp: 3200, tint: 0 } })
  await R('arw-vivid', 'arw', { profile: 'vivid' })
  await R('arw-exp-2', 'arw', { basic: { exposure: -2 } })
  await R('arw-local-5-layers', 'arw', LOCAL)
  await R('arw-sky-dodge', 'arw', { layers: LAYERS.slice(0, 2) })
  save('canvas-overlay', await lab('canvasShot', 'arw', LOCAL, { maskOverlay: 'dodge' }, 1200, 800))
  await R('jpg-21-default', 'photo-21.jpg', {})
  await R('jpg-21-edit', 'photo-21.jpg', { basic: { highlights: -60, shadows: 50, clarity: 30, vibrance: 30 } })
  await R('jpg-03-warm-curve', 'photo-03.jpg', { wb: { preset: 'custom', temp: 25, tint: 5 }, curve: { rgb: [{ x: 0, y: 0.05 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }], r: [{ x: 0, y: 0 }, { x: 1, y: 1 }], g: [{ x: 0, y: 0 }, { x: 1, y: 1 }], b: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })
  await R('jpg-05-mixer', 'photo-05.jpg', { mixer: { hue: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 }, sat: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 60, purple: 0, magenta: 0 }, lum: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: -40, purple: 0, magenta: 0 }, bw: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 } } })
  save('canvas-split', await lab('canvasShot', 'arw', { basic: { exposure: 0.7, shadows: 40 } }, { view: 'split', split: 0.5 }, 1200, 800))
  save('canvas-uncropped', await lab('canvasShot', 'arw', { geometry: { crop: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, angle: -8, rotate: 0, flipH: false, flipV: false, aspect: 'free' } }, { uncropped: true, showClipping: true }, 1200, 800))
}

await browser.close()
await server.close()
