import { InventorySlotCell } from '../components/InventorySlotCell'
import { asObject, getGameplayRoot } from '../saves/access'
import { resolveDisplayedSlot, slotEntries } from '../saves/inventory'
import { LOADOUT_SLOTS } from '../saves/lookups'
import type { JsonObject } from '../saves/types'

type Props = {
  save: JsonObject
  selectedIndex: number | null
  selectedSource?: string | null
  onSelect: (index: number) => void
  onMove: (fromIndex: number, fromSource: string, toIndex: number, toSource: string) => void
}

const DOLL = [
  { index: 0, area: 'head' },
  { index: 8, area: 'heldL' },
  { index: 1, area: 'body' },
  { index: 3, area: 'cape' },
  { index: 2, area: 'legs' },
  { index: 7, area: 'heldR' },
  { index: 4, area: 'ring' },
  { index: 11, area: 'amulet' },
] as const

const BAR = [5, 6, 9, 10] as const

export function EquipmentDoll({ save, selectedIndex, selectedSource, onSelect, onMove }: Props) {
  const root = getGameplayRoot(save)
  const loadout = asObject(root.Loadout) ?? {}
  const bag = slotEntries(asObject(root.Inventory))
  const byIndex = new Map(slotEntries(loadout).map((entry) => [entry.index, entry.slot]))

  function renderCell(index: number) {
    const meta = LOADOUT_SLOTS.find((slot) => slot.index === index)
    if (!meta) return null
    const slot = byIndex.get(index)
    return (
      <InventorySlotCell
        index={index}
        source="Loadout"
        slot={slot}
        displayed={resolveDisplayedSlot(slot, bag)}
        selected={selectedSource === 'Loadout' && selectedIndex === index}
        emptyLabel={meta.label}
        onSelect={() => onSelect(index)}
        onMove={onMove}
      />
    )
  }

  return (
    <div className="loadout-board">
      <div className="loadout-doll">
        {DOLL.map((entry) => (
          <div key={entry.index} style={{ gridArea: entry.area }}>
            {renderCell(entry.index)}
          </div>
        ))}
      </div>
      <div className="loadout-bar">
        {BAR.map((index) => (
          <div key={index}>{renderCell(index)}</div>
        ))}
      </div>
    </div>
  )
}
