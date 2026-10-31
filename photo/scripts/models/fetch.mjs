// Download (and where needed convert) Lumen's on-device AI models into
// public/models/, so Vite copies them into the build and GitHub Pages serves
// them from Lumen's own origin: no third-party requests from users' browsers,
// no CORS, and the binaries stay out of git (public/models/ is ignored).
//
// Every source is checked against its sha256 before use, and every output
// against the registry's sha256 (conversions are deterministic).
//
// Usage (from photo/): node scripts/models/fetch.mjs [--out dir] [--cache dir] [--only id,id] [--allow-missing]
//   --cache: keep the downloaded sources and converted results there (CI caches it between runs).
//   --allow-missing: a model whose sources are all unreachable is skipped with
//     a warning instead of failing (the app then reports it as unavailable).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { converters } from './convert.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const { MODELS } = await import(join(ROOT, 'src/ai/registry.ts'))

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = resolve(opt('--out') ?? join(ROOT, 'public/models'))
const CACHE = opt('--cache') ? resolve(opt('--cache')) : null
const ONLY = opt('--only')?.split(',')
const ALLOW_MISSING = args.includes('--allow-missing')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`

const ATTEMPTS = 4

/** Download with retries: release hosts drop connections now and then, and one blip shouldn't fail the deploy. */
async function download(url, expect) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadOnce(url, expect)
    } catch (e) {
      // A missing file won't appear on retry; anything else (resets, timeouts, truncation) might.
      if (attempt >= ATTEMPTS || /^HTTP 404/.test(e.message)) throw e
      const wait = 2 ** attempt * 1000
      console.log(`retry ${url} in ${wait / 1000} s (${e.message})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

async function downloadOnce(url, expect) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length !== expect.bytes) throw new Error(`size ${bytes.length}, expected ${expect.bytes}`)
  const hash = sha256(bytes)
  if (hash !== expect.sha256) throw new Error(`sha256 ${hash}, expected ${expect.sha256}`)
  return bytes
}

async function source(m) {
  // `m` is one file of a model: { file, bytes, sha256, source }.
  const cached = CACHE && join(CACHE, m.source.sha256)
  if (cached && existsSync(cached)) {
    const bytes = new Uint8Array(readFileSync(cached))
    if (sha256(bytes) === m.source.sha256) return bytes
  }
  const errors = []
  for (const url of m.source.urls) {
    try {
      const bytes = await download(url, m.source)
      if (cached) {
        mkdirSync(CACHE, { recursive: true })
        writeFileSync(cached, bytes)
      }
      return bytes
    } catch (e) {
      errors.push(`${url}: ${e.message}`)
    }
  }
  throw new Error(`no source worked:\n    ${errors.join('\n    ')}`)
}

mkdirSync(OUT, { recursive: true })
const wanted = MODELS.filter((m) => !ONLY || ONLY.includes(m.id))
const keep = new Set(MODELS.flatMap((m) => m.files.map((f) => f.file)))
let failed = 0
let total = 0
for (const m of wanted)
  for (const f of m.files) {
    const path = join(OUT, f.file)
    total += f.bytes
    if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) {
      console.log(`ok    ${m.id}: ${f.file} (${mb(f.bytes)}, present)`)
      continue
    }
    const t0 = Date.now()
    try {
      // Converted outputs are cached too (by their own sha256): converting IS-Net takes minutes.
      const done = CACHE && f.source.convert && join(CACHE, f.sha256)
      let bytes = done && existsSync(done) ? new Uint8Array(readFileSync(done)) : null
      if (!bytes || sha256(bytes) !== f.sha256) {
        bytes = await source(f)
        if (f.source.convert) bytes = converters[f.source.convert](bytes)
        if (done && sha256(bytes) === f.sha256) writeFileSync(done, bytes)
      }
      const hash = sha256(bytes)
      if (hash !== f.sha256 || bytes.length !== f.bytes) throw new Error(`result sha256 ${hash} (${bytes.length} bytes) does not match the registry (${f.sha256}, ${f.bytes} bytes)`)
      writeFileSync(`${path}.part`, bytes)
      renameSync(`${path}.part`, path)
      console.log(`fetch ${m.id}: ${f.file} (${mb(f.bytes)}, ${m.licence}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    } catch (e) {
      failed++
      console.error(`${ALLOW_MISSING ? 'WARN ' : 'FAIL '} ${m.id}: ${f.file}: ${e.message}`)
    }
  }
// Old versions of a model would otherwise ship forever.
if (!ONLY)
  for (const f of readdirSync(OUT))
    if (!keep.has(f) && !f.startsWith('.')) {
      rmSync(join(OUT, f))
      console.log(`rm    ${f} (not in the registry)`)
    }
console.log(`${wanted.length} models, ${mb(total)}`)
if (failed && !ALLOW_MISSING) process.exit(1)
