import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { EditRecipe, Preset, SourceKind } from '../edit/types'
import { Icon } from '../ui/Icon'
import { Slider } from '../ui/Slider'
import { applyPreset } from './apply'
import { approxFilter, swatch } from './approx'
import { cachedPreview, requestPreview, type PreviewSource } from './previews'

/** What tiles preview looks on: one photo, with its own edits minus any look. */
export interface PreviewTarget {
  source: PreviewSource
  base: EditRecipe
  /** Hash of `base`: previews re-render when it changes. */
  baseKey: string
  kind: SourceKind
  /** The photo's stored thumbnail, shown (roughly filtered) until the real preview is ready. */
  thumbUrl?: string
}

/** A live render of `preset` on the target photo, made when it scrolls into view. */
export function LookPreview({ preset, target, amount = 100 }: { preset: Preset; target: PreviewTarget | null; amount?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const key = target ? `${target.source.key}|${preset.id}|${amount}|${target.baseKey}` : ''
  // The key names everything that changes the picture; the latest inputs are read when the job runs.
  const inputs = useRef({ preset, target, amount })
  useLayoutEffect(() => {
    inputs.current = { preset, target, amount }
  })

  useEffect(() => {
    const el = canvas.current
    const { target } = inputs.current
    if (!target || !el) return
    const draw = (b: ImageBitmap) => {
      el.width = b.width
      el.height = b.height
      el.getContext('2d')?.drawImage(b, 0, 0)
      setReady(true)
    }
    const hit = cachedPreview(key)
    if (hit) return draw(hit)
    let cancel = () => undefined as void
    const io = new IntersectionObserver(
      ([e]) => {
        cancel()
        if (!e.isIntersecting) return
        cancel = requestPreview(key, target.source, () => {
          const { preset, amount } = inputs.current
          return applyPreset(target.base, preset, amount, 'original', target.kind)
        }, draw)
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancel()
    }
  }, [key])

  const fallback: CSSProperties = target?.thumbUrl ? { backgroundImage: `url("${target.thumbUrl}")`, filter: approxFilter(preset.data) } : { background: swatch(preset.data) }
  return (
    <span className="lk-thumb">
      {!ready && <span className="lk-fallback" style={fallback} />}
      <canvas ref={canvas} className={ready ? 'on' : undefined} aria-hidden="true" />
    </span>
  )
}

export function LookTile({
  preset, target, sub, reason, selected, favorite, onPick, onFavorite, className,
}: {
  preset: Preset
  target: PreviewTarget | null
  sub?: string
  reason?: string
  selected: boolean
  favorite?: boolean
  onPick: () => void
  onFavorite?: () => void
  className?: string
}) {
  return (
    <div className={['lk-tile', selected && 'on', className].filter(Boolean).join(' ')}>
      <button type="button" className="lk-pick" aria-pressed={selected} onClick={onPick} title={preset.description}>
        <LookPreview preset={preset} target={target} />
        <span className="lk-name ellipsis">{preset.name}</span>
        {sub && <span className="lk-sub ellipsis">{sub}</span>}
        {reason && <span className="lk-reason">{reason}</span>}
      </button>
      {onFavorite && (
        <button type="button" className={favorite ? 'lk-fav on' : 'lk-fav'} aria-pressed={!!favorite} aria-label={favorite ? `Remove ${preset.name} from favorites` : `Add ${preset.name} to favorites`} onClick={onFavorite}>
          <Icon name={favorite ? 'starFill' : 'star'} size={14} />
        </button>
      )}
    </div>
  )
}

/** Amount 0…200 % with an accent-filled track. */
export function AmountSlider({ value, onChange, onCommit, disabled }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean }) {
  const track = `linear-gradient(90deg, var(--accent) ${value / 2}%, var(--panel-3) ${value / 2}%)`
  return <Slider label="Amount" value={value} min={0} max={200} defaultValue={100} signed={false} format={(v) => `${Math.round(v)}%`} track={track} onChange={onChange} onCommit={onCommit} disabled={disabled} />
}
