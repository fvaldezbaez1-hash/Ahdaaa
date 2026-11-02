import { useEffect, useState } from 'react'
import type { EditRecipe } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Toggle } from '../../ui/controls'
import { Icon } from '../../ui/Icon'
import { formatValue, Slider } from '../../ui/Slider'
import { SubHead } from '../panels/Section'
import { useSession } from '../session'
import { view } from '../view'
import { LensPicker } from './LensPicker'
import { disableProfile, enableProfile, lensName, loadLens, lookUp, useLensStatus } from './lensSync'

interface Spec {
  label: string
  history: string
  min: number
  max: number
  step?: number
  def: number
  unit?: string
  get: (r: EditRecipe) => number
  set: (r: EditRecipe, v: number) => EditRecipe
  track?: string
}

const lensGeo = (r: EditRecipe) => r.geometry.lens ?? { profile: null, manual: 0 }
const defringe = (r: EditRecipe, patch: Partial<EditRecipe['lens']['defringe']>): EditRecipe => ({ ...r, lens: { ...r.lens, defringe: { ...r.lens.defringe, ...patch } } })

const S = {
  distortion: {
    label: 'Distortion', history: 'Profile distortion', min: 0, max: 200, def: 100, unit: '%',
    get: (r) => r.geometry.lens?.profile?.amount ?? 100,
    set: (r, v) => (r.geometry.lens?.profile ? { ...r, geometry: { ...r.geometry, lens: { ...r.geometry.lens, profile: { ...r.geometry.lens.profile, amount: v } } } } : r),
  },
  vignetting: {
    label: 'Vignetting', history: 'Profile vignetting', min: 0, max: 200, def: 100, unit: '%',
    get: (r) => r.lens.vignetting?.amount ?? 100,
    set: (r, v) => (r.lens.vignetting ? { ...r, lens: { ...r.lens, vignetting: { ...r.lens.vignetting, amount: v } } } : r),
  },
  manual: {
    label: 'Distortion', history: 'Manual distortion', min: -100, max: 100, def: 0,
    get: (r) => r.geometry.lens?.manual ?? 0,
    set: (r, v) => ({ ...r, geometry: { ...r.geometry, lens: { ...lensGeo(r), manual: v } } }),
  },
  manualVig: {
    label: 'Vignetting', history: 'Lens vignetting', min: -100, max: 100, def: 0, track: 'linear-gradient(90deg, #2a2a2a, #d8d8d8)',
    get: (r) => r.lens.manualVignetting,
    set: (r, v) => ({ ...r, lens: { ...r.lens, manualVignetting: v } }),
  },
  midpoint: {
    label: 'Midpoint', history: 'Lens vignetting midpoint', min: 0, max: 100, def: 50,
    get: (r) => r.lens.manualVignettingMidpoint,
    set: (r, v) => ({ ...r, lens: { ...r.lens, manualVignettingMidpoint: v } }),
  },
  purple: { label: 'Purple amount', history: 'Defringe purple', min: 0, max: 20, def: 0, get: (r) => r.lens.defringe.purple, set: (r, v) => defringe(r, { purple: v }) },
  purpleFrom: { label: 'Purple hue from', history: 'Purple hue', min: 0, max: 360, def: 270, unit: '°', get: (r) => r.lens.defringe.purpleHue[0], set: (r, v) => defringe(r, { purpleHue: [v, Math.max(v + 10, r.lens.defringe.purpleHue[1])] }) },
  purpleTo: { label: 'Purple hue to', history: 'Purple hue', min: 0, max: 400, def: 330, unit: '°', get: (r) => r.lens.defringe.purpleHue[1], set: (r, v) => defringe(r, { purpleHue: [Math.min(v - 10, r.lens.defringe.purpleHue[0]), v] }) },
  green: { label: 'Green amount', history: 'Defringe green', min: 0, max: 20, def: 0, get: (r) => r.lens.defringe.green, set: (r, v) => defringe(r, { green: v }) },
  greenFrom: { label: 'Green hue from', history: 'Green hue', min: 0, max: 360, def: 70, unit: '°', get: (r) => r.lens.defringe.greenHue[0], set: (r, v) => defringe(r, { greenHue: [v, Math.max(v + 10, r.lens.defringe.greenHue[1])] }) },
  greenTo: { label: 'Green hue to', history: 'Green hue', min: 0, max: 400, def: 120, unit: '°', get: (r) => r.lens.defringe.greenHue[1], set: (r, v) => defringe(r, { greenHue: [Math.min(v - 10, r.lens.defringe.greenHue[0]), v] }) },
} satisfies Record<string, Spec>

function LensSlider({ spec, disabled }: { spec: Spec; disabled?: boolean }) {
  const value = useEditor((s) => (s.recipe ? spec.get(s.recipe) : spec.def))
  const signed = spec.min < 0
  return (
    <Slider
      label={spec.label}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step ?? 1}
      unit={spec.unit}
      signed={signed}
      defaultValue={spec.def}
      track={spec.track}
      disabled={disabled}
      onChange={(v) => editor.preview((r) => spec.set(r, v))}
      onCommit={(v) => editor.commit(`${spec.history} ${formatValue(v, 0, signed, spec.unit)}`)}
    />
  )
}

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="row between ed-overlay-row">
      <span>
        {label}
        {hint && <small className="muted ed-row-hint">{hint}</small>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

/** Lens corrections: the lens profile (found from the photo, or chosen), manual corrections and defringe. */
export function LensPanel() {
  const session = useSession()
  const lens = useEditor((s) => s.recipe?.lens)
  const hasDistortion = useEditor((s) => !!s.recipe?.geometry.lens?.profile)
  const status = useLensStatus()
  const [picking, setPicking] = useState(false)
  const [attribution, setAttribution] = useState('')
  useEffect(() => {
    lookUp(session)
    void loadLens().then((m) => setAttribution(m.LENS_DB_ATTRIBUTION))
  }, [session])
  if (!lens) return null

  const found = status.lens
  const line =
    status.state === 'looking' ? 'Looking up the lens…'
    : status.state === 'error' ? `The lens database couldn’t load: ${status.message}`
    : found ? `${lensName(found)}${status.guessed ? ' (guessed from the focal length)' : ''}`
    : status.state === 'ready' ? 'No profile found for this lens.'
    : ''

  return (
    <div className="stack tight ed-lens">
      <ToggleRow label="Use profile corrections" checked={lens.enabled} onChange={(on) => (on ? void enableProfile(session) : disableProfile())} />
      <div className="ed-lens-found">
        <span className="small text-2">
          {status.camera && <span className="muted">{`${status.camera.maker} ${status.camera.model} · `}</span>}
          {line}
        </span>
        <button type="button" className="btn ghost sm" onClick={() => setPicking(true)}>
          Change…
        </button>
      </div>
      {lens.enabled && lens.profileId && (
        <>
          <LensSlider spec={S.distortion} disabled={!hasDistortion} />
          <LensSlider spec={S.vignetting} disabled={!lens.vignetting} />
          <ToggleRow
            label="Chromatic aberration"
            hint="Profile color fringes at the edges"
            checked={!!lens.tca}
            onChange={(on) => void (on ? enableProfile(session, lens.profileId, 'Profile chromatic aberration on') : editor.apply((r) => ({ ...r, lens: { ...r.lens, tca: null } }), 'Profile chromatic aberration off'))}
          />
        </>
      )}
      <SubHead>Manual</SubHead>
      <LensSlider spec={S.manual} />
      <LensSlider spec={S.manualVig} />
      <LensSlider spec={S.midpoint} />
      <ToggleRow label="Remove chromatic aberration" hint="Found in the photo itself" checked={lens.autoCA} onChange={(on) => editor.apply((r) => ({ ...r, lens: { ...r.lens, autoCA: on } }), on ? 'Remove chromatic aberration' : 'Keep chromatic aberration')} />
      <div className="row between">
        <SubHead>Defringe</SubHead>
        <button type="button" className="icon-btn" aria-label="Pick a fringe color" title="Pick a fringe color on the photo" onClick={() => view.set({ pick: 'fringe' })}>
          <Icon name="eyedropper" size={16} />
        </button>
      </div>
      <LensSlider spec={S.purple} />
      {lens.defringe.purple > 0 && (
        <>
          <LensSlider spec={S.purpleFrom} />
          <LensSlider spec={S.purpleTo} />
        </>
      )}
      <LensSlider spec={S.green} />
      {lens.defringe.green > 0 && (
        <>
          <LensSlider spec={S.greenFrom} />
          <LensSlider spec={S.greenTo} />
        </>
      )}
      {attribution && <p className="muted small ed-attribution">{attribution}</p>}
      {picking && <LensPicker onClose={() => setPicking(false)} />}
    </div>
  )
}
