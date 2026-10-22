import { getItem, itemLabel, itemMatchesLoadoutPointer } from '../catalog'
import type { LoadoutPointerKind } from '../saves/lookups'
import type { ItemSlot } from '../saves/types'
import { ItemIcon } from './ItemIcon'

type BagEntry = { index: number; slot: ItemSlot }

type Props = {
  kind: LoadoutPointerKind
  bag: BagEntry[]
  selectedIndex?: number
  onPick: (bagIndex: number) => void
  onClear: () => void
}

const KIND_HINT: Record<LoadoutPointerKind, string> = {
  arrows: 'arrows in your bag',
  runes: 'runes in your bag',
  bolts: 'bolts in your bag',
  bait: 'bait in your bag',
}

export function LoadoutPointerChooser({ kind, bag, selectedIndex, onPick, onClear }: Props) {
  const matches = bag
    .filter((entry) => itemMatchesLoadoutPointer(getItem(entry.slot.ItemData), kind))
    .sort((a, b) => a.index - b.index)

  return (
    <div className="loadout-pointer-chooser">
      <p className="hint">Choose from {KIND_HINT[kind]}.</p>
      {matches.length ? (
        <div className="picker-results">
          <div className="picker-grid loadout-pointer-grid">
            {matches.map((entry) => {
              const item = getItem(entry.slot.ItemData)
              const active = entry.index === selectedIndex
              const count = entry.slot.Count
              return (
                <button
                  key={entry.index}
                  type="button"
                  className={active ? 'picker-item active' : 'picker-item'}
                  onClick={() => onPick(entry.index)}
                >
                  <ItemIcon icon={item?.icon} alt="" size={36} />
                  <span>
                    {item?.name ?? itemLabel(entry.slot.ItemData)}
                    <small>
                      Bag slot {entry.index}
                      {typeof count === 'number' ? ` · ×${count}` : ''}
                    </small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="muted">No matching items in inventory.</p>
      )}
      {selectedIndex !== undefined ? (
        <div className="slot-inspector-actions">
          <button type="button" className="btn-danger" onClick={onClear}>
            Clear slot
          </button>
        </div>
      ) : null}
    </div>
  )
}
