import { describe, expect, it } from 'vitest'
import { parseDay } from './dates'
import { weeklyStreak } from './streaks'

const at = (key: string) => parseDay(key).getTime() + 18 * 3_600_000

describe('weeklyStreak', () => {
  // Weeks start Monday: Oct 6, 13, 20, 27 (2026).
  const starts = ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27'].map(at)

  it('counts this week and keeps the streak alive until the week is over', () => {
    expect(weeklyStreak(starts, 2, '2026-10-28')).toEqual({ thisWeek: 1, streak: 3 })
  })

  it('includes this week once the goal is met', () => {
    expect(weeklyStreak([...starts, at('2026-10-29')], 2, '2026-10-29')).toEqual({ thisWeek: 2, streak: 4 })
  })

  it('breaks on a missed week', () => {
    expect(weeklyStreak(starts.filter((_, i) => i !== 2), 2, '2026-10-28').streak).toBe(1)
    expect(weeklyStreak([], 3, '2026-10-28')).toEqual({ thisWeek: 0, streak: 0 })
  })
})
