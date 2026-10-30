// Every failure the user can see, as a kind plus a plain-language message.
// Vendor text is only shown for malformed requests, redacted and shortened.

export type AiErrorKind =
  | 'setup' | 'auth' | 'quota' | 'rate' | 'network' | 'blocked' | 'refusal' | 'model' | 'request' | 'server' | 'output' | 'aborted'

export class AiError extends Error {
  readonly kind: AiErrorKind
  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

const KEYISH = /\b(sk-[\w-]{6,}|AIza[\w-]{10,})/g

/** Removes anything that looks like an API key and keeps vendor messages short. */
export function redact(text: string, max = 160): string {
  const clean = text.replace(KEYISH, '[key]').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function aiError(kind: AiErrorKind, vendor: string, opts: { model?: string; detail?: string; relayHint?: boolean } = {}): AiError {
  const detail = opts.detail ? ` (${redact(opts.detail)})` : ''
  switch (kind) {
    case 'setup':
      return new AiError(kind, 'Set up the AI assistant first: choose a provider and paste your API key in Settings → AI assistant.')
    case 'auth':
      return new AiError(kind, `${vendor} didn't accept this API key. Check it in Settings → AI assistant.`)
    case 'quota':
      return new AiError(kind, `Your ${vendor} account is out of credit or over its spending limit. Add billing with ${vendor}, then try again.`)
    case 'rate':
      return new AiError(kind, `${vendor} is limiting requests right now (too many at once, or your plan's limit). Wait a moment and try again.`)
    case 'network':
      return new AiError(kind, typeof navigator !== 'undefined' && navigator.onLine === false ? "You're offline. Connect to the internet and try again." : `Couldn't reach ${vendor}. Check your connection and try again.`)
    case 'blocked':
      return new AiError(
        kind,
        `Couldn't reach ${vendor} from this browser. Check your connection${opts.relayHint ? `; if ${vendor} is blocking direct browser requests, add a relay URL in Settings → AI assistant → Advanced` : ''}.`,
      )
    case 'refusal':
      return new AiError(kind, `${vendor} declined this request. Try describing the edit differently.`)
    case 'model':
      return new AiError(kind, `The model “${opts.model ?? '?'}” isn't available with this key. Choose another model in Settings → AI assistant.`)
    case 'request':
      return new AiError(kind, `${vendor} couldn't process the request${detail}.`)
    case 'server':
      return new AiError(kind, `${vendor} is having trouble right now. Try again in a moment.`)
    case 'output':
      return new AiError(kind, `The answer from ${vendor} was cut off or malformed. Try again.`)
    case 'aborted':
      return new AiError(kind, 'Stopped.')
  }
}

/** Maps an HTTP error from any vendor. `code`/`type` are the vendor's machine-readable error fields. */
export function httpError(status: number | undefined, vendor: string, info: { code?: string | null; message?: string; model?: string; relayHint?: boolean }): AiError {
  const code = (info.code ?? '').toLowerCase()
  const msg = info.message ?? ''
  if (code.includes('insufficient_quota') || code.includes('billing') || /credit balance|billing|insufficient.?quota|spending limit/i.test(msg)) return aiError('quota', vendor)
  if (status === 401 || /api key not valid|invalid.{0,12}api.?key|incorrect api key/i.test(msg)) return aiError('auth', vendor)
  if (status === 403) return /model/i.test(msg) ? aiError('model', vendor, { model: info.model }) : aiError('auth', vendor)
  if (status === 404) return aiError('model', vendor, { model: info.model })
  if (status === 429) return aiError('rate', vendor)
  if (status === 408 || (status !== undefined && status >= 500)) return aiError('server', vendor)
  if (status === 400 && /model/i.test(msg) && /not (found|exist|supported)|unknown|invalid/i.test(msg)) return aiError('model', vendor, { model: info.model })
  return aiError('request', vendor, { detail: msg })
}

export function isAbort(e: unknown): boolean {
  return (e instanceof AiError && e.kind === 'aborted') || (e instanceof Error && e.name === 'AbortError')
}
