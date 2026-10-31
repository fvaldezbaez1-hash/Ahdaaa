// Minimal ONNX (protobuf) writer and editor, dependency-free, deterministic:
// the same input always produces the same bytes, so converted models can be
// pinned by sha256 like downloaded ones.
//
// Field numbers from onnx/onnx.proto3 (ModelProto, GraphProto, NodeProto,
// AttributeProto, TensorProto, ValueInfoProto, TypeProto).

const enc = new TextEncoder()

// ---------- protobuf encoding ----------

class Writer {
  constructor() {
    this.parts = []
    this.length = 0
  }
  push(bytes) {
    this.parts.push(bytes)
    this.length += bytes.length
  }
  varint(v) {
    let n = BigInt.asUintN(64, BigInt(v))
    const out = []
    do {
      let b = Number(n & 0x7fn)
      n >>= 7n
      if (n) b |= 0x80
      out.push(b)
    } while (n)
    this.push(Uint8Array.from(out))
  }
  tag(field, wire) {
    this.varint((field << 3) | wire)
  }
  int(field, v) {
    this.tag(field, 0)
    this.varint(v)
  }
  bytes(field, bytes) {
    this.tag(field, 2)
    this.varint(bytes.length)
    this.push(bytes)
  }
  string(field, s) {
    this.bytes(field, enc.encode(s))
  }
  float(field, v) {
    this.tag(field, 5)
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, v, true)
    this.push(b)
  }
  message(field, w) {
    this.bytes(field, w.finish())
  }
  packedInts(field, values) {
    const w = new Writer()
    for (const v of values) w.varint(v)
    this.bytes(field, w.finish())
  }
  finish() {
    const out = new Uint8Array(this.length)
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
}

// ---------- protobuf decoding (field level, values kept as raw slices) ----------

/** Split a message into its fields: { no, wire, value (varint as BigInt) | bytes (Uint8Array), raw (the whole field) }. */
export function fields(buf) {
  const out = []
  let i = 0
  const varint = () => {
    let r = 0n
    let s = 0n
    for (;;) {
      const b = buf[i++]
      r |= BigInt(b & 0x7f) << s
      if (!(b & 0x80)) return r
      s += 7n
    }
  }
  while (i < buf.length) {
    const start = i
    const key = Number(varint())
    const no = key >>> 3, wire = key & 7
    const f = { no, wire }
    if (wire === 0) f.value = varint()
    else if (wire === 1) i += 8
    else if (wire === 5) i += 4
    else if (wire === 2) {
      const len = Number(varint())
      f.bytes = buf.subarray(i, i + len)
      i += len
    } else throw new Error(`Unsupported protobuf wire type ${wire}`)
    f.raw = buf.subarray(start, i)
    out.push(f)
  }
  return out
}

const dec = new TextDecoder()
const str = (f) => dec.decode(f.bytes)

// ---------- ONNX constants ----------

export const FLOAT = 1, UINT8 = 2, INT64 = 7, FLOAT16 = 10

const ATTR = { FLOAT: 1, INT: 2, STRING: 3, FLOATS: 6, INTS: 7 }

/** float32 → IEEE half bits, round to nearest even (overflow saturates to ±65504). */
export function toHalf(f) {
  const b = new DataView(new ArrayBuffer(4))
  b.setFloat32(0, f)
  const x = b.getUint32(0)
  const sign = (x >>> 16) & 0x8000
  const exp = (x >>> 23) & 0xff
  let mant = x & 0x7fffff
  if (exp === 0xff) return sign | (mant ? 0x7e00 : 0x7c00)
  let e = exp - 127 + 15
  if (e >= 0x1f) return sign | 0x7bff
  if (e <= 0) {
    if (e < -10) return sign
    mant |= 0x800000
    const shift = 14 - e
    let h = mant >>> shift
    const rem = mant & ((1 << shift) - 1), half = 1 << (shift - 1)
    if (rem > half || (rem === half && h & 1)) h++
    return sign | h
  }
  let h = (e << 10) | (mant >>> 13)
  const rem = mant & 0x1fff
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++
  if ((h & 0x7c00) === 0x7c00) return sign | 0x7bff
  return sign | h
}

function halfBytes(data) {
  const out = new Uint8Array(data.length * 2)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < data.length; i++) dv.setUint16(i * 2, toHalf(data[i]), true)
  return out
}

function tensorProto(name, dataType, dims, raw) {
  const t = new Writer()
  t.packedInts(1, dims)
  t.int(2, dataType)
  t.string(8, name)
  t.bytes(9, raw)
  return t
}

function castNode(input, output, to) {
  const a = new Writer()
  a.string(1, 'to')
  a.int(3, to)
  a.int(20, ATTR.INT)
  const n = new Writer()
  n.string(1, input)
  n.string(2, output)
  n.string(3, `${output}_cast`)
  n.string(4, 'Cast')
  n.message(5, a)
  return n
}

function valueInfo(name, elemType, shape) {
  const dims = new Writer()
  for (const d of shape) {
    const dim = new Writer()
    if (typeof d === 'number') dim.int(1, d)
    else dim.string(2, d)
    dims.message(1, dim)
  }
  const tensor = new Writer()
  tensor.int(1, elemType)
  tensor.message(2, dims)
  const type = new Writer()
  type.message(1, tensor)
  const vi = new Writer()
  vi.string(1, name)
  vi.message(2, type)
  return vi
}

function attribute(name, v) {
  const a = new Writer()
  a.string(1, name)
  if (typeof v === 'string') {
    a.bytes(4, enc.encode(v))
    a.int(20, ATTR.STRING)
  } else if (Array.isArray(v)) {
    if (v.every(Number.isInteger)) {
      for (const x of v) a.int(8, x)
      a.int(20, ATTR.INTS)
    } else {
      for (const x of v) a.float(7, x)
      a.int(20, ATTR.FLOATS)
    }
  } else if (Number.isInteger(v)) {
    a.int(3, v)
    a.int(20, ATTR.INT)
  } else {
    a.float(2, v)
    a.int(20, ATTR.FLOAT)
  }
  return a
}

/**
 * Build a graph op by op. Float weights can be stored as half precision (half
 * the download) with a Cast back to float that ONNX Runtime folds at load, so
 * the model still computes in float32 on every backend.
 */
export class GraphBuilder {
  constructor(name) {
    this.name = name
    this.nodes = []
    this.inits = []
    this.inputs = []
    this.outputs = []
    this.count = 0
  }
  fresh(prefix) {
    return `${prefix}_${this.count++}`
  }
  input(name, elemType, shape) {
    this.inputs.push(valueInfo(name, elemType, shape))
    return name
  }
  output(name, elemType, shape) {
    this.outputs.push(valueInfo(name, elemType, shape))
  }
  /** Float initializer; `half` stores it as float16 (+ Cast). */
  weight(name, data, dims, half = true) {
    const f32 = data instanceof Float32Array ? data : Float32Array.from(data)
    if (half && f32.length >= 16) {
      this.inits.push(tensorProto(`${name}_f16`, FLOAT16, dims, halfBytes(f32)))
      this.nodes.push(castNode(`${name}_f16`, name, FLOAT))
    } else this.inits.push(tensorProto(name, FLOAT, dims, new Uint8Array(f32.buffer.slice(f32.byteOffset, f32.byteOffset + f32.byteLength))))
    return name
  }
  int64(name, values) {
    const raw = new Uint8Array(values.length * 8)
    const dv = new DataView(raw.buffer)
    values.forEach((v, i) => dv.setBigInt64(i * 8, BigInt(v), true))
    this.inits.push(tensorProto(name, INT64, [values.length], raw))
    return name
  }
  node(op, inputs, attrs = {}, output) {
    const out = output ?? this.fresh(op.toLowerCase())
    const n = new Writer()
    for (const i of inputs) n.string(1, i)
    n.string(2, out)
    n.string(3, `${out}_node`)
    n.string(4, op)
    for (const k of Object.keys(attrs).sort()) n.message(5, attribute(k, attrs[k]))
    this.nodes.push(n)
    return out
  }
  /** Serialized ModelProto. */
  build({ opset = 17, producer = 'lumen', doc = '' } = {}) {
    const g = new Writer()
    for (const n of this.nodes) g.message(1, n)
    g.string(2, this.name)
    for (const t of this.inits) g.message(5, t)
    for (const i of this.inputs) g.message(11, i)
    for (const o of this.outputs) g.message(12, o)
    const op = new Writer()
    op.string(1, '')
    op.int(2, opset)
    const m = new Writer()
    m.int(1, 8) // ir_version
    m.string(2, producer)
    if (doc) m.string(6, doc)
    m.message(7, g)
    m.message(8, op)
    return m.finish()
  }
}

/**
 * Rewrite an existing model so its large float32 initializers are stored as
 * float16 with a Cast in front (graph semantics unchanged up to weight
 * rounding). Everything else is copied byte for byte.
 */
export function halfWeights(model, minElements = 1024) {
  const top = fields(model)
  const out = new Writer()
  for (const f of top) {
    if (f.no !== 7) {
      out.push(f.raw)
      continue
    }
    const graph = fields(f.bytes)
    const converted = new Set()
    const casts = []
    const inits = []
    for (const g of graph) {
      if (g.no !== 5) continue
      const t = fields(g.bytes)
      const type = t.find((x) => x.no === 2)
      const name = str(t.find((x) => x.no === 8))
      const dims = []
      for (const d of t.filter((x) => x.no === 1)) {
        if (d.wire === 0) dims.push(Number(d.value))
        else for (const v of fields(prefixPacked(d.bytes))) dims.push(Number(v.value))
      }
      const n = dims.reduce((a, b) => a * b, 1)
      const raw = t.find((x) => x.no === 9)
      const external = t.some((x) => x.no === 13 || x.no === 14)
      if (Number(type?.value) !== FLOAT || !raw || external || n < minElements) {
        inits.push(g.raw)
        continue
      }
      const bytes = raw.bytes
      const f32 = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const w = new Writer()
      w.message(5, tensorProto(`${name}__f16`, FLOAT16, dims, halfBytes(f32)))
      inits.push(w.finish())
      casts.push(castNode(`${name}__f16`, name, FLOAT))
      converted.add(name)
    }
    const g2 = new Writer()
    for (const c of casts) g2.message(1, c)
    for (const g of graph) {
      if (g.no === 5) continue
      // Old models also list initializers as graph inputs; those now come from the Cast.
      if (g.no === 11 && converted.has(str(fields(g.bytes).find((x) => x.no === 1)))) continue
      g2.push(g.raw)
    }
    for (const r of inits) g2.push(r)
    out.message(7, g2)
  }
  return out.finish()
}

/** Packed repeated varints come as one bytes field; re-tag them so `fields` can split them. */
function prefixPacked(bytes) {
  const w = new Writer()
  let i = 0
  while (i < bytes.length) {
    let j = i
    while (bytes[j] & 0x80) j++
    w.push(Uint8Array.of(0x08))
    w.push(bytes.subarray(i, j + 1))
    i = j + 1
  }
  return w.finish()
}
