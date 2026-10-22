import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { getItem, itemLabel } from '../catalog'
import { ItemIcon } from './ItemIcon'
import { isHotbarSlot } from '../saves/inventory'
import type { ItemSlot } from '../saves/types'

type Props = {
  index: number
  source: string
  slot?: ItemSlot
  displayed?: ItemSlot
  selected?: boolean
  emptyLabel?: string
  overlay?: string
  onSelect: () => void
  onMove: (fromIndex: number, fromSource: string, toIndex: number, toSource: string) => void
}

const DRAG_THRESHOLD = 6

export function InventorySlotCell({
  index,
  source,
  slot,
  displayed,
  selected,
  emptyLabel,
  overlay,
  onSelect,
  onMove,
}: Props) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const skipClick = useRef(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const shown = displayed ?? slot
  const item = getItem(shown?.ItemData)
  const filled = Boolean(shown?.ItemData) || isHotbarSlot(slot)
  const maxDurability = item?.baseDurability
  const durability = typeof shown?.Durability === 'number' && maxDurability
    ? Math.min(100, Math.max(0, (shown.Durability / maxDurability) * 100))
    : undefined

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const wasDragging = dragging.current
    const from = origin.current ? { source, index } : null
    origin.current = null
    dragging.current = false
    setGhost(null)
    document.querySelectorAll('.bag-slot.drag-over').forEach((node) => node.classList.remove('drag-over'))
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!wasDragging || !from) return
    skipClick.current = true
    const top = document.elementFromPoint(event.clientX, event.clientY)
    const target = top?.closest('[data-inv-slot]') as HTMLElement | null
    if (!target) return
    const toSource = target.dataset.invSource
    const toIndex = Number(target.dataset.invIndex)
    if (!toSource || !Number.isInteger(toIndex)) return
    if (toSource === from.source && toIndex === from.index) return
    onMove(from.index, from.source, toIndex, toSource)
  }

  return (
    <div
      className={`bag-slot${selected ? ' selected' : ''}${filled ? '' : ' empty'}${ghost ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      data-inv-slot=""
      data-inv-source={source}
      data-inv-index={String(index)}
      title={filled ? itemLabel(shown?.ItemData) : (emptyLabel ?? `Slot ${index}`)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !filled) return
        origin.current = { x: event.clientX, y: event.clientY }
        dragging.current = false
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Capture needs a real pointer; drop still resolves via elementFromPoint.
        }
      }}
      onPointerMove={(event) => {
        if (!origin.current) return
        const dx = event.clientX - origin.current.x
        const dy = event.clientY - origin.current.y
        if (!dragging.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
        dragging.current = true
        setGhost({ x: event.clientX, y: event.clientY })
        document.querySelectorAll('.bag-slot.drag-over').forEach((node) => node.classList.remove('drag-over'))
        const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-inv-slot]')
        if (over && over !== event.currentTarget) over.classList.add('drag-over')
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false
          return
        }
        onSelect()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      {overlay ? <span className="bag-hotkey">{overlay}</span> : null}
      {filled ? (
        <ItemIcon icon={item?.icon} alt="" size={48} className="bag-item-icon" />
      ) : emptyLabel ? (
        <span className="bag-empty-label">{emptyLabel}</span>
      ) : null}
      {typeof shown?.Count === 'number' && shown.Count > 1 ? (
        <span className="bag-count">{shown.Count}</span>
      ) : null}
      {isHotbarSlot(slot) ? (
        <span className="bag-pointer">#{slot?.PlayerInventoryItemIndex}</span>
      ) : null}
      {durability !== undefined ? (
        <span className="bag-durability" style={{ '--pct': `${durability}%` } as CSSProperties} />
      ) : null}
      {ghost ? (
        <span className="bag-drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          <ItemIcon icon={item?.icon} alt="" size={48} />
        </span>
      ) : null}
    </div>
  )
}
