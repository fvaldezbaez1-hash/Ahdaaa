import { addDays, daysBetween } from './dates'

export interface TrendPoint {
  date: string
  /** Smoothed "true" weight. */
  trend: number
  /** The scale reading that day, if there was one. */
  raw?: number
}

/**
 * Exponentially smoothed weight trend (the Hacker's Diet / MacroFactor idea):
 * daily scale swings from water and food are damped, so the line shows the
 * real direction. Gaps between weigh-ins are filled by straight-line
 * interpolation before smoothing so missed days don't pull the trend around.
 */
export function weightTrend(weighIns: { date: string; kg: number }[], alpha = 0.1): TrendPoint[] {
  const pts = [...weighIns].filter((w) => w.kg > 0).sort((a, b) => (a.date < b.date ? -1 : 1))
  if (pts.length === 0) return []
  const out: TrendPoint[] = []
  let trend = pts[0].kg
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const next = pts[i + 1]
    const span = next ? daysBetween(cur.date, next.date) : 1
    for (let d = 0; d < span; d++) {
      const date = addDays(cur.date, d)
      const value = next ? cur.kg + ((next.kg - cur.kg) * d) / span : cur.kg
      if (out.length > 0) trend += alpha * (value - trend)
      out.push({ date, trend, raw: d === 0 ? cur.kg : undefined })
    }
  }
  return out
}

/** Trend on or before `date` (the trend holds flat after the last weigh-in). */
export function trendOn(series: TrendPoint[], date: string): number | undefined {
  let found: number | undefined
  for (const p of series) {
    if (p.date > date) break
    found = p.trend
  }
  return found
}

/** Least-squares slope of y over x. */
export function slope(points: { x: number; y: number }[]): number {
  const n = points.length
  if (n < 2) return 0
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const { x, y } of points) {
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const den = n * sxx - sx * sx
  return den === 0 ? 0 : (n * sxy - sx * sy) / den
}

/** Trend change in kg per week over the last `days` days of data. */
export function weeklyRate(series: TrendPoint[], days = 14): number | undefined {
  if (series.length < 2) return undefined
  const last = series[series.length - 1].date
  const from = addDays(last, -days)
  const window = series.filter((p) => p.date >= from)
  if (window.length < 2) return undefined
  return slope(window.map((p) => ({ x: daysBetween(from, p.date), y: p.trend }))) * 7
}
