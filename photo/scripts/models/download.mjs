// Build-time downloads shared by scripts/models/fetch.mjs and
// scripts/lens/build.mjs: retries with backoff (hosts drop connections now
// and then, and one blip shouldn't fail a deploy), a timeout, and a size +
// sha256 check of every file.
import { createHash } from 'node:crypto'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const ATTEMPTS = 4

/** Download `url`; `expect` = { bytes?, sha256 }. Throws after the last attempt. */
export async function download(url, expect, { attempts = ATTEMPTS, timeoutMs = 10 * 60_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadOnce(url, expect, timeoutMs)
    } catch (e) {
      // A missing file won't appear on retry; anything else (resets, timeouts, truncation) might.
      if (attempt >= attempts || /^HTTP 404/.test(e.message)) throw e
      const wait = 2 ** attempt * 1000
      console.log(`retry ${url} in ${wait / 1000} s (${e.message})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

async function downloadOnce(url, expect, timeoutMs) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (expect.bytes !== undefined && bytes.length !== expect.bytes) throw new Error(`size ${bytes.length}, expected ${expect.bytes}`)
  const hash = sha256(bytes)
  if (hash !== expect.sha256) throw new Error(`sha256 ${hash}, expected ${expect.sha256}`)
  return bytes
}
