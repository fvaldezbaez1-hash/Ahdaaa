import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

/** Phone-sized layout (bottom tab bar, single column). */
export const PHONE_QUERY = '(max-width: 899px)'
export const useIsPhone = () => useMediaQuery(PHONE_QUERY)

/** An object URL for a Blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return url
}

/** Element size via ResizeObserver (content box, CSS pixels). */
export function useElementSize(el: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return size
}

/** True if the user is typing in a field (so global shortcuts should stay out of the way). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' ? !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type) : tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}
