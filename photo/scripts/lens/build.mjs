// Build Lumen's lens database from lensfun's XML database (data licence:
// CC BY-SA 3.0, https://lensfun.github.io). Each XML file is downloaded from
// GitHub at a pinned commit (scripts/lens/sources.mjs), checked against its
// sha256, and the whole set is converted to one compact JSON file,
// public/lens/lensfun.json (git-ignored), served from Lumen's own origin and
// loaded lazily by src/lens.
//
// Usage (from photo/): node scripts/lens/build.mjs [--cache dir] [--out file] [--src dir]
//   --cache: keep the downloaded XML there (CI caches it between runs).
//   --src:   read the XML files from a local lensfun checkout (data/db) instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { download, sha256 } from '../models/download.mjs'
import { LENSFUN } from './sources.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const OUT = resolve(opt('--out') ?? join(ROOT, 'public/lens/lensfun.json'))
const CACHE = opt('--cache') ? resolve(opt('--cache')) : null
const SRC = opt('--src') ? resolve(opt('--src')) : null

// ---------- a small XML reader (lensfun's files: elements, attributes, text, comments) ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m)))

export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(text))) {
    const top = stack.at(-1)
    if (m[1]) {
      if (top.name !== m[1]) throw new Error(`XML: </${m[1]}> closes <${top.name}>`)
      stack.pop()
    } else if (m[2]) {
      const attrs = {}
      for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3])
      const el = { name: m[2], attrs, children: [], text: '' }
      top.children.push(el)
      if (!m[4]) stack.push(el)
    } else if (m[5]) top.text += unescape(m[5])
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack.at(-1).name}> not closed`)
  return root
}

// ---------- lensfun → compact JSON ----------

const num = (s) => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : undefined
}
const kids = (el, name) => el.children.filter((c) => c.name === name)
const texts = (el, name) => kids(el, name).map((c) => c.text.trim()).filter(Boolean)
/** Default-language name first, then translations (lensfun matches against all). */
const names = (el, name) => {
  const all = kids(el, name)
  const def = all.filter((c) => !c.attrs.lang).map((c) => c.text.trim())
  const rest = all.filter((c) => c.attrs.lang).map((c) => c.text.trim())
  return [...new Set([...def, ...rest].filter(Boolean))]
}
const ratio = (s) => {
  if (!s) return undefined
  const [a, b] = s.split(':')
  return b !== undefined ? num(a) / num(b) : num(a)
}

function calibration(el, crop, aspect) {
  const c = { crop: num(el.attrs.cropfactor) ?? crop, aspect: ratio(el.attrs['aspect-ratio']) ?? aspect }
  // Distortion: [focal, ...terms] (poly3: k1; poly5: k1 k2; ptlens: a b c). The first model met wins, as in lensfun.
  for (const d of kids(el, 'distortion')) {
    const model = d.attrs.model
    if (model === 'none' || !['poly3', 'poly5', 'ptlens'].includes(model)) continue
    c.dm ??= model
    if (c.dm !== model) continue
    const a = d.attrs
    const terms = model === 'poly3' ? [num(a.k1) ?? 0] : model === 'poly5' ? [num(a.k1) ?? 0, num(a.k2) ?? 0] : [num(a.a) ?? 0, num(a.b) ?? 0, num(a.c) ?? 0]
    ;(c.d ??= []).push([num(a.focal), ...terms])
  }
  // TCA: [focal, vr, vb, cr, cb, br, bb] (linear kr/kb → vr/vb), trailing zeros dropped.
  for (const t of kids(el, 'tca')) {
    const model = t.attrs.model
    if (model !== 'linear' && model !== 'poly3') continue
    c.tm ??= model
    if (c.tm !== model) continue
    const a = t.attrs
    const terms = model === 'linear' ? [num(a.kr) ?? 1, num(a.kb) ?? 1, 0, 0, 0, 0] : [num(a.vr) ?? 1, num(a.vb) ?? 1, num(a.cr) ?? 0, num(a.cb) ?? 0, num(a.br) ?? 0, num(a.bb) ?? 0]
    while (terms.length > 2 && terms.at(-1) === 0) terms.pop()
    ;(c.t ??= []).push([num(t.attrs.focal), ...terms])
  }
  // Vignetting (pa): [focal, aperture, distance, k1, k2, k3].
  for (const v of kids(el, 'vignetting')) {
    if (v.attrs.model !== 'pa') continue
    const a = v.attrs
    ;(c.v ??= []).push([num(a.focal), num(a.aperture), num(a.distance), num(a.k1) ?? 0, num(a.k2) ?? 0, num(a.k3) ?? 0])
  }
  return c
}

function convert(docs) {
  const mounts = {}
  const cameras = []
  const lenses = []
  for (const doc of docs) {
    const db = kids(doc, 'lensdatabase')[0]
    if (!db) continue
    for (const m of kids(db, 'mount')) {
      const name = names(m, 'name')[0]
      if (name) mounts[name] = [...new Set([...(mounts[name] ?? []), ...texts(m, 'compat')])]
    }
    for (const c of kids(db, 'camera')) {
      const cam = { maker: names(c, 'maker'), model: names(c, 'model'), mount: texts(c, 'mount')[0], crop: num(texts(c, 'cropfactor')[0]) }
      const variant = texts(c, 'variant')[0]
      if (variant) cam.variant = variant
      if (cam.maker.length && cam.model.length && cam.crop) cameras.push(cam)
    }
    for (const l of kids(db, 'lens')) {
      const crop = num(texts(l, 'cropfactor')[0])
      const aspect = ratio(texts(l, 'aspect-ratio')[0]) ?? 1.5
      const lens = { maker: names(l, 'maker'), model: names(l, 'model'), mounts: texts(l, 'mount'), crop, aspect }
      const type = texts(l, 'type')[0]
      if (type && type !== 'rectilinear') lens.type = type
      const f = kids(l, 'focal')[0]?.attrs
      if (f) lens.focal = [num(f.min ?? f.value) ?? 0, num(f.max ?? f.value) ?? 0]
      const ap = kids(l, 'aperture')[0]?.attrs
      if (ap) lens.aperture = [num(ap.min ?? ap.value) ?? 0, num(ap.max ?? ap.value) ?? 0]
      const center = kids(l, 'center')[0]?.attrs
      if (center && (num(center.x) || num(center.y))) lens.center = [num(center.x) ?? 0, num(center.y) ?? 0]
      lens.cal = kids(l, 'calibration').map((el) => calibration(el, crop, aspect)).filter((c) => c.d || c.t || c.v)
      if (!lens.model.length || !lens.mounts.length || !crop) continue
      lenses.push(lens)
    }
  }
  // Stable ids for recipes: maker/model, made unique (same name on several mounts) by the first mount.
  const seen = new Map()
  for (const l of lenses) {
    const base = `${l.maker[0] ?? ''}/${l.model[0]}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    l.id = n ? `${base}@${l.mounts[0]}${n > 1 ? `#${n}` : ''}` : base
  }
  return { mounts, cameras, lenses }
}

// ---------- main ----------

async function xmlFile(file, [hash, bytes]) {
  if (SRC) {
    const b = readFileSync(join(SRC, file))
    if (sha256(b) !== hash) throw new Error(`${file}: sha256 does not match the pinned commit`)
    return b
  }
  const cached = CACHE && join(CACHE, `lensfun-${hash}.xml`)
  if (cached && existsSync(cached)) {
    const b = readFileSync(cached)
    if (sha256(b) === hash) return b
  }
  const url = `https://raw.githubusercontent.com/${LENSFUN.repo}/${LENSFUN.commit}/data/db/${file}`
  const b = await download(url, { bytes, sha256: hash }, { timeoutMs: 60_000 })
  if (cached) {
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(cached, b)
  }
  return b
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const t0 = Date.now()
  const docs = []
  for (const [file, pin] of Object.entries(LENSFUN.files)) docs.push(parseXml(new TextDecoder().decode(await xmlFile(file, pin))))
  const { mounts, cameras, lenses } = convert(docs)
  const out = {
    v: 1,
    lensfun: {
      commit: LENSFUN.commit,
      date: LENSFUN.date,
      licence: 'CC-BY-SA-3.0',
      attribution: 'Lens data © the lensfun project contributors (https://lensfun.github.io), CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). Converted to JSON by Lumen; this file is under the same licence.',
    },
    mounts,
    cameras,
    lenses,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  const json = JSON.stringify(out)
  writeFileSync(OUT, json)
  const withData = lenses.filter((l) => l.cal.length).length
  console.log(`lens db: ${cameras.length} cameras, ${lenses.length} lenses (${withData} with calibration), ${Object.keys(mounts).length} mounts → ${OUT} (${(json.length / 1e6).toFixed(2)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

export { convert }
