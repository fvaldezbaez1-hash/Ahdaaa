// Read a PyTorch checkpoint (.pth, the zip format PyTorch ≥ 1.6 writes) into
// plain Float32Arrays without PyTorch: a stored-zip reader plus the subset of
// the pickle protocol a state dict uses.

const dec = new TextDecoder()

function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('Not a zip-format PyTorch checkpoint')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const files = new Map()
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip central directory')
    const method = dv.getUint16(p + 10, true)
    const size = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    if (method !== 0) throw new Error(`Compressed zip entry ${name} is not supported`)
    const data = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    files.set(name, buf.subarray(data, data + size))
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const MARK = Symbol('mark')

/** Unpickle with torch's persistent storages resolved by `storage(key, type)`. */
function unpickle(bytes, storage) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const stack = []
  const memo = new Map()
  let i = 0
  const popMark = () => {
    const at = stack.lastIndexOf(MARK)
    const items = stack.splice(at)
    items.shift()
    return items
  }
  const setItems = (d, kv) => {
    for (let k = 0; k < kv.length; k += 2) d.set(kv[k], kv[k + 1])
  }
  const readLine = () => {
    const end = bytes.indexOf(10, i)
    const s = dec.decode(bytes.subarray(i, end))
    i = end + 1
    return s
  }
  const call = (fn, args) => {
    const id = `${fn.module}.${fn.name}`
    if (id === 'collections.OrderedDict') return new Map()
    if (id === 'torch._utils._rebuild_tensor_v2' || id === 'torch._utils._rebuild_tensor') {
      const [st, offset, size, stride] = args
      return { tensor: true, storage: st, offset, size, stride }
    }
    if (id === 'torch._utils._rebuild_parameter') return args[0]
    return { global: id, args }
  }
  for (;;) {
    const op = bytes[i++]
    switch (op) {
      case 0x80: i++; break // PROTO
      case 0x95: i += 8; break // FRAME
      case 0x2e: return stack.pop() // STOP
      case 0x28: stack.push(MARK); break
      case 0x29: stack.push([]); break // EMPTY_TUPLE
      case 0x5d: stack.push([]); break // EMPTY_LIST
      case 0x7d: stack.push(new Map()); break // EMPTY_DICT
      case 0x4e: stack.push(null); break
      case 0x88: stack.push(true); break
      case 0x89: stack.push(false); break
      case 0x4b: stack.push(bytes[i++]); break // BININT1
      case 0x4d: stack.push(dv.getUint16(i, true)); i += 2; break
      case 0x4a: stack.push(dv.getInt32(i, true)); i += 4; break
      case 0x8a: { // LONG1
        const n = bytes[i++]
        let v = 0n
        for (let k = n - 1; k >= 0; k--) v = (v << 8n) | BigInt(bytes[i + k])
        if (n && bytes[i + n - 1] & 0x80) v -= 1n << BigInt(8 * n)
        i += n
        stack.push(Number(v))
        break
      }
      case 0x47: stack.push(dv.getFloat64(i, false)); i += 8; break // BINFLOAT
      case 0x58: { const n = dv.getUint32(i, true); i += 4; stack.push(dec.decode(bytes.subarray(i, i + n))); i += n; break } // BINUNICODE
      case 0x8c: { const n = bytes[i++]; stack.push(dec.decode(bytes.subarray(i, i + n))); i += n; break } // SHORT_BINUNICODE
      case 0x55: { const n = bytes[i++]; stack.push(dec.decode(bytes.subarray(i, i + n))); i += n; break } // SHORT_BINSTRING
      case 0x54: { const n = dv.getUint32(i, true); i += 4; stack.push(dec.decode(bytes.subarray(i, i + n))); i += n; break }
      case 0x43: { const n = bytes[i++]; stack.push(bytes.slice(i, i + n)); i += n; break } // SHORT_BINBYTES
      case 0x42: { const n = dv.getUint32(i, true); i += 4; stack.push(bytes.slice(i, i + n)); i += n; break }
      case 0x63: { const module = readLine(); const name = readLine(); stack.push({ module, name }); break } // GLOBAL
      case 0x93: { const name = stack.pop(); const module = stack.pop(); stack.push({ module, name }); break } // STACK_GLOBAL
      case 0x71: memo.set(bytes[i++], stack.at(-1)); break // BINPUT
      case 0x72: memo.set(dv.getUint32(i, true), stack.at(-1)); i += 4; break
      case 0x94: memo.set(memo.size, stack.at(-1)); break // MEMOIZE
      case 0x68: stack.push(memo.get(bytes[i++])); break // BINGET
      case 0x6a: stack.push(memo.get(dv.getUint32(i, true))); i += 4; break
      case 0x74: stack.push(popMark()); break // TUPLE
      case 0x85: stack.push([stack.pop()]); break
      case 0x86: { const b = stack.pop(); const a = stack.pop(); stack.push([a, b]); break }
      case 0x87: { const c = stack.pop(); const b = stack.pop(); const a = stack.pop(); stack.push([a, b, c]); break }
      case 0x6c: stack.push(popMark()); break // LIST
      case 0x64: { const d = new Map(); setItems(d, popMark()); stack.push(d); break } // DICT
      case 0x61: { const v = stack.pop(); stack.at(-1).push(v); break } // APPEND
      case 0x65: { const items = popMark(); stack.at(-1).push(...items); break } // APPENDS
      case 0x73: { const v = stack.pop(); const k = stack.pop(); stack.at(-1).set(k, v); break } // SETITEM
      case 0x75: { const kv = popMark(); setItems(stack.at(-1), kv); break } // SETITEMS
      case 0x52: { const args = stack.pop(); const fn = stack.pop(); stack.push(call(fn, args)); break } // REDUCE
      case 0x81: { const args = stack.pop(); const cls = stack.pop(); stack.push(call(cls, args)); break } // NEWOBJ
      case 0x62: stack.pop(); break // BUILD: state (e.g. OrderedDict _metadata) is not needed
      case 0x51: { const pid = stack.pop(); stack.push(storage(pid[2], pid[1].name)); break } // BINPERSID
      default:
        throw new Error(`Unsupported pickle opcode 0x${op.toString(16)} at ${i - 1}`)
    }
  }
}

/** state dict → Map(name → { data: Float32Array, shape: number[] }). */
export function readPth(buf) {
  const files = unzip(buf)
  const pkl = [...files.keys()].find((k) => k.endsWith('/data.pkl'))
  if (!pkl) throw new Error('No data.pkl in checkpoint')
  const root = pkl.slice(0, -'data.pkl'.length)
  const obj = unpickle(files.get(pkl), (key, type) => ({ bytes: files.get(`${root}data/${key}`), type }))
  let dict = obj
  for (const wrap of ['params_ema', 'params', 'state_dict', 'model']) if (dict instanceof Map && dict.has(wrap)) dict = dict.get(wrap)
  const out = new Map()
  for (const [name, t] of dict) {
    if (!t?.tensor) continue
    if (t.storage.type !== 'FloatStorage') throw new Error(`${name}: ${t.storage.type} is not supported`)
    const all = new Float32Array(t.storage.bytes.buffer.slice(t.storage.bytes.byteOffset, t.storage.bytes.byteOffset + t.storage.bytes.byteLength))
    out.set(name, { data: contiguous(all, t.offset, t.size, t.stride), shape: t.size })
  }
  return out
}

function contiguous(all, offset, size, stride) {
  const n = size.reduce((a, b) => a * b, 1)
  const out = new Float32Array(n)
  const idx = new Array(size.length).fill(0)
  for (let k = 0; k < n; k++) {
    let p = offset
    for (let d = 0; d < size.length; d++) p += idx[d] * stride[d]
    out[k] = all[p]
    for (let d = size.length - 1; d >= 0; d--) {
      if (++idx[d] < size[d]) break
      idx[d] = 0
    }
  }
  return out
}
