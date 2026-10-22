export const MAGICS = new Set([
  'SAVE', 'INFO', 'SHOT', 'CINF', 'META', 'CLST', 'CDEF', 'CNIX', 'PNIX', 'VERS',
  'NOBJ', 'SPWN', 'KILL', 'LVLS', 'LEVL', 'GLOB', 'GOBS', 'LATS', 'SATS', 'DATS',
  'PDEF', 'PROP', 'CUST', 'CORA', 'GLAI', 'CDVE',
])

export type ChunkNode = {
  magic: string
  start: number
  end: number
  payloadStart: number
  payloadEnd: number
  parts: ChunkPart[]
  parent: ChunkNode | null
  dirty: boolean
  replacement: Uint8Array | null
}

export type ChunkPart =
  | { kind: 'raw'; start: number; end: number }
  | { kind: 'chunk'; node: ChunkNode }

export function u16(file: Uint8Array, offset: number): number {
  return file[offset]! | ((file[offset + 1]!) << 8)
}

export function u32(file: Uint8Array, offset: number): number {
  return (
    (file[offset]! |
      (file[offset + 1]! << 8) |
      (file[offset + 2]! << 16) |
      (file[offset + 3]! << 24)) >>>
    0
  )
}

export function i32(file: Uint8Array, offset: number): number {
  const value = u32(file, offset)
  return value > 0x7fffffff ? value - 0x100000000 : value
}

export function magicAt(file: Uint8Array, offset: number): string {
  return String.fromCharCode(file[offset]!, file[offset + 1]!, file[offset + 2]!, file[offset + 3]!)
}

function looksLikeChunk(file: Uint8Array, offset: number, limit: number): boolean {
  if (offset + 8 > limit) return false
  const a = file[offset]!
  const b = file[offset + 1]!
  const c = file[offset + 2]!
  const d = file[offset + 3]!
  if (a < 65 || a > 90 || b < 65 || b > 90 || c < 65 || c > 90 || d < 65 || d > 90) return false
  const length = u32(file, offset + 4)
  return offset + 8 + length <= limit
}

function parsePacked(file: Uint8Array, start: number, end: number, parent: ChunkNode): ChunkNode[] | null {
  if (!looksLikeChunk(file, start, end)) return null
  const nodes: ChunkNode[] = []
  let cursor = start
  while (cursor < end) {
    if (!looksLikeChunk(file, cursor, end)) return null
    const node = parseChunk(file, cursor, parent)
    nodes.push(node)
    if (node.end <= cursor) return null
    cursor = node.end
  }
  return cursor === end ? nodes : null
}

function findSuffix(file: Uint8Array, start: number, end: number, parent: ChunkNode): { at: number; nodes: ChunkNode[] } | null {
  for (let cursor = start; cursor + 8 <= end; cursor++) {
    if (!looksLikeChunk(file, cursor, end)) continue
    const nodes = parsePacked(file, cursor, end, parent)
    if (nodes && nodes.length > 0) return { at: cursor, nodes }
  }
  return null
}

function parseChunk(file: Uint8Array, offset: number, parent: ChunkNode | null): ChunkNode {
  const length = u32(file, offset + 4)
  const payloadStart = offset + 8
  const payloadEnd = payloadStart + length
  const node: ChunkNode = {
    magic: magicAt(file, offset),
    start: offset,
    end: payloadEnd,
    payloadStart,
    payloadEnd,
    parts: [],
    parent,
    dirty: false,
    replacement: null,
  }
  const packed = parsePacked(file, payloadStart, payloadEnd, node)
  if (packed) {
    node.parts = packed.map((child) => ({ kind: 'chunk', node: child }))
    return node
  }
  const suffix = findSuffix(file, payloadStart, payloadEnd, node)
  if (suffix && suffix.at > payloadStart) {
    node.parts = [{ kind: 'raw', start: payloadStart, end: suffix.at }, ...suffix.nodes.map((child) => ({ kind: 'chunk' as const, node: child }))]
    return node
  }
  node.parts = [{ kind: 'raw', start: payloadStart, end: payloadEnd }]
  return node
}

export function parseSaveTree(file: Uint8Array): ChunkNode {
  if (file.length < 8 || magicAt(file, 0) !== 'SAVE') {
    throw new Error('Not a SPUD world save')
  }
  const root = parseChunk(file, 0, null)
  if (root.end !== file.length) {
    throw new Error(`SAVE chunk ended at ${root.end}, file is ${file.length}`)
  }
  return root
}

export function findChild(node: ChunkNode, magic: string): ChunkNode | null {
  for (const part of node.parts) {
    if (part.kind === 'chunk' && part.node.magic === magic) return part.node
  }
  return null
}

export function children(node: ChunkNode, magic?: string): ChunkNode[] {
  const found: ChunkNode[] = []
  for (const part of node.parts) {
    if (part.kind === 'chunk' && (!magic || part.node.magic === magic)) found.push(part.node)
  }
  return found
}

export function rawPrefix(node: ChunkNode): { start: number; end: number } | null {
  const first = node.parts[0]
  if (first && first.kind === 'raw') return { start: first.start, end: first.end }
  return null
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0
  for (const part of parts) size += part.length
  const out = new Uint8Array(size)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

export function emitChunk(file: Uint8Array, node: ChunkNode): Uint8Array {
  if (!node.dirty && !node.replacement) return file.subarray(node.start, node.end)
  const payload = node.replacement ?? concat(node.parts.map((part) => (part.kind === 'raw' ? file.subarray(part.start, part.end) : emitChunk(file, part.node))))
  const out = new Uint8Array(8 + payload.length)
  out[0] = node.magic.charCodeAt(0)
  out[1] = node.magic.charCodeAt(1)
  out[2] = node.magic.charCodeAt(2)
  out[3] = node.magic.charCodeAt(3)
  new DataView(out.buffer).setUint32(4, payload.length, true)
  out.set(payload, 8)
  return out
}

export function markDirty(node: ChunkNode) {
  let current: ChunkNode | null = node
  while (current) {
    current.dirty = true
    current = current.parent
  }
}
