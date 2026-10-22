import type { JsonObject, JsonValue } from './types'

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return isObject(value) ? value : undefined
}

export function getGameplayRoot(save: JsonObject): JsonObject {
  const wrapped = asObject(save.GameProgress)
  return wrapped ?? save
}

export function usesGameProgress(save: JsonObject): boolean {
  return isObject(save.GameProgress)
}

export function getCustomizationRoot(save: JsonObject): JsonObject | undefined {
  const rootCustom = asObject(save.Customization)
  if (rootCustom) return rootCustom
  const character = asObject(getGameplayRoot(save).Character)
  return asObject(character?.Customization)
}

export function getCharacter(save: JsonObject): JsonObject | undefined {
  return asObject(getGameplayRoot(save).Character)
}

export function ensureObject(parent: JsonObject, key: string): JsonObject {
  const existing = asObject(parent[key])
  if (existing) return existing
  const created: JsonObject = {}
  parent[key] = created
  return created
}

export function getNumber(obj: JsonObject | undefined, key: string, fallback = 0): number {
  const value = obj?.[key]
  return typeof value === 'number' ? value : fallback
}

export function getString(obj: JsonObject | undefined, key: string, fallback = ''): string {
  const value = obj?.[key]
  return typeof value === 'string' ? value : fallback
}

export function getBool(obj: JsonObject | undefined, key: string, fallback = false): boolean {
  const value = obj?.[key]
  return typeof value === 'boolean' ? value : fallback
}

export function getStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function cloneSave(save: JsonObject): JsonObject {
  return structuredClone(save)
}

export function characterName(save: JsonObject): string {
  return getString(asObject(save.meta_data), 'char_name', 'Unnamed')
}
