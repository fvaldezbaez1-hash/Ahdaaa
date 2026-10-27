import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '../state'
import { Icon, type IconName } from '../ui/Icon'

// A short, swipeable tutorial built from miniature versions of the real
// screens, with numbered markers that the text refers to. It plays once after
// setup and can be replayed from Settings or the help guide.

const Mark = ({ n }: { n: number }) => (
  <span className="mark" aria-hidden="true">
    {n}
  </span>
)

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="tour-frame" aria-hidden="true">
      {children}
    </div>
  )
}

function TabsArt() {
  const tabs: [IconName, string, string][] = [
    ['home', 'Today', 'Your day at a glance'],
    ['dumbbell', 'Workout', 'Plans and logging'],
    ['food', 'Food', 'Your food diary'],
    ['chart', 'Progress', 'Charts and records'],
  ]
  return (
    <Frame>
      <div className="grid-2">
        {tabs.map(([icon, name, text]) => (
          <div key={name} className="stat-tile stack tight" style={{ alignItems: 'flex-start' }}>
            <Icon name={icon} />
            <b>{name}</b>
            <span className="tiny muted">{text}</span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function TodayArt() {
  return (
    <Frame>
      <div className="row" style={{ gap: 14 }}>
        <div className="ring-wrap" style={{ width: 92, height: 92 }}>
          <svg width={92} height={92}>
            <circle cx={46} cy={46} r={40} fill="none" stroke="var(--accent-soft)" strokeWidth={9} />
            <circle cx={46} cy={46} r={40} fill="none" stroke="var(--accent)" strokeWidth={9} strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 40 * 0.32} 999`} transform="rotate(-90 46 46)" />
          </svg>
          <div className="center">
            <span className="tiny muted bold">LEFT</span>
            <b style={{ fontSize: 18 }}>1,360</b>
          </div>
        </div>
        <div className="stack tight grow">
          <div className="row" style={{ gap: 6 }}>
            <Mark n={1} />
            <span className="small">Calories left today</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Mark n={2} />
            <span className="small">Your next workout</span>
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <Mark n={3} />
        <span className="input" style={{ minHeight: 38, padding: '8px 10px', flex: 1, color: 'var(--muted)' }}>
          Today’s weight
        </span>
        <span className="btn primary sm pulse">Log</span>
      </div>
    </Frame>
  )
}

function StartArt() {
  return (
    <Frame>
      <div className="stack tight">
        <div className="row between">
          <b>My routines</b>
          <span className="row small" style={{ gap: 6, color: 'var(--accent)' }}>
            <Mark n={1} /> Programs
          </span>
        </div>
        <div className="stat-tile stack tight">
          <b>Full Body A</b>
          <span className="tiny muted">Squat, Bench Press, Seated Row…</span>
          <div className="row between">
            <span className="tiny muted">Up next</span>
            <span className="row" style={{ gap: 6 }}>
              <Mark n={2} />
              <span className="btn primary sm pulse">
                <Icon name="play" size={12} /> Start
              </span>
            </span>
          </div>
        </div>
      </div>
    </Frame>
  )
}

function SetArt() {
  const cols = '26px minmax(0,1fr) 54px 44px 34px'
  return (
    <Frame>
      <b style={{ color: 'var(--accent)' }}>Bench Press (Barbell)</b>
      <div style={{ ['--set-cols' as string]: cols, marginTop: 6 }}>
        <div className="set-row head" style={{ padding: '2px 0' }}>
          <span>Set</span>
          <span>Prev</span>
          <span>lb</span>
          <span>Reps</span>
          <span>✓</span>
        </div>
        <div className="set-row done" style={{ padding: '2px 0', borderRadius: 8 }}>
          <span className="set-num" style={{ lineHeight: '32px', textAlign: 'center' }}>1</span>
          <span className="prev" style={{ lineHeight: '32px' }}>135×8</span>
          <span className="set-input" style={{ lineHeight: '34px', background: 'transparent' }}>135</span>
          <span className="set-input" style={{ lineHeight: '34px', background: 'transparent' }}>9</span>
          <span className="check on">
            <Icon name="check" size={16} />
          </span>
        </div>
        <div className="set-row" style={{ padding: '2px 0' }}>
          <span className="set-num" style={{ lineHeight: '32px', textAlign: 'center' }}>2</span>
          <span className="prev" style={{ lineHeight: '32px' }}>135×8</span>
          <span className="set-input" style={{ lineHeight: '34px', color: 'var(--muted)', fontWeight: 500 }}>135</span>
          <span className="set-input" style={{ lineHeight: '34px', color: 'var(--muted)', fontWeight: 500 }}>9</span>
          <span className="check pulse">
            <Icon name="check" size={16} />
          </span>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 12, marginTop: 6 }}>
        <span className="row tiny" style={{ gap: 4 }}>
          <Mark n={1} /> grey = suggestion
        </span>
        <span className="row tiny" style={{ gap: 4 }}>
          <Mark n={2} /> tap ✓
        </span>
      </div>
    </Frame>
  )
}

function RestArt() {
  return (
    <Frame>
      <div className="small text-2 row" style={{ gap: 6, alignItems: 'flex-start' }}>
        <Mark n={2} />
        <span>↑ Add weight: you hit 10 reps on every set last time.</span>
      </div>
      <div style={{ marginTop: 12, padding: 10, borderRadius: 14, background: 'var(--surface-2)' }}>
        <div className="meter" style={{ height: 6, marginBottom: 8 }}>
          <i style={{ width: '62%' }} />
        </div>
        <div className="row between">
          <span className="btn sm">−15s</span>
          <span className="stack tight" style={{ alignItems: 'center', gap: 0 }}>
            <span className="tiny muted bold row" style={{ gap: 4 }}>
              <Mark n={1} /> REST
            </span>
            <b style={{ fontSize: 22 }}>1:18</b>
          </span>
          <span className="btn sm">+15s</span>
          <span className="btn sm primary">Skip</span>
        </div>
      </div>
    </Frame>
  )
}

function FoodArt() {
  return (
    <Frame>
      <div className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        <b className="grow">Lunch</b>
        <Mark n={1} />
        <span className="icon-btn accent pulse" style={{ width: 34, height: 34 }}>
          <Icon name="plus" />
        </span>
      </div>
      <div className="search" style={{ marginTop: 10 }}>
        <Icon name="search" size={16} />
        <span className="input" style={{ display: 'block', minHeight: 38, padding: '8px 10px 8px 36px', color: 'var(--muted)' }}>
          chicken breast
        </span>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6 }}>
        <Mark n={2} />
        <span className="btn soft sm grow">
          <Icon name="barcode" size={14} /> Scan
        </span>
        <span className="btn sm grow">
          <Icon name="zap" size={14} /> Quick
        </span>
        <span className="btn sm grow">
          <Icon name="plus" size={14} /> Create
        </span>
      </div>
    </Frame>
  )
}

function TargetsArt() {
  // Weigh-ins drifting down over two weeks (larger y is lower on screen).
  const dots = [36, 42, 34, 46, 48, 42, 54, 51, 58, 56, 62, 59, 66, 64]
  const W = 300
  const H = 110
  const sx = (i: number) => 10 + (i / (dots.length - 1)) * (W - 20)
  let t = dots[0]
  const trend = dots.map((d) => (t += 0.25 * (d - t)))
  return (
    <Frame>
      <div className="row between small">
        <b>Weight trend</b>
        <span className="row" style={{ gap: 4 }}>
          <Mark n={1} /> <span className="muted">dots = weigh-ins</span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', marginTop: 6 }}>
        {dots.map((d, i) => (
          <circle key={i} cx={sx(i)} cy={d} r={3.5} fill="var(--muted)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        <path d={trend.map((y, i) => `${i ? 'L' : 'M'}${sx(i)},${y}`).join('')} fill="none" stroke="var(--s1)" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <div className="row small" style={{ gap: 6, marginTop: 4 }}>
        <Mark n={2} />
        <span>
          Weekly check-in: <b>2,150 kcal</b> a day
        </span>
      </div>
    </Frame>
  )
}

function ReadyArt() {
  const steps = ['Add to home screen', 'Log your weight', 'Choose a workout plan', 'Log something you ate', 'Finish your first workout']
  return (
    <Frame>
      <b className="row" style={{ gap: 8 }}>
        <Icon name="target" /> Getting started
      </b>
      <ol className="checklist" style={{ marginTop: 10, gap: 8 }}>
        {steps.map((s, i) => (
          <li key={s} className={i < 2 ? 'done' : i === 2 ? 'next' : ''}>
            <span className="tick">{i < 2 && <Icon name="check" size={14} />}</span>
            <span className="bold small">{s}</span>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

interface Slide {
  title: string
  art: ReactNode
  text: ReactNode
}

function slides(unit: string): Slide[] {
  return [
    {
      title: 'Welcome to Forge',
      art: <TabsArt />,
      text: <p>Four tabs at the bottom of the screen: <b>Today</b>, <b>Workout</b>, <b>Food</b> and <b>Progress</b>. This quick tour shows you how each one works. It takes about a minute.</p>,
    },
    {
      title: 'Start each day on Today',
      art: <TodayArt />,
      text: (
        <ol>
          <li>How many <b>calories</b> you have left today.</li>
          <li>Your <b>next workout</b>, ready to start.</li>
          <li><b>Weigh in</b> here each morning. It takes 5 seconds and makes your targets smarter.</li>
        </ol>
      ),
    },
    {
      title: 'Start a workout',
      art: <StartArt />,
      text: (
        <ol>
          <li>On the <b>Workout</b> tab, tap <b>Programs</b> and add a ready-made plan (or build your own).</li>
          <li>Tap <b>Start</b> on a routine when you’re at the gym.</li>
        </ol>
      ),
    },
    {
      title: 'Log each set',
      art: <SetArt />,
      text: (
        <ol>
          <li>Type the weight ({unit}) and reps you did. After the first time, Forge fills in <b>grey suggestions</b> from last time.</li>
          <li>Tap <b>✓</b> when the set is done. If the grey numbers are right, you don’t need to type anything.</li>
        </ol>
      ),
    },
    {
      title: 'Rest, then get stronger',
      art: <RestArt />,
      text: (
        <ol>
          <li>The <b>rest timer</b> starts by itself after each set and chimes when it’s time to go again.</li>
          <li>Forge tells you when to <b>add a rep</b> and when to <b>add weight</b>. Tap <b>Finish</b> at the top when you’re done.</li>
        </ol>
      ),
    },
    {
      title: 'Log what you eat',
      art: <FoodArt />,
      text: (
        <ol>
          <li>On the <b>Food</b> tab, tap <b>+</b> next to a meal.</li>
          <li>Search by name, <b>Scan</b> a barcode, <b>Quick</b>-add calories, or <b>Create</b> a food from its label.</li>
        </ol>
      ),
    },
    {
      title: 'Targets that learn',
      art: <TargetsArt />,
      text: (
        <ol>
          <li>Daily weigh-ins jump around. The <b>blue trend line</b> shows where you’re really heading.</li>
          <li>Every week Forge checks what you ate against your trend and <b>updates your calorie target</b>. Just keep logging, even rough guesses.</li>
        </ol>
      ),
    },
    {
      title: 'You’re ready!',
      art: <ReadyArt />,
      text: (
        <p>
          Follow the <b>Getting started</b> checklist on the Today screen. Stuck? Tap <b>?</b> on any screen. Watch this again any time: <b>Settings → Replay tutorial</b>.
        </p>
      ),
    },
  ]
}

export function Tour({ onDone }: { onDone: () => void }) {
  const st = useSettings()
  const list = slides(st.weightUnit)
  const [i, setI] = useState(0)
  const startX = useRef<number | null>(null)
  const last = i === list.length - 1
  const next = () => (last ? onDone() : setI(i + 1))
  const prev = () => setI(Math.max(0, i - 1))

  useEffect(() => {
    document.body.classList.add('locked')
    return () => document.body.classList.remove('locked')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(list.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
      if (e.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.length, onDone])

  const s = list[i]
  return createPortal(
    <div
      className="tour"
      role="dialog"
      aria-modal="true"
      aria-label="Forge tutorial"
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current === null) return
        const dx = e.clientX - startX.current
        startX.current = null
        if (dx < -50) next()
        else if (dx > 50) prev()
      }}
    >
      <div className="tour-top">
        <span className="small muted bold">
          {i + 1} of {list.length}
        </span>
        {!last && (
          <button className="btn ghost sm" onClick={onDone}>
            Skip
          </button>
        )}
      </div>
      <div className="tour-slide" key={i}>
        <div className="tour-art">{s.art}</div>
        <div className="tour-text" aria-live="polite">
          <h2>{s.title}</h2>
          {s.text}
        </div>
      </div>
      <div className="tour-nav">
        <div className="dots grow" style={{ justifyContent: 'flex-start' }}>
          {list.map((_, k) => (
            <i key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        {i > 0 && (
          <button className="btn" onClick={prev}>
            Back
          </button>
        )}
        <button className="btn primary" onClick={next} style={{ minWidth: 110 }}>
          {last ? 'Let’s go' : 'Next'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
