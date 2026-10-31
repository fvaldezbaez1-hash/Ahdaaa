// Runs Lumen's on-device AI (src/ai) in headless Chromium on real photos:
// downloads the models from the dev server (public/models, see
// scripts/models/fetch.mjs), runs masks, click-to-select, removal, denoise and
// upscale, saves before/after PNGs and prints timings and the backend used.
// Headless Chromium here has no WebGPU, so this measures the WASM path.
//
// Usage (from photo/): node scripts/models/fetch.mjs && node scripts/ai/check.mjs <jpeg dir> <raw file> [out dir] [--quick] [--build]
//   --quick: one photo per task.  --build: production build of the check page (tests worker/WASM bundling).
//   --phone: low-memory mode as on an iPhone (1 GiB WASM heap cap, phone default models).
//   --only=name,name: just these steps.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const vite = await import(pathToFileURL(require.resolve('vite')).href)

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const [jpegDir, rawFile, outArg] = argv.filter((a) => !a.startsWith('--'))
if (!jpegDir) {
  console.error('Usage: node scripts/ai/check.mjs <jpeg dir> <raw file> [out dir] [--quick] [--build]')
  process.exit(2)
}
const OUT = resolve(outArg ?? join(tmpdir(), 'lumen-ai-check'))
mkdirSync(OUT, { recursive: true })
const ROOT = resolve(import.meta.dirname, '../..')
const PORT = 5207

const common = { root: ROOT, configFile: false, logLevel: process.env.VITE_LOG ?? 'error', base: './', worker: { format: 'es' } }
let server
if (flags.has('--build')) {
  const outDir = join(OUT, '..', 'ai-check-build')
  await vite.build({ ...common, build: { outDir, emptyOutDir: true, target: 'es2022', rollupOptions: { input: join(ROOT, 'scripts/ai/check.html') } } })
  server = await vite.preview({ ...common, build: { outDir }, preview: { port: PORT, strictPort: true } })
} else {
  server = await vite.createServer({
    ...common,
    server: { port: PORT, strictPort: true },
    optimizeDeps: { entries: ['scripts/ai/check.html'], include: ['dexie', 'exifr', 'utif2'], exclude: ['libraw-wasm', '@jsquash/jpeg', 'onnxruntime-web', '@mediapipe/tasks-vision'] },
  })
  await server.listen()
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
// --phone: an iPhone user agent, so Lumen runs in low-memory mode (1 GiB WASM cap, one model at a time, phone defaults).
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const page = await (await browser.newContext(flags.has('--phone') ? { userAgent: iphone } : {})).newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && !/favicon|Failed to load resource|onnxruntime|W\d{4}|I\d{4}/.test(m.text()) && console.log(`console.${m.type()}`, m.text().slice(0, 300)))
await page.exposeFunction('saveOutput', (name, b64) => writeFileSync(join(OUT, name), Buffer.from(b64, 'base64')))
await page.route('**/__jpeg/*', (route) => route.fulfill({ path: join(resolve(jpegDir), basename(new URL(route.request().url()).pathname)) }))
if (rawFile) await page.route('**/__raw/*', (route) => route.fulfill({ path: join(dirname(resolve(rawFile)), basename(new URL(route.request().url()).pathname)) }))
const base = flags.has('--build') ? `http://localhost:${PORT}/` : `http://localhost:${PORT}/scripts/ai/`
await page.goto(`${base}${flags.has('--build') ? 'scripts/ai/check.html' : 'check.html'}`)
await page.waitForFunction(() => typeof window.runCheck === 'function', null, { timeout: 120_000 })

const j = (n) => `/__jpeg/photo-${String(n).padStart(2, '0')}.jpg`
const photos = { 3: j(3), 4: j(4), 5: j(5), 6: j(6), 12: j(12), 13: j(13), 15: j(15), 16: j(16), 18: j(18), 19: j(19), 20: j(20), 21: j(21), 22: j(22), 23: j(23) }
if (rawFile) photos.raw = `/__raw/${basename(rawFile)}`
const quick = flags.has('--quick')
const stroke = (pts, r) => ({ points: pts.map(([x, y]) => ({ x, y })), r, feather: 30, flow: 1 })

const steps = [
  ...['mp-magic-touch', 'u2netp', 'isnet-general', 'mp-selfie-multiclass', 'mp-interactive', 'depth-anything-v2-small', 'migan-512', 'scunet-real', 'realesr-general-x4v3'].map((model) => ({ op: 'download', model })),
  // Subject / background
  ...(quick ? [23] : [3, 5, 6, 12, 18, 20, 23]).flatMap((p) => [
    { op: 'segment', photo: p, target: 'subject', model: 'u2netp', name: `subject-fast-${p}` },
    { op: 'segment', photo: p, target: 'subject', model: 'isnet-general', name: `subject-detailed-${p}` },
  ]),
  { op: 'segment', photo: 20, target: 'background', model: 'u2netp', name: 'background-20' },
  // Sky
  ...(quick ? [21] : [21, 19, 16, 13, 22, 6, 3, 23]).map((p) => ({ op: 'segment', photo: p, target: 'sky', name: `sky-${p}` })),
  // People and parts
  ...(quick ? [4] : [4, 15, 12, 18]).flatMap((p) => [
    { op: 'segment', photo: p, target: 'person', name: `person-${p}` },
    { op: 'segment', photo: p, target: 'person', parts: ['face', 'body'], name: `skin-${p}` },
    { op: 'segment', photo: p, target: 'person', parts: ['hair'], name: `hair-${p}` },
    { op: 'segment', photo: p, target: 'person', parts: ['clothes'], name: `clothes-${p}` },
  ]),
  // Click to select
  { op: 'select', photo: 23, points: [{ x: 0.22, y: 0.55, positive: true }], name: 'select-parrot-23' },
  { op: 'select', photo: 23, points: [{ x: 0.22, y: 0.55, positive: true }], model: 'mp-magic-touch', name: 'select-v1-parrot-23' },
  { op: 'select', photo: 6, points: [{ x: 0.35, y: 0.62, positive: true }, { x: 0.45, y: 0.25, positive: false }], model: 'mp-magic-touch', name: 'select-v1-boat-minus-mast-6' },
  { op: 'select', photo: 6, points: [{ x: 0.35, y: 0.62, positive: true }, { x: 0.45, y: 0.25, positive: false }], name: 'select-boat-minus-mast-6' },
  ...(quick ? [] : [{ op: 'select', photo: 20, points: [{ x: 0.5, y: 0.55, positive: true }], name: 'select-plane-20' }]),
  // Removal
  {
    op: 'inpaint',
    photo: 12,
    strokes: [
      stroke([[0.35, 0.21], [0.34, 0.45], [0.33, 0.72]], 0.05),
      stroke([[0.43, 0.14], [0.43, 0.4], [0.44, 0.67]], 0.05),
      stroke([[0.31, 0.56], [0.36, 0.73]], 0.04),
      stroke([[0.48, 0.44], [0.48, 0.6]], 0.03),
    ],
    name: 'remove-couple-12',
  },
  ...(quick ? [] : [
    {
      op: 'inpaint',
      photo: 6,
      strokes: [stroke([[0.12, 0.62], [0.3, 0.63], [0.5, 0.64], [0.68, 0.64]], 0.07), stroke([[0.43, 0.08], [0.43, 0.3], [0.43, 0.5]], 0.03), stroke([[0.25, 0.48], [0.55, 0.55], [0.75, 0.6]], 0.03)],
      name: 'remove-boat-6',
    },
    { op: 'inpaint', photo: 21, strokes: [stroke([[0.452, 0.12], [0.452, 0.35], [0.452, 0.58]], 0.045)], name: 'remove-lighthouse-21' },
  ]),
  // Denoise: synthetic noise on a JPEG, and a crop of the RAW at full resolution
  { op: 'denoise', photo: 13, noise: 0.12, name: 'denoise-noisy-13' },
  // Upscale
  { op: 'upscale', photo: 21, crop: { x: 300, y: 50, w: 256, h: 256 }, name: 'upscale-21' },
]
if (rawFile) {
  steps.push(
    { op: 'segment', photo: 'raw', target: 'subject', model: 'u2netp', name: 'subject-fast-raw' },
    { op: 'segment', photo: 'raw', target: 'sky', name: 'sky-raw' },
    { op: 'denoise', photo: 'raw', crop: { x: 2400, y: 1600, w: 512, h: 512 }, name: 'denoise-raw-crop' },
    { op: 'inpaint', photo: 'raw', strokes: [stroke([[0.48, 0.48], [0.52, 0.52]], 0.02)], name: 'remove-raw' },
  )
}
// --only=name,name: run just those steps (plus the downloads).
const only = argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const plan = only ? steps.filter((s) => s.op === 'download' || only.includes(s.name)) : steps
const t0 = Date.now()
const log = await page.evaluate((plan) => window.runCheck(plan), { photos, steps: plan })
await browser.close()
await server.close()
let errors = 0
for (const l of log) {
  if (l.error) errors++
  console.log(JSON.stringify(l))
}
console.log(`\n${log.length} steps in ${Math.round((Date.now() - t0) / 1000)} s, ${errors} errors; outputs in ${OUT}`)
process.exit(errors ? 1 : 0)
