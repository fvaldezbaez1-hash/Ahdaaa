import type { Food, Nutrients } from './types'

// Open Food Facts: a free, open database of packaged foods with barcodes.
// https://openfoodfacts.github.io/openfoodfacts-server/api/

const FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'brands', 'nutriments',
  'serving_size', 'serving_quantity', 'serving_quantity_unit', 'product_quantity_unit',
].join(',')

export interface OffProduct {
  code?: string
  product_name?: string
  product_name_en?: string
  generic_name?: string
  brands?: string | string[]
  nutriments?: Record<string, unknown>
  serving_size?: string
  serving_quantity?: number | string
  serving_quantity_unit?: string
  product_quantity_unit?: string
}

const toNum = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function mapOffProduct(p: OffProduct): Food | null {
  const name = (p.product_name || p.product_name_en || p.generic_name || '').trim()
  if (!name) return null
  const n = p.nutriments ?? {}
  const get = (k: string) => toNum(n[k])
  const kj = get('energy_100g')
  const kcal = get('energy-kcal_100g') ?? (kj !== undefined ? kj / 4.184 : undefined)
  if (kcal === undefined) return null

  const per100: Nutrients = {
    kcal: Math.round(kcal),
    protein: r1(get('proteins_100g') ?? 0),
    carbs: r1(get('carbohydrates_100g') ?? 0),
    fat: r1(get('fat_100g') ?? 0),
  }
  const fiber = get('fiber_100g')
  const sugar = get('sugars_100g')
  const satFat = get('saturated-fat_100g')
  const sodium = get('sodium_100g')
  if (fiber !== undefined) per100.fiber = r1(fiber)
  if (sugar !== undefined) per100.sugar = r1(sugar)
  if (satFat !== undefined) per100.satFat = r1(satFat)
  if (sodium !== undefined) per100.sodium = Math.round(sodium * 1000)

  const brandRaw = Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0]
  const unit = (p.serving_quantity_unit ?? p.product_quantity_unit ?? '').toLowerCase() === 'ml' ? 'ml' : 'g'
  const sq = toNum(p.serving_quantity)
  const code = p.code?.trim()
  return {
    id: `off:${code || name.toLowerCase()}`,
    name,
    brand: brandRaw?.trim() || undefined,
    barcode: code || undefined,
    per100,
    servings: sq && sq > 0 ? [{ label: p.serving_size?.trim() || '1 serving', grams: sq }] : [],
    unit,
    source: 'off',
  }
}

async function getJson(url: string, signal?: AbortSignal, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Returns null when the barcode isn't in the database. Throws when offline. */
export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<Food | null> {
  const clean = code.replace(/\D/g, '')
  if (!clean) return null
  const data = (await getJson(
    `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${FIELDS}`,
    signal,
  )) as { status?: number; product?: OffProduct }
  if (!data.product || data.status === 0) return null
  return mapOffProduct({ code: clean, ...data.product })
}

function mapAll(products: OffProduct[] | undefined): Food[] {
  const seen = new Set<string>()
  const out: Food[] = []
  for (const p of products ?? []) {
    const f = mapOffProduct(p)
    if (!f || seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
  }
  return out
}

/** Full-text product search. Tries the fast search service, then the classic API. */
export async function searchOff(query: string, signal?: AbortSignal): Promise<Food[]> {
  const q = encodeURIComponent(query.trim())
  if (!q) return []
  try {
    const data = (await getJson(
      `https://search.openfoodfacts.org/search?q=${q}&page_size=30&langs=en&fields=${FIELDS}`,
      signal,
      8000,
    )) as { hits?: OffProduct[] }
    if (Array.isArray(data.hits)) return mapAll(data.hits)
  } catch (e) {
    if (signal?.aborted) throw e
  }
  const data = (await getJson(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=30&fields=${FIELDS}`,
    signal,
    15_000,
  )) as { products?: OffProduct[] }
  return mapAll(data.products)
}
