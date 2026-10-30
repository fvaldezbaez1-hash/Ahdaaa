import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useView, view } from '../view'

/** Before | After labels and a draggable divider for the split view. */
export function CompareOverlay() {
  const mode = useView((s) => s.mode)
  const split = useView((s) => s.split)
  const holding = useView((s) => s.holding)
  const dragging = useRef(false)
  if (mode !== 'split' || holding) return null

  const move = (e: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return
    const r = e.currentTarget.parentElement!.getBoundingClientRect()
    view.set({ split: Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)) })
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!d) return
    e.preventDefault()
    view.set({ split: Math.min(0.98, Math.max(0.02, split + d * (e.shiftKey ? 0.1 : 0.02))) })
  }
  return (
    <>
      <span className="ed-badge left">Before</span>
      <span className="ed-badge right">After</span>
      <div
        className="ed-split"
        style={{ left: `${split * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Before and after divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
        }}
        onPointerMove={move}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKey}
      >
        <span className="ed-split-knob" aria-hidden="true">
          ‹ ›
        </span>
      </div>
    </>
  )
}
