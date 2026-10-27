import { useMemo } from 'react'
import { isCut } from '../lib/energy'
import { strengthTrend } from '../lib/strength'
import { fmtNum } from '../lib/units'
import { navigate } from '../router'
import { useExercises, useSettings, useWorkouts } from '../state'
import { Icon } from '../ui/Icon'

/**
 * While cutting, compares recent strength with the month before. Shown on
 * Today and in Progress → Training. Status is always icon + words, never
 * color alone.
 */
export function StrengthCheck({ always }: { always?: boolean }) {
  const st = useSettings()
  const { map } = useExercises()
  const workouts = useWorkouts()
  const trend = useMemo(() => (workouts ? strengthTrend(workouts, map) : undefined), [workouts, map])
  if (!isCut(st.goal.type) && !always) return null

  if (!trend) {
    if (!always && (workouts?.length ?? 0) === 0) return null
    return (
      <div className="card stack tight">
        <div className="row">
          <Icon name="dumbbell" />
          <h3 className="grow">Strength check</h3>
        </div>
        <p className="small text-2">
          After a few weeks of logging the same lifts, Forge compares your strength with the month before. If it starts dropping (an early sign of losing muscle), you’ll see it here.
        </p>
      </div>
    )
  }

  const c = trend.changePct
  const status = c >= -2 ? 'good' : c >= -5 ? 'watch' : 'bad'
  const names = trend.down.map((id) => map.get(id)?.name).filter(Boolean)
  const change = c === 0 ? 'the same as' : `${c > 0 ? 'up' : 'down'} ${fmtNum(Math.abs(c), 1)}% vs`
  return (
    <div className="card stack tight">
      <div className="row">
        <Icon name="dumbbell" />
        <h3 className="grow">Strength check</h3>
        <span className={status === 'good' ? 'badge good' : status === 'watch' ? 'badge pr' : 'badge bad'}>
          {status === 'good' ? (
            <>
              <Icon name="check" size={12} /> Holding strong
            </>
          ) : status === 'watch' ? (
            'Keep an eye on it'
          ) : (
            'Strength dropping'
          )}
        </span>
      </div>
      <p className="small text-2">
        Your lifts are <b style={{ color: 'var(--text)' }}>{change} the month before</b> ({trend.lifts} lifts compared, based on estimated 1-rep max).
      </p>
      {status === 'good' && isCut(st.goal.type) && <p className="small text-2">Holding strength while losing weight means you’re keeping your muscle. Keep it up.</p>}
      {status === 'watch' && (
        <p className="small text-2">A small dip can be a bad day or poor sleep. Hit your protein, keep the weights heavy, and check again next week.</p>
      )}
      {status === 'bad' && (
        <>
          <p className="small text-2">
            You may be losing muscle{names.length ? ` (biggest drops: ${names.slice(0, 3).join(', ')})` : ''}. Slow the cut down, hit your protein every day, and get enough sleep.
          </p>
          {isCut(st.goal.type) && (
            <button className="btn soft sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/settings/goals')}>
              Change my pace
            </button>
          )}
        </>
      )}
    </div>
  )
}
