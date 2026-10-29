// The heavy dependencies of the library/export code, behind one object so
// Node unit tests (no GPU, no workers) can swap in fakes.
import { decodeBlob } from './decoder'
import type { EncodeArgs } from './io.worker'
import { makeThumbnail, renderPhoto } from './render'
import type { ExportSink } from './save'
import { work } from './worker'

export const seams: {
  decode: typeof decodeBlob
  thumbnail: typeof makeThumbnail
  render: typeof renderPhoto
  encode: (args: EncodeArgs, signal?: AbortSignal) => Promise<Blob>
  /** When set, exports go here instead of to the user (tests). */
  sink: ExportSink | null
} = {
  decode: decodeBlob,
  thumbnail: makeThumbnail,
  render: renderPhoto,
  // The pixel buffer moves to the worker: the caller must not use it afterwards.
  encode: (args, signal) => work('encode', args, [args.rgba.buffer as ArrayBuffer], signal),
  sink: null,
}
