// Projective geometry for merging: 3×3 matrices, homographies and
// similarities from point matches (normalized DLT / least squares), RANSAC,
// rotations (Rodrigues, nearest rotation to a matrix).

export type M3 = number[] // row-major, length 9
export interface Match {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: M3, b: M3): M3 {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}

export function inv3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const k = 1 / (a * A + b * B + c * C)
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

export const transpose3 = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]

export function apply3(m: M3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

export function applyVec(m: M3, v: [number, number, number]): [number, number, number] {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

export const scale3 = (sx: number, sy = sx): M3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1]
export const translate3 = (x: number, y: number): M3 => [1, 0, x, 0, 1, y, 0, 0, 1]

/** Symmetric 3×3 eigen decomposition (Jacobi). Returns eigenvalues and column eigenvectors. */
export function eigSym3(a: M3): { values: number[]; vectors: M3 } {
  const m = a.slice()
  let v = I3.slice()
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = m[1] ** 2 + m[2] ** 2 + m[5] ** 2
    if (off < 1e-30) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = m[p * 3 + q]
      if (Math.abs(apq) < 1e-300) continue
      const app = m[p * 3 + p], aqq = m[q * 3 + q]
      const theta = (aqq - app) / (2 * apq)
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      const J = I3.slice()
      J[p * 3 + p] = c
      J[q * 3 + q] = c
      J[p * 3 + q] = s
      J[q * 3 + p] = -s
      const Jt = transpose3(J)
      const r = mul3(Jt, mul3(m, J))
      for (let k = 0; k < 9; k++) m[k] = r[k]
      v = mul3(v, J)
    }
  }
  return { values: [m[0], m[4], m[8]], vectors: v }
}

/** The rotation nearest to m (polar decomposition: R = M (MᵀM)^-½). */
export function nearestRotation(m: M3): M3 {
  const { values, vectors: V } = eigSym3(mul3(transpose3(m), m))
  const D = values.map((x) => 1 / Math.sqrt(Math.max(x, 1e-30)))
  const inner = mul3(mul3(V, [D[0], 0, 0, 0, D[1], 0, 0, 0, D[2]]), transpose3(V))
  const r = mul3(m, inner)
  const det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6])
  return det < 0 ? r.map((x) => -x) : r
}

/** Rotation from an axis-angle vector (Rodrigues). */
export function rodrigues(w: [number, number, number]): M3 {
  const t = Math.hypot(...w)
  if (t < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1]
  const [x, y, z] = w.map((v) => v / t)
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]
}

// ---------- estimation ----------

/** Similarity normalization of points (centroid to 0, mean distance √2). */
function normalizer(xs: number[], ys: number[]): M3 {
  const n = xs.length
  const cx = xs.reduce((a, b) => a + b, 0) / n, cy = ys.reduce((a, b) => a + b, 0) / n
  let d = 0
  for (let i = 0; i < n; i++) d += Math.hypot(xs[i] - cx, ys[i] - cy)
  const s = Math.SQRT2 / (d / n || 1)
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]
}

/** Solve the symmetric positive system A x = b (Gaussian elimination with pivoting). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-14) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / r[i])
}

/** Homography mapping (x1, y1) → (x2, y2), least squares over ≥ 4 matches (h33 = 1, normalized coordinates). */
export function homographyFrom(m: readonly Match[]): M3 | null {
  if (m.length < 4) return null
  const T1 = normalizer(m.map((p) => p.x1), m.map((p) => p.y1))
  const T2 = normalizer(m.map((p) => p.x2), m.map((p) => p.y2))
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  const Atb = new Array<number>(8).fill(0)
  for (const p of m) {
    const [x, y] = apply3(T1, p.x1, p.y1)
    const [u, v] = apply3(T2, p.x2, p.y2)
    for (const [row, rhs] of [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ] as [number[], number][]) {
      for (let i = 0; i < 8; i++) {
        Atb[i] += row[i] * rhs
        for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]
      }
    }
  }
  const h = solve(AtA, Atb)
  if (!h) return null
  return mul3(inv3(T2), mul3([...h, 1], T1))
}

/** Similarity (scale, rotation, translation) mapping 1 → 2, least squares over ≥ 2 matches. */
export function similarityFrom(m: readonly Match[]): M3 | null {
  if (m.length < 2) return null
  // x2 = a x1 − b y1 + tx, y2 = b x1 + a y1 + ty
  const AtA = Array.from({ length: 4 }, () => new Array<number>(4).fill(0))
  const Atb = new Array<number>(4).fill(0)
  for (const p of m)
    for (const [row, rhs] of [
      [[p.x1, -p.y1, 1, 0], p.x2],
      [[p.y1, p.x1, 0, 1], p.y2],
    ] as [number[], number][])
      for (let i = 0; i < 4; i++) {
        Atb[i] += row[i] * rhs
        for (let j = 0; j < 4; j++) AtA[i][j] += row[i] * row[j]
      }
  const s = solve(AtA, Atb)
  if (!s) return null
  const [a, b, tx, ty] = s
  return [a, -b, tx, b, a, ty, 0, 0, 1]
}

/** Deterministic pseudo-random numbers. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export interface RansacResult {
  model: M3
  inliers: Match[]
}

/** RANSAC for a homography ('homography', 4 points) or similarity ('similarity', 2 points), refined on the inliers. */
export function ransac(matches: readonly Match[], kind: 'homography' | 'similarity', threshold: number, iterations = 1500, seed = 7): RansacResult | null {
  const k = kind === 'homography' ? 4 : 2
  if (matches.length < k + 2) return null
  const fit = kind === 'homography' ? homographyFrom : similarityFrom
  const rand = rng(seed + matches.length)
  const t2 = threshold * threshold
  const inliersOf = (H: M3) =>
    matches.filter((p) => {
      const [u, v] = apply3(H, p.x1, p.y1)
      return (u - p.x2) ** 2 + (v - p.y2) ** 2 < t2
    })
  let best: Match[] = []
  for (let it = 0; it < iterations; it++) {
    const pick = new Set<number>()
    while (pick.size < k) pick.add(Math.floor(rand() * matches.length))
    const H = fit([...pick].map((i) => matches[i]))
    if (!H || !H.every(Number.isFinite)) continue
    const inl = inliersOf(H)
    if (inl.length > best.length) {
      best = inl
      if (best.length > 0.9 * matches.length) break
    }
  }
  if (best.length < k + 2) return null
  // Refine twice on the inliers.
  let model = fit(best)!
  for (let r = 0; r < 2 && model; r++) {
    const inl = inliersOf(model)
    if (inl.length < k) break
    best = inl
    model = fit(best) ?? model
  }
  return model ? { model, inliers: best } : null
}
