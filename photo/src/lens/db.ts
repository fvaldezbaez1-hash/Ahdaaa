// Lumen's lens database: lensfun's XML database converted to JSON at build
// time (scripts/lens/build.mjs), served from Lumen's own origin at
// lens/lensfun.json and loaded on first use. Lens data © the lensfun project
// contributors, CC BY-SA 3.0 (https://lensfun.github.io).

/** One calibration set (lensfun: one per crop factor / aspect ratio it was measured at). */
export interface CalibrationJson {
  crop: number
  aspect: number
  /** Distortion model and points: [focal, ...terms] (poly3: k1; poly5: k1 k2; ptlens: a b c). */
  dm?: 'poly3' | 'poly5' | 'ptlens'
  d?: number[][]
  /** TCA model and points: [focal, vr, vb, cr?, cb?, br?, bb?] (missing = 0). */
  tm?: 'linear' | 'poly3'
  t?: number[][]
  /** Vignetting (pa) points: [focal, aperture, distance, k1, k2, k3]. */
  v?: number[][]
}

export interface CameraJson {
  /** Names, the default language first (lensfun matches against all). */
  maker: string[]
  model: string[]
  variant?: string
  mount: string
  crop: number
}

export interface LensJson {
  id: string
  maker: string[]
  model: string[]
  mounts: string[]
  crop: number
  aspect: number
  /** Projection when not rectilinear: fisheye, equisolid, stereographic, panoramic. */
  type?: string
  focal?: [number, number]
  aperture?: [number, number]
  center?: [number, number]
  cal: CalibrationJson[]
}

export interface LensDbJson {
  v: 1
  lensfun: { commit: string; date: string; licence: string; attribution: string }
  /** Mount → compatible mounts (lenses for those fit, e.g. via adapters). */
  mounts: Record<string, string[]>
  cameras: CameraJson[]
  lenses: LensJson[]
}

/** A lens with the focal / aperture range lensfun derives at load (lfLens::GuessParameters). */
export interface DbLens extends LensJson {
  minFocal: number
  maxFocal: number
  minAperture: number
  maxAperture: number
}

export interface LensDb {
  info: LensDbJson['lensfun']
  mounts: Record<string, string[]>
  cameras: CameraJson[]
  lenses: DbLens[]
  byId: Map<string, DbLens>
}

// lensfun's lens name patterns (lens.cpp): [min focal]-[max focal]mm f/[min aperture]…, 1:[aperture] [focal]mm, [aperture]/[focal].
const NAME_PATTERNS: [RegExp, [number, number, number]][] = [
  [/^[^:]*?([0-9]+[0-9.]*)[-]?([0-9]+[0-9.]*)?(mm)\s+(f\/|f|1\/|1:)?([0-9.]+)(-[0-9.]+)?.*$/, [1, 2, 5]],
  [/^.*?1:([0-9.]+)[-]?([0-9.]+)?\s+([0-9.]+)[-]?([0-9.]+)?(mm)?.*$/, [3, 4, 1]],
  [/^.*?([0-9.]+)[-]?([0-9.]+)?\s*\/\s*([0-9.]+)[-]?([0-9.]+)?.*$/, [3, 4, 1]],
]
const EXTENDER = /^.*?[0-9](\.[0.9]+)?x.*$/
const NOT_A_LENS = ['adapter', 'reducer', 'booster', 'extender', 'converter', 'magnifier']

/**
 * lensfun's lfLens::GuessParameters: focal and aperture range from the XML,
 * else from the lens name, else from its calibration data.
 */
export function guessParameters(
  model: string | undefined,
  given: { minFocal?: number; maxFocal?: number; minAperture?: number; maxAperture?: number },
  cal: readonly CalibrationJson[] = [],
): { minFocal: number; maxFocal: number; minAperture: number; maxAperture: number } {
  let { minFocal = 0, maxFocal = 0, minAperture = 0, maxAperture = 0 } = given
  let minf = Infinity, maxf = -Infinity, mina = Infinity, maxa = -Infinity
  // atof: the leading number of the string (0 if none)
  const atof = (s: string | undefined) => (s === undefined ? NaN : parseFloat(s) || 0)
  if (model && (!minAperture || !minFocal) && !NOT_A_LENS.some((w) => model.includes(w)) && !EXTENDER.test(model)) {
    for (const [re, [fi, xi, ai]] of NAME_PATTERNS) {
      const m = re.exec(model)
      if (!m) continue
      if (m[fi] !== undefined) minf = atof(m[fi])
      if (m[xi] !== undefined) maxf = atof(m[xi])
      if (m[ai] !== undefined) mina = atof(m[ai])
      break
    }
  }
  if (!minAperture || !minFocal) {
    for (const c of cal) {
      for (const p of [...(c.d ?? []), ...(c.t ?? [])]) {
        minf = Math.min(minf, p[0])
        maxf = Math.max(maxf, p[0])
      }
      for (const p of c.v ?? []) {
        minf = Math.min(minf, p[0])
        maxf = Math.max(maxf, p[0])
        mina = Math.min(mina, p[1])
        maxa = Math.max(maxa, p[1])
      }
    }
  }
  if (minf !== Infinity && !minFocal) minFocal = minf
  if (maxf !== -Infinity && !maxFocal) maxFocal = maxf
  if (mina !== Infinity && !minAperture) minAperture = mina
  if (maxa !== -Infinity && !maxAperture) maxAperture = maxa
  if (!maxFocal) maxFocal = minFocal
  return { minFocal, maxFocal, minAperture, maxAperture }
}

export function indexDb(json: LensDbJson): LensDb {
  const lenses: DbLens[] = json.lenses.map((l) => ({
    ...l,
    ...guessParameters(l.model[0], { minFocal: l.focal?.[0], maxFocal: l.focal?.[1], minAperture: l.aperture?.[0], maxAperture: l.aperture?.[1] }, l.cal),
  }))
  return { info: json.lensfun, mounts: json.mounts, cameras: json.cameras, lenses, byId: new Map(lenses.map((l) => [l.id, l])) }
}

let loading: Promise<LensDb> | null = null
let base: string | null = null

/** Where the app is served from (defaults to the page's base). */
export function setLensDbBase(url: string): void {
  base = url
}

/** The database, fetched once from Lumen's origin (the service worker keeps it for offline use). */
export function loadLensDb(): Promise<LensDb> {
  loading ??= (async () => {
    const url = new URL('lens/lensfun.json', base ?? new URL(import.meta.env.BASE_URL || './', document.baseURI).href)
    const res = await fetch(url)
    if (!res.ok) throw new Error(res.status === 404 ? 'The lens database isn’t part of this version of Lumen.' : `Couldn’t load the lens database (HTTP ${res.status}).`)
    return indexDb((await res.json()) as LensDbJson)
  })()
  loading.catch(() => (loading = null))
  return loading
}

/** Test seam: use this database instead of fetching one. */
export function setLensDb(db: LensDb | null): void {
  loading = db ? Promise.resolve(db) : null
}
