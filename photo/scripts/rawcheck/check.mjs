// Dev check: decode sample RAW files with libraw-wasm in headless Chromium
// through the Vite dev server (no cross-origin isolation headers).
// Usage: node scripts/rawcheck/check.mjs /path/to/samples
import { createServer } from 'vite'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const samples = resolve(process.argv[2] ?? '.')
const server = await createServer({ root: resolve('scripts/rawcheck'), configFile: false, logLevel: 'error', server: { port: 5199 }, optimizeDeps: { exclude: ['libraw-wasm'] } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.route('**/sample/*', (route) => route.fulfill({ path: join(samples, decodeURIComponent(route.request().url().split('/sample/')[1])) }))
await page.goto('http://localhost:5199/')
await page.waitForFunction(() => window.ready, null, { timeout: 60000 })
const lin = { outputBps: 16, gamm: [1, 1], noAutoBright: true, useCameraWb: true, outputColor: 0, userQual: 3, highlight: 0 }
for (const f of readdirSync(samples).filter((f) => /\.(arw|nef|cr2|cr3|raf|dng|orf|rw2)$/i.test(f))) {
  for (const s of [{ ...lin, halfSize: true }, lin]) {
    try {
      const r = await page.evaluate(([u, s]) => window.run(u, s), ['/sample/' + encodeURIComponent(f), s])
      console.log(f, s.halfSize ? 'half' : 'full', JSON.stringify(r))
    } catch (e) { console.log(f, 'ERROR', e.message.slice(0, 300)) }
  }
}
await browser.close()
await server.close()
