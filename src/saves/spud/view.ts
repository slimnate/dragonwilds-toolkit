import { propertyBytes } from './edit.ts'
import { readComponent, readFString, readNameList } from './values.ts'
import type { WorldDocument, WorldObject } from './world.ts'
import type { JsonObject } from '../types.ts'

export type ResourceState = {
  health: number | null
  available: number | null
  timer: number | null
  paused: boolean | null
}

function floatField(slice: Uint8Array): number | null {
  if (slice.length !== 4) return null
  return new DataView(slice.buffer, slice.byteOffset, 4).getFloat32(0, true)
}

function intField(slice: Uint8Array): number | null {
  if (slice.length !== 4) return null
  return new DataView(slice.buffer, slice.byteOffset, 4).getInt32(0, true)
}

function i64Field(slice: Uint8Array): number | null {
  if (slice.length !== 8) return null
  return Number(new DataView(slice.buffer, slice.byteOffset, 8).getBigInt64(0, true))
}

export function resourceState(doc: WorldDocument, object: WorldObject): ResourceState {
  const healthBlob = propertyBytes(doc, object, 'HealthComponent')
  const respawnBlob = propertyBytes(doc, object, 'RespawnComponent') ?? propertyBytes(doc, object, 'ResourceRespawnComponent')
  const health = healthBlob ? readComponent(healthBlob) : null
  const respawn = respawnBlob ? readComponent(respawnBlob) : null
  const healthField = health?.fields[0]
  const available = respawn?.fields[1]
  const timer = respawn?.fields[2]
  const paused = respawn?.fields[0]
  return {
    health: healthField ? floatField(healthField) : null,
    available: available ? intField(available) : null,
    timer: timer ? i64Field(timer) : null,
    paused: paused && paused.length === 1 ? paused[0] !== 0 : null,
  }
}

export function componentText(doc: WorldDocument, object: WorldObject, key: string): string | null {
  const slice = propertyBytes(doc, object, key)
  const component = slice ? readComponent(slice) : null
  const field = component?.fields[0]
  if (!field) return null
  const text = readFString(field, 0, field.length)
  if (!text || text.next !== field.length) return null
  return text.text
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as JsonObject
  } catch {
    return null
  }
  return null
}

export function inventoryJsonAt(doc: WorldDocument, object: WorldObject, key: string): JsonObject | null {
  const property = object.properties.find((entry) => entry.key === key || entry.name === key)
  if (property?.value.kind === 'string') return parseJsonObject(property.value.value)
  const text = componentText(doc, object, key)
  return text ? parseJsonObject(text) : null
}

export function inventoryJson(doc: WorldDocument, object: WorldObject): JsonObject | null {
  for (const key of ['InventoryComponent', 'JsonInventory', 'FuelInventory', 'OutputInventory', 'CatalystInventory', 'ResourcesInventory']) {
    const parsed = inventoryJsonAt(doc, object, key)
    if (parsed) return parsed
  }
  return null
}

export function inventoryKey(object: WorldObject): string | null {
  const nested = ['InventoryComponent', 'FuelInventory', 'OutputInventory', 'CatalystInventory', 'ResourcesInventory']
  for (const key of nested) {
    if (object.properties.some((entry) => entry.name === key || entry.key === key)) return key
  }
  const direct = object.properties.find((entry) => entry.name === 'JsonInventory')
  return direct?.key ?? null
}

export function nameList(doc: WorldDocument, object: WorldObject, key: string): string[] | null {
  const slice = propertyBytes(doc, object, key)
  return slice ? readNameList(slice) : null
}
