// Decode any supported file into the engine's linear 16-bit input.
//   RAW:  LibRaw → rawler → the camera's embedded JPEG preview (last resort)
//   TIFF: utif2 in the IO worker
//   rest: the browser's decoder in the IO worker (main-thread <img> fallback for HEIC on Safari)
import type { Mat3 } from '../color/matrices'
import { abortError, isAbort } from './abort'
import { extOf, isRawName } from './formats'
import { maxDecodePixels } from './platform'
import { librawDecode, librawUsable } from './raw/libraw'
import { rawlerAvailable, rawlerDecode } from './raw/rawler'
import { BackendUnavailable, type RawDecodeResult } from './raw/types'
import type { DecodedPhoto } from './types'
import { work } from './worker'

export interface DecodeRequest {
  fileName: string
  quality: 'preview' | 'full'
  maxLongEdge?: number
  signal?: AbortSignal
  /** Oriented full-resolution size when already known (library records): picks RAW half-size decoding without probing. */
  fullSize?: { width: number; height: number }
  /** The library shows this RAW through its embedded preview; keep it that way so its recipe still fits. */
  previewOnly?: boolean
}

export const NOTICE_NO_RAW_DECODER = "Full RAW processing isn't available on this device yet — you're editing the camera's built-in JPEG preview."
export const NOTICE_RAW_UNSUPPORTED = "Lumen can't develop this camera's RAW files yet — you're editing the camera's built-in JPEG preview."
const HEIC_MESSAGE = "This browser can't open HEIC photos. Open Lumen in Safari, or export the photos as JPEG first."

export async function decodeBlob(blob: Blob, req: DecodeRequest): Promise<DecodedPhoto> {
  if (isRawName(req.fileName)) return decodeRaw(blob, req)
  const args = { blob, maxLongEdge: req.maxLongEdge, maxPixels: maxDecodePixels() }
  const ext = extOf(req.fileName)
  let d
  if (ext === 'tif' || ext === 'tiff') {
    try {
      d = await work('decodeTiff', args, [], req.signal)
    } catch (e) {
      if (isAbort(e)) throw e
      throw new Error(`Couldn't read this TIFF: ${(e as Error).message}`)
    }
  } else {
    try {
      d = await work('decodeImage', args, [], req.signal)
    } catch (e) {
      if (isAbort(e)) throw e
      // Safari can decode HEIC in an <img> even where worker decoding fails.
      const bitmap = await bitmapFromImgElement(blob).catch(() => undefined)
      if (!bitmap) throw new Error(ext === 'heic' || ext === 'heif' ? HEIC_MESSAGE : "Couldn't open this image. The file may be damaged or in a format this browser can't read.")
      d = await work('decodeImage', { ...args, bitmap }, [bitmap], req.signal)
    }
  }
  return { image: d.image, color: { kind: 'display', space: 'srgb-linear' }, fullWidth: d.fullWidth, fullHeight: d.fullHeight, meta: d.meta, kind: 'display' }
}

async function bitmapFromImgElement(blob: Blob): Promise<ImageBitmap> {
  if (typeof document === 'undefined') throw new Error('No DOM')
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await createImageBitmap(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function decodeRaw(blob: Blob, req: DecodeRequest): Promise<DecodedPhoto> {
  const { maxLongEdge, fullSize, signal } = req
  const half: boolean | 'auto' =
    req.quality === 'preview' || (!!maxLongEdge && !!fullSize && Math.max(fullSize.width, fullSize.height) / 2 >= maxLongEdge) ? true : maxLongEdge && !fullSize ? 'auto' : false
  let r: RawDecodeResult | undefined
  let fileError: Error | undefined
  if (!req.previewOnly) {
    if (librawUsable()) {
      try {
        r = await librawDecode(blob, { halfSize: half, maxLongEdge, signal })
      } catch (e) {
        if (isAbort(e)) throw e
        if (!(e instanceof BackendUnavailable)) fileError = e as Error
      }
    }
    if (!r) {
      try {
        r = await rawlerDecode(blob, req.fileName, half === true, signal)
      } catch (e) {
        if (isAbort(e)) throw e
        fileError ??= e as Error
      }
    }
  }
  if (signal?.aborted) throw abortError()
  if (r) {
    let image = { width: r.width, height: r.height, data: r.data }
    if (maxLongEdge && Math.max(r.width, r.height) > maxLongEdge) image = await work('resample', { image, maxLongEdge }, [r.data.buffer], signal)
    return {
      image,
      color: { kind: 'raw', space: 'camera', rgbCam: r.raw.rgbCam as Mat3, camXyz: r.raw.camXyz as Mat3, shotMul: r.raw.shotMul },
      fullWidth: r.fullWidth,
      fullHeight: r.fullHeight,
      meta: r.meta,
      kind: 'raw',
      raw: r.raw,
    }
  }
  try {
    const d = await work('embeddedPreview', { blob, maxLongEdge, maxPixels: maxDecodePixels() }, [], signal)
    const decoderExists = librawUsable() || (await rawlerAvailable())
    return {
      image: d.image,
      color: { kind: 'display', space: 'srgb-linear' },
      fullWidth: d.fullWidth,
      fullHeight: d.fullHeight,
      meta: d.meta,
      kind: 'display',
      previewOnly: true,
      notice: decoderExists && !req.previewOnly ? NOTICE_RAW_UNSUPPORTED : NOTICE_NO_RAW_DECODER,
    }
  } catch (e) {
    if (isAbort(e)) throw e
    const detail = fileError?.message ? ` (${fileError.message})` : ''
    throw new Error(`This RAW format isn't supported yet: .${extOf(req.fileName).toUpperCase()}${detail}`)
  }
}
