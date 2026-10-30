import { useRef, useState } from 'react'
import { version } from '../../package.json'
import { AiSettings } from '../assistant/AiSettings'
import type { ExportOptions } from '../io/types'
import { ExportFields } from '../library/ExportFields'
import { MOD } from '../library/platform'
import { updateSettings, useSettings, type Settings } from '../state/settings'
import { Icon, type IconName } from '../ui/Icon'
import { Segmented, Spinner } from '../ui/controls'
import { useIsPhone } from '../ui/hooks'
import { StorageSection } from './StorageSection'
import './settings.css'

const THEMES: { value: Settings['theme']; label: React.ReactNode }[] = [
  {
    value: 'dark',
    label: (
      <>
        <Icon name="moon" size={15} />
        Dark
      </>
    ),
  },
  {
    value: 'light',
    label: (
      <>
        <Icon name="sun" size={15} />
        Light
      </>
    ),
  },
  {
    value: 'system',
    label: (
      <>
        <Icon name="settings" size={15} />
        System
      </>
    ),
  },
]

const SHORTCUTS: { keys: string[][]; what: string }[] = [
  { keys: [['←'], ['→'], ['↑'], ['↓']], what: 'Move between photos' },
  { keys: [['Shift', 'arrows']], what: 'Extend the selection' },
  {
    keys: [
      [MOD, 'click'],
      ['Shift', 'click'],
    ],
    what: 'Add one photo / a range to the selection',
  },
  { keys: [[MOD, 'A']], what: 'Select all photos in view' },
  { keys: [['0', 'to', '5']], what: 'Set the star rating' },
  { keys: [['P'], ['X'], ['U']], what: 'Pick, reject, clear the flag' },
  { keys: [['Enter']], what: 'Edit the photo (or double-click it)' },
  {
    keys: [
      [MOD, 'C'],
      [MOD, 'V'],
    ],
    what: 'Copy edits from a photo / paste them onto the selection (crop is left alone)',
  },
  { keys: [['Delete']], what: 'Delete the selected photos (asks first)' },
  { keys: [['Esc']], what: 'Clear the selection' },
]

/** Words shown between keys rather than as keys. */
const WORDS = new Set(['click', 'arrows', 'to'])

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'ai', label: 'AI assistant', icon: 'sparkle' },
  { id: 'export', label: 'Export', icon: 'download' },
  { id: 'storage', label: 'Storage & backup', icon: 'folder' },
  { id: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard' },
  { id: 'about', label: 'About & privacy', icon: 'lock' },
]

export function SettingsScreen() {
  const settings = useSettings()
  const phone = useIsPhone()
  const [current, setCurrent] = useState('appearance')
  const [draft, setDraft] = useState<ExportOptions | null>(null)

  // A section picked in the nav stays highlighted while the page scrolls to it (the last ones can't reach the top).
  const pinnedUntil = useRef(0)
  const go = (id: string, at: number) => {
    setCurrent(id)
    pinnedUntil.current = at + 1000
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
  const sections = phone ? SECTIONS.filter((s) => s.id !== 'keys') : SECTIONS

  // Highlight the section being read: the last one whose heading has reached the top.
  const spy = (el: HTMLElement, at: number) => {
    if (at < pinnedUntil.current) return
    const top = el.getBoundingClientRect().top + 120
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    let id = sections[0].id
    for (const s of sections) if ((document.getElementById(`set-${s.id}`)?.getBoundingClientRect().top ?? Infinity) < top) id = s.id
    setCurrent(atEnd ? sections[sections.length - 1].id : id)
  }

  return (
    <div className="settings scroll" onScroll={(e) => spy(e.currentTarget, e.timeStamp)}>
      <div className="settings-inner">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          {sections.map((s) => (
            <button key={s.id} type="button" aria-current={current === s.id ? 'true' : undefined} onClick={(e) => go(s.id, e.timeStamp)}>
              <Icon name={s.icon} size={16} />
              {s.label}
            </button>
          ))}
        </nav>

        {!settings ? (
          <Spinner label="Loading settings" />
        ) : (
          <div className="settings-main">
            <Section id="appearance" title="Appearance" desc="Dark keeps the interface from coloring how you judge a photo. System follows your device.">
              <Segmented className="theme-seg" label="Theme" value={settings.theme} options={THEMES} onChange={(theme) => void updateSettings({ theme })} />
            </Section>

            <Section id="ai" title="AI assistant" desc="Describe a look in words and the assistant moves the real sliders. It uses your own API key.">
              <div className="set-card">
                <AiSettings />
              </div>
            </Section>

            <Section id="export" title="Export defaults" desc="Used every time you export. You can still change them in the export window.">
              <div className="set-card">
                <ExportFields
                  value={draft ?? settings.export}
                  onChange={setDraft}
                  onCommit={(v) => {
                    setDraft(v)
                    void updateSettings({ export: v }).then(() => setDraft(null))
                  }}
                />
              </div>
            </Section>

            <Section id="storage" title="Storage & backup" desc="Your library lives in this browser’s storage on this device.">
              <StorageSection />
            </Section>

            {!phone && (
              <Section id="keys" title="Keyboard shortcuts" desc="In the library. Shortcuts pause while you type in a field.">
                <div className="set-card">
                  <dl className="keys">
                    {SHORTCUTS.map((s) => (
                      <div key={s.what} style={{ display: 'contents' }}>
                        <dt>
                          {s.keys.map((combo, i) => (
                            <span key={i} className="row" style={{ gap: 3 }}>
                              {i > 0 && <span className="muted">/</span>}
                              {combo.map((k) =>
                                WORDS.has(k) ? (
                                  <span key={k} className="muted small">
                                    {k}
                                  </span>
                                ) : (
                                  <kbd key={k}>{k}</kbd>
                                ),
                              )}
                            </span>
                          ))}
                        </dt>
                        <dd>{s.what}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Section>
            )}

            <Section id="about" title="About & privacy">
              <div className="set-card about">
                <p>
                  <b>Everything stays on this device.</b> Your originals, edits, presets and settings are stored in this browser and never uploaded. Lumen has no account and no
                  tracking, and works offline once installed.
                </p>
                <ul>
                  <li>Originals are never changed: edits are saved as instructions and applied when you view or export.</li>
                  <li>
                    The AI assistant is off until you add a key. When you use it, only a small preview of the photo (about 1,000 px) and your request go to the provider you chose.
                  </li>
                  <li>API keys are stored only on this device.</li>
                </ul>
                <hr />
                <div className="set-row">
                  <span className="lbl">
                    <b>Lumen {version}</b>
                    <small>Private RAW photo editor for every camera</small>
                  </span>
                </div>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={`set-${id}`} className="set-section" aria-labelledby={`set-${id}-title`}>
      <header>
        <h2 id={`set-${id}-title`}>{title}</h2>
        {desc && <p>{desc}</p>}
      </header>
      {children}
    </section>
  )
}
