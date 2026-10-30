// The IO worker: everything pixel-heavy that isn't GPU work — decoding,
// resampling, embedded RAW previews and export encoding — off the UI thread.
import type { Mat3 } from '../color/matrices'
import type { SourceImage } from '../engine/types'
import { bitmapToLinear, type DecodedPixels } from './decode/image'
import { readExif } from './decode/exif'
import { orientRgb16, swapsAxes } from './decode/orient'
import { resampleRgb16 } from './decode/resample'
import { linearToJpeg, rgbaToJpeg } from './decode/thumb'
import { decodeTiff } from './decode/tiff'
import type { ExifInput } from './encode/exif'
import { exifTiff } from './encode/exif'
import { displayP3Profile } from './encode/icc'
import { encodeJpeg } from './encode/jpeg'
import { encodePng } from './encode/png'
import { encodeTiff16 } from './encode/tiff'
import { findEmbeddedJpeg, stripApp1 } from './raw/embedded'
import type { ExportFormat, PhotoMeta } from './types'

type Decoded = DecodedPixels & { meta: PhotoMeta }

interface DecodeArgs {
  blob: Blob
  maxLongEdge?: number
  maxPixels: number
}

export interface EncodeArgs {
  format: ExportFormat
  rgba: Uint8ClampedArray<ArrayBuffer> | Uint16Array
  width: number
  height: number
  quality: number
  /** Present when metadata is kept. */
  exif?: ExifInput
  colorSpace: 'srgb' | 'display-p3'
}

const handlers = {
  async decodeImage(a: DecodeArgs & { bitmap?: ImageBitmap }): Promise<Decoded> {
    const { meta } = await readExif(a.blob)
    const bitmap = a.bitmap ?? (await createImageBitmap(a.blob, { imageOrientation: 'from-image' }))
    return { ...(await bitmapToLinear(bitmap, a.maxLongEdge, a.maxPixels)), meta }
  },

  async decodeTiff(a: DecodeArgs): Promise<Decoded> {
    const { meta } = await readExif(a.blob)
    return { ...decodeTiff(await a.blob.arrayBuffer(), a.maxLongEdge, a.maxPixels), meta }
  },

  async embeddedPreview(a: DecodeArgs): Promise<Decoded> {
    const bytes = new Uint8Array(await a.blob.arrayBuffer())
    const found = findEmbeddedJpeg(bytes)
    if (!found) throw new Error('No embedded preview')
    const jpeg = bytes.slice(found.offset, found.offset + found.length)
    // The RAW container knows the camera orientation; the preview itself rarely does.
    const container = await readExif(a.blob)
    const own = await readExif(jpeg)
    const orientation = container.orientation !== 1 ? container.orientation : own.orientation
    const meta = Object.keys(container.meta).length ? container.meta : own.meta
    const bitmap = await createImageBitmap(new Blob([stripApp1(jpeg) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
    const d = await bitmapToLinear(bitmap, a.maxLongEdge, a.maxPixels)
    const image = orientRgb16(d.image.data, d.image.width, d.image.height, orientation)
    const swap = swapsAxes(orientation)
    return { image, fullWidth: swap ? d.fullHeight : d.fullWidth, fullHeight: swap ? d.fullWidth : d.fullHeight, meta }
  },

  async resample(a: { image: SourceImage; maxLongEdge?: number }): Promise<SourceImage> {
    return resampleRgb16(a.image.data, a.image.width, a.image.height, a.maxLongEdge)
  },

  async linearToJpeg(a: { image: SourceImage; matrix?: Mat3; maxLongEdge: number; quality: number }) {
    return linearToJpeg(a.image, a.matrix, a.maxLongEdge, a.quality)
  },

  async rgbaToJpeg(a: { rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; quality: number }): Promise<Blob> {
    return rgbaToJpeg(a.rgba, a.width, a.height, a.quality)
  },

  async encode(a: EncodeArgs): Promise<Blob> {
    const icc = a.colorSpace === 'display-p3' ? displayP3Profile() : undefined
    if (a.format === 'tiff16') {
      if (!(a.rgba instanceof Uint16Array)) throw new Error('16-bit TIFF needs 16-bit pixels')
      return encodeTiff16(a.rgba, a.width, a.height, { exif: a.exif, icc })
    }
    const exif = a.exif ? exifTiff(a.exif) : undefined
    if (a.format === 'png') return encodePng(a.rgba, a.width, a.height, { exif, icc: icc && { name: 'Display P3', data: icc }, srgb: !icc })
    if (a.rgba instanceof Uint16Array) throw new Error('JPEG needs 8-bit pixels')
    return encodeJpeg(a.rgba, a.width, a.height, { quality: a.quality, exif, icc })
  },
}

export type IoOps = typeof handlers

/** Buffers in a result that can move to the main thread without copying. */
function transferables(result: unknown): Transferable[] {
  const r = result as { image?: SourceImage; data?: Uint16Array } | null
  const data = r?.image?.data ?? r?.data
  return data instanceof Uint16Array ? [data.buffer as ArrayBuffer] : []
}

self.onmessage = async (e: MessageEvent<{ id: number; op: keyof IoOps; args: never }>) => {
  const { id, op, args } = e.data
  try {
    const result = await handlers[op](args)
    self.postMessage({ id, result }, { transfer: transferables(result) })
  } catch (err) {
    const error = err instanceof Error ? { name: err.name, message: err.message } : { name: 'Error', message: String(err) }
    self.postMessage({ id, error })
  }
}
