// Handing exported files to the user:
//   phones          → share sheet ("Save Image" / "Save to Files")
//   desktop, many   → a folder picked once (File System Access), else one download each
//   desktop, single → a save dialog, else a download
import type { ExportFormat } from './types'
import { isPhone } from './platform'
import { baseName } from './formats'

export interface ExportFile {
  name: string
  blob: Blob
}

export interface ExportSink {
  write(file: ExportFile): Promise<void>
  /** Called once after the last write (the share sheet opens here). */
  finish(): Promise<void>
}

export const EXTENSION: Record<ExportFormat, string> = { jpeg: '.jpg', png: '.png', tiff16: '.tif' }
const MIME: Record<ExportFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', tiff16: 'image/tiff' }

/** "IMG_0001.ARW" → "IMG_0001-lumen.jpg", then "-lumen-2"… while `taken` has it. */
export function exportName(fileName: string, format: ExportFormat, taken: (name: string) => boolean): string {
  const stem = `${baseName(fileName)}-lumen`
  for (let n = 1; ; n++) {
    const name = `${stem}${n > 1 ? `-${n}` : ''}${EXTENSION[format]}`
    if (!taken(name)) return name
  }
}

// File System Access API: Chromium desktop only, not in TypeScript's DOM types yet.
interface FsWindow {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>
  showSaveFilePicker?: (o?: { id?: string; suggestedName?: string; startIn?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>
}
const fsWindow = () => (typeof window === 'undefined' ? {} : (window as unknown as FsWindow))

type SharePrompt = (share: () => Promise<void>, count: number) => Promise<void>
let sharePrompt: SharePrompt | null = null

/**
 * Browsers only open the share sheet during a tap, and a long export outlives
 * the tap that started it. The UI registers a prompt that shows a "Save N
 * photos" button and calls `share()` from its click handler.
 */
export function setSharePrompt(prompt: SharePrompt | null): void {
  sharePrompt = prompt
}

function canShareFiles(): boolean {
  try {
    return typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File([], 'x.jpg', { type: 'image/jpeg' })] })
  } catch {
    return false
  }
}

function writeToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  return handle.createWritable().then(async (w) => {
    await w.write(blob)
    await w.close()
  })
}

function download(file: ExportFile) {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const downloadSink = (): ExportSink => ({ write: async (f) => download(f), finish: async () => undefined })

function shareSink(): ExportSink {
  const files: File[] = []
  return {
    write: async (f) => {
      files.push(new File([f.blob], f.name, { type: f.blob.type }))
    },
    async finish() {
      if (!files.length) return
      const share = () => navigator.share({ files })
      const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
      try {
        if (sharePrompt && !active) await sharePrompt(share, files.length)
        else await share()
      } catch (e) {
        // NotAllowedError: the tap expired and nobody registered a prompt — download instead.
        if ((e as Error).name === 'NotAllowedError') files.forEach((f) => download({ name: f.name, blob: f }))
        else throw e
      }
    },
  }
}

/** Pick where files go. Call straight from the click handler: pickers need the user's tap. */
export async function openSink(fileNames: string[], format: ExportFormat): Promise<ExportSink> {
  const fs = fsWindow()
  if (isPhone() && canShareFiles()) return shareSink()
  if (fileNames.length > 1 && fs.showDirectoryPicker) {
    const dir = await fs.showDirectoryPicker({ id: 'lumen-export', mode: 'readwrite', startIn: 'pictures' })
    const used = new Set<string>()
    return {
      async write(f) {
        // Never overwrite: bump the suffix past files already in the folder.
        let name = f.name
        for (let n = 2; used.has(name) || (await dir.getFileHandle(name).then(() => true, () => false)); n++)
          name = f.name.replace(/(\.[^.]+)$/, `-${n}$1`)
        used.add(name)
        await writeToHandle(await dir.getFileHandle(name, { create: true }), f.blob)
      },
      finish: async () => undefined,
    }
  }
  if (fileNames.length === 1 && fs.showSaveFilePicker) {
    const handle = await fs.showSaveFilePicker({
      id: 'lumen-export',
      startIn: 'pictures',
      suggestedName: fileNames[0],
      types: [{ description: format === 'tiff16' ? 'TIFF image' : `${format.toUpperCase()} image`, accept: { [MIME[format]]: [EXTENSION[format]] } }],
    })
    return { write: (f) => writeToHandle(handle, f.blob), finish: async () => undefined }
  }
  return downloadSink()
}
