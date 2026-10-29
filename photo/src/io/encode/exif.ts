// EXIF written into exported files: capture date, camera, lens and exposure,
// plus GPS only when the user keeps location. Orientation is always 1 because
// exports are rendered upright.
import type { PhotoMeta } from '../types'
import { ascii, BYTE, frac, long, rational, serializeTiff, short, UNDEFINED, type Ifd, type Tag } from './tiffIfd'

export interface ExifInput {
  meta: PhotoMeta
  width: number
  height: number
  colorSpace: 'srgb' | 'display-p3'
  includeGps: boolean
  /** Export time, for DateTime (ModifyDate). */
  now?: number
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** EXIF date format "YYYY:MM:DD HH:MM:SS" in local time (matches how capture times are stored). */
export function exifDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function exposureRational(s: number): [number, number] {
  if (s >= 1) return frac(s, 10)
  const inv = Math.round(1 / s)
  return Math.abs(1 / inv - s) / s < 0.01 ? [1, inv] : frac(s, 1_000_000)
}

function dms(deg: number): number[] {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const m = Math.floor((a - d) * 60)
  const s = (a - d - m / 60) * 3600
  return [d, 1, m, 1, ...frac(s, 1000)]
}

/** IFD0 tags and EXIF/GPS sub-IFDs, so the TIFF writer can merge them with its image tags. */
export function exifParts(x: ExifInput): { tags: Tag[]; children: { tag: number; ifd: Ifd }[] } {
  const m = x.meta
  const tags: Tag[] = [short(0x0112, 1), ascii(0x0131, 'Lumen'), ascii(0x0132, exifDate(x.now ?? Date.now()))]
  if (m.make) tags.push(ascii(0x010f, m.make))
  if (m.model) tags.push(ascii(0x0110, m.model))
  if (m.artist) tags.push(ascii(0x013b, m.artist))
  if (m.copyright) tags.push(ascii(0x8298, m.copyright))

  const exif: Tag[] = [
    { tag: 0x9000, type: UNDEFINED, value: Uint8Array.from([0x30, 0x32, 0x33, 0x32]) },
    short(0xa001, x.colorSpace === 'srgb' ? 1 : 0xffff),
    long(0xa002, x.width),
    long(0xa003, x.height),
  ]
  if (m.shutter && m.shutter > 0) exif.push(rational(0x829a, ...exposureRational(m.shutter)))
  if (m.aperture && m.aperture > 0) exif.push(rational(0x829d, ...frac(m.aperture, 10)))
  if (m.iso && m.iso > 0) exif.push(short(0x8827, Math.min(65535, Math.round(m.iso))))
  if (m.takenAt) exif.push(ascii(0x9003, exifDate(m.takenAt)), ascii(0x9004, exifDate(m.takenAt)))
  if (m.focalLength && m.focalLength > 0) exif.push(rational(0x920a, ...frac(m.focalLength, 10)))
  if (m.lens) exif.push(ascii(0xa434, m.lens))
  const children = [{ tag: 0x8769, ifd: { tags: exif } }]

  if (x.includeGps && m.gps && Number.isFinite(m.gps.lat) && Number.isFinite(m.gps.lon)) {
    const g = m.gps
    const gps: Tag[] = [
      { tag: 0x0000, type: BYTE, value: [2, 3, 0, 0] },
      ascii(0x0001, g.lat < 0 ? 'S' : 'N'),
      rational(0x0002, ...dms(g.lat)),
      ascii(0x0003, g.lon < 0 ? 'W' : 'E'),
      rational(0x0004, ...dms(g.lon)),
    ]
    if (g.alt !== undefined && Number.isFinite(g.alt)) gps.push({ tag: 0x0005, type: BYTE, value: [g.alt < 0 ? 1 : 0] }, rational(0x0006, ...frac(Math.abs(g.alt), 100)))
    children.push({ tag: 0x8825, ifd: { tags: gps } })
  }
  return { tags, children }
}

/** The TIFF-structured EXIF block (what follows "Exif\0\0" in JPEG, or a PNG eXIf chunk). */
export function exifTiff(x: ExifInput): Uint8Array {
  const { tags, children } = exifParts(x)
  return serializeTiff({ tags, children }, false)
}
