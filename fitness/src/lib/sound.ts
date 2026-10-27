// Rest-timer chime. Browsers (iPhone especially) only allow audio that was
// started from a tap, so the AudioContext is unlocked when you complete a set
// and the chime is scheduled ahead of time on the audio clock, which keeps
// time even if the page's timers get throttled.

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call from a tap handler. */
export function unlockAudio() {
  audio()
}

/** Schedules three short beeps `inMs` from now. Returns a cancel function. */
export function scheduleChime(inMs: number): () => void {
  const a = audio()
  if (!a) return () => {}
  const start = a.currentTime + Math.max(0, inMs) / 1000
  const nodes: OscillatorNode[] = []
  ;[0, 0.22, 0.44].forEach((offset, i) => {
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = 'sine'
    osc.frequency.value = i === 2 ? 1320 : 880
    const t = start + offset
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.connect(gain).connect(a.destination)
    osc.start(t)
    osc.stop(t + 0.2)
    nodes.push(osc)
  })
  return () => {
    for (const n of nodes) {
      try {
        n.stop()
      } catch {
        // already stopped
      }
    }
  }
}

export function buzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern)
}
