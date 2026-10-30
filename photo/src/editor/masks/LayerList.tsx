import { useState } from 'react'
import type { LocalLayer } from '../../edit/types'
import { uid } from '../../io/db'
import { editor, useEditor } from '../../state/editor'
import { Icon } from '../../ui/Icon'
import { MenuSheet } from '../../ui/Sheet'
import { useView, view } from '../view'
import { ToolIcon } from './icons'
import { duplicateLayer, isAdjusted, kindOf, maskLabel, moveLayer, removeLayer, updateLayer } from './model'

function summary(l: LocalLayer): string {
  const kinds = l.masks.map(maskLabel)
  const what = kinds.length > 1 ? `${kinds[0]} + ${kinds.length - 1}` : (kinds[0] ?? 'Empty')
  return isAdjusted(l.adjust) ? what : `${what} · no adjustments yet`
}

function Row({ layer, index, count }: { layer: LocalLayer; index: number; count: number }) {
  const selected = useView((s) => s.layer === layer.id)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const select = () => view.set({ tool: 'mask', layer: layer.id, mask: layer.masks[0]?.id ?? null, placing: null, rangePick: false })
  const rename = (name: string) => {
    setRenaming(false)
    const n = name.trim()
    if (n && n !== layer.name) editor.apply((r) => updateLayer(r, layer.id, (l) => ({ ...l, name: n })), `Rename to ${n}`)
  }
  const first = layer.masks[0]
  return (
    <li className={selected ? 'ed-layer on' : 'ed-layer'}>
      <button
        type="button"
        className="ed-eye"
        aria-pressed={!layer.enabled}
        aria-label={layer.enabled ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={layer.enabled ? 'Hide this mask’s adjustments' : 'Show this mask’s adjustments'}
        onClick={() => editor.apply((r) => updateLayer(r, layer.id, (l) => ({ ...l, enabled: !l.enabled })), `${layer.enabled ? 'Hide' : 'Show'} ${layer.name}`)}
      >
        <ToolIcon name={layer.enabled ? 'eye' : 'eyeOff'} size={16} />
      </button>
      {renaming ? (
        <input
          className="input ed-layer-input"
          defaultValue={layer.name}
          autoFocus
          aria-label="Mask name"
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename(e.currentTarget.value)
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <button type="button" className="ed-layer-name" aria-current={selected ? 'true' : undefined} onClick={select} onDoubleClick={() => setRenaming(true)} title="Select · double-click to rename">
          {first && <ToolIcon name={kindOf(first) === 'ai' ? 'ai' : (kindOf(first) as 'brush')} size={16} />}
          <span className="ed-layer-text">
            <span className="ellipsis">{layer.name}</span>
            <small className="ellipsis">{summary(layer)}</small>
          </span>
        </button>
      )}
      <button type="button" className="icon-btn ed-layer-more" aria-label={`More for ${layer.name}`} onClick={() => setMenu(true)}>
        <Icon name="more" />
      </button>
      {menu && (
        <MenuSheet
          title={layer.name}
          onClose={() => setMenu(false)}
          items={[
            { label: 'Rename', icon: 'edit', onClick: () => setRenaming(true) },
            {
              label: 'Duplicate',
              icon: 'copy',
              onClick: () => {
                const r = editor.getState().recipe
                if (!r) return
                const d = duplicateLayer(r, layer.id, uid)
                editor.apply(() => d.recipe, `Duplicate ${layer.name}`)
                const copy = d.recipe.layers.find((l) => l.id === d.id)
                view.set({ layer: d.id, mask: copy?.masks[0]?.id ?? null })
              },
            },
            { label: 'Move up (applies later)', icon: 'up', disabled: index === count - 1, onClick: () => editor.apply((r) => moveLayer(r, layer.id, 1), `Move ${layer.name} up`) },
            { label: 'Move down (applies earlier)', icon: 'down', disabled: index === 0, onClick: () => editor.apply((r) => moveLayer(r, layer.id, -1), `Move ${layer.name} down`) },
            {
              label: 'Delete',
              icon: 'trash',
              danger: true,
              onClick: () => {
                editor.apply((r) => removeLayer(r, layer.id), `Delete ${layer.name}`)
                if (selected) view.set({ layer: null, mask: null })
              },
            },
          ]}
        />
      )}
    </li>
  )
}

/** The photo's mask layers, top (applied last) first. */
export function LayerList() {
  const layers = useEditor((s) => s.recipe?.layers)
  if (!layers?.length) return null
  return (
    <ul className="ed-layers" aria-label="Masks">
      {layers
        .map((l, i) => <Row key={l.id} layer={l} index={i} count={layers.length} />)
        .reverse()}
    </ul>
  )
}
