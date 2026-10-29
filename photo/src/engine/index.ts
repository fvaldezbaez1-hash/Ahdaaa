// Public entry of the render engine. OWNER: engine agent — replace this stub
// with the WebGL2 implementation (keep the `createEngine` signature).
import type { Engine } from './types'

export type { Engine } from './types'

export function createEngine(_canvas: HTMLCanvasElement | OffscreenCanvas): Engine {
  throw new Error('Render engine not implemented yet')
}
