// End-to-end check of the editing screen in headless Chromium with the real
// import pipeline and WebGL2 engine: imports JPEGs (and a RAW), opens the
// editor, drags sliders, crops, uses shortcuts, copy/paste and persistence,
// and takes screenshots (desktop 1440×900, phone 390×844, dark and light).
//
// Usage (from photo/): node scripts/editor/check.mjs <jpeg dir> <raw file> [screenshot dir] [phase…]
// Phases: desktop phone states raw masks masksPhone ai aiPhone (default: all), and aiReal
// (opt-in: the real on-device models from public/models, slow in software).
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { installFakeAi } from './fake-ai.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')

const ROOT = resolve(import.meta.dirname, '../..')
const ASSETS = resolve(process.argv[2] ?? '.')
const RAW = process.argv[3] ? resolve(process.argv[3]) : null
const OUT = resolve(process.argv[4] ?? join(tmpdir(), 'lumen-editor-check'))
const PHASES = process.argv.slice(5).length ? process.argv.slice(5) : ['desktop', 'phone', 'states', 'raw', 'masks', 'masksPhone', 'ai', 'aiPhone']
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
    return {
      photoId: s.photoId, recipe: s.recipe, history: s.history.map((h) => h.label), canUndo: s.canUndo, canRedo: s.canRedo, mode: v.mode, tool: v.tool, zoom: v.zoom, sheet: v.sheet, hist: !!v.histogram,
      layer: v.layer, mask: v.mask, overlay: v.overlay, placing: v.placing, rangePick: v.rangePick, spot: v.spot,
    }
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

/** Drag with the mouse in a few steps (optionally holding Alt). */
async function drag(page, from, to, { steps = 6, alt = false } = {}) {
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
}

const center = async (loc) => {
  const b = await loc.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Point at fractions (fx, fy) of the photo on screen. */
const onPhoto = async (page, fx, fy) => {
  const b = await page.locator('.ed-photo').boundingBox()
  return { x: b.x + b.width * fx, y: b.y + b.height * fy }
}

const selectedMask = (s) => s.recipe.layers.find((l) => l.id === s.layer)?.masks.find((m) => m.id === s.mask)

/** How far (px) the selected radial's center handle is from where the engine's geometry puts the mask center. */
const handleError = (page) =>
  page.evaluate(async () => {
    const { editor } = await import('/src/state/editor.ts')
    const { view } = await import('/src/editor/view.ts')
    const { maskToView } = await import('/src/engine/geometry.ts')
    const { db } = await import('/src/io/db.ts')
    const r = editor.getState().recipe
    const v = view.get()
    const m = r.layers.find((l) => l.id === v.layer).masks.find((x) => x.id === v.mask)
    const rec = await db.photos.get(editor.getState().photoId)
    const p = maskToView({ width: rec.width, height: rec.height }, r.geometry, false, m.cx, m.cy)
    const box = document.querySelector('.ed-photo').getBoundingClientRect()
    const h = document.querySelector('.ed-mh.move').getBoundingClientRect()
    return Math.hypot(h.left + h.width / 2 - (box.left + p.x * box.width), h.top + h.height / 2 - (box.top + p.y * box.height))
  })

async function masks() {
  console.log('masks')
  const page = await open({ width: 1440, height: 900 })
  const ids = await importPhotos(page, ['/__assets/photo-21.jpg', '/__assets/photo-06.jpg'])
  const id = ids[0]
  await openEditor(page, id)
  const clean = await photoPixels(page)

  // M opens masking; with no masks yet the kinds are offered right away.
  await page.keyboard.press('m')
  let s = await state(page)
  check(s.tool === 'mask', 'M opens the masking tool')
  check(await page.getByRole('button', { name: 'Subject' }).isDisabled(), 'AI masks are listed as coming soon')
  await shot(page, 'masks-empty')

  // Radial: draw it on the photo, then reshape with its handles.
  await page.getByRole('button', { name: 'Radial gradient' }).click()
  s = await state(page)
  check(s.placing === 'radial' && s.recipe.layers.length === 1, 'new radial layer waits to be drawn')
  await drag(page, await onPhoto(page, 0.45, 0.4), await onPhoto(page, 0.6, 0.4))
  s = await state(page)
  let m = selectedMask(s)
  check(s.placing === null && Math.abs(m.cx - 0.45) < 0.01 && m.rx > 0.1, `drawn radial at ${m.cx.toFixed(3)}, r ${m.rx.toFixed(3)}`)
  check(s.history[0] === 'Radial gradient', `one undo step "${s.history[0]}"`)
  check((await handleError(page)) < 1.5, 'center handle sits on the mask center (fit)')
  const rx0 = m.rx
  const hx = await center(page.locator('.ed-mh.rx'))
  await drag(page, hx, { x: hx.x + 40, y: hx.y })
  m = selectedMask(await state(page))
  check(m.rx > rx0 + 0.02, `rx handle widens the ellipse (${rx0.toFixed(3)} → ${m.rx.toFixed(3)})`)
  const knob = await center(page.locator('.ed-mh.rotate'))
  const c0 = await center(page.locator('.ed-mh.move'))
  await drag(page, knob, { x: c0.x + (c0.y - knob.y), y: c0.y })
  m = selectedMask(await state(page))
  check(Math.abs(Math.abs(m.angle) - 90) < 3, `rotate handle turns it (${m.angle}°)`)
  await drag(page, c0, { x: c0.x - 60, y: c0.y + 30 })
  s = await state(page)
  m = selectedMask(s)
  check(m.cx < 0.45 && s.history[0] === 'Move radial gradient', `dragging inside moves it ("${s.history[0]}")`)

  // Local adjustment + overlay.
  await dragSlider(page, 'Exposure', -0.15)
  s = await state(page)
  const layer = s.recipe.layers[0]
  check(layer.adjust.exposure < -0.3, `local exposure ${layer.adjust.exposure}`)
  check(/^Radial: Exposure −/.test(s.history[0]), `history "${s.history[0]}"`)
  console.log(`       info: local exposure ${(await photoPixels(page)) !== clean ? 'changes' : 'does not change yet'} the pixels`)
  await page.locator('.ed-stage').hover({ position: { x: 5, y: 5 } })
  await page.keyboard.press('o')
  check((await state(page)).overlay === false, 'O hides the overlay')
  await page.keyboard.press('o')
  await shot(page, 'masks-radial')

  // Handles track zoom (100 %) and a crop with a quarter turn.
  await page.keyboard.press('z')
  await page.waitForTimeout(400)
  check((await handleError(page)) < 1.5, 'center handle stays on the mask at 100 %')
  await page.keyboard.press('z')
  await page.evaluate(async () => {
    const { editor } = await import('/src/state/editor.ts')
    editor.apply((r) => ({ ...r, geometry: { ...r.geometry, rotate: 1, crop: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 }, angle: 4 } }), 'test crop')
  })
  await page.waitForTimeout(300)
  check((await handleError(page)) < 1.5, 'center handle stays on the mask after crop + quarter turn + straighten')
  await shot(page, 'masks-rotated')
  await page.keyboard.press('Control+z')

  // Linear: drawn by dragging, end handle reshapes.
  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'Linear gradient' }).click()
  await drag(page, await onPhoto(page, 0.5, 0.05), await onPhoto(page, 0.5, 0.45))
  s = await state(page)
  m = selectedMask(s)
  check(m.type === 'linear' && m.y1 < 0.1 && m.y2 > 0.4, `linear drawn top → middle (${m.y1.toFixed(2)} → ${m.y2.toFixed(2)})`)
  const end = await center(page.locator('.ed-mh.end'))
  await drag(page, end, { x: end.x + 80, y: end.y + 20 })
  m = selectedMask(await state(page))
  check(m.x2 > 0.55, 'end handle tilts the gradient')
  await shot(page, 'masks-linear')

  // Brush: paint, erase with Alt, undo/redo.
  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'Brush', exact: true }).click()
  await drag(page, await onPhoto(page, 0.2, 0.7), await onPhoto(page, 0.6, 0.75), { steps: 12 })
  s = await state(page)
  m = selectedMask(s)
  check(m.strokes.length === 1 && m.strokes[0].points.length > 4 && s.history[0] === 'Brush mask', `brush stroke with ${m.strokes[0]?.points.length} points, one step`)
  await drag(page, await onPhoto(page, 0.3, 0.72), await onPhoto(page, 0.4, 0.72), { alt: true })
  s = await state(page)
  m = selectedMask(s)
  check(m.strokes[1]?.erase === true && s.history[0] === 'Erase brush mask', 'Alt-drag erases')
  await page.keyboard.press(']')
  check((await page.evaluate(async () => (await import('/src/editor/view.ts')).view.get().brush.size)) === 55, '] enlarges the brush')
  await page.keyboard.press('Control+z')
  m = selectedMask(await state(page))
  check(m.strokes.length === 1, 'undo removes the erase stroke')
  await page.keyboard.press('Control+Shift+z')
  m = selectedMask(await state(page))
  check(m.strokes.length === 2, 'redo brings it back')
  await page.mouse.move(...Object.values(await onPhoto(page, 0.5, 0.5)))
  await shot(page, 'masks-brush')

  // Subtract a luminance range from the brush layer; invert it.
  await page.getByRole('button', { name: 'Subtract', exact: true }).click()
  await page.getByRole('button', { name: 'Luminance range' }).click()
  s = await state(page)
  const lay = s.recipe.layers.find((l) => l.id === s.layer)
  check(lay.masks.length === 2 && lay.masks[1].mode === 'subtract' && lay.masks[1].range === 'luminance', 'luminance range subtracted from the brush layer')
  await page.getByRole('button', { name: 'Invert Luminance range' }).click()
  check(selectedMask(await state(page)).invert === true, 'invert toggles')
  await page.getByRole('slider', { name: 'Darkest', exact: true }).focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  check(selectedMask(await state(page)).low === 65, 'range slider moves the darkest end')

  // Color range: pick from the sky.
  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'Color range' }).click()
  check((await state(page)).rangePick, 'a color range starts with the picker')
  await page.mouse.click(...Object.values(await onPhoto(page, 0.15, 0.12)))
  m = selectedMask(await state(page))
  check(m.hue > 180 && m.hue < 250, `picked the sky's hue (${m.hue}°, sat ${m.sat})`)
  await shot(page, 'masks-panel')

  // Layer menu: rename, hide, duplicate, delete.
  const rows = () => page.locator('.ed-layer')
  const before = (await state(page)).recipe.layers.length
  await page.locator('.ed-layer-name').first().dblclick()
  await page.getByLabel('Mask name').fill('Sky')
  await page.keyboard.press('Enter')
  s = await state(page)
  check(s.recipe.layers.some((l) => l.name === 'Sky'), 'double-click renames a layer')
  await page.getByRole('button', { name: 'Hide Sky' }).click()
  check((await state(page)).recipe.layers.find((l) => l.name === 'Sky').enabled === false, 'eye hides a layer')
  await page.getByRole('button', { name: 'More for Sky' }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  check((await state(page)).recipe.layers.length === before + 1 && (await rows().count()) === before + 1, 'duplicate adds a layer')
  await page.getByRole('button', { name: 'More for Sky copy' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  check((await state(page)).recipe.layers.length === before, 'delete removes it')

  // Persistence.
  await page.waitForTimeout(700)
  const saved = await stored(page, id)
  check(saved?.layers.length === before && saved.layers.some((l) => l.name === 'Sky'), 'layers saved to the database')

  // Heal & clone.
  await page.keyboard.press('Escape')
  await page.keyboard.press('q')
  check((await state(page)).tool === 'heal', 'Q opens heal & clone')
  await page.mouse.click(...Object.values(await onPhoto(page, 0.3, 0.3)))
  s = await state(page)
  check(s.recipe.retouch.length === 1 && s.history[0] === 'Heal spot', 'click adds a heal spot')
  const sp = s.recipe.retouch[0]
  check(Math.hypot(sp.sx - sp.x, sp.sy - sp.y) > sp.r, `it copies from elsewhere (${sp.sx.toFixed(3)}, ${sp.sy.toFixed(3)})`)
  await drag(page, await onPhoto(page, 0.6, 0.85), await onPhoto(page, 0.9, 0.85), { steps: 15 })
  s = await state(page)
  check(s.recipe.retouch.length > 3 && s.history[0] === 'Heal stroke', `drag paints ${s.recipe.retouch.length - 1} spots in one step`)
  await page.keyboard.press('Control+z')
  check((await state(page)).recipe.retouch.length === 1, 'one undo removes the whole stroke')
  const t = await onPhoto(page, 0.3, 0.3)
  await drag(page, t, { x: t.x + 30, y: t.y + 20 })
  s = await state(page)
  check(s.recipe.retouch[0].x > sp.x && s.history[0] === 'Move heal spot', 'dragging a spot moves it')
  await page.getByRole('radio', { name: 'Clone' }).or(page.getByRole('button', { name: 'Clone', exact: true })).first().click()
  check((await state(page)).recipe.retouch[0].mode === 'clone', 'switching to Clone changes the selected spot')
  await shot(page, 'heal')
  await page.keyboard.press('Backspace')
  check((await state(page)).recipe.retouch.length === 0, 'Backspace deletes the selected spot')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(700)
  check((await stored(page, id))?.retouch.length === 1, 'heal spots saved to the database')

  await setTheme(page, 'light')
  await shot(page, 'heal-light')
  await page.keyboard.press('m')
  await shot(page, 'masks-light')
  await setTheme(page, 'dark')
  await page.keyboard.press('Escape')
  await shot(page, 'masks-summary')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

async function masksPhone() {
  console.log('masksPhone')
  const page = await open({ width: 390, height: 844 }, true)
  const [id] = await importPhotos(page, ['/__assets/photo-21.jpg'])
  await openEditor(page, id)
  const tap = (name) => page.getByRole('button', { name, exact: true }).tap()
  await page.locator('.ed-phone-tools').evaluate((el) => (el.scrollLeft = 400))
  await tap('Masks')
  check((await state(page)).tool === 'mask', 'Masks tool on the phone')
  await shot(page, 'phone-masks-empty')
  await tap('Radial gradient')
  await drag(page, await onPhoto(page, 0.5, 0.5), await onPhoto(page, 0.7, 0.5))
  let s = await state(page)
  check(s.recipe.layers.length === 1 && s.history[0] === 'Radial gradient', 'radial drawn with one finger')
  await shot(page, 'phone-masks')
  await page.locator('.ed-phone-panel-body').evaluate((el) => (el.scrollTop = 600))
  await shot(page, 'phone-masks-sliders')
  await tap('Heal')
  check((await state(page)).tool === 'heal', 'Heal tool on the phone')
  await page.mouse.click(...Object.values(await onPhoto(page, 0.3, 0.3)))
  check((await state(page)).recipe.retouch.length === 1, 'tap heals a spot')
  await shot(page, 'phone-heal')
  await setTheme(page, 'light')
  await tap('Masks')
  await shot(page, 'phone-masks-light')
  await setTheme(page, 'dark')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

/** Wait for the current AI task to finish (or reach a step that needs the person). */
const aiSettled = (page, timeout = 30000) =>
  until(page, async () => {
    const { useAiJob } = await import('/src/editor/ai/jobs.ts')
    void useAiJob
    const j = document.querySelector('.ed-ai-card[role="alertdialog"], .ed-ai-card.error')
    return j ? 'card' : !document.querySelector('.ed-ai-chip, .ed-ai-card[role="status"]') ? 'idle' : null
  }, undefined, timeout)

const photoDiff = async (page, before) => (await photoPixels(page)) !== before

async function aiPhase() {
  console.log('ai')
  const page = await open({ width: 1440, height: 900 })
  const [id] = await importPhotos(page, ['/__assets/photo-21.jpg', '/__assets/photo-04.jpg'])
  await page.evaluate(installFakeAi)
  await openEditor(page, id)
  const clean = await photoPixels(page)

  // Sky: first use asks to download its model, then detects.
  await page.keyboard.press('m')
  await page.getByRole('button', { name: 'Sky', exact: true }).click()
  await page.waitForSelector('.ed-ai-card[role="alertdialog"]')
  check(/one-time download of 4\.6 MB/.test(await page.locator('.ed-ai-card').textContent()), 'asks before downloading the model, with its size')
  await shot(page, 'ai-consent')
  await page.getByRole('button', { name: 'Download' }).click()
  await page.waitForSelector('.ed-ai-chip')
  await shot(page, 'ai-progress')
  await aiSettled(page)
  let s = await state(page)
  let m = selectedMask(s)
  check(m?.type === 'ai' && m.target === 'sky' && !!m.raster && s.history[0] === 'Sky mask', `sky mask with a stored result ("${s.history[0]}")`)
  check(await photoDiff(page, clean), 'the engine shows the AI mask (overlay)')
  await shot(page, 'ai-sky')
  await dragSlider(page, 'Exposure', -0.12)
  s = await state(page)
  check(s.recipe.layers[0].adjust.exposure < 0 && /^Sky: Exposure/.test(s.history[0]), `local adjustment on the sky ("${s.history[0]}")`)

  // People: pick parts.
  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'People', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Clothes' }).uncheck()
  await shot(page, 'ai-people-parts')
  await page.getByRole('button', { name: 'Select 4 parts' }).click()
  await page.getByRole('button', { name: 'Download' }).click()
  await aiSettled(page)
  s = await state(page)
  m = selectedMask(s)
  check(m?.target === 'person' && m.parts?.length === 4 && !m.parts.includes('clothes'), `people mask with parts ${m?.parts}`)

  // Select object: click to add, Alt-click to leave out.
  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'Select object' }).click()
  await page.mouse.click(...Object.values(await onPhoto(page, 0.52, 0.45)))
  await page.getByRole('button', { name: 'Download' }).click()
  await aiSettled(page)
  await page.keyboard.down('Alt')
  await page.mouse.click(...Object.values(await onPhoto(page, 0.55, 0.3)))
  await page.keyboard.up('Alt')
  await aiSettled(page)
  s = await state(page)
  m = selectedMask(s)
  check(m?.points?.length === 2 && m.points[0].positive && !m.points[1].positive && !!m.raster, 'object mask from an included and an excluded click')
  check(s.history[0] === 'Remove from object' && s.history[1] === 'Add to object', `one undo step per click ("${s.history[0]}")`)
  await shot(page, 'ai-object')
  await page.keyboard.press('Control+z')
  check(selectedMask(await state(page)).points.length === 1, 'undo takes back the last click')

  // A result that's missing (e.g. a restored backup) offers Recompute.
  await page.evaluate(async () => {
    const { editor } = await import('/src/state/editor.ts')
    const { view } = await import('/src/editor/view.ts')
    const r = editor.getState().recipe
    const sky = r.layers[0]
    editor.apply((x) => ({ ...x, layers: x.layers.map((l) => (l.id === sky.id ? { ...l, masks: l.masks.map((mm) => ({ ...mm, raster: 'gone' })) } : l)) }), 'simulate restore')
    view.set({ layer: sky.id, mask: sky.masks[0].id })
  })
  await page.waitForSelector('.ed-warn-dot')
  await shot(page, 'ai-recompute')
  await page.getByRole('button', { name: 'Recompute' }).click()
  await aiSettled(page)
  m = selectedMask(await state(page))
  check(m.raster && m.raster !== 'gone' && (await page.locator('.ed-masklist .ed-warn-dot').count()) === 0, 'Recompute makes the mask again')

  // Remove: paint, let go, the fill lands as one step.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+Q')
  s = await state(page)
  const before = await photoPixels(page)
  await drag(page, await onPhoto(page, 0.86, 0.62), await onPhoto(page, 0.92, 0.66), { steps: 8 })
  await page.getByRole('button', { name: 'Download' }).click()
  await page.waitForSelector('.ed-ai-chip')
  await shot(page, 'ai-removing')
  await aiSettled(page)
  s = await state(page)
  const area = s.recipe.retouch.find((t) => t.mode === 'remove')
  check(!!area?.fill && s.history[0] === 'Remove object', `object removed in one step ("${s.history[0]}")`)
  check(await photoDiff(page, before), 'the fill shows on the photo')
  await shot(page, 'ai-removed')
  await page.keyboard.press('Backspace')
  check(!(await state(page)).recipe.retouch.some((t) => t.mode === 'remove'), 'Backspace deletes the removal')
  await page.keyboard.press('Control+z')
  check((await state(page)).recipe.retouch.some((t) => t.mode === 'remove'), 'undo brings it back')

  // AI Denoise from the Detail panel.
  await page.keyboard.press('Escape')
  const detail = page.getByRole('button', { name: 'Detail', exact: true })
  if ((await detail.getAttribute('aria-expanded')) !== 'true') await detail.click()
  await page.getByRole('button', { name: 'AI Denoise' }).scrollIntoViewIfNeeded()
  check(/a few seconds on this device/.test(await page.locator('.ed-denoise').textContent()), 'AI Denoise says how long it takes')
  await page.getByRole('button', { name: 'AI Denoise' }).click()
  await page.getByRole('button', { name: 'Download' }).click()
  await aiSettled(page)
  s = await state(page)
  check(s.recipe.denoise?.amount === 50 && !!s.recipe.denoise.raster && s.history[0] === 'AI Denoise', 'AI Denoise blended at 50')
  check(await page.locator('.ed-badge-ai').isVisible(), '"AI denoised" badge on the photo')
  await shot(page, 'ai-denoise')
  await dragSlider(page, 'AI Denoise', 0.2)
  check((await state(page)).recipe.denoise.amount > 60, 'Amount slider blends more')

  // Persistence and pruning of unused results.
  await page.waitForTimeout(4600)
  const saved = await stored(page, id)
  check(saved.layers.length === 3 && !!saved.denoise?.raster, 'AI masks and denoise saved with the photo')
  const prunes = await page.evaluate(() => window.__fakeAi.prunes)
  const keep = prunes.at(-1)?.keep ?? []
  check(prunes.length > 0 && keep.includes(saved.denoise.raster) && saved.layers.every((l) => l.masks.every((mm) => keep.includes(mm.raster))), `prunes keep every result in use (${prunes.length} prune calls)`)

  // Export with AI upscaling ×2.
  await page.evaluate(async () => {
    const { setExportSink } = await import('/src/io/api.ts')
    window.__exported = []
    setExportSink({ write: async (f) => void window.__exported.push(f), finish: async () => undefined })
  })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click()
  const row = page.locator('.setting-row', { hasText: 'Upscale 2×' })
  await row.getByText('1,536 × 1,024 px').waitFor({ timeout: 10000 }).catch(() => undefined)
  check((await row.textContent()).includes('1,536 × 1,024 px'), 'upscale shows the resulting size')
  await shot(page, 'ai-export')
  await page.getByRole('dialog').getByRole('button', { name: /^Export/ }).last().click()
  const size = await until(page, async () => {
    const f = window.__exported?.[0]
    if (!f) return null
    const b = await createImageBitmap(f.blob)
    return `${b.width}×${b.height}`
  }, undefined, 60000)
  check(size === '1536×1024', `exported upscaled ×2 (${size})`)

  // Settings → AI models.
  await page.evaluate(() => (location.hash = '#/settings'))
  await page.waitForSelector('#set-models')
  await page.locator('#set-models').scrollIntoViewIfNeeded()
  const models = await page.locator('#set-models .set-row').count()
  check(models >= 6, `Settings lists the downloaded models (${models - 1} + total)`)
  await shot(page, 'ai-settings')
  await page.getByRole('button', { name: 'Delete Super Resolution' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('#set-models .set-row').count()) === models - 1, 'a model can be deleted')
  await setTheme(page, 'light')
  await shot(page, 'ai-settings-light')
  await page.goBack()
  await openEditor(page, id)
  await page.keyboard.press('m')
  await shot(page, 'ai-masks-light')
  await setTheme(page, 'dark')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

/** The real models (served from public/models by the dev server): sky, select object, remove. */
async function aiReal() {
  console.log('aiReal')
  const page = await open({ width: 1440, height: 900 })
  page.on('console', (m) => /error/i.test(m.type()) && console.log('       console:', m.text().slice(0, 200)))
  const [id] = await importPhotos(page, ['/__assets/photo-21.jpg'])
  await openEditor(page, id)
  const support = await page.evaluate(async () => (await import('/src/ai/index.ts')).aiSupport())
  console.log(`       backend ${support.backend}, available ${support.available}`)
  await page.keyboard.press('m')
  const timed = async (what, fn) => {
    const t0 = Date.now()
    await fn()
    console.log(`       ${what}: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
  await page.getByRole('button', { name: 'Sky', exact: true }).click()
  await timed('sky (download + run)', async () => {
    await page.getByRole('button', { name: 'Download' }).click()
    await aiSettled(page, 300000)
  })
  let m = selectedMask(await state(page))
  const sky = await page.evaluate(async (id) => {
    const img = await (await import('/src/io/rasters.ts')).getRaster(id)
    if (!img) return null
    const at = (fx, fy) => img.data[Math.floor(fy * img.height) * img.width + Math.floor(fx * img.width)]
    return { w: img.width, h: img.height, top: at(0.2, 0.1), rocks: at(0.8, 0.85) }
  }, m?.raster)
  check(!!sky && sky.top > 128 && sky.rocks < 128, `real sky mask: sky ${sky?.top}, rocks ${sky?.rocks} (${sky?.w}×${sky?.h})`)
  await shot(page, 'real-sky')

  await page.getByRole('button', { name: 'New mask' }).click()
  await page.getByRole('button', { name: 'Select object' }).click()
  await page.mouse.click(...Object.values(await onPhoto(page, 0.57, 0.5)))
  await timed('select object (download + run)', async () => {
    await page.getByRole('button', { name: 'Download' }).click()
    await aiSettled(page, 300000)
  })
  m = selectedMask(await state(page))
  const obj = await page.evaluate(async (id) => {
    const img = await (await import('/src/io/rasters.ts')).getRaster(id)
    if (!img) return null
    const at = (fx, fy) => img.data[Math.floor(fy * img.height) * img.width + Math.floor(fx * img.width)]
    return { tower: at(0.57, 0.5), sky: at(0.2, 0.1) }
  }, m?.raster)
  check(!!obj && obj.tower > 128 && obj.sky < 128, `real object mask: lighthouse ${obj?.tower}, sky ${obj?.sky}`)
  await shot(page, 'real-object')

  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+Q')
  const before = await photoPixels(page)
  await drag(page, await onPhoto(page, 0.55, 0.37), await onPhoto(page, 0.58, 0.52), { steps: 10 })
  await timed('remove (download + run)', async () => {
    await page.getByRole('button', { name: 'Download' }).click()
    await aiSettled(page, 300000)
  })
  const s = await state(page)
  check(s.recipe.retouch.some((t) => t.mode === 'remove' && t.fill) && (await photoDiff(page, before)), 'real object removal fills the area')
  await shot(page, 'real-remove')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

async function aiPhone() {
  console.log('aiPhone')
  const page = await open({ width: 390, height: 844 }, true)
  const [id] = await importPhotos(page, ['/__assets/photo-21.jpg'])
  await page.evaluate(installFakeAi)
  await openEditor(page, id)
  const tap = (name) => page.getByRole('button', { name, exact: true }).tap()
  await page.locator('.ed-phone-tools').evaluate((el) => (el.scrollLeft = 400))
  await tap('Masks')
  await tap('Subject')
  await tap('Download')
  await aiSettled(page)
  check(selectedMask(await state(page))?.target === 'subject', 'subject mask on the phone')
  await shot(page, 'phone-ai-subject')
  await tap('Heal')
  await tap('Remove')
  await drag(page, await onPhoto(page, 0.86, 0.62), await onPhoto(page, 0.92, 0.66))
  await tap('Download')
  await aiSettled(page)
  check((await state(page)).recipe.retouch.some((t) => t.mode === 'remove'), 'remove on the phone')
  check((await page.locator('#ed-panel-title').textContent()) === 'Heal & clone', `the Heal panel stays open (${await page.locator('#ed-panel-title').textContent()})`)
  await shot(page, 'phone-ai-remove')
  await tap('Detail')
  check(/Slow on phones/.test(await page.locator('.ed-denoise').textContent()), 'AI Denoise warns on phones')
  await shot(page, 'phone-ai-denoise')
  await setTheme(page, 'light')
  await tap('AI Denoise')
  await shot(page, 'phone-ai-denoise-light')
  await tap('Not now')
  await setTheme(page, 'dark')
  check(page.errors.length === 0, `no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

try {
  if (PHASES.includes('desktop')) await desktop()
  if (PHASES.includes('phone')) await phone()
  if (PHASES.includes('states')) await states()
  if (PHASES.includes('raw')) await raw()
  if (PHASES.includes('masks')) await masks()
  if (PHASES.includes('masksPhone')) await masksPhone()
  if (PHASES.includes('ai')) await aiPhase()
  if (PHASES.includes('aiPhone')) await aiPhone()
  if (PHASES.includes('aiReal')) await aiReal()
} catch (e) {
  failures.push(String(e))
  console.log('ERROR', e)
} finally {
  await browser.close()
  await server.close()
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall good')
process.exit(failures.length ? 1 : 0)
