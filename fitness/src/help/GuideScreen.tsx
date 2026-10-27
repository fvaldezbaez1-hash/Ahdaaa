import { useEffect, type ReactNode } from 'react'
import { navigate } from '../router'
import { useSettings } from '../state'
import { Icon } from '../ui/Icon'
import { Topbar } from '../ui/Topbar'

interface Section {
  id: string
  title: string
  body: ReactNode
  go?: { label: string; to: string }
}

function sections(lb: boolean): Section[] {
  const u = lb ? 'lb' : 'kg'
  const step = lb ? '5 lb' : '2.5 kg'
  return [
    {
      id: 'start',
      title: 'Getting started',
      body: (
        <>
          <ol>
            <li>
              <b>Add Forge to your home screen</b> and always open it from there. On iPhone: Safari → Share → Add to Home Screen. On Android: Chrome → ⋮ → Install app.
            </li>
            <li>
              <b>Every morning:</b> weigh yourself and type it into the Weight card on the <b>Today</b> tab.
            </li>
            <li>
              <b>When you eat:</b> log it on the <b>Food</b> tab. Rough guesses are fine.
            </li>
            <li>
              <b>When you train:</b> start a workout on the <b>Workout</b> tab.
            </li>
          </ol>
          <p>The “Getting started” checklist on the Today tab walks you through each of these once.</p>
        </>
      ),
    },
    {
      id: 'tabs',
      title: 'What’s on each tab',
      body: (
        <ul>
          <li>
            <b>Today</b>: calories left, today’s workout, your weight trend and water. The gear (top right) opens Settings.
          </li>
          <li>
            <b>Workout</b>: your routines, ready-made programs, past workouts, and the exercise library.
          </li>
          <li>
            <b>Food</b>: your food diary, split into breakfast, lunch, dinner and snacks. Use the arrows at the top to change the day.
          </li>
          <li>
            <b>Progress</b>: charts for your body (weight, measurements, photos), training and nutrition.
          </li>
        </ul>
      ),
    },
    {
      id: 'workout',
      title: 'Logging a workout',
      go: { label: 'Go to workouts', to: '/workout' },
      body: (
        <>
          <ol>
            <li>
              On the <b>Workout</b> tab, tap <b>Start</b> on a routine, or <b>Start empty workout</b> and then <b>Add exercise</b>.
            </li>
            <li>
              Each row is one set. <b>{u.toUpperCase()}</b> is the weight and <b>REPS</b> is how many times you lifted it.
            </li>
            <li>
              <b>Grey numbers are suggestions</b>, based on what you did last time. If you did exactly that, just tap <b>✓</b> and Forge fills them in. If not, type your real numbers first.
            </li>
            <li>
              Tapping <b>✓</b> marks the set done and starts the <b>rest timer</b> at the bottom (−15s, +15s or Skip). It chimes when rest is over.
            </li>
            <li>
              When you’re finished, tap <b>Finish</b> at the top. Sets you didn’t tick are left out.
            </li>
          </ol>
          <p>Handy extras:</p>
          <ul>
            <li>
              <b>PREVIOUS</b> shows last time’s set. Tap it to copy it.
            </li>
            <li>
              Tap the <b>set number</b> to mark it as a warm-up (W), drop set (D) or to-failure set (F), or to delete it.
            </li>
            <li>
              Tap <b>⋯</b> next to an exercise for notes, rest time, rep range, supersets, swapping or removing it.
            </li>
            <li>
              Tap <b>⌄</b> (top left) to leave the workout open while you check something else. The blue bar at the bottom brings you back.
            </li>
            <li>A 🏆 means you beat a personal record.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'progression',
      title: 'When should I add weight?',
      body: (
        <>
          <p>
            Each exercise in a program has a <b>rep range</b>, like 8–12 reps. Forge uses it to tell you what to aim for:
          </p>
          <ul>
            <li>Until you reach the top of the range, aim for <b>one more rep</b> than last time.</li>
            <li>
              Once you hit the top of the range on <b>every</b> set, Forge suggests <b>adding weight</b> ({step} for most lifts, more for squats and deadlifts) and starting again at the bottom of the range.
            </li>
          </ul>
          <p>
            The suggestion shows as grey numbers in each set, with a note under the exercise name. Change the range from <b>⋯ → Rest timer &amp; rep range</b>.
          </p>
        </>
      ),
    },
    {
      id: 'routines',
      title: 'Programs and routines',
      go: { label: 'See programs', to: '/programs' },
      body: (
        <ul>
          <li>
            A <b>routine</b> is a saved workout (for example “Push Day”). A <b>program</b> is a set of routines that work together.
          </li>
          <li>
            Not sure where to start? <b>Full Body Beginner</b> (gym), <b>Dumbbells at Home</b> or <b>No Equipment</b>, three days a week.
          </li>
          <li>
            Adding a program copies its routines into <b>My routines</b>. Change anything with <b>⋯ → Edit routine</b>.
          </li>
          <li>The Today tab shows which routine is up next, in order.</li>
          <li>After a workout where you added exercises or sets, Forge offers to add those changes to the routine.</li>
        </ul>
      ),
    },
    {
      id: 'food',
      title: 'Logging food',
      go: { label: 'Go to food diary', to: '/food' },
      body: (
        <>
          <ol>
            <li>
              On the <b>Food</b> tab, tap <b>+</b> next to a meal.
            </li>
            <li>
              Then either:
              <ul>
                <li>
                  <b>Type to search.</b> Common foods show up straight away. For brands, tap <b>Search Open Food Facts</b>.
                </li>
                <li>
                  <b>Scan</b> a packaged food’s barcode.
                </li>
                <li>
                  <b>Quick</b> to type in just the calories (and macros if you know them). Good for restaurants.
                </li>
                <li>
                  <b>Create</b> a food from its nutrition label. Forge remembers it.
                </li>
              </ul>
            </li>
            <li>
              Pick the amount (servings or grams) and tap <b>Add</b>. You can keep adding, then tap <b>Done</b>.
            </li>
          </ol>
          <ul>
            <li>Tap a food in your diary to change the amount, move it to another meal, or delete it.</li>
            <li>
              <b>⋯</b> next to a meal: copy it from yesterday, or save it as a meal to log again in one tap (under <b>Meals</b>).
            </li>
            <li>
              Tap <b>☆</b> on a food to keep it in <b>Favorites</b>.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'targets',
      title: 'How your calorie target works',
      go: { label: 'Goals & targets', to: '/settings/goals' },
      body: (
        <>
          <p>
            To start with, Forge estimates how much you burn from your age, height, weight and activity, then adds or subtracts calories for your goal.
          </p>
          <p>
            <b>Every week</b> it does a check-in. It compares what you ate with how your weight trend moved. For example, if you ate about 2,300 a day and your weight held steady, you burn about 2,300. Your targets are then updated for the week ahead.
          </p>
          <p>To get the most out of it:</p>
          <ul>
            <li>Log everything you eat, even rough guesses. Days with almost nothing logged are ignored.</li>
            <li>Weigh in most mornings.</li>
            <li>Ignore daily ups and downs. Forge uses the trend, not single weigh-ins.</li>
          </ul>
          <p>It settles after 2–3 weeks. Prefer fixed numbers? Choose “Set my own” in Goals &amp; targets.</p>
        </>
      ),
    },
    {
      id: 'progress',
      title: 'Tracking your progress',
      go: { label: 'Go to progress', to: '/progress' },
      body: (
        <ul>
          <li>
            On the weight chart, <b>dots</b> are your daily weigh-ins and the <b>blue line</b> is your trend. Watch the line. Daily jumps are mostly water.
          </li>
          <li>
            Log <b>measurements</b> (waist, arms, …) and <b>progress photos</b>. They show changes the scale misses, especially while building muscle.
          </li>
          <li>
            <b>Training</b> shows how often you train, your consistency, sets per muscle and your new records.
          </li>
          <li>
            Tap any exercise name to see its chart and best lifts.
          </li>
        </ul>
      ),
    },
    {
      id: 'data',
      title: 'Your data and backups',
      go: { label: 'Back up now', to: '/settings/data' },
      body: (
        <ul>
          <li>Everything is stored only on this phone. There’s no account and nothing to sign in to.</li>
          <li>
            Save a <b>backup</b> about once a month (Settings → Backup, import &amp; export). Keep it in iCloud Drive, Google Drive or email. It restores everything on any phone.
          </li>
          <li>
            Coming from <b>Hevy</b> or <b>Strong</b>? Export your workouts there and import the file in the same place.
          </li>
        </ul>
      ),
    },
    {
      id: 'faq',
      title: 'Something isn’t working',
      body: (
        <ul>
          <li>
            <b>The barcode camera won’t open:</b> allow camera access when asked. If you said no, re-allow it in your phone’s settings. You can also type the barcode number instead.
          </li>
          <li>
            <b>A food isn’t found:</b> tap <b>Create</b> and copy the label once. It’s saved for next time.
          </li>
          <li>
            <b>The rest timer didn’t beep:</b> on iPhone it only plays while Forge is open. The screen stays on during workouts so you can leave it open.
          </li>
          <li>
            <b>My data is gone:</b> on iPhone, Safari and the home-screen app keep separate data. Open Forge from the same place you set it up, or restore a backup.
          </li>
          <li>
            <b>Wrong units:</b> Settings → Units.
          </li>
        </ul>
      ),
    },
  ]
}

export function GuideScreen({ open }: { open?: string }) {
  const st = useSettings()
  const list = sections(st.weightUnit === 'lb')

  useEffect(() => {
    if (!open) return
    const el = document.getElementById(`guide-${open}`)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [open])

  return (
    <div className="screen no-tabs">
      <Topbar title="How to use Forge" back="/" />
      <div className="stack">
        <button className="btn primary block" onClick={() => navigate('/tour')}>
          <Icon name="play" size={14} /> Replay the tutorial
        </button>
        <p className="text-2">Or tap a topic below to read about it.</p>
        {list.map((s) => (
          <details key={s.id} id={`guide-${s.id}`} className="card guide" open={s.id === open}>
            <summary>
              <span className="grow">{s.title}</span>
              <Icon name="down" size={18} className="chev" />
            </summary>
            <div className="guide-body">
              {s.body}
              {s.go && (
                <button className="btn soft sm" onClick={() => navigate(s.go!.to)}>
                  {s.go.label} <Icon name="right" size={16} />
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
