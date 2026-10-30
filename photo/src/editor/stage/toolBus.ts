// The stage owns pointer input (so two fingers always pan and zoom); while a
// photo tool is active it hands single-pointer gestures to that tool.

export interface ToolPointer {
  /** CSS px inside the photo box. */
  x: number
  y: number
  /** The photo box size (CSS px). */
  box: { w: number; h: number }
  /** Client coordinates, for sampling the canvas. */
  clientX: number
  clientY: number
  alt: boolean
  shift: boolean
  touch: boolean
}

export interface StageTool {
  /** True when the tool takes this gesture (no hold-to-compare or panning then). */
  down(p: ToolPointer): boolean
  move(p: ToolPointer): void
  up(p: ToolPointer): void
  /** A second finger arrived: undo the half-done gesture. */
  cancel(): void
  /** Pointer moving without a button (null = left the photo), for the brush ring. */
  hover(p: ToolPointer | null): void
}

let current: StageTool | null = null

export const toolBus = {
  set(t: StageTool | null) {
    current = t
  },
  get: () => current,
}
