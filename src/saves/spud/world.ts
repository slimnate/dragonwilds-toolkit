import {
  children,
  findChild,
  i32,
  parseSaveTree,
  rawPrefix,
  u16,
  u32,
  type ChunkNode,
} from './chunk.ts'
import { readFString, readSlices, readStringTable, readTyped, type SpudValue } from './values.ts'

export type WorldProperty = {
  key: string
  name: string
  prefix: string
  type: number
  value: SpudValue
  sliceIndex: number
}

export type WorldObject = {
  id: string
  level: string
  className: string
  name: string
  guid: string
  spawned: boolean
  destroyed: boolean
  properties: WorldProperty[]
  propNode: ChunkNode | null
}

export type CustomField = {
  name: string
  value: SpudValue
  sliceIndex: number
}

export type WorldInfo = {
  systemVersion: number
  timestamp: string
  worldName: string
  mapName: string
  guid: string
  difficulty: number
  hardcore: number
  friendlyFire: number
  privacy: number
  password: string
  crossplay: number
  owner: string
  revision: number
  levelCount: number
  cellCount: number
}

export type WorldDocument = {
  bytes: Uint8Array
  root: ChunkNode
  info: WorldInfo
  custom: CustomField[]
  cinf: ChunkNode | null
  objects: WorldObject[]
  screenshot: Uint8Array | null
}

const DIFFICULTY = ['Normal', 'Hard', 'Creative', 'Custom']
const HARDCORE = ['Uninitialised', 'Inactive', 'Active', 'Failed', 'Succeeded']
const PRIVACY = ['Private', 'Invite only', 'Friends', 'Public']

export function difficultyLabel(value: number): string {
  return DIFFICULTY[value] ?? String(value)
}

export function hardcoreLabel(value: number): string {
  return HARDCORE[value] ?? String(value)
}

export function privacyLabel(value: number): string {
  return PRIVACY[value] ?? String(value)
}

export const DIFFICULTY_OPTIONS = DIFFICULTY.map((label, value) => ({ label, value }))
export const HARDCORE_OPTIONS = HARDCORE.map((label, value) => ({ label, value }))
export const PRIVACY_OPTIONS = PRIVACY.map((label, value) => ({ label, value }))

function classTable(meta: ChunkNode | null, file: Uint8Array): { classes: string[]; names: string[]; defs: Map<number, { name: string; prefix: string; type: number }[]> } {
  const cnix = meta ? findChild(meta, 'CNIX') : null
  const pnix = meta ? findChild(meta, 'PNIX') : null
  const classes = cnix ? readStringTable(file, cnix.payloadStart, cnix.payloadEnd)?.values ?? [] : []
  const names = pnix ? readStringTable(file, pnix.payloadStart, pnix.payloadEnd)?.values ?? [] : []
  const defs = new Map<number, { name: string; prefix: string; type: number }[]>()
  const list = meta ? findChild(meta, 'CLST') : null
  const wrappers = list ? children(list, 'CDVE') : []
  const sources = wrappers.length
    ? wrappers.map((wrapper) => children(wrapper, 'CDEF')[0] ?? null)
    : list
      ? children(list, 'CDEF')
      : []
  sources.forEach((def, index) => {
    if (!def) return
      const title = readFString(file, def.payloadStart, def.payloadEnd)
      if (!title) return
      let cursor = title.next
      if (cursor + 2 > def.payloadEnd) return
      const count = u16(file, cursor)
      cursor += 2
      const props: { name: string; prefix: string; type: number }[] = []
      for (let prop = 0; prop < count; prop++) {
        if (cursor + 10 > def.payloadEnd) break
        const nameId = u32(file, cursor)
        const prefixId = u32(file, cursor + 4)
        const type = u16(file, cursor + 8)
        cursor += 10
        props.push({
          name: names[nameId] ?? `prop${nameId}`,
          prefix: prefixId === 0xffffffff ? '' : names[prefixId] ?? '',
          type,
        })
      }
      defs.set(index, props)
  })
  return { classes, names, defs }
}

function readObject(file: Uint8Array, node: ChunkNode, level: string, table: ReturnType<typeof classTable>, spawned: boolean): WorldObject | null {
  const suffix = node.parts.find((part) => part.kind === 'chunk')
  const prefixEnd = suffix && suffix.kind === 'chunk' ? suffix.node.start : node.payloadEnd
  let cursor = node.payloadStart
  let classId = 0
  let name = ''
  let guid = ''
  if (spawned) {
    if (cursor + 20 > prefixEnd) return null
    classId = u32(file, cursor)
    guid = Array.from(file.subarray(cursor + 4, cursor + 20), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  } else if (node.magic === 'KILL') {
    const entry = readFString(file, cursor, node.payloadEnd)
    if (!entry) return null
    name = entry.text
  } else {
    const asString = readFString(file, cursor, prefixEnd)
    if (asString && asString.next === prefixEnd) {
      name = asString.text
    } else if (cursor + 4 <= prefixEnd) {
      classId = u32(file, cursor)
      const entry = readFString(file, cursor + 4, prefixEnd)
      if (!entry) return null
      name = entry.text
    }
  }
  const propNode = findChild(node, 'PROP')
  const definition = node.magic === 'KILL' ? [] : table.defs.get(classId) ?? []
  const slices = propNode ? readSlices(file, propNode.payloadStart, propNode.payloadEnd, false) : null
  const properties: WorldProperty[] = []
  if (slices) {
    slices.ranges.forEach((range, index) => {
      const spec = definition[index]
      const propName = spec?.name ?? `field${index}`
      const prefix = spec?.prefix ?? ''
      const type = spec?.type ?? 0
      properties.push({
        key: prefix ? `${prefix}/${propName}` : propName,
        name: propName,
        prefix,
        type,
        value: readTyped(file, range.start, range.end, type),
        sliceIndex: index,
      })
    })
  }
  const className = node.magic === 'KILL' ? 'Destroyed' : table.classes[classId] ?? `class${classId}`
  return {
    id: `${level}\u0000${spawned ? 's' : 'n'}\u0000${name}\u0000${guid}`,
    level,
    className,
    name,
    guid,
    spawned,
    destroyed: node.magic === 'KILL',
    properties,
    propNode,
  }
}

function readLevelName(file: Uint8Array, node: ChunkNode): string {
  const prefix = rawPrefix(node)
  if (!prefix) return ''
  return readFString(file, prefix.start, prefix.end)?.text ?? ''
}

function customValue(name: string, slice: Uint8Array): SpudValue {
  if (name.startsWith('Difficulty.')) {
    return { kind: 'number', value: new DataView(slice.buffer, slice.byteOffset, 4).getFloat32(0, true), control: 'float' }
  }
  if (name === 'FriendlyFire') return { kind: 'number', value: slice[0] ?? 0, control: 'check' }
  if (name === 'VERSION' || name === 'SurvivalDifficulty' || name === 'HardcoreState' || name === 'SessionPrivacy' || name === 'CrossplayEnabled' || name === 'Meta_SaveFileRevision') {
    return { kind: 'number', value: slice.length >= 4 ? i32(slice, 0) : 0, control: 'int' }
  }
  if (name.startsWith('GUID_')) return { kind: 'number', value: slice.length >= 4 ? u32(slice, 0) : 0, control: 'int' }
  if (name === 'TimeOfSave') {
    const ticks = slice.length >= 8 ? Number(new DataView(slice.buffer, slice.byteOffset, 8).getBigInt64(0, true)) : 0
    return { kind: 'number', value: ticks, control: 'int' }
  }
  const text = readFString(slice, 0, slice.length)
  if (text && text.next === slice.length) return { kind: 'string', value: text.text }
  return { kind: 'bytes', length: slice.length, text: '', floats: [] }
}

function numberField(custom: CustomField[], name: string): number {
  const field = custom.find((entry) => entry.name === name)
  return field && field.value.kind === 'number' ? field.value.value : 0
}

function stringField(custom: CustomField[], name: string): string {
  const field = custom.find((entry) => entry.name === name)
  return field && field.value.kind === 'string' ? field.value.value : ''
}

export function parseWorld(bytes: Uint8Array): WorldDocument {
  const file = bytes instanceof Uint8Array && bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes)
  const root = parseSaveTree(file)
  const infoNode = findChild(root, 'INFO')
  const cinf = infoNode ? findChild(infoNode, 'CINF') : null
  const shot = infoNode ? findChild(infoNode, 'SHOT') : null
  const customRecord = cinf ? readSlices(file, cinf.payloadStart, cinf.payloadEnd, true) : null
  const custom: CustomField[] = []
  if (customRecord && cinf) {
    customRecord.names.forEach((name, index) => {
      const range = customRecord.ranges[index]!
      custom.push({ name, sliceIndex: index, value: customValue(name, file.subarray(range.start, range.end)) })
    })
  }
  const timestamp = infoTimestamp(file, infoNode)
  const objects: WorldObject[] = []
  const glob = findChild(root, 'GLOB')
  if (glob) {
    const table = classTable(findChild(glob, 'META'), file)
    const list = findChild(glob, 'GOBS')
    const level = readLevelName(file, glob)
    if (list) {
      for (const node of children(list, 'NOBJ')) {
        const object = readObject(file, node, level || 'global', table, false)
        if (object) objects.push(object)
      }
    }
  }
  const levels = findChild(root, 'LVLS')
  let levelCount = 0
  let cellCount = 0
  if (levels) {
    for (const levelNode of children(levels, 'LEVL')) {
      const levelName = readLevelName(file, levelNode)
      levelCount++
      if (levelName.startsWith('RSACell')) cellCount++
      const table = classTable(findChild(levelNode, 'META'), file)
      for (const node of children(findChild(levelNode, 'LATS') ?? levelNode, 'NOBJ')) {
        const object = readObject(file, node, levelName, table, false)
        if (object) objects.push(object)
      }
      const spawned = findChild(levelNode, 'SATS')
      if (spawned) {
        for (const node of children(spawned, 'SPWN')) {
          const object = readObject(file, node, levelName, table, true)
          if (object) objects.push(object)
        }
      }
      const destroyed = findChild(levelNode, 'DATS')
      if (destroyed) {
        for (const node of children(destroyed, 'KILL')) {
          const object = readObject(file, node, levelName, table, false)
          if (object) objects.push(object)
        }
      }
    }
  }
  const guid = ['GUID_A', 'GUID_B', 'GUID_C', 'GUID_D'].map((name) => (numberField(custom, name) >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase()
  return {
    bytes: file,
    root,
    cinf,
    custom,
    objects,
    screenshot: shot ? file.slice(shot.payloadStart, shot.payloadEnd) : null,
    info: {
      systemVersion: infoNode ? u16(file, infoNode.payloadStart) : 0,
      timestamp,
      worldName: stringField(custom, 'WorldName'),
      mapName: stringField(custom, 'WorldMapName'),
      guid,
      difficulty: numberField(custom, 'SurvivalDifficulty'),
      hardcore: numberField(custom, 'HardcoreState'),
      friendlyFire: numberField(custom, 'FriendlyFire'),
      privacy: numberField(custom, 'SessionPrivacy'),
      password: stringField(custom, 'SessionPasswd'),
      crossplay: numberField(custom, 'CrossplayEnabled'),
      owner: stringField(custom, 'WorldNameOwner'),
      revision: numberField(custom, 'Meta_SaveFileRevision'),
      levelCount,
      cellCount,
    },
  }
}

function infoTimestamp(file: Uint8Array, info: ChunkNode | null): string {
  if (!info) return ''
  const prefix = rawPrefix(info)
  const start = prefix?.start ?? info.payloadStart
  const end = prefix?.end ?? info.payloadEnd
  const text = new TextDecoder('latin1').decode(file.subarray(start, end))
  const match = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/)
  return match?.[0] ?? ''
}

export function isWorldBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 83 && bytes[1] === 65 && bytes[2] === 86 && bytes[3] === 69
}

export function leafClass(className: string): string {
  const slash = className.split('/').pop() ?? className
  const dot = slash.split('.').pop() ?? slash
  return dot.replace(/_C$/, '')
}

export function propertyNumber(object: WorldObject, key: string): number | null {
  const property = object.properties.find((entry) => entry.key === key || entry.name === key)
  return property && property.value.kind === 'number' ? property.value.value : null
}

export function propertyText(object: WorldObject, key: string): string | null {
  const property = object.properties.find((entry) => entry.key === key || entry.name === key)
  if (!property) return null
  if (property.value.kind === 'string') return property.value.value
  if (property.value.kind === 'bytes') return property.value.text
  if (property.value.kind === 'list') return property.value.value.join(', ')
  return null
}

export function pageFor(object: WorldObject): 'file' | 'progress' | 'time' | 'resources' | 'containers' | 'buildings' | 'actors' {
  const leaf = leafClass(object.className)
  const keys = object.properties.map((entry) => entry.key).join(' ')
  if (leaf.includes('PersistenceSubsystem')) return 'file'
  if (leaf.includes('WorldProgress') || leaf.includes('LoreItem') || leaf.includes('WorldEvent') || leaf.includes('Boss')) return 'progress'
  if (leaf.includes('InGameTime') || leaf.includes('Weather')) return 'time'
  if (/Chest|Inventory|Loot|WorldItem|(^|_)Item$/.test(leaf) || /JsonInventory|ItemData|Inventory/.test(keys)) return 'containers'
  if (leaf.includes('Building') || leaf.includes('Farm') || keys.includes('BuildingPieceID') || keys.includes('GeneratedPieceID')) return 'buildings'
  if (leaf.split('_').some((token) => /^(Ore|Mining|Tree|Foliage|Clay|Root|ThornyRoot|Rune|Respawn|Rock)/i.test(token) || /(Node|Rock|Tree|Root|Clay|Foliage)$/i.test(token))) return 'resources'
  return 'actors'
}
