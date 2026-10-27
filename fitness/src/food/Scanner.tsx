import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const

/**
 * Uses the phone's built-in barcode reader where there is one (Android
 * Chrome) and a bundled WebAssembly reader everywhere else (iPhone), so it
 * also works offline.
 */
async function makeDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      if (supported.includes('ean_13')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) })
    } catch {
      // fall through to the bundled reader
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}

export function ScannerSheet({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const done = useRef(false)
  const found = useRef(onDetected)
  useLayoutEffect(() => {
    found.current = onDetected
  })

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser can’t use the camera. Type the barcode number below instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        setError(denied ? 'Camera access was blocked. Allow camera access for this app in your phone’s settings, or type the barcode below.' : 'Couldn’t start the camera. Type the barcode number below instead.')
        return
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop())
      const v = video.current!
      v.srcObject = stream
      await v.play().catch(() => {})
      let detector: Detector
      try {
        detector = await makeDetector()
      } catch {
        setError('The barcode reader didn’t load. Type the barcode number below instead.')
        return
      }
      const tick = async () => {
        if (stopped || done.current) return
        try {
          if (v.readyState >= 2) {
            const codes = await detector.detect(v)
            const code = codes.find((c) => /^\d{6,14}$/.test(c.rawValue))?.rawValue
            if (code && !done.current) {
              done.current = true
              navigator.vibrate?.(40)
              found.current(code)
              return
            }
          }
        } catch {
          // a bad frame; keep going
        }
        timer = setTimeout(tick, 180)
      }
      void tick()
    })()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      <div className="stack">
        {error ? (
          <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Icon name="camera" size={32} />
            <p className="text-2">{error}</p>
          </div>
        ) : (
          <div className="scanner">
            <video ref={video} playsInline muted autoPlay />
            <div className="frame" />
          </div>
        )}
        {!error && <p className="small muted" style={{ textAlign: 'center' }}>Line the barcode up inside the box.</p>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            const code = manual.replace(/\D/g, '')
            if (code.length >= 6) {
              done.current = true
              onDetected(code)
            }
          }}
        >
          <input className="input grow" inputMode="numeric" placeholder="Or type the barcode number" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Barcode number" />
          <button className="btn primary" type="submit" disabled={manual.replace(/\D/g, '').length < 6}>
            Look up
          </button>
        </form>
      </div>
    </Sheet>
  )
}
