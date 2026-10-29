// The running import, kept outside React so it carries on (and reports back)
// when the user browses elsewhere while a big card is copied in.
import { useSyncExternalStore } from 'react'
import { importFiles, isSupportedFile, type ImportProgress, type ImportResult } from '../io/api'
import { db, kvGet, kvSet } from '../io/db'
import { toast } from '../ui/toast'
import { errorMessage } from './actions'
import { importSummary } from './library'

export const LAST_IMPORT_KEY = 'library.lastImportAt'

export interface ImportState {
  running: boolean
  progress: ImportProgress | null
  /** The last finished import, until dismissed (the import sheet lists skipped files). */
  result: (ImportResult & { ignored: number; cancelled: boolean }) | null
}

let state: ImportState = { running: false, progress: null, result: null }
let controller: AbortController | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<ImportState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** Folders and drops bring sidecars (.xmp), hidden macOS files ("._IMG.ARW") and the like; leave them out. */
export function importable(files: readonly File[]): File[] {
  return files.filter((f) => !f.name.startsWith('.') && isSupportedFile(f.name))
}

export const importer = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  async start(all: readonly File[], presetId?: string) {
    if (state.running) return
    const files = importable(all)
    const ignored = all.length - files.length
    if (!files.length) {
      toast(ignored ? `Nothing to import: ${ignored === 1 ? 'that file isn’t' : 'those files aren’t'} a supported photo format` : 'No photos chosen')
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    set({ running: true, progress: { done: 0, total: files.length }, result: null })
    const previous = await kvGet<number>(LAST_IMPORT_KEY).catch(() => undefined)
    const startedAt = Date.now()
    try {
      await kvSet(LAST_IMPORT_KEY, startedAt)
      const res = await importFiles(files, { presetId, signal, onProgress: (progress) => set({ progress }) })
      const result = { ...res, ignored, cancelled: signal.aborted }
      set({ result })
      toast(importSummary(result.added.length, result.skipped, ignored, result.cancelled), 5000)
    } catch (e) {
      toast(signal.aborted ? 'Import cancelled' : `Import failed: ${errorMessage(e)}`, 5000)
    } finally {
      controller = null
      set({ running: false, progress: null })
      // Nothing new arrived: keep "Last import" pointing at the previous one.
      if (previous !== undefined && (await db.photos.where('addedAt').aboveOrEqual(startedAt).count().catch(() => 1)) === 0) await kvSet(LAST_IMPORT_KEY, previous).catch(() => {})
    }
  },

  cancel() {
    controller?.abort()
  },

  dismissResult() {
    set({ result: null })
  },
}

export function useImport(): ImportState {
  return useSyncExternalStore(importer.subscribe, importer.getState, importer.getState)
}
