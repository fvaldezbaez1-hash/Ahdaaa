import { useMemo, useState } from 'react'
import type { Preset, Variation } from '../edit/types'
import { VARIATIONS } from '../presets/catalog'
import { Empty, SearchBox, Segmented } from '../ui/controls'
import { Sheet } from '../ui/Sheet'
import { Slider } from '../ui/Slider'
import { applyPresetTo } from './actions'
import { plural, searchTerms } from './library'
import { usePresetGroups } from './presetGroups'
import './sheets.css'

/** Apply one look to every selected photo, at a chosen strength and variation. */
export function PresetSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const groups = usePresetGroups()
  const [group, setGroup] = useState('all')
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<Preset | null>(null)
  const [amount, setAmount] = useState(100)
  const [variation, setVariation] = useState<Variation>('original')
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => {
    const terms = searchTerms(q)
    const pool = group === 'all' ? groups : groups.filter((g) => g.id === group)
    return pool.flatMap((g) =>
      g.presets
        .filter((p) => {
          const text = `${p.name} ${g.name} ${p.description ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase()
          return terms.every((t) => text.includes(t))
        })
        .map((p) => ({ preset: p, group: g.name })),
    )
  }, [groups, group, q])

  const apply = async () => {
    if (!chosen) return
    setBusy(true)
    await applyPresetTo(ids, chosen, amount, variation)
    setBusy(false)
    onClose()
  }

  return (
    <Sheet
      wide
      title={`Apply a preset to ${plural(ids.length, 'photo')}`}
      onClose={onClose}
      footer={
        groups.length === 0 ? (
          <div className="lib-foot">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <div className="stack">
            <div className="preset-controls">
              <Segmented label="Variation" value={variation} options={VARIATIONS.map((v) => ({ value: v.id, label: v.label }))} onChange={setVariation} />
              <div className="grow">
                <Slider label="Amount" value={amount} min={0} max={200} defaultValue={100} format={(v) => `${Math.round(v)}%`} onChange={setAmount} />
              </div>
            </div>
            <div className="lib-foot">
              <span className="grow ellipsis">{chosen ? `${chosen.name} · ${amount}%${variation === 'original' ? '' : ` · ${variation}`}` : 'Choose a look'}</span>
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={!chosen || busy} onClick={apply}>
                Apply to {plural(ids.length, 'photo')}
              </button>
            </div>
          </div>
        )
      }
    >
      {groups.length === 0 ? (
        <Empty icon="presets">No presets yet. Save one from the editor, or check back after an update.</Empty>
      ) : (
        <div className="stack">
          <SearchBox value={q} onChange={setQ} placeholder="Search looks" />
          <div className="chips no-scrollbar" role="group" aria-label="Collection">
            {[{ id: 'all', name: 'All' }, ...groups].map((g) => (
              <button key={g.id} type="button" className={g.id === group ? 'chip on' : 'chip'} aria-pressed={g.id === group} onClick={() => setGroup(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty>No looks match “{q}”.</Empty>
          ) : (
            <div className="pick-list" role="group" aria-label="Looks">
              {shown.map(({ preset: p, group: g }) => (
                <button key={p.id} type="button" className="pick-item" aria-pressed={chosen?.id === p.id} onClick={() => setChosen(p)}>
                  <b>{p.name}</b>
                  <small>{p.description || g}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
