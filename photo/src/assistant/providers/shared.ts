import { AiError } from '../errors'

/** Split a base64 image data URL into its media type and payload. */
export function splitDataUrl(url: string): { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(url)
  if (!m) throw new AiError('request', 'The photo preview has an unsupported format.')
  return { mediaType: m[1] as 'image/jpeg' | 'image/png' | 'image/webp', data: m[2] }
}

/** Tool arguments arrive as JSON text from some vendors; bad JSON becomes null so validation reports it to the model. */
export function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json || '{}')
  } catch {
    return null
  }
}

/** The tiny prompt used to test a key. */
export const TEST_PROMPT = 'Reply with OK.'
