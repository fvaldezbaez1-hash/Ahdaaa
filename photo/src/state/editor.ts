import { useSyncExternalStore } from 'react'
import { defaultRecipe } from '../edit/defaults'
import type { EditRecipe, SourceKind } from '../edit/types'

// The photo being edited, its recipe, and undo/redo — shared by the editor
// panels, presets and the AI assistant. A slider drag calls `preview` on every
// move (no history) and `commit` on release (one undo step).

export interface HistoryEntry {
  label: string
  at: number
}

export interface EditorState {
  photoId: string | null
  kind: SourceKind
  asShot?: { temp: number; tint: number }
  recipe: EditRecipe | null
  /** Newest first, for the History panel. */
  history: HistoryEntry[]
  canUndo: boolean
  canRedo: boolean
  /** Increments on every committed change (persistence listens to this). */
  version: number
}

const MAX_UNDO = 200
/** Undo steps kept across reloads (the in-memory limit is MAX_UNDO). */
const KEPT_UNDO = 50

/** The undo / redo steps of the open photo, as saved for the next session. */
export interface UndoSnapshot {
  photoId: string
  /** The recipe the steps lead to: they're only restored onto this exact recipe. */
  recipe: EditRecipe
  past: EditRecipe[]
  future: EditRecipe[]
  history: HistoryEntry[]
}

let state: EditorState = { photoId: null, kind: 'raw', recipe: null, history: [], canUndo: false, canRedo: false, version: 0 }
let past: EditRecipe[] = []
let future: EditRecipe[] = []
let gestureStart: EditRecipe | null = null
const listeners = new Set<() => void>()

function emit(patch: Partial<EditorState>) {
  state = { ...state, ...patch, canUndo: past.length > 0, canRedo: future.length > 0 }
  listeners.forEach((l) => l())
}

function pushHistory(label: string): HistoryEntry[] {
  return [{ label, at: Date.now() }, ...state.history].slice(0, 100)
}

export const editor = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  open(photoId: string, recipe: EditRecipe, kind: SourceKind, asShot?: { temp: number; tint: number }) {
    past = []
    future = []
    gestureStart = null
    emit({ photoId, recipe, kind, asShot, history: [{ label: 'Opened', at: Date.now() }], version: state.version + 1 })
  },

  close() {
    past = []
    future = []
    gestureStart = null
    emit({ photoId: null, recipe: null, history: [] })
  },

  /** Live change while dragging: re-render, but don't add an undo step yet. */
  preview(update: (r: EditRecipe) => EditRecipe) {
    if (!state.recipe) return
    if (!gestureStart) gestureStart = state.recipe
    emit({ recipe: update(state.recipe) })
  },

  /** End a preview gesture as one undo step. No-op if nothing changed. */
  commit(label: string) {
    if (!state.recipe || !gestureStart) return
    const before = gestureStart
    gestureStart = null
    if (JSON.stringify(before) === JSON.stringify(state.recipe)) return
    past = [...past, before].slice(-MAX_UNDO)
    future = []
    emit({ history: pushHistory(label), version: state.version + 1 })
  },

  /** The newest undo / redo steps of the open photo, to save for the next session. */
  snapshot(): UndoSnapshot | null {
    if (!state.photoId || !state.recipe) return null
    return { photoId: state.photoId, recipe: state.recipe, past: past.slice(-KEPT_UNDO), future: future.slice(0, KEPT_UNDO), history: state.history.slice(0, KEPT_UNDO + 1) }
  },

  /** Bring back saved steps right after open(), if they lead to exactly the recipe that's open. */
  restore(s: UndoSnapshot) {
    if (s.photoId !== state.photoId || !state.recipe || gestureStart || past.length || future.length) return
    if (JSON.stringify(s.recipe) !== JSON.stringify(state.recipe)) return
    past = s.past.slice()
    future = s.future.slice()
    emit({ history: s.history })
  },

  /** A complete change (button, preset, AI) as one undo step. */
  apply(update: (r: EditRecipe) => EditRecipe, label: string) {
    if (!state.recipe) return
    const before = gestureStart ?? state.recipe
    gestureStart = null
    const next = update(state.recipe)
    if (JSON.stringify(before) === JSON.stringify(next)) return
    past = [...past, before].slice(-MAX_UNDO)
    future = []
    emit({ recipe: next, history: pushHistory(label), version: state.version + 1 })
  },

  undo() {
    if (!state.recipe || past.length === 0) return
    gestureStart = null
    future = [state.recipe, ...future]
    const prev = past[past.length - 1]
    past = past.slice(0, -1)
    emit({ recipe: prev, history: pushHistory('Undo'), version: state.version + 1 })
  },

  redo() {
    if (!state.recipe || future.length === 0) return
    gestureStart = null
    past = [...past, state.recipe]
    const next = future[0]
    future = future.slice(1)
    emit({ recipe: next, history: pushHistory('Redo'), version: state.version + 1 })
  },

  /** Back to the as-imported settings (keeps crop unless `all`). */
  reset(all = true) {
    if (!state.recipe) return
    const d = defaultRecipe(state.kind, state.asShot)
    editor.apply((r) => (all ? d : { ...d, geometry: r.geometry }), all ? 'Reset all' : 'Reset adjustments')
  },
}

/** Subscribe a component to part of the editor state. */
export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => select(state), () => select(state))
}
