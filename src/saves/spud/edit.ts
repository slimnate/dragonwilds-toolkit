import { emitChunk, markDirty } from './chunk.ts'
import {
  encodeFString,
  encodeRecord,
  putNumber,
  readComponent,
  readFString,
  readNameList,
  readSlices,
  writeComponent,
  writeNameList,
  type NumberWidth,
} from './values.ts'
import { parseWorld, type WorldDocument, type WorldObject, type WorldProperty } from './world.ts'

function replaceCustom(doc: WorldDocument, name: string, slice: Uint8Array): Uint8Array {
  if (!doc.cinf) return doc.bytes
  const record = readSlices(doc.bytes, doc.cinf.payloadStart, doc.cinf.payloadEnd, true)
  if (!record) return doc.bytes
  const slices = record.ranges.map((range, index) => (record.names[index] === name ? slice : doc.bytes.slice(range.start, range.end)))
  doc.cinf.replacement = encodeRecord(record.names, slices)
  markDirty(doc.cinf)
  return emitChunk(doc.bytes, doc.root)
}

function replaceProperty(doc: WorldDocument, object: WorldObject, key: string, slice: Uint8Array): Uint8Array {
  if (!object.propNode) return doc.bytes
  const record = readSlices(doc.bytes, object.propNode.payloadStart, object.propNode.payloadEnd, false)
  if (!record) return doc.bytes
  const index = object.properties.find((entry) => entry.key === key || entry.name === key)?.sliceIndex
  if (index === undefined) return doc.bytes
  const slices = record.ranges.map((range, sliceIndex) => (sliceIndex === index ? slice : doc.bytes.slice(range.start, range.end)))
  object.propNode.replacement = encodeRecord(null, slices)
  markDirty(object.propNode)
  return emitChunk(doc.bytes, doc.root)
}

export function withCustomNumber(doc: WorldDocument, name: string, value: number, width: 'u8' | 'u16' | 'i32' | 'f32'): Uint8Array {
  return replaceCustom(doc, name, putNumber(width, value))
}

export function withCustomString(doc: WorldDocument, name: string, value: string): Uint8Array {
  return replaceCustom(doc, name, encodeFString(value))
}

export function withWorldName(doc: WorldDocument, name: string): Uint8Array {
  const renamed = parseWorld(withCustomString(doc, 'WorldName', name))
  const settings = renamed.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  if (!settings) return renamed.bytes
  return replaceProperty(renamed, settings, 'WorldSaveSettings/WorldName', encodeFString(name))
}

export function withDifficulty(doc: WorldDocument, value: number): Uint8Array {
  const next = parseWorld(withCustomNumber(doc, 'SurvivalDifficulty', value, 'i32'))
  const settings = next.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  if (!settings) return next.bytes
  return replaceProperty(next, settings, 'WorldSaveSettings/SurvivalDifficulty', putNumber('u16', value))
}

export function withHardcore(doc: WorldDocument, value: number): Uint8Array {
  const next = parseWorld(withCustomNumber(doc, 'HardcoreState', value, 'i32'))
  const settings = next.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  if (!settings) return next.bytes
  return replaceProperty(next, settings, 'WorldSaveSettings/HardcoreState', putNumber('u16', value))
}

export function withFriendlyFire(doc: WorldDocument, value: number): Uint8Array {
  const next = parseWorld(withCustomNumber(doc, 'FriendlyFire', value, 'u8'))
  const settings = next.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  if (!settings) return next.bytes
  return replaceProperty(next, settings, 'WorldSaveSettings/bFriendlyFire', putNumber('u8', value))
}

export function withCustomScale(doc: WorldDocument, tag: string, value: number): Uint8Array {
  const header = doc.custom.some((field) => field.name === tag) ? parseWorld(withCustomNumber(doc, tag, value, 'f32')) : doc
  const settings = header.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  const property = settings?.properties.find((entry) => entry.name === 'CustomDifficultySettings')
  if (!settings || !property || property.value.kind !== 'bytes' || !settings.propNode) return header.bytes
  const record = readSlices(header.bytes, settings.propNode.payloadStart, settings.propNode.payloadEnd, false)
  if (!record) return header.bytes
  const range = record.ranges[property.sliceIndex]
  if (!range) return header.bytes
  const slice = header.bytes.slice(range.start, range.end)
  const hit = property.value.floats.find((entry) => entry.tag === tag)
  if (!hit) return header.bytes
  const local = hit.offset - range.start
  if (local < 0 || local + 4 > slice.length) return header.bytes
  new DataView(slice.buffer, slice.byteOffset + local, 4).setFloat32(0, value, true)
  return replaceProperty(header, settings, property.key, slice)
}

export function withPropertyNumber(doc: WorldDocument, objectId: string, key: string, value: number): Uint8Array {
  const object = doc.objects.find((entry) => entry.id === objectId)
  const property = object?.properties.find((entry) => entry.key === key || entry.name === key)
  if (!object || !property || property.value.kind !== 'number') return doc.bytes
  const width = property.value.control === 'float' ? 'f32' : property.type === 0 ? 'u8' : property.type === 1 ? 'u16' : 'i32'
  return replaceProperty(doc, object, property.key, putNumber(width, value))
}

export function withPropertyText(doc: WorldDocument, objectId: string, key: string, value: string): Uint8Array {
  const object = doc.objects.find((entry) => entry.id === objectId)
  const property = object?.properties.find((entry) => entry.key === key || entry.name === key)
  if (!object || !property || property.value.kind !== 'string') return doc.bytes
  return replaceProperty(doc, object, property.key, encodeFString(value))
}

export function withMapName(doc: WorldDocument, name: string): Uint8Array {
  return withPairedString(doc, 'WorldMapName', 'WorldSaveSettings/WorldMapName', name)
}

export function withPrivacy(doc: WorldDocument, value: number): Uint8Array {
  return withCustomNumber(doc, 'SessionPrivacy', value, 'i32')
}

export function withPassword(doc: WorldDocument, value: string): Uint8Array {
  return withCustomString(doc, 'SessionPasswd', value)
}

export function withCrossplay(doc: WorldDocument, value: number): Uint8Array {
  return withCustomNumber(doc, 'CrossplayEnabled', value, 'i32')
}

export function withOwnerName(doc: WorldDocument, name: string): Uint8Array {
  return withPairedString(doc, 'WorldNameOwner', 'WorldSaveSettings/OwnerName', name)
}

export function propertyBytes(doc: WorldDocument, object: WorldObject, key: string): Uint8Array | null {
  const property = findProperty(object, key)
  if (!property || !object.propNode) return null
  const record = readSlices(doc.bytes, object.propNode.payloadStart, object.propNode.payloadEnd, false)
  const range = record?.ranges[property.sliceIndex]
  if (!range) return null
  return doc.bytes.slice(range.start, range.end)
}

export function withComponentNumber(
  doc: WorldDocument,
  objectId: string,
  key: string,
  fieldIndex: number,
  width: NumberWidth,
  value: number,
): Uint8Array {
  const object = doc.objects.find((entry) => entry.id === objectId)
  if (!object) return doc.bytes
  const slice = propertyBytes(doc, object, key)
  const component = slice ? readComponent(slice) : null
  const field = component?.fields[fieldIndex]
  if (!object || !component || !field || putNumber(width, 0).length !== field.length) return doc.bytes
  const fields = component.fields.slice()
  fields[fieldIndex] = putNumber(width, value)
  return replaceProperty(doc, object, key, writeComponent(component.header, fields))
}

export function withNameList(doc: WorldDocument, objectId: string, key: string, values: string[]): Uint8Array {
  const object = doc.objects.find((entry) => entry.id === objectId)
  if (!object) return doc.bytes
  const slice = propertyBytes(doc, object, key)
  if (!slice || !readNameList(slice)) return doc.bytes
  return replaceProperty(doc, object, key, writeNameList(values))
}

export function withComponentString(doc: WorldDocument, objectId: string, key: string, value: string): Uint8Array {
  const object = doc.objects.find((entry) => entry.id === objectId)
  if (!object) return doc.bytes
  const slice = propertyBytes(doc, object, key)
  const component = slice ? readComponent(slice) : null
  const field = component?.fields[0]
  if (!component || !field) return doc.bytes
  const current = readFString(field, 0, field.length)
  if (!current || current.next !== field.length) return doc.bytes
  const fields = component.fields.slice()
  fields[0] = encodeFString(value)
  return replaceProperty(doc, object, key, writeComponent(component.header, fields))
}

function withPairedString(doc: WorldDocument, cinfName: string, settingsKey: string, value: string): Uint8Array {
  const next = parseWorld(withCustomString(doc, cinfName, value))
  const settings = next.objects.find((object) => object.className.includes('PersistenceSubsystem'))
  if (!settings?.properties.some((entry) => entry.key === settingsKey)) return next.bytes
  return replaceProperty(next, settings, settingsKey, encodeFString(value))
}

function findProperty(object: WorldObject, key: string): WorldProperty | undefined {
  return object.properties.find((entry) => entry.key === key || entry.name === key)
}
