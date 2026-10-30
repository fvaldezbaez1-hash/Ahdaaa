import { useSyncExternalStore } from 'react'
import { useMediaQuery } from '../ui/hooks'
import type { Histogram, ViewMode } from '../engine/types'
import type { MaskKind } from './masks/model'

// UI state of the editing screen that several parts share (toolbar, stage,
// panels) but that isn't part of the photo's recipe. The stage subscribes
// directly so changes repaint without re-rendering React.

export type Tool = 'crop' | 'mask' | 'heal' | null

export interface BrushSettings {
  /** 0…100, see masks/brush.ts sizeToRadius. */
  size: number
  feather: number
  /** 1…100 % per dab. */
  flow: number
  erase: boolean
}

export interface HealSettings {
  size: number
  feather: number
  /** 1…100 %. */
  opacity: number
  mode: 'heal' | 'clone'
}
export type SheetId = 'export' | 'paste' | 'shortcuts' | null

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
  sheet: SheetId
  /** The AI assistant replaces the adjustments column (desktop) or covers the editor (phone). */
  ai: boolean
  /** Desktop: the presets & history column, shown by default only on wide screens. */
  leftPanel: { wide: boolean; narrow: boolean }
  /** Masking: the selected local layer and the mask whose handles are shown. */
  layer: string | null
  mask: string | null
  /** Tint the selected layer's mask red (O). */
  overlay: boolean
  /** The next drag on the photo draws this new gradient (instead of editing it). */
  placing: MaskKind | null
  /** Range mask: the next click on the photo samples a color / brightness. */
  rangePick: boolean
  brush: BrushSettings
  /** Healing: settings for new spots, and the selected spot. */
  heal: HealSettings
  spot: string | null
}

const initial: ViewState = {
  mode: 'after', split: 0.5, holding: false, clipping: false, tool: null, eyedropper: false, leveling: false, grid: 'none', zoom: 1, zoom100: 1, histogram: null,
  sheet: null, ai: false, leftPanel: { wide: true, narrow: false },
  layer: null, mask: null, overlay: true, placing: null, rangePick: false, spot: null,
  brush: { size: 50, feather: 50, flow: 100, erase: false },
  heal: { size: 40, feather: 50, opacity: 100, mode: 'heal' },
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
  /** Fresh state for a newly opened photo (keeps the compare mode, clipping, panel and brush choices). */
  reset() {
    const { split, clipping, ai, leftPanel, overlay, brush, heal } = state
    view.set({ ...initial, mode: state.mode === 'before' ? 'after' : state.mode, split, clipping, ai, leftPanel, overlay, brush, heal })
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

/** The presets column: open by default on wide screens, closed below 1200 px (each remembered separately). */
export function useLeftPanel(): [boolean, () => void] {
  const wide = useMediaQuery('(min-width: 1200px)')
  const pref = useView((s) => s.leftPanel)
  const open = wide ? pref.wide : pref.narrow
  return [open, () => view.set({ leftPanel: wide ? { ...pref, wide: !open } : { ...pref, narrow: !open } })]
}
