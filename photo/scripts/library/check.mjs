// End-to-end check of the library, export sheet and settings in headless
// Chromium: seeds the database, drives keyboard/mouse/touch flows, takes
// screenshots (desktop 1440×900 and phone 390×844, dark and light) and
// measures scrolling with 10,000 photos.
//
// Usage (from photo/): node scripts/library/check.mjs <dir with photo-01…24.jpg> [screenshot dir] [phase…]
// Phases: desktop phone perf (default: all)
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const ROOT = resolve(import.meta.dirname, '../..')
const ASSETS = resolve(process.argv[2] ?? '.')
const OUT = resolve(process.argv[3] ?? join(tmpdir(), 'lumen-library-check'))
const PHASES = process.argv.slice(4).length ? process.argv.slice(4) : ['desktop', 'phone', 'perf']
const PORT = 5203
const URL = `http://localhost:${PORT}/`
mkdirSync(OUT, { recursive: true })

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`)
  if (!ok) failures.push(what)
}

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true } })
await server.listen()
const browser = await chromium.launch()

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

async function open(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? IPHONE : undefined })
  if (mobile)
    // A phone share sheet that records what it was given; the tap that started a long export has expired.
    await ctx.addInitScript(() => {
      window.__shared = []
      Navigator.prototype.canShare = () => true
      Navigator.prototype.share = async (data) => void window.__shared.push(...data.files.map((f) => f.name))
      Object.defineProperty(Navigator.prototype, 'userActivation', { get: () => ({ isActive: false, hasBeenActive: true }) })
    })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && page.errors.push(m.text()))
  await page.route('**/__assets/*', (route) => route.fulfill({ path: join(ASSETS, basename(new globalThis.URL(route.request().url()).pathname)) }))
  await page.goto(URL)
  await page.waitForSelector('.welcome, .lib, .plib')
  return page
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts })
}

/** Realistic records for `n` photos; every 41st has no thumbnail (shows the shimmer). */
async function seed(page, n, thumbEdge = 0) {
  return page.evaluate(
    async ({ n, thumbEdge }) => {
      const { db } = await import('/src/io/db.ts')
      const { defaultRecipe } = await import('/src/edit/defaults.ts')
      const CAMS = [
        ['SONY', 'ILCE-7M4', 'FE 24-70mm F2.8 GM II', 'ARW', 'raw', 6000, 4000, 48e6],
        ['NIKON CORPORATION', 'NIKON Z 8', 'NIKKOR Z 100-400mm f/4.5-5.6 VR S', 'NEF', 'raw', 8256, 5504, 52e6],
        ['Canon', 'Canon EOS R6 Mark II', 'RF85mm F1.2 L USM', 'CR3', 'raw', 6000, 4000, 27e6],
        ['FUJIFILM', 'X-T5', 'XF16-55mmF2.8 R LM WR', 'RAF', 'raw', 7728, 5152, 63e6],
        ['Leica Camera AG', 'LEICA Q3', 'SUMMILUX 1:1.7/28 ASPH.', 'DNG', 'raw', 9520, 6336, 92e6],
        ['Apple', 'iPhone 17 Pro', 'iPhone 17 Pro back camera 6.86mm f/1.78', 'HEIC', 'display', 4032, 3024, 3.1e6],
        ['OM Digital Solutions', 'OM-1MarkII', 'M.Zuiko 12-100mm F4.0 IS PRO', 'ORF', 'raw', 5184, 3888, 22e6],
        ['Panasonic', 'DC-S5M2', 'LUMIX S 20-60mm F3.5-5.6', 'JPG', 'display', 6000, 4000, 9.4e6],
      ]
      const blobs = []
      for (let i = 1; i <= 24; i++) {
        let b = await (await fetch(`/__assets/photo-${String(i).padStart(2, '0')}.jpg`)).blob()
        if (thumbEdge) {
          const bmp = await createImageBitmap(b)
          const s = thumbEdge / Math.max(bmp.width, bmp.height)
          const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s))
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
          b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        }
        blobs.push(b)
      }
      const now = Date.now()
      const albums = ['Coast trip', 'Portraits', 'Mountains', 'Travel 2026'].map((name, i) => ({ id: `album-${i}`, name, createdAt: now - (10 - i) * 86400000 }))
      const photos = []
      const thumbs = []
      let rnd = 7
      const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647
      for (let i = 0; i < n; i++) {
        const [make, model, lens, ext, kind, w, h, size] = CAMS[i % CAMS.length]
        const takenAt = now - 200 * 86400000 + Math.floor((i * (190 * 86400000)) / n) + Math.floor(rand() * 3600000)
        const asShot = { temp: 4800 + Math.round(rand() * 1200), tint: Math.round(rand() * 10 - 5) }
        const edited = rand() < 0.2
        const recipe = defaultRecipe(kind, asShot)
        if (edited) recipe.basic.exposure = 0.35
        const r = rand()
        photos.push({
          id: `p${String(i).padStart(5, '0')}`,
          fileName: `${ext === 'NEF' ? '_DSC' : ext === 'RAF' ? 'DSCF' : 'IMG_'}${String(1000 + i).padStart(4, '0')}.${ext}`,
          kind,
          mime: kind === 'raw' ? 'image/x-raw' : 'image/jpeg',
          fileSize: Math.round(size * (0.85 + rand() * 0.3)),
          addedAt: i >= n - Math.min(24, n) ? now - 60000 : now - 30 * 86400000,
          takenAt,
          width: w,
          height: h,
          meta: {
            make,
            model,
            lens,
            iso: [64, 100, 200, 400, 800, 3200][i % 6],
            shutter: [1 / 4000, 1 / 1000, 1 / 320, 1 / 60, 1 / 8][i % 5],
            aperture: [1.4, 2.8, 4, 5.6, 8, 11][i % 6],
            focalLength: [24, 35, 50, 85, 200][i % 5],
            takenAt,
          },
          raw: kind === 'raw' ? { rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], camXyz: [1, 0, 0, 0, 1, 0, 0, 0, 1], shotMul: [2, 1, 1.5], asShot } : undefined,
          rating: r < 0.3 ? 0 : r < 0.5 ? 3 : r < 0.75 ? 4 : r < 0.88 ? 5 : 2,
          flag: rand() < 0.15 ? 1 : rand() < 0.06 ? -1 : 0,
          albumIds: rand() < 0.3 ? [albums[i % 4].id] : [],
          recipe,
          edited,
          editedAt: edited ? now : undefined,
          thumbVersion: 1,
        })
        if (i % 41 !== 40) thumbs.push({ id: photos[i].id, blob: blobs[i % 24], width: 768, height: 512 })
      }
      for (let i = 0; i < photos.length; i += 2000) {
        await db.transaction('rw', db.photos, db.thumbs, db.albums, async () => {
          if (i === 0) await db.albums.bulkPut(albums)
          await db.photos.bulkPut(photos.slice(i, i + 2000))
          await db.thumbs.bulkPut(thumbs.filter((t) => t.id >= photos[i].id && t.id <= photos[Math.min(photos.length, i + 2000) - 1].id))
        })
      }
      return photos.length
    },
    { n, thumbEdge },
  )
}

const setTheme = (page, theme) =>
  page
    .evaluate(async (t) => {
      const { updateSettings } = await import('/src/state/settings.ts')
      await updateSettings({ theme: t })
    }, theme)
    .then(() => page.waitForTimeout(200))

const dbGet = (page, id) => page.evaluate(async (id) => (await import('/src/io/db.ts')).db.photos.get(id), id)
const dbCount = (page) => page.evaluate(async () => (await import('/src/io/db.ts')).db.photos.count())
const tile = (page, n) => page.locator(`.tile[aria-posinset="${n}"]`)
const tileId = (page, n) => tile(page, n).getAttribute('data-id')
const toastText = async (page) =>
  (await page
    .locator('.toast')
    .textContent({ timeout: 8000 })
    .catch(() => '')) ?? ''
/** Wait for a toast that starts with `prefix` (an older toast may still be showing). */
const toastStarting = (page, prefix, timeout = 8000) =>
  page
    .waitForFunction((p) => document.querySelector('.toast')?.textContent?.startsWith(p), prefix, { timeout })
    .then(
      () => true,
      () => false,
    )
const closeSheet = (page) => page.keyboard.press('Escape').then(() => page.waitForTimeout(150))
const mod = 'Control' // Linux: Ctrl is the command key

async function desktop() {
  console.log('\n# Desktop 1440×900')
  const page = await open({ width: 1440, height: 900 })
  check(await page.locator('.welcome').isVisible(), 'empty library shows the welcome card')
  await shot(page, 'd-dark-welcome')
  await setTheme(page, 'light')
  await shot(page, 'd-light-welcome')
  await setTheme(page, 'dark')

  await seed(page, 300)
  await page.waitForSelector('.tile')
  check((await page.locator('.lib-nav .count').first().textContent()) === '300', 'sidebar counts all photos')
  check((await page.locator('.tile').count()) < 120, `grid is virtualized (${await page.locator('.tile').count()} tiles in DOM for 300 photos)`)
  await tile(page, 1).locator('.tile-media').click()
  await shot(page, 'd-dark-grid')
  await page.locator('.lib-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.waitForTimeout(200)
  check(await tile(page, 300).isVisible(), 'the grid scrolls to the last photo')
  await shot(page, 'd-dark-grid-end')
  await page.locator('.lib-scroll').evaluate((el) => (el.scrollTop = 0))
  await page.waitForTimeout(150)

  // Selection
  await tile(page, 4)
    .locator('.tile-media')
    .click({ modifiers: ['Shift'] })
  check((await page.locator('.tile.sel').count()) === 4, 'shift-click selects a range')
  await tile(page, 7)
    .locator('.tile-media')
    .click({ modifiers: [mod] })
  check((await page.locator('.tile.sel').count()) === 5, 'ctrl-click adds to the selection')
  check(await page.locator('.lib-batch').isVisible(), 'batch bar appears with a selection')
  await shot(page, 'd-dark-selection')
  await page.keyboard.press('Escape')
  check((await page.locator('.tile.sel').count()) === 0, 'Esc clears the selection')

  // Keyboard: arrows, rating, flags
  await tile(page, 2).locator('.tile-media').click()
  await page.keyboard.press('ArrowRight')
  const id3 = await tileId(page, 3)
  check((await page.locator('.tile.focus').getAttribute('data-id')) === id3, 'ArrowRight moves focus')
  check((await page.evaluate(() => document.activeElement?.closest('.tile')?.getAttribute('data-id'))) === id3, 'DOM focus follows the keyboard')
  await page.keyboard.press('4')
  await page.keyboard.press('p')
  await page.waitForTimeout(150)
  let rec = await dbGet(page, id3)
  check(rec.rating === 4 && rec.flag === 1, 'keys 4 and P rate and pick the focused photo')
  await page.keyboard.press('x')
  await page.waitForTimeout(100)
  check((await dbGet(page, id3)).flag === -1, 'X rejects')
  await page.keyboard.press('u')
  await page.keyboard.press('0')
  await page.waitForTimeout(100)
  rec = await dbGet(page, id3)
  check(rec.flag === 0 && rec.rating === 0, 'U unflags, 0 clears the rating')
  await page.keyboard.press('ArrowDown')
  const cols = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect().top)
    return tops.filter((t) => t === tops[0]).length
  })
  check((await page.locator('.tile.focus').getAttribute('aria-posinset')) === String(3 + cols), `ArrowDown moves one row (${cols} columns)`)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  check((await page.locator('.tile.sel').count()) === 3, 'Shift+arrows extend the selection')
  await page.keyboard.press('3')
  await page.waitForTimeout(150)
  const ratedIds = await page.locator('.tile.sel').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
  const ratings = await Promise.all(ratedIds.map((id) => dbGet(page, id).then((p) => p.rating)))
  check(
    ratings.every((r) => r === 3),
    'a rating key applies to the whole selection',
  )
  await page.keyboard.press(`${mod}+a`)
  check((await page.locator('.lib-batch .count').textContent()) === '300 selected', 'Ctrl+A selects every photo in view')
  await page.keyboard.press('Escape')

  // Tile controls
  await tile(page, 5).locator('[data-act="star"][data-n="5"]').click()
  await tile(page, 5).locator('[data-act="flag"]').click()
  await page.waitForTimeout(150)
  rec = await dbGet(page, await tileId(page, 5))
  check(rec.rating === 5 && rec.flag === 1, 'tile stars and flag write to the library')

  // Copy / paste edits
  const srcId = await tileId(page, 1)
  await page.evaluate(async (id) => {
    const { db } = await import('/src/io/db.ts')
    const p = await db.photos.get(id)
    await db.photos.update(id, { recipe: { ...p.recipe, basic: { ...p.recipe.basic, exposure: 1.5, contrast: 25 } }, edited: true })
  }, srcId)
  await tile(page, 1).locator('.tile-media').click()
  await page.keyboard.press(`${mod}+c`)
  check(await toastStarting(page, 'Copied edits'), 'Ctrl+C copies the focused photo’s edits')
  await tile(page, 8).locator('.tile-media').click()
  await tile(page, 10)
    .locator('.tile-media')
    .click({ modifiers: ['Shift'] })
  const pasteIds = await page.locator('.tile.sel').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
  await page.keyboard.press(`${mod}+v`)
  await page.waitForTimeout(400)
  const pasted = await Promise.all(pasteIds.map((id) => dbGet(page, id)))
  check(
    pasted.every((p) => p.recipe.basic.exposure === 1.5 && p.edited),
    `Ctrl+V pastes onto ${pasteIds.length} selected photos`,
  )

  // Reset edits from the batch bar (with confirmation)
  await page.locator('.lib-batch button[aria-label="Reset edits"]').click()
  await shot(page, 'd-dark-reset-confirm')
  await page.locator('.sheet .btn.danger-fill').click()
  await page.waitForTimeout(400)
  const reset = await Promise.all(pasteIds.map((id) => dbGet(page, id)))
  check(
    reset.every((p) => p.recipe.basic.exposure === 0 && !p.edited),
    'Reset edits returns photos to as shot',
  )

  // Presets (a user preset, plus whatever the built-in catalog has) & albums
  await page.evaluate(async () => {
    const { db } = await import('/src/io/db.ts')
    await db.presets.put({
      id: 'user-warm',
      name: 'Warm evening',
      collection: 'mine',
      description: 'Golden light, soft contrast',
      data: { basic: { exposure: 0.2 } },
      source: 'user',
      createdAt: Date.now(),
    })
  })
  await page.locator('.lib-batch button[aria-label="Apply preset"]').click()
  await page.waitForSelector('.sheet .pick-item')
  await page.locator('.sheet .pick-item', { hasText: 'Warm evening' }).click()
  await shot(page, 'd-dark-preset-sheet')
  await page.locator('.sheet .btn.primary').click()
  check(await toastStarting(page, 'Applied Warm evening to 3 photos'), 'Apply preset to the selection')
  await page.locator('.lib-batch button[aria-label="Add to album"]').click()
  await page.waitForSelector('.sheet')
  await shot(page, 'd-dark-album-picker')
  await page.locator('.sheet .list-row', { hasText: 'New album' }).click()
  await page.locator('.sheet input').fill('Best of 2026')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check((await page.locator('.lib-album', { hasText: 'Best of 2026' }).locator('.count').textContent()) === '3', 'new album from the selection shows 3 photos')
  await page.locator('.lib-album', { hasText: 'Best of 2026' }).locator('.lib-nav').click()
  check((await page.locator('.tile').count()) === 3, 'album view lists its photos')
  await page.locator('.lib-album', { hasText: 'Best of 2026' }).locator('.more').click()
  await page.locator('.sheet .list-row', { hasText: 'Rename' }).click()
  await page.locator('.sheet input').fill('Best of the year')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check((await page.locator('.lib-title h1').textContent()) === 'Best of the year', 'rename album')
  await page.locator('.lib-album', { hasText: 'Best of the year' }).locator('.more').click()
  await page.locator('.sheet .list-row', { hasText: 'Delete album' }).click()
  await page.locator('.sheet .btn.danger-fill').click()
  await page.waitForTimeout(300)
  check(
    (await page.locator('.lib-album', { hasText: 'Best of the year' }).count()) === 0 && (await page.locator('.lib-title h1').textContent()) === 'All photos',
    'delete album returns to All photos',
  )
  check((await dbCount(page)) === 300, 'deleting an album keeps its photos')

  // Filters, sort, search
  await page.locator('.lib-toolbar .segmented button', { hasText: '★ 5' }).click()
  const fives = await page.locator('.tile').evaluateAll((els) => els.length)
  check(fives > 0 && (await page.locator('.lib-title .small').textContent()).includes(' of 30'), `★ 5 filter (${fives} shown)`)
  await page.locator('.lib-toolbar .segmented button', { hasText: 'All' }).click()
  await page.locator('.lib-side input[type="search"]').fill('leica')
  await page.waitForTimeout(250)
  const leicaNames = await page.locator('.tile .badge').allTextContents()
  check(leicaNames.length > 0 && leicaNames.every((b) => b === 'DNG'), 'search by camera finds only Leica DNGs')
  await page.locator('.lib-side input[type="search"]').fill('')
  await page.waitForFunction(() => document.querySelector('.lib-title .small')?.textContent?.startsWith('300 photos'))
  await page.locator('.lib-sort select').selectOption('name')
  const firstName = await tile(page, 1).locator('.tile-media').getAttribute('aria-label')
  check(firstName.startsWith('_DSC1001'), `sort by file name (${firstName.split(',')[0]} first)`)
  await page.locator('.lib-sort select').selectOption('taken')

  // Open the editor
  const openId = await tileId(page, 2)
  await tile(page, 2).locator('.tile-media').dblclick()
  check((await page.evaluate(() => location.hash)) === `#/edit/${openId}`, 'double-click opens the editor')
  await page.goBack()
  await page.waitForSelector('.tile')
  check((await page.locator('.tile.focus').getAttribute('data-id')) === openId, 'coming back keeps the focused photo')
  await page.keyboard.press('Enter')
  check((await page.evaluate(() => location.hash)) === `#/edit/${openId}`, 'Enter opens the focused photo')
  await page.goBack()
  await page.waitForSelector('.tile')

  // Delete (real deletePhotos)
  await tile(page, 1).locator('.tile-media').click()
  await tile(page, 2)
    .locator('.tile-media')
    .click({ modifiers: ['Shift'] })
  await page.keyboard.press('Delete')
  await page.waitForSelector('.sheet')
  await shot(page, 'd-dark-delete-confirm')
  await page.locator('.sheet .btn.danger-fill').click()
  await page.waitForTimeout(500)
  check((await dbCount(page)) === 298, 'Delete removes the selected photos after confirming')

  // Import sheet + a real import of three JPEGs
  await page.locator('.lib-import .btn.primary').click()
  await page.waitForSelector('.sheet')
  await shot(page, 'd-dark-import-sheet')
  await closeSheet(page)
  const before = await dbCount(page)
  await page
    .locator('input[type="file"][accept]')
    .first()
    .setInputFiles(
      ['photo-01.jpg', 'photo-02.jpg', 'photo-03.jpg', 'notes.txt'].map((name) =>
        name.endsWith('.txt') ? { name, mimeType: 'text/plain', buffer: Buffer.from('x') } : { name, mimeType: 'image/jpeg', buffer: readFileSync(join(ASSETS, name)) },
      ),
    )
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.match(/Imported|No photos|failed/), null, { timeout: 60000 }).catch(() => {})
  const importToast = await toastText(page)
  console.log('       import toast:', importToast)
  check((await dbCount(page)) === before + 3, `real import adds 3 photos (${importToast})`)
  check(await page.locator('.lib-nav[aria-current="true"]', { hasText: 'All photos' }).isVisible(), 'still on All photos after import')
  await page.locator('.lib-nav', { hasText: 'Last import' }).click()
  check((await page.locator('.tile').count()) === 3, 'Last import shows the 3 new photos')
  await shot(page, 'd-dark-last-import')
  await page.locator('.lib-nav', { hasText: 'All photos' }).click()

  // Export sheet + export through the capture sink
  await tile(page, 1).locator('.tile-media').click()
  await tile(page, 3)
    .locator('.tile-media')
    .click({ modifiers: ['Shift'] })
  await page.locator('.lib-batch button[aria-label="Export"]').click()
  await page.waitForSelector('.sheet')
  await shot(page, 'd-dark-export-sheet')
  await page.evaluate(async () => {
    const { setExportSink } = await import('/src/io/api.ts')
    window.__exported = []
    setExportSink({ write: async (f) => void window.__exported.push({ name: f.name, size: f.blob.size }), finish: async () => {} })
  })
  await page.locator('.sheet .btn.primary').click()
  await page.waitForFunction(() => !document.querySelector('.sheet .progress'), null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(300)
  const exported = await page.evaluate(() => window.__exported)
  const exportToast = await toastText(page)
  console.log('       export:', JSON.stringify(exported), exportToast)
  await shot(page, 'd-dark-export-result')
  check(exported.length === 3 || (await page.locator('.sheet .exp-ready-icon.warn').isVisible()), 'export either saves 3 files or lists why it could not')
  if (await page.locator('.sheet').isVisible()) await closeSheet(page)

  // Settings
  await page.goto(`${URL}#/settings`)
  await page.waitForSelector('.settings-main')
  await page.evaluate(() => (document.querySelector('.settings').style.height = 'auto'))
  await shot(page, 'd-dark-settings', { fullPage: true })
  await page.evaluate(() => (document.querySelector('.settings').style.height = ''))
  await page.locator('.settings .segmented button', { hasText: 'Light' }).click()
  await page.waitForTimeout(200)
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'theme switch in settings')
  await page.locator('.settings .field select').first().selectOption('2048')
  await page.waitForTimeout(200)
  const exp = await page.evaluate(async () => (await (await import('/src/state/settings.ts')).loadSettings()).export)
  check(exp.longEdge === 2048, 'export defaults are saved')
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.locator('.set-card button', { hasText: 'Back up' }).click()])
  check(!!download && /lumen-edits-\d{4}-\d\d-\d\d\.json/.test(download.suggestedFilename()), 'Back up edits downloads a JSON file')
  if (download) {
    await page.locator('.set-card input[type="file"]').setInputFiles(await download.path())
    check(await toastStarting(page, 'Restored edits on'), `Restore edits reads the backup (${await toastText(page)})`)
  }
  await page.evaluate(() => (document.querySelector('.settings').style.height = 'auto'))
  await shot(page, 'd-light-settings', { fullPage: true })
  await page.evaluate(() => (document.querySelector('.settings').style.height = ''))

  await page.locator('.settings-nav button', { hasText: 'Keyboard shortcuts' }).click()
  await page.waitForTimeout(900)
  const keysTop = await page.locator('#set-keys').evaluate((el) => el.getBoundingClientRect().top)
  check(
    keysTop < 120 && (await page.locator('.settings-nav button[aria-current="true"]').textContent()) === 'Keyboard shortcuts',
    'settings nav scrolls to a section and highlights it',
  )

  // Light theme library, and a narrower window
  await page.goto(URL)
  await page.waitForSelector('.tile')
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(200)
  await shot(page, 'd-light-1024')
  check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1024, 'no horizontal overflow at 1024 px')
  await page.setViewportSize({ width: 1440, height: 900 })
  await tile(page, 2).locator('.tile-media').click()
  await tile(page, 5)
    .locator('.tile-media')
    .click({ modifiers: ['Shift'] })
  await shot(page, 'd-light-selection')
  await page.locator('.lib-batch button[aria-label="Export"]').click()
  await shot(page, 'd-light-export-sheet')
  // Seeded photos have no stored original: those files fail, and the sheet says why.
  await page.evaluate(async () => (await import('/src/io/api.ts')).setExportSink({ write: async () => {}, finish: async () => {} }))
  await page.locator('.sheet .btn.primary').click()
  const failedShown = await page.waitForSelector('.exp-ready-icon.warn', { timeout: 30000 }).then(
    () => true,
    () => false,
  )
  check(failedShown && (await page.locator('.sheet .skipped .list-row').count()) >= 1, 'failed exports are listed with the reason')
  await shot(page, 'd-light-export-failed')
  await closeSheet(page)

  // Delete all, double confirm
  await page.goto(`${URL}#/settings`)
  await page.waitForSelector('.settings-main')
  await page.locator('.set-danger button').click()
  await page.locator('.sheet .btn.danger-fill').click()
  await page.waitForTimeout(150)
  check((await page.locator('.sheet h2').textContent()) === 'Are you sure?', 'Delete all asks twice')
  await shot(page, 'd-light-delete-all')
  await page.locator('.sheet .btn.danger-fill').click()
  await page.waitForTimeout(800)
  check((await dbCount(page)) === 0, 'Delete all removes every photo')
  check(page.errors.length === 0, `no page errors (${page.errors.slice(0, 3).join(' | ')})`)
  await page.context().close()
}

async function phone() {
  console.log('\n# Phone 390×844')
  const page = await open({ width: 390, height: 844 }, true)
  await shot(page, 'p-dark-welcome')
  await seed(page, 300)
  await page.waitForSelector('.ptile')
  await shot(page, 'p-dark-grid')
  check((await page.locator('.vgrid-item').count()) < 100, `phone grid is virtualized (${await page.locator('.vgrid-item').count()} tiles)`)

  await page.locator('.plib-seg button', { hasText: 'Picks' }).click()
  check((await page.locator('.plib-section h2').textContent()) === 'Picks', 'phone filter: Picks')
  await page.locator('.plib-seg button', { hasText: 'All' }).click()

  // Long-press enters select mode
  const box = await page.locator('.vgrid-item[aria-posinset="2"]').boundingBox()
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  check(await page.locator('.plib-batch').isVisible(), 'long-press enters select mode')
  await page.locator('.vgrid-item[aria-posinset="4"] .ptile').click()
  await page.locator('.vgrid-item[aria-posinset="6"] .ptile').click()
  check((await page.locator('.sel-title').textContent()) === '3 selected', 'taps add to the selection')
  await shot(page, 'p-dark-select')
  await page.locator('.plib-batch button', { hasText: 'Export' }).click()
  await page.waitForSelector('.sheet')
  await shot(page, 'p-dark-export-sheet')
  await closeSheet(page)
  await page.locator('.plib-batch button', { hasText: 'More' }).click()
  await shot(page, 'p-dark-more')
  await closeSheet(page)
  await page.locator('.plib-title button', { hasText: 'Cancel' }).click()

  await page.locator('.plib-title button[aria-label="Import photos"]').click()
  await page.waitForSelector('.sheet')
  check(await page.locator('.sheet .note', { hasText: 'Choose Files' }).isVisible(), 'iPhone note in the import sheet')
  await shot(page, 'p-dark-import-sheet')
  await closeSheet(page)

  // Import three JPEGs, then export them: the share sheet waits for a fresh tap on "Save 3 photos".
  await page
    .locator('input[type="file"][accept]')
    .first()
    .setInputFiles(['photo-04.jpg', 'photo-05.jpg', 'photo-06.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: readFileSync(join(ASSETS, name)) })))
  check(await toastStarting(page, 'Imported 3 photos', 60000), 'phone import')
  await page.waitForFunction(() => document.querySelector('.plib-section .small')?.textContent === '303 photos')
  const lp = await page.locator('.vgrid-item[aria-posinset="1"]').boundingBox()
  await page.mouse.move(lp.x + 30, lp.y + 30)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  await page.locator('.vgrid-item[aria-posinset="2"] .ptile').click()
  await page.locator('.vgrid-item[aria-posinset="3"] .ptile').click()
  await page.locator('.plib-batch button', { hasText: 'Export' }).click()
  await page.locator('.sheet .btn.primary').click()
  const ready = await page.waitForSelector('.exp-ready', { timeout: 120000 }).then(
    () => true,
    () => false,
  )
  check(ready, 'after a long export the sheet offers “Save 3 photos”')
  await shot(page, 'p-dark-export-ready')
  if (ready) {
    await page.locator('.sheet .btn.primary', { hasText: 'Save 3 photos' }).click()
    check(await toastStarting(page, 'Exported 3 photos'), 'tapping Save opens the share sheet and finishes the export')
    const shared = await page.evaluate(() => window.__shared)
    check(shared.length === 3 && shared.every((n) => n.endsWith('-lumen.jpg')), `share sheet received ${shared.join(', ')}`)
  }
  await page.locator('.plib-title button', { hasText: 'Cancel' }).click()

  const id = await page.locator('.vgrid-item[aria-posinset="1"]').getAttribute('data-id')
  await page.locator('.vgrid-item[aria-posinset="1"] .ptile').click()
  check((await page.evaluate(() => location.hash)) === `#/edit/${id}`, 'tapping a photo opens the editor')

  await page.goto(`${URL}#/settings`)
  await page.waitForSelector('.settings-main')
  await page.evaluate(() => (document.querySelector('.settings').style.height = 'auto'))
  await shot(page, 'p-dark-settings', { fullPage: true })

  await page.goto(URL)
  await setTheme(page, 'light')
  await page.waitForSelector('.ptile')
  await shot(page, 'p-light-grid')
  await page.locator('.plib-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shot(page, 'p-light-grid-end')
  check(page.errors.length === 0, `no page errors (${page.errors.slice(0, 3).join(' | ')})`)
  await page.context().close()
}

async function perf() {
  console.log('\n# 10,000 photos')
  const page = await open({ width: 1440, height: 900 })
  const t0 = Date.now()
  await seed(page, 10000, 256)
  console.log(`       seeded in ${Date.now() - t0} ms`)
  await page.waitForSelector('.tile')
  const t1 = Date.now()
  await page.reload()
  await page.waitForSelector('.tile')
  const load = Date.now() - t1
  check(load < 4000, `library with 10,000 photos opens in ${load} ms`)
  const dom = await page.locator('.tile').count()
  check(dom < 150, `${dom} tiles in the DOM`)
  let frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('.lib-scroll')
        const deltas = []
        let last = performance.now()
        let n = 0
        const step = (t) => {
          deltas.push(t - last)
          last = t
          el.scrollTop += 90
          if (++n < 300) requestAnimationFrame(step)
          else resolve({ deltas: deltas.slice(1), top: el.scrollTop, tiles: document.querySelectorAll('.tile').length })
        }
        requestAnimationFrame(step)
      }),
  )
  check(frames.top > 25000, `the grid really scrolled (scrollTop ${Math.round(frames.top)}, ${frames.tiles} tiles in the DOM)`)
  frames = frames.deltas.sort((a, b) => a - b)
  const p95 = frames[Math.floor(frames.length * 0.95)]
  const long = frames.filter((f) => f > 50).length
  console.log(`       scroll: median ${frames[frames.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${frames.at(-1).toFixed(1)} ms, ${long} frames > 50 ms`)
  check(p95 < 34 && long <= 3, 'scrolling 27,000 px stays smooth')
  await page.locator('.lib-scroll').evaluate((el) => (el.scrollTop = 0))
  await page.waitForTimeout(150)
  await tile(page, 1).locator('.tile-media').click()
  const t2 = Date.now()
  await page.keyboard.press('End')
  await page.waitForSelector('.tile[aria-posinset="10000"].focus')
  check(true, `End jumps to the last of 10,000 photos (${Date.now() - t2} ms)`)
  const t3 = Date.now()
  await page.keyboard.press('3')
  await page.waitForFunction(() => document.querySelector('.tile.focus .tile-stars button.on:nth-child(3)'))
  console.log(`       rating round-trip with 10,000 photos: ${Date.now() - t3} ms`)
  await page.locator('.lib-side input[type="search"]').fill('canon')
  const t4 = Date.now()
  await page.waitForFunction(() => document.querySelector('.lib-title .small')?.textContent?.startsWith('1,250'))
  console.log(`       search over 10,000 photos: ${Date.now() - t4} ms`)
  await shot(page, 'd-dark-10k')
  check(page.errors.length === 0, `no page errors (${page.errors.slice(0, 3).join(' | ')})`)
  await page.context().close()
}

try {
  if (PHASES.includes('desktop')) await desktop()
  if (PHASES.includes('phone')) await phone()
  if (PHASES.includes('perf')) await perf()
} catch (e) {
  failures.push(`crashed: ${e.message.split('\n')[0]}`)
  console.error(e)
} finally {
  await browser.close()
  await server.close()
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join('\n- ')}` : '\nAll checks passed.')
console.log(`Screenshots: ${OUT}`)
process.exit(failures.length ? 1 : 0)
