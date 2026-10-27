import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { BUILTIN_EXERCISES } from './data/exercises'
import { currentTargets, ensureCheckIn } from './lib/coach'
import { db } from './lib/db'
import { loadSettings } from './lib/settings'
import { weightTrend, type TrendPoint } from './lib/trend'
import type { BodyEntry, CheckIn, Exercise, MacroTargets, Settings, Workout } from './lib/types'

const SettingsCtx = createContext<Settings | null>(null)

/** Loads settings live from the database; children render once they're ready. */
export function SettingsProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  // A live query: re-runs whenever the stored settings change.
  const settings = useLiveQuery(() => loadSettings(), [])

  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    if (settings.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = settings.theme
    // Create this week's check-in (or the first one) as soon as the app opens.
    if (settings.onboarded) ensureCheckIn(settings).catch(console.error)
  }, [settings])

  if (!settings) return <>{fallback}</>
  return <SettingsCtx.Provider value={settings}>{children}</SettingsCtx.Provider>
}

export function useSettings(): Settings {
  const s = useContext(SettingsCtx)
  if (!s) throw new Error('useSettings outside SettingsProvider')
  return s
}

export function useExercises(): { list: Exercise[]; map: Map<string, Exercise> } {
  const custom = useLiveQuery(() => db.exercises.toArray(), [])
  return useMemo(() => {
    const list = [...BUILTIN_EXERCISES, ...(custom ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    return { list, map: new Map(list.map((e) => [e.id, e])) }
  }, [custom])
}

/** All saved workouts, newest first. */
export function useWorkouts(): Workout[] | undefined {
  return useLiveQuery(() => db.workouts.orderBy('start').reverse().toArray(), [])
}

export function useBody(): BodyEntry[] | undefined {
  return useLiveQuery(() => db.body.orderBy('date').toArray(), [])
}

export function useWeightTrend(): { body: BodyEntry[] | undefined; trend: TrendPoint[] } {
  const body = useBody()
  const trend = useMemo(
    () => weightTrend((body ?? []).filter((b) => b.weightKg).map((b) => ({ date: b.date, kg: b.weightKg! }))),
    [body],
  )
  return { body, trend }
}

export function useCheckIns(): CheckIn[] | undefined {
  return useLiveQuery(() => db.checkins.orderBy('date').toArray(), [])
}

/** Today's calorie and macro targets (from the latest weekly check-in, or manual). */
export function useTargets(): { targets: MacroTargets; checkIn?: CheckIn } {
  const s = useSettings()
  const latest = useLiveQuery(() => db.checkins.orderBy('date').last(), [])
  return { targets: currentTargets(s, latest), checkIn: latest }
}
