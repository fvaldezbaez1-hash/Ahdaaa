import type { PhotoMeta } from '../../io/types'

export function exposureLine(m: PhotoMeta): string {
  const parts: string[] = []
  if (m.iso) parts.push(`ISO ${m.iso}`)
  if (m.shutter) parts.push(m.shutter >= 1 ? `${+m.shutter.toFixed(1)} s` : `1/${Math.round(1 / m.shutter)} s`)
  if (m.aperture) parts.push(`ƒ/${+m.aperture.toFixed(1)}`)
  if (m.focalLength) parts.push(`${Math.round(m.focalLength)} mm`)
  return parts.join(' · ')
}

export function cameraLine(m: PhotoMeta): string {
  const model = m.model && m.make && !m.model.toLowerCase().startsWith(m.make.toLowerCase().split(' ')[0]) ? `${m.make} ${m.model}` : m.model ?? m.make
  return [model, m.lens].filter(Boolean).join(' · ')
}
