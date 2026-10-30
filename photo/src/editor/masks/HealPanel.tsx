import type { RetouchSpot } from '../../edit/types'
import { editor, useEditor } from '../../state/editor'
import { Segmented } from '../../ui/controls'
import { Slider } from '../../ui/Slider'
import { useView, view, type HealSettings } from '../view'
import { radiusToSize, sizeToRadius } from './brush'
import { deleteSpot, exitTool, updateSpots } from './modes'

const mapSpot = (id: string, fn: (s: RetouchSpot) => RetouchSpot) => (r: { retouch: RetouchSpot[] }) => r.retouch.map((s) => (s.id === id ? fn(s) : s))

/**
 * Heal & clone: settings for new spots; with a spot selected they edit that
 * spot (live while dragging, one undo step on release).
 */
export function HealPanel({ layout }: { layout: 'side' | 'strip' }) {
  const h = useView((s) => s.heal)
  const selectedId = useView((s) => s.spot)
  const spots = useEditor((s) => s.recipe?.retouch)
  const spot = spots?.find((s) => s.id === selectedId)
  const count = spots?.length ?? 0

  const values = spot ? { size: Math.round(radiusToSize(spot.r)), feather: spot.feather, opacity: Math.round(spot.opacity * 100), mode: spot.mode } : h
  const change = (patch: Partial<HealSettings>) => {
    view.set({ heal: { ...view.get().heal, ...patch } })
    if (!spot) return
    const fn = (s: RetouchSpot): RetouchSpot => ({
      ...s,
      ...(patch.size !== undefined && { r: sizeToRadius(patch.size) }),
      ...(patch.feather !== undefined && { feather: patch.feather }),
      ...(patch.opacity !== undefined && { opacity: patch.opacity / 100 }),
      ...(patch.mode && { mode: patch.mode }),
    })
    editor.preview((r) => ({ ...r, retouch: mapSpot(spot.id, fn)(r) }))
  }
  const commit = (label: string) => spot && editor.commit(label)

  return (
    <div className={`ed-heal-panel ${layout}`}>
      {layout === 'side' && (
        <div className="row between">
          <h2>Heal & clone</h2>
          <button type="button" className="btn primary sm" onClick={exitTool}>
            Done
          </button>
        </div>
      )}
      <Segmented
        label="Spot type"
        value={values.mode}
        className="ed-seg-full"
        onChange={(mode) => {
          change({ mode })
          commit(mode === 'heal' ? 'Heal spot' : 'Clone spot')
        }}
        options={[
          { value: 'heal', label: 'Heal', title: 'Blend the copied texture into its surroundings' },
          { value: 'clone', label: 'Clone', title: 'Copy pixels exactly' },
        ]}
      />
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
    </div>
  )
}
