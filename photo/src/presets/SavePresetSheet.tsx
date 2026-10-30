import { useState } from 'react'
import { editor } from '../state/editor'
import { Field } from '../ui/controls'
import { Sheet } from '../ui/Sheet'
import { toast } from '../ui/toast'
import { addUserPreset, DEFAULT_SAVE_GROUPS, presetFromRecipe, SAVE_GROUPS, type SaveGroup } from './store'

/** Save the photo's current settings (the chosen groups) as a preset in My presets. */
export function SavePresetSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const { recipe, kind, asShot } = editor.getState()
  const [name, setName] = useState(recipe?.look ? `${recipe.look.name} (my edit)` : 'My preset')
  const [groups, setGroups] = useState<SaveGroup[]>(DEFAULT_SAVE_GROUPS)
  const [busy, setBusy] = useState(false)
  const toggle = (g: SaveGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))

  const save = async () => {
    if (!recipe || !groups.length) return
    setBusy(true)
    try {
      const id = await addUserPreset({ name: name.trim() || 'My preset', collection: 'mine', source: 'user', description: 'Saved from your own edit.', tags: ['mine'], data: presetFromRecipe(recipe, kind, asShot, groups) })
      toast(`Saved “${name.trim() || 'My preset'}” to My presets`)
      onSaved?.(id)
      onClose()
    } catch (e) {
      toast(`Couldn’t save the preset: ${e instanceof Error ? e.message : String(e)}`, 4000)
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Save as preset"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || !groups.length || !recipe} onClick={save}>
            Save preset
          </button>
        </div>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Name">
          <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
        <fieldset className="pp-groups">
          <legend className="label">Include</legend>
          {SAVE_GROUPS.map((g) => (
            <label key={g.id} className="pp-check">
              <input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggle(g.id)} />
              {g.label}
            </label>
          ))}
        </fieldset>
        <p className="muted small">White balance is saved as a shift (warmer, cooler), so the preset suits photos taken in other light.</p>
      </form>
    </Sheet>
  )
}
