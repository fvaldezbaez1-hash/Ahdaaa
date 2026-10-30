// Full-resolution, tiled, off-screen rendering. Each output tile is rendered
// with a margin wide enough for every neighborhood filter, from just the
// window of the source it needs (so sources larger than the GPU's texture
// limit work), through the same pipeline as the interactive view.

import type { EditRecipe } from '../edit/types'
import { frameSize, mapBounds, outputSize, outputToSource } from './geometry'
import type { Gpu } from './gl'
import { areaDownscale, atmosphericLight, boxReduce, lowResSize, resizeArea16 } from './image'
import { frameParams, toWorkingSpace } from './params'
import { retouchWindow } from './heal'
import { aiMargin, computeGuide, Luts, marginFor, needsHaze, renderFrame, scaleSource, StageCache } from './pipeline'
import { RasterStore } from './rasters'
import { applyRetouch, blendDenoised, rasterAsSource } from './retouch'
import type { ExportRenderOptions, RenderedImage, SourceColor, SourceImage } from './types'

const abortError = () => new DOMException('Export cancelled', 'AbortError')

export async function renderTiled(gpu: Gpu, recipe: EditRecipe, source: SourceImage, color: SourceColor, opts: ExportRenderOptions, tileLimit = 2048): Promise<RenderedImage> {
  const { signal } = opts
  if (signal?.aborted) throw abortError()
  const gl = gpu.gl
  const full = { width: source.width, height: source.height }
  const g = recipe.geometry
  const outFull = outputSize(full, g)
  const s = Math.min(1, (opts.maxLongEdge ?? Infinity) / Math.max(outFull.width, outFull.height))
  const out = s < 1 ? { width: Math.max(1, Math.round(outFull.width * s)), height: Math.max(1, Math.round(outFull.height * s)) } : outFull

  const params = frameParams(recipe, color)
  const lowSize = lowResSize(full.width, full.height)
  const low = areaDownscale(source, lowSize.width, lowSize.height)
  const lowTex = gpu.uploadFloat(low.data, low.width, low.height, 3)
  const air = toWorkingSpace(params.input, atmosphericLight(low))
  const guide = computeGuide(gpu, lowTex, params.input, air, needsHaze(params), 'export')
  const items = recipe.retouch ?? []
  const rasters = new RasterStore(gpu, opts.rasters)
  // AI denoise: the stored full-resolution raster, at this source's size.
  const dn = recipe.denoise
  const dnRaster = dn && dn.amount > 0 ? rasters.image(dn.raster) : null
  const denoised = dnRaster?.channels === 3 ? resizeArea16(rasterAsSource(dnRaster), full.width, full.height) : null

  // Big reductions: exact k×k box average on the CPU first, Mitchell for the remaining factor.
  const k = s <= 0.5 ? Math.floor(1 / s) : 1
  const reduced = boxReduce(source, k)
  const reducedDen = denoised ? boxReduce(denoised, k) : null
  const ratio = s * k
  const toSource = outputToSource(full, g, false, out)
  const pixelScale = s * (source.width / (source.fullWidth ?? source.width))
  const fr = frameSize(full, g)
  const frameLong = Math.max(fr.width, fr.height) * s
  const M = marginFor(pixelScale, frameLong) + aiMargin(recipe.layers ?? [], rasters, full, s)
  // The region (tile + margins) must fit a render target, and its rotated source window a texture.
  let T = Math.min(tileLimit, gpu.caps.maxTarget - 2 * M)
  while (T > 256 && ((T + 2 * M) * 1.42 + 8) / ratio + 16 > gpu.caps.maxTexture) T = Math.floor(T / 2)

  const bits = opts.bitDepth
  const data = bits === 8 ? new Uint8ClampedArray(out.width * out.height * 4) : new Uint16Array(out.width * out.height * 4)
  const cache = new StageCache(gpu)
  const luts = new Luts(gpu)
  const cols = Math.ceil(out.width / T), rows = Math.ceil(out.height / T)
  try {
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        const inner = { x: tx * T, y: ty * T, w: Math.min(T, out.width - tx * T), h: Math.min(T, out.height - ty * T) }
        const region = { x: inner.x - M, y: inner.y - M, w: inner.w + 2 * M, h: inner.h + 2 * M }
        // The source window also holds whatever the spots inside it copy from.
        const b = retouchWindow(items, full.width, full.height, mapBounds(toSource, region.x, region.y, region.x + region.w, region.y + region.h))
        const pad = 2 / ratio + 3
        const ix0 = Math.min(reduced.width - 1, Math.max(0, Math.floor(b.x0 / k - pad)))
        const iy0 = Math.min(reduced.height - 1, Math.max(0, Math.floor(b.y0 / k - pad)))
        const ix1 = Math.max(ix0 + 1, Math.min(reduced.width, Math.ceil(b.x1 / k + pad)))
        const iy1 = Math.max(iy0 + 1, Math.min(reduced.height, Math.ceil(b.y1 / k + pad)))
        const sx0 = Math.max(Math.floor(ix0 * ratio), Math.floor(b.x0 * s) - 3), sy0 = Math.max(Math.floor(iy0 * ratio), Math.floor(b.y0 * s) - 3)
        const sx1 = Math.min(Math.ceil(ix1 * ratio), Math.ceil(b.x1 * s) + 3), sy1 = Math.min(Math.ceil(iy1 * ratio), Math.ceil(b.y1 * s) + 3)
        // The source window (and its denoised twin), at the output scale.
        const window = (from: { data: Uint16Array; width: number }) => {
          const int = gpu.uploadRgb16(from.data, from.width, ix0, iy0, ix1 - ix0, iy1 - iy0)
          const w = scaleSource(gpu, int, ix0, iy0, k, ratio, { x: sx0, y: sy0, w: Math.max(1, sx1 - sx0), h: Math.max(1, sy1 - sy0) })
          gpu.destroy(int)
          return w
        }
        let scaled = window(reduced)
        if (reducedDen) {
          const d = window(reducedDen)
          const b2 = blendDenoised(gpu, scaled, d, dn!.amount / 100)
          gpu.free(d.tex)
          gpu.free(scaled.tex)
          scaled = b2
        }
        if (items.length) {
          const r = applyRetouch(gpu, scaled, items, full, rasters)
          gpu.free(scaled.tex)
          scaled = r
        }

        const target = gpu.target(inner.w, inner.h, bits === 8 ? 'rgba8' : 'rgba32f')
        renderFrame(gpu, cache, luts, {
          outSize: out, toSource, fullSize: full, src: scaled, region, inner, pixelScale, frameLong, output: opts.colorSpace, guide, air, rasters,
        }, params, target, { dither: bits === 8, clipping: false })
        const px = gpu.read(target)
        gpu.free(target)
        gpu.free(scaled.tex)
        if (gl.isContextLost()) throw new Error('The graphics context was lost during export')
        for (let y = 0; y < inner.h; y++) {
          const o = ((inner.y + y) * out.width + inner.x) * 4
          const row = px.subarray(y * inner.w * 4, (y + 1) * inner.w * 4)
          if (bits === 8) data.set(row, o)
          else for (let i = 0; i < row.length; i++) data[o + i] = Math.round(Math.min(1, Math.max(0, row[i])) * 65535)
        }
        opts.onProgress?.((ty * cols + tx + 1) / (cols * rows))
        await new Promise((r) => setTimeout(r, 0))
        if (signal?.aborted) throw abortError()
      }
  } finally {
    cache.dispose()
    luts.dispose()
    gpu.free(guide.coef)
    gpu.free(guide.haze)
    gpu.destroy(lowTex)
    rasters.dispose()
    gpu.trim()
  }
  return { width: out.width, height: out.height, data, bitDepth: bits, colorSpace: opts.colorSpace }
}
