import { useMemo, useState } from 'react'
import { normalizeRecipe } from '../edit/defaults'
import type { Preset } from '../edit/types'
import { updateRecipes } from '../library/actions'
import { link, navigate } from '../router'
import { Empty, Field, SearchBox } from '../ui/controls'
import { useIsPhone } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { PhotoThumb } from '../ui/PhotoThumb'
import { MenuSheet, Sheet, type MenuItem } from '../ui/Sheet'
import { applyPreset } from './apply'
import { builtinPresets, collections, findBuiltin } from './catalog'
import { DescribeLook } from './DescribeLook'
import { AmountSlider, LookTile } from './LookTile'
import { StagePreview } from './StagePreview'
import { deletePreset, exportXmp, renamePreset, toggleFavorite } from './store'
import { useBrowser, type Browser, type View } from './useBrowser'
import { XmpImportButton } from './XmpImport'
import './presets.css'

const COUNT = builtinPresets().length

/** The full presets browser (#/presets). */
export function PresetsScreen() {
  const b = useBrowser()
  const phone = useIsPhone()
  return phone ? <PhoneScreen b={b} /> : <DesktopScreen b={b} />
}

async function applyAndEdit(b: Browser) {
  const id = b.photoId
  if (!id) return
  const preset = b.selected, amount = b.amount
  const ok = await updateRecipes([id], (p) => applyPreset(normalizeRecipe(p.recipe, p.kind, p.raw?.asShot), preset, amount, 'original', p.kind))
  if (ok) navigate(`/edit/${encodeURIComponent(id)}`)
}

const isUserPreset = (p: Preset) => !findBuiltin(p.id)

function gridTitle(b: Browser): [string, string] {
  const q = b.q.trim()
  if (q) return [`Results for “${q}”`, `${b.cards.length} ${b.cards.length === 1 ? 'look' : 'looks'}`]
  switch (b.view) {
    case 'suggested':
      return ['Best for this photo', 'Picked on this device from the light, color and subject of the photo']
    case 'favorites':
      return ['Favorites', `${b.cards.length} ${b.cards.length === 1 ? 'look' : 'looks'}`]
    case 'mine':
      return ['My presets', 'Saved from your edits or made by the AI']
    case 'lightroom':
      return ['From Lightroom', 'Your .xmp presets, translated to Lumen’s sliders']
    default: {
      const c = collections().find((x) => x.id === b.view)
      return [c?.name ?? '', c?.description ?? '']
    }
  }
}

function emptyText(b: Browser): string {
  if (b.q.trim()) return 'Nothing matches. Describe it to the AI above and it will build the look.'
  if (b.view === 'favorites') return 'Tap the star on any look to keep it here.'
  if (b.view === 'mine') return 'Save an edit as a preset from the editor, or describe a look and the AI will create one.'
  if (b.view === 'lightroom') return 'Use “Import Lightroom presets” to bring in the looks you already own.'
  if (b.view === 'suggested') return b.choices.length ? 'Looking at your photo…' : 'Import a photo and Lumen will suggest looks for it.'
  return ''
}

/** Rename, export and delete for the selected look. */
function useLookMenu(b: Browser) {
  const [sheet, setSheet] = useState<'menu' | 'rename' | 'delete' | null>(null)
  const p = b.selected
  const items: MenuItem[] = [
    { label: 'Export for Lightroom (.xmp)', icon: 'share', onClick: () => exportXmp(p) },
    ...(isUserPreset(p)
      ? [
          { label: 'Rename', icon: 'edit' as const, onClick: () => setSheet('rename') },
          { label: 'Delete', icon: 'trash' as const, danger: true, onClick: () => setSheet('delete') },
        ]
      : []),
  ]
  const node =
    sheet === 'menu' ? (
      <MenuSheet title={p.name} items={items} onClose={() => setSheet(null)} />
    ) : sheet === 'rename' ? (
      <RenameSheet preset={p} onClose={() => setSheet(null)} />
    ) : sheet === 'delete' ? (
      <Sheet
        title={`Delete “${p.name}”?`}
        onClose={() => setSheet(null)}
        footer={
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await deletePreset(p.id)
                setSheet(null)
              }}
            >
              Delete preset
            </button>
          </div>
        }
      >
        <p className="text-2">Photos it was applied to keep their settings.</p>
      </Sheet>
    ) : null
  return { open: () => setSheet('menu'), node }
}

function RenameSheet({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const [name, setName] = useState(preset.name)
  const save = async () => {
    await renamePreset(preset.id, name)
    onClose()
  }
  return (
    <Sheet
      title="Rename preset"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={!name.trim()}>
            Rename
          </button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Name">
          <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
      </form>
    </Sheet>
  )
}

function Stage({ b }: { b: Browser }) {
  const recipe = useMemo(() => (b.recipe ? applyPreset(b.recipe, b.selected, b.amount, 'original', b.kind) : null), [b.recipe, b.selected, b.amount, b.kind])
  if (!b.loading && !b.choices.length)
    return (
      <div className="ps-stage ps-stage-empty">
        <Empty icon="image">
          <p className="text-2">No photos yet. Import a few and every look previews on your own pictures.</p>
          <a className="btn primary" href={link('/')} style={{ marginTop: 14 }}>
            <Icon name="upload" size={16} />
            Import photos
          </a>
        </Empty>
      </div>
    )
  if (b.decodeError)
    return (
      <div className="ps-stage ps-stage-empty">
        <Empty icon="info">Couldn’t open this photo: {b.decodeError}</Empty>
      </div>
    )
  return <StagePreview source={b.stageSource} recipe={recipe} before={b.before} fallback={b.target?.thumbUrl} />
}

function FavButton({ b }: { b: Browser }) {
  const fav = b.favs.has(b.selected.id)
  return (
    <button type="button" className={fav ? 'icon-btn ps-fav on' : 'icon-btn ps-fav'} aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void toggleFavorite(b.selected.id)}>
      <Icon name={fav ? 'starFill' : 'star'} size={18} />
    </button>
  )
}

// ---------- Desktop ----------

function DesktopScreen({ b }: { b: Browser }) {
  const menu = useLookMenu(b)
  const [title, sub] = gridTitle(b)
  const nav = (view: View, label: string, count?: number, icon?: boolean) => {
    const on = !b.q.trim() && b.view === view
    return (
      <button key={view} type="button" className={icon ? 'ps-nav best' : 'ps-nav'} aria-current={on ? 'true' : undefined} onClick={() => b.setView(view)}>
        {icon && <Icon name="sparkle" size={15} className="accent" />}
        <span className="grow ellipsis">{label}</span>
        {count !== undefined && <span className="muted small tnum">{count}</span>}
      </button>
    )
  }
  const mine = b.user.filter((p) => p.source !== 'lightroom').length
  return (
    <div className="ps">
      <aside className="ps-side scroll" aria-label="Collections">
        <div className="ps-side-head">
          <div className="bold">{COUNT} presets</div>
          <div className="muted small">20 collections × 5 hand-made looks</div>
        </div>
        {nav('suggested', 'Best for this photo', undefined, true)}
        {nav('favorites', 'Favorites', b.favs.size)}
        {nav('mine', 'My presets', mine)}
        {nav('lightroom', 'From Lightroom', b.user.length - mine)}
        <div className="ps-heading">Collections</div>
        {collections().map((c) => nav(c.id, c.name, c.presetIds.length))}
        <div className="ps-side-foot">
          <XmpImportButton className="btn outline block" onDone={() => b.setView('lightroom')} />
        </div>
      </aside>
      <main className="ps-main scroll">
        <div className="ps-inner">
          <div className="ps-toolbar">
            <div className="ps-search">
              <SearchBox value={b.q} onChange={b.setQ} placeholder={`Search ${COUNT} presets — warm, film, wedding, moody…`} />
            </div>
            <DescribeLook
              photo={b.photoId && b.recipe ? { id: b.photoId, kind: b.kind, recipe: b.recipe } : null}
              onCreated={(id) => {
                b.setView('mine')
                b.select(id)
              }}
            />
          </div>

          <section className="ps-preview" aria-label="Preview">
            <Stage b={b} />
            <div className="ps-detail">
              <div>
                <div className="muted small bold">{b.collectionLabel(b.selected)}</div>
                <div className="row">
                  <h1 className="ellipsis">{b.selected.name}</h1>
                  <FavButton b={b} />
                  <button type="button" className="icon-btn" aria-label="More actions for this look" onClick={menu.open}>
                    <Icon name="more" />
                  </button>
                </div>
                {b.selected.description && <p className="text-2 ps-desc">{b.selected.description}</p>}
              </div>
              <AmountSlider value={b.amount} onChange={b.setAmount} />
              <button type="button" className="btn primary lg block" disabled={!b.photoId} onClick={() => void applyAndEdit(b)}>
                Apply &amp; edit
              </button>
              {b.choices.length > 1 && (
                <div>
                  <div className="muted small ps-label">Preview on</div>
                  <div className="row ps-photos">
                    {b.choices.map((id, i) => (
                      <button key={id} type="button" className="ps-photo" aria-pressed={id === b.photoId} aria-label={`Preview on photo ${i + 1}`} onClick={() => b.setPhotoId(id)}>
                        <PhotoThumb id={id} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section aria-label={title}>
            <div className="ps-grid-head">
              <h2>{title}</h2>
              <span className="muted small">{sub}</span>
            </div>
            {b.cards.length ? (
              <div className="ps-grid">
                {b.cards.map(({ preset: p, reason }) => (
                  <LookTile key={p.id} preset={p} target={b.target} sub={b.collectionLabel(p)} reason={reason} selected={p.id === b.selected.id} favorite={b.favs.has(p.id)} onPick={() => b.select(p.id)} onFavorite={() => void toggleFavorite(p.id)} />
                ))}
              </div>
            ) : (
              <p className="muted">{emptyText(b)}</p>
            )}
          </section>
        </div>
      </main>
      {menu.node}
    </div>
  )
}

// ---------- Phone ----------

function PhoneScreen({ b }: { b: Browser }) {
  const menu = useLookMenu(b)
  // The suggestions have their own row on phones; the grid starts on a collection.
  const view = b.view === 'suggested' ? 'essentials' : b.view
  const chips: [View, string][] = [['favorites', 'Favorites'], ['mine', 'Mine'], ['lightroom', 'From Lightroom'], ...collections().map((c): [View, string] => [c.id, c.name])]
  const grid = b.q.trim() || b.view !== 'suggested' ? b.cards : builtinPresets().filter((p) => p.collection === view).map((preset) => ({ preset }))
  return (
    <div className="ps-phone">
      <header className="ps-phone-head">
        <h1>Presets</h1>
        <span className="muted small">{COUNT} looks</span>
      </header>
      <div className="ps-phone-stage">
        <Stage b={b} />
      </div>
      <div className="ps-phone-scroll scroll">
        {b.suggestions.length > 0 && !b.q.trim() && (
          <>
            <h2 className="ps-phone-title">
              <Icon name="sparkle" size={15} className="accent" />
              Best for this photo
            </h2>
            <div className="ps-row no-scrollbar">
              {b.suggestions.map((s) => (
                <LookTile key={s.preset.id} preset={s.preset} target={b.target} reason={s.reason} selected={s.preset.id === b.selected.id} onPick={() => b.select(s.preset.id)} className="wide" />
              ))}
            </div>
          </>
        )}
        <div className="ps-phone-pad stack tight">
          <SearchBox value={b.q} onChange={b.setQ} placeholder={`Search ${COUNT} presets`} />
          <DescribeLook
            photo={b.photoId && b.recipe ? { id: b.photoId, kind: b.kind, recipe: b.recipe } : null}
            onCreated={(id) => {
              b.setView('mine')
              b.select(id)
            }}
          />
        </div>
        {!b.q.trim() && (
          <div className="ps-row ps-chips no-scrollbar" role="group" aria-label="Collections">
            {chips.map(([id, name]) => (
              <button key={id} type="button" className={view === id ? 'chip on' : 'chip'} aria-pressed={view === id} onClick={() => b.setView(id)}>
                {name}
              </button>
            ))}
          </div>
        )}
        {grid.length ? (
          <div className="ps-phone-grid">
            {grid.map(({ preset: p }) => (
              <LookTile key={p.id} preset={p} target={b.target} selected={p.id === b.selected.id} onPick={() => b.select(p.id)} className="square" />
            ))}
          </div>
        ) : (
          <p className="muted ps-phone-pad">{emptyText({ ...b, view })}</p>
        )}
        <div className="ps-phone-pad">
          <XmpImportButton className="btn outline block" onDone={() => b.setView('lightroom')} />
        </div>
      </div>
      <div className="ps-phone-foot">
        <div className="row">
          <div className="grow">
            <div className="bold ellipsis">{b.selected.name}</div>
            <div className="muted small">
              {b.collectionLabel(b.selected)} · {b.amount}%
            </div>
          </div>
          <FavButton b={b} />
          <button type="button" className="icon-btn" aria-label="More actions for this look" onClick={menu.open}>
            <Icon name="more" />
          </button>
          <button type="button" className="btn primary" disabled={!b.photoId} onClick={() => void applyAndEdit(b)}>
            Apply
          </button>
        </div>
        <AmountSlider value={b.amount} onChange={b.setAmount} />
      </div>
      {menu.node}
    </div>
  )
}
