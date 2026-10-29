import type { PhotoMeta, RawColorInfo } from '../types'

/** What every RAW backend returns: oriented camera RGB, as-shot WB applied, white = 65535. */
export interface RawDecodeResult {
  width: number
  height: number
  data: Uint16Array
  fullWidth: number
  fullHeight: number
  meta: PhotoMeta
  raw: RawColorInfo
}

/** Thrown when a backend can't run on this device at all (as opposed to failing on one file). */
export class BackendUnavailable extends Error {
  name = 'BackendUnavailable'
}
