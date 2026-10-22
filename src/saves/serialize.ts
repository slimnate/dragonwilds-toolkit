import type { JsonObject, JsonValue } from './types'

const NL = '\r\n'

function isPlainObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeValue(value: JsonValue, indent: string): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return writeArray(value, indent)
  return writeObject(value, indent)
}

function writeObject(obj: JsonObject, indent: string): string {
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined)
  if (keys.length === 0) return `{${NL}${indent}}`
  const inner = indent + '\t'
  const lines = keys.map((key, index) => {
    const value = obj[key] as JsonValue
    const comma = index < keys.length - 1 ? ',' : ''
    if (isPlainObject(value)) {
      return `${inner}${JSON.stringify(key)}:${NL}${inner}${writeObject(value, inner)}${comma}`
    }
    return `${inner}${JSON.stringify(key)}: ${writeValue(value, inner)}${comma}`
  })
  return `{${NL}${lines.join(NL)}${NL}${indent}}`
}

function writeArray(arr: JsonValue[], indent: string): string {
  if (arr.length === 0) return '[]'
  const inner = indent + '\t'
  const lines = arr.map((value, index) => {
    const comma = index < arr.length - 1 ? ',' : ''
    if (isPlainObject(value)) {
      return `${inner}${writeObject(value, inner)}${comma}`
    }
    return `${inner}${writeValue(value, inner)}${comma}`
  })
  return `[${NL}${lines.join(NL)}${NL}${indent}]`
}

export function serializeUnrealJson(value: JsonValue): string {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return `${JSON.stringify(value)}${NL}`
  }
  return `${writeValue(value, '')}${NL}`
}

export function parseCharacterSave(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Character save must be a JSON object')
  }
  return parsed as JsonObject
}
