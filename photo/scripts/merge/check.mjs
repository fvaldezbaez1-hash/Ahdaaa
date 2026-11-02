// End-to-end check of HDR and panorama merging in headless Chromium with the
// real decode path (LibRaw) and the merge workers. Saves outputs as PNG/DNG.
// Usage (from photo/): node scripts/merge/check.mjs <raw file> <jpeg dir> [out dir] [step…]
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const vite = await import(pathToFileURL(require.resolve('vite')).href)

const [rawArg, jpegDir, outArg, ...stepArgs] = process.argv.slice(2)
if (!rawArg || !jpegDir) {
  console.error('Usage: node scripts/merge/check.mjs <raw file> <jpeg dir> [out dir] [step…]')
  process.exit(2)
}
const RAW = resolve(rawArg)
const OUT = resolve(outArg ?? join(tmpdir(), 'lumen-merge-check'))
const STEPS = stepArgs.length ? stepArgs : ['dng', 'hdr', 'pano']
mkdirSync(OUT, { recursive: true })
const ROOT = resolve(import.meta.dirname, '../..')
const PORT = 5209
const server = await vite.createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  base: './',
  worker: { format: 'es' },
  server: { port: PORT, strictPort: true },
  optimizeDeps: { entries: ['scripts/merge/check.html'], include: ['dexie', 'exifr', 'utif2'], exclude: ['libraw-wasm', '@jsquash/jpeg'] },
})
await server.listen()
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && console.log('console.error', m.text().slice(0, 300)))
await page.exposeFunction('saveOutput', (name, b64) => writeFileSync(join(OUT, name), Buffer.from(b64, 'base64')))
await page.route('**/__raw/*', (route) => route.fulfill({ path: join(dirname(RAW), basename(new URL(route.request().url()).pathname)) }))
await page.route('**/__jpeg/*', (route) => route.fulfill({ path: join(resolve(jpegDir), basename(new URL(route.request().url()).pathname)) }))
await page.goto(`http://localhost:${PORT}/scripts/merge/check.html`)
await page.waitForFunction(() => typeof window.runCheck === 'function', null, { timeout: 120_000 })
const t0 = Date.now()
const log = await page.evaluate((plan) => window.runCheck(plan), { raw: `/__raw/${basename(RAW)}`, jpegs: [], steps: STEPS })
await browser.close()
await server.close()
let errors = 0
for (const l of log) {
  if (l.error || l.ok === false) errors++
  console.log(JSON.stringify(l))
}
console.log(`\n${log.length} steps in ${Math.round((Date.now() - t0) / 1000)} s, ${errors} problems; outputs in ${OUT}`)
process.exit(errors ? 1 : 0)
