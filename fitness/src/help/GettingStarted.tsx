import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../lib/db'
import { updateSettings } from '../lib/settings'
import { navigate } from '../router'
import { InstallSheet, isInstalled } from '../settings/SettingsScreen'
import { useSettings } from '../state'
import { Icon } from '../ui/Icon'

interface Step {
  id: string
  done: boolean
  title: string
  text: string
  action: string
  go: () => void
}

/** Today-screen checklist that walks a new user through the basics, ticking itself off. */
export function GettingStarted({ onLogWeight }: { onLogWeight: () => void }) {
  const st = useSettings()
  const [install, setInstall] = useState(false)
  const counts = useLiveQuery(
    async () => ({
      weighIns: await db.body.filter((b) => !!b.weightKg).count(),
      entries: await db.entries.count(),
      routines: await db.routines.count(),
      workouts: await db.workouts.count(),
    }),
    [],
  )
  if (!counts || st.checklistHidden) return null

  const installed = isInstalled()
  const steps: Step[] = [
    {
      id: 'install',
      done: installed,
      title: 'Add Forge to your home screen',
      text: 'It then opens full screen like a normal app and works offline. On iPhone, do this first: the home-screen app keeps its own data, separate from Safari.',
      action: 'Show me how',
      go: () => setInstall(true),
    },
    {
      id: 'weight',
      done: counts.weighIns > 0,
      title: 'Log your weight',
      text: 'Weigh yourself in the morning and type it in below. Doing this most days is what makes your calorie target smart.',
      action: 'Log weight',
      go: onLogWeight,
    },
    {
      id: 'plan',
      done: counts.routines > 0,
      title: 'Choose a workout plan',
      text: 'Pick a ready-made program (there’s one for beginners, home and gym), or build your own.',
      action: 'See programs',
      go: () => navigate('/programs'),
    },
    {
      id: 'food',
      done: counts.entries > 0,
      title: 'Log something you ate',
      text: 'Search for a food, scan its barcode, or just type in the calories.',
      action: 'Log food',
      go: () => navigate('/add'),
    },
    {
      id: 'workout',
      done: counts.workouts > 0,
      title: 'Finish your first workout',
      text: 'Start a routine, tap ✓ after each set (the rest timer starts on its own), then tap Finish.',
      action: 'Go to workouts',
      go: () => navigate('/workout'),
    },
  ]
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const next = steps.find((s) => !s.done)

  return (
    <section className="card stack" aria-label="Getting started">
      <div className="row">
        <Icon name="target" />
        <h3 className="grow">Getting started</h3>
        <span className="small text-2 tnum">
          {done} of {steps.length} done
        </span>
      </div>
      <div className="meter" role="progressbar" aria-valuenow={done} aria-valuemax={steps.length} aria-label="Getting started progress">
        <i style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="checklist">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : s === next ? 'next' : ''}>
            <span className="tick" aria-hidden="true">
              {s.done ? <Icon name="check" size={16} /> : null}
            </span>
            <div className="grow">
              <div className="bold">
                {s.title}
                <span className="sr-only">{s.done ? ' (done)' : ''}</span>
              </div>
              {!s.done && <p className="small text-2">{s.text}</p>}
              {!s.done && (
                <button className={s === next ? 'btn primary sm' : 'btn soft sm'} style={{ marginTop: 8 }} onClick={s.go}>
                  {s.action}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="row between">
        <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => navigate('/help')}>
          <Icon name="help" size={16} /> How to use Forge
        </button>
        <button className="btn ghost sm" style={{ color: 'var(--muted)' }} onClick={() => void updateSettings({ checklistHidden: true })}>
          Hide
        </button>
      </div>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </section>
  )
}
