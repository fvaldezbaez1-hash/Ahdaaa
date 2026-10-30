// Contract between the app and the GPU render engine (src/engine/).
import type { Mat3, Vec3 } from '../color/matrices'
import type { Basic, EditRecipe, SourceKind } from '../edit/types'

/**
 * Decoded pixels, linear light, 3 channels interleaved (RGBRGB…), 0…65535 = 0…1.
 * Orientation (EXIF / RAW flip) is already applied.
 */
export interface SourceImage {
  width: number
  height: number
  data: Uint16Array
  /**
   * Width of the full-resolution original when this is a downscaled copy (working
   * image, thumbnail source). Lets pixel-sized effects (sharpening radius, noise
   * reduction, grain) look in the preview as they will in the full-size export.
   * Omit for full-resolution images.
   */
  fullWidth?: number
}

/** How to interpret a SourceImage's numbers. */
export interface SourceColor {
  kind: SourceKind
  /**
   * 'camera': RAW camera RGB with the as-shot white balance (`shotMul`) already
   * applied and clipped at 1.0. 'srgb-linear': linear sRGB (D65).
   */
  space: 'camera' | 'srgb-linear'
  /** RAW only: camera RGB (white-balanced) → linear sRGB D65 (LibRaw rgb_cam). */
  rgbCam?: Mat3
  /** RAW only: XYZ → camera RGB (LibRaw cam_xyz), for Kelvin white balance. */
  camXyz?: Mat3
  /** RAW only: as-shot multipliers baked into the data, green = 1. */
  shotMul?: Vec3
}

export type ViewMode = 'after' | 'before' | 'split'

export interface RenderOptions {
  view?: ViewMode
  /** Split position 0…1 for view 'split' (before on the left). */
  split?: number
  /** Paint clipped shadows blue and clipped highlights red. */
  showClipping?: boolean
  /** Render the whole (rotated/flipped, straightened) frame without cropping — for the crop tool. */
  uncropped?: boolean
  /** Phase 2: tint where this local layer's combined mask applies (red overlay), for the masking tools. */
  maskOverlay?: string
}

export interface Histogram {
  /** 256 bins each, of the rendered (display-encoded) image. */
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  luma: Uint32Array
  /** Fraction of pixels clipped to black / white in any channel. */
  clippedLow: number
  clippedHigh: number
}

export interface RenderedImage {
  width: number
  height: number
  /** RGBA, display-encoded (sRGB or Display P3 transfer). 8-bit: Uint8ClampedArray; 16-bit: Uint16Array. */
  data: Uint8ClampedArray | Uint16Array
  bitDepth: 8 | 16
  colorSpace: 'srgb' | 'display-p3'
}

export interface ExportRenderOptions {
  /** Downscale so the long edge is at most this many pixels. */
  maxLongEdge?: number
  bitDepth: 8 | 16
  colorSpace: 'srgb' | 'display-p3'
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export interface Engine {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  /** False if WebGL2 / float rendering is unavailable (show a friendly error). */
  readonly supported: boolean
  /** Load the working-size image for interactive editing. */
  setSource(img: SourceImage, color: SourceColor): void
  hasSource(): boolean
  /** Size in pixels of the rendered result for this recipe at working resolution (after crop/rotate). */
  outputSize(recipe: EditRecipe, opts?: { uncropped?: boolean }): { width: number; height: number }
  /** Set the drawing-buffer size (device pixels). The image is fit inside it. */
  resize(width: number, height: number): void
  /** Draw. Cheap enough to call on every slider move (coalesced to one frame by the caller). */
  render(recipe: EditRecipe, opts?: RenderOptions): void
  /** Histogram of the last render (computed on a small copy). */
  histogram(): Histogram | null
  /**
   * Average SOURCE pixel (linear, in the source's space) around a point given in
   * normalized coordinates of the last rendered frame (0…1). For the WB eyedropper.
   */
  samplePixel(nx: number, ny: number, radius?: number): Vec3 | null
  /** Suggested Auto settings for the current source (tone + white balance). */
  auto(recipe: EditRecipe): { basic: Partial<Basic>; wb?: { temp: number; tint: number } }
  /**
   * Render a recipe applied to a (usually full-resolution) source off-screen,
   * in tiles, and read back the pixels. Does not disturb the interactive view.
   */
  renderImage(recipe: EditRecipe, source: SourceImage, color: SourceColor, opts: ExportRenderOptions): Promise<RenderedImage>
  /**
   * Full-resolution pixels of the photo given to setSource (same orientation), for
   * true 100 % viewing with renderRegion. null releases them. Kept on the CPU;
   * only the visible window is uploaded.
   */
  setFullSource?(img: SourceImage | null): void
  /** Size of the result at the resolution renderRegion draws (full source if set, else working). */
  regionOutputSize?(recipe: EditRecipe, opts?: { uncropped?: boolean }): { width: number; height: number }
  /**
   * 100 % view: draw result pixels [x, x + canvas.width) × [y, y + canvas.height)
   * (coordinates in regionOutputSize, clamped to it) 1:1 into the canvas, centered when
   * smaller. Same look as render() and the export; samplePixel/histogram then refer to this window.
   */
  renderRegion?(recipe: EditRecipe, x: number, y: number, opts?: RenderOptions): void
  /**
   * Phase 2: a good place to heal the spot at (x, y) radius r from (mask coordinates):
   * nearby texture that best matches the spot's surroundings. null if none fits.
   */
  findHealSource?(recipe: EditRecipe, x: number, y: number, r: number): { sx: number; sy: number } | null
  /** WebGL context loss: re-upload the source and render again. */
  onContextRestored(cb: () => void): () => void
  dispose(): void
}
