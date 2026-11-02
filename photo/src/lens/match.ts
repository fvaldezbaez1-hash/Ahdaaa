// Finding cameras and lenses from EXIF the way lensfun does (database.cpp:
// FindCamerasExt, FindLenses, MatchScore; auxfun.cpp: lfFuzzyStrCmp,
// _lf_strcmp), so Lumen picks the same profile darktable or RawTherapee would.
import type { CameraJson, DbLens, LensDb } from './db'
import { guessParameters } from './db'

const isSpace = (c: string) => /\s/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'
// C's ispunct() in the "C" locale: printable ASCII that is not alphanumeric or space.
const isPunct = (c: string) => /^[!-/:-@[-`{-~]$/.test(c)

/** lfFuzzyStrCmp::Split: words by character class, numbers without a trailing ".0", lone symbols and a lone "f" dropped; sorted. */
export function splitWords(s: string | undefined): string[] {
  const out: string[] = []
  if (!s) return out
  let i = 0
  while (i < s.length) {
    while (i < s.length && isSpace(s[i])) i++
    if (i >= s.length) break
    const start = i++
    let strip = 0
    const c = s[start]
    if (isDigit(c)) {
      while (i < s.length && (isDigit(s[i]) || s[i] === '.')) i++
      if (i - start >= 2 && s[i - 2] === '.' && s[i - 1] === '0') strip = 2
    } else if (isPunct(c)) while (i < s.length && isPunct(s[i])) i++
    else while (i < s.length && !isSpace(s[i]) && !isDigit(s[i]) && !isPunct(s[i])) i++
    if (i - start === 1 && (isPunct(c) || c.toLowerCase() === 'f') && c !== '*' && c !== '+') continue
    out.push(s.slice(start, i - strip).toLowerCase())
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * lfFuzzyStrCmp::Compare: 0…100, how well `match` covers the pattern's words.
 * `allWords` (lensfun's default, strict search): every pattern word must occur.
 */
export function fuzzyScore(pattern: readonly string[], match: string | undefined, allWords = true): number {
  const words = splitWords(match)
  if (!words.length || !pattern.length) return 0
  let mi = 0
  let score = 0
  for (const p of pattern) {
    const old = mi
    for (; mi < words.length; mi++) {
      if (p === words[mi]) {
        score++
        break
      }
      if (p < words[mi]) {
        if (allWords) return 0
        mi = old - 1
        break
      }
    }
    if (allWords) {
      if (mi >= words.length) return 0
      mi++
    } else if (mi >= words.length) mi = old
    else mi++
  }
  return Math.trunc((score * 200) / (pattern.length + words.length))
}

/** Best score over a name's language variants (lfFuzzyStrCmp::Compare(lfMLstr)). */
export function fuzzyScoreMl(pattern: readonly string[], names: readonly string[], allWords = true): number {
  let best = 0
  for (const n of names) {
    best = Math.max(best, fuzzyScore(pattern, n, allWords))
    if (best >= 100) break
  }
  return best
}

/** _lf_strcmp equality: case-insensitive, runs of whitespace equal one space, ends trimmed. */
export const sameName = (a: string, b: string): boolean => norm(a) === norm(b)
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** lfDatabase::FindCamerasExt (strict): best match first. */
export function findCameras(db: LensDb, maker: string | undefined, model: string | undefined): (CameraJson & { score: number })[] {
  const mk = maker?.trim() ? splitWords(maker) : null
  const md = model?.trim() ? splitWords(model) : null
  const out: (CameraJson & { score: number })[] = []
  for (const c of db.cameras) {
    let s1 = 0, s2 = 0
    if ((!mk || (s1 = fuzzyScoreMl(mk, c.maker))) && (!md || (s2 = fuzzyScoreMl(md, c.model)))) out.push({ ...c, score: s1 + s2 })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** _lf_compare_num: 0 neutral (unknown), +1 same within 1 %, −1 different. */
function compareNum(a: number, b: number): number {
  if (!a || !b) return 0
  const r = a / b
  return r <= 0.99 || r >= 1.01 ? -1 : 1
}

interface Pattern {
  maker?: string
  words: string[]
  minFocal: number
  maxFocal: number
  minAperture: number
  maxAperture: number
}

/** lfDatabase::MatchScore. 0 = not a candidate. */
export function matchScore(p: Pattern, lens: DbLens, camera: CameraJson | null, compat: readonly string[] | null, hasModel: boolean): number {
  let score = 0
  if (camera && lens.cal.length) {
    let crop = 0
    for (const c of lens.cal) {
      const k = camera.crop
      if (k > 0.01 && k < c.crop * 0.96) continue
      if (k >= c.crop * 1.41) crop = Math.max(2, crop)
      else if (k >= c.crop * 1.31) crop = Math.max(4, crop)
      else if (k >= c.crop * 1.21) crop = Math.max(6, crop)
      else if (k >= c.crop * 1.11) crop = Math.max(8, crop)
      else if (k >= c.crop * 1.01) crop = Math.max(10, crop)
      else if (k >= c.crop) crop = Math.max(5, crop)
      else if (k >= c.crop * 0.96) crop = Math.max(3, crop)
    }
    if (!crop) return 0
    score += crop
  }
  for (const [a, b] of [
    [p.minFocal, lens.minFocal],
    [p.maxFocal, lens.maxFocal],
    [p.minAperture, lens.minAperture],
    [p.maxAperture, lens.maxAperture],
  ]) {
    const c = compareNum(a, b)
    if (c < 0) return 0
    if (c > 0) score += 10
  }
  if (compat && !compat.length) compat = null
  if (lens.mounts.length && (camera || compat)) {
    let found = false
    if (camera?.mount && lens.mounts.some((m) => sameName(camera.mount, m))) {
      found = true
      score += 10
    } else if (compat && compat.some((c) => lens.mounts.some((m) => sameName(c, m)))) {
      found = true
      score += 9
    }
    if (!found) return 0
  }
  if (p.maker && lens.maker.length) {
    if (!lens.maker.some((m) => sameName(p.maker!, m))) return 0
    score += 10
  }
  if (hasModel) {
    let s = fuzzyScoreMl(p.words, lens.model)
    if (!s) return 0
    s = Math.trunc((s * 4) / 10) || 1
    score += s
  }
  return score
}

/** lfDatabase::FindLenses (strict search): lenses for an EXIF lens name on a camera, best first. */
export function findLenses(db: LensDb, camera: CameraJson | null, maker: string | undefined, model: string | undefined): (DbLens & { score: number })[] {
  const m = model?.trim() ? model : undefined
  const g = guessParameters(m, {})
  const p: Pattern = { maker: maker?.trim() || undefined, words: splitWords(m), ...g }
  const compat = camera ? (Object.entries(db.mounts).find(([name]) => sameName(name, camera.mount))?.[1] ?? null) : null
  const out: (DbLens & { score: number })[] = []
  for (const l of db.lenses) {
    const score = matchScore(p, l, camera, compat, !!m)
    if (score > 0) out.push({ ...l, score })
  }
  // Stable for equal scores (lensfun's std::sort isn't, so ties may come out in another order there).
  return out.sort((a, b) => b.score - a.score)
}
