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
const t0 = Date.now()
let log = []
const pageSteps = STEPS.filter((s) => s !== 'ui')
if (pageSteps.length) {
  await page.goto(`http://localhost:${PORT}/scripts/merge/check.html`)
  await page.waitForFunction(() => typeof window.runCheck === 'function', null, { timeout: 120_000 })
  log = await page.evaluate((plan) => window.runCheck(plan), { raw: `/__raw/${basename(RAW)}`, steps: pageSteps })
}
await server.close()
if (STEPS.includes('ui')) log.push(await uiStep())
await browser.close()
let errors = 0
for (const l of log) {
  if (l.error || l.ok === false) errors++
  console.log(JSON.stringify(l))
}
console.log(`\n${log.length} steps in ${Math.round((Date.now() - t0) / 1000)} s, ${errors} problems; outputs in ${OUT}`)
process.exit(errors ? 1 : 0)

/**
 * The merge sheet in the real app: import the panorama crops the pano step saved,
 * select them, Merge… → preview → Merge panorama → the editor opens on the result.
 * Desktop through the batch bar, phone through the More menu.
 */
async function uiStep() {
  const t = Date.now()
  const crops = [0, 1, 2, 3].map((n) => join(OUT, `pano-crop${n}.jpg`))
  const app = await vite.createServer({ root: ROOT, logLevel: 'error', server: { port: PORT + 1, strictPort: true } })
  await app.listen()
  const res = { step: 'ui' }
  try {
    for (const phone of [false, true]) {
      const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1400, height: 900 } })
      const p = await ctx.newPage()
      p.on('pageerror', (e) => console.log('ui pageerror', e.message))
      await p.route('**/__crop/*', (route) => route.fulfill({ path: join(OUT, basename(new URL(route.request().url()).pathname)) }))
      await p.goto(`http://localhost:${PORT + 1}/`)
      await p.waitForSelector('.welcome, .lib, .plib', { timeout: 120_000 })
      await p.evaluate(async (names) => {
        const { importFiles } = await import('/src/io/api.ts')
        const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/__crop/${n}`)).blob()], n, { type: 'image/jpeg' })))
        await importFiles(files)
      }, crops.map((c) => basename(c)))
      await p.reload()
      await p.waitForSelector('.tile, .ptile, [data-id]', { timeout: 60_000 })
      if (phone) {
        await p.locator('.plib-title button', { hasText: 'Select' }).click()
        await p.locator('button.btn.ghost.lg', { hasText: /^All$/ }).click()
        await p.locator('.plib-batch button', { hasText: 'More' }).click()
        await p.locator('.sheet button', { hasText: 'Merge to HDR or panorama' }).click()
      } else {
        await p.locator('.tile .tile-media').first().click()
        await p.keyboard.press('Control+a')
        await p.locator('.lib-batch button[aria-label="Merge…"]').click()
      }
      await p.waitForSelector('.merge-preview canvas', { timeout: 120_000 })
      await p.waitForFunction(() => !document.querySelector('.merge-preview-status'), null, { timeout: 120_000 })
      const kind = await p.locator('.merge-sheet .segmented button.on').first().textContent()
      const size = await p.locator('.sheet .lib-foot .grow').textContent()
      await p.screenshot({ path: join(OUT, `ui-${phone ? 'phone' : 'desktop'}.png`) })
      res[phone ? 'phone' : 'desktop'] = { kind, size }
      if (!phone) {
        await p.locator('.sheet .btn.primary').click()
        await p.waitForFunction(() => location.hash.startsWith('#/edit/'), null, { timeout: 300_000 })
        const id = decodeURIComponent((await p.evaluate(() => location.hash)).slice(7))
        const rec = await p.evaluate(async (id) => (await import('/src/io/db.ts')).db.photos.get(id), id)
        res.merged = { fileName: rec?.fileName, merged: rec?.merged?.kind, sources: rec?.merged?.sources.length, size: rec && `${rec.width}×${rec.height}` }
        await p.waitForTimeout(3000)
        await p.screenshot({ path: join(OUT, 'ui-editor.png') })
      }
      await ctx.close()
    }
    res.ok = res.desktop?.kind === 'Panorama' && res.phone?.kind === 'Panorama' && res.merged?.merged === 'pano' && res.merged?.sources === 4
  } catch (e) {
    res.error = String(e?.message ?? e).split('\n')[0]
  } finally {
    await app.close()
  }
  return { ...res, ms: Date.now() - t }
}
