// End-to-end check of the AI assistant in headless Chromium, inside the real
// editor: the not-set-up card, a conversation with change cards (dev-only
// mock provider, no API calls), Keep / Undo / Why, a mapped error (OpenAI
// answers 401 through a routed request), and the settings section — at
// desktop 1440×900 and phone 390×844, dark and light.
//
// Usage (from photo/): node scripts/assistant/check.mjs <jpeg dir> [screenshot dir]
import { createServer } from 'vite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')

const ROOT = resolve(import.meta.dirname, '../..')
const ASSETS = resolve(process.argv[2] ?? '.')
const OUT = resolve(process.argv[3] ?? join(tmpdir(), 'lumen-assistant-check'))
const PORT = 5206
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
  // Nothing may reach a real AI vendor from this check.
  await page.route(/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }) }),
  )
  await page.goto(URL)
  await page.waitForSelector('#root > *')
  return page
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts })
}

const evalIn = (page, fn, arg) => page.evaluate(fn, arg)
const setSettings = (page, patch) =>
  evalIn(page, async (patch) => {
    const { updateSettings } = await import('/src/state/settings.ts')
    await updateSettings((s) => ({ ...patch, ai: { ...s.ai, ...patch.ai } }))
  }, patch)

async function importAndEdit(page, file) {
  const id = await evalIn(page, async (u) => {
    const { importFiles } = await import('/src/io/api.ts')
    const blob = await (await fetch(u)).blob()
    return (await importFiles([new File([blob], u.split('/').pop(), { type: 'image/jpeg' })])).added[0]
  }, `/__assets/${file}`)
  await page.goto(`${URL}#/edit/${id}`)
  await page.waitForFunction(async () => (await import('/src/state/editor.ts')).editor.getState().recipe !== null, null, { timeout: 60000 })
  await page.waitForTimeout(500)
  return id
}

const editorState = (page) =>
  evalIn(page, async () => {
    const s = (await import('/src/state/editor.ts')).editor.getState()
    return { recipe: s.recipe, history: s.history.map((h) => h.label), version: s.version }
  })

async function converse(page, prefix) {
  await page.getByRole('button', { name: 'Make it pop' }).click()
  await page.waitForSelector('.ai-card', { timeout: 20000 })
  await page.waitForFunction(() => !document.querySelector('.ai-send.stop'), null, { timeout: 20000 })
  let s = await editorState(page)
  check(s.history[0] === 'AI · More pop', `${prefix}: one undo step labelled "AI · More pop" (${s.history[0]})`)
  check(s.recipe.basic.vibrance === 24 && s.recipe.basic.contrast === 18, `${prefix}: sliders applied`)
  const chips = await page.locator('.ai-changes li').allInnerTexts()
  check(chips.some((c) => /Contrast\s+0\s*→\s*\+18/.test(c.replace(/\s+/g, ' '))), `${prefix}: card lists Contrast 0 → +18 (${chips[0]})`)
  await page.getByRole('button', { name: 'Why this works' }).click()
  check(await page.locator('.ai-why').isVisible(), `${prefix}: "Why this works" opens`)
  await page.getByRole('button', { name: 'Warm golden hour' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.ai-card').length === 2 && !document.querySelector('.ai-send.stop'), null, { timeout: 20000 })
  s = await editorState(page)
  check(s.history[0] === 'AI · Golden hour', `${prefix}: second request is its own step`)
  // Undo the first card: no longer the latest step, so only its values are reverted.
  await page.locator('.ai-card').first().getByRole('button', { name: 'Undo' }).click()
  s = await editorState(page)
  check(s.recipe.basic.vibrance === 12 && s.recipe.basic.contrast === 0 && s.recipe.wb.temp === 22, `${prefix}: undo of an older card reverts only its sliders`)
  check(s.history[0] === 'Undo AI · More pop', `${prefix}: selective undo is labelled`)
  await page.locator('.ai-card').nth(1).getByRole('button', { name: 'Keep' }).click()
  check((await page.locator('.ai-card').nth(1).getByRole('button', { name: /Kept/ }).count()) === 1, `${prefix}: Keep marks the card`)
}

// ---------- Desktop ----------
{
  const page = await open({ width: 1440, height: 900 })
  await importAndEdit(page, 'photo-03.jpg')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  await page.waitForSelector('.ai-setup')
  check(await page.getByText('Edit by describing it').isVisible(), 'desktop: not-set-up card')
  await shot(page, 'desktop-setup-dark')

  // A key that the vendor rejects (routed 401): the real OpenAI adapter maps it.
  await setSettings(page, { ai: { keys: { openai: 'sk-not-a-real-key' } } })
  await page.waitForSelector('.ai-input textarea')
  await page.locator('.ai-input textarea').fill('Fix the white balance')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.ai-error', { timeout: 20000 })
  const err = await page.locator('.ai-error').innerText()
  check(/OpenAI didn.t accept this API key/.test(err), `desktop: 401 → friendly message (${err.split('\n')[0]})`)
  check(await page.getByRole('button', { name: 'Open AI settings' }).isVisible(), 'desktop: error links to AI settings')
  await shot(page, 'desktop-error-dark')

  await evalIn(page, () => localStorage.setItem('lumen.ai.mock', '1'))
  await page.reload()
  await page.waitForSelector('.ed-desk')
  if (!(await page.locator('.ai').count())) await page.getByRole('button', { name: 'Ask AI' }).click()
  await page.waitForSelector('.ai-input textarea')
  await converse(page, 'desktop')
  await shot(page, 'desktop-conversation-dark')
  await setSettings(page, { theme: 'light' })
  await shot(page, 'desktop-conversation-light')

  await page.goto(`${URL}#/settings`)
  await page.waitForSelector('#set-ai .ai-set')
  await page.locator('#set-ai').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Test key' }).click()
  await page.waitForSelector('.ai-status.good')
  check(/works with gpt-6\.1-terra/.test(await page.locator('.ai-status').innerText()), 'settings: Test key reports success (mock)')
  await page.locator('#set-ai').screenshot({ path: join(OUT, 'desktop-settings-light.png') })
  await page.getByRole('button', { name: 'Google' }).click()
  await page.waitForSelector('.ai-set-warning')
  check(/paid Gemini key/.test(await page.locator('.ai-set-warning').innerText()), 'settings: Gemini free-tier warning')
  await setSettings(page, { theme: 'dark' })
  await page.locator('#set-ai').screenshot({ path: join(OUT, 'desktop-settings-google-dark.png') })
  check(page.errors.length === 0, `desktop: no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

// ---------- Phone ----------
{
  const page = await open({ width: 390, height: 844 }, true)
  await setSettings(page, { theme: 'light', ai: { provider: 'anthropic' } })
  await importAndEdit(page, 'photo-07.jpg')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  await page.waitForSelector('.ai-setup')
  await page.waitForSelector('.ai-peek img', { timeout: 30000 })
  await shot(page, 'phone-setup-light')

  await evalIn(page, () => localStorage.setItem('lumen.ai.mock', '1'))
  await page.reload()
  await page.waitForSelector('.ed-is-phone')
  if (!(await page.locator('.ai').count())) await page.getByRole('button', { name: 'Ask AI' }).click()
  await page.waitForSelector('.ai-input textarea')
  await converse(page, 'phone')
  await page.locator('.ai-log').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shot(page, 'phone-conversation-light')
  await setSettings(page, { theme: 'dark' })
  await shot(page, 'phone-conversation-dark')
  const overflow = await evalIn(page, () => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'phone: no horizontal overflow')
  await page.getByRole('button', { name: 'Back to the editor' }).click()
  check((await page.locator('.ai').count()) === 0, 'phone: back closes the assistant')
  check(page.errors.length === 0, `phone: no page errors ${page.errors.join(' | ')}`)
  await page.context().close()
}

await browser.close()
await server.close()
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed', `\nscreenshots: ${OUT}`)
process.exit(failures.length ? 1 : 0)
