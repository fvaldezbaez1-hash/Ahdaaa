import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, startOfWeek } from './dates'
import { trendOn, weeklyRate, weightTrend } from './trend'

describe('dates', () => {
  it('does calendar arithmetic across month and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3)
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19') // Sunday → previous Monday
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26')
  })
})

describe('weightTrend', () => {
  it('fills gaps and smooths the scale', () => {
    const s = weightTrend([
      { date: '2026-10-01', kg: 80 },
      { date: '2026-10-03', kg: 82 },
    ])
    expect(s.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(s[0].trend).toBe(80)
    expect(s[1].trend).toBeCloseTo(80.1) // interpolated 81, 10% of the way
    expect(s[2].trend).toBeCloseTo(80.29)
    expect(s[1].raw).toBeUndefined()
    expect(s[2].raw).toBe(82)
  })

  it('damps a one-day spike', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: addDays('2026-10-01', i), kg: i === 5 ? 83 : 80 }))
    const s = weightTrend(days)
    expect(Math.max(...s.map((p) => p.trend))).toBeLessThan(80.31)
  })

  it('reports the trend on a date and the weekly rate', () => {
    const days = Array.from({ length: 60 }, (_, i) => ({ date: addDays('2026-08-01', i), kg: 90 - i * 0.1 }))
    const s = weightTrend(days)
    expect(trendOn(s, '2025-01-01')).toBeUndefined()
    expect(trendOn(s, '2030-01-01')).toBe(s[s.length - 1].trend)
    expect(weeklyRate(s)).toBeCloseTo(-0.7, 1)
  })
})
