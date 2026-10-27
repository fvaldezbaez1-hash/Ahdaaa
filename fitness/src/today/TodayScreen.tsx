import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db } from '../lib/db'
import { addDays, dayKey, fmtDuration, fmtLongDay, startOfWeek, today } from '../lib/dates'
import { sumNutrients } from '../lib/nutrition'
import { workoutStats } from '../lib/strength'
import { weeklyStreak } from '../lib/streaks'
import { trendOn, weeklyRate } from '../lib/trend'
import type { CheckIn, Routine } from '../lib/types'
import { fmtKcal, fmtWeight, kgTo, round, toKg } from '../lib/units'
import { navigate } from '../router'
import { useCheckIns, useExercises, useSettings, useTargets, useWeightTrend, useWorkouts } from '../state'
import { CalorieSummary } from '../food/MacroSummary'
import { WaterCard } from '../food/FoodTab'
import { Sparkline } from '../ui/charts'
import { NumField } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'
import { InstallSheet, isInstalled } from '../settings/SettingsScreen'
import { useBeginWorkout } from '../workout/WorkoutTab'
import { GettingStarted } from '../help/GettingStarted'
import { HelpButton } from '../help/Tip'
import { StrengthCheck } from '../progress/StrengthCheck'

const DISMISS_INSTALL = 'forge:install-dismissed'

function readFlag(k: string) {
  try {
    return localStorage.getItem(k) === '1'
  } catch {
    return false
  }
}

function CheckInCard({ checkIn, previous }: { checkIn: CheckIn; previous?: CheckIn }) {
  const diff = previous ? checkIn.expenditure - previous.expenditure : 0
  const t = checkIn.targets
  return (
    <div className="card stack" style={{ borderColor: 'var(--accent)' }}>
      <div className="row">
        <Icon name="target" />
        <h3 className="grow">Weekly check-in</h3>
      </div>
      <p className="text-2">
        Your estimated expenditure is <b style={{ color: 'var(--text)' }}>{fmtKcal(checkIn.expenditure)} kcal</b> a day
        {previous ? ` (${diff === 0 ? 'no change' : `${diff > 0 ? '+' : '−'}${fmtKcal(Math.abs(diff))}`} since last week)` : ''}.
      </p>
      <p className="text-2">
        New daily targets: <b style={{ color: 'var(--text)' }}>{fmtKcal(t.kcal)} kcal</b> · {t.protein} g protein · {t.carbs} g carbs · {t.fat} g fat.
      </p>
      {checkIn.confidence < 1 && (
        <p className="small muted">
          {checkIn.confidence === 0
            ? 'Still using the starting formula. Log food and weigh in on most days and this switches to your real numbers in a couple of weeks.'
            : 'Partly based on your logs so far. It gets sharper as you keep logging.'}
        </p>
      )}
      <button className="btn primary" onClick={() => void db.checkins.update(checkIn.date, { seen: true })}>
        Got it
      </button>
    </div>
  )
}

function nextRoutine(routines: Routine[], lastRoutineId?: string): Routine | undefined {
  if (!routines.length) return undefined
  const i = routines.findIndex((r) => r.id === lastRoutineId)
  return routines[(i + 1) % routines.length]
}

export function TodayScreen() {
  const st = useSettings()
  const t = today()
  const { targets, checkIn } = useTargets()
  const checkIns = useCheckIns()
  const { map } = useExercises()
  const entries = useLiveQuery(() => db.entries.where('date').equals(t).toArray(), [t])
  const workouts = useWorkouts()
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), [])
  const { body, trend } = useWeightTrend()
  const begin = useBeginWorkout()
  const [weight, setWeight] = useState<number | undefined>()
  const [install, setInstall] = useState(false)
  const [installDismissed, setInstallDismissed] = useState(() => readFlag(DISMISS_INSTALL))

  const totals = sumNutrients((entries ?? []).map((e) => e.n))
  const todays = (workouts ?? []).filter((w) => dayKey(w.start) === t)
  const lastRoutineId = (workouts ?? []).find((w) => w.routineId && routines?.some((r) => r.id === w.routineId))?.routineId
  const upNext = routines ? nextRoutine(routines, lastRoutineId) : undefined
  const { thisWeek, streak } = useMemo(() => weeklyStreak((workouts ?? []).map((w) => w.start), st.weeklyWorkoutGoal, t), [workouts, st.weeklyWorkoutGoal, t])
  const weekStart = startOfWeek(t)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const trainedDays = new Set((workouts ?? []).map((w) => dayKey(w.start)))

  const todayWeigh = body?.find((b) => b.date === t)?.weightKg
  const trendNow = trendOn(trend, t)
  const rate = weeklyRate(trend)
  const spark = trend.slice(-30).map((p) => kgTo(p.trend, st.weightUnit))
  const previousCheckIn = checkIns && checkIn ? checkIns.filter((c) => c.date < checkIn.date).at(-1) : undefined

  const focusWeight = () => {
    const el = document.getElementById('today-weight')
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.focus({ preventScroll: true })
    } else navigate('/progress?tab=body')
  }

  const logWeight = async () => {
    if (!weight) return
    const kg = toKg(weight, st.weightUnit)
    await db.body.put({ ...(await db.body.get(t)), date: t, weightKg: kg })
    setWeight(undefined)
    toast('Weight logged')
  }

  const showBackupNag = (workouts?.length ?? 0) + (entries?.length ?? 0) > 0 && (!st.lastBackupAt || Date.now() - st.lastBackupAt > 30 * 86_400_000) && (workouts?.length ?? 0) >= 5

  return (
    <div className="screen">
      <header className="topbar">
        <div className="grow">
          <h1>Today</h1>
          <div className="small muted">{fmtLongDay(t)}</div>
        </div>
        <HelpButton />
        <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </header>

      <div className="stack">
        <GettingStarted onLogWeight={focusWeight} />

        {!isInstalled() && !installDismissed && st.checklistHidden && (
          <div className="card row" style={{ gap: 12 }}>
            <Icon name="phone" />
            <div className="grow">
              <div className="bold">Add Forge to your home screen</div>
              <div className="small text-2">Full screen, works offline, keeps your data safe.</div>
            </div>
            <button className="btn soft sm" onClick={() => setInstall(true)}>
              How
            </button>
            <button
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => {
                try {
                  localStorage.setItem(DISMISS_INSTALL, '1')
                } catch {
                  // private mode: just hide it for now
                }
                setInstallDismissed(true)
              }}
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}

        {checkIn && !checkIn.seen && st.nutritionMode === 'coached' && <CheckInCard checkIn={checkIn} previous={previousCheckIn} />}

        <div className="card stack">
          <CalorieSummary totals={totals} targets={targets} />
          <button className="btn ghost sm" style={{ padding: 0, alignSelf: 'flex-start', minHeight: 0 }} onClick={() => navigate('/help?s=targets')}>
            <Icon name="help" size={16} /> How is my target worked out?
          </button>
          <div className="grid-2">
            <button className="btn primary" onClick={() => navigate(`/add?date=${t}`)}>
              <Icon name="plus" size={18} /> Log food
            </button>
            <button className="btn" onClick={() => navigate('/food')}>
              Diary
            </button>
          </div>
        </div>

        <div className="card stack">
          <div className="row">
            <Icon name="dumbbell" />
            <h3 className="grow">Training</h3>
            <span className="small text-2">
              {thisWeek}/{st.weeklyWorkoutGoal} this week{streak > 1 ? ` · 🔥 ${streak}-week streak` : ''}
            </span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }} aria-label="This week">
            {weekDays.map((d) => {
              const done = trainedDays.has(d)
              const isToday = d === t
              return (
                <div key={d} className="stack tight" style={{ alignItems: 'center', gap: 4 }}>
                  <span className="tiny muted">{new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  <span
                    aria-label={`${d}${done ? ', trained' : ''}`}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: done ? 'var(--accent)' : 'var(--surface-2)',
                      color: done ? 'var(--accent-ink)' : 'var(--muted)',
                      boxShadow: isToday ? '0 0 0 2px var(--bg), 0 0 0 4px var(--accent)' : undefined,
                    }}
                  >
                    {done && <Icon name="check" size={16} />}
                  </span>
                </div>
              )
            })}
          </div>
          {todays.length > 0 ? (
            todays.map((w) => {
              const s = workoutStats(w, map)
              return (
                <button key={w.id} className="list-row" style={{ border: '1px solid var(--border)', borderRadius: 12 }} onClick={() => navigate(`/history/${w.id}`)}>
                  <Icon name="check" />
                  <div className="grow">
                    <div className="bold ellipsis">{w.name}</div>
                    <div className="small muted">
                      {fmtDuration(s.durationSec)} · {s.sets} sets · {fmtWeight(s.volume, st.weightUnit)}
                    </div>
                  </div>
                  <Icon name="right" className="chev" />
                </button>
              )
            })
          ) : upNext ? (
            <div className="stack tight">
              <div className="small muted">Up next</div>
              <div className="row">
                <div className="grow">
                  <div className="bold ellipsis">{upNext.name}</div>
                  <div className="small text-2 ellipsis">{upNext.exercises.map((e) => map.get(e.exerciseId)?.name).filter(Boolean).join(', ')}</div>
                </div>
                <button className="btn primary sm" onClick={() => begin(upNext)}>
                  <Icon name="play" size={14} /> Start
                </button>
              </div>
            </div>
          ) : (
            <div className="grid-2">
              <button className="btn primary" onClick={() => begin()}>
                <Icon name="play" size={14} /> Start workout
              </button>
              <button className="btn" onClick={() => navigate('/programs')}>
                Programs
              </button>
            </div>
          )}
        </div>

        <StrengthCheck />

        <div className="card stack">
          <div className="row">
            <Icon name="scale" />
            <h3 className="grow">Weight</h3>
            <button className="btn ghost sm" onClick={() => navigate('/progress?tab=body')}>
              Progress
            </button>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="stat grow">
              <span className="label">Trend weight</span>
              <span className="value">{trendNow !== undefined ? fmtWeight(trendNow, st.weightUnit) : '–'}</span>
              {rate !== undefined && trend.length >= 7 && (
                <span className="small text-2">
                  {rate === 0 ? 'Holding steady' : `${rate > 0 ? '+' : '−'}${fmtWeight(Math.abs(rate), st.weightUnit)} / week`}
                </span>
              )}
            </div>
            <Sparkline values={spark} width={110} height={40} />
          </div>
          {todayWeigh !== undefined ? (
            <p className="small text-2">
              Today’s weigh-in: <b style={{ color: 'var(--text)' }}>{fmtWeight(todayWeigh, st.weightUnit)}</b>
            </p>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                void logWeight()
              }}
            >
              <div className="input-unit grow">
                <NumField
                  id="today-weight"
                  className="input"
                  dp={1}
                  value={weight}
                  onChange={setWeight}
                  placeholder={trendNow !== undefined ? String(round(kgTo(trendNow, st.weightUnit), 1)) : 'Today’s weight'}
                  aria-label={`Today’s weight in ${st.weightUnit}`}
                />
                <em>{st.weightUnit}</em>
              </div>
              <button className="btn primary" type="submit" disabled={!weight}>
                Log
              </button>
            </form>
          )}
        </div>

        <WaterCard date={t} />

        {st.nutritionMode === 'coached' && checkIn && (
          <button className="card tap stack tight" onClick={() => navigate('/progress?tab=nutrition')}>
            <div className="row">
              <Icon name="flame" />
              <h3 className="grow">Your expenditure</h3>
              <Icon name="right" className="chev" />
            </div>
            <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 750 }}>{fmtKcal(checkIn.expenditure)}</span>
              <span className="text-2 small">kcal / day</span>
            </div>
            <p className="small muted">
              {checkIn.confidence === 0
                ? 'Starting estimate. It learns your real metabolism from your food logs and weigh-ins.'
                : `Learned from your logs (${Math.round(checkIn.confidence * 100)}% confidence). Next check-in ${new Date(`${addDays(checkIn.date, 7)}T12:00`).toLocaleDateString(undefined, { weekday: 'long' })}.`}
            </p>
          </button>
        )}

        {showBackupNag && (
          <button className="card tap row" style={{ gap: 12 }} onClick={() => navigate('/settings/data')}>
            <Icon name="download" />
            <div className="grow">
              <div className="bold">Back up your data</div>
              <div className="small text-2">{st.lastBackupAt ? 'It’s been over a month since your last backup.' : 'Your data only lives on this phone. Save a copy.'}</div>
            </div>
            <Icon name="right" className="chev" />
          </button>
        )}
      </div>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </div>
  )
}
