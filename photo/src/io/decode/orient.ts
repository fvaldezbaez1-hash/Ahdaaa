// Apply an EXIF orientation (1…8) to an interleaved RGB16 image. Used where
// the browser doesn't do it for us: TIFF and RAW embedded previews.

/** True when the orientation swaps width and height. */
export const swapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8

export function orientRgb16(data: Uint16Array, width: number, height: number, orientation: number): { data: Uint16Array; width: number; height: number } {
  if (!(orientation >= 2 && orientation <= 8)) return { data, width, height }
  const swap = swapsAxes(orientation)
  const ow = swap ? height : width, oh = swap ? width : height
  const out = new Uint16Array(data.length)
  // For each output pixel, where it comes from in the source.
  const src = (x: number, y: number): number => {
    switch (orientation) {
      case 2: return y * width + (width - 1 - x)
      case 3: return (height - 1 - y) * width + (width - 1 - x)
      case 4: return (height - 1 - y) * width + x
      case 5: return x * width + y
      case 6: return (height - 1 - x) * width + y
      case 7: return (height - 1 - x) * width + (width - 1 - y)
      default: return x * width + (width - 1 - y)
    }
  }
  for (let y = 0, o = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++, o += 3) {
      const i = src(x, y) * 3
      out[o] = data[i]
      out[o + 1] = data[i + 1]
      out[o + 2] = data[i + 2]
    }
  }
  return { data: out, width: ow, height: oh }
}
