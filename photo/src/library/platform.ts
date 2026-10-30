import { IMAGE_EXTENSIONS, RAW_EXTENSIONS } from '../io/api'

const nav = typeof navigator === 'undefined' ? undefined : navigator

/** Apple keyboards use ⌘ where others use Ctrl (iPadOS reports itself as a Mac). */
export const isApple = !!nav && /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent)
export const isIOS = !!nav && (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1))
export const MOD = isApple ? '⌘' : 'Ctrl'

/** File picker filter: images plus every RAW extension (many RAW types have no MIME type). */
export const ACCEPT = ['image/*', ...[...RAW_EXTENSIONS, ...IMAGE_EXTENSIONS].map((e) => `.${e}`)].join(',')
