// Panorama stitching (after Brown & Lowe, "Automatic Panoramic Image
// Stitching using Invariant Features", 2007):
// - features and pairwise homographies (RANSAC), kept when the inliers pass
//   their probabilistic test (n > 8 + 0.3 · matches);
// - a maximum spanning tree from the best-connected photo gives initial
//   camera rotations (focal length estimated from the homographies), refined
//   together by bundle adjustment of the rays through matched points;
// - wave correction levels the horizon;
// - spherical, cylindrical or perspective projection (auto by field of view);
// - gain compensation, seams where each pixel is farthest from any photo's
//   edge, multiband (Laplacian pyramid) blending, auto-crop to the largest
//   fully covered rectangle.
import { detectFeatures, matchFeatures, type Features } from './features'
import { I3, applyVec, eigSym3, inv3, mul3, nearestRotation, ransac, rodrigues, transpose3, type M3, type Match } from './geometry'

export type Projection = 'spherical' | 'cylindrical' | 'perspective'

export interface PanoImage {
  /** Grey (perceptual) at analysis size, for features. */
  grey: Float32Array
  width: number
  height: number
}

export interface Camera {
  /** World → camera rotation. */
  R: M3
}

export interface PanoPlan {
  /** Focal length in analysis pixels (shared by all photos). */
  f: number
  cameras: Camera[]
  /** Analysis size of each photo. */
  sizes: { width: number; height: number }[]
  projection: Projection
  /** Field of view covered, degrees (horizontal, vertical). */
  span: [number, number]
  /** Bounds of the whole panorama in projection units × f (analysis pixels). */
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** Pairs used and their inliers, for reporting. */
  pairs: { i: number; j: number; inliers: number }[]
  /** Mean ray error after bundle adjustment, in analysis pixels. */
  rms: number
}

// ---------- registration ----------

interface Pair {
  i: number
  j: number
  /** j px → i px (centred coordinates). */
  H: M3
  matches: Match[]
}

/** Focal lengths implied by a homography between two photos (OpenCV's focalsFromHomography). */
export function focalsFromHomography(H: M3): [number | null, number | null] {
  const h = H.map((v) => v / H[8])
  let f0: number | null = null, f1: number | null = null
  let d1 = h[6] * h[7], d2 = (h[7] - h[6]) * (h[7] + h[6])
  let v1 = -(h[0] * h[1] + h[3] * h[4]) / d1, v2 = (h[0] * h[0] + h[3] * h[3] - h[1] * h[1] - h[4] * h[4]) / d2
  if (v1 < v2) [v1, v2] = [v2, v1]
  if (v1 > 0 && v2 > 0) f1 = Math.sqrt(Math.abs(d1) > Math.abs(d2) ? v1 : v2)
  else if (v1 > 0) f1 = Math.sqrt(v1)
  d1 = h[0] * h[3] + h[1] * h[4]
  d2 = h[0] * h[0] + h[1] * h[1] - h[3] * h[3] - h[4] * h[4]
  v1 = (-h[2] * h[5]) / d1
  v2 = (h[5] * h[5] - h[2] * h[2]) / d2
  if (v1 < v2) [v1, v2] = [v2, v1]
  if (v1 > 0 && v2 > 0) f0 = Math.sqrt(Math.abs(d1) > Math.abs(d2) ? v1 : v2)
  else if (v1 > 0) f0 = Math.sqrt(v1)
  return [Number.isFinite(f0!) ? f0 : null, Number.isFinite(f1!) ? f1 : null]
}

const centre = (m: Match, a: { width: number; height: number }, b: { width: number; height: number }): Match => ({
  x1: m.x1 + 0.5 - a.width / 2,
  y1: m.y1 + 0.5 - a.height / 2,
  x2: m.x2 + 0.5 - b.width / 2,
  y2: m.y2 + 0.5 - b.height / 2,
})

/** Pairwise registration of all photos. `features` from detectFeatures on each image's grey. */
export function registerPairs(images: readonly PanoImage[], features: readonly Features[]): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < images.length; i++)
    for (let j = i + 1; j < images.length; j++) {
      // Matches j → i (x1,y1 in j; x2,y2 in i), centred.
      const raw = matchFeatures(features[j], features[i]).map((m) => centre(m, images[j], images[i]))
      if (raw.length < 20) continue
      const thr = Math.max(2, Math.max(images[i].width, images[i].height) / 400)
      const r = ransac(raw, 'homography', thr, 2000, i * 31 + j)
      if (!r || r.inliers.length < 8 + 0.3 * raw.length || r.inliers.length < 16) continue
      pairs.push({ i, j, H: r.model, matches: r.inliers })
    }
  return pairs
}

/** Order photos for stitching: a maximum spanning tree (by inliers) from the best-connected one. */
function spanningTree(n: number, pairs: readonly Pair[]): { root: number; edges: { parent: number; child: number; pair: Pair }[] } | null {
  const score = new Array<number>(n).fill(0)
  for (const p of pairs) {
    score[p.i] += p.matches.length
    score[p.j] += p.matches.length
  }
  const root = score.indexOf(Math.max(...score))
  const inTree = new Set([root])
  const edges: { parent: number; child: number; pair: Pair }[] = []
  while (inTree.size < n) {
    let best: { parent: number; child: number; pair: Pair } | null = null
    for (const p of pairs) {
      const a = inTree.has(p.i), b = inTree.has(p.j)
      if (a === b) continue
      const cand = a ? { parent: p.i, child: p.j, pair: p } : { parent: p.j, child: p.i, pair: p }
      if (!best || p.matches.length > best.pair.matches.length) best = cand
    }
    if (!best) return null
    inTree.add(best.child)
    edges.push(best)
  }
  return { root, edges }
}

/** Unit ray (world) through a centred point of a camera. */
function ray(cam: M3, f: number, x: number, y: number): [number, number, number] {
  // R is world → camera, so camera → world is Rᵀ.
  const d = applyVec(transpose3(cam), [x / f, y / f, 1])
  const n = Math.hypot(...d)
  return [d[0] / n, d[1] / n, d[2] / n]
}

/**
 * Bundle adjustment: rotations of all photos but the reference and the shared
 * focal length, minimizing the distance between the rays of matched points
 * (Levenberg–Marquardt, numeric Jacobian).
 */
export function bundleAdjust(cams: M3[], f: number, ref: number, pairs: readonly Pair[], iterations = 30): { cams: M3[]; f: number; rms: number } {
  const n = cams.length
  // Up to 80 matches per pair keep it fast.
  const obs = pairs.flatMap((p) => p.matches.filter((_, k) => k % Math.max(1, Math.ceil(p.matches.length / 80)) === 0).map((m) => ({ i: p.i, j: p.j, m })))
  const free = Array.from({ length: n }, (_, k) => k).filter((k) => k !== ref)
  const P = free.length * 3 + 1
  const build = (x: number[]) => {
    const rs = cams.slice()
    free.forEach((k, a) => (rs[k] = mul3(rodrigues([x[a * 3], x[a * 3 + 1], x[a * 3 + 2]]), cams[k])))
    return { rs, ff: f * Math.exp(x[P - 1]) }
  }
  const residuals = (x: number[]) => {
    const { rs, ff } = build(x)
    const r: number[] = []
    for (const o of obs) {
      const a = ray(rs[o.i], ff, o.m.x2, o.m.y2), b = ray(rs[o.j], ff, o.m.x1, o.m.y1)
      r.push((a[0] - b[0]) * ff, (a[1] - b[1]) * ff, (a[2] - b[2]) * ff)
    }
    return r
  }
  let x = new Array<number>(P).fill(0)
  let r = residuals(x)
  let cost = r.reduce((s, v) => s + v * v, 0)
  let lambda = 1e-3
  for (let it = 0; it < iterations; it++) {
    const J: number[][] = []
    for (let p = 0; p < P; p++) {
      const xp = x.slice()
      const h = 1e-6
      xp[p] += h
      const rp = residuals(xp)
      J.push(rp.map((v, k) => (v - r[k]) / h))
    }
    const JtJ = Array.from({ length: P }, (_, a) => Array.from({ length: P }, (_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0)))
    const Jtr = J.map((col) => col.reduce((s, v, k) => s + v * r[k], 0))
    let improved = false
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v)))
      const step = solveSym(A, Jtr.map((v) => -v))
      if (!step) break
      const xn = x.map((v, k) => v + step[k])
      const rn = residuals(xn)
      const cn = rn.reduce((s, v) => s + v * v, 0)
      if (cn < cost) {
        x = xn
        r = rn
        if (cost - cn < 1e-9 * cost) it = iterations
        cost = cn
        lambda = Math.max(1e-7, lambda / 3)
        improved = true
      } else lambda *= 4
    }
    if (!improved) break
  }
  const { rs, ff } = build(x)
  return { cams: rs.map(nearestRotation), f: ff, rms: Math.sqrt(cost / Math.max(1, obs.length)) }
}

function solveSym(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-18) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const k = M[r][c] / M[c][c]
      if (k) for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Rotate the world so the panorama's horizon is level (Brown & Lowe's wave correction). */
export function waveCorrect(cams: M3[]): M3[] {
  if (cams.length < 2) return cams
  // Each camera's x axis in world coordinates; "up" is the direction they are all most perpendicular to.
  let C = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const xs = cams.map((R) => [R[0], R[1], R[2]])
  for (const v of xs) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += v[a] * v[b]
  const { values, vectors } = eigSym3(C)
  const k = values.indexOf(Math.min(...values))
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted[1] - sorted[0] < 1e-3 * (sorted[2] || 1)) return cams // ill-posed (e.g. a vertical panorama)
  let up = [vectors[k], vectors[3 + k], vectors[6 + k]]
  // Keep it pointing the way the cameras' y axes (image down) point on average.
  const ys = cams.reduce((s, R) => [s[0] + R[3], s[1] + R[4], s[2] + R[5]], [0, 0, 0])
  if (up[0] * ys[0] + up[1] * ys[1] + up[2] * ys[2] < 0) up = up.map((v) => -v)
  // Average viewing direction, made perpendicular to up, becomes world z.
  const zs = cams.reduce((s, R) => [s[0] + R[6], s[1] + R[7], s[2] + R[8]], [0, 0, 0])
  const d = zs[0] * up[0] + zs[1] * up[1] + zs[2] * up[2]
  let z = [zs[0] - d * up[0], zs[1] - d * up[1], zs[2] - d * up[2]]
  const zn = Math.hypot(...z) || 1
  z = z.map((v) => v / zn)
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]
  // New world axes as rows: W maps old world → new world.
  const W: M3 = [...x, ...up, ...z]
  return cams.map((R) => mul3(R, transpose3(W)))
}

// ---------- projections ----------

/** World ray → projection plane coordinates (radians or tangent units). */
export function project(p: Projection, d: readonly number[]): [number, number] | null {
  const [x, y, z] = d
  if (p === 'perspective') return z > 1e-3 ? [x / z, y / z] : null
  const theta = Math.atan2(x, z)
  if (p === 'cylindrical') {
    const r = Math.hypot(x, z)
    return r > 1e-9 ? [theta, y / r] : null
  }
  return [theta, Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))))]
}

/** Projection coordinates → world ray. */
export function unproject(p: Projection, u: number, v: number): [number, number, number] {
  if (p === 'perspective') return [u, v, 1]
  if (p === 'cylindrical') return [Math.sin(u), v, Math.cos(u)]
  return [Math.sin(u) * Math.cos(v), Math.sin(v), Math.cos(u) * Math.cos(v)]
}

function boundsOf(cams: readonly M3[], f: number, sizes: readonly { width: number; height: number }[], p: Projection): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < cams.length; i++) {
    const { width: w, height: h } = sizes[i]
    const steps = 24
    for (let k = 0; k <= steps; k++)
      for (const [px, py] of [
        [(k / steps) * w, 0],
        [(k / steps) * w, h],
        [0, (k / steps) * h],
        [w, (k / steps) * h],
      ]) {
        const q = project(p, ray(cams[i], f, px - w / 2, py - h / 2))
        if (!q) return null
        x0 = Math.min(x0, q[0])
        x1 = Math.max(x1, q[0])
        y0 = Math.min(y0, q[1])
        y1 = Math.max(y1, q[1])
      }
  }
  return { x0: x0 * f, y0: y0 * f, x1: x1 * f, y1: y1 * f }
}

/**
 * Register photos into a panorama plan (analysis resolution). Throws with a
 * readable reason when photos don't overlap enough.
 */
export function planPanorama(images: readonly PanoImage[], projection: Projection | 'auto' = 'auto'): PanoPlan {
  if (images.length < 2) throw new Error('A panorama needs at least two photos.')
  const features = images.map((im) => detectFeatures(im.grey, im.width, im.height, 2000))
  const pairs = registerPairs(images, features)
  const tree = spanningTree(images.length, pairs)
  if (!tree) throw new Error('Some photos don’t overlap the others enough to stitch (they need about a quarter of each frame in common).')
  // Focal length: median of what the homographies imply; a long lens when they can't tell (nearly flat motion).
  const fs: number[] = []
  for (const p of pairs) {
    const [a, b] = focalsFromHomography(p.H)
    if (a && b) fs.push(Math.sqrt(a * b))
  }
  fs.sort((a, b) => a - b)
  const long = Math.max(images[0].width, images[0].height)
  let f = fs.length ? fs[Math.floor(fs.length / 2)] : 2 * long
  if (!(f > 0.3 * long && f < 20 * long)) f = 2 * long
  // Initial rotations along the tree: H (child → parent) ≈ K R_p R_cᵀ K⁻¹.
  const K: M3 = [f, 0, 0, 0, f, 0, 0, 0, 1]
  const Kinv = inv3(K)
  const cams: M3[] = images.map(() => I3.slice())
  for (const e of tree.edges) {
    // pair.H maps j → i; we need child → parent.
    const H = e.pair.i === e.parent ? e.pair.H : inv3(e.pair.H)
    const M = nearestRotation(mul3(Kinv, mul3(H, K)))
    cams[e.child] = mul3(transpose3(M), cams[e.parent])
  }
  const ba = bundleAdjust(cams, f, tree.root, pairs)
  const level = waveCorrect(ba.cams)
  const sizes = images.map((im) => ({ width: im.width, height: im.height }))
  // Field of view (from the spherical bounds) decides the projection.
  const sph = boundsOf(level, ba.f, sizes, 'spherical')!
  const span: [number, number] = [((sph.x1 - sph.x0) / ba.f) * (180 / Math.PI), ((sph.y1 - sph.y0) / ba.f) * (180 / Math.PI)]
  let proj: Projection = projection === 'auto' ? (Math.max(...span) <= 75 ? 'perspective' : span[1] <= 75 ? 'cylindrical' : 'spherical') : projection
  let bounds = boundsOf(level, ba.f, sizes, proj)
  if (!bounds || (proj === 'perspective' && (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0) > 30 * long * long)) {
    proj = span[1] <= 75 ? 'cylindrical' : 'spherical'
    bounds = boundsOf(level, ba.f, sizes, proj)!
  }
  return { f: ba.f, cameras: level.map((R) => ({ R })), sizes, projection: proj, span, bounds, pairs: pairs.map((p) => ({ i: p.i, j: p.j, inliers: p.matches.length })), rms: ba.rms }
}

// ---------- rendering ----------

export interface RenderSource {
  /** Interleaved RGB, any numeric type; `read` turns a sample into linear light. */
  data: Uint16Array | Float32Array
  width: number
  height: number
  /** Per-channel multiplier to a common linear space (white balance undo × exposure gain). */
  gain: readonly number[]
  lut?: Float32Array
}

/**
 * Where each output pixel comes from. The plan is in analysis pixels; the
 * output is the panorama bounds scaled by `scale` (output px per analysis px),
 * sources are at their own resolution (`srcScale[i]` = source px per analysis px).
 */
export class PanoMapper {
  private readonly plan: PanoPlan
  private readonly scale: number
  private readonly srcScale: number[]
  private readonly KR: M3[]
  readonly width: number
  readonly height: number
  private readonly ox: number
  private readonly oy: number

  constructor(plan: PanoPlan, scale: number, srcScale: number[], crop?: { x: number; y: number; w: number; h: number }) {
    this.plan = plan
    this.scale = scale
    this.srcScale = srcScale
    const b = plan.bounds
    const full = { w: (b.x1 - b.x0) * scale, h: (b.y1 - b.y0) * scale }
    const c = crop ?? { x: 0, y: 0, w: 1, h: 1 }
    this.width = Math.max(1, Math.round(full.w * c.w))
    this.height = Math.max(1, Math.round(full.h * c.h))
    this.ox = b.x0 * scale + c.x * full.w
    this.oy = b.y0 * scale + c.y * full.h
    // Camera i: world ray → its centred pixel = f·(R d)/z.
    this.KR = plan.cameras.map((c) => c.R)
    // Each photo's footprint in output pixels (from its border), to skip it where it can't be.
    this.footprints = plan.sizes.map((sz, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      const steps = 32
      for (let k = 0; k <= steps; k++)
        for (const [px, py] of [
          [(k / steps) * sz.width, 0],
          [(k / steps) * sz.width, sz.height],
          [0, (k / steps) * sz.height],
          [sz.width, (k / steps) * sz.height],
        ]) {
          const q = project(plan.projection, ray(plan.cameras[i].R, plan.f, px - sz.width / 2, py - sz.height / 2))
          if (!q) continue
          const ox = q[0] * plan.f * scale - this.ox, oy = q[1] * plan.f * scale - this.oy
          x0 = Math.min(x0, ox)
          x1 = Math.max(x1, ox)
          y0 = Math.min(y0, oy)
          y1 = Math.max(y1, oy)
        }
      return { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 }
    })
  }

  readonly footprints: { x0: number; y0: number; x1: number; y1: number }[]

  /** Whether photo i can contribute to the rectangle [x, x + w) × [y, y + h). */
  overlaps(i: number, x: number, y: number, w: number, h: number): boolean {
    const f = this.footprints[i]
    return f.x1 >= x && f.x0 <= x + w && f.y1 >= y && f.y0 <= y + h
  }

  /** Source pixel (in source i's own resolution) for output pixel centre (x, y); null if not in view. */
  map(i: number, x: number, y: number): [number, number] | null {
    const f = this.plan.f
    const u = (x + 0.5 + this.ox) / this.scale / f, v = (y + 0.5 + this.oy) / this.scale / f
    const d = unproject(this.plan.projection, u, v)
    const R = this.KR[i]
    const cx = R[0] * d[0] + R[1] * d[1] + R[2] * d[2], cy = R[3] * d[0] + R[4] * d[1] + R[5] * d[2], cz = R[6] * d[0] + R[7] * d[1] + R[8] * d[2]
    if (cz <= 1e-6) return null
    const s = this.srcScale[i]
    const { width: w, height: h } = this.plan.sizes[i]
    const sx = ((f * cx) / cz + w / 2) * s, sy = ((f * cy) / cz + h / 2) * s
    if (sx < 0 || sy < 0 || sx > w * s || sy > h * s) return null
    return [sx, sy]
  }

  /** Distance from the source's nearest edge, relative to its short side (seam priority). */
  margin(i: number, sx: number, sy: number): number {
    const s = this.srcScale[i]
    const { width: w, height: h } = this.plan.sizes[i]
    return Math.min(sx, sy, w * s - sx, h * s - sy) / (Math.min(w, h) * s)
  }
}

/** Bilinear sample (pixel centres at i + 0.5) of source i into out[0..2]; false if outside. */
function sample(src: RenderSource, x: number, y: number, out: number[]): boolean {
  const { width: w, height: h, data, lut } = src
  const fx = x - 0.5, fy = y - 0.5
  if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) return false
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0))
  for (let c = 0; c < 3; c++) {
    let a = data[(y0 * w + x0) * 3 + c], b = data[(y0 * w + x1) * 3 + c], d = data[(y1 * w + x0) * 3 + c], e = data[(y1 * w + x1) * 3 + c]
    if (lut) {
      a = lut[a]
      b = lut[b]
      d = lut[d]
      e = lut[e]
    }
    out[c] = ((a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty) * src.gain[c]
  }
  return true
}

// Pyramid helpers on a single-channel or 3-channel float image.
function down(src: Float32Array, w: number, h: number, ch: number): { d: Float32Array; w: number; h: number } {
  const nw = Math.max(1, Math.ceil(w / 2)), nh = Math.max(1, Math.ceil(h / 2))
  const d = new Float32Array(nw * nh * ch)
  // 5-tap binomial blur folded into the 2× decimation.
  const k = [1, 4, 6, 4, 1]
  const tmp = new Float32Array(nw * h * ch)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < nw; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0
        for (let t = -2; t <= 2; t++) s += k[t + 2] * src[(y * w + Math.min(w - 1, Math.max(0, 2 * x + t))) * ch + c]
        tmp[(y * nw + x) * ch + c] = s / 16
      }
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++)
      for (let c = 0; c < ch; c++) {
        let s = 0
        for (let t = -2; t <= 2; t++) s += k[t + 2] * tmp[(Math.min(h - 1, Math.max(0, 2 * y + t)) * nw + x) * ch + c]
        d[(y * nw + x) * ch + c] = s / 16
      }
  return { d, w: nw, h: nh }
}

function up(src: Float32Array, w: number, h: number, ch: number, ow: number, oh: number): Float32Array {
  const out = new Float32Array(ow * oh * ch)
  for (let y = 0; y < oh; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / 2 - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < ow; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / 2 - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0
      for (let c = 0; c < ch; c++) {
        const a = src[(y0 * w + x0) * ch + c], b = src[(y0 * w + x1) * ch + c], d = src[(y1 * w + x0) * ch + c], e = src[(y1 * w + x1) * ch + c]
        out[(y * ow + x) * ch + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
      }
    }
  }
  return out
}

/**
 * Blend a tile of the panorama: each overlapping source is warped in, holes
 * filled from coarser levels (so pyramids don't see its edges), and the
 * Laplacian bands are mixed with blurred seam masks (multiband blending).
 * Returns RGB (linear) and coverage for the tile [x, x+w) × [y, y+h).
 */
export function blendTile(mapper: PanoMapper, sources: readonly RenderSource[], x: number, y: number, w: number, h: number, levels: number): { rgb: Float32Array; covered: Uint8Array } {
  const m = 2 ** (levels + 1) // margin so every band sees its neighbourhood
  const X = x - m, Y = y - m, W = w + 2 * m, H = h + 2 * m
  const n = W * H
  // Which source each pixel belongs to (the one it's farthest inside), and where each source has data.
  const best = new Int16Array(n).fill(-1)
  const bestMargin = new Float32Array(n).fill(-1)
  const imgs: (Float32Array | null)[] = sources.map(() => null)
  const valid: (Float32Array | null)[] = sources.map(() => null)
  const px = [0, 0, 0]
  for (let i = 0; i < sources.length; i++) {
    if (!mapper.overlaps(i, X, Y, W, H)) continue
    let any = false
    const img = new Float32Array(n * 3), val = new Float32Array(n)
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        const s = mapper.map(i, X + xx, Y + yy)
        if (!s || !sample(sources[i], s[0], s[1], px)) continue
        const k = yy * W + xx
        img[k * 3] = px[0]
        img[k * 3 + 1] = px[1]
        img[k * 3 + 2] = px[2]
        val[k] = 1
        any = true
        const mg = mapper.margin(i, s[0], s[1])
        if (mg > bestMargin[k]) {
          bestMargin[k] = mg
          best[k] = i
        }
      }
    if (any) {
      imgs[i] = img
      valid[i] = val
    }
  }
  const rgb = new Float32Array(w * h * 3)
  const covered = new Uint8Array(w * h)
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) covered[yy * w + xx] = best[(yy + m) * W + xx + m] >= 0 ? 1 : 0
  const used = imgs.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  if (!used.length) return { rgb, covered }
  if (used.length === 1) {
    const img = imgs[used[0]]!
    for (let yy = 0; yy < h; yy++) rgb.set(img.subarray(((yy + m) * W + m) * 3, ((yy + m) * W + m + w) * 3), yy * w * 3)
    return { rgb, covered }
  }
  // Accumulated bands.
  const acc: { a: Float32Array; wsum: Float32Array; w: number; h: number }[] = []
  for (const i of used) {
    // Gaussian pyramid of (image × valid) and valid → hole-filled levels.
    const gi: { d: Float32Array; w: number; h: number }[] = []
    const gv: { d: Float32Array; w: number; h: number }[] = []
    let ci: { d: Float32Array; w: number; h: number } = { d: imgs[i]!, w: W, h: H }
    let cv: { d: Float32Array; w: number; h: number } = { d: valid[i]!, w: W, h: H }
    const pre = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) pre[k * 3 + c] = ci.d[k * 3 + c] * cv.d[k]
    ci = { d: pre, w: W, h: H }
    for (let l = 0; l <= levels; l++) {
      gi.push(ci)
      gv.push(cv)
      if (l < levels) {
        ci = down(ci.d, ci.w, ci.h, 3)
        cv = down(cv.d, cv.w, cv.h, 1)
      }
    }
    // Filled levels: G(I·v) / G(v), holes taken from the next coarser level.
    const filled: Float32Array[] = new Array(levels + 1)
    for (let l = levels; l >= 0; l--) {
      const { w: lw, h: lh } = gi[l]
      const f = new Float32Array(lw * lh * 3)
      const coarse = l < levels ? up(filled[l + 1], gi[l + 1].w, gi[l + 1].h, 3, lw, lh) : null
      for (let k = 0; k < lw * lh; k++) {
        const v = gv[l].d[k]
        for (let c = 0; c < 3; c++) {
          const own = v > 1e-4 ? gi[l].d[k * 3 + c] / v : 0
          const t = Math.min(1, v * 4)
          f[k * 3 + c] = coarse ? own * t + coarse[k * 3 + c] * (1 - t) : own
        }
      }
      filled[l] = f
    }
    // Seam mask pyramid.
    let sm: { d: Float32Array; w: number; h: number } = { d: Float32Array.from(best, (b) => (b === i ? 1 : 0)), w: W, h: H }
    for (let l = 0; l <= levels; l++) {
      const { w: lw, h: lh } = gi[l]
      const band = new Float32Array(lw * lh * 3)
      if (l < levels) {
        const upc = up(filled[l + 1], gi[l + 1].w, gi[l + 1].h, 3, lw, lh)
        for (let k = 0; k < band.length; k++) band[k] = filled[l][k] - upc[k]
      } else band.set(filled[l])
      if (!acc[l]) acc[l] = { a: new Float32Array(lw * lh * 3), wsum: new Float32Array(lw * lh), w: lw, h: lh }
      for (let k = 0; k < lw * lh; k++) {
        const s = sm.d[k]
        if (!s) continue
        acc[l].wsum[k] += s
        for (let c = 0; c < 3; c++) acc[l].a[k * 3 + c] += band[k * 3 + c] * s
      }
      if (l < levels) sm = down(sm.d, sm.w, sm.h, 1)
    }
  }
  // Collapse.
  let img: Float32Array = new Float32Array(acc[levels].w * acc[levels].h * 3)
  for (let l = levels; l >= 0; l--) {
    const A = acc[l]
    const cur = l < levels ? up(img, acc[l + 1].w, acc[l + 1].h, 3, A.w, A.h) : new Float32Array(A.w * A.h * 3)
    for (let k = 0; k < A.w * A.h; k++) {
      const ws = A.wsum[k]
      if (ws > 1e-6) for (let c = 0; c < 3; c++) cur[k * 3 + c] += A.a[k * 3 + c] / ws
    }
    img = cur
  }
  for (let yy = 0; yy < h; yy++) rgb.set(img.subarray(((yy + m) * W + m) * 3, ((yy + m) * W + m + w) * 3), yy * w * 3)
  for (let k = 0; k < rgb.length; k++) if (rgb[k] < 0) rgb[k] = 0
  return { rgb, covered }
}

/** Exposure gains per photo from their overlaps (Brown & Lowe): Σ overlap (gᵢμᵢⱼ − gⱼμⱼᵢ)² / σn² + (1 − gᵢ)² / σg². */
export function gainCompensation(mapper: PanoMapper, sources: readonly RenderSource[], step = 2): number[] {
  const n = sources.length
  const sum = Array.from({ length: n }, () => new Float64Array(n))
  const cnt = Array.from({ length: n }, () => new Float64Array(n))
  const px = [0, 0, 0]
  const vals = new Float64Array(n), ok = new Uint8Array(n)
  for (let y = 0; y < mapper.height; y += step)
    for (let x = 0; x < mapper.width; x += step) {
      for (let i = 0; i < n; i++) {
        const s = mapper.overlaps(i, x, y, 1, 1) ? mapper.map(i, x, y) : null
        ok[i] = s && sample(sources[i], s[0], s[1], px) ? 1 : 0
        vals[i] = ok[i] ? (px[0] + 2 * px[1] + px[2]) / 4 : 0
      }
      for (let i = 0; i < n; i++)
        if (ok[i])
          for (let j = 0; j < n; j++)
            if (j !== i && ok[j]) {
              sum[i][j] += vals[i]
              cnt[i][j]++
            }
    }
  // σ of the overlap means (linear 0…1 values) and of the gains around 1.
  const sn = 0.02, sg = 0.1
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j || !cnt[i][j]) continue
      const N = cnt[i][j], mi = sum[i][j] / N, mj = sum[j][i] / (cnt[j][i] || 1)
      A[i][i] += N * (mi * mi / (sn * sn) + 1 / (sg * sg))
      A[i][j] -= N * (mi * mj) / (sn * sn)
      b[i] += N / (sg * sg)
    }
  for (let i = 0; i < n; i++)
    if (!A[i][i]) {
      A[i][i] = 1
      b[i] = 1
    }
  const g = solveSym(A, b) ?? new Array<number>(n).fill(1)
  return g.map((v) => (Number.isFinite(v) && v > 0.2 && v < 5 ? v : 1))
}

/** Largest axis-aligned rectangle of covered pixels (coverage mask w × h), as fractions of the frame. */
export function largestRectangle(covered: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const heights = new Int32Array(w)
  let best = { area: 0, x: 0, y: 0, w: w, h: h }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = covered[y * w + x] ? heights[x] + 1 : 0
    const stack: number[] = []
    for (let x = 0; x <= w; x++) {
      const hh = x < w ? heights[x] : 0
      while (stack.length && heights[stack[stack.length - 1]] >= hh) {
        const top = stack.pop()!
        const height = heights[top]
        const left = stack.length ? stack[stack.length - 1] + 1 : 0
        const area = height * (x - left)
        if (area > best.area) best = { area, x: left, y: y - height + 1, w: x - left, h: height }
      }
      stack.push(x)
    }
  }
  if (!best.area) return { x: 0, y: 0, w: 1, h: 1 }
  return { x: best.x / w, y: best.y / h, w: best.w / w, h: best.h / h }
}
