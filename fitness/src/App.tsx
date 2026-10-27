import { useEffect } from 'react'
import { fmtClock } from './lib/dates'
import { navigate, useRoute } from './router'
import { FoodTab } from './food/FoodTab'
import { AddFoodScreen } from './food/AddFood'
import { Onboarding } from './settings/Onboarding'
import { SettingsScreen } from './settings/SettingsScreen'
import { DataScreen } from './settings/DataScreen'
import { GoalsScreen } from './settings/GoalsScreen'
import { ProgressTab } from './progress/ProgressTab'
import { TodayScreen } from './today/TodayScreen'
import { GuideScreen } from './help/GuideScreen'
import { useSettings } from './state'
import { Icon, type IconName } from './ui/Icon'
import { useNow } from './ui/hooks'
import { useActive } from './workout/active'
import { ExerciseDetail, ExercisesScreen } from './workout/ExerciseDetail'
import { HistoryScreen, SummaryScreen, WorkoutDetail } from './workout/History'
import { LoggerScreen } from './workout/Logger'
import { ProgramsScreen, RoutineEditor } from './workout/RoutineEditor'
import { WorkoutTab } from './workout/WorkoutTab'

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Today', icon: 'home' },
  { path: '/workout', label: 'Workout', icon: 'dumbbell' },
  { path: '/food', label: 'Food', icon: 'food' },
  { path: '/progress', label: 'Progress', icon: 'chart' },
]

function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const on = t.path === '/' ? path === '/' : path.startsWith(t.path)
        return (
          <a
            key={t.path}
            href={`#${t.path}`}
            className={on ? 'on' : ''}
            aria-current={on ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              navigate(t.path, { replace: true })
            }}
          >
            <Icon name={t.icon} size={24} />
            {t.label}
          </a>
        )
      })}
    </nav>
  )
}

function WorkoutBar() {
  const { active } = useActive()
  const now = useNow(1000)
  if (!active) return null
  const rest = active.restEndsAt ? Math.max(0, (active.restEndsAt - now) / 1000) : 0
  return (
    <div className="workout-bar">
      <button onClick={() => navigate('/active')}>
        <Icon name="dumbbell" />
        <span className="grow ellipsis bold">{active.editingId ? 'Editing workout' : active.name}</span>
        <span className="tnum bold">{rest > 0 ? `Rest ${fmtClock(Math.ceil(rest))}` : active.editingId ? '' : fmtClock((now - active.start) / 1000)}</span>
        <Icon name="up" size={18} />
      </button>
    </div>
  )
}

export function App() {
  const st = useSettings()
  const { path, parts, query } = useRoute()
  const { active } = useActive()

  useEffect(() => {
    // Keep the browser chrome color in step with the theme.
    const dark = st.theme === 'dark' || (st.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (st.theme === 'system') m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#0d0d0d' : '#f2f2ef')
      else m.setAttribute('content', dark ? '#0d0d0d' : '#f2f2ef')
    })
  }, [st.theme])

  if (!st.onboarded) return <Onboarding />

  let screen: React.ReactNode
  let tabs = true
  const [a, b] = parts
  switch (a) {
    case undefined:
      screen = <TodayScreen />
      break
    case 'workout':
      screen = <WorkoutTab />
      break
    case 'food':
      screen = <FoodTab date={query.get('date') ?? undefined} />
      break
    case 'add':
      screen = <AddFoodScreen meal={query.get('meal') ?? undefined} date={query.get('date') ?? undefined} />
      tabs = false
      break
    case 'progress':
      screen = <ProgressTab tab={query.get('tab') ?? undefined} />
      break
    case 'active':
      screen = <LoggerScreen />
      tabs = false
      break
    case 'routine':
      screen = <RoutineEditor id={b ?? 'new'} key={b} />
      tabs = false
      break
    case 'programs':
      screen = <ProgramsScreen />
      tabs = false
      break
    case 'history':
      screen = b ? <WorkoutDetail id={b} key={b} /> : <HistoryScreen />
      tabs = false
      break
    case 'summary':
      screen = <SummaryScreen id={b} key={b} />
      tabs = false
      break
    case 'exercise':
      screen = <ExerciseDetail id={b} key={b} />
      tabs = false
      break
    case 'exercises':
      screen = <ExercisesScreen />
      tabs = false
      break
    case 'help':
      screen = <GuideScreen open={query.get('s') ?? undefined} />
      tabs = false
      break
    case 'settings':
      screen = b === 'data' ? <DataScreen /> : b === 'goals' ? <GoalsScreen /> : <SettingsScreen />
      tabs = false
      break
    default:
      screen = <TodayScreen />
  }

  return (
    <>
      <main key={path}>{screen}</main>
      {tabs && active && <WorkoutBar />}
      {tabs && <TabBar path={path} />}
    </>
  )
}
