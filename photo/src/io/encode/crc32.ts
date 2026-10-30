// CRC-32 (IEEE 802.3), as used by PNG chunks.

let table: Uint32Array | undefined

function makeTable(): Uint32Array {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
}

/** Continue a CRC over more bytes: start with crc32(a), then crc32(b, previous). */
export function crc32(bytes: Uint8Array, prev = 0): number {
  const t = (table ??= makeTable())
  let c = ~prev >>> 0
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
