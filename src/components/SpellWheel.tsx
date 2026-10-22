import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ItemIcon } from './ItemIcon'
import { getSpell, skills } from '../catalog'
import type { CatalogSpell } from '../saves/types'
import {
  RADIAL_LABELS,
  SLOTS_PER_RADIAL,
  type SpellDragPayload,
} from '../saves/spellSlots'

const DRAG_THRESHOLD = 6

type SpellRuneCost = { name: string; amount: string }

function parseRunes(runes: string | undefined): SpellRuneCost[] {
  if (!runes) return []
  const costs: SpellRuneCost[] = []
  for (const match of runes.matchAll(/([A-Za-z]+)=(\d+)/g)) {
    const name = match[1]
    const amount = match[2]
    if (name && amount) costs.push({ name, amount })
  }
  return costs
}

function formatCooldown(seconds: number | undefined): string {
  if (seconds == null) return ''
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const rest = Math.round(seconds % 60)
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  return `${seconds}s`
}

function CooldownIcon() {
  return (
    <svg className="spell-tooltip-clock" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <circle cx="8" cy="8" r="6.15" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 4.35V8.15l2.35 1.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SpellTooltip({ spell, x, y }: { spell: CatalogSpell; x: number; y: number }) {
  const width = 300
  const flipY = y > window.innerHeight - 280
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - width - 8))
  const top = flipY ? Math.max(8, y - 12) : y + 16
  const skill = spell.skill ? skills.find((entry) => entry.name === spell.skill) : undefined
  const cooldown = formatCooldown(spell.cooldown)
  const runes = parseRunes(spell.runes)
  const showSkill = Boolean(spell.skill || spell.level != null)

  return createPortal(
    <div
      className="spell-tooltip"
      style={{
        left,
        top,
        width,
        transform: flipY ? 'translateY(-100%)' : undefined,
      }}
    >
      <ItemIcon icon={spell.icon} alt="" size={40} folder="spells" />
      <div className="spell-tooltip-body">
        <strong>{spell.name}</strong>
        {spell.description ? <p>{spell.description}</p> : null}
        {showSkill || cooldown || runes.length ? (
          <div className="spell-tooltip-stats">
            {showSkill ? (
              <div className="spell-tooltip-row">
                {skill?.icon ? (
                  <ItemIcon icon={skill.icon} alt="" size={20} folder="skills" />
                ) : null}
                <span>{spell.skill || 'Skill'}</span>
                {spell.level != null ? <span className="spell-tooltip-level">Lv {spell.level}</span> : null}
              </div>
            ) : null}
            {cooldown ? (
              <div className="spell-tooltip-row">
                <CooldownIcon />
                <span>{cooldown}</span>
              </div>
            ) : null}
            {runes.length ? (
              <div className="spell-tooltip-runes">
                {runes.map((rune) => (
                  <span className="spell-tooltip-rune" key={`${rune.name}-${rune.amount}`}>
                    <ItemIcon icon={`T_Icon_Rune_${rune.name}.png`} alt="" size={28} folder="icons" />
                    <span>{rune.amount}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {open ? (
        <path
          d="M5 7.2V4.6a3 3 0 0 1 5.7-1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M5 7.2V5a3 3 0 0 1 6 0v2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
      <rect
        x="3.2"
        y="7.1"
        width="9.6"
        height="7.1"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

type DragSourceProps = {
  payload: SpellDragPayload | null
  className?: string
  dropId?: string
  selected?: boolean
  hoverSpell?: CatalogSpell
  onSelect?: () => void
  onDropSpell: (payload: SpellDragPayload, dropId: string) => void
  onDoubleClick?: () => void
  asButton?: boolean
  children: ReactNode
}

export function SpellDragSource({
  payload,
  className,
  dropId,
  selected,
  hoverSpell,
  onSelect,
  onDropSpell,
  onDoubleClick,
  asButton = true,
  children,
}: DragSourceProps) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const skipClick = useRef(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const spell = getSpell(payload?.id)

  function clearOver() {
    document.querySelectorAll('.spell-drop.drag-over').forEach((node) => node.classList.remove('drag-over'))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const wasDragging = dragging.current
    const from = payload
    origin.current = null
    dragging.current = false
    setGhost(null)
    clearOver()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!wasDragging || !from) return
    skipClick.current = true
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-spell-drop]') as HTMLElement | null
    const drop = target?.dataset.spellDrop
    if (!drop) return
    onDropSpell(from, drop)
  }

  return (
    <div
      className={`spell-drop${className ? ` ${className}` : ''}${selected ? ' selected' : ''}${ghost ? ' dragging' : ''}`}
      role={asButton ? 'button' : undefined}
      tabIndex={asButton ? 0 : undefined}
      data-spell-drop={dropId}
      onMouseEnter={(event) => setTip({ x: event.clientX, y: event.clientY })}
      onMouseMove={(event) => setTip({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setTip(null)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !payload) return
        if ((event.target as HTMLElement).closest('button')) return
        origin.current = { x: event.clientX, y: event.clientY }
        dragging.current = false
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Drop still resolves via elementFromPoint.
        }
      }}
      onPointerMove={(event) => {
        if (!origin.current || !payload) return
        const dx = event.clientX - origin.current.x
        const dy = event.clientY - origin.current.y
        if (!dragging.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
        dragging.current = true
        setTip(null)
        setGhost({ x: event.clientX, y: event.clientY })
        clearOver()
        const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-spell-drop]')
        if (over && over !== event.currentTarget) over.classList.add('drag-over')
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false
          return
        }
        onSelect?.()
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        onDoubleClick?.()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect?.()
        }
      }}
    >
      {children}
      {ghost && payload ? (
        <span className="spell-drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          <ItemIcon icon={spell?.icon} alt="" size={44} folder="spells" />
        </span>
      ) : null}
      {hoverSpell && tip && !ghost ? (
        <SpellTooltip spell={hoverSpell} x={tip.x} y={tip.y} />
      ) : null}
    </div>
  )
}

type SlotProps = {
  index: number
  spellId: string
  selected?: boolean
  onSelect: () => void
  onDropSpell: (payload: SpellDragPayload, dropId: string) => void
  onClear: () => void
}

export function SpellSlot({ index, spellId, selected, onSelect, onDropSpell, onClear }: SlotProps) {
  const spell = getSpell(spellId)
  const filled = Boolean(spellId)

  return (
    <SpellDragSource
      payload={filled ? { id: spellId, fromIndex: index } : null}
      className={`spell-slot${filled ? '' : ' empty'}`}
      dropId={String(index)}
      selected={selected}
      hoverSpell={spell}
      onSelect={onSelect}
      onDropSpell={onDropSpell}
      onDoubleClick={filled ? onClear : undefined}
    >
      {filled ? (
        <ItemIcon icon={spell?.icon} alt="" size={40} folder="spells" />
      ) : (
        <span className="spell-slot-index">{(index % SLOTS_PER_RADIAL) + 1}</span>
      )}
    </SpellDragSource>
  )
}

type WheelProps = {
  radial: number
  slots: string[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  onDropSpell: (payload: SpellDragPayload, dropId: string) => void
  onClear: (index: number) => void
}

export function SpellWheel({ radial, slots, selectedIndex, onSelect, onDropSpell, onClear }: WheelProps) {
  const start = radial * SLOTS_PER_RADIAL
  const filled = slots.slice(start, start + SLOTS_PER_RADIAL).filter(Boolean).length

  return (
    <div className="spell-wheel-card">
      <div className="spell-wheel" aria-label={`Spellbook ${RADIAL_LABELS[radial]}`}>
        {Array.from({ length: SLOTS_PER_RADIAL }, (_, offset) => {
          const index = start + offset
          const angle = (offset / SLOTS_PER_RADIAL) * Math.PI * 2 - Math.PI / 2
          return (
            <div
              key={index}
              className="spell-wheel-pos"
              style={{
                left: `calc(50% + ${Math.cos(angle) * 39}%)`,
                top: `calc(50% + ${Math.sin(angle) * 39}%)`,
              }}
            >
              <SpellSlot
                index={index}
                spellId={slots[index] ?? ''}
                selected={selectedIndex === index}
                onSelect={() => onSelect(index)}
                onDropSpell={onDropSpell}
                onClear={() => onClear(index)}
              />
            </div>
          )
        })}
        <div className="spell-wheel-hub">
          <strong>{RADIAL_LABELS[radial]}</strong>
          <span>{filled}/{SLOTS_PER_RADIAL}</span>
        </div>
      </div>
    </div>
  )
}

type BookItemProps = {
  spell: CatalogSpell
  unlocked: boolean
  equipped: boolean
  isNew?: boolean
  onDropSpell: (payload: SpellDragPayload, dropId: string) => void
  onPick: () => void
  onToggleLock: () => void
}

export function SpellBookItem({
  spell,
  unlocked,
  equipped,
  isNew,
  onDropSpell,
  onPick,
  onToggleLock,
}: BookItemProps) {
  return (
    <SpellDragSource
      payload={unlocked ? { id: spell.id, fromIndex: null } : null}
      className={`spell-book-item${unlocked ? ' on' : ' locked'}${equipped ? ' equipped' : ''}${isNew ? ' is-new' : ''}`}
      dropId="sidebar"
      hoverSpell={spell}
      onSelect={onPick}
      onDropSpell={onDropSpell}
      asButton={false}
    >
      <div className="spell-book-main">
        <ItemIcon icon={spell.icon} alt="" size={36} folder="spells" />
        <span className="spell-book-copy">
          <strong>{spell.name}</strong>
          <span className="tiny">
            {spell.level != null ? `Lv ${spell.level}` : '—'}
            {equipped ? ' · On wheel' : ''}
          </span>
        </span>
      </div>
      <button
        type="button"
        className={unlocked ? 'spell-lock open' : 'spell-lock'}
        title={unlocked ? 'Lock spell' : 'Unlock spell'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleLock()
        }}
      >
        <LockIcon open={unlocked} />
      </button>
    </SpellDragSource>
  )
}
