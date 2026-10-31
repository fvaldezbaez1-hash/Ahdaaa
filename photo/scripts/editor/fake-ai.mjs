// A scripted stand-in for the on-device AI core, installed in the page through
// the editor's seam (setAiCore) so the AI flows can be checked without
// downloading models. Self-contained: Playwright serializes it into the page.
export async function installFakeAi() {
  const { setAiCore } = await import('/src/editor/ai/core.ts')
  const MODELS = {
    segment: [{ id: 'fake-segment', name: 'Subject and sky', bytes: 4_574_861 }],
    person: [{ id: 'fake-people', name: 'People and their parts', bytes: 16_371_837 }],
    object: [{ id: 'fake-object', name: 'Select object', bytes: 30_525_312 }],
    inpaint: [{ id: 'fake-inpaint', name: 'Remove objects', bytes: 28_079_181 }],
    denoise: [{ id: 'fake-denoise', name: 'Denoise', bytes: 40_325_163 }],
    upscale: [{ id: 'fake-upscale', name: 'Super Resolution', bytes: 2_445_995 }],
  }
  const have = new Set()
  const rasters = new Map()
  const log = (window.__fakeAi = { runs: [], prunes: [], rasters })
  const all = () => Object.values(MODELS).flat()
  const info = (m) => ({ ...m, downloaded: have.has(m.id) })
  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new DOMException('Cancelled', 'AbortError'))
      })
    })
  /** Pretend work: a few progress steps. */
  async function work(o, ms = 500) {
    for (let i = 1; i <= 5; i++) {
      await wait(ms / 5, o?.signal)
      o?.onProgress?.(i / 5)
    }
  }
  /** A 1-channel mask, 256 px wide, from a function of normalized (x, y). */
  function mask(image, f) {
    const w = 256, h = Math.max(1, Math.round((256 * image.height) / image.width))
    const data = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.round(255 * Math.max(0, Math.min(1, f((x + 0.5) / w, (y + 0.5) / h))))
    return { width: w, height: h, channels: 1, data }
  }
  const ellipse = (cx, cy, rx, ry) => (x, y) => (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 ? 1 : 0)

  setAiCore({
    support: async () => ({ available: true, backend: 'wasm', secondsPerMp: { denoise: 6, upscale: 2 } }),
    modelsFor: async (task, target) => (task === 'segment' && target === 'person' ? MODELS.person : MODELS[task]).map(info),
    downloadModel: async (id, o) => {
      const m = all().find((x) => x.id === id)
      for (let i = 1; i <= 6; i++) {
        await wait(80, o?.signal)
        o?.onProgress?.((m.bytes * i) / 6, m.bytes)
      }
      have.add(id)
    },
    listModels: async () => all().map(info),
    deleteModel: async (id) => void have.delete(id),
    segment: async (target, image, _color, o) => {
      log.runs.push({ task: 'segment', target, parts: o.parts })
      await work(o)
      if (target === 'sky') return mask(image, (_x, y) => (y < 0.42 ? 1 : 0))
      if (target === 'background') return mask(image, (x, y) => 1 - ellipse(0.55, 0.55, 0.22, 0.42)(x, y))
      if (target === 'person') return mask(image, ellipse(0.3, 0.7, 0.08, 0.2))
      return mask(image, ellipse(0.55, 0.55, 0.22, 0.42))
    },
    selectObject: async (points, image, _color, o) => {
      log.runs.push({ task: 'object', points: points.length })
      await work(o, 250)
      return mask(image, (x, y) => {
        let v = 0
        for (const p of points) if (Math.hypot(x - p.x, (y - p.y) * (image.height / image.width)) < 0.08) v = p.positive ? 1 : 0
        return v
      })
    },
    inpaint: async (image, _color, o) => {
      log.runs.push({ task: 'inpaint', strokes: o.strokes.length })
      await work(o, 700)
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0
      for (const s of o.strokes) for (const p of s.points) {
        x0 = Math.min(x0, p.x - s.r); x1 = Math.max(x1, p.x + s.r)
        y0 = Math.min(y0, p.y - s.r * (image.width / image.height)); y1 = Math.max(y1, p.y + s.r * (image.width / image.height))
      }
      // Fill with the photo's average color around the area: an obvious, flat patch.
      const n = 32, data = new Uint16Array(n * n * 3)
      const sx = Math.round(Math.max(0, x0 - 0.05) * (image.width - 1)), sy = Math.round(Math.max(0, y0 - 0.05) * (image.height - 1))
      const i = (sy * image.width + sx) * 3
      for (let k = 0; k < n * n; k++) data.set([image.data[i], image.data[i + 1], image.data[i + 2]], k * 3)
      return { rect: { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(1, x1) - Math.max(0, x0), h: Math.min(1, y1) - Math.max(0, y0) }, fill: { width: n, height: n, channels: 3, data } }
    },
    denoise: async (image, _color, o) => {
      log.runs.push({ task: 'denoise', width: image.width })
      await work(o, 900)
      // A visible "denoise": a 5×5 box blur.
      const { width: w, height: h, data } = image
      const out = new Uint16Array(data.length)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let c = 0; c < 3; c++) {
            let s = 0, n = 0
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy))
                s += data[(yy * w + xx) * 3 + c]
                n++
              }
            out[(y * w + x) * 3 + c] = s / n
          }
      return { width: w, height: h, data: out, fullWidth: image.fullWidth }
    },
    upscale: async (img, o) => {
      log.runs.push({ task: 'upscale', width: img.width })
      await work(o, 200)
      const W = img.width * 2, H = img.height * 2
      const data = new img.data.constructor(W * H * 4)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(img.data.subarray(((y >> 1) * img.width + (x >> 1)) * 4, ((y >> 1) * img.width + (x >> 1)) * 4 + 4), (y * W + x) * 4)
      return { ...img, width: W, height: H, data }
    },
    putRaster: async (photoId, kind, img) => {
      const id = `${photoId}:${kind}:${rasters.size + 1}`
      rasters.set(id, img)
      return id
    },
    getRaster: async (id) => rasters.get(id),
    pruneRasters: async (photoId, keep) => void log.prunes.push({ photoId, keep: [...keep] }),
  })
}
