import { useEffect, useState, type ReactNode } from 'react'
import { buildings, getItem, items } from '../../catalog'
import { leafClass } from '../../saves/spud/world'
import type { WorldDocument } from '../../saves/spud/world'
import { parseWorld } from '../../saves/spud/world'

export const ROW_CAP = 200

export function commitWorld(doc: WorldDocument, bytes: Uint8Array, onChange: (doc: WorldDocument) => void) {
  if (bytes === doc.bytes) return
  onChange(parseWorld(bytes))
}

export function DraftText({
  value,
  onCommit,
  readOnly = false,
}: {
  value: string
  onCommit?: (value: string) => void
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      value={draft}
      readOnly={readOnly}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!readOnly && draft !== value) onCommit?.(draft)
      }}
    />
  )
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(digits)))
}

export function DraftNumber({
  value,
  onCommit,
  step = 1,
}: {
  value: number
  onCommit: (value: number) => void
  step?: number
}) {
  const shown = formatNumber(value, step < 1 ? 3 : 0)
  const [draft, setDraft] = useState(shown)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    setDraft(shown)
    setTouched(false)
  }, [shown])
  return (
    <input
      type='number'
      step={step}
      value={draft}
      onChange={(event) => {
        setTouched(true)
        setDraft(event.target.value)
      }}
      onBlur={() => {
        if (!touched) return
        const next = Number(draft)
        if (Number.isFinite(next) && next !== value) onCommit(next)
      }}
    />
  )
}

export function WorldPage({
  title,
  meta,
  hint,
  toolbar,
  children,
}: {
  title: string
  meta?: string
  hint?: string
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <section className='panel world-page'>
      <div className='panel-head'>
        <h2>{title}</h2>
        {meta ? <span className='muted'>{meta}</span> : null}
      </div>
      {hint ? <p className='hint'>{hint}</p> : null}
      {toolbar}
      {children}
    </section>
  )
}

export function LazyGroup({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string
  meta?: string
  defaultOpen?: boolean
  children: () => ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className='collapse'
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next !== open) setOpen(next)
      }}
    >
      <summary className='collapse-head'>
        <span className='collapse-copy'>
          <span className='collapse-title-row'>
            <h3>{title}</h3>
            {meta ? <span className='muted'>{meta}</span> : null}
          </span>
        </span>
        <svg className='collapse-arrow' viewBox='0 0 12 12' width='14' height='14' aria-hidden='true'>
          <path d='M2 4l4 4 4-4' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
      </summary>
      <div className='collapse-body'>{open ? children() : null}</div>
    </details>
  )
}

export function prettyLeaf(className: string): string {
  return leafClass(className)
    .replace(/^BP_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function actorGroup(className: string): string {
  const leaf = leafClass(className)
  const parts = leaf.split('_')
  if (parts[0] === 'BP' && parts[1]) return parts.length > 2 ? `${parts[0]}_${parts[1]}` : leaf
  return leaf
}

const ORE_ITEMS: Record<string, string> = {
  adamantite: 'Adamantite Ore',
  blurite: 'Blurite Ore',
  bluerite: 'Blurite Ore',
  coal: 'Coal',
  copper: 'Copper Ore',
  gold: 'Gold Ore',
  iron: 'Iron Ore',
  luminite: 'Luminite Ore',
  mithril: 'Mithril Ore',
  runite: 'Runite Ore',
  silver: 'Silver Ore',
  tin: 'Tin Ore',
  clay: 'Clay',
  gypsum: 'Gypsum',
  limestone: 'Limestone',
  sandstone: 'Sandstone',
  stone: 'Stone',
}

const ROCK_ITEMS: Record<string, string> = {
  granite: 'Granite',
  luminite: 'Luminite Ore',
  runeessence: 'Rune Essence',
  geyserruneessence: 'Rune Essence',
  dragontooth: 'Dragon Tooth',
}

const TREE_ITEMS: Record<string, string> = {
  ash: 'Ash Logs',
  oak: 'Oak Logs',
  maple: 'Maple Logs',
  willow: 'Willow Logs',
  yew: 'Yew Logs',
}

const ROCK_MATERIALS = new Set(['clay', 'gypsum', 'limestone', 'sandstone', 'stone', 'granite'])

export type ResourceFace = {
  name: string
  kind: string
  icon?: string
  size?: string
}

let itemsByName: Map<string, (typeof items)[number]> | null = null
let itemsByNameCount = -1

function catalogItem(name: string) {
  if (!itemsByName || itemsByNameCount !== items.length) {
    itemsByName = new Map(items.map((item) => [item.name.toLowerCase(), item]))
    itemsByNameCount = items.length
  }
  return itemsByName.get(name.toLowerCase())
}

function face(name: string, kind: string, itemName?: string, size?: string): ResourceFace {
  return { name, kind, icon: itemName ? catalogItem(itemName)?.icon : undefined, size }
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function describeResource(className: string): ResourceFace {
  const leaf = leafClass(className).replace(/_C$/, '')

  const tree = /^BP_(?:[A-Z]{2}_)?Tree_([A-Za-z]+)/.exec(leaf) ?? (/^BP_YewTree/i.test(leaf) ? ['', 'Yew'] : null)
  if (tree) {
    const wood = tree[1].toLowerCase()
    return face(`${words(tree[1])} tree`, 'tree', TREE_ITEMS[wood])
  }
  if (/BlightwoodRoot/i.test(leaf)) return face('Blightwood', 'root', 'Blightwood')
  const herb = /^BP_ThornyRoot_([A-Za-z]+)/.exec(leaf)
  if (herb) return face(words(herb[1]), 'root', words(herb[1]))
  if (/RuneEssenceGeyser/i.test(leaf)) return face('Rune Essence', 'ore', 'Rune Essence')

  const ore = /^BP_OreNode_([A-Za-z]+?)(?:_(Large|Medium|Small)_[A-Z]\d)?$/.exec(leaf)
  if (ore) {
    const material = ore[1].toLowerCase()
    const size = ore[2]
    const itemName = ORE_ITEMS[material] ?? words(ore[1])
    const kind = ROCK_MATERIALS.has(material) ? 'rock' : 'ore'
    return face(itemName, kind, itemName, size)
  }

  const rock = /^BP_MiningRock_(.+?)(?:_Static_[A-Za-z])?$/.exec(leaf)
  if (rock) {
    const key = rock[1].replace(/_/g, '').toLowerCase()
    const itemName = ROCK_ITEMS[key]
    const kind = key.includes('rune') || key === 'luminite' ? 'ore' : 'rock'
    return face(itemName ?? words(rock[1]), kind, itemName)
  }

  return face(prettyLeaf(className), resourceKind(className))
}

export function resourceKind(className: string): string {
  const leaf = leafClass(className)
  if (/Tree|Blightwood/i.test(leaf)) return 'tree'
  if (/Root/i.test(leaf)) return 'root'
  if (/Clay|Sandstone|Granite|Limestone|Gypsum|SoulStone|Avisk|Dragon_Tooth/i.test(leaf)) return 'rock'
  if (/Ore|Rune|Luminite|Coal/i.test(leaf)) return 'ore'
  if (/Rock/i.test(leaf)) return 'rock'
  if (/Foliage/i.test(leaf)) return 'foliage'
  return 'other'
}

export function itemForClass(className: string, persistenceId?: string | null) {
  if (persistenceId) {
    const direct = getItem(persistenceId)
    if (direct) return direct
  }
  const tokens = leafClass(className).split('_').reverse()
  for (const token of tokens) {
    if (token.length < 3 || /^(BP|Static|Large|Medium|Small|World|Prefab)$/i.test(token)) continue
    const hit = items.find((item) => item.name.toLowerCase() === token.toLowerCase())
    if (hit) return hit
  }
  return undefined
}

export function buildingForClass(className: string) {
  const tokens = leafClass(className).replace(/^BP_/, '').split('_').reverse()
  for (const token of tokens) {
    if (token.length < 3) continue
    const hit = buildings.find((entry) => entry.name.toLowerCase() === token.toLowerCase())
    if (hit) return hit
  }
  return undefined
}

export function levelTitle(level: string): string {
  const cell = /^RSACell\d+_X(-?\d+)_Y(-?\d+)$/.exec(level)
  if (cell) return `Cell ${cell[1]}, ${cell[2]}`
  if (/^L_World$/i.test(level)) return 'World'
  return level.replace(/_/g, ' ')
}

export function resourceGroupTitle(level: string, names: string[]): string {
  if (!/^[A-Z0-9]{20,}$/.test(level)) return levelTitle(level)
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
  return top.map(([name]) => name).join(', ') || 'Area'
}

export function shortName(value: string): string {
  const leaf = value.split('/').pop() ?? value
  const dotted = leaf.split('.')
  return dotted[dotted.length - 1] || leaf
}
