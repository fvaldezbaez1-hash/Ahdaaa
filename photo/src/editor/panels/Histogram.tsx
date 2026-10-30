import { useEffect, useRef } from 'react'
import type { Histogram as Hist } from '../../engine/types'
import { useView, view } from '../view'

const COLORS = ['rgba(255,82,82,.62)', 'rgba(76,214,120,.58)', 'rgba(82,146,255,.62)']

function draw(canvas: HTMLCanvasElement, h: Hist | null) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr), ht = Math.round(canvas.clientHeight * dpr)
  if (!w || !ht) return
  if (canvas.width !== w || canvas.height !== ht) {
    canvas.width = w
    canvas.height = ht
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, ht)
  if (!h) return
  // Scale to the tallest bin away from the ends, so a clipped spike doesn't flatten the rest.
  let max = 1
  for (const ch of [h.r, h.g, h.b]) for (let i = 2; i < 254; i++) max = Math.max(max, ch[i])
  const blend = getComputedStyle(canvas).getPropertyValue('--hist-blend').trim() || 'screen'
  ctx.globalCompositeOperation = blend as GlobalCompositeOperation
  ;[h.r, h.g, h.b].forEach((bins, c) => {
    ctx.beginPath()
    ctx.moveTo(0, ht)
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, ht - Math.min(1, bins[i] / max) * ht * 0.94)
    ctx.lineTo(w, ht)
    ctx.closePath()
    ctx.fillStyle = COLORS[c]
    ctx.fill()
  })
  ctx.globalCompositeOperation = 'source-over'
}

/** RGB histogram of the edited photo, with clipping warnings that toggle the clipping overlay (J). */
export function Histogram() {
  const ref = useRef<HTMLCanvasElement>(null)
  const hist = useView((s) => s.histogram)
  const clipping = useView((s) => s.clipping)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    draw(c, hist)
    const ro = new ResizeObserver(() => draw(c, view.get().histogram))
    ro.observe(c)
    return () => ro.disconnect()
  }, [hist])

  const low = (hist?.clippedLow ?? 0) > 0.002, high = (hist?.clippedHigh ?? 0) > 0.002
  const toggle = () => view.set({ clipping: !clipping })
  const title = (what: string, on: boolean) => `${on ? `Some ${what} are clipped. ` : ''}${clipping ? 'Hide' : 'Show'} clipping (J)`
  return (
    <div className="ed-hist">
      <canvas ref={ref} role="img" aria-label={hist ? 'Histogram of the edited photo' : 'Histogram (calculating)'} />
      <button type="button" className={`ed-clip low${low ? ' hot' : ''}`} aria-pressed={clipping} aria-label="Show shadow clipping" title={title('shadows', low)} onClick={toggle} />
      <button type="button" className={`ed-clip high${high ? ' hot' : ''}`} aria-pressed={clipping} aria-label="Show highlight clipping" title={title('highlights', high)} onClick={toggle} />
    </div>
  )
}
