// Export file names from a template: "{name}-web", "{date}_{seq}", "Wedding {seq}".
// Tokens are replaced per photo; anything else is kept as typed. Pure, so the
// export sheet's live example and the exporter agree (and it's unit-tested).
import type { ExportOptions, PhotoRecord } from '../io/types'
import { FORMATS } from './exportMath'
import { formatCamera } from './library'

export const DEFAULT_TEMPLATE = '{name}-lumen'

export const TOKENS: { token: string; label: string }[] = [
  { token: '{name}', label: 'File name' },
  { token: '{date}', label: 'Date' },
  { token: '{time}', label: 'Time' },
  { token: '{seq}', label: 'Number' },
  { token: '{camera}', label: 'Camera' },
  { token: '{rating}', label: 'Stars' },
  { token: '{keywords}', label: 'Keywords' },
]

type Named = Pick<PhotoRecord, 'fileName' | 'takenAt' | 'rating' | 'meta' | 'keywords'>

export interface NameContext {
  /** 1-based position in the export. */
  seq: number
  /** Photos in the export (sets the digits of {seq}: 001 for up to 999). */
  total: number
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Characters no file system accepts (and control characters) become "-"; no leading/trailing dots or spaces. */
export function sanitizeFileName(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex -- control characters are exactly what goes
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 120)
    .trim()
}

const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, '')

/** Replace the tokens for one photo. The result has no extension; empty templates fall back to {name}. */
export function renderFileName(template: string, p: Named, ctx: NameContext): string {
  const d = new Date(p.takenAt)
  const digits = Math.max(3, String(ctx.total).length)
  const values: Record<string, string> = {
    name: stem(p.fileName),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    seq: pad(ctx.seq, digits),
    camera: formatCamera(p.meta),
    rating: String(p.rating ?? 0),
    keywords: (p.keywords ?? []).slice(0, 5).join('-'),
  }
  const out = sanitizeFileName(template.replace(/\{(\w+)\}/g, (m, t: string) => values[t.toLowerCase()] ?? m))
  return out || sanitizeFileName(stem(p.fileName)) || 'photo'
}

/** Unknown tokens in a template (shown as a hint; they're kept literally). */
export const unknownTokens = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[0]).filter((t) => !TOKENS.some((k) => k.token === t.toLowerCase()))

/** The whole file name a photo gets with these export settings (before any "-2" for clashes). */
export const fileNameFor = (p: Named, o: Pick<ExportOptions, 'format' | 'fileName'>, seq = 1, total = 1) =>
  `${renderFileName(o.fileName || DEFAULT_TEMPLATE, p, { seq, total })}.${FORMATS.find((f) => f.value === o.format)?.ext ?? 'jpg'}`
