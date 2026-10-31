/** Pixel size of an export upscaled ×2, then fitted to `longEdge` when one is set. */
export function upscaledSize(full: { width: number; height: number }, longEdge?: number): { width: number; height: number } {
  const w = full.width * 2, h = full.height * 2
  const k = longEdge ? Math.min(1, longEdge / Math.max(w, h)) : 1
  return { width: Math.round(w * k), height: Math.round(h * k) }
}
