// zlib-wrapped deflate through the platform's CompressionStream (browsers and
// Node 18+). Output chunks are handed over as they come so large images never
// need one contiguous compressed buffer.

export interface Deflater {
  write(bytes: Uint8Array): Promise<void>
  /** Flush and return every compressed chunk. */
  finish(): Promise<Uint8Array[]>
}

export function createDeflater(): Deflater {
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  const chunks: Uint8Array[] = []
  const reader = cs.readable.getReader()
  const drained = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      chunks.push(value)
    }
  })()
  return {
    write: (bytes) => writer.write(bytes as Uint8Array<ArrayBuffer>),
    async finish() {
      await writer.close()
      await drained
      return chunks
    },
  }
}

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const d = createDeflater()
  await d.write(bytes)
  return concat(await d.finish())
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
