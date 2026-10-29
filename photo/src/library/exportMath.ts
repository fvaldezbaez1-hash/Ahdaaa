// Export sizing and a rough file-size estimate shown before exporting.
import type { ExportFormat, ExportOptions, PhotoRecord } from '../io/types'

export const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'jpeg', label: 'JPEG', ext: 'jpg' },
  { value: 'png', label: 'PNG', ext: 'png' },
  { value: 'tiff16', label: 'TIFF 16-bit', ext: 'tif' },
]

export type SizeChoice = 'full' | '3840' | '2048' | '1080' | 'custom'

export const SIZE_CHOICES: { value: SizeChoice; label: string }[] = [
  { value: 'full', label: 'Full resolution' },
  { value: '3840', label: 'Long edge 3840 px (4K)' },
  { value: '2048', label: 'Long edge 2048 px (web)' },
  { value: '1080', label: 'Long edge 1080 px (social)' },
  { value: 'custom', label: 'Custom…' },
]

export function sizeChoiceOf(longEdge: number | undefined): SizeChoice {
  if (!longEdge) return 'full'
  const preset = SIZE_CHOICES.find((s) => s.value === String(longEdge))
  return preset ? preset.value : 'custom'
}

type Sized = Pick<PhotoRecord, 'width' | 'height' | 'recipe'>

/** Pixel size of the exported file: crop and quarter turns applied, scaled down (never up) to `longEdge`. */
export function outputSize(p: Sized, longEdge?: number): { width: number; height: number } {
  const g = p.recipe?.geometry
  let w = Math.max(1, Math.round(p.width * (g?.crop.w ?? 1)))
  let h = Math.max(1, Math.round(p.height * (g?.crop.h ?? 1)))
  if (g && g.rotate % 2 === 1) [w, h] = [h, w]
  const long = Math.max(w, h)
  if (longEdge && longEdge < long) {
    const s = longEdge / long
    w = Math.max(1, Math.round(w * s))
    h = Math.max(1, Math.round(h * s))
  }
  return { width: w, height: h }
}

/**
 * Typical bytes per pixel for a photo. JPEG grows steeply with quality
 * (≈0.25 B/px at 80, ≈0.5 at 92, ≈0.8 at 100); PNG compresses photos poorly;
 * 16-bit TIFF is stored uncompressed (3 channels × 2 bytes).
 */
export function bytesPerPixel(format: ExportFormat, quality: number): number {
  if (format === 'png') return 2
  if (format === 'tiff16') return 6
  const q = Math.min(100, Math.max(1, quality)) / 100
  return 0.05 + 0.75 * q ** 6
}

export function estimateBytes(photos: readonly Sized[], opts: Pick<ExportOptions, 'format' | 'quality' | 'longEdge'>): number {
  const bpp = bytesPerPixel(opts.format, opts.quality)
  let total = 0
  for (const p of photos) {
    const { width, height } = outputSize(p, opts.longEdge)
    total += width * height * bpp
  }
  return total
}

/** "IMG_0001.CR3" → "IMG_0001.jpg". */
export function exportName(fileName: string, format: ExportFormat): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  return `${base}.${FORMATS.find((f) => f.value === format)?.ext ?? 'jpg'}`
}
