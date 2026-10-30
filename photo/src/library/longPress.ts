import { useLayoutEffect, useRef } from 'react'

const LONG_PRESS_MS = 450

/**
 * Press-and-hold on a grid tile (the element with data-id). Touch only unless
 * `mouse`; moving more than 10 px or scrolling cancels. The click that ends a
 * long press should be ignored: check `consumeClick()` first in onClick.
 */
export function useLongPress(onLongPress: (id: string) => void, mouse = false) {
  const cb = useRef(onLongPress)
  useLayoutEffect(() => {
    cb.current = onLongPress
  })
  const press = useRef<{ id: string; x: number; y: number; at: number; timer: number; fired: boolean } | null>(null)

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer)
  }
  const fire = () => {
    const p = press.current
    if (!p || p.fired) return
    p.fired = true
    navigator.vibrate?.(8)
    cb.current(p.id)
  }
  const handlers = {
    onPointerDown(e: React.PointerEvent) {
      cancel()
      press.current = null
      if (e.pointerType === 'mouse' && (!mouse || e.button !== 0)) return
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
      if (!id) return
      const timer = window.setTimeout(fire, LONG_PRESS_MS)
      press.current = { id, x: e.clientX, y: e.clientY, at: e.timeStamp, timer, fired: false }
    },
    onPointerMove(e: React.PointerEvent) {
      const p = press.current
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
        cancel()
        press.current = null
      }
    },
    onPointerUp(e: React.PointerEvent) {
      cancel()
      // A busy main thread can run the timer late: judge by how long the finger was really down.
      if (press.current && e.timeStamp - press.current.at >= LONG_PRESS_MS) fire()
    },
    onPointerCancel() {
      cancel()
      if (!press.current?.fired) press.current = null
    },
    // The system menu for images would cover the selection.
    onContextMenu(e: React.MouseEvent) {
      if (press.current) e.preventDefault()
    },
  }
  const consumeClick = () => {
    if (!press.current?.fired) return false
    press.current = null
    return true
  }
  return { handlers, consumeClick }
}
