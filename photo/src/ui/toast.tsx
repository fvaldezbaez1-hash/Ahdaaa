import { useEffect, useState } from 'react'

const EVENT = 'lumen:toast'

/** Show a short message at the bottom of the screen. */
export function toast(message: string, ms = 2600) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, ms } }))
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = (e: Event) => {
      const { message, ms } = (e as CustomEvent<{ message: string; ms: number }>).detail
      setMsg({ text: message, key: Date.now() })
      clearTimeout(timer)
      timer = setTimeout(() => setMsg(null), ms)
    }
    window.addEventListener(EVENT, on)
    return () => {
      window.removeEventListener(EVENT, on)
      clearTimeout(timer)
    }
  }, [])
  if (!msg) return null
  return (
    <div className="toast" key={msg.key} role="status">
      {msg.text}
    </div>
  )
}
