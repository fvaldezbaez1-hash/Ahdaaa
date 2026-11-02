import { useRef, type PointerEvent } from 'react'
import type { ColorRange } from '../../edit/types'
import { dragSlice, hitSlice, sectorPath, sliceHandles, wrapHue, type SliceHandle } from '../math/colorRange'
import { WHEEL_GRADIENT } from '../math/wheel'

/**
 * The selected range on the hue / saturation wheel: the slice it affects, its
 * soft edge (dashed), and handles for the picked color (middle), the hue
 * edges and the saturation bounds.
 */
export function RangeWheel({ range, size, onChange, onDone }: { range: ColorRange; size: number; onChange: (r: ColorRange) => void; onDone: (h: SliceHandle) => void }) {
  const drag = useRef<SliceHandle | null>(null)
  const R = size / 2 - 8
  const c = size / 2
  const local = (e: PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - b.left) / b.width) * size - c, y: ((e.clientY - b.top) / b.height) * size - c }
  }
  const softHue = 1 + (range.smooth / 100) * 30, softSat = 1 + (range.smooth / 100) * 25
  const h = sliceHandles(range, R)
  const at = (p: { x: number; y: number }) => ({ cx: c + p.x, cy: c + p.y })
  return (
    <div className="ed-rwheel" style={{ width: size, height: size }}>
      <div className="ed-rwheel-bg" style={{ inset: 8, background: `radial-gradient(circle closest-side, #8a8a8a, rgb(138 138 138 / 0)), ${WHEEL_GRADIENT}` }} />
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="group"
        aria-label={`${range.name}: hue ${range.hue}° ± ${range.hueWidth}°, saturation ${range.satLow} to ${range.satHigh}`}
        onPointerDown={(e) => {
          const p = local(e)
          const hit = hitSlice(range, R, p.x, p.y, e.pointerType === 'mouse' ? 9 : 18)
          if (!hit) return
          drag.current = hit
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const p = local(e)
          onChange(dragSlice(range, drag.current, p.x, p.y, R))
        }}
        onPointerUp={() => {
          if (drag.current) onDone(drag.current)
          drag.current = null
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        <path d={sectorPath(c, c, wrapHue(range.hue - range.hueWidth - softHue), wrapHue(range.hue + range.hueWidth + softHue), (Math.max(0, range.satLow - softSat) / 100) * R, (Math.min(100, range.satHigh + softSat) / 100) * R)} className="ed-slice soft" />
        <path d={sectorPath(c, c, wrapHue(range.hue - range.hueWidth), wrapHue(range.hue + range.hueWidth), (range.satLow / 100) * R, (range.satHigh / 100) * R)} className="ed-slice" />
        <circle {...at(h.hueA)} r={5} className="ed-slice-h" />
        <circle {...at(h.hueB)} r={5} className="ed-slice-h" />
        <circle {...at(h.satLow)} r={4} className="ed-slice-h sq" />
        <circle {...at(h.satHigh)} r={4} className="ed-slice-h sq" />
        <circle {...at(h.center)} r={7} className="ed-slice-c" style={{ fill: `hsl(${range.hue} ${Math.max(35, range.sat)}% 55%)` }} />
      </svg>
    </div>
  )
}
