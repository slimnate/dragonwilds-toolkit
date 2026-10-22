import { getItem, isEquipableItem, itemHasDurability, itemLabel } from '../catalog'
import { ItemIcon } from './ItemIcon'
import { ItemPicker } from './ItemPicker'
import { isHotbarSlot, makeItemSlot } from '../saves/inventory'
import type { ItemSlot } from '../saves/types'

type Props = {
  slot?: ItemSlot
  onChange: (slot: ItemSlot | undefined) => void
  showVitalShield?: boolean
  showUpgrades?: boolean
  allowHotbar?: boolean
  inventoryCount?: number
}

export function SlotEditor({
  slot,
  onChange,
  showVitalShield = false,
  showUpgrades = false,
  allowHotbar = false,
  inventoryCount = 0,
}: Props) {
  const hotbar = isHotbarSlot(slot)
  const item = getItem(slot?.ItemData)
  const equipable = isEquipableItem(item)
  const showDurability = itemHasDurability(item)
  const showItemUpgrades = showUpgrades && equipable

  function setItem(id: string | undefined) {
    if (!id) {
      onChange(undefined)
      return
    }
    const catalog = getItem(id)
    const next = makeItemSlot(id, {
      GUID: slot?.GUID,
      Count: catalog?.maxStackSize && catalog.maxStackSize > 1 ? (slot?.Count ?? 1) : undefined,
      Durability: itemHasDurability(catalog)
        ? (slot?.Durability ?? catalog?.baseDurability)
        : undefined,
      VitalShield: showVitalShield ? slot?.VitalShield : undefined,
      NumUpgradesApplied: showUpgrades && isEquipableItem(catalog) ? (slot?.NumUpgradesApplied ?? 0) : undefined,
    })
    onChange(next)
  }

  return (
    <div className="slot-editor">
      {allowHotbar ? (
        <label className="check">
          <input
            type="checkbox"
            checked={hotbar}
            onChange={(event) => {
              if (event.target.checked) onChange({ PlayerInventoryItemIndex: 0 })
              else onChange(undefined)
            }}
          />
          Hotbar pointer
        </label>
      ) : null}
      {hotbar ? (
        <label>
          Inventory index
          <input
            type="number"
            min={0}
            max={Math.max(inventoryCount - 1, 0)}
            value={slot?.PlayerInventoryItemIndex ?? 0}
            onChange={(event) => onChange({ PlayerInventoryItemIndex: Number(event.target.value) })}
          />
        </label>
      ) : (
        <>
          <ItemPicker value={slot?.ItemData} onChange={setItem} />
          {slot?.ItemData ? (
            <div className="slot-fields">
              <p className="muted">
                <ItemIcon icon={item?.icon} size={20} /> {itemLabel(slot.ItemData)}
              </p>
              <label>
                Count
                <input
                  type="number"
                  min={1}
                  value={slot.Count ?? ''}
                  placeholder="1"
                  onChange={(event) => {
                    const next = { ...slot }
                    const raw = event.target.value
                    if (raw === '') delete next.Count
                    else next.Count = Number(raw)
                    onChange(next)
                  }}
                />
              </label>
              {showDurability ? (
                <label>
                  Durability
                  <input
                    type="number"
                    min={0}
                    value={slot.Durability ?? ''}
                    placeholder={item?.baseDurability ? String(item.baseDurability) : ''}
                    onChange={(event) => {
                      const next = { ...slot }
                      const raw = event.target.value
                      if (raw === '') delete next.Durability
                      else next.Durability = Number(raw)
                      onChange(next)
                    }}
                  />
                </label>
              ) : null}
              {showItemUpgrades ? (
                <label>
                  Upgrades
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={slot.NumUpgradesApplied ?? 0}
                    onChange={(event) => onChange({ ...slot, NumUpgradesApplied: Number(event.target.value) })}
                  />
                </label>
              ) : null}
              {showVitalShield ? (
                <label>
                  Vital shield
                  <input
                    type="number"
                    min={0}
                    value={slot.VitalShield ?? 0}
                    onChange={(event) => onChange({ ...slot, VitalShield: Number(event.target.value) })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
