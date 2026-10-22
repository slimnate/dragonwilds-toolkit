import { useMemo, useState } from 'react'
import {
  SpellBookItem,
  SpellWheel,
} from '../components/SpellWheel'
import { SPELL_SLOT_COUNT, type SpellDragPayload } from '../saves/spellSlots'
import { catalogSpells, getSpell } from '../catalog'
import { asObject, getGameplayRoot, getStringArray } from '../saves/access'
import type { CatalogSpell, JsonObject } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

type Filter = 'unlocked' | 'locked' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'unlocked', label: 'Unlocked' },
  { id: 'locked', label: 'Locked' },
  { id: 'all', label: 'All' },
]

const SKILL_ORDER = [
  'Attack',
  'Ranged',
  'Magic',
  'Defence',
  'Agility',
  'Mining',
  'Woodcutting',
  'Artisan',
  'Construction',
  'Cooking',
  'Farming',
  'Fishing',
  'Runecrafting',
  'Herblore',
  'Thieving',
  'Placeholder',
]

function padSlots(values: string[]): string[] {
  const next = values.slice(0, SPELL_SLOT_COUNT)
  while (next.length < SPELL_SLOT_COUNT) next.push('')
  return next
}

export function SpellsSection({ save, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('unlocked')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const gameplay = getGameplayRoot(save)
  const spellcasting = asObject(gameplay.Spellcasting) ?? {}
  const progress = asObject(gameplay.Progress) ?? {}
  const selected = padSlots(
    Array.isArray(spellcasting.SelectedSpells)
      ? spellcasting.SelectedSpells.map((entry) => (typeof entry === 'string' ? entry : ''))
      : [],
  )
  const unlocked = getStringArray(progress.SpellsUnlocked)
  const newIds = getStringArray(progress.SpellsNew)
  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked])
  const newSet = useMemo(() => new Set(newIds), [newIds])

  const unknownEquipped = [...new Set(selected.filter((id) => id && !getSpell(id)))]
  const extras = unlocked.filter((id) => !catalogSpells.some((spell) => spell.id === id))

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const bySkill = new Map<string, CatalogSpell[]>()
    for (const spell of catalogSpells) {
      const isUnlocked = unlockedSet.has(spell.id)
      if (filter === 'unlocked' && !isUnlocked) continue
      if (filter === 'locked' && isUnlocked) continue
      if (q) {
        const hay = `${spell.name} ${spell.skill ?? ''} ${spell.description ?? ''} ${spell.id}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      const skill = spell.skill || 'Other'
      const list = bySkill.get(skill) ?? []
      list.push(spell)
      bySkill.set(skill, list)
    }
    const skills = [
      ...SKILL_ORDER.filter((skill) => bySkill.has(skill)),
      ...[...bySkill.keys()].filter((skill) => !SKILL_ORDER.includes(skill)).sort(),
    ]
    return skills.map((skill) => ({ skill, spells: bySkill.get(skill) ?? [] }))
  }, [filter, query, unlockedSet])

  function writeSlots(list: string[]) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).Spellcasting) ?? {}
    block.SelectedSpells = padSlots(list)
    getGameplayRoot(next).Spellcasting = block
    onChange(next)
  }

  function patchProgress(mutator: (block: JsonObject) => void) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).Progress) ?? {}
    mutator(block)
    getGameplayRoot(next).Progress = block
    onChange(next)
  }

  function setUnlocked(id: string, on: boolean) {
    if (on === unlockedSet.has(id)) return
    patchProgress((block) => {
      if (on) {
        block.SpellsUnlocked = [...unlocked, id]
        if (!newSet.has(id)) block.SpellsNew = [...newIds, id]
        return
      }
      block.SpellsUnlocked = unlocked.filter((entry) => entry !== id)
      block.SpellsNew = newIds.filter((entry) => entry !== id)
    })
  }

  function assign(index: number, id: string) {
    const list = [...selected]
    list[index] = id
    writeSlots(list)
    setSelectedIndex(index)
  }

  function clearAt(index: number) {
    assign(index, '')
  }

  function handleDrop(payload: SpellDragPayload, dropId: string) {
    if (dropId === 'sidebar') {
      if (payload.fromIndex != null) clearAt(payload.fromIndex)
      return
    }
    const toIndex = Number(dropId)
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= SPELL_SLOT_COUNT) return
    if (payload.fromIndex === toIndex) return
    const list = [...selected]
    if (payload.fromIndex == null) {
      list[toIndex] = payload.id
    } else {
      const fromId = list[payload.fromIndex]
      list[payload.fromIndex] = list[toIndex]
      list[toIndex] = fromId || payload.id
    }
    writeSlots(list)
    setSelectedIndex(toIndex)
  }

  function pickFromBook(spell: CatalogSpell) {
    if (!unlockedSet.has(spell.id)) return
    if (selectedIndex != null) {
      assign(selectedIndex, spell.id)
      return
    }
    const empty = selected.findIndex((id) => !id)
    if (empty >= 0) assign(empty, spell.id)
  }

  return (
    <section className="panel spells-page">
      <div className="spells-stage">
        <div className="panel-head">
          <h2>Spellbook</h2>
        </div>
        <p className="hint">
          Drag unlocked spells onto a wheel, swap slots, or drop a slot on the list to unequip.
          Double-click a slot to clear it.
        </p>
        <div className="spell-wheels">
          {Array.from({ length: 4 }, (_, radial) => (
            <SpellWheel
              key={radial}
              radial={radial}
              slots={selected}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              onDropSpell={handleDrop}
              onClear={clearAt}
            />
          ))}
        </div>
      </div>

      <aside className="spell-book" data-spell-drop="sidebar">
        <h3>All spells</h3>
        <input
          placeholder="Search spells"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="chip-row">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? 'chip on' : 'chip'}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="tiny muted">{unlocked.length} unlocked · {catalogSpells.length} in catalog</p>
        <div className="spell-book-list">
          {groups.map((group) => (
            <section key={group.skill} className="spell-skill-group">
              <h4>{group.skill}</h4>
              {group.spells.map((spell) => (
                <SpellBookItem
                  key={spell.id}
                  spell={spell}
                  unlocked={unlockedSet.has(spell.id)}
                  equipped={selected.includes(spell.id)}
                  isNew={newSet.has(spell.id)}
                  onDropSpell={handleDrop}
                  onPick={() => pickFromBook(spell)}
                  onToggleLock={() => setUnlocked(spell.id, !unlockedSet.has(spell.id))}
                />
              ))}
            </section>
          ))}
          {groups.length === 0 ? <p className="muted tiny">Nothing matches this filter.</p> : null}
        </div>
        {unknownEquipped.length > 0 || extras.length > 0 ? (
          <details className="progress-unknown">
            <summary>{unknownEquipped.length + extras.length} unknown ids</summary>
            <ul className="id-values">
              {unknownEquipped.map((id) => (
                <li key={`eq-${id}`}><span>{id}</span> <span className="tiny">on wheel</span></li>
              ))}
              {extras.map((id) => (
                <li key={`un-${id}`}>
                  <span>{id}</span>
                  <button type="button" className="linkish" onClick={() => setUnlocked(id, false)}>Remove</button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </section>
  )
}
