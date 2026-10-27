import { useState, type ReactNode } from 'react'
import { fmtClock } from '../lib/dates'
import { GOAL_LABEL, GOAL_RATES } from '../lib/energy'
import { updateSettings } from '../lib/settings'
import type { Settings } from '../lib/types'
import { fmtKcal } from '../lib/units'
import { navigate } from '../router'
import { useSettings, useTargets } from '../state'
import { Segmented, Toggle } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { Topbar } from '../ui/Topbar'

function Row({ label, children, onClick, hint }: { label: string; children?: ReactNode; onClick?: () => void; hint?: string }) {
  const inner = (
    <>
      <div className="grow">
        <div>{label}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      {children}
      {onClick && <Icon name="right" className="chev" />}
    </>
  )
  return onClick ? (
    <button className="list-row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="list-row">{inner}</div>
  )
}

const REST = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300]

export function isInstalled() {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function InstallSheet({ onClose }: { onClose: () => void }) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return (
    <Sheet title="Add Forge to your home screen" onClose={onClose}>
      <div className="stack">
        <p className="text-2">Forge works like a regular app once it’s on your home screen: full screen, works offline, and your data is kept safe.</p>
        <div className="card stack tight">
          <h3>{ios ? 'iPhone / iPad (Safari)' : 'iPhone / iPad'}</h3>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Open this page in <b>Safari</b>.</li>
            <li>
              Tap the <b>Share</b> button <Icon name="share" size={14} /> (bottom of the screen).
            </li>
            <li>
              Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
          </ol>
        </div>
        <div className="card stack tight">
          <h3>Android (Chrome)</h3>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              Tap the <b>⋮</b> menu (top right).
            </li>
            <li>
              Tap <b>Install app</b> (or <b>Add to Home screen</b>).
            </li>
          </ol>
        </div>
        <p className="small muted">Use the app from the home-screen icon from then on. The browser tab and the installed app keep separate data.</p>
      </div>
    </Sheet>
  )
}

export function SettingsScreen() {
  const st = useSettings()
  const { targets } = useTargets()
  const [install, setInstall] = useState(false)
  const set = (patch: Partial<Settings>) => void updateSettings(patch)
  const goalLabel =
    st.goal.type === 'maintain'
      ? 'Maintain weight'
      : `${GOAL_LABEL[st.goal.type]} · ${GOAL_RATES[st.goal.type].find((r) => r.pct === st.goal.ratePct)?.label ?? `${st.goal.ratePct}%/wk`}`

  return (
    <div className="screen no-tabs">
      <Topbar title="Settings" back="/" />
      <div className="stack loose">
        <section className="stack tight">
          <div className="field-label">Help</div>
          <div className="list">
            <Row label="Replay tutorial" hint="The quick tour of how Forge works (1 minute)" onClick={() => navigate('/tour')} />
            <Row label="How to use Forge" hint="Step-by-step guide to every part of the app" onClick={() => navigate('/help')} />
            <Row
              label="Show tips again"
              hint="Brings back the first-time tips and the Getting started checklist"
              onClick={async () => {
                await updateSettings({ tipsSeen: [], checklistHidden: false })
                toast('Tips are back on')
              }}
            />
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Goals</div>
          <div className="list">
            <Row label="Goals & targets" hint={`${goalLabel} · ${fmtKcal(targets.kcal)} kcal · ${st.nutritionMode === 'coached' ? 'smart' : 'manual'}`} onClick={() => navigate('/settings/goals')} />
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Units</div>
          <div className="list">
            <Row label="Weight">
              <div style={{ width: 130 }}>
                <Segmented value={st.weightUnit} onChange={(weightUnit) => set({ weightUnit })} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
              </div>
            </Row>
            <Row label="Distance & water">
              <div style={{ width: 130 }}>
                <Segmented value={st.distanceUnit} onChange={(distanceUnit) => set({ distanceUnit })} options={[{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }]} />
              </div>
            </Row>
            <Row label="Body measurements">
              <div style={{ width: 130 }}>
                <Segmented value={st.lengthUnit} onChange={(lengthUnit) => set({ lengthUnit })} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} />
              </div>
            </Row>
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Workouts</div>
          <div className="list">
            <Row label="Default rest timer">
              <select className="input" style={{ width: 110, minHeight: 38, padding: '6px 10px' }} value={st.restSec} onChange={(e) => set({ restSec: Number(e.target.value) })} aria-label="Default rest timer">
                {REST.map((r) => (
                  <option key={r} value={r}>
                    {fmtClock(r)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Weekly workout goal">
              <select className="input" style={{ width: 110, minHeight: 38, padding: '6px 10px' }} value={st.weeklyWorkoutGoal} onChange={(e) => set({ weeklyWorkoutGoal: Number(e.target.value) })} aria-label="Weekly workout goal">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} / week
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Log RPE" hint="Rate of perceived exertion (1–10) for each set">
              <Toggle checked={st.showRpe} onChange={(showRpe) => set({ showRpe })} label="Log RPE" />
            </Row>
            <Row label="Keep screen on during workouts">
              <Toggle checked={st.keepAwake} onChange={(keepAwake) => set({ keepAwake })} label="Keep screen on" />
            </Row>
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Food</div>
          <div className="list">
            <Row label="Daily water goal">
              <select className="input" style={{ width: 130, minHeight: 38, padding: '6px 10px' }} value={st.waterGoalMl} onChange={(e) => set({ waterGoalMl: Number(e.target.value) })} aria-label="Daily water goal">
                {(st.distanceUnit === 'mi' ? [48, 64, 80, 96, 112, 128].map((oz) => Math.round(oz * 29.574)) : [1500, 2000, 2500, 3000, 3500, 4000]).concat(st.waterGoalMl).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map((ml) => (
                  <option key={ml} value={ml}>
                    {st.distanceUnit === 'mi' ? `${Math.round(ml / 29.574)} fl oz` : `${ml / 1000} L`}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        </section>

        <section className="stack tight">
          <div className="field-label">Appearance</div>
          <Segmented
            value={st.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </section>

        <section className="stack tight">
          <div className="field-label">Your data</div>
          <div className="list">
            <Row
              label="Backup, import & export"
              hint={st.lastBackupAt ? `Last backup ${new Date(st.lastBackupAt).toLocaleDateString()}` : 'No backup yet'}
              onClick={() => navigate('/settings/data')}
            />
            {!isInstalled() && <Row label="Add to home screen" onClick={() => setInstall(true)} />}
          </div>
        </section>

        <section className="stack tight small text-2">
          <div className="field-label">About</div>
          <p>
            Forge keeps everything on this phone: no account, no ads, no tracking. Food searches and barcode lookups go to{' '}
            <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
              Open Food Facts
            </a>{' '}
            (open data, ODbL). Built-in foods are from USDA FoodData Central.
          </p>
          <p>
            Calorie targets are estimates, not medical advice. If you have a medical condition, are pregnant, or have a history of disordered eating, check with a professional before dieting.
          </p>
        </section>
      </div>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </div>
  )
}
