import { useMemo } from 'react'
import { isSpot, spotsOf } from '../../edit/retouch'
import type { RemoveArea, Retouch, RetouchSpot } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { Icon } from '../../ui/Icon'
import { Slider } from '../../ui/Slider'
import { deleteRetouch, recomputeRemoval } from '../ai/actions'
import { AiJobCard } from '../ai/AiJobCard'
import { useAiJob, useAiSupport } from '../ai/jobs'
import { useMissingRasters } from '../ai/rasterSync'
import { needsCompute } from '../ai/refs'
import { useSession } from '../session'
import { useView, view, type HealSettings } from '../view'
import { radiusToSize, sizeToRadius } from './brush'
import { deleteSpot, exitTool, updateSpots } from './modes'

const mapSpot = (id: string, fn: (s: RetouchSpot) => RetouchSpot) => (r: { retouch: Retouch[] }) => r.retouch.map((s) => (s.id === id && isSpot(s) ? fn(s) : s))

/** AI object removal: brush size, and the removals made so far. */
function RemoveSettings({ layout }: { layout: 'side' | 'strip' }) {
  const session = useSession()
  const h = useView((s) => s.heal)
  const selected = useView((s) => s.spot)
  const retouch = useEditor((s) => s.recipe?.retouch)
  const areas = useMemo(() => (retouch ?? []).filter((t): t is RemoveArea => t.mode === 'remove'), [retouch])
  const missing = useMissingRasters()
  const busy = !!useAiJob()
  const support = useAiSupport()
  return (
    <>
      <AiJobCard scope="remove" />
      {support && !support.available && <p className="muted small">{support.reason ?? 'On-device AI isn’t available on this device.'}</p>}
      <Slider label="Brush size" value={h.size} min={1} max={100} step={1} defaultValue={40} signed={false} onChange={(v) => view.set({ heal: { ...h, size: v } })} />
      {areas.length > 0 && (
        <ul className="ed-removals" aria-label="Removals">
          {areas.map((a, i) => (
            <li key={a.id} className={a.id === selected ? 'on' : undefined}>
              <button type="button" className="ed-removal-name" aria-current={a.id === selected ? 'true' : undefined} onClick={() => view.set({ spot: a.id })}>
                {`Removal ${i + 1}`}
                {needsCompute(a.fill, missing) && <span className="ed-warn-dot" aria-label="(needs recomputing)" />}
              </button>
              {needsCompute(a.fill, missing) && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void recomputeRemoval(session, a.id)}>
                  Recompute
                </button>
              )}
              <button type="button" className="icon-btn ed-mask-btn" aria-label={`Delete removal ${i + 1}`} title="Delete (Backspace)" onClick={() => deleteRetouch(a.id, 'Delete removal')}>
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        {layout === 'side' ? 'Paint over what should go, a little beyond its edges, and let go: it’s filled in on this device. [ ] change the size.' : 'Paint over what should go and lift your finger: it’s filled in on this device.'}
      </p>
    </>
  )
}

/**
 * Heal & clone (spots) and Remove (AI). For spots: settings for new ones; with
 * a spot selected they edit that spot (live while dragging, one undo step on release).
 */
export function HealPanel({ layout }: { layout: 'side' | 'strip' }) {
  const h = useView((s) => s.heal)
  const selectedId = useView((s) => s.spot)
  const retouch = useEditor((s) => s.recipe?.retouch)
  const spots = useMemo(() => (retouch ? spotsOf(retouch) : undefined), [retouch])
  const spot = spots?.find((s) => s.id === selectedId)
  const count = spots?.length ?? 0
  const removing = h.mode === 'remove'

  const values = spot && !removing ? { size: Math.round(radiusToSize(spot.r)), feather: spot.feather, opacity: Math.round(spot.opacity * 100), mode: spot.mode } : h
  const change = (patch: Partial<HealSettings>) => {
    view.set({ heal: { ...view.get().heal, ...patch } })
    const mode = patch.mode
    if (!spot || mode === 'remove') return
    const fn = (s: RetouchSpot): RetouchSpot => ({
      ...s,
      ...(patch.size !== undefined && { r: sizeToRadius(patch.size) }),
      ...(patch.feather !== undefined && { feather: patch.feather }),
      ...(patch.opacity !== undefined && { opacity: patch.opacity / 100 }),
      ...(mode && { mode }),
    })
    editor.preview((r) => ({ ...r, retouch: mapSpot(spot.id, fn)(r) }))
  }
  const commit = (label: string) => spot && editor.commit(label)

  return (
    <div className={`ed-heal-panel ${layout}`}>
      {layout === 'side' && (
        <div className="row between">
          <h2>Heal & remove</h2>
          <button type="button" className="btn primary sm" onClick={exitTool}>
            Done
          </button>
        </div>
      )}
      <Segmented
        label="Tool"
        value={values.mode}
        className="ed-seg-full"
        onChange={(mode) => {
          if (mode === 'remove' || h.mode === 'remove') {
            view.set({ heal: { ...h, mode }, spot: null })
            return
          }
          change({ mode })
          commit(mode === 'heal' ? 'Heal spot' : 'Clone spot')
        }}
        options={[
          { value: 'heal', label: 'Heal', title: 'Blend the copied texture into its surroundings' },
          { value: 'clone', label: 'Clone', title: 'Copy pixels exactly' },
          { value: 'remove', label: 'Remove', title: 'Paint over an object; AI fills it in (Shift+Q)' },
        ]}
      />
      {removing ? (
        <RemoveSettings layout={layout} />
      ) : (
        <>
          <Slider label="Size" value={values.size} min={1} max={100} step={1} defaultValue={40} signed={false} onChange={(v) => change({ size: v })} onCommit={() => commit('Heal spot size')} />
          <Slider label="Feather" value={values.feather} min={0} max={100} step={1} defaultValue={50} signed={false} onChange={(v) => change({ feather: v })} onCommit={() => commit('Heal spot feather')} />
          <Slider label="Opacity" value={values.opacity} min={1} max={100} step={1} defaultValue={100} signed={false} unit="%" onChange={(v) => change({ opacity: v })} onCommit={() => commit('Heal spot opacity')} />
          <div className="row between ed-spot-row">
            <span className="muted small tnum" aria-live="polite">
              {count === 0 ? 'No spots yet' : `${count} spot${count === 1 ? '' : 's'}${spot ? ' · 1 selected' : ''}`}
            </span>
            <span className="row">
              {spot && (
                <button type="button" className="btn ghost sm" onClick={() => deleteSpot(spot.id)} title="Delete the selected spot (Backspace)">
                  Delete
                </button>
              )}
              <button
                type="button"
                className="btn ghost sm"
                disabled={!count}
                onClick={() => {
                  updateSpots(() => [], 'Clear heal spots')
                  view.set({ spot: null })
                }}
              >
                Clear all
              </button>
            </span>
          </div>
          <p className="muted small">{layout === 'side' ? 'Click a blemish, or drag across a line, to heal it. Drag a circle to move it, its edge to resize. [ ] change the size.' : 'Tap a blemish to heal it. Drag a circle to move it, its edge to resize.'}</p>
        </>
      )}
    </div>
  )
}
