// Getting linear light out of Lumen's decoded sources: since the RAW decode undoes
// LibRaw's output curve (src/io/raw/curve.ts), every decoded source is linear —
// RAW camera RGB and display-referred JPEG/PNG alike — so this is a plain scale.
import type { SourceColor } from '../engine/types'

/** Code → linear light (0…1) for a decoded source: apply per sample without a full float copy. */
export function linearLut(_color: SourceColor): Float32Array {
  const lut = new Float32Array(0x10000)
  for (let i = 0; i < 0x10000; i++) lut[i] = i / 65535
  return lut
}
