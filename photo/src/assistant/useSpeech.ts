import { useEffect, useRef, useState } from 'react'
import { toast } from '../ui/toast'

// Dictation through the Web Speech API (Safari, Chrome, Edge). The browser's
// own speech service does the recognition, not Lumen or the AI vendor.

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function recognizer(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** `onText` receives the whole transcript so far each time it changes. */
export function useSpeech(onText: (transcript: string) => void) {
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(onText)
  useEffect(() => {
    cb.current = onText
  })
  useEffect(() => () => rec.current?.abort(), [])

  const start = () => {
    const Ctor = recognizer()
    if (!Ctor || rec.current) return
    const r = new Ctor()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => cb.current(Array.from(e.results, (x) => x[0].transcript).join(''))
    r.onend = () => {
      rec.current = null
      setListening(false)
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked for Lumen. Allow it in your browser’s site settings.', 4000)
    }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      rec.current = null
    }
  }

  return { supported: !!recognizer(), listening, start, stop: () => rec.current?.stop() }
}
