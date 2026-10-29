// Plain (recipe-less) previews for when the GPU engine isn't available:
// linear camera/sRGB data → sRGB 8-bit → JPEG. Runs in the IO worker.
import { apply, type Mat3 } from '../../color/matrices'
import type { SourceImage } from '../../engine/types'
import { resampleRgb16 } from './resample'
import { linear16ToSrgb8Lut } from './srgb'

export async function rgbaToJpeg(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

/** `matrix` converts the source to linear sRGB (RAW: rgb_cam); omit for sRGB-linear sources. */
export async function linearToJpeg(image: SourceImage, matrix: Mat3 | undefined, maxLongEdge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const small = resampleRgb16(image.data, image.width, image.height, maxLongEdge)
  const enc = linear16ToSrgb8Lut()
  const rgba = new Uint8ClampedArray(small.width * small.height * 4)
  for (let i = 0, o = 0; i < small.data.length; i += 3, o += 4) {
    let r = small.data[i], g = small.data[i + 1], b = small.data[i + 2]
    if (matrix) [r, g, b] = apply(matrix, [r, g, b])
    rgba[o] = enc[Math.max(0, Math.min(65535, Math.round(r)))]
    rgba[o + 1] = enc[Math.max(0, Math.min(65535, Math.round(g)))]
    rgba[o + 2] = enc[Math.max(0, Math.min(65535, Math.round(b)))]
    rgba[o + 3] = 255
  }
  return { blob: await rgbaToJpeg(rgba, small.width, small.height, quality), width: small.width, height: small.height }
}
