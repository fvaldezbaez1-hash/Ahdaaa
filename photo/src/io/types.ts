import type { Vec3 } from '../color/matrices'
import type { EditRecipe, Preset, SourceKind } from '../edit/types'
import type { SourceColor, SourceImage } from '../engine/types'

export interface PhotoMeta {
  make?: string
  model?: string
  lens?: string
  iso?: number
  /** Seconds. */
  shutter?: number
  aperture?: number
  /** Millimetres. */
  focalLength?: number
  /** Capture time, ms since epoch (local camera time interpreted as local). */
  takenAt?: number
  gps?: { lat: number; lon: number; alt?: number }
  artist?: string
  copyright?: string
  software?: string
}

/** Everything the renderer needs about a RAW file's color, saved at import. */
export interface RawColorInfo {
  rgbCam: number[] // Mat3
  camXyz: number[] // Mat3
  shotMul: Vec3
  asShot: { temp: number; tint: number }
}

export interface PhotoRecord {
  id: string
  fileName: string
  kind: SourceKind
  mime: string
  fileSize: number
  addedAt: number
  /** Sort key: capture time if known, else addedAt. */
  takenAt: number
  /** Full-resolution size after orientation. */
  width: number
  height: number
  meta: PhotoMeta
  raw?: RawColorInfo
  /** 0…5 stars. */
  rating: number
  /** 1 = pick, −1 = reject, 0 = none. */
  flag: -1 | 0 | 1
  albumIds: string[]
  recipe: EditRecipe
  edited: boolean
  editedAt?: number
  /** Bumped whenever the thumbnail is re-rendered. */
  thumbVersion: number
}

export interface OriginalRecord {
  id: string
  blob: Blob
}

/** Small JPEG of the edited photo (≈ 512 px long edge) for grids. */
export interface ThumbRecord {
  id: string
  blob: Blob
  width: number
  height: number
}

export interface AlbumRecord {
  id: string
  name: string
  createdAt: number
  coverId?: string
}

/** A preset the user saved, the AI made, or that was imported from Lightroom. */
export interface UserPresetRecord extends Preset {
  source: 'user' | 'ai' | 'lightroom'
  createdAt: number
}

export interface KV {
  key: string
  value: unknown
}

/** Result of decoding a file for display/rendering. */
export interface DecodedPhoto {
  image: SourceImage
  color: SourceColor
  /** Full-resolution oriented size (the decoded image may be smaller). */
  fullWidth: number
  fullHeight: number
  meta: PhotoMeta
  kind: SourceKind
  raw?: RawColorInfo
}

export type ExportFormat = 'jpeg' | 'png' | 'tiff16'

export interface ExportOptions {
  format: ExportFormat
  /** JPEG quality 1…100. */
  quality: number
  /** Long edge in px; undefined = full resolution. */
  longEdge?: number
  colorSpace: 'srgb' | 'display-p3'
  /** Copy capture date, camera, lens and exposure settings into the file. */
  keepMetadata: boolean
  /** Remove GPS location even when keeping other metadata. */
  stripLocation: boolean
}
