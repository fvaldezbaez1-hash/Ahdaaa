import { useSyncExternalStore } from 'react'

// Hash routing ("#/edit/abc") works on any static host and keeps the installed
// app on one URL. Routes: #/ library · #/edit/:id · #/presets · #/settings

const EVENT = 'lumen:route'

function read(): string {
  return location.hash.replace(/^#/, '') || '/'
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener('hashchange', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener('hashchange', cb)
    window.removeEventListener(EVENT, cb)
  }
}

export interface Route {
  path: string
  parts: string[]
  query: URLSearchParams
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, read, () => '/')
  const [path, qs = ''] = raw.split('?')
  return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) }
}

const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = `#${to.startsWith('/') ? to : `/${to}`}`
  if (opts.replace) history.replaceState({ depth: depth() }, '', url)
  else history.pushState({ depth: depth() + 1 }, '', url)
  window.dispatchEvent(new Event(EVENT))
}

/** Back within the app, or to `fallback` when this screen was opened directly. */
export function goBack(fallback = '/') {
  if (depth() > 0) history.back()
  else navigate(fallback, { replace: true })
}

export const link = (to: string) => `#${to}`
