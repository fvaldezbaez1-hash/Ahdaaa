// Keywords (tags) on photos: one word or a short phrase each, unique ignoring
// case, kept in the order they were added. The first spelling used wins
// ("Paris" stays "Paris" when someone later types "paris"). Pure functions,
// unit-tested; the database side is in actions.ts.

/** Longest keyword kept (Lightroom allows more, but nobody reads 200-character tags). */
export const MAX_KEYWORD = 64

/** Tidy one keyword: no surrounding or doubled spaces, no separators or control characters. '' if nothing is left. */
export function normalizeKeyword(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f,;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEYWORD)
    .trim()
}

const fold = (k: string) => k.toLocaleLowerCase()

/** Keywords typed or pasted as text: separated by commas, semicolons or new lines. */
export function parseKeywords(text: string): string[] {
  return addKeywords([], text.split(/[,;\n\r]+/))
}

/** `list` plus `add`, without duplicates (ignoring case); existing spellings win. */
export function addKeywords(list: readonly string[] | undefined, add: readonly string[]): string[] {
  const out = [...(list ?? [])]
  const seen = new Set(out.map(fold))
  for (const raw of add) {
    const k = normalizeKeyword(raw)
    if (!k || seen.has(fold(k))) continue
    seen.add(fold(k))
    out.push(k)
  }
  return out
}

/** `list` without `remove` (ignoring case). */
export function removeKeywords(list: readonly string[] | undefined, remove: readonly string[]): string[] {
  const gone = new Set(remove.map((k) => fold(normalizeKeyword(k))))
  return (list ?? []).filter((k) => !gone.has(fold(k)))
}

/** Clean up a stored or imported list (duplicates, stray spaces, empty entries). */
export const cleanKeywords = (list: readonly unknown[] | undefined): string[] => addKeywords([], (list ?? []).filter((k): k is string => typeof k === 'string'))

export const hasKeyword = (list: readonly string[] | undefined, k: string) => !!list?.some((x) => fold(x) === fold(k))

export interface KeywordCount {
  name: string
  count: number
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Every keyword in the library with how many photos have it, A→Z. The most used spelling names it. */
export function countKeywords(photos: readonly { keywords?: readonly string[] }[]): KeywordCount[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const p of photos) {
    for (const k of p.keywords ?? []) {
      const key = fold(k)
      let e = byKey.get(key)
      if (!e) byKey.set(key, (e = { count: 0, spellings: new Map() }))
      e.count++
      e.spellings.set(k, (e.spellings.get(k) ?? 0) + 1)
    }
  }
  return [...byKey.values()]
    .map((e) => ({ name: [...e.spellings].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))[0][0], count: e.count }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/**
 * Autocomplete: known keywords that start with what was typed first, then
 * ones containing it (more used first), leaving out those already there.
 */
export function suggestKeywords(typed: string, known: readonly KeywordCount[], exclude: readonly string[] = [], limit = 8): string[] {
  const q = fold(normalizeKeyword(typed))
  const skip = new Set(exclude.map(fold))
  const pool = known.filter((k) => !skip.has(fold(k.name)))
  if (!q) return [...pool].sort((a, b) => b.count - a.count).slice(0, limit).map((k) => k.name)
  const starts = pool.filter((k) => fold(k.name).startsWith(q) || fold(k.name).split(' ').some((w) => w.startsWith(q)))
  const contains = pool.filter((k) => !starts.includes(k) && fold(k.name).includes(q))
  const byUse = (a: KeywordCount, b: KeywordCount) => b.count - a.count || collator.compare(a.name, b.name)
  return [...starts.sort(byUse), ...contains.sort(byUse)].slice(0, limit).map((k) => k.name)
}

/**
 * Keywords across several photos: those on every one, and those on only some
 * (shown dimmed in the batch editor; adding one there puts it on all).
 */
export function sharedKeywords(lists: readonly (readonly string[] | undefined)[]): { all: string[]; some: string[] } {
  const counts = countKeywords(lists.map((keywords) => ({ keywords: keywords ?? [] })))
  const n = lists.length
  return { all: counts.filter((c) => c.count === n).map((c) => c.name), some: counts.filter((c) => c.count < n).map((c) => c.name) }
}
