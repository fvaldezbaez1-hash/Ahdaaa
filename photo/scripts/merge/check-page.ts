// Runs in headless Chromium (see check.mjs): the real decode path (LibRaw),
// library import, merge planning, merge workers and DNG writer.
import { diag, mul, type Mat3 } from '../../src/color/matrices'
import type { SourceColor } from '../../src/engine/types'
import { decodeFile, importFiles } from '../../src/io/api'
import { db } from '../../src/io/db'
import { readLumenDng, writeDng } from '../../src/io/dng'
import { decodeStored } from '../../src/io/working'
import { planMerge, runMerge, suggestKind } from '../../src/merge'
import { detectFeatures, matchFeatures } from '../../src/merge/features'
import { apply3, ransac, rng } from '../../src/merge/geometry'
import { linearLut } from '../../src/merge/linearize'

declare global {
  interface Window {
    saveOutput(name: string, b64: string): Promise<void>
    runCheck(plan: { raw: string; steps: string[] }): Promise<unknown>
  }
}

async function b64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function png(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** White-balanced linear camera RGB → display RGBA8 (fixed exposure `k`, simple shoulder). */
function display(wb: Float32Array, w: number, h: number, rgbCam: Mat3 | null, k: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    let r = wb[i * 3] * k, g = wb[i * 3 + 1] * k, b = wb[i * 3 + 2] * k
    if (rgbCam) [r, g, b] = [rgbCam[0] * r + rgbCam[1] * g + rgbCam[2] * b, rgbCam[3] * r + rgbCam[4] * g + rgbCam[5] * b, rgbCam[6] * r + rgbCam[7] * g + rgbCam[8] * b]
    const t = (v: number) => Math.max(0, v) / (1 + Math.max(0, v) / 4) * 1.25
    out[i * 4] = enc(Math.min(1, t(r))) * 255
    out[i * 4 + 1] = enc(Math.min(1, t(g))) * 255
    out[i * 4 + 2] = enc(Math.min(1, t(b))) * 255
    out[i * 4 + 3] = 255
  }
  return out
}

function sideBySide(imgs: Uint8ClampedArray[], w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * imgs.length * h * 4)
  imgs.forEach((im, k) => {
    for (let y = 0; y < h; y++) out.set(im.subarray(y * w * 4, (y + 1) * w * 4), (y * w * imgs.length + k * w) * 4)
  })
  return out
}

/** Bilinear sample of interleaved float RGB (pixel centres at i + 0.5). */
function sample(src: Float32Array, w: number, h: number, x: number, y: number, out: number[]): boolean {
  const fx = x - 0.5, fy = y - 0.5
  if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return false
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  for (let c = 0; c < 3; c++) {
    const a = src[(y0 * w + x0) * 3 + c], b = src[(y0 * w + x1) * 3 + c], d = src[(y1 * w + x0) * 3 + c], e = src[(y1 * w + x1) * 3 + c]
    out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
  }
  return true
}

const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

window.runCheck = async (plan) => {
  const log: Record<string, unknown>[] = []
  const step = async (name: string, fn: () => Promise<Record<string, unknown>>) => {
    const t0 = performance.now()
    try {
      log.push({ step: name, ...(await fn()), ms: Math.round(performance.now() - t0) })
    } catch (e) {
      log.push({ step: name, error: `${(e as Error).name}: ${(e as Error).message}`, stack: (e as Error).stack?.split('\n').slice(0, 4).join(' | ') })
    }
  }
  const rawBlob = await (await fetch(plan.raw)).blob()
  const src = await decodeFile(rawBlob, { fileName: 'source.ARW', quality: 'full', maxLongEdge: 2400 })
  const W = src.image.width, H = src.image.height
  const shot = src.raw!.shotMul as number[]
  const camXyz = src.raw!.camXyz as Mat3
  const rgbCam = src.raw!.rgbCam as Mat3
  const lut = linearLut(src.color)
  // Native camera RGB, linear (the "truth" for the HDR check).
  const native = new Float32Array(W * H * 3)
  for (let i = 0; i < native.length; i++) native[i] = lut[src.image.data[i]] / shot[i % 3]
  log.push({ step: 'decode source', size: `${W}x${H}`, shotMul: shot })

  if (plan.steps.includes('dng')) {
    await step('dng round trip through LibRaw', async () => {
      // Native data with AsShotNeutral = 1/shot (what merges write); LibRaw re-applies the white balance.
      const mn = Math.min(...shot)
      const stored = Uint16Array.from(native, (v) => Math.min(65535, Math.round(v * mn * 65535)))
      const blob = writeDng(stored, { width: W, height: H, colorMatrix: camXyz, asShotNeutral: [1 / shot[0], 1, 1 / shot[2]], baselineExposure: 0, meta: src.meta, uniqueCameraModel: 'Lumen HDR' })
      const back = await decodeFile(blob, { fileName: 'rt.dng', quality: 'full' })
      let maxDiff = 0, sum = 0
      for (let i = 0; i < src.image.data.length; i++) {
        const d = Math.abs(back.image.data[i] - src.image.data[i])
        maxDiff = Math.max(maxDiff, d)
        sum += d
      }
      const own = readLumenDng(await blob.arrayBuffer())!
      return {
        // 16-bit rounding of the stored values, re-multiplied by the white balance and LibRaw's curve toe.
        ok: maxDiff <= 12 && sum / src.image.data.length < 3,
        maxDiff,
        meanDiff: +(sum / src.image.data.length).toFixed(3),
        ownReaderExact: own.data.every((v, i) => v === stored[i]),
        whiteBalance: { source: src.raw!.asShot, dng: back.raw?.asShot },
        camXyzSame: back.raw!.camXyz.every((v, i) => Math.abs(v - camXyz[i]) < 1e-4),
        bytes: blob.size,
      }
    })
  }

  if (plan.steps.includes('hdr')) {
    await step('hdr brackets → merge', async () => {
      // Three brackets (−2, 0, +2 EV) of the scene, hand-held (shifted / rotated a little), with sensor noise,
      // clipped like a sensor, and something moving through the ±2 EV frames.
      const r = rng(77)
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r())
      const evs = [-2, 0, 2]
      // The scene is 2 stops brighter than the photo: the 0 EV bracket clips its highlights, −2 EV keeps them.
      const SCENE = 4
      const shifts = [[5.3, -3.1, 0.4], [0, 0, 0], [-4.2, 2.7, -0.3]]
      const ghost = [
        { x: 0.62, y: 0.35 },
        null,
        { x: 0.3, y: 0.45 },
      ]
      const mn = Math.min(...shot)
      const files: File[] = []
      const px = [0, 0, 0]
      for (let b = 0; b < 3; b++) {
        const k = 2 ** evs[b]
        const [dx, dy, rot] = shifts[b]
        const a = (rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a)
        const data = new Uint16Array(W * H * 3)
        const g = ghost[b]
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            // Frame px → scene px (the camera moved).
            const cx = x + 0.5 - W / 2, cy = y + 0.5 - H / 2
            const sx = ca * cx - sa * cy + W / 2 + dx, sy = sa * cx + ca * cy + H / 2 + dy
            if (!sample(native, W, H, sx, sy, px)) px[0] = px[1] = px[2] = 0
            const inGhost = g && Math.abs(x / W - g.x) < 0.04 && Math.abs(y / H - g.y) < 0.06
            for (let c = 0; c < 3; c++) {
              let v = (inGhost ? 0.25 / shot[c] : px[c] * SCENE) * k
              // Photon + read noise (in white-balanced units), then the sensor clips.
              const wbv = v * shot[c]
              v = (wbv + gauss() * Math.sqrt(2e-5 * Math.max(wbv, 0) + 4e-8)) / shot[c]
              data[(y * W + x) * 3 + c] = Math.max(0, Math.min(65535 * mn / shot[c] / mn, Math.round(v * mn * 65535)))
            }
          }
        const blob = writeDng(data, {
          width: W,
          height: H,
          colorMatrix: camXyz,
          asShotNeutral: [1 / shot[0], 1, 1 / shot[2]],
          baselineExposure: 0,
          meta: { ...src.meta, shutter: (src.meta.shutter ?? 1 / 100) * k },
          uniqueCameraModel: 'Bracket',
        })
        files.push(new File([blob], `bracket${evs[b]}.dng`))
      }
      const imp = await importFiles(files)
      if (imp.added.length !== 3) throw new Error(`imported ${imp.added.length}: ${JSON.stringify(imp.skipped)}`)
      const recs = (await db.photos.bulkGet(imp.added)) as NonNullable<Awaited<ReturnType<typeof db.photos.get>>>[]
      const suggested = suggestKind(recs)
      const t1 = performance.now()
      const mp = await planMerge(imp.added, 'hdr', { deghost: 'medium', projection: 'auto', autoCrop: true })
      const planMs = Math.round(performance.now() - t1)
      await window.saveOutput('hdr-preview.png', await b64(await png(mp.preview.data, mp.preview.width, mp.preview.height)))
      const t2 = performance.now()
      let lastProgress = 0
      const id = await runMerge(mp, { onProgress: (f) => (lastProgress = f) })
      const runMs = Math.round(performance.now() - t2)
      const rec = (await db.photos.get(id))!
      // Decode the merged photo through the app and compare with the truth (native radiance, reference frame).
      const merged = await decodeStored(rec, 'full', undefined)
      const mlut = linearLut(merged.color)
      const mshot = merged.color.shotMul as number[]
      const B = readLumenDng(await (await db.originals.get(id))!.blob.arrayBuffer())!.baselineExposure
      const scale = 2 ** -B
      const est = (i: number) => (mlut[merged.image.data[i]] / mshot[i % 3]) / scale
      const err: Record<string, number[]> = { shadows: [], midtones: [], highlightsClippedInRef: [] }
      const refClip: number[] = []
      const ref0 = await decodeStored(recs[1], 'full', undefined)
      for (let i = 1; i < W * H * 3; i += 3 * 7) {
        const t = native[i] * SCENE, wb = t * shot[1]
        const e = Math.abs(est(i) - t) / t
        if (wb > 1.2 && wb < 3.5) err.highlightsClippedInRef.push(e)
        else if (wb > 0.02 && wb < 0.7) err.midtones.push(e)
        else if (wb > 0.0008 && wb < 0.004) err.shadows.push(e)
        // The same shadows in the 0 EV bracket alone (noisy).
        if (wb > 0.0008 && wb < 0.004) refClip.push(Math.abs(lut[ref0.image.data[i]] / shot[1] - t) / t)
      }
      // Ghosts: inside the ±2 EV frames' moving squares the merge should show the reference (the scene).
      const ghostErr: number[] = []
      for (const g of ghost.filter(Boolean) as { x: number; y: number }[])
        for (let y = Math.round((g.y - 0.04) * H); y < (g.y + 0.04) * H; y += 2)
          for (let x = Math.round((g.x - 0.025) * W); x < (g.x + 0.025) * W; x += 2) {
            const i = (y * W + x) * 3 + 1
            ghostErr.push(Math.abs(est(i) - native[i] * SCENE) / Math.max(native[i] * SCENE, 0.002))
          }
      // Pictures: the 0 EV bracket and the merge at the same exposure, and a darker look that shows the recovered highlights.
      const wb0 = Float32Array.from(ref0.image.data, (v) => lut[v])
      const wbm = new Float32Array(W * H * 3)
      for (let i = 0; i < wbm.length; i++) wbm[i] = est(i) * shot[i % 3]
      const sw = Math.round(W / 2), sh = Math.round(H / 2)
      const half = (a: Float32Array) => {
        const o = new Float32Array(sw * sh * 3)
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) o[(y * sw + x) * 3 + c] = a[(y * 2 * W + x * 2) * 3 + c]
        return o
      }
      await window.saveOutput('hdr-compare.png', await b64(await png(sideBySide([display(half(wb0), sw, sh, rgbCam, 1.6), display(half(wbm), sw, sh, rgbCam, 1.6), display(half(wbm), sw, sh, rgbCam, 0.25)], sw, sh), sw * 3, sh)))
      const stops = (a: number[]) => {
        const s = a.filter((v) => v > 0).sort((x, y) => x - y)
        return Math.log2(s[Math.floor(s.length * 0.9999)] / s[Math.floor(s.length * 0.001)])
      }
      const lumRef: number[] = [], lumMerged: number[] = []
      for (let i = 1; i < W * H * 3; i += 3 * 5) {
        lumRef.push(lut[ref0.image.data[i]])
        lumMerged.push(est(i) * shot[1])
      }
      return {
        ok: median(err.highlightsClippedInRef) < 0.06 && median(err.midtones) < 0.04 && median(ghostErr) < 0.15,
        suggested,
        planMs,
        runMs,
        progressEnd: lastProgress,
        notes: mp.notes,
        bracketStops: +(mp.stops ?? 0).toFixed(2),
        output: `${merged.image.width}x${merged.image.height}`,
        baselineExposure: +B.toFixed(2),
        recipeExposure: rec.recipe.basic.exposure,
        merged: rec.merged,
        medianRelError: Object.fromEntries(Object.entries(err).map(([k, v]) => [k, +median(v).toFixed(4)])),
        shadowsErrorInZeroEvBracket: +median(refClip).toFixed(4),
        ghostMedianRelError: +median(ghostErr).toFixed(4),
        dynamicRangeStops: { reference: +stops(lumRef).toFixed(1), merged: +stops(lumMerged).toFixed(1) },
      }
    })
  }

  if (plan.steps.includes('pano')) {
    await step('pano from crops → stitch', async () => {
      // The "scene": the photo developed to sRGB.
      const k = 1.6
      const scene = new Float32Array(W * H * 3) // linear sRGB
      for (let i = 0; i < W * H; i++) {
        const r = lut[src.image.data[i * 3]] * k, g = lut[src.image.data[i * 3 + 1]] * k, b = lut[src.image.data[i * 3 + 2]] * k
        scene[i * 3] = Math.min(1, Math.max(0, rgbCam[0] * r + rgbCam[1] * g + rgbCam[2] * b))
        scene[i * 3 + 1] = Math.min(1, Math.max(0, rgbCam[3] * r + rgbCam[4] * g + rgbCam[5] * b))
        scene[i * 3 + 2] = Math.min(1, Math.max(0, rgbCam[6] * r + rgbCam[7] * g + rgbCam[8] * b))
      }
      // Four overlapping crops (2 × 2, ~40 % overlap), each slightly rotated, scaled and exposed differently, saved as JPEG.
      const cw = Math.round(W * 0.6), ch = Math.round(H * 0.62)
      const crops = [
        { x: 0, y: 0, rot: 1.2, s: 1.0, gain: 1.0 },
        { x: W - cw, y: 0, rot: -0.8, s: 0.97, gain: 1.18 },
        { x: 0, y: H - ch, rot: 0.5, s: 1.03, gain: 0.85 },
        { x: W - cw, y: H - ch, rot: -1.5, s: 1.0, gain: 1.08 },
      ]
      const files: File[] = []
      const px = [0, 0, 0]
      for (const [n, c] of crops.entries()) {
        const a = (c.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a)
        const rgba = new Uint8ClampedArray(cw * ch * 4)
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            const ux = (x + 0.5 - cw / 2) / c.s, uy = (y + 0.5 - ch / 2) / c.s
            const sx = ca * ux - sa * uy + c.x + cw / 2, sy = sa * ux + ca * uy + c.y + ch / 2
            if (!sample(scene, W, H, sx, sy, px)) px[0] = px[1] = px[2] = 0
            for (let q = 0; q < 3; q++) rgba[(y * cw + x) * 4 + q] = enc(Math.min(1, px[q] * c.gain)) * 255
            rgba[(y * cw + x) * 4 + 3] = 255
          }
        const cv = new OffscreenCanvas(cw, ch)
        cv.getContext('2d')!.putImageData(new ImageData(rgba, cw, ch), 0, 0)
        const jpeg = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
        files.push(new File([jpeg], `crop${n}.jpg`))
        // The UI step of check.mjs imports these into the app.
        await window.saveOutput(`pano-crop${n}.jpg`, await b64(jpeg))
      }
      const imp = await importFiles(files)
      if (imp.added.length !== 4) throw new Error(`imported ${imp.added.length}`)
      const recs = (await db.photos.bulkGet(imp.added)) as NonNullable<Awaited<ReturnType<typeof db.photos.get>>>[]
      const suggested = suggestKind(recs)
      const t1 = performance.now()
      const mp = await planMerge(imp.added, 'pano', { deghost: 'off', projection: 'auto', autoCrop: true })
      const planMs = Math.round(performance.now() - t1)
      await window.saveOutput('pano-preview.png', await b64(await png(mp.preview.data, mp.preview.width, mp.preview.height)))
      const t2 = performance.now()
      const id = await runMerge(mp)
      const runMs = Math.round(performance.now() - t2)
      const rec = (await db.photos.get(id))!
      const out = await decodeStored(rec, 'full', undefined)
      const olut = linearLut(out.color)
      const B = readLumenDng(await (await db.originals.get(id))!.blob.arrayBuffer())!.baselineExposure
      const ow = out.image.width, oh = out.image.height
      const res = Float32Array.from(out.image.data, (v) => olut[v] * 2 ** B)
      // Register the stitch onto the original and compare (after one global gain: the pano's exposure is the gains' compromise).
      const grey = (rgb: Float32Array, n: number) => Float32Array.from({ length: n }, (_, i) => enc(Math.min(1, 0.25 * rgb[i * 3] + 0.5 * rgb[i * 3 + 1] + 0.25 * rgb[i * 3 + 2])))
      const fa = detectFeatures(grey(res, ow * oh), ow, oh, 2000), fb = detectFeatures(grey(scene, W * H), W, H, 2000)
      const reg = ransac(matchFeatures(fa, fb), 'homography', 2)
      if (!reg) throw new Error('could not register the stitch onto the original')
      let num = 0, den = 0
      const pairs: [number, number][] = []
      for (let y = 0; y < oh; y += 3)
        for (let x = 0; x < ow; x += 3) {
          const [sx, sy] = apply3(reg.model, x + 0.5, y + 0.5)
          if (!sample(scene, W, H, sx, sy, px)) continue
          const a = res[(y * ow + x) * 3 + 1], b = px[1]
          if (b > 0.02 && b < 0.9) {
            num += a * b
            den += b * b
            pairs.push([a, b])
          }
        }
      const gain = num / den
      const errs = pairs.map(([a, b]) => Math.abs(enc(Math.min(1, a / gain)) - enc(b)) * 255)
      // Pictures: the original and the stitch.
      const disp = (rgb: Float32Array, w: number, h: number, g: number) => {
        const o = new Uint8ClampedArray(w * h * 4)
        for (let i = 0; i < w * h; i++) {
          for (let q = 0; q < 3; q++) o[i * 4 + q] = enc(Math.min(1, rgb[i * 3 + q] / g)) * 255
          o[i * 4 + 3] = 255
        }
        return o
      }
      await window.saveOutput('pano-result.png', await b64(await png(disp(res, ow, oh, gain), ow, oh)))
      await window.saveOutput('pano-original.png', await b64(await png(disp(scene, W, H, 1), W, H)))
      return {
        ok: median(errs) < 4,
        suggested,
        planMs,
        runMs,
        projection: mp.projection,
        span: mp.span?.map((v) => +v.toFixed(1)),
        notes: mp.notes,
        output: `${ow}x${oh}`,
        originalSize: `${W}x${H}`,
        registrationInliers: reg.inliers.length,
        globalGain: +gain.toFixed(3),
        medianAbsError8bit: +median(errs).toFixed(2),
        p95AbsError8bit: +[...errs].sort((x, y) => x - y)[Math.floor(errs.length * 0.95)].toFixed(2),
        merged: rec.merged,
      }
    })
  }
  return log
}

// Type-only use, kept for readers of this file.
export type { SourceColor }
void diag
void mul
