import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NL = '\r\n'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeValue(value, indent) {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return writeArray(value, indent)
  return writeObject(value, indent)
}

function writeObject(obj, indent) {
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined)
  if (keys.length === 0) return `{${NL}${indent}}`
  const inner = `${indent}\t`
  const lines = keys.map((key, index) => {
    const value = obj[key]
    const comma = index < keys.length - 1 ? ',' : ''
    if (isPlainObject(value)) {
      return `${inner}${JSON.stringify(key)}:${NL}${inner}${writeObject(value, inner)}${comma}`
    }
    return `${inner}${JSON.stringify(key)}: ${writeValue(value, inner)}${comma}`
  })
  return `{${NL}${lines.join(NL)}${NL}${indent}}`
}

function writeArray(arr, indent) {
  if (arr.length === 0) return '[]'
  const inner = `${indent}\t`
  const lines = arr.map((value, index) => {
    const comma = index < arr.length - 1 ? ',' : ''
    if (isPlainObject(value)) return `${inner}${writeObject(value, inner)}${comma}`
    return `${inner}${writeValue(value, inner)}${comma}`
  })
  return `[${NL}${lines.join(NL)}${NL}${indent}]`
}

function serializeUnrealJson(value) {
  return `${writeValue(value, '')}${NL}`
}

function gameplayRoot(save) {
  return isPlainObject(save.GameProgress) ? save.GameProgress : save
}

function collectItemIds(save) {
  const ids = new Set()
  const root = gameplayRoot(save)
  for (const key of ['Inventory', 'PersonalInventory', 'Loadout']) {
    const container = root[key]
    if (!isPlainObject(container)) continue
    for (const [slotKey, slot] of Object.entries(container)) {
      if (slotKey === 'MaxSlotIndex' || !isPlainObject(slot)) continue
      if (typeof slot.ItemData === 'string') ids.add(slot.ItemData)
    }
  }
  return ids
}

const catalog = JSON.parse(readFileSync(join(root, 'public', 'catalog', 'items.json'), 'utf8'))
const itemIds = new Set(catalog.items.map((item) => item.id))
const saves = [
  join(root, 'saves', '8-10-26-save-bak', 'SaveCharacters', 'Nate.json'),
  join(root, 'saves', '8-10-26-save-bak', 'SaveCharacters', 'slimnatekc.json'),
]

let failed = false
for (const path of saves) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const roundTrip = JSON.parse(serializeUnrealJson(parsed))
  const equal = JSON.stringify(parsed) === JSON.stringify(roundTrip)
  const missing = [...collectItemIds(parsed)].filter((id) => !itemIds.has(id))
  console.log(path.split(/[/\\]/).pop(), {
    version: parsed.Version,
    wrapped: Boolean(parsed.GameProgress),
    roundTripEqual: equal,
    inventoryItems: collectItemIds(parsed).size,
    missingItemIds: missing,
  })
  if (!equal || missing.length) failed = true
}

if (failed) process.exit(1)
console.log('Round-trip and catalog checks passed.')
