// End-to-end check of the editing screen in headless Chromium with the real
// import pipeline and WebGL2 engine: imports JPEGs (and a RAW), opens the
// editor, drags sliders, crops, uses shortcuts, copy/paste and persistence,
// and takes screenshots (desktop 1440×900, phone 390×844, dark and light).
//
// Usage (from photo/): node scripts/editor/check.mjs <jpeg dir> <raw file> [screenshot dir] [phase…]
// Phases: desktop phone states raw (default: all)
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const ROOT = resolve(import.meta.dirname, '../..')
const ASSETS = resolve(process.argv[2] ?? '.')
const RAW = process.argv[3] ? resolve(process.argv[3]) : null
const OUT = resolve(process.argv[4] ?? join(tmpdir(), 'lumen-editor-check'))
const PHASES = process.argv.slice(5).length ? process.argv.slice(5) : ['desktop', 'phone', 'states', 'raw']
const PORT = 5204
const URL = `http://localhost:${PORT}/`
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`)
  if (!ok) failures.push(what)
}

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
  if (RAW) await page.route('**/__raw/*', (route) => route.fulfill({ path: join(dirname(RAW), basename(new globalThis.URL(route.request().url()).pathname)) }))
  await page.goto(URL)
  await page.waitForSelector('#root > *')
  return page
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts })
}

/** Import files through the real pipeline; returns the new photo ids in order. */
async function importPhotos(page, urls) {
  return page.evaluate(async (urls) => {
    const { importFiles } = await import('/src/io/api.ts')
    const files = []
    for (const u of urls) files.push(new File([await (await fetch(u)).blob()], u.split('/').pop()))
    const r = await importFiles(files)
    return r.added
  }, urls)
}

const state = (page) =>
  page.evaluate(async () => {
    const { editor } = await import('/src/state/editor.ts')
    const { view } = await import('/src/editor/view.ts')
    const s = editor.getState()
    const v = view.get()
    return { photoId: s.photoId, recipe: s.recipe, history: s.history.map((h) => h.label), canUndo: s.canUndo, canRedo: s.canRedo, mode: v.mode, tool: v.tool, zoom: v.zoom, sheet: v.sheet, hist: !!v.histogram }
  })

const stored = (page, id) => page.evaluate(async (id) => (await (await import('/src/io/db.ts')).db.photos.get(id))?.recipe, id)

/** Poll an async page function until it returns something truthy. */
async function until(page, fn, arg, timeout = 30000) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await page.evaluate(fn, arg)
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${fn.toString().slice(0, 80)}`)
    await page.waitForTimeout(100)
  }
}

async function openEditor(page, id) {
  if (id) await page.evaluate((id) => (location.hash = `#/edit/${id}`), id)
  await until(page, async (id) => (await import('/src/state/editor.ts')).editor.getState().photoId === id && document.querySelector('.ed-photo canvas')?.width > 1, id, 60000)
  await until(page, async () => (await import('/src/editor/view.ts')).view.get().histogram !== null)
}

/** Screenshot of the photo only, for "did the pixels change". */
const photoPixels = async (page) => (await page.locator('.ed-photo').screenshot()).toString('base64')

/** Drag a range input by `fraction` of its width from its current thumb position. */
async function dragSlider(page, label, fraction) {
  const input = page.getByRole('slider', { name: label, exact: true }).first()
  const box = await input.boundingBox()
  const v = await input.evaluate((el) => (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min)))
  const x0 = box.x + 7 + v * (box.width - 14), y = box.y + box.height / 2
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (fraction * (box.width - 14) * i) / 8, y)
  await page.mouse.up()
}

const setTheme = (page, theme) =>
  page.evaluate(async (theme) => {
    const { updateSettings } = await import('/src/state/settings.ts')
    await updateSettings({ theme })
  }, theme)

async function desktop() {
  console.log('desktop')
  const page = await open({ width: 1440, height: 900 })
  const names = [21, 6, 13, 16, 22, 3].map((n) => `/__assets/photo-${String(n).padStart(2, '0')}.jpg`)
  const ids = await importPhotos(page, names)
  check(ids.length === 6, 'imported 6 JPEGs')
  const id = ids[0]
  await openEditor(page, id)
  let s = await state(page)
  check(s.photoId === id && !!s.recipe, 'editor opened the photo')
  check(s.hist, 'histogram computed after the first render')
  check(await page.getByText('6 of 6').isVisible(), 'toolbar shows "6 of 6"')
  await shot(page, 'desktop-dark')

  // Exposure: drag → live preview, release → one undo step; pixels change.
  const before = await photoPixels(page)
  await dragSlider(page, 'Exposure', 0.12)
  await page.waitForTimeout(200)
  s = await state(page)
  check(s.recipe.basic.exposure > 0.5, `exposure dragged to ${s.recipe.basic.exposure}`)
  check(s.history[0].startsWith('Exposure +'), `history says "${s.history[0]}"`)
  check((await photoPixels(page)) !== before, 'the photo changed on screen')

  // Persistence ~400 ms after the change.
  await page.waitForTimeout(700)
  check((await stored(page, id))?.basic.exposure === s.recipe.basic.exposure, 'recipe saved to the database')

  // Undo / redo shortcuts.
  await page.locator('.ed-stage').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  s = await state(page)
  check(s.recipe.basic.exposure === 0, 'Ctrl+Z undid the exposure')
  await page.keyboard.press('Control+Shift+z')
  s = await state(page)
  check(s.recipe.basic.exposure > 0.5, 'Ctrl+Shift+Z redid it')

  // Before / after.
  await page.keyboard.press('\\')
  check((await state(page)).mode === 'before', '\\ shows the original')
  await page.keyboard.press('\\')
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await shot(page, 'desktop-split')
  await page.getByRole('button', { name: 'After', exact: true }).click()

  // Open the other sections and screenshot them.
  for (const t of ['Tone curve', 'Color mixer', 'Color grading']) await page.getByRole('button', { name: t }).click()
  await page.locator('.ed-right').evaluate((el) => (el.scrollTop = 700))
  await shot(page, 'desktop-curve-mixer')
  await page.locator('.ed-right').evaluate((el) => (el.scrollTop = 1500))
  await shot(page, 'desktop-grading')
  await page.locator('.ed-right').evaluate((el) => (el.scrollTop = 0))

  // Curve: click adds a point, drag bends the curve.
  const curve = page.locator('.ed-curve')
  await curve.scrollIntoViewIfNeeded()
  const cb = await curve.boundingBox()
  await page.mouse.move(cb.x + cb.width * 0.25, cb.y + cb.height * 0.75)
  await page.mouse.down()
  await page.mouse.move(cb.x + cb.width * 0.25, cb.y + cb.height * 0.85, { steps: 4 })
  await page.mouse.up()
  s = await state(page)
  check(s.recipe.curve.rgb.length === 3 && s.recipe.curve.rgb[1].y < 0.2, `curve point added and dragged (${JSON.stringify(s.recipe.curve.rgb[1])})`)

  // Grading wheel drag.
  const wheel = page.getByRole('slider', { name: 'Shadows color' })
  await wheel.scrollIntoViewIfNeeded()
  const wb = await wheel.boundingBox()
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2)
  await page.mouse.down()
  await page.mouse.move(wb.x + wb.width * 0.5, wb.y + wb.height * 0.1, { steps: 4 })
  await page.mouse.up()
  s = await state(page)
  check(Math.abs(s.recipe.grading.shadows.hue - 90) <= 2 && s.recipe.grading.shadows.sat > 60, `shadows wheel → hue ${s.recipe.grading.shadows.hue}, sat ${s.recipe.grading.shadows.sat}`)
  await shot(page, 'desktop-graded')

  // Crop: C, drag the top-left corner in, Enter.
  await page.locator('.ed-right').evaluate((el) => (el.scrollTop = 0))
  await page.keyboard.press('c')
  await page.waitForSelector('.ed-crop-box')
  check((await state(page)).tool === 'crop', 'C opens the crop tool')
  await page.getByRole('radio', { name: '1:1' }).click()
  await page.waitForTimeout(200)
  s = await state(page)
  const g = s.recipe.geometry
  check(g.aspect === '1:1' && Math.abs((g.crop.w * 768) / (g.crop.h * 512) - 1) < 0.01, `1:1 aspect gives a square crop (${JSON.stringify(g.crop)})`)
  const handle = await page.locator('.ed-handle.nw').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 80, handle.y + 60, { steps: 5 })
  await shot(page, 'desktop-crop-drag')
  await page.mouse.up()
  await page.getByRole('slider', { name: 'Straighten' }).focus()
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
  await shot(page, 'desktop-crop')
  s = await state(page)
  check(Math.abs(s.recipe.geometry.angle - 3) < 0.01, `straighten slider → ${s.recipe.geometry.angle}°`)
  await page.locator('.ed-crop-box').focus()
  await page.keyboard.press('Enter')
  s = await state(page)
  check(s.tool === null && s.history[0] === "Crop & straighten", `Enter applies the crop as one step ("${s.history[0]}")`)
  await shot(page, 'desktop-cropped')
  await page.keyboard.press('Control+z')
  s = await state(page)
  check(s.recipe.geometry.angle === 0 && s.recipe.geometry.aspect === 'original', 'one undo reverts the whole crop session')
  await page.keyboard.press('Control+Shift+z')

  // Shortcut sheet, copy / paste, next photo.
  await page.keyboard.press('?')
  check((await state(page)).sheet === 'shortcuts', '? opens the shortcuts')
  await shot(page, 'desktop-shortcuts')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(300)
  const copied = (await state(page)).recipe
  // The filmstrip runs newest first, so the first import is last: ← goes to the one before it.
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  check((await page.evaluate(() => location.hash)).includes(id), '→ stays on the last photo')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction((id) => !location.hash.includes(id), id)
  const next = decodeURIComponent((await page.evaluate(() => location.hash)).split('/').pop())
  await openEditor(page, next)
  s = await state(page)
  check(s.photoId === next && next === ids[1], '← opens the previous photo in the filmstrip')
  check(await page.getByText(`5 of 6`).isVisible(), 'toolbar shows "5 of 6"')
  await page.keyboard.press('Control+v')
  await page.waitForSelector('.ed-check')
  await shot(page, 'desktop-paste')
  await page.getByRole('button', { name: 'Paste', exact: true }).click()
  s = await state(page)
  check(s.recipe.basic.exposure === copied.basic.exposure && s.recipe.geometry.angle === 0, 'pasted settings (not the crop)')

  // Eyedropper.
  await page.keyboard.press('w')
  const cv = await page.locator('.ed-photo canvas').boundingBox()
  await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.3)
  s = await state(page)
  check(s.recipe.wb.preset === 'custom', `eyedropper set white balance (${s.recipe.wb.temp}/${s.recipe.wb.tint})`)

  // Zoom.
  await page.keyboard.press('z')
  check((await state(page)).zoom !== 1, 'Z zooms in')
  await shot(page, 'desktop-zoom')
  await page.keyboard.press('z')

  // Quarter turn, export sheet, thumbnail refresh and "last photo".
  const thumbBefore = await page.evaluate(async (id) => (await (await import('/src/io/db.ts')).db.photos.get(id)).thumbVersion, next)
  await page.keyboard.press('[')
  s = await state(page)
  check(s.recipe.geometry.rotate === 3, '[ rotates left')
  const cvs = await page.locator('.ed-photo').boundingBox()
  check(cvs.height > cvs.width, 'the photo is shown upright after the turn')
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.waitForSelector('[role="dialog"]')
  check(await page.getByRole('dialog').isVisible(), 'Export opens the export sheet')
  await shot(page, 'desktop-export')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1800)
  const thumbAfter = await page.evaluate(async (id) => (await (await import('/src/io/db.ts')).db.photos.get(id)).thumbVersion, next)
  check(thumbAfter > thumbBefore, `thumbnail re-rendered after editing (v${thumbBefore} → v${thumbAfter})`)
  check((await page.evaluate(async () => (await import('/src/io/db.ts')).kvGet('lastPhoto'))) === next, 'remembers the last photo')

  // Leaving flushes the save at once.
  await page.getByRole('slider', { name: 'Contrast', exact: true }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'Back to library' }).click()
  await page.waitForTimeout(150)
  check((await stored(page, next))?.basic.contrast === 5, 'leaving the editor saves the last change right away')
  await page.goBack()
  await openEditor(page, next)

  // Light theme.
  await setTheme(page, 'light')
  await shot(page, 'desktop-light')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  await shot(page, 'desktop-ai')
  await setTheme(page, 'dark')
  await page.getByRole('button', { name: 'Ask AI' }).click()

  // Tablet landscape: everything still fits in the toolbar.
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(300)
  const overflow = await page.locator('.ed-toolbar').evaluate((el) => el.scrollWidth - el.clientWidth)
  check(overflow <= 0, `toolbar fits at 1024 px (overflow ${overflow})`)
  await shot(page, 'tablet-1024')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

async function phone() {
  console.log('phone')
  const page = await open({ width: 390, height: 844 }, true)
  const ids = await importPhotos(page, ['/__assets/photo-21.jpg', '/__assets/photo-04.jpg'])
  await openEditor(page, ids[0])
  await shot(page, 'phone-light-tool')
  const tap = (name) => page.getByRole('button', { name, exact: true }).tap()
  await dragSlider(page, 'Exposure', 0.1)
  check((await state(page)).recipe.basic.exposure > 0.3, 'phone exposure slider works')
  for (const t of ['Color', 'Effects', 'Curve', 'Grading', 'Presets']) {
    await tap(t)
    await shot(page, `phone-${t.toLowerCase()}`)
  }
  await tap('Auto')
  check((await state(page)).history[0] === 'Auto', 'Auto applies immediately')
  await tap('Crop')
  await page.waitForSelector('.ed-crop-box')
  await shot(page, 'phone-crop')
  await page.getByRole('button', { name: 'Done' }).tap()
  check((await state(page)).tool === null, 'Done closes the crop tool')
  // Press and hold shows the original.
  const st = await page.locator('.ed-stage').boundingBox()
  await page.mouse.move(st.x + st.width / 2, st.y + st.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(300)
  check(await page.locator('.ed-stage > .ed-badge').isVisible(), 'holding shows "Original"')
  await shot(page, 'phone-hold')
  await page.mouse.up()
  await tap('Ask AI')
  check(await page.locator('.ed-phone-ai').isVisible(), 'Ask AI covers the editor on phones')
  await page.locator('.ed-phone-ai').getByRole('button', { name: 'Back to the editor' }).tap()
  await page.getByRole('button', { name: 'Export', exact: true }).tap()
  check(await page.getByRole('dialog').isVisible(), 'phone Export opens the export sheet')
  await shot(page, 'phone-export')
  await page.keyboard.press('Escape')
  await setTheme(page, 'light')
  await tap('Light')
  await shot(page, 'phone-light-theme')
  await tap('Color')
  await shot(page, 'phone-color-light')
  await setTheme(page, 'dark')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

async function states() {
  console.log('states')
  const page = await open({ width: 1440, height: 900 })
  await page.evaluate(() => (location.hash = '#/edit/nope'))
  await page.waitForSelector('.ed-wait-title')
  check((await page.locator('.ed-wait-title').textContent()) === 'Photo not found', 'missing photo explains itself')
  await shot(page, 'state-missing')
  const [id] = await importPhotos(page, ['/__assets/photo-21.jpg'])
  // Same browser profile (same library), but pages opened from now on have no WebGL2.
  const ctx = page.context()
  await ctx.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return type === 'webgl2' ? null : get.call(this, type, ...rest)
    }
  })
  const p2 = await ctx.newPage()
  await p2.goto(`${URL}#/edit/${id}`)
  await p2.waitForSelector('.ed-wait-title')
  const msg = await p2.locator('.ed-wait').textContent()
  check(/needs WebGL2/.test(msg), `no WebGL2: "${msg.slice(0, 90)}"`)
  await shot(p2, 'state-no-webgl')
  await ctx.close()
}

async function raw() {
  if (!RAW) return
  console.log('raw')
  const page = await open({ width: 1440, height: 900 })
  const t0 = Date.now()
  const [id] = await importPhotos(page, [`/__raw/${basename(RAW)}`])
  console.log(`       imported in ${Date.now() - t0} ms`)
  const t1 = Date.now()
  await openEditor(page, id)
  console.log(`       opened in ${Date.now() - t1} ms`)
  let s = await state(page)
  check(s.recipe.wb.temp > 2000, `RAW white balance in Kelvin (${s.recipe.wb.temp} K)`)
  const temp = page.getByRole('button', { name: /^Temperature: .* K/ })
  check(await temp.isVisible(), `temperature readout ${await temp.textContent()}`)
  await page.getByLabel('White balance preset').selectOption('tungsten')
  s = await state(page)
  check(s.recipe.wb.temp === 2850 && s.recipe.wb.preset === 'tungsten', 'Tungsten preset')
  await shot(page, 'raw-tungsten')
  await page.getByLabel('White balance preset').selectOption('asShot')
  // Slider timing: frames per second while dragging exposure.
  const input = page.getByRole('slider', { name: 'Exposure', exact: true })
  const box = await input.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 5)
  await page.mouse.down()
  const t2 = Date.now()
  for (let i = 0; i < 30; i++) await page.mouse.move(box.x + box.width / 2 + i * 2, box.y + 5)
  await page.mouse.up()
  console.log(`       30 slider moves in ${Date.now() - t2} ms (software GL)`)
  await shot(page, 'raw-desktop')
  // True 100 %: the visible window comes from the full-resolution decode, one photo pixel per canvas pixel.
  await page.evaluate(async () => (await import('/src/editor/stage/stageView.ts')).stageControl.toggleZoom())
  const t3 = Date.now()
  const region = await until(page, () => {
    const c = document.querySelector('.ed-photo canvas')
    return c.style.position === 'absolute' && { w: c.width, h: c.height, cssW: parseFloat(c.style.width), cssH: parseFloat(c.style.height) }
  }, undefined, 180000)
  console.log(`       100 % (full resolution) in ${Date.now() - t3} ms`)
  check(region.w <= 1440 && region.h <= 900 && Math.abs(region.cssW - region.w) < 1, `100 % shows a 1:1 window ${region.w}×${region.h}`)
  await page.waitForTimeout(300)
  await shot(page, 'raw-100')
  await page.evaluate(async () => (await import('/src/editor/stage/stageView.ts')).stageControl.fit())
  await until(page, () => document.querySelector('.ed-photo canvas').style.position === '')
  check(true, 'Fit leaves the 100 % window')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

try {
  if (PHASES.includes('desktop')) await desktop()
  if (PHASES.includes('phone')) await phone()
  if (PHASES.includes('states')) await states()
  if (PHASES.includes('raw')) await raw()
} catch (e) {
  failures.push(String(e))
  console.log('ERROR', e)
} finally {
  await browser.close()
  await server.close()
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall good')
process.exit(failures.length ? 1 : 0)
