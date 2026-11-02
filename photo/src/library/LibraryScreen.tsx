import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MenuSheet, Sheet, type MenuItem } from '../ui/Sheet'
import { Spinner } from '../ui/controls'
import { useIsPhone } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { toast } from '../ui/toast'
import { copyEdits, createAlbum, deleteAlbum, deleteKeyword, queueThumbnails, removeFromAlbum, removePhotos, renameAlbum, renameKeyword, resetEdits, setFlag } from './actions'
import { AlbumPicker, NameSheet } from './AlbumSheets'
import { ConfirmSheet } from './ConfirmSheet'
import { DesktopLibrary } from './DesktopLibrary'
import { useDropImport } from './drop'
import { ExportSheet } from './ExportSheet'
import { ImportSheet } from './ImportSheet'
import { KeywordEditor } from './KeywordEditor'
import { LoupeView } from './Loupe'
import { MergeSheet } from './MergeSheet'
import { importer, useImport } from './importer'
import { EMPTY_SELECTION, plural } from './library'
import { PhoneLibrary } from './PhoneLibrary'
import { ACCEPT } from './platform'
import { usePref } from './prefs'
import { PresetSheet } from './PresetSheet'
import { useLibrary, type Library, type LibrarySheet } from './useLibrary'
import { Welcome } from './Welcome'
import { syncOnOpen } from '../sync/sync'
import './library.css'

const isString = (v: unknown) => typeof v === 'string'
const thumbQueued = new Set<string>()

export function LibraryScreen() {
  const lib = useLibrary()
  const phone = useIsPhone()
  const imp = useImport()
  const [sheet, setSheet] = useState<LibrarySheet | null>(null)
  const [importPreset, setImportPreset] = usePref('importPreset', '', isString)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const startImport = (files: File[]) => void importer.start(files, importPreset || undefined)
  const dragging = useDropImport(startImport)
  const close = useCallback(() => setSheet(null), [])

  // Bring in what other devices changed (sync folder set up and still allowed; otherwise nothing happens).
  useEffect(() => syncOnOpen(), [])
  // Photos sync brought from another device get their thumbnails here if the app closed before they were made.
  useEffect(() => {
    const missing = lib.photos?.filter((p) => p.thumbVersion === 0 && !thumbQueued.has(p.id)).map((p) => p.id) ?? []
    missing.forEach((id) => thumbQueued.add(id))
    if (missing.length) queueThumbnails(missing)
  }, [lib.photos])

  useLayoutEffect(() => {
    // Not a React prop: lets the picker choose a whole folder (desktop browsers).
    if (folderInput.current) folderInput.current.webkitdirectory = true
  }, [])

  const chooseFiles = () => filesInput.current?.click()
  const chooseFolder = () => folderInput.current?.click()
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length) startImport(files)
  }

  let screen: React.ReactNode
  if (!lib.photos)
    screen = (
      <div className="lib-empty" style={{ margin: 'auto' }}>
        <Spinner label="Loading your library" />
      </div>
    )
  else if (!lib.photos.length && !imp.running) screen = <Welcome phone={phone} onImport={chooseFiles} onImportFolder={chooseFolder} />
  else if (phone) screen = <PhoneLibrary lib={lib} open={setSheet} />
  else screen = <DesktopLibrary lib={lib} open={setSheet} onImportFolder={chooseFolder} />

  return (
    <>
      {screen}
      {lib.loupe && <LoupeView lib={lib} />}
      <input ref={filesInput} type="file" multiple accept={ACCEPT} hidden onChange={onPicked} />
      <input ref={folderInput} type="file" multiple hidden onChange={onPicked} />
      {dragging && (
        <div className="lib-drop" aria-hidden="true">
          <div>
            <Icon name="image" size={36} />
            Drop photos to import
            <span className="muted small" style={{ fontWeight: 500 }}>
              RAW, JPEG, HEIC, TIFF — folders too
            </span>
          </div>
        </div>
      )}
      {sheet && (
        <LibrarySheets
          sheet={sheet}
          lib={lib}
          open={setSheet}
          close={close}
          importProps={{ onChooseFiles: chooseFiles, onChooseFolder: chooseFolder, presetId: importPreset, onPresetId: setImportPreset }}
        />
      )}
    </>
  )
}

function LibrarySheets({
  sheet,
  lib,
  open,
  close,
  importProps,
}: {
  sheet: LibrarySheet
  lib: Library
  open: (s: LibrarySheet) => void
  close: () => void
  importProps: Omit<React.ComponentProps<typeof ImportSheet>, 'onClose'>
}) {
  switch (sheet.type) {
    case 'import':
      return <ImportSheet onClose={close} {...importProps} />
    case 'export':
      return <ExportSheet ids={sheet.ids} onClose={close} />
    case 'merge':
      return <MergeSheet ids={sheet.ids} onClose={close} />
    case 'preset':
      return <PresetSheet ids={sheet.ids} onClose={close} />
    case 'album':
      return <AlbumPicker ids={sheet.ids} albums={lib.albums} counts={lib.counts.albums} onClose={close} onNew={() => open({ type: 'newAlbum', ids: sheet.ids })} />
    case 'newAlbum':
      return (
        <NameSheet
          title={sheet.ids.length ? `New album with ${plural(sheet.ids.length, 'photo')}` : 'New album'}
          confirmLabel="Create album"
          onClose={close}
          onSubmit={async (name) => {
            const id = await createAlbum(name, sheet.ids)
            if (!id) return
            if (sheet.ids.length) toast(`Added ${plural(sheet.ids.length, 'photo')} to ${name}`)
            else lib.setView(`album:${id}`)
          }}
        />
      )
    case 'renameAlbum':
      return <NameSheet title="Rename album" initial={sheet.album.name} confirmLabel="Rename" onClose={close} onSubmit={(name) => renameAlbum(sheet.album.id, name)} />
    case 'albumMenu':
      return (
        <MenuSheet
          title={sheet.album.name}
          onClose={close}
          items={[
            { label: 'Rename…', icon: 'edit', onClick: () => open({ type: 'renameAlbum', album: sheet.album }) },
            { label: 'Delete album…', icon: 'trash', danger: true, onClick: () => open({ type: 'deleteAlbum', album: sheet.album }) },
          ]}
        />
      )
    case 'deleteAlbum': {
      const n = lib.counts.albums.get(sheet.album.id)?.count ?? 0
      return (
        <ConfirmSheet
          title={`Delete “${sheet.album.name}”?`}
          confirmLabel="Delete album"
          onClose={close}
          onConfirm={async () => {
            await deleteAlbum(sheet.album.id)
            if (lib.album?.id === sheet.album.id) lib.setView('all')
            close()
          }}
        >
          Only the album goes away. {n ? `Its ${plural(n, 'photo')} stay in your library.` : ''}
        </ConfirmSheet>
      )
    }
    case 'reset':
      return (
        <ConfirmSheet
          title={`Reset edits on ${plural(sheet.ids.length, 'photo')}?`}
          confirmLabel="Reset edits"
          onClose={close}
          onConfirm={async () => {
            close()
            await resetEdits(sheet.ids)
          }}
        >
          Every adjustment, crop and look goes back to how the {sheet.ids.length === 1 ? 'photo was' : 'photos were'} shot. Ratings, flags and albums stay.
        </ConfirmSheet>
      )
    case 'delete':
      return (
        <ConfirmSheet
          title={`Delete ${plural(sheet.ids.length, 'photo')}?`}
          confirmLabel={sheet.ids.length === 1 ? 'Delete photo' : `Delete ${plural(sheet.ids.length, 'photo')}`}
          onClose={close}
          onConfirm={async () => {
            if (await removePhotos(sheet.ids)) lib.setSel(EMPTY_SELECTION)
            close()
          }}
        >
          This removes the {sheet.ids.length === 1 ? 'original and its edits' : 'originals and their edits'} from this device and can’t be undone. Copies you exported stay where
          you saved them.
        </ConfirmSheet>
      )
    case 'keywordMenu':
      return (
        <MenuSheet
          title={sheet.name}
          onClose={close}
          items={[
            { label: 'Rename…', icon: 'edit', onClick: () => open({ type: 'renameKeyword', name: sheet.name }) },
            {
              label: 'Remove from all photos…',
              icon: 'trash',
              danger: true,
              onClick: () => open({ type: 'deleteKeyword', name: sheet.name, count: lib.keywords.find((k) => k.name === sheet.name)?.count ?? 0 }),
            },
          ]}
        />
      )
    case 'renameKeyword':
      return (
        <NameSheet
          title="Rename keyword"
          initial={sheet.name}
          confirmLabel="Rename"
          onClose={close}
          onSubmit={async (name) => {
            const n = await renameKeyword(sheet.name, name)
            if (lib.keyword === sheet.name) lib.setView(`keyword:${name.trim()}`)
            toast(`Renamed on ${plural(n, 'photo')}`)
          }}
        />
      )
    case 'deleteKeyword':
      return (
        <ConfirmSheet
          title={`Remove “${sheet.name}”?`}
          confirmLabel="Remove keyword"
          onClose={close}
          onConfirm={async () => {
            await deleteKeyword(sheet.name)
            if (lib.keyword === sheet.name) lib.setView('all')
            close()
          }}
        >
          The keyword comes off {plural(sheet.count, 'photo')}. The photos stay.
        </ConfirmSheet>
      )
    case 'keywords':
      return (
        <Sheet title={sheet.ids.length === 1 ? 'Keywords' : `Keywords · ${plural(sheet.ids.length, 'photo')}`} onClose={close}>
          <div className="stack">
            <KeywordEditor ids={sheet.ids} autoFocus />
            <p className="muted small">Separate keywords with commas. Search finds photos by keyword, and the sidebar lists them all.</p>
          </div>
        </Sheet>
      )
    case 'more': {
      const ids = sheet.ids
      const one = ids.length === 1 ? lib.byId.get(ids[0]) : undefined
      const items: MenuItem[] = [
        { label: 'Keywords…', icon: 'tag', onClick: () => open({ type: 'keywords', ids }) },
        ...(ids.length >= 2 ? [{ label: 'Compare', icon: 'compare' as const, onClick: () => lib.openCompare(ids) }, { label: 'Survey', icon: 'survey' as const, onClick: () => lib.openSurvey(ids) }] : []),
        ...(ids.length >= 2 ? [{ label: 'Merge to HDR or panorama…', icon: 'image' as const, onClick: () => open({ type: 'merge', ids }) }] : []),
        { label: 'Mark as pick', icon: 'flag', onClick: () => void setFlag(ids, 1) },
        { label: 'Reject', icon: 'reject', onClick: () => void setFlag(ids, -1) },
        { label: 'Clear flag', icon: 'x', onClick: () => void setFlag(ids, 0) },
        ...(one ? [{ label: 'Copy edits', icon: 'copy' as const, onClick: () => void copyEdits(one) }] : []),
        { label: 'Reset edits…', icon: 'undo', onClick: () => open({ type: 'reset', ids }) },
        ...(lib.album ? [{ label: `Remove from “${lib.album.name}”`, icon: 'minus' as const, onClick: () => void removeFromAlbum(ids, lib.album!.id) }] : []),
      ]
      return <MenuSheet title={plural(ids.length, 'photo')} onClose={close} items={items} />
    }
  }
}
