import { useEffect, useState } from 'react'

const EVENT = 'forge:toast'

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }))
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, key: Date.now() })
      clearTimeout(timer)
      timer = setTimeout(() => setMsg(null), 2400)
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
