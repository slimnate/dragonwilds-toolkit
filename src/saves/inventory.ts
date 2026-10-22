import { asObject, getGameplayRoot, isObject } from './access'
import { randomInstanceGuid } from './ids'
import { LOADOUT_SLOTS } from './lookups'
import type { ItemSlot, JsonObject } from './types'

export type ContainerKey = 'Inventory' | 'PersonalInventory' | 'Loadout'
export type BagPage = 'hotbar' | 'inventory' | 'runes' | 'ammo' | 'quest'

export const HOTBAR_SIZE = 8
export const PAGE_COLUMNS = 8
export const PAGE_ROWS = 3
export const PAGE_SIZE = PAGE_COLUMNS * PAGE_ROWS
// 1.0.1 grew the main bag from 24 slots to 32 (hotbar + bag = 40).
export const INVENTORY_PAGE_ROWS = 4
export const INVENTORY_PAGE_SIZE = PAGE_COLUMNS * INVENTORY_PAGE_ROWS

export const BAG_PAGES: { id: BagPage; start: number; size: number }[] = [
  { id: 'hotbar', start: 0, size: HOTBAR_SIZE },
  { id: 'inventory', start: HOTBAR_SIZE, size: INVENTORY_PAGE_SIZE },
  { id: 'runes', start: HOTBAR_SIZE + INVENTORY_PAGE_SIZE, size: PAGE_SIZE },
  { id: 'ammo', start: HOTBAR_SIZE + INVENTORY_PAGE_SIZE + PAGE_SIZE, size: PAGE_SIZE },
  { id: 'quest', start: HOTBAR_SIZE + INVENTORY_PAGE_SIZE + PAGE_SIZE * 2, size: PAGE_SIZE },
]

export const BAG_SLOT_COUNT = HOTBAR_SIZE + INVENTORY_PAGE_SIZE + PAGE_SIZE * 3

export const FALLBACK_CAPACITY: Record<Exclude<ContainerKey, 'Loadout'>, number> = {
  Inventory: BAG_SLOT_COUNT - 1,
  PersonalInventory: 19,
}

export function bagPageSpec(page: BagPage) {
  const spec = BAG_PAGES.find((entry) => entry.id === page)
  if (!spec) throw new Error(`Unknown bag page ${page}`)
  return spec
}

export function pageIndices(page: BagPage, occupiedMax = -1): number[] {
  const spec = bagPageSpec(page)
  const indices = Array.from({ length: spec.size }, (_, index) => spec.start + index)
  if (page === 'quest') {
    for (let index = spec.start + spec.size; index <= occupiedMax; index += 1) {
      indices.push(index)
    }
  }
  return indices
}

export function slotEntries(container: JsonObject | undefined): { index: number; slot: ItemSlot }[] {
  if (!container) return []
  const out: { index: number; slot: ItemSlot }[] = []
  for (const [key, value] of Object.entries(container)) {
    if (key === 'MaxSlotIndex') continue
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) continue
    if (isObject(value)) out.push({ index, slot: value as ItemSlot })
  }
  return out.sort((a, b) => a.index - b.index)
}

export function maxSlotIndex(container: JsonObject | undefined): number {
  const value = container?.MaxSlotIndex
  return typeof value === 'number' ? value : -1
}

export function firstEmptySlot(container: JsonObject | undefined, fallbackMax = 80): number {
  const max = Math.max(maxSlotIndex(container), fallbackMax)
  const used = new Set(slotEntries(container).map((entry) => entry.index))
  for (let i = 0; i <= max; i += 1) {
    if (!used.has(i)) return i
  }
  return max + 1
}

export function rebuildContainer(
  container: JsonObject | undefined,
  slots: { index: number; slot: ItemSlot }[],
  maxIndex?: number,
): JsonObject {
  const next: JsonObject = {}
  for (const entry of [...slots].sort((a, b) => a.index - b.index)) {
    next[String(entry.index)] = entry.slot
  }
  const resolvedMax = maxIndex ?? Math.max(
    maxSlotIndex(container),
    ...slots.map((entry) => entry.index),
    -1,
  )
  next.MaxSlotIndex = resolvedMax
  return next
}

export function setContainerSlot(
  parent: JsonObject,
  key: string,
  index: number,
  slot: ItemSlot | undefined,
): void {
  const current = asObject(parent[key]) ?? {}
  const slots = slotEntries(current).filter((entry) => entry.index !== index)
  if (slot) slots.push({ index, slot })
  const max = Math.max(maxSlotIndex(current), index)
  parent[key] = rebuildContainer(current, slots, max)
}

export function swapContainerSlots(
  parent: JsonObject,
  key: string,
  fromIndex: number,
  toIndex: number,
): void {
  if (fromIndex === toIndex) return
  const current = asObject(parent[key]) ?? {}
  const byIndex = new Map(slotEntries(current).map((entry) => [entry.index, entry.slot]))
  const fromSlot = byIndex.get(fromIndex)
  const toSlot = byIndex.get(toIndex)
  if (!fromSlot && !toSlot) return
  if (toSlot) byIndex.set(fromIndex, toSlot)
  else byIndex.delete(fromIndex)
  if (fromSlot) byIndex.set(toIndex, fromSlot)
  else byIndex.delete(toIndex)
  parent[key] = rebuildContainer(
    current,
    [...byIndex.entries()].map(([index, slot]) => ({ index, slot })),
    Math.max(maxSlotIndex(current), fromIndex, toIndex),
  )
  if (key === 'Inventory') remapLoadoutBagPointers(parent, fromIndex, toIndex)
}

function loadoutKind(index: number): 'item' | 'hotbar' | undefined {
  return LOADOUT_SLOTS.find((slot) => slot.index === index)?.kind
}

export function moveSlot(
  parent: JsonObject,
  fromKey: ContainerKey,
  fromIndex: number,
  toKey: ContainerKey,
  toIndex: number,
): void {
  if (fromKey === toKey) {
    swapContainerSlots(parent, fromKey, fromIndex, toIndex)
    return
  }

  const fromMeta = fromKey === 'Loadout' ? loadoutKind(fromIndex) : undefined
  const toMeta = toKey === 'Loadout' ? loadoutKind(toIndex) : undefined

  if (fromKey === 'Inventory' && toKey === 'Loadout' && toMeta === 'hotbar') {
    setContainerSlot(parent, 'Loadout', toIndex, { PlayerInventoryItemIndex: fromIndex })
    return
  }
  if (toKey === 'Inventory' && fromKey === 'Loadout' && fromMeta === 'hotbar') {
    setContainerSlot(parent, 'Loadout', fromIndex, { PlayerInventoryItemIndex: toIndex })
    return
  }

  const fromSlot = slotEntries(asObject(parent[fromKey])).find((entry) => entry.index === fromIndex)?.slot
  const toSlot = slotEntries(asObject(parent[toKey])).find((entry) => entry.index === toIndex)?.slot
  setContainerSlot(parent, fromKey, fromIndex, toSlot)
  setContainerSlot(parent, toKey, toIndex, fromSlot)
}

function remapLoadoutBagPointers(parent: JsonObject, fromIndex: number, toIndex: number): void {
  const loadout = asObject(parent.Loadout)
  if (!loadout) return
  for (const entry of slotEntries(loadout)) {
    const pointed = entry.slot.PlayerInventoryItemIndex
    if (typeof pointed !== 'number') continue
    if (pointed === fromIndex) entry.slot.PlayerInventoryItemIndex = toIndex
    else if (pointed === toIndex) entry.slot.PlayerInventoryItemIndex = fromIndex
  }
}

export function containerCapacity(container: JsonObject | undefined, fallback = 80): number {
  const stored = maxSlotIndex(container)
  const occupied = slotEntries(container)
  const occupiedMax = occupied.length ? Math.max(...occupied.map((entry) => entry.index)) : -1
  const last = stored >= 0 ? Math.max(stored, occupiedMax) : Math.max(occupiedMax, fallback)
  return Math.max(last, 0) + 1
}

export function resolveDisplayedSlot(
  slot: ItemSlot | undefined,
  bag: { index: number; slot: ItemSlot }[],
): ItemSlot | undefined {
  if (!slot) return undefined
  if (typeof slot.PlayerInventoryItemIndex === 'number' && !slot.ItemData) {
    return bag.find((entry) => entry.index === slot.PlayerInventoryItemIndex)?.slot
  }
  return slot
}

export function makeItemSlot(itemId: string, extras: Partial<ItemSlot> = {}): ItemSlot {
  const slot: ItemSlot = {
    GUID: extras.GUID ?? randomInstanceGuid(),
    ItemData: itemId,
  }
  if (extras.Count !== undefined) slot.Count = extras.Count
  if (extras.Durability !== undefined) slot.Durability = extras.Durability
  if (extras.VitalShield !== undefined) slot.VitalShield = extras.VitalShield
  if (extras.NumUpgradesApplied !== undefined) slot.NumUpgradesApplied = extras.NumUpgradesApplied
  return slot
}

export function isHotbarSlot(slot: ItemSlot | undefined): boolean {
  return slot?.PlayerInventoryItemIndex !== undefined && slot.ItemData === undefined
}

export function slotSummary(slot: ItemSlot | undefined): string {
  if (!slot) return 'Empty'
  if (typeof slot.PlayerInventoryItemIndex === 'number' && !slot.ItemData) {
    return `Bag slot ${slot.PlayerInventoryItemIndex}`
  }
  return slot.ItemData ?? 'Unknown'
}

export function pruneInventoryContainers(save: JsonObject): JsonObject {
  const next = structuredClone(save)
  const root = getGameplayRoot(next)
  for (const key of ['Inventory', 'PersonalInventory', 'Loadout']) {
    const container = asObject(root[key])
    if (!container) continue
    const slots = slotEntries(container).filter((entry) => (
      Boolean(entry.slot.ItemData) || typeof entry.slot.PlayerInventoryItemIndex === 'number'
    ))
    root[key] = rebuildContainer(container, slots)
  }
  return next
}
