// Stored AI results (masks, removal fills, the denoised source) handed to the
// engine by id. Kept as given on the CPU; uploaded to the GPU when first used.

import type { Gpu, Texture } from './gl'
import type { RasterImage } from './types'

export interface RasterTexture {
  img: RasterImage
  tex: Texture
  /** Changes whenever the id gets new pixels (cache keys use it). */
  version: number
}

/** What the render passes need: a texture by id (masks: R8; fills: RGB16UI), or null when missing. */
export interface Rasters {
  texture(id: string): RasterTexture | null
  image(id: string): RasterImage | null
  version(id: string): number
}

let nextVersion = 1

export class RasterStore implements Rasters {
  private gpu: Gpu
  private items = new Map<string, { img: RasterImage; version: number; tex: Texture | null }>()

  constructor(gpu: Gpu, initial?: ReadonlyMap<string, RasterImage>) {
    this.gpu = gpu
    initial?.forEach((img, id) => this.set(id, img))
  }

  set(id: string, img: RasterImage | null) {
    const old = this.items.get(id)
    if (old?.tex) this.gpu.destroy(old.tex)
    if (img) this.items.set(id, { img, version: nextVersion++, tex: null })
    else this.items.delete(id)
  }

  image(id: string): RasterImage | null {
    return (id && this.items.get(id)?.img) || null
  }

  version(id: string): number {
    return this.items.get(id)?.version ?? 0
  }

  texture(id: string): RasterTexture | null {
    const it = id ? this.items.get(id) : undefined
    if (!it) return null
    if (!it.tex) {
      const { img } = it
      if (img.channels === 1) {
        const d = img.data instanceof Uint8Array ? img.data : Uint8Array.from(img.data, (v) => v >> 8)
        it.tex = this.gpu.uploadR8(d, img.width, img.height)
      } else {
        const d = img.data instanceof Uint16Array ? img.data : Uint16Array.from(img.data, (v) => v * 257)
        it.tex = this.gpu.uploadRgb16(d, img.width, 0, 0, img.width, img.height)
      }
    }
    return { img: it.img, tex: it.tex, version: it.version }
  }

  /** Forget GPU copies (context lost: they're gone already). */
  dropTextures() {
    this.items.forEach((it) => (it.tex = null))
  }

  dispose() {
    this.items.forEach((it) => this.gpu.destroy(it.tex))
    this.items.clear()
  }
}
