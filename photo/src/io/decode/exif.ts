// Capture metadata of developed images (and of TIFF-based RAWs when we fall
// back to their embedded preview) via exifr.
import exifr from 'exifr'
import type { PhotoMeta } from '../types'

const OPTIONS = {
  tiff: true, exif: true, gps: true, ifd1: false, interop: false, makerNote: false, userComment: false,
  xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
  translateValues: false, reviveValues: true, mergeOutput: true, silentErrors: true,
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

export async function readExif(input: Blob | Uint8Array): Promise<{ meta: PhotoMeta; orientation: number }> {
  // exifr's result is an untyped tag bag; every field is checked below.
  const t: Record<string, unknown> | undefined = await exifr.parse(input, OPTIONS).catch(() => undefined)
  if (!t) return { meta: {}, orientation: 1 }
  const date = t.DateTimeOriginal ?? t.CreateDate
  const lat = t.latitude, lon = t.longitude
  const alt = typeof t.GPSAltitude === 'number' ? t.GPSAltitude * (t.GPSAltitudeRef === 1 ? -1 : 1) : undefined
  const meta: PhotoMeta = {
    make: str(t.Make),
    model: str(t.Model),
    lens: str(t.LensModel),
    iso: num(t.ISO),
    shutter: num(t.ExposureTime),
    aperture: num(t.FNumber),
    focalLength: num(t.FocalLength),
    takenAt: date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : undefined,
    gps: typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon, ...(alt !== undefined ? { alt } : {}) } : undefined,
    artist: str(t.Artist),
    copyright: str(t.Copyright),
    software: str(t.Software),
  }
  const o = t.Orientation
  return { meta: dropUndefined(meta), orientation: typeof o === 'number' && o >= 1 && o <= 8 ? o : 1 }
}

/** IndexedDB stores `undefined` fields verbatim; keep records tidy. */
export function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
