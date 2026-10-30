import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { hueSatToPoint, pointToHueSat, WHEEL_GRADIENT, wheelColor } from '../math/wheel'

const FINE = 0.25

/**
 * Color wheel: drag sets hue (angle) and saturation (distance from the
 * center); Alt/Option for fine control, double-click or Delete to clear,
 * arrow keys for hue (←/→) and saturation (↑/↓).
 */
export function HueSatWheel({ label, value, size, onChange, onCommit, onReset }: {
  label: string
  value: { hue: number; sat: number }
  size: number
  onChange: (hue: number, sat: number) => void
  onCommit: () => void
  onReset: () => void
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number; fine: boolean } | null>(null)
  const R = size / 2
  const puck = hueSatToPoint(value.hue, value.sat, R)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, y: e.clientY, px: puck.x, py: puck.y, fine: e.altKey }
    if (!e.altKey) {
      const hs = pointToHueSat(e.clientX - rect.left - R, e.clientY - rect.top - R, R)
      onChange(hs.hue, hs.sat)
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const hs = d.fine
      ? pointToHueSat(d.px + (e.clientX - d.x) * FINE, d.py + (e.clientY - d.y) * FINE, R)
      : pointToHueSat(e.clientX - rect.left - R, e.clientY - rect.top - R, R)
    onChange(hs.hue, hs.sat)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    onCommit()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (e.key in moves) {
      e.preventDefault()
      const [dh, ds] = moves[e.key]
      onChange((value.hue + dh + 360) % 360, Math.min(100, Math.max(0, value.sat + ds)))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onReset()
    }
  }

  return (
    <div
      className="ed-wheel"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value.sat}
      aria-valuetext={value.sat ? `Hue ${value.hue}°, saturation ${value.sat}` : 'No tint'}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Delete"
      title="Drag to tint · double-click to reset · Alt for fine control"
      style={{ width: size, height: size, background: `radial-gradient(circle closest-side, #8a8a8a, rgb(138 138 138 / 0)), ${WHEEL_GRADIENT}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key.startsWith('Arrow') && onCommit()}
      onDoubleClick={onReset}
    >
      <span className="ed-puck" style={{ transform: `translate(${R + puck.x}px, ${R + puck.y}px)`, background: value.sat ? wheelColor(value.hue, value.sat) : '#fff' }} />
    </div>
  )
}
