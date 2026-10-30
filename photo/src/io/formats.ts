// File types Lumen opens, and naming helpers.

/** File extensions Lumen opens as RAW (lower case, no dot). */
export const RAW_EXTENSIONS: readonly string[] = [
  '3fr', 'ari', 'arw', 'bay', 'braw', 'cap', 'cr2', 'cr3', 'crw', 'dcr', 'dcs', 'dng', 'drf', 'eip', 'erf', 'fff', 'gpr', 'iiq', 'k25', 'kdc',
  'mdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'ptx', 'pxn', 'r3d', 'raf', 'raw', 'rw2', 'rwl', 'rwz', 'sr2', 'srf', 'srw', 'x3f',
]
/** Other image types. */
export const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp']

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

export const isRawName = (name: string) => RAW_EXTENSIONS.includes(extOf(name))

export function isSupportedFile(name: string): boolean {
  const ext = extOf(name)
  return RAW_EXTENSIONS.includes(ext) || IMAGE_EXTENSIONS.includes(ext)
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
  tif: 'image/tiff', tiff: 'image/tiff', gif: 'image/gif', bmp: 'image/bmp', dng: 'image/x-adobe-dng',
}

/** Browsers often report '' for RAW files; fall back to the extension. */
export function mimeOf(file: { name: string; type: string }): string {
  return file.type || MIME[extOf(file.name)] || `image/x-${extOf(file.name) || 'unknown'}`
}

export const baseName = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)
