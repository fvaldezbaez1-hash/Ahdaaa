import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// Lightweight SVG charts. Thin marks, hairline grid, crosshair tooltips on
// lines and per-bar tooltips, each with a data-table twin.

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1
    min -= pad
    max += pad
  }
  const step = niceStep(max - min, count)
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

export const compact = (n: number) =>
  Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}K` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `${Math.round(n * 10) / 10}`

const M = { top: 12, right: 14, bottom: 24, left: 42 }

interface Tip {
  left: number
  content: ReactNode
}

function TipBox({ tip, width }: { tip: Tip | null; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth)
  }, [tip])
  if (!tip) return null
  // Sit beside the hovered point (never on top of it) and inside the chart.
  const right = tip.left + 12
  const left = right + w <= width ? right : Math.max(0, tip.left - 12 - w)
  return (
    <div className="tip" ref={ref} style={{ left, top: 4 }}>
      {tip.content}
    </div>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="small muted" style={{ marginTop: 8 }}>
      <summary>Data table</summary>
      <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
        <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '4px 6px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                {r.map((c, j) => (
                  <td key={j} style={{ padding: '4px 6px' }}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

export interface LineSeries {
  key: string
  label: string
  color: string
  points: { x: number; y: number }[]
  kind: 'line' | 'dots'
}

export function LineChart({
  series,
  height = 170,
  xFormat,
  yFormat,
  tickFormat = yFormat,
  target,
  yMinZero,
  ariaLabel,
  endLabel = true,
}: {
  series: LineSeries[]
  height?: number
  xFormat: (x: number) => string
  yFormat: (y: number) => string
  tickFormat?: (y: number) => string
  target?: { y: number; label: string }
  yMinZero?: boolean
  ariaLabel: string
  endLabel?: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const all = series.flatMap((s) => s.points)
  const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b)
  const geo = useMemo(() => {
    if (all.length === 0 || width === 0) return null
    let x0 = Math.min(...all.map((p) => p.x))
    let x1 = Math.max(...all.map((p) => p.x))
    if (x0 === x1) {
      x0 -= 86_400_000
      x1 += 86_400_000
    }
    const ys = all.map((p) => p.y).concat(target ? [target.y] : [])
    let y0 = Math.min(...ys)
    let y1 = Math.max(...ys)
    if (yMinZero) y0 = 0
    const ticks = niceTicks(y0, y1, 4)
    y0 = ticks[0]
    y1 = ticks[ticks.length - 1]
    const pw = width - M.left - M.right
    const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * pw
    const sy = (y: number) => M.top + (1 - (y - y0) / (y1 - y0 || 1)) * height
    const xticks = [0, 1 / 3, 2 / 3, 1].map((f) => x0 + f * (x1 - x0))
    return { sx, sy, ticks, xticks, x0, x1, pw }
  }, [all, width, height, target, yMinZero])

  const primary = series.find((s) => s.kind === 'line') ?? series[0]
  const lastPrimary = primary?.points[primary.points.length - 1]

  const pick = (clientX: number, el: Element) => {
    if (!geo || xs.length === 0) return
    const rect = el.getBoundingClientRect()
    const x = geo.x0 + ((clientX - rect.left - M.left) / geo.pw) * (geo.x1 - geo.x0)
    let best = 0
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i
    setHover(best)
  }

  let tip: Tip | null = null
  if (geo && hover !== null && xs[hover] !== undefined) {
    const hx = xs[hover]
    const rows = series
      .map((s) => ({ s, p: s.points.find((p) => p.x === hx) }))
      .filter((r): r is { s: LineSeries; p: { x: number; y: number } } => !!r.p)
    tip = {
      left: geo.sx(hx),
      content: (
        <>
          <div className="muted">{xFormat(hx)}</div>
          {rows.map(({ s, p }) => (
            <div key={s.key}>
              <span className="key" style={{ background: s.color, height: s.kind === 'dots' ? 6 : 2, width: s.kind === 'dots' ? 6 : 12, borderRadius: s.kind === 'dots' ? 3 : 1 }} />
              <b>{yFormat(p.y)}</b> <span className="muted">{s.label}</span>
            </div>
          ))}
        </>
      ),
    }
  }

  const table = useMemo(() => {
    const head = ['Date', ...series.map((s) => s.label)]
    const rows = [...xs].reverse().map((x) => [xFormat(x), ...series.map((s) => {
      const p = s.points.find((q) => q.x === x)
      return p ? yFormat(p.y) : '–'
    })])
    return { head, rows }
  }, [series, xs, xFormat, yFormat])

  return (
    <div>
      <div className="chart" ref={ref} style={{ height: height + M.top + M.bottom }}>
        {geo && (
          <svg
            width={width}
            height={height + M.top + M.bottom}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? xs.length) - 1))
              if (e.key === 'ArrowRight') setHover((h) => Math.min(xs.length - 1, (h ?? -1) + 1))
            }}
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={M.left - 6} y={geo.sy(t)} dy="0.32em" textAnchor="end">
                  {tickFormat(t)}
                </text>
              </g>
            ))}
            {geo.xticks.map((t, i) => (
              <text key={i} x={geo.sx(t)} y={height + M.top + 16} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>
                {xFormat(t)}
              </text>
            ))}
            {target && (
              <g>
                <line x1={M.left} x2={width - M.right} y1={geo.sy(target.y)} y2={geo.sy(target.y)} stroke="var(--text-2)" strokeWidth={1} />
                <text x={width - M.right} y={geo.sy(target.y) - 5} textAnchor="end" style={{ fill: 'var(--text-2)' }}>
                  {target.label}
                </text>
              </g>
            )}
            {series.map((s) =>
              s.kind === 'line' ? (
                <path
                  key={s.key}
                  d={s.points.map((p, i) => `${i ? 'L' : 'M'}${geo.sx(p.x).toFixed(1)},${geo.sy(p.y).toFixed(1)}`).join('')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : (
                <g key={s.key}>
                  {s.points.map((p, i) => (
                    <circle key={i} cx={geo.sx(p.x)} cy={geo.sy(p.y)} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  ))}
                </g>
              ),
            )}
            {endLabel && lastPrimary && primary.kind === 'line' && (
              <g>
                <circle cx={geo.sx(lastPrimary.x)} cy={geo.sy(lastPrimary.y)} r={4.5} fill={primary.color} stroke="var(--surface)" strokeWidth={2} />
                <text
                  x={geo.sx(lastPrimary.x) - 8}
                  y={geo.sy(lastPrimary.y) - 10}
                  textAnchor="end"
                  stroke="var(--surface)"
                  strokeWidth={4}
                  paintOrder="stroke"
                  style={{ fill: 'var(--text)', fontWeight: 650, fontSize: 12 }}
                >
                  {yFormat(lastPrimary.y)}
                </text>
              </g>
            )}
            {hover !== null && xs[hover] !== undefined && (
              <line x1={geo.sx(xs[hover])} x2={geo.sx(xs[hover])} y1={M.top} y2={M.top + height} stroke="var(--text-2)" strokeWidth={1} />
            )}
          </svg>
        )}
        <TipBox tip={tip} width={width} />
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <i className={s.kind === 'dots' ? 'dot-key' : 'line-key'} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <DataTable head={table.head} rows={table.rows} />
    </div>
  )
}

export interface Bar {
  key: string
  label: string
  tip: string
  value: number
}

export function BarChart({
  bars,
  height = 150,
  yFormat,
  tickFormat = yFormat,
  target,
  ariaLabel,
  color = 'var(--s1)',
  valueLabel,
}: {
  bars: Bar[]
  height?: number
  yFormat: (y: number) => string
  tickFormat?: (y: number) => string
  target?: { y: number; label: string }
  ariaLabel: string
  color?: string
  valueLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...bars.map((b) => b.value), target?.y ?? 0)
  const ticks = niceTicks(0, max, 3)
  const top = ticks[ticks.length - 1]
  const pw = Math.max(0, width - M.left - M.right)
  const slot = bars.length ? pw / bars.length : 0
  const bw = Math.max(2, Math.min(24, slot - 4))
  const sy = (v: number) => M.top + (1 - v / top) * height
  const every = Math.max(1, Math.ceil(bars.length / 6))

  const tip: Tip | null =
    hover !== null && bars[hover]
      ? {
          left: M.left + slot * hover + slot / 2,
          content: (
            <>
              <div className="muted">{bars[hover].tip}</div>
              <b>{yFormat(bars[hover].value)}</b> <span className="muted">{valueLabel}</span>
            </>
          ),
        }
      : null

  return (
    <div>
      <div className="chart" ref={ref} style={{ height: height + M.top + M.bottom }} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height + M.top + M.bottom} role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
                <text x={M.left - 6} y={sy(t)} dy="0.32em" textAnchor="end">
                  {tickFormat(t)}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const cx = M.left + slot * i + slot / 2
              const h = Math.max(0, sy(0) - sy(b.value))
              const r = Math.min(4, bw / 2, h)
              const x = cx - bw / 2
              const y = sy(b.value)
              const d =
                h <= 0
                  ? ''
                  : `M${x},${sy(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${sy(0)}Z`
              return (
                <g
                  key={b.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${b.tip}: ${yFormat(b.value)} ${valueLabel}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  style={{ outline: 'none' }}
                >
                  <rect x={M.left + slot * i} y={M.top} width={slot} height={height} fill="transparent" />
                  {d && <path d={d} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {i % every === 0 && (
                    <text x={cx} y={height + M.top + 16} textAnchor="middle">
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}
            {target && target.y > 0 && (
              <g pointerEvents="none">
                <line x1={M.left} x2={width - M.right} y1={sy(target.y)} y2={sy(target.y)} stroke="var(--text-2)" strokeWidth={1} />
                <text x={width - M.right} y={sy(target.y) - 5} textAnchor="end" style={{ fill: 'var(--text-2)' }}>
                  {target.label}
                </text>
              </g>
            )}
          </svg>
        )}
        <TipBox tip={tip} width={width} />
      </div>
      <DataTable head={['', valueLabel]} rows={[...bars].reverse().map((b) => [b.tip, yFormat(b.value)])} />
    </div>
  )
}

export function Sparkline({ values, width = 96, height = 32, color = 'var(--s1)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const sx = (i: number) => 2 + (i / (values.length - 1)) * (width - 4)
  const sy = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('')
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx(values.length - 1)} cy={sy(values[values.length - 1])} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

/** Progress ring (a meter): accent fill, turns to the "serious" status color when over. */
export function Ring({
  value,
  max,
  size = 132,
  stroke = 11,
  children,
}: {
  value: number
  max: number
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = max > 0 ? Math.min(1, value / max) : 0
  const over = max > 0 && value > max
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(frac))
    return () => cancelAnimationFrame(id)
  }, [frac])
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          opacity={shown > 0 ? 1 : 0}
          stroke={over ? 'var(--serious)' : 'var(--accent)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * shown} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.5s ease-out' }}
        />
      </svg>
      <div className="center">{children}</div>
    </div>
  )
}

export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="stack tight" role="list">
      {rows.map((r) => (
        <div className="hbar" key={r.label} role="listitem">
          <span className="ellipsis">{r.label}</span>
          <span className="track">
            <i style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="v">{format ? format(r.value) : r.value}</span>
        </div>
      ))}
    </div>
  )
}
