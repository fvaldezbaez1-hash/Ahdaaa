import type { ProfileId } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { toast } from '../../ui/toast'
import { useSession } from '../session'
import { applyAuto, PROFILES, setProfile, setTreatment } from './actions'

/** Profile, Color / B&W, Auto and Reset all. */
export function ProfileRow() {
  const { engine } = useSession()
  const profile = useEditor((s) => s.recipe?.profile ?? 'color')
  const treatment = useEditor((s) => s.recipe?.treatment ?? 'color')
  return (
    <div className="stack tight ed-profile">
      <div className="row ed-profile-row">
        <label className="field grow ed-compact-field">
          <span>Profile</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileId)}>
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn outline sm ed-auto" title="Auto tone: balanced exposure and contrast" onClick={() => applyAuto(engine) || toast('This photo already looks balanced')}>
          Auto
        </button>
        <button type="button" className="btn ghost sm" title="Back to the photo as imported (undo with ⌘Z)" onClick={() => editor.reset()}>
          Reset
        </button>
      </div>
      <Segmented
        label="Treatment"
        value={treatment}
        onChange={setTreatment}
        className="ed-seg-full"
        options={[
          { value: 'color', label: 'Color' },
          { value: 'bw', label: 'Black & white' },
        ]}
      />
    </div>
  )
}
