// Public API of the import / storage / export layer. OWNER: io agent — replace
// the stub bodies; keep these signatures (other modules import them).
import type { EditRecipe } from '../edit/types'
import type { DecodedPhoto, ExportOptions, PhotoRecord } from './types'

/** File extensions Lumen opens as RAW (lower case, no dot). */
export const RAW_EXTENSIONS: readonly string[] = [
  '3fr', 'ari', 'arw', 'bay', 'braw', 'cap', 'cr2', 'cr3', 'crw', 'dcr', 'dcs', 'dng', 'drf', 'eip', 'erf', 'fff', 'gpr', 'iiq', 'k25', 'kdc',
  'mdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'ptx', 'pxn', 'r3d', 'raf', 'raw', 'rw2', 'rwl', 'rwz', 'sr2', 'srf', 'srw', 'x3f',
]
/** Other image types. */
export const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp']

export function isSupportedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return RAW_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext)
}

export interface ImportProgress {
  done: number
  total: number
  current?: string
}

export interface ImportResult {
  added: string[]
  skipped: { name: string; reason: string }[]
}

/** Copy files into the library: decode, read metadata, store original, make thumbnail. */
export async function importFiles(_files: File[], _opts: { onProgress?: (p: ImportProgress) => void; presetId?: string; albumId?: string; signal?: AbortSignal } = {}): Promise<ImportResult> {
  throw new Error('importFiles not implemented yet')
}

/**
 * Decode a stored photo for editing at working resolution (long edge ≤ maxLongEdge).
 * Cached in memory (LRU) so reopening is instant.
 */
export async function loadWorking(_id: string, _maxLongEdge?: number): Promise<DecodedPhoto> {
  throw new Error('loadWorking not implemented yet')
}

/** Decode any file (used by import and export). quality 'preview' may decode RAW at half size. */
export async function decodeFile(_file: Blob, _opts: { fileName: string; quality: 'preview' | 'full'; maxLongEdge?: number; signal?: AbortSignal }): Promise<DecodedPhoto> {
  throw new Error('decodeFile not implemented yet')
}

/** Save the recipe (debounce in the caller) and mark the photo edited. */
export async function saveRecipe(_id: string, _recipe: EditRecipe): Promise<void> {
  throw new Error('saveRecipe not implemented yet')
}

/** Re-render the stored thumbnail from the photo's current recipe. */
export async function refreshThumbnail(_id: string): Promise<void> {
  throw new Error('refreshThumbnail not implemented yet')
}

export interface ExportProgress {
  done: number
  total: number
  /** 0…1 within the current photo. */
  fraction: number
  current?: string
}

/** Render at full quality, encode, and save/share. Resolves when every file is handed to the OS. */
export async function exportPhotos(_ids: string[], _opts: ExportOptions, _onProgress?: (p: ExportProgress) => void, _signal?: AbortSignal): Promise<{ saved: number; failed: { name: string; reason: string }[] }> {
  throw new Error('exportPhotos not implemented yet')
}

/** A small JPEG of the edited photo for the AI assistant (data URL, long edge ≈ maxLongEdge). */
export async function previewJpeg(_id: string, _recipe: EditRecipe, _maxLongEdge = 1024): Promise<{ dataUrl: string; width: number; height: number }> {
  throw new Error('previewJpeg not implemented yet')
}

/** Delete photos and everything stored for them. */
export async function deletePhotos(_ids: string[]): Promise<void> {
  throw new Error('deletePhotos not implemented yet')
}

export type { PhotoRecord }
