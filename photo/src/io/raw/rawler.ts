// RAW backend 2: a single-threaded Rust/WASM decoder for browsers where LibRaw
// can't run (iOS Safari). It lives in src/io/rawler/ and isn't built yet; the
// glob import resolves to nothing until that module exists, so this backend
// simply reports "unavailable" meanwhile.
import type { Mat3, Vec3 } from '../../color/matrices'
import { rgbCamFromCamXyz, tempTintFromMultipliers } from '../../color/wb'
import { dropUndefined } from '../decode/exif'
import type { PhotoMeta } from '../types'
import type { RawDecodeResult } from './types'

interface RawlerResult {
  width: number
  height: number
  /** Oriented linear camera RGB, black-subtracted, as-shot WB applied, white = 65535. */
  data: Uint16Array
  /** 3×3 row-major XYZ → camera. */
  camXyz: number[]
  /** Green = 1. */
  shotMul: [number, number, number]
  meta: Pick<PhotoMeta, 'make' | 'model' | 'lens' | 'iso' | 'shutter' | 'aperture' | 'focalLength' | 'takenAt'>
}

interface RawlerModule {
  rawlerSupported(): boolean
  rawlerCanDecode(fileName: string, head: Uint8Array): boolean
  decodeWithRawler(bytes: ArrayBuffer, opts?: { halfSize?: boolean; signal?: AbortSignal }): Promise<RawlerResult>
}

const loaders = import.meta.glob<RawlerModule>('../rawler/index.ts')

async function load(): Promise<RawlerModule | undefined> {
  const loader = Object.values(loaders)[0]
  if (!loader) return undefined
  try {
    const mod = await loader()
    return mod.rawlerSupported() ? mod : undefined
  } catch {
    return undefined
  }
}

export async function rawlerAvailable(): Promise<boolean> {
  return !!(await load())
}

/** Undefined when the backend is missing or doesn't handle this file. */
export async function rawlerDecode(blob: Blob, fileName: string, halfSize: boolean, signal?: AbortSignal): Promise<RawDecodeResult | undefined> {
  const mod = await load()
  if (!mod) return undefined
  const bytes = await blob.arrayBuffer()
  if (!mod.rawlerCanDecode(fileName, new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536)))) return undefined
  const r = await mod.decodeWithRawler(bytes, { halfSize, signal })
  const camXyz = r.camXyz as Mat3
  const shotMul: Vec3 = [r.shotMul[0], r.shotMul[1], r.shotMul[2]]
  return {
    width: r.width,
    height: r.height,
    data: r.data,
    // Half-size output is exactly half (rounded down) of the sensor area.
    fullWidth: halfSize ? r.width * 2 : r.width,
    fullHeight: halfSize ? r.height * 2 : r.height,
    meta: dropUndefined({ ...r.meta }),
    raw: { rgbCam: rgbCamFromCamXyz(camXyz), camXyz, shotMul, asShot: tempTintFromMultipliers(camXyz, shotMul) },
  }
}
