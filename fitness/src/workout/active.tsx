import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { db, KEYS, kvGet, kvSet } from '../lib/db'
import { uid } from '../lib/id'
import { buzz, scheduleChime, unlockAudio } from '../lib/sound'
import type { ActiveWorkout, Routine, WExercise, Workout } from '../lib/types'

interface ActiveCtx {
  active: ActiveWorkout | null
  start(opts?: { routine?: Routine; name?: string }): void
  editSaved(w: Workout): void
  update(fn: (draft: ActiveWorkout) => void): void
  /** Saves completed sets; returns the saved workout id (null if nothing was done). */
  finish(): Promise<string | null>
  discard(): void
  startRest(sec: number): void
  adjustRest(deltaSec: number): void
  stopRest(): void
}

const Ctx = createContext<ActiveCtx | null>(null)

export function useActive(): ActiveCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useActive outside ActiveWorkoutProvider')
  return c
}

function defaultName(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Morning Workout' : h < 17 ? 'Afternoon Workout' : 'Evening Workout'
}

export function routineToExercises(r: Routine): WExercise[] {
  return r.exercises.map((re) => ({
    id: uid(),
    exerciseId: re.exerciseId,
    restSec: re.restSec,
    repMin: re.repMin,
    repMax: re.repMax,
    notes: re.notes,
    supersetId: re.supersetId,
    sets: re.sets.map((s) => ({ id: uid(), type: s.type, kg: s.kg, reps: s.reps, seconds: s.seconds, meters: s.meters, done: false })),
  }))
}

/**
 * Holds the workout in progress. It lives in memory for snappy typing and is
 * saved to the phone's database on every change, so closing the app mid-set
 * loses nothing.
 */
export function ActiveWorkoutProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveWorkout | null>(null)
  const [loaded, setLoaded] = useState(false)
  const pending = useRef<ActiveWorkout | null | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelChime = useRef<() => void>(() => {})

  useEffect(() => {
    kvGet<ActiveWorkout>(KEYS.active).then((a) => {
      setActive(a ?? null)
      setLoaded(true)
    })
  }, [])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const v = pending.current
    if (v === undefined) return
    pending.current = undefined
    if (v === null) void db.kv.delete(KEYS.active)
    else void kvSet(KEYS.active, v)
  }, [])

  useEffect(() => {
    if (!loaded) return
    pending.current = active
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 300)
  }, [active, loaded, flush])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

  // Buzz when the rest timer runs out while the app is open.
  const restEndsAt = active?.restEndsAt
  useEffect(() => {
    if (!restEndsAt) return
    const ms = restEndsAt - Date.now()
    if (ms <= 0) return
    const id = setTimeout(() => {
      if (document.visibilityState === 'visible') buzz([200, 100, 200])
    }, ms)
    return () => clearTimeout(id)
  }, [restEndsAt])

  const update = useCallback((fn: (d: ActiveWorkout) => void) => {
    setActive((cur) => {
      if (!cur) return cur
      const draft = structuredClone(cur)
      fn(draft)
      return draft
    })
  }, [])

  const value: ActiveCtx = {
    active,
    start(opts = {}) {
      unlockAudio()
      setActive({
        id: uid(),
        name: opts.routine?.name ?? opts.name ?? defaultName(),
        start: Date.now(),
        end: 0,
        routineId: opts.routine?.id,
        exercises: opts.routine ? routineToExercises(opts.routine) : [],
      })
    },
    editSaved(w) {
      setActive({ ...structuredClone(w), id: uid(), editingId: w.id })
    },
    update,
    async finish() {
      if (!active) return null
      cancelChime.current()
      const exercises = active.exercises
        .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
        .filter((e) => e.sets.length > 0)
      if (exercises.length === 0) return null
      const w: Workout = {
        id: active.editingId ?? active.id,
        name: active.name.trim() || defaultName(new Date(active.start)),
        start: active.start,
        end: active.editingId ? active.end : Date.now(),
        exercises,
        notes: active.notes?.trim() || undefined,
        routineId: active.routineId,
      }
      await db.workouts.put(w)
      pending.current = null
      setActive(null)
      flush()
      return w.id
    },
    discard() {
      cancelChime.current()
      setActive(null)
    },
    startRest(sec) {
      unlockAudio()
      cancelChime.current()
      if (sec <= 0) return
      cancelChime.current = scheduleChime(sec * 1000)
      update((d) => {
        d.restEndsAt = Date.now() + sec * 1000
        d.restTotal = sec
      })
    },
    adjustRest(delta) {
      if (!active?.restEndsAt) return
      const left = Math.max(0, active.restEndsAt - Date.now() + delta * 1000)
      cancelChime.current()
      cancelChime.current = scheduleChime(left)
      update((d) => {
        d.restEndsAt = Date.now() + left
        d.restTotal = Math.max(d.restTotal ?? 0, Math.ceil(left / 1000))
      })
    },
    stopRest() {
      cancelChime.current()
      update((d) => {
        delete d.restEndsAt
        delete d.restTotal
      })
    },
  }

  if (!loaded) return null
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
