// JPEG export through MozJPEG (WASM), with our own EXIF (APP1) and ICC (APP2)
// segments spliced in after SOI/JFIF.
import encode from '@jsquash/jpeg/encode'

export interface JpegOptions {
  /** 1…100. */
  quality: number
  /** TIFF-structured EXIF block. */
  exif?: Uint8Array
  icc?: Uint8Array
}

function segment(marker: number, header: string, body: Uint8Array, extra: number[] = []): Uint8Array<ArrayBuffer> {
  const len = 2 + header.length + extra.length + body.length
  if (len > 0xffff) throw new Error('JPEG segment too large')
  const out = new Uint8Array(2 + len)
  out.set([0xff, marker, len >> 8, len & 255])
  for (let i = 0; i < header.length; i++) out[4 + i] = header.charCodeAt(i)
  out.set(extra, 4 + header.length)
  out.set(body, 4 + header.length + extra.length)
  return out
}

/** Insert metadata segments after SOI (and after JFIF APP0, if present). */
export function insertJpegSegments(jpeg: Uint8Array, exif?: Uint8Array, icc?: Uint8Array): Uint8Array<ArrayBuffer>[] {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG')
  let at = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5])
  const segs: Uint8Array<ArrayBuffer>[] = []
  if (exif) segs.push(segment(0xe1, 'Exif\0\0', exif))
  if (icc) segs.push(segment(0xe2, 'ICC_PROFILE\0', icc, [1, 1]))
  return [jpeg.slice(0, at), ...segs, jpeg.slice(at)]
}

export async function encodeJpeg(rgba: Uint8ClampedArray, width: number, height: number, opts: JpegOptions): Promise<Blob> {
  const quality = Math.max(1, Math.min(100, Math.round(opts.quality)))
  // MozJPEG reads only data/width/height; a plain object avoids ImageData's canvas-size limits.
  const image = { data: rgba, width, height, colorSpace: 'srgb' } as ImageData
  const buf = await encode(image, {
    quality,
    progressive: true,
    optimize_coding: true,
    // Full-resolution color for high quality settings, like Lightroom above ~90.
    auto_subsample: false,
    chroma_subsample: quality >= 90 ? 1 : 2,
  })
  return new Blob(insertJpegSegments(new Uint8Array(buf), opts.exif, opts.icc), { type: 'image/jpeg' })
}
