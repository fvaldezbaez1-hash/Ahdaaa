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

const KEYWORD_OPTIONS = {
  // TIFF on: TIFF-based files (and RAWs) keep XMP / IPTC in IFD0 tags.
  tiff: true, exif: false, gps: false, ifd1: false, interop: false, makerNote: false, userComment: false,
  xmp: true, iptc: true, icc: false, jfif: false, ihdr: false,
  translateValues: false, reviveValues: false, mergeOutput: false, silentErrors: true,
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(strings) : typeof v === 'string' ? [v] : typeof v === 'number' ? [String(v)] : [])

/**
 * Phase 5: keywords a photo already carries — XMP dc:subject (Lightroom, Bridge, Capture One)
 * and IPTC Keywords (older apps, cameras). Duplicates and cleanup are left to the caller.
 */
export async function readKeywords(input: Blob | Uint8Array): Promise<string[]> {
  const t: Record<string, Record<string, unknown> | undefined> | undefined = await exifr.parse(input, KEYWORD_OPTIONS).catch(() => undefined)
  if (!t) return []
  const dc = t.dc as Record<string, unknown> | undefined
  return [...strings(dc?.subject).map(unescapeXml), ...strings(t.iptc?.Keywords).map(latin1AsUtf8)]
}

/** exifr leaves XML entities in XMP text. */
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[k] ?? m
  })

/** exifr reads IPTC text as Latin-1; most files (and Lumen's) mark it UTF-8. Re-decode when the bytes are valid UTF-8. */
function latin1AsUtf8(s: string): string {
  if (![...s].some((c) => c.charCodeAt(0) > 127) || [...s].some((c) => c.charCodeAt(0) > 255)) return s
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)))
  } catch {
    return s
  }
}
