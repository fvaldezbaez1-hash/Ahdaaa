import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../editor/session'
import type { Preset } from '../edit/types'
import { link } from '../router'
import { editor, useEditor } from '../state/editor'
import { SearchBox } from '../ui/controls'
import { Icon } from '../ui/Icon'
import { applyPreset, stripLook } from './apply'
import { builtinPresets, collectionName, collections, lookMatches, searchTerms } from './catalog'
import { AmountSlider, LookTile, type PreviewTarget } from './LookTile'
import { SavePresetSheet } from './SavePresetSheet'
import { toggleFavorite, useFavorites, usePreset, useUserPresets } from './store'
import { usePreviewTarget } from './usePreviewTarget'
import './presets.css'

const COUNT = builtinPresets().length

/** The look applied to the open photo, and the actions on it (one undo step each). */
function useLookActions() {
  const kind = useEditor((s) => s.kind)
  const look = useEditor((s) => s.recipe?.look)
  const applied = usePreset(look?.presetId)
  return {
    look,
    applied,
    apply: (p: Preset) => {
      if (p.id !== look?.presetId) editor.apply((r) => applyPreset(r, p, 100, 'original', kind), `Preset · ${p.name}`)
    },
    amount: (v: number) => applied && editor.preview((r) => applyPreset(r, applied, v, 'original', kind)),
    commit: (v: number) => applied && editor.commit(`Preset · ${applied.name} ${Math.round(v)}%`),
    remove: () => look && editor.apply(stripLook, `Removed ${look.name}`),
  }
}

/** Presets inside the editor: the desktop column ('sidebar') or the phone tool panel ('strip'). */
export function PresetsPanel({ layout }: { layout: 'sidebar' | 'strip' }) {
  const { photo } = useSession()
  const photoId = useEditor((s) => s.photoId)
  const kind = useEditor((s) => s.kind)
  const recipe = useEditor((s) => s.recipe)
  const target = usePreviewTarget(photoId, photo, kind, recipe)
  const [saving, setSaving] = useState(false)
  const body = layout === 'sidebar' ? <Sidebar target={target} onSave={() => setSaving(true)} /> : <Strip target={target} />
  return (
    <>
      {body}
      {saving && <SavePresetSheet onClose={() => setSaving(false)} />}
    </>
  )
}

type Filter = 'all' | 'favorites' | 'mine' | string

function Sidebar({ target, onSave }: { target: PreviewTarget | null; onSave: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const user = useUserPresets()
  const favs = useFavorites()
  const { look, applied, apply, amount, commit, remove } = useLookActions()

  const shown = useMemo(() => {
    const mine = user ?? []
    const all = [...mine, ...builtinPresets()]
    const pool = filter === 'all' ? all : filter === 'favorites' ? all.filter((p) => favs.has(p.id)) : filter === 'mine' ? mine : builtinPresets().filter((p) => p.collection === filter)
    const terms = searchTerms(q)
    return pool.filter((p) => lookMatches(p, terms))
  }, [user, favs, filter, q])

  const chips: { id: Filter; name: string }[] = [{ id: 'all', name: 'All' }, { id: 'favorites', name: 'Favorites' }, { id: 'mine', name: 'Mine' }, ...collections()]
  const empty = q.trim()
    ? `No looks match “${q.trim()}”. Try the AI on the Presets screen: describe the look and it builds it.`
    : filter === 'favorites'
      ? 'Tap the star on any look to keep it here.'
      : 'Save your own edit as a preset, or import Lightroom presets on the Presets screen.'

  return (
    <div className="pp">
      <div className="pp-top">
        <div className="pp-head">
          <h2>Presets</h2>
          <button type="button" className="icon-btn pp-save" onClick={onSave} title="Save current settings as a preset" aria-label="Save current settings as a preset">
            <Icon name="plus" size={17} />
          </button>
          <a href={link('/presets')}>Browse all {COUNT}</a>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search looks" />
        <div className="pp-chips no-scrollbar" role="group" aria-label="Collection">
          {chips.map((c) => (
            <button key={c.id} type="button" className={filter === c.id ? 'chip on' : 'chip'} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <div className="pp-grid">
          {shown.map((p) => (
            <LookTile key={p.id} preset={p} target={target} sub={collectionName(p.collection)} selected={look?.presetId === p.id} favorite={favs.has(p.id)} onPick={() => apply(p)} onFavorite={() => void toggleFavorite(p.id)} />
          ))}
        </div>
      ) : (
        <p className="pp-empty muted small">{empty}</p>
      )}
      {look && (
        <div className="pp-applied">
          <div className="row between">
            <span className="bold ellipsis">{look.name}</span>
            <button type="button" className="btn ghost sm" onClick={remove}>
              Remove
            </button>
          </div>
          {applied ? <AmountSlider value={look.amount} onChange={amount} onCommit={commit} /> : <p className="muted small">This preset was deleted; its settings stay on the photo.</p>}
        </div>
      )}
    </div>
  )
}

function Strip({ target }: { target: PreviewTarget | null }) {
  const user = useUserPresets()
  const favs = useFavorites()
  const { look, applied, apply, amount, commit } = useLookActions()
  const row = useRef<HTMLDivElement>(null)
  // Favorites first, then the user's own, then the catalog.
  const list = useMemo(() => {
    const all = [...(user ?? []), ...builtinPresets()]
    return [...all.filter((p) => favs.has(p.id)), ...all.filter((p) => !favs.has(p.id))]
  }, [user, favs])

  // Bring the applied look into view when the panel opens.
  const appliedId = look?.presetId
  useEffect(() => {
    row.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [appliedId])

  return (
    <div className="pp-strip">
      <div ref={row} className="pp-strip-row no-scrollbar" role="group" aria-label="Looks">
        {list.map((p) => (
          <LookTile key={p.id} preset={p} target={target} selected={appliedId === p.id} onPick={() => apply(p)} className="square" />
        ))}
      </div>
      <div className="pp-strip-foot">
        <AmountSlider value={look?.amount ?? 100} onChange={amount} onCommit={commit} disabled={!applied} />
        <a href={link('/presets')}>Browse all {COUNT} presets</a>
      </div>
    </div>
  )
}
