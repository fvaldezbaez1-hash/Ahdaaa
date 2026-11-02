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

type Sized = Pick<PhotoRecord, 'width' | 'height' | 'recipe'> & { id?: string }

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

/**
 * Full-size JPEG bytes per pixel relative to the photo's own thumbnail (512 px, quality 82) at
 * quality 92. Measured: ≈0.7–0.8 for smooth photos and gradients, ≈1.15 for detailed camera files.
 */
const THUMB_TO_FULL_AT_92 = 1

/**
 * Estimated total size. JPEG uses each photo's thumbnail (bytes per pixel, from `thumbBpp`) as a
 * measure of how much detail it has, so a smooth gradient isn't priced like a forest; without a
 * thumbnail it falls back to the typical-photo rate. PNG and TIFF use the typical rates.
 */
export function estimateBytes(photos: readonly Sized[], opts: Pick<ExportOptions, 'format' | 'quality' | 'longEdge'>, thumbBpp?: ReadonlyMap<string, number>): number {
  const typical = bytesPerPixel(opts.format, opts.quality)
  const scale = THUMB_TO_FULL_AT_92 * (typical / bytesPerPixel('jpeg', 92))
  let total = 0
  for (const p of photos) {
    const { width, height } = outputSize(p, opts.longEdge)
    const t = opts.format === 'jpeg' && p.id ? thumbBpp?.get(p.id) : undefined
    total += width * height * (t ? Math.min(typical, t * scale) : typical)
  }
  return total
}

/** The name export gives the file: "IMG_0001.CR3" → "IMG_0001-lumen.jpg". */
export function exportName(fileName: string, format: ExportFormat): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  return `${base}-lumen.${FORMATS.find((f) => f.value === format)?.ext ?? 'jpg'}`
}
