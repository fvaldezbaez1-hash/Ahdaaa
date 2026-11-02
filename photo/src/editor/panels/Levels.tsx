import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { LevelsChannel } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { Icon } from '../../ui/Icon'
import { autoLevels, CHANNELS, IDENTITY, isIdentity, midPosition, moveHandle, transfer, type LevelsChannelId, type LevelsHandle } from '../math/levels'
import { useView, view } from '../view'

const LABEL: Record<LevelsHandle, string> = { inBlack: 'input black', mid: 'midtones', inWhite: 'input white', outBlack: 'output black', outWhite: 'output white' }
const COLOR: Record<LevelsChannelId, string> = { rgb: 'var(--text)', r: '#e5484d', g: '#30a46c', b: '#3e7bfa' }

function histPath(bins: ArrayLike<number> | undefined): string {
  if (!bins) return ''
  let max = 1
  for (let i = 2; i < 254; i++) max = Math.max(max, bins[i])
  let d = 'M0 80'
  for (let i = 0; i < 256; i++) d += `L${i} ${80 - Math.min(1, bins[i] / max) * 76}`
  return `${d}L255 80Z`
}

/** One draggable track: handles at 0…255, each focusable with arrow keys (Shift = ×10). */
function Track({ c, handles, onMove, onDone, label, className }: {
  c: LevelsChannel
  handles: LevelsHandle[]
  onMove: (h: LevelsHandle, v: number) => void
  onDone: (h: LevelsHandle) => void
  label: string
  className?: string
}) {
  const drag = useRef<LevelsHandle | null>(null)
  const pos = (h: LevelsHandle) => (h === 'mid' ? midPosition(c) : c[h])
  const valueAt = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return ((e.clientX - r.left) / r.width) * 255
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const v = valueAt(e)
    // The nearest handle follows the pointer.
    const h = handles.reduce((a, b) => (Math.abs(pos(b) - v) < Math.abs(pos(a) - v) ? b : a))
    drag.current = h
    e.currentTarget.setPointerCapture(e.pointerId)
    onMove(h, v)
  }
  const onKey = (e: KeyboardEvent<HTMLSpanElement>, h: LevelsHandle) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0
    if (!d) return
    e.preventDefault()
    onMove(h, pos(h) + d * (e.shiftKey ? 10 : 1))
  }
  return (
    <div
      className={`ed-lv-track ${className ?? ''}`}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => drag.current && onMove(drag.current, valueAt(e))}
      onPointerUp={() => {
        if (drag.current) onDone(drag.current)
        drag.current = null
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      {handles.map((h) => (
        <span
          key={h}
          className={`ed-lv-handle ${h}`}
          style={{ left: `${(pos(h) / 255) * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label={`Levels ${LABEL[h]}`}
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuenow={Math.round(pos(h))}
          aria-valuetext={h === 'mid' ? `gamma ${c.gamma.toFixed(2)}` : String(Math.round(pos(h)))}
          onKeyDown={(e) => onKey(e, h)}
          onKeyUp={(e) => e.key.startsWith('Arrow') && onDone(h)}
        />
      ))}
    </div>
  )
}

/** Levels per channel over the histogram: input black / midtones / white and output black / white. */
export function Levels() {
  const [ch, setCh] = useState<LevelsChannelId>('rgb')
  const c = useEditor((s) => s.recipe?.levels[ch] ?? IDENTITY)
  const hist = useView((s) => s.histogram)
  const pick = useView((s) => s.pick)
  const bins = hist ? (ch === 'rgb' ? hist.luma : hist[ch]) : undefined
  const name = CHANNELS.find((x) => x.id === ch)!.label

  const move = (h: LevelsHandle, v: number) => editor.preview((r) => ({ ...r, levels: { ...r.levels, [ch]: moveHandle(r.levels[ch], h, v) } }))
  const done = (h: LevelsHandle) => {
    const cur = editor.getState().recipe?.levels[ch]
    if (!cur) return
    const value = h === 'mid' ? cur.gamma.toFixed(2) : String(cur[h])
    editor.commit(`Levels ${ch === 'rgb' ? '' : `${name} `}${LABEL[h]} ${value}`)
  }
  const auto = () => {
    if (!bins) return
    editor.apply((r) => ({ ...r, levels: { ...r.levels, [ch]: { ...r.levels[ch], ...autoLevels(bins) } } }), `Levels ${ch === 'rgb' ? '' : `${name} `}auto`)
  }
  const curve = Array.from({ length: 65 }, (_, i) => `${i ? 'L' : 'M'}${(i / 64) * 255} ${80 - transfer(c, i / 64) * 80}`).join('')

  return (
    <div className="stack tight ed-levels">
      <div className="row between">
        <Segmented label="Levels channel" value={ch} onChange={setCh} options={CHANNELS.map((x) => ({ value: x.id, label: x.label === 'RGB' ? 'RGB' : x.label[0], title: x.label }))} />
        <button type="button" className="btn outline sm" onClick={auto} disabled={!bins} aria-label="Auto levels" title="Stretch the tones to the full range">
          Auto
        </button>
      </div>
      <svg className="ed-lv-hist" viewBox="0 0 255 80" preserveAspectRatio="none" aria-hidden="true">
        <path d={histPath(bins)} style={{ fill: ch === 'rgb' ? 'var(--text-3)' : COLOR[ch] }} className="ed-curve-hist" />
        {!isIdentity(c) && <path d={curve} className="ed-lv-curve" style={{ stroke: COLOR[ch] }} />}
      </svg>
      <Track c={c} handles={['inBlack', 'mid', 'inWhite']} onMove={move} onDone={done} label={`${name} input levels`} />
      <div className="row between small tnum muted ed-lv-nums">
        <span>{c.inBlack}</span>
        <span>{c.gamma.toFixed(2)}</span>
        <span>{c.inWhite}</span>
      </div>
      <Track c={c} handles={['outBlack', 'outWhite']} onMove={move} onDone={done} label={`${name} output levels`} className="out" />
      <div className="row between small tnum muted ed-lv-nums">
        <span>{c.outBlack}</span>
        <span>{c.outWhite}</span>
      </div>
      <div className="row ed-lv-picks" role="group" aria-label="Set points by clicking the photo">
        {(['black', 'gray', 'white'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={pick === k ? 'btn outline sm on' : 'btn outline sm'}
            aria-pressed={pick === k}
            onClick={() => view.set({ pick: pick === k ? null : k })}
            title={`Click something on the photo that should be ${k === 'gray' ? 'neutral gray' : k}`}
          >
            <Icon name="eyedropper" size={14} />
            <span className={`ed-lv-dot ${k}`} aria-hidden="true" />
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}
