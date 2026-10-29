// Device heuristics that decide sizes and which decoders to try.

const nav = (): (Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } }) | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator

/** iPhone, iPod and iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  const n = nav()
  return !!n && (/iPad|iPhone|iPod/.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1))
}

export function isPhone(): boolean {
  const n = nav()
  return !!n && (isIOS() || n.userAgentData?.mobile === true || /Android|Mobi/i.test(n.userAgent))
}

/** Phones and tablets get killed far below desktop memory; size everything for them. */
export function lowMemory(): boolean {
  return isPhone() || (nav()?.deviceMemory ?? 8) <= 4
}

/** Most pixels we decode a developed image (JPEG, HEIC…) to at once. */
export function maxDecodePixels(): number {
  return lowMemory() ? 24e6 : 100e6
}

let maxTexture: number | undefined
function maxTextureSize(): number {
  if (maxTexture === undefined) {
    maxTexture = 4096
    try {
      const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
      if (gl) {
        maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch {
      // No WebGL2 here: the engine will report it; keep the default.
    }
  }
  return maxTexture
}

/** Long edge of the image the editor works on. */
export function workingLongEdge(): number {
  return lowMemory() ? 2560 : Math.min(4096, maxTextureSize())
}
