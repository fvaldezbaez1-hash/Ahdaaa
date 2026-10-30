import { useEffect } from 'react'
import { DEFAULT_PARTS, makeClipboard } from '../library/edits'
import { editor } from '../state/editor'
import { loadSettings, updateSettings } from '../state/settings'
import { isTyping } from '../ui/hooks'
import { toast } from '../ui/toast'
import { cancelCrop, enterCrop, finishCrop, isCropping, rotateQuick } from './crop/cropTool'
import { deleteRetouch } from './ai/actions'
import { deleteMask, deleteSpot, enterHeal, enterMasks, exitTool, nudgeSize } from './masks/modes'
import { neighbor, openPhoto, type StripItem } from './photos'
import type { Session } from './session'
import { stageControl } from './stage/stageView'
import { view } from './view'

/** Every editor shortcut, for the "?" sheet (and Settings). */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '⌘Z / Ctrl+Z', action: 'Undo' },
  { keys: '⇧⌘Z / Ctrl+Y', action: 'Redo' },
  { keys: '\\', action: 'Show the original (toggle)' },
  { keys: 'Y', action: 'Split before | after' },
  { keys: 'C', action: 'Crop & straighten' },
  { keys: '[ / ]', action: 'Rotate left / right 90° (brush or spot size while masking or healing)' },
  { keys: 'Enter / Esc', action: 'Apply / cancel the crop; leave masking or healing' },
  { keys: 'M', action: 'Masks' },
  { keys: 'O', action: 'Show the mask overlay' },
  { keys: 'Q', action: 'Heal & clone' },
  { keys: '⇧Q', action: 'Remove objects (AI)' },
  { keys: 'Alt + paint', action: 'Erase from a brush mask' },
  { keys: 'Space + drag', action: 'Move the photo while masking or healing' },
  { keys: 'Backspace', action: 'Delete the selected heal spot or mask' },
  { keys: 'W', action: 'White balance picker' },
  { keys: 'J', action: 'Show clipping' },
  { keys: 'Z', action: 'Zoom Fit ↔ 100%' },
  { keys: '← / →', action: 'Previous / next photo' },
  { keys: '⌘C / Ctrl+C', action: 'Copy settings' },
  { keys: '⌘V / Ctrl+V', action: 'Paste settings…' },
  { keys: 'R (on a slider)', action: 'Reset that slider' },
  { keys: 'Alt + drag', action: 'Fine slider / wheel control' },
  { keys: '?', action: 'This list' },
]

/** Keys that belong to the focused control, not to the editor. */
function ownsKey(t: EventTarget | null, key: string): boolean {
  const el = t as HTMLElement | null
  if (!el?.closest) return false
  if (el.closest('input, select, textarea, [role="slider"], [role="radiogroup"], .ed-crop-box')) return key.startsWith('Arrow') || key === 'Enter'
  return key === 'Enter' && !!el.closest('button, a')
}

export async function copySettings(session: Session) {
  const { recipe, kind } = editor.getState()
  if (!recipe) return
  const prev = (await loadSettings()).clipboard
  await updateSettings({ clipboard: makeClipboard({ recipe, kind, raw: session.record.raw }, (prev?.parts as typeof DEFAULT_PARTS) ?? DEFAULT_PARTS) })
  toast('Settings copied. Open another photo and press ⌘V to paste.')
}

export function useEditorShortcuts(session: Session | null, order: StripItem[] | undefined) {
  useEffect(() => {
    if (!session) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e) || document.querySelector('[aria-modal="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      const v = view.get()
      const cropping = isCropping()
      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }

      if (mod && !e.altKey) {
        const k = key.toLowerCase()
        if (k === 'z' && !cropping) return run(e.shiftKey ? editor.redo : editor.undo)
        if (k === 'y' && !cropping) return run(editor.redo)
        if (k === 'c' && !e.shiftKey && !window.getSelection()?.toString()) return run(() => void copySettings(session))
        if (k === 'v' && !e.shiftKey) return run(() => view.set({ sheet: 'paste' }))
        return
      }
      if (e.altKey || ownsKey(e.target, key)) return

      const tool = v.tool === 'mask' || v.tool === 'heal'
      if (key === 'Escape') {
        if (v.eyedropper) return run(() => view.set({ eyedropper: false }))
        if (v.leveling) return run(() => view.set({ leveling: false }))
        if (cropping) return run(cancelCrop)
        if (v.rangePick || v.placing) return run(() => view.set({ rangePick: false, placing: null }))
        if (tool) return run(exitTool)
        return
      }
      if (cropping && key === 'Enter') return run(finishCrop)
      if (tool && key === 'Enter') return run(exitTool)
      if (tool && (key === '[' || key === ']')) return run(() => nudgeSize(key === ']' ? 1 : -1))
      if (tool && (key === 'Backspace' || key === 'Delete')) {
        if (v.tool === 'heal' && v.spot) return run(() => (v.heal.mode === 'remove' ? deleteRetouch(v.spot!, 'Delete removal') : deleteSpot(v.spot)))
        if (v.tool === 'mask' && v.layer && v.mask) return run(() => deleteMask(v.layer!, v.mask!))
        return
      }
      if (e.repeat) return
      switch (key) {
        case '\\':
          return run(() => view.set({ mode: v.mode === 'before' ? 'after' : 'before' }))
        case 'y':
        case 'Y':
          return run(() => view.set({ mode: v.mode === 'split' ? 'after' : 'split' }))
        case 'c':
        case 'C':
          return run(() => (cropping ? finishCrop() : enterCrop({ w: session.record.width, h: session.record.height })))
        case '[':
        case ']':
          if (!cropping) run(() => rotateQuick(key === ']' ? 1 : -1))
          return
        case 'w':
        case 'W':
          if (!cropping) run(() => view.set({ eyedropper: !v.eyedropper }))
          return
        case 'm':
        case 'M':
          return run(() => (v.tool === 'mask' ? exitTool() : enterMasks()))
        case 'q':
        case 'Q':
          // Shift+Q: AI Remove; Q: heal & clone.
          if (e.shiftKey) return run(() => (v.tool === 'heal' && v.heal.mode === 'remove' ? exitTool() : enterHeal('remove')))
          return run(() => (v.tool === 'heal' && v.heal.mode !== 'remove' ? exitTool() : enterHeal(v.heal.mode === 'remove' ? 'heal' : undefined)))
        case 'o':
        case 'O':
          return run(() => view.set({ overlay: !v.overlay }))
        case 'j':
        case 'J':
          return run(() => view.set({ clipping: !v.clipping }))
        case 'z':
        case 'Z':
          return run(stageControl.toggleZoom)
        case '?':
          return run(() => view.set({ sheet: 'shortcuts' }))
        case 'ArrowLeft':
        case 'ArrowRight': {
          const next = neighbor(order, session.id, key === 'ArrowRight' ? 1 : -1)
          if (next) run(() => openPhoto(next))
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, order])
}
