import { useSyncExternalStore } from 'react'
import type { Histogram, ViewMode } from '../engine/types'

// UI state of the editing screen that several parts share (toolbar, stage,
// panels) but that isn't part of the photo's recipe. The stage subscribes
// directly so changes repaint without re-rendering React.

export type Tool = 'crop' | null

export interface ViewState {
  mode: ViewMode
  /** Split position 0…1 (before on the left). */
  split: number
  /** Pressing the photo (or holding \) shows the original. */
  holding: boolean
  clipping: boolean
  tool: Tool
  eyedropper: boolean
  /** Crop tool: drawing a line to level the horizon. */
  leveling: boolean
  /** Crop tool: show the fine grid while straightening or dragging. */
  grid: 'none' | 'thirds' | 'fine'
  /** Zoom relative to "fit" (1 = whole photo visible). */
  zoom: number
  /** The zoom at which one photo pixel covers one screen pixel (set by the stage). */
  zoom100: number
  /** Histogram of the last full render. */
  histogram: Histogram | null
}

const initial: ViewState = {
  mode: 'after', split: 0.5, holding: false, clipping: false, tool: null, eyedropper: false, leveling: false, grid: 'none', zoom: 1, zoom100: 1, histogram: null,
}

let state = initial
const listeners = new Set<() => void>()

export const view = {
  get: () => state,
  set(patch: Partial<ViewState>) {
    let changed = false
    for (const k in patch) if (patch[k as keyof ViewState] !== state[k as keyof ViewState]) changed = true
    if (!changed) return
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  /** Fresh state for a newly opened photo (keeps the compare mode and clipping preference). */
  reset() {
    view.set({ ...initial, mode: state.mode === 'before' ? 'after' : state.mode, split: state.split, clipping: state.clipping })
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

export function useView<T>(select: (s: ViewState) => T): T {
  return useSyncExternalStore(view.subscribe, () => select(state), () => select(initial))
}
