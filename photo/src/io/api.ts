// Public API of the import / storage / export layer. The work happens in the
// modules next to this file; this is the surface the rest of the app uses.
import { decodeBlob } from './decoder'
import type { ExportSink } from './save'
import { seams } from './seams'
import type { DecodedPhoto, PhotoRecord } from './types'

export { IMAGE_EXTENSIONS, RAW_EXTENSIONS, isSupportedFile } from './formats'
export { importFiles, saveRecipe, refreshThumbnail, refreshThumbnails, deletePhotos } from './library'
export type { ImportOptions, ImportProgress, ImportResult } from './library'
export { loadWorking } from './working'
export { exportPhotos } from './export'
export type { ExportProgress } from './export'
export { setSharePrompt } from './save'
export type { ExportFile, ExportSink } from './save'
export { previewJpeg, storageEstimate } from './preview'
export type { StorageInfo } from './preview'
export { backupEdits, restoreEdits } from './backup'
export type { EditsBackup, RestoreResult } from './backup'

/** Decode any file (used by import and export). quality 'preview' may decode RAW at half size. */
export function decodeFile(file: Blob, opts: { fileName: string; quality: 'preview' | 'full'; maxLongEdge?: number; signal?: AbortSignal }): Promise<DecodedPhoto> {
  return decodeBlob(file, opts)
}

/** Test seam: capture exported files instead of saving/sharing them (null restores normal saving). */
export function setExportSink(sink: ExportSink | null): void {
  seams.sink = sink
}

export type { PhotoRecord }
