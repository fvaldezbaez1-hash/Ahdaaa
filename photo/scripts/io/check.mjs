// End-to-end check of the IO layer in headless Chromium: imports the sample
// RAW/JPEG files through the real API, loads working images, exports
// JPEG/PNG/TIFF16 through the test sink, then verifies the files here in Node
// (exifr + structure) and with Pillow when available.
// Usage (in photo/): node scripts/io/check.mjs [samplesDir] [jpegDir] [outDir]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const exifr = (await import('exifr')).default

const scratch = '/tmp/claude-0/-home-user-Ahdaaa/cf4d7424-a810-59a5-8866-82dcbe7ba388/scratchpad'
const samples = resolve(process.argv[2] ?? `${scratch}/samples`)
const jpegs = resolve(process.argv[3] ?? `${scratch}/lumen-assets`)
const outDir = resolve(process.argv[4] ?? `${scratch}/agents/io/out`)
mkdirSync(outDir, { recursive: true })

const server = await createServer({
  root: resolve('.'),
  configFile: false,
  logLevel: 'error',
  server: { port: 5202, strictPort: true },
  worker: { format: 'es' },
  optimizeDeps: { entries: ['scripts/io/check.html'], include: ['dexie', 'exifr', 'utif2'], exclude: ['libraw-wasm', '@jsquash/jpeg'] },
})
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text().slice(0, 300)))
await page.exposeFunction('saveOutput', (name, b64) => writeFileSync(join(outDir, name), Buffer.from(b64, 'base64')))
await page.route('**/__sample/*', (route) => route.fulfill({ path: join(samples, decodeURIComponent(route.request().url().split('/__sample/')[1])) }))
await page.route('**/__jpeg/*', (route) => route.fulfill({ path: join(jpegs, decodeURIComponent(route.request().url().split('/__jpeg/')[1])) }))

// Peak resident memory of the browser (all processes: page, workers, GPU).
let peakRss = 0
const rssTimer = setInterval(() => {
  try {
    const kb = execFileSync('ps', ['-C', 'chrome,headless_shell,chrome-headless-shell', '-o', 'rss=']).toString().split('\n').reduce((s, x) => s + (+x || 0), 0)
    peakRss = Math.max(peakRss, kb)
  } catch { /* no matching process yet */ }
}, 100)

await page.goto('http://localhost:5202/scripts/io/check.html')
await page.waitForFunction(() => typeof window.runCheck === 'function', null, { timeout: 60_000 })
const raws = readdirSync(samples).filter((f) => /\.(arw|nef|cr2|cr3|raf|dng|orf|rw2)$/i.test(f)).map((f) => `/__sample/${encodeURIComponent(f)}`)
const jpgs = readdirSync(jpegs).filter((f) => /\.jpe?g$/i.test(f)).sort().slice(0, 3).map((f) => `/__jpeg/${f}`)
const report = await page.evaluate((u) => window.runCheck(u), [...raws, ...jpgs])
clearInterval(rssTimer)
report.peakBrowserRssMB = Math.round(peakRss / 1024)
await browser.close()
await server.close()
console.log(JSON.stringify(report, null, 1))

// Verify the saved files.
const problems = []
const check = (ok, msg) => ok || problems.push(msg)
const jpegSize = (b) => {
  for (let i = 2; i < b.length; ) {
    const m = b[i + 1], len = b.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
    i += 2 + len
  }
}
for (const name of readdirSync(outDir)) {
  const b = readFileSync(join(outDir, name))
  const meta = await exifr.parse(b, { tiff: true, exif: true, icc: true }).catch((e) => ({ error: e.message }))
  let pil = ''
  try {
    pil = execFileSync('python3', ['-I', '-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.load();print(im.format,im.mode,im.size,len(im.info.get("icc_profile") or b""))', join(outDir, name)]).toString().trim()
  } catch (e) { pil = `PIL error: ${e.message.split('\n').slice(-2).join(' ')}` }
  const size = name.endsWith('.jpg') ? jpegSize(b) : undefined
  console.log(`${name}: ${b.length} bytes, ${size ? `${size[0]}x${size[1]}, ` : ''}Make=${meta?.Make} Model=${meta?.Model} ISO=${meta?.ISO} Date=${meta?.DateTimeOriginal?.toISOString?.()} ICC=${meta?.ProfileDescription ?? '-'} | PIL: ${pil}`)
  check(!pil.startsWith('PIL error'), `${name}: Pillow can't read it`)
  check(meta?.Make?.toUpperCase() === 'SONY', `${name}: EXIF Make missing`)
  if (/P3/.test(name)) check(meta?.ProfileDescription === 'Display P3', `${name}: no Display P3 ICC`)
}
for (const e of report.exports) check(e.failed.length === 0, `${e.label}: ${JSON.stringify(e.failed)}`)
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'All output checks passed.')
process.exit(problems.length ? 1 : 0)
