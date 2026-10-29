// Browser-decodable images (JPEG, PNG, WebP, AVIF, GIF, BMP, HEIC on Safari) →
// linear 16-bit RGB. The bitmap is read back through a short canvas strip, so
// the canvas never exceeds platform limits (iOS ≈ 16.7 MP) and only the
// downscaled result is held at full precision. Runs in the IO worker.
import type { SourceImage } from '../../engine/types'
import { AreaResampler, fitLongEdge, type Size } from './resample'
import { srgb8ToLinearLut } from './srgb'

export interface DecodedPixels {
  image: SourceImage
  /** Oriented size of the original. */
  fullWidth: number
  fullHeight: number
}

/** Output size: fits maxLongEdge and stays within maxPixels. */
export function targetSize(width: number, height: number, maxLongEdge: number | undefined, maxPixels: number): Size {
  const t = fitLongEdge(width, height, maxLongEdge)
  if (t.width * t.height <= maxPixels) return t
  const s = Math.sqrt(maxPixels / (t.width * t.height))
  return { width: Math.max(1, Math.floor(t.width * s)), height: Math.max(1, Math.floor(t.height * s)) }
}

const STRIP_PIXELS = 1 << 22

export async function bitmapToLinear(bitmap: ImageBitmap, maxLongEdge: number | undefined, maxPixels: number): Promise<DecodedPixels> {
  const fullWidth = bitmap.width, fullHeight = bitmap.height
  const target = targetSize(fullWidth, fullHeight, maxLongEdge, maxPixels)
  let src = bitmap
  // Big reductions: let the browser halve-and-more first (cheap, on the GPU),
  // then finish the last ≤2× in linear light so edges and highlights stay right.
  if (target.width * 2 < fullWidth) {
    src = await createImageBitmap(bitmap, { resizeWidth: target.width * 2, resizeHeight: target.height * 2, resizeQuality: 'high' })
    bitmap.close()
  }
  const w = src.width, h = src.height
  const stripH = Math.max(1, Math.min(h, Math.floor(STRIP_PIXELS / w)))
  const canvas = new OffscreenCanvas(w, stripH)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.fillStyle = '#fff' // transparent areas become white, like an image on paper
  const lut = srgb8ToLinearLut()
  const scale = w !== target.width || h !== target.height
  const resampler = scale ? new AreaResampler(w, h, target.width, target.height) : null
  const out = resampler ? resampler.out : new Uint16Array(w * h * 3)
  const row = new Float32Array(w * 3)
  for (let y0 = 0; y0 < h; y0 += stripH) {
    const rows = Math.min(stripH, h - y0)
    ctx.fillRect(0, 0, w, rows)
    ctx.drawImage(src, 0, y0, w, rows, 0, 0, w, rows)
    const px = ctx.getImageData(0, 0, w, rows).data
    for (let r = 0; r < rows; r++) {
      if (resampler) {
        for (let x = 0, i = r * w * 4; x < w; x++, i += 4) {
          row[x * 3] = lut[px[i]]
          row[x * 3 + 1] = lut[px[i + 1]]
          row[x * 3 + 2] = lut[px[i + 2]]
        }
        resampler.pushRow(row, 0)
      } else {
        for (let x = 0, i = r * w * 4, o = (y0 + r) * w * 3; x < w; x++, i += 4, o += 3) {
          out[o] = Math.round(lut[px[i]])
          out[o + 1] = Math.round(lut[px[i + 1]])
          out[o + 2] = Math.round(lut[px[i + 2]])
        }
      }
    }
  }
  src.close()
  return { image: { width: target.width, height: target.height, data: out }, fullWidth, fullHeight }
}
