// Days are stored as local-calendar keys ("YYYY-MM-DD") so a meal logged at
// 11pm stays on that day no matter where the phone travels later.

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(d: Date | number = new Date()): string {
  const x = typeof d === 'number' ? new Date(d) : d
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

export const today = () => dayKey(new Date())

/** Local midnight of a day key. */
export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Day arithmetic runs in UTC so DST changes never skip or repeat a day.
const utcDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export function addDays(key: string, n: number): string {
  const t = new Date((utcDay(key) + n) * 86_400_000)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round(utcDay(b) - utcDay(a))
}

/** Monday-based start of the week containing `key`. */
export function startOfWeek(key: string): string {
  const dow = new Date(utcDay(key) * 86_400_000).getUTCDay() // 0 = Sunday
  return addDays(key, -((dow + 6) % 7))
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k)
  return out
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export function fmtDay(key: string): string {
  const t = today()
  if (key === t) return 'Today'
  if (key === addDays(t, -1)) return 'Yesterday'
  if (key === addDays(t, 1)) return 'Tomorrow'
  return dayFmt.format(parseDay(key))
}

export const fmtShortDay = (key: string) => shortFmt.format(parseDay(key))
export const fmtLongDay = (key: string) => longFmt.format(parseDay(key))
export const fmtTime = (ms: number) => timeFmt.format(new Date(ms))

export function fmtDateTime(ms: number): string {
  return `${fmtDay(dayKey(ms))}, ${fmtTime(ms)}`
}

/** 75 → "1:15", 3725 → "1:02:05" */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** 3725 → "1h 2m", 300 → "5m" */
export function fmtDuration(totalSec: number): string {
  const m = Math.round(totalSec / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}
