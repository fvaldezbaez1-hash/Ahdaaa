import { addDays, dayKey, startOfWeek } from './dates'

/**
 * Workouts this week, and how many weeks in a row (ending with this week if
 * it's already met, otherwise last week) hit the weekly goal.
 */
export function weeklyStreak(starts: number[], goal: number, todayKey: string): { thisWeek: number; streak: number } {
  const perWeek = new Map<string, number>()
  for (const s of starts) {
    const w = startOfWeek(dayKey(s))
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1)
  }
  const cur = startOfWeek(todayKey)
  const thisWeek = perWeek.get(cur) ?? 0
  let week = thisWeek >= goal ? cur : addDays(cur, -7)
  let streak = 0
  while ((perWeek.get(week) ?? 0) >= goal) {
    streak++
    week = addDays(week, -7)
  }
  return { thisWeek, streak }
}
