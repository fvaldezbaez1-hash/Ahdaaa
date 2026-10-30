import { useState } from 'react'
import { ExportSheet } from '../library/ExportSheet'
import { editor } from '../state/editor'
import { useSettings } from '../state/settings'
import { Sheet } from '../ui/Sheet'
import { groupsFromParts, PASTE_GROUPS, pasteGroups, type PasteGroup } from './math/paste'
import type { Session } from './session'
import { SHORTCUTS } from './shortcuts'
import { useView, view } from './view'

const PASTE_KEY = 'lumen.editor.pasteGroups'

function rememberedGroups(): PasteGroup[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(PASTE_KEY) ?? 'null')
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

function PasteSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const settings = useSettings()
  const clip = settings?.clipboard
  const [groups, setGroups] = useState<PasteGroup[] | null>(null)
  const chosen = groups ?? rememberedGroups() ?? (clip ? groupsFromParts(clip.parts) : [])
  const toggle = (g: PasteGroup) => setGroups(chosen.includes(g) ? chosen.filter((x) => x !== g) : [...chosen, g])

  const paste = () => {
    const { recipe, kind } = editor.getState()
    if (!clip || !recipe) return
    editor.apply(() => pasteGroups({ recipe, kind, raw: session.record.raw }, clip, chosen), 'Paste settings')
    try {
      localStorage.setItem(PASTE_KEY, JSON.stringify(chosen))
    } catch {
      // Not remembered in private mode; harmless.
    }
    onClose()
  }

  if (settings && !clip) {
    return (
      <Sheet title="Paste settings" onClose={onClose}>
        <p className="muted">Nothing copied yet. Open a photo you like and press ⌘C (Ctrl+C) to copy its settings.</p>
      </Sheet>
    )
  }
  return (
    <Sheet
      title="Paste settings"
      onClose={onClose}
      footer={
        <div className="row between">
          <div className="row">
            <button type="button" className="btn ghost sm" onClick={() => setGroups(PASTE_GROUPS.map((g) => g.id))}>
              All
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setGroups([])}>
              None
            </button>
          </div>
          <button type="button" className="btn primary" disabled={!chosen.length} onClick={paste} autoFocus>
            Paste
          </button>
        </div>
      }
    >
      <p className="muted small" style={{ marginBottom: 10 }}>
        {clip ? `Copied ${new Date(clip.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. ` : ''}White balance carries over between photos of the same kind (RAW or JPEG).
      </p>
      <div className="ed-paste-list">
        {PASTE_GROUPS.map((g) => (
          <label key={g.id} className="ed-check">
            <input type="checkbox" checked={chosen.includes(g.id)} onChange={() => toggle(g.id)} />
            <span>{g.label}</span>
          </label>
        ))}
      </div>
    </Sheet>
  )
}

function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose}>
      <dl className="ed-keys">
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.action}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}

/** Whichever dialog the editor has open. */
export function EditorSheets({ session }: { session: Session }) {
  const sheet = useView((s) => s.sheet)
  const close = () => view.set({ sheet: null })
  if (sheet === 'export') return <ExportSheet ids={[session.id]} onClose={close} />
  if (sheet === 'paste') return <PasteSheet session={session} onClose={close} />
  if (sheet === 'shortcuts') return <ShortcutsSheet onClose={close} />
  return null
}
