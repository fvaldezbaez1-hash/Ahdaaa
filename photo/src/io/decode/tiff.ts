// TIFF via utif2: 8/16-bit RGB and grayscale at full precision, anything else
// (CMYK, palette, float…) through utif2's 8-bit RGBA conversion. Pixel values
// are treated as sRGB-encoded. Runs in the IO worker.
import * as utifModule from 'utif2'
import type { IFD } from 'utif2'
import { orientRgb16, swapsAxes } from './orient'
import { AreaResampler } from './resample'
import { srgb16ToLinearLut, srgb8ToLinearLut } from './srgb'
import { targetSize, type DecodedPixels } from './image'

// utif2 is CommonJS; depending on the bundler its functions sit on the namespace or on `default`.
const UTIF = ((utifModule as unknown as { default?: typeof utifModule }).default ?? utifModule) as typeof utifModule

const first = (ifd: IFD, tag: number): number | undefined => {
  const v = ifd[`t${tag}`]
  return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : undefined
}

export function decodeTiff(buf: ArrayBuffer, maxLongEdge: number | undefined, maxPixels: number): DecodedPixels {
  const ifds = UTIF.decode(buf)
  const all = ifds.flatMap((i) => [i, ...((i.subIFD as unknown as IFD[] | undefined) ?? [])])
  const ifd = all.filter((i) => first(i, 256) && first(i, 257)).sort((a, b) => first(b, 256)! * first(b, 257)! - first(a, 256)! * first(a, 257)!)[0]
  if (!ifd) throw new Error('This TIFF has no image')
  UTIF.decodeImage(buf, ifd)
  const w = ifd.width, h = ifd.height
  const bps = first(ifd, 258) ?? 1, spp = first(ifd, 277) ?? 1, photometric = first(ifd, 262) ?? 2, planar = first(ifd, 284) ?? 1
  const orientation = first(ifd, 274) ?? 1
  const oriented = swapsAxes(orientation) ? { w: h, h: w } : { w, h }
  const target = targetSize(oriented.w, oriented.h, maxLongEdge, maxPixels)
  const tw = swapsAxes(orientation) ? target.height : target.width, th = swapsAxes(orientation) ? target.width : target.height

  const resampler = tw !== w || th !== h ? new AreaResampler(w, h, tw, th) : null
  const out = resampler ? resampler.out : new Uint16Array(w * h * 3)
  const row = new Float32Array(w * 3)
  const push = (y: number) => {
    if (resampler) resampler.pushRow(row, 0)
    else for (let i = 0; i < row.length; i++) out[y * w * 3 + i] = Math.round(row[i])
  }

  if (bps === 16 && planar === 1 && (photometric === 2 || photometric === 1) && (photometric === 1 || spp >= 3)) {
    const lut = srgb16ToLinearLut()
    const v = new DataView(ifd.data.buffer, ifd.data.byteOffset, ifd.data.byteLength)
    const le = (ifd as unknown as { isLE: boolean }).isLE
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = ((y * w + x) * spp) * 2
        for (let c = 0; c < 3; c++) row[x * 3 + c] = lut[v.getUint16(at + (photometric === 1 ? 0 : c * 2), le)]
      }
      push(y)
    }
  } else {
    const lut = srgb8ToLinearLut()
    const rgba = UTIF.toRGBA8(ifd)
    for (let y = 0; y < h; y++) {
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        row[x * 3] = lut[rgba[i]]
        row[x * 3 + 1] = lut[rgba[i + 1]]
        row[x * 3 + 2] = lut[rgba[i + 2]]
      }
      push(y)
    }
  }
  const image = orientRgb16(out, tw, th, orientation)
  return { image, fullWidth: oriented.w, fullHeight: oriented.h }
}
