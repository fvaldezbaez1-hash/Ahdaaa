// Render built-in looks with the real engine into contact sheets (PNG), to
// judge them by eye. Run from photo/:
//   node scripts/presets/sheet.mjs [collection ids… | --look <preset id>] [--raw] [--out DIR]
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d)
const flag = (k) => (args.includes(k) ? (args.splice(args.indexOf(k), 1), true) : false)
const scratch = '/tmp/claude-0/-home-user-Ahdaaa/cf4d7424-a810-59a5-8866-82dcbe7ba388/scratchpad'
const outDir = resolve(opt('--out', join(scratch, 'agents/presets/sheets')))
const lookId = opt('--look')
const withRaw = flag('--raw')
mkdirSync(outDir, { recursive: true })

const server = await createServer({ root: resolve('.'), configFile: false, logLevel: 'error', server: { port: 5205 }, optimizeDeps: { entries: ['scripts/presets/lab.html'], exclude: ['libraw-wasm'] } })
await server.listen()
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()))
  await page.route('**/jpeg/*', (r) => r.fulfill({ path: join(scratch, 'lumen-assets', decodeURIComponent(r.request().url().split('/jpeg/')[1])) }))
  await page.route('**/sample/*', (r) => r.fulfill({ path: join(scratch, 'samples', decodeURIComponent(r.request().url().split('/sample/')[1])) }))
  await page.goto('http://localhost:5205/scripts/presets/lab.html')
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
  const names = ['photo-15.jpg', 'photo-21.jpg', 'photo-22.jpg', 'photo-23.jpg']
  for (const n of names) await page.evaluate(([n]) => window.lab.loadJpeg(n, '/jpeg/' + n), [n])
  if (withRaw) {
    await page.evaluate(() => window.lab.loadRaw('arw', '/sample/example-sony.ARW'))
    names.push('arw')
  }
  const save = (name, b64) => writeFileSync(join(outDir, name + '.png'), Buffer.from(b64, 'base64'))
  if (lookId) save(`look-${lookId}`, await page.evaluate(([id, n]) => window.lab.lookSheet(id, n), [lookId, names]))
  else {
    const ids = args.length ? args : await page.evaluate(() => window.lab.ids())
    for (const id of ids) {
      save(id, await page.evaluate(([id, n]) => window.lab.collectionSheet(id, n), [id, names]))
      console.log('sheet', id)
    }
  }
} finally {
  await browser.close()
  await server.close()
}
