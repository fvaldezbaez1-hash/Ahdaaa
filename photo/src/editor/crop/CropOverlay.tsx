import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useEditor } from '../../state/editor'
import { useView, view } from '../view'
import { cropFrame, finishCrop, setAngle, setCropBox } from './cropTool'
import { aspectRatio, cropToView, levelAngle, moveView, resizeView, viewSize, type Box, type Handle, type Size } from './geometry'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const LABELS: Record<Handle, string> = { nw: 'top left', n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left' }

interface Drag {
  handle: Handle | 'move'
  start: Box
  x: number
  y: number
  /** View pixels per CSS pixel. */
  scale: number
  angle: number
  frame: Size
  ratio: number | null
}

/**
 * Crop rectangle over the straightened, uncropped photo. Corners and edges
 * resize (keeping the aspect when one is set), the inside moves, and in
 * level mode a line drawn along the horizon straightens the photo.
 */
export function CropOverlay() {
  const g = useEditor((s) => s.recipe?.geometry)
  const grid = useView((s) => s.grid)
  const leveling = useView((s) => s.leveling)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  if (!g) return null
  const frame = cropFrame(g)
  const v = viewSize(frame, g.angle)
  const box = cropToView(g.crop, g.angle, frame)

  const begin = (handle: Handle | 'move') => (e: PointerEvent<HTMLElement>) => {
    if (leveling || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = root.current!.getBoundingClientRect()
    drag.current = { handle, start: box, x: e.clientX, y: e.clientY, scale: v.w / rect.width, angle: g.angle, frame, ratio: aspectRatio(g.aspect, frame) }
    view.set({ grid: 'thirds' })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!leveling || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    setLine({ x1: x, y1: y, x2: x, y2: y })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) {
      const dx = (e.clientX - d.x) * d.scale, dy = (e.clientY - d.y) * d.scale
      const min = 48 * d.scale
      setCropBox(d.handle === 'move' ? moveView(d.start, dx, dy, d.angle, d.frame) : resizeView(d.start, d.handle, dx, dy, d.ratio, d.angle, d.frame, min))
    } else if (line) {
      const rect = e.currentTarget.getBoundingClientRect()
      setLine({ ...line, x2: e.clientX - rect.left, y2: e.clientY - rect.top })
    }
  }

  const onPointerUp = () => {
    if (drag.current) {
      drag.current = null
      view.set({ grid: 'none' })
    }
    if (line) {
      if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) > 12) setAngle(levelAngle(g.angle, line.x1, line.y1, line.x2, line.y2))
      setLine(null)
      view.set({ leveling: false })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 0.05 : 0.01) * Math.min(v.w, v.h)
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (e.key in d) {
      e.preventDefault()
      setCropBox(moveView(box, d[e.key][0], d[e.key][1], g.angle, frame))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      finishCrop()
    }
  }

  const pct = (n: number, of: number) => `${(n / of) * 100}%`
  return (
    <div
      ref={root}
      className={leveling ? 'ed-crop leveling' : 'ed-crop'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="ed-crop-box"
        style={{ left: pct(box.x, v.w), top: pct(box.y, v.h), width: pct(box.w, v.w), height: pct(box.h, v.h) }}
        tabIndex={0}
        role="group"
        aria-label="Crop area. Arrow keys move it, Enter applies."
        onPointerDown={begin('move')}
        onKeyDown={onKeyDown}
      >
        <div className={`ed-crop-grid ${grid === 'none' ? 'thirds idle' : grid}`} />
        {HANDLES.map((h) => (
          <span key={h} className={`ed-handle ${h}`} aria-hidden="true" title={`Drag the ${LABELS[h]} ${h.length === 2 ? 'corner' : 'edge'}`} onPointerDown={begin(h)} />
        ))}
      </div>
      {line && (
        <svg className="ed-level-line" aria-hidden="true">
          <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          <circle cx={line.x1} cy={line.y1} r="4" />
          <circle cx={line.x2} cy={line.y2} r="4" />
        </svg>
      )}
    </div>
  )
}
