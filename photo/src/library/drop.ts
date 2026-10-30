import { useEffect, useEffectEvent, useState } from 'react'

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await entryFile(entry as FileSystemFileEntry))
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries returns at most ~100 entries per call; keep reading until it comes back empty.
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walk(child, out)
  }
}

/** Every file in a drop, folders included (recursively). Entries must be taken during the drop event itself. */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry() : null)).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return Promise.resolve([...dt.files])
  const out: File[] = []
  return Promise.all(entries.map((e) => walk(e, out).catch(() => undefined))).then(() => out)
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

/** Accept files dropped anywhere on the window; true while files are dragged over it. */
export function useDropImport(onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false)
  const deliver = useEffectEvent((files: File[]) => onFiles(files))
  useEffect(() => {
    // dragenter/leave fire for every child element crossed; count them to know when the drag really left.
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const dragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return
      e.preventDefault()
      depth = 0
      setOver(false)
      void filesFromDrop(e.dataTransfer).then((files) => files.length && deliver(files))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', dragOver)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', dragOver)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}
