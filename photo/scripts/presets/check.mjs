// End-to-end check of presets in headless Chromium (SwiftShader WebGL2): the
// Presets screen, the editor's presets column and phone strip, favorites,
// saving a preset, Lightroom import, with screenshots at 1440×900 and 390×844,
// dark and light.
//
// Usage (from photo/): node scripts/presets/check.mjs <dir with photo-15/21/22/23.jpg> [screenshot dir]
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const ROOT = resolve(import.meta.dirname, '../..')
const ASSETS = resolve(process.argv[2] ?? '.')
const OUT = resolve(process.argv[3] ?? join(tmpdir(), 'lumen-presets-check'))
const PORT = 5205
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`)
  if (!ok) failures.push(what)
}

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Version="16.0" crs:ProcessVersion="15.4"
 crs:Contrast2012="+18" crs:Highlights2012="-40" crs:Shadows2012="+25" crs:Vibrance="+12" crs:IncrementalTemperature="+10"
 crs:ColorGradeShadowHue="200" crs:ColorGradeShadowSat="22" crs:ColorGradeHighlightHue="40" crs:ColorGradeHighlightSat="16"
 crs:RedHue="+10" crs:LensProfileEnable="1" crs:GrainAmount="15">
<crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Summer Teal</rdf:li></rdf:Alt></crs:Name>
<crs:MaskGroupBasedCorrections><rdf:Seq><rdf:li><rdf:Description crs:LocalExposure2012="0.5"/></rdf:li></rdf:Seq></crs:MaskGroupBasedCorrections>
</rdf:Description></rdf:RDF></x:xmpmeta>`
const xmpPath = join(OUT, 'summer-teal.xmp')
writeFileSync(xmpPath, XMP)

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && page.errors.push(m.text()))
  await page.route('**/__assets/*', (route) => route.fulfill({ path: join(ASSETS, basename(new globalThis.URL(route.request().url()).pathname)) }))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('#root > *')
  return page
}

const shot = async (page, name) => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}
const theme = (page, t) => page.evaluate(async (t) => (await import('/src/state/settings.ts')).updateSettings({ theme: t }), t)
const go = (page, path) => page.evaluate((p) => (location.hash = p), path)
const rendered = (page) => page.locator('.lk-thumb canvas.on').count()
async function until(fn, timeout = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeout) return v
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function importPhotos(page, names) {
  return page.evaluate(async (names) => {
    const { importFiles } = await import('/src/io/api.ts')
    const files = []
    for (const n of names) files.push(new File([await (await fetch(`/__assets/${n}`)).blob()], n))
    return (await importFiles(files)).added
  }, names)
}
const editorState = (page) => page.evaluate(async () => (await import('/src/state/editor.ts')).editor.getState())

// ---------- Desktop ----------
{
  const page = await open({ width: 1440, height: 900 })
  // Empty library first: the friendly empty state.
  await go(page, '/presets')
  await page.waitForSelector('.ps')
  check((await page.locator('.ps-stage-empty').count()) === 1, 'empty library shows an import prompt')
  await shot(page, 'desktop-empty-dark')

  const ids = await importPhotos(page, ['photo-21.jpg', 'photo-15.jpg', 'photo-22.jpg', 'photo-23.jpg'])
  check(ids.length === 4, 'imported 4 photos')
  await go(page, '/')
  await go(page, '/presets')
  await page.waitForSelector('.ps-canvas canvas')
  const n = await until(async () => (await rendered(page)) >= 8 && (await rendered(page)))
  check(n >= 8, `live previews render on the Presets screen (${n})`)
  check((await page.locator('.ps-grid .lk-reason').count()) >= 8, 'Best for this photo shows reasons')
  await shot(page, 'desktop-screen-dark')

  // Pick a collection and a look; amount; hold to compare.
  await page.locator('.ps-nav', { hasText: 'Film' }).click()
  await page.locator('.ps-grid .lk-pick', { hasText: 'Warm 400' }).click()
  check((await page.locator('.ps-detail h1').textContent()) === 'Warm 400', 'selecting a look shows it in the detail column')
  const box = await page.locator('.ps-stage').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  check((await page.locator('.ps-hold').textContent()) === 'Before', 'hold to compare shows Before')
  await page.mouse.up()
  await page.locator('.ps-detail input[type=range]').focus()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  check((await page.locator('.ps-detail .slider-value').textContent()) === '120%', 'amount slider moves in 10 % steps with Shift')
  await page.locator('.ps-detail .ps-fav').click()
  check(await until(() => page.evaluate(async () => (await (await import('/src/state/settings.ts')).loadSettings()).favoritePresets.includes('film-warm-400'))), 'favorite saved to settings')
  await page.locator('.ps-nav', { hasText: 'Favorites' }).click()
  check((await page.locator('.ps-grid .lk-tile').count()) === 1, 'Favorites lists the starred look')

  // Search across everything.
  await page.locator('.ps-search input').fill('teal')
  await page.waitForTimeout(200)
  const hits = await page.locator('.ps-grid .lk-tile').count()
  check(hits >= 2, `search finds teal looks (${hits})`)
  await page.locator('.ps-search input').fill('')

  // Describe a look without AI set up: explains how to turn it on.
  await page.locator('.ps-ai input').fill('90s disposable camera')
  await page.locator('.ps-ai button').click()
  check(await until(() => page.locator('.ps-ai-wrap a[href="#/settings"]').count(), 5000), 'Describe a look explains how to turn on the AI')

  // Lightroom import with a fidelity report.
  await page.locator('.ps-side input[type=file]').setInputFiles(xmpPath)
  await page.waitForSelector('.pp-report')
  const report = await page.locator('.pp-report').textContent()
  check(/Summer Teal/.test(report) && /Masks/.test(report) && /Calibration/.test(report) && /Lens/.test(report), 'Lightroom import reports what didn’t map')
  await shot(page, 'desktop-import-report')
  await page.keyboard.press('Escape')
  await page.locator('.ps-nav', { hasText: 'From Lightroom' }).click()
  check((await page.locator('.ps-grid .lk-tile').count()) === 1, 'imported preset is listed under From Lightroom')
  await page.locator('.ps-nav', { hasText: 'Film' }).click()
  await page.locator('.ps-grid .lk-pick', { hasText: 'Warm 400' }).click()
  await theme(page, 'light')
  await shot(page, 'desktop-screen-light')
  await theme(page, 'dark')

  // Apply & edit.
  await page.locator('.ps-detail .btn.primary').click()
  await page.waitForSelector('.ed-left .pp')
  const s = await until(async () => {
    const st = await editorState(page)
    return st.recipe?.look ? st : null
  })
  check(s?.recipe?.look?.presetId === 'film-warm-400' && s.recipe.look.amount === 100, 'Apply & edit opens the editor with the look applied')
  await until(async () => (await rendered(page)) >= 6)
  await shot(page, 'desktop-editor-dark')

  // Editor column: apply another look, change amount, remove; no stacking.
  await page.locator('.pp-chips .chip', { hasText: 'Black & White' }).click()
  await page.locator('.pp-grid .lk-pick', { hasText: 'High Contrast' }).click()
  let st = await editorState(page)
  check(st.recipe.look?.presetId === 'bw-high-contrast' && st.recipe.treatment === 'bw' && st.recipe.wb.temp === 0, 'switching looks replaces the old one (white balance restored)')
  await page.locator('.pp-applied input[type=range]').focus()
  await page.keyboard.press('Shift+ArrowLeft')
  st = await editorState(page)
  check(st.recipe.look?.amount === 90 && st.recipe.basic.contrast === 36, `amount 90 % scales the look (contrast ${st.recipe.basic.contrast})`)
  check(st.history[0].label.startsWith('Preset · High Contrast'), 'amount change is one undo step')
  await until(async () => (await rendered(page)) >= 6)
  await theme(page, 'light')
  await shot(page, 'desktop-editor-light')
  await theme(page, 'dark')
  await page.locator('.pp-applied .btn', { hasText: 'Remove' }).click()
  st = await editorState(page)
  check(!st.recipe.look && st.recipe.treatment === 'color' && st.recipe.basic.contrast === 0, 'Remove takes the look off')

  // Save as preset.
  await page.locator('.pp-save').click()
  await page.locator('.sheet input').first().fill('My Test Look')
  await page.locator('.sheet .btn.primary').click()
  check(await until(() => page.evaluate(async () => (await (await import('/src/io/db.ts')).db.presets.where('source').equals('user').count()) === 1)), 'Save as preset adds it to My presets')
  await page.locator('.pp-chips .chip', { hasText: 'Mine' }).click()
  check((await page.locator('.pp-grid .lk-tile').count()) === 2, 'Mine lists the saved and imported presets')
  check(page.errors.length === 0, `no page errors on desktop ${page.errors.join(' | ')}`)
  await page.context().close()
}

// ---------- Phone ----------
{
  const page = await open({ width: 390, height: 844 }, true)
  const ids = await importPhotos(page, ['photo-15.jpg', 'photo-21.jpg'])
  await go(page, '/presets')
  await page.waitForSelector('.ps-phone')
  await until(async () => (await rendered(page)) >= 6)
  await shot(page, 'phone-screen-dark')
  await page.locator('.ps-phone-grid .lk-pick').nth(2).click()
  await theme(page, 'light')
  await shot(page, 'phone-screen-light')
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  check(wide <= 390, `no horizontal page scroll on phone (${wide})`)
  await theme(page, 'dark')

  await go(page, `/edit/${ids[1]}`)
  await page.waitForSelector('.ed-phone')
  await page.locator('.ed-tool', { hasText: 'Presets' }).click()
  await page.waitForSelector('.pp-strip')
  await until(async () => (await rendered(page)) >= 3)
  await page.locator('.pp-strip .lk-pick').nth(1).click()
  const st = await editorState(page)
  check(!!st.recipe.look, 'tapping a look in the phone strip applies it')
  await shot(page, 'phone-editor-dark')
  await theme(page, 'light')
  await shot(page, 'phone-editor-light')
  check(page.errors.length === 0, `no page errors on phone ${page.errors.join(' | ')}`)
  await page.context().close()
}

await browser.close()
await server.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
