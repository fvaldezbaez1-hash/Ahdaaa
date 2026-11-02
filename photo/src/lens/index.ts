// Lens profiles from the lensfun database: find the camera and lens from a
// photo's EXIF, list lenses for a manual pick, and resolve a lens at the
// photo's focal length / aperture / distance into the coefficients the
// recipe stores (edit/types: LensGeometry.profile, LensCorrection), so
// rendering never needs the database. Load lazily: `await import('../lens')`.
//
// Normalization of the returned coefficients (lensfun's models):
// - distortion: r = 1 at half the photo's SHORTER side, centre of the image.
//     poly3: r_d = r_u·(1 − k1 + k1·r_u²); poly5: r_d = r_u·(1 + k1·r_u² + k2·r_u⁴);
//     ptlens: r_d = r_u·(a·r_u³ + b·r_u² + c·r_u + 1 − a − b − c).
//   r_u is where a pixel should be (corrected), r_d where the lens put it.
// - TCA: same radius; per channel r_d = r_u·(v + c·r_u + b·r_u²) for red and
//   blue relative to green ([v, c, b]).
// - vignetting ("pa"): r = 1 at half the photo's DIAGONAL; the lens darkened
//   the photo by 1 + k1·r² + k2·r⁴ + k3·r⁶ (divide by it to correct).
//
// Lens data © the lensfun project contributors, CC BY-SA 3.0.
import type { LensCorrection, LensGeometry } from '../edit/types'
import type { PhotoMeta } from '../io/types'
import { loadLensDb, type CameraJson, type DbLens, type LensDb } from './db'
import { interpolateDistortion, interpolateTca, interpolateVignetting, radiusScale, rescaleDistortion, rescaleTca, rescaleVignetting } from './interpolate'
import { findCameras, findLenses, fuzzyScoreMl, sameName, splitWords } from './match'

export { loadLensDb, setLensDb, setLensDbBase } from './db'
export { distortRadius, vignettingFactor } from './interpolate'

export const LENS_DB_ATTRIBUTION = 'Lens profiles: lensfun (https://lensfun.github.io), CC BY-SA 3.0'

export interface CameraInfo {
  maker: string
  model: string
  variant?: string
  mount: string
  cropFactor: number
}

export interface LensInfo {
  /** Stable id (stored as LensCorrection.profileId). */
  id: string
  maker: string
  model: string
  mounts: string[]
  /** Crop factor of the camera the lens was calibrated on. */
  cropFactor: number
  /** rectilinear, or fisheye / equisolid / stereographic / panoramic. */
  type: string
  focal: [number, number]
  aperture: [number, number]
  has: { distortion: boolean; tca: boolean; vignetting: boolean }
}

export interface LensCandidate extends LensInfo {
  /** lensfun's match score (higher is better). */
  score: number
  /** Chosen without a lens name in the photo (from mount, focal length and aperture only). */
  guessed: boolean
}

export interface ResolvedLens {
  lens: LensInfo
  focal: number
  aperture: number
  distance: number
  /** For Geometry.lens.profile (null when the lens has no distortion data for this camera). */
  geometry: LensGeometry['profile']
  /** For LensCorrection.vignetting / .tca. */
  vignetting: LensCorrection['vignetting']
  tca: LensCorrection['tca']
  /** Lens optical centre offset (lensfun, fraction of half the shorter side), usually 0. */
  center: [number, number]
}

function info(l: DbLens): LensInfo {
  return {
    id: l.id,
    maker: l.maker[0] ?? '',
    model: l.model[0],
    mounts: l.mounts,
    cropFactor: l.crop,
    type: l.type ?? 'rectilinear',
    focal: [l.minFocal, l.maxFocal],
    aperture: [l.minAperture, l.maxAperture],
    has: { distortion: l.cal.some((c) => c.d?.length), tca: l.cal.some((c) => c.t?.length), vignetting: l.cal.some((c) => c.v?.length) },
  }
}

const camInfo = (c: CameraJson): CameraInfo => ({ maker: c.maker[0], model: c.model[0], mount: c.mount, cropFactor: c.crop, ...(c.variant ? { variant: c.variant } : {}) })

/** The camera from EXIF make / model (null if lensfun doesn't know it). */
export function cameraFor(db: LensDb, meta: Pick<PhotoMeta, 'make' | 'model'>): CameraInfo | null {
  if (!meta.make && !meta.model) return null
  const c = findCameras(db, meta.make, meta.model)[0]
  return c ? camInfo(c) : null
}

export async function findCamera(meta: Pick<PhotoMeta, 'make' | 'model'>): Promise<CameraInfo | null> {
  return cameraFor(await loadLensDb(), meta)
}

const camJson = (db: LensDb, c: CameraInfo | null): CameraJson | null =>
  c ? (db.cameras.find((x) => x.model[0] === c.model && x.maker[0] === c.maker && x.variant === c.variant) ?? { maker: [c.maker], model: [c.model], mount: c.mount, crop: c.cropFactor }) : null

/**
 * Lens candidates for a photo, best first. With a lens name in the EXIF this
 * is lensfun's own search (fuzzy name match, mount compatibility, crop
 * factor). Without one (many Nikon / older files), lenses that fit the
 * camera, cover the focal length and open at least as wide as the aperture
 * used, marked `guessed`.
 */
export function lensCandidates(db: LensDb, meta: PhotoMeta, camera: CameraInfo | null = cameraFor(db, meta), limit = 12): LensCandidate[] {
  const cam = camJson(db, camera)
  if (meta.lens?.trim()) {
    let found = findLenses(db, cam, undefined, meta.lens)
    // Fixed-lens compacts report a lens name lensfun files under the camera's mount only.
    if (!found.length && cam) found = findLenses(db, null, undefined, meta.lens).filter((l) => l.mounts.some((m) => sameName(m, cam.mount)))
    return found.slice(0, limit).map((l) => ({ ...info(l), score: l.score, guessed: false }))
  }
  if (!cam) return []
  const f = meta.focalLength, a = meta.aperture
  const fits = findLenses(db, cam, undefined, undefined).filter((l) => {
    if (f && (f < l.minFocal * 0.99 || f > l.maxFocal * 1.01)) return false
    if (a && l.minAperture && a < l.minAperture * 0.97) return false
    return true
  })
  // Prefer the camera maker's own lenses, primes at exactly this focal length, then the crop/mount score.
  const own = (l: DbLens) => (l.maker.some((m) => cam.maker.some((c) => sameName(m, c) || splitWords(c).includes(m.toLowerCase()))) ? 1 : 0)
  const prime = (l: DbLens) => (f && l.minFocal === l.maxFocal && Math.abs(l.minFocal - f) < 0.5 ? 1 : 0)
  return fits
    .map((l) => ({ l, k: l.score + 20 * own(l) + 15 * prime(l) + (a && l.minAperture && Math.abs(l.minAperture - a) < 0.05 ? 10 : 0) }))
    .sort((x, y) => y.k - x.k)
    .slice(0, limit)
    .map(({ l, k }) => ({ ...info(l), score: k, guessed: true }))
}

/** Lens candidates for a photo's metadata (see lensCandidates). */
export async function findLens(meta: PhotoMeta, opts: { camera?: CameraInfo | null; limit?: number } = {}): Promise<LensCandidate[]> {
  const db = await loadLensDb()
  return lensCandidates(db, meta, opts.camera === undefined ? cameraFor(db, meta) : opts.camera, opts.limit)
}

/** Manual picker: lenses whose maker + model contain the query's words (loosely), those fitting `camera` first. */
export async function listLenses(query: string, opts: { camera?: CameraInfo | null; limit?: number } = {}): Promise<LensInfo[]> {
  const db = await loadLensDb()
  const words = splitWords(query)
  const compat = opts.camera ? [opts.camera.mount, ...(Object.entries(db.mounts).find(([n]) => sameName(n, opts.camera!.mount))?.[1] ?? [])] : null
  const fits = (l: DbLens) => !compat || l.mounts.some((m) => compat.some((c) => sameName(c, m)))
  const scored = db.lenses
    .map((l) => ({ l, s: words.length ? fuzzyScoreMl(words, l.model.map((m) => `${l.maker[0] ?? ''} ${m}`), false) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => Number(fits(b.l)) - Number(fits(a.l)) || b.s - a.s || a.l.model[0].localeCompare(b.l.model[0]))
  return scored.slice(0, opts.limit ?? 50).map((x) => info(x.l))
}

export async function lensInfo(id: string): Promise<LensInfo | undefined> {
  const l = (await loadLensDb()).byId.get(id)
  return l ? info(l) : undefined
}

/** Interpolated profile for a lens at a focal length, aperture and focus distance (synchronous, given the database). */
export function resolveWith(
  db: LensDb,
  lensId: string,
  focal: number,
  aperture: number,
  distance = 1000,
  photo: { cropFactor?: number; width?: number; height?: number } = {},
): ResolvedLens | null {
  const lens = db.byId.get(lensId)
  if (!lens) return null
  const crop = photo.cropFactor ?? lens.crop
  const aspect = photo.width && photo.height ? Math.max(photo.width, photo.height) / Math.min(photo.width, photo.height) : 1.5
  const f = focal > 0 ? focal : lens.minFocal
  const ap = aperture > 0 ? aperture : lens.minAperture || 8
  const d = interpolateDistortion(lens, crop, f)
  const t = interpolateTca(lens, crop, f)
  const v = interpolateVignetting(lens, crop, f, ap, distance > 0 ? distance : 1000)
  let geometry: ResolvedLens['geometry'] = null
  if (d) {
    const r = rescaleDistortion(d, radiusScale(d.cal, crop, aspect, 'shortSide'))
    geometry = { model: r.model, k: r.terms, amount: 100 }
  }
  return {
    lens: info(lens),
    focal: f,
    aperture: ap,
    distance,
    geometry,
    tca: t ? rescaleTca(t, radiusScale(t.cal, crop, aspect, 'shortSide')) : null,
    vignetting: v ? { k: rescaleVignetting(v.k, radiusScale(v.cal, crop, aspect, 'diagonal')), amount: 100 } : null,
    center: lens.center ?? [0, 0],
  }
}

/**
 * The lens profile for a photo. `photo` gives the camera's crop factor (from
 * findCamera; default: the lens's calibration crop) and the image size (its
 * aspect ratio; default 3:2). Distance in metres (default 1000 = infinity).
 */
export async function resolveLens(lensId: string, focal: number, aperture: number, distance?: number, photo?: { cropFactor?: number; width?: number; height?: number }): Promise<ResolvedLens | null> {
  return resolveWith(await loadLensDb(), lensId, focal, aperture, distance, photo)
}
