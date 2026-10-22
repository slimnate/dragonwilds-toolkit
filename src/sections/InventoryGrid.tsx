import { InventorySlotCell } from '../components/InventorySlotCell'
import type { ItemSlot } from '../saves/types'

type Props = {
  source: string
  byIndex: Map<number, ItemSlot>
  indices: number[]
  selectedSource?: string | null
  selectedIndex?: number | null
  emptyLabels?: Record<number, string>
  columns?: number
  hotkeys?: boolean
  resolveDisplayed?: (index: number, slot?: ItemSlot) => ItemSlot | undefined
  onSelect: (index: number) => void
  onMove: (fromIndex: number, fromSource: string, toIndex: number, toSource: string) => void
}

export function BagGrid({
  source,
  byIndex,
  indices,
  selectedSource,
  selectedIndex,
  emptyLabels,
  columns,
  hotkeys,
  resolveDisplayed,
  onSelect,
  onMove,
}: Props) {
  return (
    <div
      className={`bag-grid${hotkeys ? ' numbered' : ''}`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, 68px)` } : undefined}
    >
      {indices.map((index, order) => {
        const slot = byIndex.get(index)
        return (
          <InventorySlotCell
            key={`${source}:${index}`}
            index={index}
            source={source}
            slot={slot}
            displayed={resolveDisplayed?.(index, slot)}
            selected={selectedSource === source && selectedIndex === index}
            emptyLabel={emptyLabels?.[index]}
            overlay={hotkeys ? String(order + 1) : undefined}
            onSelect={() => onSelect(index)}
            onMove={onMove}
          />
        )
      })}
    </div>
  )
}
