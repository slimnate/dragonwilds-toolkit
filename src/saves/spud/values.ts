import { i32, u16, u32 } from './chunk.ts'

export const ESST_UINT8 = 0
export const ESST_UINT16 = 1
export const ESST_UINT32 = 2
export const ESST_UINT64 = 3
export const ESST_INT8 = 4
export const ESST_INT16 = 5
export const ESST_INT32 = 6
export const ESST_INT64 = 7
export const ESST_FLOAT = 8
export const ESST_DOUBLE = 9
export const ESST_GUID = 0x17
export const ESST_STRING = 0x1e
export const ESST_NAME = 0x1f
export const ESST_TEXT = 0x20
export const ESST_OPAQUE = 0x40
export const ESST_ARRAY = 0x1000

export type SpudScalar = {
  kind: 'number'
  value: number
  control: 'int' | 'float' | 'check'
}

export type SpudText = {
  kind: 'string'
  value: string
}

export type SpudList = {
  kind: 'list'
  value: string[]
}

export type SpudBytes = {
  kind: 'bytes'
  length: number
  text: string
  floats: DifficultyFloat[]
}

export type SpudValue = SpudScalar | SpudText | SpudList | SpudBytes

export type DifficultyFloat = {
  tag: string
  value: number
  offset: number
}

export function readFString(file: Uint8Array, offset: number, end: number): { text: string; next: number } | null {
  if (offset + 4 > end) return null
  const count = i32(file, offset)
  const start = offset + 4
  if (count === 0) return { text: '', next: start }
  if (count > 0) {
    if (start + count > end || count > 1_000_000) return null
    const text = new TextDecoder().decode(file.subarray(start, start + count - 1))
    return { text, next: start + count }
  }
  const chars = -count
  if (start + chars * 2 > end || chars > 1_000_000) return null
  const text = new TextDecoder('utf-16le').decode(file.subarray(start, start + chars * 2 - 2))
  return { text, next: start + chars * 2 }
}

export function encodeFString(text: string): Uint8Array {
  if (text.length === 0) {
    const empty = new Uint8Array(4)
    return empty
  }
  const bytes = new TextEncoder().encode(text)
  const out = new Uint8Array(4 + bytes.length + 1)
  new DataView(out.buffer).setInt32(0, bytes.length + 1, true)
  out.set(bytes, 4)
  return out
}

export function readStringTable(file: Uint8Array, start: number, end: number): { values: string[]; next: number } | null {
  if (start + 4 > end) return null
  const count = i32(file, start)
  if (count < 0 || count > 100_000) return null
  const values: string[] = []
  let cursor = start + 4
  for (let index = 0; index < count; index++) {
    const entry = readFString(file, cursor, end)
    if (!entry) return null
    values.push(entry.text)
    cursor = entry.next
  }
  return { values, next: cursor }
}

function hexGuid(file: Uint8Array, offset: number): string {
  let hex = ''
  for (let index = 0; index < 16; index++) hex += file[offset + index]!.toString(16).padStart(2, '0')
  return hex.toUpperCase()
}

function readOne(file: Uint8Array, offset: number, end: number, type: number): { value: SpudValue; next: number } | null {
  const base = type & 0xfff
  if (offset > end) return null
  if (base === ESST_UINT8 || base === ESST_INT8) {
    if (offset >= end) return null
    const raw = file[offset]!
    return { value: { kind: 'number', value: base === ESST_INT8 && raw > 127 ? raw - 256 : raw, control: 'check' }, next: offset + 1 }
  }
  if (base === ESST_UINT16 || base === ESST_INT16) {
    if (offset + 2 > end) return null
    const raw = u16(file, offset)
    return { value: { kind: 'number', value: base === ESST_INT16 && raw > 0x7fff ? raw - 0x10000 : raw, control: 'int' }, next: offset + 2 }
  }
  if (base === ESST_UINT32 || base === ESST_INT32) {
    if (offset + 4 > end) return null
    const raw = base === ESST_INT32 ? i32(file, offset) : u32(file, offset)
    return { value: { kind: 'number', value: raw, control: 'int' }, next: offset + 4 }
  }
  if (base === ESST_FLOAT) {
    if (offset + 4 > end) return null
    return { value: { kind: 'number', value: new DataView(file.buffer, file.byteOffset + offset, 4).getFloat32(0, true), control: 'float' }, next: offset + 4 }
  }
  if (base === ESST_DOUBLE) {
    if (offset + 8 > end) return null
    return { value: { kind: 'number', value: new DataView(file.buffer, file.byteOffset + offset, 8).getFloat64(0, true), control: 'float' }, next: offset + 8 }
  }
  if (base === ESST_INT64 || base === ESST_UINT64) {
    if (offset + 8 > end) return null
    const view = new DataView(file.buffer, file.byteOffset + offset, 8)
    const value = base === ESST_INT64 ? Number(view.getBigInt64(0, true)) : Number(view.getBigUint64(0, true))
    return { value: { kind: 'number', value, control: 'int' }, next: offset + 8 }
  }
  if (base === ESST_GUID) {
    if (offset + 16 > end) return null
    return { value: { kind: 'string', value: hexGuid(file, offset) }, next: offset + 16 }
  }
  if (base === ESST_STRING || base === ESST_NAME || base === ESST_TEXT) {
    const entry = readFString(file, offset, end)
    if (!entry) return null
    let next = entry.next
    if (base === ESST_NAME && next + 4 <= end) next += 4
    return { value: { kind: 'string', value: entry.text }, next }
  }
  return null
}

export function readTyped(file: Uint8Array, offset: number, end: number, type: number): SpudValue {
  if (type & ESST_ARRAY) {
    if (offset + 2 > end) return { kind: 'bytes', length: Math.max(0, end - offset), text: '', floats: [] }
    const count = u16(file, offset)
    const values: string[] = []
    let cursor = offset + 2
    const base = type & 0xfff
    for (let index = 0; index < count; index++) {
      const one = readOne(file, cursor, end, base)
      if (!one) return bytesValue(file, offset, end)
      if (one.value.kind === 'string') values.push(one.value.value)
      else if (one.value.kind === 'number') values.push(String(one.value.value))
      cursor = one.next
    }
    if (cursor === end) return { kind: 'list', value: values }
    return bytesValue(file, offset, end)
  }
  if ((type & 0xfff) === ESST_OPAQUE || type === ESST_OPAQUE) {
    return bytesValue(file, offset, end)
  }
  const one = readOne(file, offset, end, type)
  if (!one || one.next !== end) return bytesValue(file, offset, end)
  return one.value
}

function bytesValue(file: Uint8Array, offset: number, end: number): SpudBytes {
  const strings: string[] = []
  let cursor = offset
  while (cursor + 4 < end) {
    const count = i32(file, cursor)
    if (count > 1 && count < 240 && cursor + 4 + count <= end) {
      const slice = file.subarray(cursor + 4, cursor + 4 + count - 1)
      let printable = true
      for (const byte of slice) {
        if (byte < 32 || byte > 126) {
          printable = false
          break
        }
      }
      if (printable && file[cursor + 4 + count - 1] === 0) {
        const text = new TextDecoder().decode(slice)
        if (text.length > 1) strings.push(text)
        cursor += 4 + count
        continue
      }
    }
    cursor++
  }
  return {
    kind: 'bytes',
    length: end - offset,
    text: strings.filter((entry) => entry !== 'None' && entry !== 'TagName' && entry !== 'NameProperty').slice(0, 12).join(', '),
    floats: difficultyFloats(file, offset, end),
  }
}

export function difficultyFloats(file: Uint8Array, offset: number, end: number): DifficultyFloat[] {
  const found: DifficultyFloat[] = []
  const needle = new TextEncoder().encode('Difficulty.')
  for (let cursor = offset; cursor + needle.length + 8 < end; cursor++) {
    let match = true
    for (let index = 0; index < needle.length; index++) {
      if (file[cursor + index] !== needle[index]) {
        match = false
        break
      }
    }
    if (!match) continue
    const tagStart = cursor - 4
    if (tagStart < offset) continue
    const tag = readFString(file, tagStart, end)
    if (!tag || tag.next !== cursor + tag.text.length + 1) continue
    const none = readFString(file, tag.next, end)
    if (!none || none.text !== 'None' || none.next + 4 > end) continue
    const value = new DataView(file.buffer, file.byteOffset + none.next, 4).getFloat32(0, true)
    found.push({ tag: tag.text, value, offset: none.next })
    cursor = none.next
  }
  return found
}

export function encodeRecord(names: string[] | null, slices: Uint8Array[]): Uint8Array {
  const nameBytes = names ? names.map((name) => encodeFString(name)) : []
  let dataSize = 0
  for (const slice of slices) dataSize += slice.length
  let header = (names ? 4 : 0) + 4 + slices.length * 4 + 4
  for (const name of nameBytes) header += name.length
  const out = new Uint8Array(header + dataSize)
  const view = new DataView(out.buffer)
  let cursor = 0
  if (names) {
    view.setInt32(cursor, names.length, true)
    cursor += 4
    for (const name of nameBytes) {
      out.set(name, cursor)
      cursor += name.length
    }
  }
  view.setInt32(cursor, slices.length, true)
  cursor += 4
  let dataCursor = 0
  for (const slice of slices) {
    view.setInt32(cursor, dataCursor, true)
    cursor += 4
    dataCursor += slice.length
  }
  view.setInt32(cursor, dataSize, true)
  cursor += 4
  for (const slice of slices) {
    out.set(slice, cursor)
    cursor += slice.length
  }
  return out
}

export type SliceRange = { start: number; end: number }

export function readSlices(file: Uint8Array, payloadStart: number, payloadEnd: number, withNames: boolean): { names: string[]; ranges: SliceRange[] } | null {
  let cursor = payloadStart
  let names: string[] = []
  if (withNames) {
    const table = readStringTable(file, cursor, payloadEnd)
    if (!table) return null
    names = table.values
    cursor = table.next
  }
  if (cursor + 4 > payloadEnd) return null
  const count = i32(file, cursor)
  cursor += 4
  if (count < 0 || count > 100_000 || cursor + count * 4 + 4 > payloadEnd) return null
  const offsets: number[] = []
  for (let index = 0; index < count; index++) {
    offsets.push(i32(file, cursor))
    cursor += 4
  }
  const dataCount = i32(file, cursor)
  cursor += 4
  if (dataCount < 0 || cursor + dataCount > payloadEnd) return null
  const blob = cursor
  const ranges = offsets.map((offset, index) => {
    const next = index + 1 < offsets.length ? offsets[index + 1]! : dataCount
    return { start: blob + offset, end: blob + next }
  })
  return { names, ranges }
}

export type NumberWidth = 'u8' | 'u16' | 'i32' | 'f32' | 'i64'

export function putNumber(type: NumberWidth, value: number): Uint8Array {
  if (type === 'u8') return Uint8Array.of(value & 0xff)
  if (type === 'u16') {
    const out = new Uint8Array(2)
    new DataView(out.buffer).setUint16(0, value & 0xffff, true)
    return out
  }
  if (type === 'i64') {
    const out = new Uint8Array(8)
    new DataView(out.buffer).setBigInt64(0, BigInt(Math.trunc(value)), true)
    return out
  }
  const out = new Uint8Array(4)
  const view = new DataView(out.buffer)
  if (type === 'f32') view.setFloat32(0, value, true)
  else view.setInt32(0, value | 0, true)
  return out
}

export function readComponent(slice: Uint8Array): { header: number; fields: Uint8Array[] } | null {
  if (slice.length < 8) return null
  const header = i32(slice, 0)
  if (header < 0 || header > 10_000) return null
  const record = readSlices(slice, 4, slice.length, false)
  if (!record || record.ranges.length === 0) return null
  const last = record.ranges[record.ranges.length - 1]
  if (!last || last.end !== slice.length) return null
  return {
    header,
    fields: record.ranges.map((range) => slice.slice(range.start, range.end)),
  }
}

export function writeComponent(header: number, fields: Uint8Array[]): Uint8Array {
  const body = encodeRecord(null, fields)
  const out = new Uint8Array(4 + body.length)
  new DataView(out.buffer).setInt32(0, header, true)
  out.set(body, 4)
  return out
}

export function readNameList(slice: Uint8Array): string[] | null {
  if (slice.length < 8) return null
  if (i32(slice, 0) !== 0) return null
  const count = i32(slice, 4)
  if (count < 0 || count > 10_000) return null
  const values: string[] = []
  let cursor = 8
  for (let index = 0; index < count; index++) {
    const entry = readFString(slice, cursor, slice.length)
    if (!entry) return null
    values.push(entry.text)
    cursor = entry.next
  }
  return cursor === slice.length ? values : null
}

export function writeNameList(values: string[]): Uint8Array {
  const parts = values.map((value) => encodeFString(value))
  let size = 8
  for (const part of parts) size += part.length
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setInt32(0, 0, true)
  view.setInt32(4, values.length, true)
  let cursor = 8
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}
