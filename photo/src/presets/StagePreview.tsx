import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditRecipe } from '../edit/types'
import { createEngine } from '../engine'
import type { Engine } from '../engine/types'
import { Spinner } from '../ui/controls'
import type { PreviewSource } from './previews'

/**
 * The large preview on the Presets screen: its own engine on a visible canvas
 * (so tile previews keep theirs). Pressing and holding shows `before`.
 */
export function StagePreview({ source, recipe, before, fallback }: { source: PreviewSource | null; recipe: EditRecipe | null; before: EditRecipe | null; fallback?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const engine = useRef<Engine | null>(null)
  const [hold, setHold] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [failed, setFailed] = useState(false)

  // A canvas of our own per engine: disposing an engine loses its canvas's WebGL context for good.
  const attach = useCallback((host: HTMLSpanElement | null) => {
    if (!host) return
    const c = document.createElement('canvas')
    let e: Engine | null = null
    try {
      e = createEngine(c)
    } catch {
      e = null
    }
    if (e?.supported) {
      host.append(c)
      engine.current = e
    } else setFailed(true)
    return () => {
      e?.dispose()
      c.remove()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (source) engine.current?.setSource(source.image, source.color)
  }, [source])

  const shown = hold ? before : recipe
  useEffect(() => {
    const e = engine.current
    if (!e || !source || !shown || !size.w || !size.h) return
    const raf = requestAnimationFrame(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      e.resize(size.w * dpr, size.h * dpr)
      e.render(shown)
    })
    return () => cancelAnimationFrame(raf)
  }, [source, shown, size])

  const press = (on: boolean) => () => setHold(on)
  return (
    <div
      ref={box}
      className="ps-stage"
      tabIndex={0}
      role="img"
      aria-label={hold ? 'Showing the photo without the look' : 'Preview of the look. Press and hold, or hold Space, to compare'}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerLeave={press(false)}
      onPointerCancel={press(false)}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          setHold(true)
        }
      }}
      onKeyUp={(e) => e.key === ' ' && setHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {failed && fallback && <img src={fallback} alt="" className="ps-stage-img" />}
      <span ref={attach} className="ps-canvas" />
      {!source && !failed && <Spinner label="Loading photo" />}
      <span className="ps-hold">{hold ? 'Before' : 'Hold to compare'}</span>
    </div>
  )
}
