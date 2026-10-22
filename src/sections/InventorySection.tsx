import { useEffect, useState } from 'react'
import { ItemIcon } from '../components/ItemIcon'
import { LoadoutPointerChooser } from '../components/LoadoutPointerChooser'
import { SlotEditor } from '../components/SlotEditor'
import { getItem, itemLabel } from '../catalog'
import { asObject, getGameplayRoot } from '../saves/access'
import {
  BAG_SLOT_COUNT,
  containerCapacity,
  FALLBACK_CAPACITY,
  isHotbarSlot,
  maxSlotIndex,
  moveSlot,
  PAGE_COLUMNS,
  pageIndices,
  resolveDisplayedSlot,
  setContainerSlot,
  slotEntries,
  type BagPage,
  type ContainerKey,
} from '../saves/inventory'
import { LOADOUT_SLOTS, loadoutPointerKind } from '../saves/lookups'
import type { ItemSlot, JsonObject } from '../saves/types'
import { BagGrid } from './InventoryGrid'
import { EquipmentDoll } from './LoadoutSection'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

type PageId = BagPage | 'personal'
type Selection = { source: ContainerKey; index: number }

const PAGES: { id: Exclude<PageId, 'hotbar'>; label: string; icon: string }[] = [
  { id: 'inventory', label: 'Inventory', icon: 'T_Icon_Lumberjack_Backpack_final.png' },
  { id: 'runes', label: 'Runes', icon: 'T_Icon_Rune_Air.png' },
  { id: 'ammo', label: 'Ammo', icon: 'T_Icon_Arrows_Wood.png' },
  { id: 'quest', label: 'Quest', icon: 'T_Icon_Scroll.png' },
  { id: 'personal', label: 'Personal', icon: 'T_Icon_Dragon_chest.png' },
]

export function InventorySection({ save, onChange }: Props) {
  const [page, setPage] = useState<PageId>('inventory')
  const [selected, setSelected] = useState<Selection | null>(null)
  const root = getGameplayRoot(save)
  const inventory = asObject(root.Inventory) ?? {}
  const personal = asObject(root.PersonalInventory) ?? {}
  const loadout = asObject(root.Loadout) ?? {}
  const bagSlots = slotEntries(inventory)
  const personalSlots = slotEntries(personal)
  const loadoutSlots = slotEntries(loadout)
  const bagByIndex = new Map(bagSlots.map((entry) => [entry.index, entry.slot]))
  const personalByIndex = new Map(personalSlots.map((entry) => [entry.index, entry.slot]))
  const loadoutByIndex = new Map(loadoutSlots.map((entry) => [entry.index, entry.slot]))
  const occupiedMax = bagSlots.length ? Math.max(...bagSlots.map((entry) => entry.index)) : -1
  const bagCapacity = Math.max(containerCapacity(inventory, FALLBACK_CAPACITY.Inventory), BAG_SLOT_COUNT)
  const personalCapacity = containerCapacity(personal, FALLBACK_CAPACITY.PersonalInventory)
  const showVital = [...bagSlots, ...personalSlots, ...loadoutSlots].some((entry) => entry.slot.VitalShield !== undefined)
  const showUpgrades = [...bagSlots, ...personalSlots, ...loadoutSlots].some((entry) => entry.slot.NumUpgradesApplied !== undefined)
    || (typeof save.Version === 'number' && save.Version >= 80)

  const pageRanges: Record<BagPage, number[]> = {
    hotbar: pageIndices('hotbar'),
    inventory: pageIndices('inventory'),
    runes: pageIndices('runes'),
    ammo: pageIndices('ammo'),
    quest: pageIndices('quest', occupiedMax),
  }

  const counts = {
    inventory: countFilled(bagByIndex, pageRanges.inventory),
    runes: countFilled(bagByIndex, pageRanges.runes),
    ammo: countFilled(bagByIndex, pageRanges.ammo),
    quest: countFilled(bagByIndex, pageRanges.quest),
    personal: personalSlots.length,
  }

  const pageSource: ContainerKey = page === 'personal' ? 'PersonalInventory' : 'Inventory'
  const pageSlots = page === 'personal'
    ? Array.from({ length: personalCapacity }, (_, index) => index)
    : pageRanges[page]
  const pageByIndex = pageSource === 'PersonalInventory' ? personalByIndex : bagByIndex
  const selectedSlot = selected
    ? (selected.source === 'Inventory' ? bagByIndex : selected.source === 'PersonalInventory' ? personalByIndex : loadoutByIndex).get(selected.index)
    : undefined
  const selectedDisplayed = selected?.source === 'Loadout'
    ? resolveDisplayedSlot(selectedSlot, bagSlots)
    : selectedSlot
  const selectedItem = getItem(selectedDisplayed?.ItemData)
  const selectedMeta = selected?.source === 'Loadout'
    ? LOADOUT_SLOTS.find((slot) => slot.index === selected.index)
    : undefined
  const pointerKind = loadoutPointerKind(selectedMeta)
  const expandable = page === 'personal'
  const expandKey: Exclude<ContainerKey, 'Loadout'> = 'PersonalInventory'

  function patch(mutator: (gameplay: JsonObject) => void) {
    const next = structuredClone(save)
    mutator(getGameplayRoot(next))
    onChange(next)
  }

  function select(source: ContainerKey, index: number) {
    setSelected((current) => (
      current?.source === source && current.index === index ? null : { source, index }
    ))
  }

  function closeDetails() {
    setSelected(null)
  }

  function handleMove(fromIndex: number, fromSource: string, toIndex: number, toSource: string) {
    if (!isContainerKey(fromSource) || !isContainerKey(toSource)) return
    patch((gameplay) => moveSlot(gameplay, fromSource, fromIndex, toSource, toIndex))
    setSelected(null)
  }

  function writeSelected(nextSlot: ItemSlot | undefined) {
    if (!selected) return
    patch((gameplay) => {
      setContainerSlot(gameplay, selected.source, selected.index, nextSlot)
      if (selected.source === 'Loadout') {
        const container = asObject(gameplay.Loadout)
        if (container) container.MaxSlotIndex = Math.max(maxSlotIndex(container), selected.index)
      }
    })
  }

  useEffect(() => {
    if (!selected) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDetails()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Inventory</h2>
        <span className="muted">{bagSlots.length} items · {personalSlots.length} / {personalCapacity} chest</span>
      </div>
      <p className="hint">Drag items to move them. Click an item for details.</p>
      <div className="inv-main">
        <EquipmentDoll
          save={save}
          selectedIndex={selected?.source === 'Loadout' ? selected.index : null}
          selectedSource={selected?.source}
          onSelect={(index) => select('Loadout', index)}
          onMove={handleMove}
        />
        <div className="inv-page">
          <div className="inv-sheet">
            <div className="inv-tablist" role="tablist" aria-label="Inventory pages">
              {PAGES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={page === entry.id}
                  className="inv-tab"
                  onClick={() => {
                    setPage(entry.id)
                    setSelected(null)
                  }}
                >
                  <ItemIcon icon={entry.icon} alt="" size={22} />
                  {entry.label}
                  <span className="inv-tab-count">{counts[entry.id]}</span>
                </button>
              ))}
            </div>
            <div className="inv-grids">
              {page === 'inventory' ? (
                <BagGrid
                  source="Inventory"
                  byIndex={bagByIndex}
                  indices={pageRanges.hotbar}
                  selectedSource={selected?.source}
                  selectedIndex={selected?.index}
                  columns={PAGE_COLUMNS}
                  hotkeys
                  onSelect={(index) => select('Inventory', index)}
                  onMove={handleMove}
                />
              ) : null}
              <BagGrid
                source={pageSource}
                byIndex={pageByIndex}
                indices={pageSlots}
                selectedSource={selected?.source}
                selectedIndex={selected?.index}
                columns={PAGE_COLUMNS}
                onSelect={(index) => select(pageSource, index)}
                onMove={handleMove}
              />
            </div>
            {expandable ? (
              <button
                type="button"
                className="inv-expand"
                onClick={() => patch((gameplay) => {
                  const current = asObject(gameplay[expandKey]) ?? {}
                  const nextMax = Math.max(maxSlotIndex(current), personalCapacity - 1) + 8
                  gameplay[expandKey] = { ...current, MaxSlotIndex: nextMax }
                })}
              >
                Expand chest
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {selected ? (
        <div className="modal-backdrop" onClick={closeDetails}>
          <div
            className={pointerKind ? 'modal slot-inspector-modal slot-inspector-chooser' : 'modal slot-inspector-modal'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="slot-inspector-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={closeDetails}
            >
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path d="M1 1l12 12M13 1L1 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            <header className="modal-head">
              <h3 id="slot-inspector-title">
                {pointerKind
                  ? selectedMeta?.label ?? 'Choose item'
                  : (selectedItem?.name ?? selectedMeta?.label ?? (selectedSlot ? itemLabel(selectedSlot.ItemData) : 'Empty'))}
              </h3>
            </header>
            {pointerKind ? (
              <LoadoutPointerChooser
                kind={pointerKind}
                bag={bagSlots}
                selectedIndex={
                  typeof selectedSlot?.PlayerInventoryItemIndex === 'number'
                    ? selectedSlot.PlayerInventoryItemIndex
                    : undefined
                }
                onPick={(bagIndex) => {
                  writeSelected({ PlayerInventoryItemIndex: bagIndex })
                  closeDetails()
                }}
                onClear={() => {
                  writeSelected(undefined)
                  closeDetails()
                }}
              />
            ) : (
              <>
                {isHotbarSlot(selectedSlot) ? (
                  <p className="tiny">
                    Points at bag slot {selectedSlot?.PlayerInventoryItemIndex}
                    {selectedDisplayed?.ItemData ? ` · ${itemLabel(selectedDisplayed.ItemData)}` : ''}
                  </p>
                ) : null}
                <SlotEditor
                  slot={(selectedSlot?.ItemData || isHotbarSlot(selectedSlot)) ? selectedSlot : undefined}
                  allowHotbar={selectedMeta?.kind === 'hotbar'}
                  inventoryCount={bagCapacity}
                  showVitalShield={showVital}
                  showUpgrades={showUpgrades}
                  onChange={writeSelected}
                />
                {selectedSlot ? (
                  <div className="slot-inspector-actions">
                    <button type="button" className="btn-danger" onClick={() => writeSelected(undefined)}>
                      Clear slot
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function isContainerKey(value: string): value is ContainerKey {
  return value === 'Inventory' || value === 'PersonalInventory' || value === 'Loadout'
}

function countFilled(byIndex: Map<number, ItemSlot>, indices: number[]): number {
  return indices.filter((index) => Boolean(byIndex.get(index)?.ItemData)).length
}
