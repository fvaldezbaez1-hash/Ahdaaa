// A sync folder: any folder the user picks — normally inside iCloud Drive,
// Dropbox, OneDrive or Google Drive, whose own app carries it to their other
// devices. Lumen only reads and writes files there:
//
//   devices/<device id>.json   each device's merged catalog (written only by that device)
//   rasters/<id>.bin           AI results the recipes use (never change once written)
//   originals/<photo id>/<name> the original files, when "Include originals" is on
//
// Every device writes only its own catalog file, so two devices syncing at
// once never overwrite each other; each merges all the others' on its turn.
import type { Catalog, SyncPhoto, SyncRaster } from './catalog'

export interface SyncFolder {
  name: string
  read(path: string): Promise<Blob | null>
  write(path: string, data: Blob | string | Uint8Array<ArrayBuffer>): Promise<void>
  exists(path: string): Promise<boolean>
  /** File names directly in `dir` ([] if it doesn't exist). */
  list(dir: string): Promise<string[]>
}

export const DEVICES = 'devices'
export const devicePath = (id: string) => `${DEVICES}/${id}.json`
export const rasterPath = (id: string) => `rasters/${id}.bin`
/** File names keep what the user can recognize, minus characters cloud drives refuse. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what goes
export const originalPath = (p: Pick<SyncPhoto, 'id' | 'fileName'>) => `originals/${p.id}/${p.fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}`

// ---------- File System Access (Chromium desktop) ----------

type Permission = 'granted' | 'denied' | 'prompt'
interface PermissionHandle {
  queryPermission?(o: { mode: 'readwrite' }): Promise<Permission>
  requestPermission?(o: { mode: 'readwrite' }): Promise<Permission>
}
interface FsWindow {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>
}

export const canPickFolder = () => typeof window !== 'undefined' && typeof (window as unknown as FsWindow).showDirectoryPicker === 'function'

/** Ask the user for the folder (call from a click). */
export function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const pick = (window as unknown as FsWindow).showDirectoryPicker
  if (!pick) throw new Error('This browser can’t use a folder. Use “Export sync file” instead.')
  return pick({ id: 'lumen-sync', mode: 'readwrite', startIn: 'documents' })
}

/** Whether Lumen may still use the folder; with `ask`, prompt (needs a click). */
export async function folderPermission(h: FileSystemDirectoryHandle, ask = false): Promise<Permission> {
  const p = h as unknown as PermissionHandle
  const o = { mode: 'readwrite' as const }
  const cur = (await p.queryPermission?.(o).catch(() => 'prompt' as const)) ?? 'granted'
  if (cur === 'granted' || !ask) return cur
  return (await p.requestPermission?.(o).catch(() => 'denied' as const)) ?? 'denied'
}

const isMissing = (e: unknown) => ['NotFoundError', 'TypeMismatchError'].includes((e as { name?: string })?.name ?? '')

export function handleFolder(root: FileSystemDirectoryHandle): SyncFolder {
  const dirOf = async (parts: string[], create: boolean) => {
    let d = root
    for (const part of parts) d = await d.getDirectoryHandle(part, { create })
    return d
  }
  const split = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] }
  }
  const fileHandle = async (path: string, create: boolean) => {
    const { dirs, file } = split(path)
    return (await dirOf(dirs, create)).getFileHandle(file, { create })
  }
  return {
    name: root.name,
    async read(path) {
      try {
        return await (await fileHandle(path, false)).getFile()
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },
    async write(path, data) {
      const w = await (await fileHandle(path, true)).createWritable()
      await w.write(data)
      await w.close()
    },
    async exists(path) {
      try {
        await fileHandle(path, false)
        return true
      } catch (e) {
        if (isMissing(e)) return false
        throw e
      }
    },
    async list(dir) {
      try {
        const d = await dirOf(dir.split('/').filter(Boolean), false)
        const names: string[] = []
        for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) if (h.kind === 'file') names.push(name)
        return names
      } catch (e) {
        if (isMissing(e)) return []
        throw e
      }
    },
  }
}

// ---------- In memory (tests) ----------

export function memoryFolder(name = 'memory', files = new Map<string, Blob>()): SyncFolder & { files: Map<string, Blob> } {
  return {
    name,
    files,
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => void files.set(path, data instanceof Blob ? data : new Blob([data])),
    exists: async (path) => files.has(path),
    list: async (dir) => [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1)),
  }
}

/** Every other device's catalog in the folder (unreadable files are skipped and counted). */
export async function readCatalogs(folder: SyncFolder, ownId: string, parse: (json: unknown) => Catalog): Promise<{ catalogs: Catalog[]; unreadable: number }> {
  const catalogs: Catalog[] = []
  let unreadable = 0
  for (const name of await folder.list(DEVICES)) {
    // Cloud apps leave conflict copies ("x (1).json", "x 2.json"); a device writes only its own file, so ignore any other.
    if (!/^[\w-]+\.json$/.test(name) || name === `${ownId}.json`) continue
    try {
      const blob = await folder.read(`${DEVICES}/${name}`)
      if (blob) catalogs.push(parse(JSON.parse(await blob.text())))
    } catch {
      unreadable++
    }
  }
  return { catalogs, unreadable }
}

export const rasterFromFolder = (folder: SyncFolder) => async (r: SyncRaster) => {
  const b = await folder.read(rasterPath(r.id))
  return b ? new Uint8Array(await b.arrayBuffer()) : null
}
