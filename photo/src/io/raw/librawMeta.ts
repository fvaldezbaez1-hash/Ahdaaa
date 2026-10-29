// LibRaw metadata → Lumen's PhotoMeta and RawColorInfo.
import type { Metadata } from 'libraw-wasm'
import { inv, mul, XYZ_TO_SRGB, diag, IDENTITY, type Mat3, type Vec3 } from '../../color/matrices'
import { rgbCamFromCamXyz, tempTintFromMultipliers } from '../../color/wb'
import { dropUndefined } from '../decode/exif'
import type { PhotoMeta, RawColorInfo } from '../types'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

const dmsToDeg = (d: number[]) => d[0] + d[1] / 60 + d[2] / 3600

export function librawPhotoMeta(m: Metadata): PhotoMeta {
  const g = m.gps_data
  let gps: PhotoMeta['gps']
  if (g?.gpsparsed && Array.isArray(g.latitude) && Array.isArray(g.longitude)) {
    const lat = dmsToDeg(g.latitude) * (g.latref === 'S' ? -1 : 1)
    const lon = dmsToDeg(g.longitude) * (g.longref === 'W' ? -1 : 1)
    // LibRaw reports "parsed" with all zeros when the GPS block is empty.
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) gps = { lat, lon, ...(g.altitude ? { alt: g.altitude * (g.altref === 1 ? -1 : 1) } : {}) }
  }
  const ts = m.timestamp instanceof Date ? m.timestamp.getTime() : NaN
  return dropUndefined({
    make: str(m.camera_make),
    model: str(m.camera_model),
    lens: str(m.lens?.Lens) ?? str(m.lens?.makernotes?.Lens),
    iso: pos(m.iso_speed),
    shutter: pos(m.shutter),
    aperture: pos(m.aperture),
    focalLength: pos(m.focal_len),
    takenAt: ts > 0 ? ts : undefined,
    gps,
    artist: str(m.artist),
    software: str(m.software),
  })
}

function valid(m: number[]): m is Mat3 {
  if (m.length !== 9 || !m.every(Number.isFinite)) return false
  try {
    inv(m as Mat3)
    return true
  } catch {
    return false
  }
}

function normGreen(v: number[] | undefined): Vec3 | undefined {
  if (!v || !(v[0] > 0 && v[1] > 0 && v[2] > 0)) return undefined
  return [v[0] / v[1], 1, v[2] / v[1]]
}

/**
 * Color info for the engine. `cam_xyz` (XYZ → camera) drives Kelvin white balance;
 * `rgb_cam` maps white-balanced camera RGB to linear sRGB. When one is missing we
 * derive it from the other, following how LibRaw builds rgb_cam from cam_xyz.
 */
export function librawColor(m: Metadata): RawColorInfo {
  const c = m.color_data
  const shotMul = normGreen(c?.cam_mul) ?? normGreen(c?.pre_mul) ?? [1, 1, 1]
  const preMul = normGreen(c?.pre_mul) ?? [1, 1, 1]
  let camXyz = (c?.cam_xyz ?? []).slice(0, 3).flat()
  let rgbCam = (c?.rgb_cam ?? []).slice(0, 3).flatMap((r) => r.slice(0, 3))
  const xyzOk = valid(camXyz), rgbOk = valid(rgbCam)
  if (xyzOk && !rgbOk) rgbCam = rgbCamFromCamXyz(camXyz as Mat3)
  else if (!xyzOk) {
    // LibRaw: rgb_cam = inverse(row-normalized cam_xyz · sRGB→XYZ), rows normalized by 1/pre_mul.
    const r = rgbOk ? (rgbCam as Mat3) : IDENTITY
    camXyz = mul(diag([1 / preMul[0], 1 / preMul[1], 1 / preMul[2]]), mul(inv(r), XYZ_TO_SRGB))
    rgbCam = r
  }
  return { rgbCam, camXyz, shotMul, asShot: tempTintFromMultipliers(camXyz as Mat3, shotMul) }
}
