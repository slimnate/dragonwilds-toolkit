import { useMemo, useState } from 'react'
import { Collapsible } from '../components/Collapsible'
import { ItemIcon } from '../components/ItemIcon'
import { getQuest, questLabel, quests } from '../catalog'
import { asObject, getGameplayRoot, getNumber, getString } from '../saves/access'
import { QUEST_STATES } from '../saves/lookups'
import type { CatalogQuest, JsonObject, JsonValue } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

type FilterId = 'all' | 'active' | 'completed' | 'not-started'

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'not-started', label: 'Not started' },
]

const KIND_LABEL: Record<string, string> = {
  main: 'Main',
  side: 'Side',
  task: 'Task',
}

const KIND_ICON: Record<string, string> = {
  main: 'T_FTUE_Notification_PrimaryQ_Icon.png',
  side: 'T_FTUE_Notification_SecondaryQ_Icon.png',
  task: 'T_FTUE_Notification_TertiaryQ_Icon.png',
}

export function QuestsSection({ save, onChange }: Props) {
  const [query, setQuery] = useState('')
  const questsBlock = asObject(getGameplayRoot(save).QuestProgress) ?? {}
  const list = Array.isArray(questsBlock.Quests) ? questsBlock.Quests.filter(isObject) : []
  const locations = Array.isArray(questsBlock.QuestLocations) ? questsBlock.QuestLocations.filter(isObject) : []
  const tracked = getString(questsBlock, 'QuestTracked')
  const [filter, setFilter] = useState<FilterId>('all')
  const byId = useMemo(() => {
    const map = new Map<string, { row: JsonObject; index: number }>()
    list.forEach((row, index) => {
      const id = getString(row, 'QuestId')
      if (id) map.set(id, { row, index })
    })
    return map
  }, [list])

  function patch(mutator: (block: JsonObject) => void) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).QuestProgress) ?? {}
    mutator(block)
    getGameplayRoot(next).QuestProgress = block
    onChange(next)
  }

  function patchQuest(index: number, updates: JsonObject) {
    patch((block) => {
      const copy = list.map((row) => ({ ...row }))
      copy[index] = { ...copy[index], ...updates }
      block.Quests = copy
    })
  }

  function setTracked(id: string) {
    patch((block) => {
      block.QuestTracked = id
    })
  }

  function addQuest(quest: CatalogQuest, state = 1) {
    patch((block) => {
      const existing = Array.isArray(block.Quests) ? block.Quests.filter(isObject) : []
      if (existing.some((row) => getString(row, 'QuestId') === quest.id)) return
      block.Quests = [
        ...existing,
        {
          QuestId: quest.id,
          QuestState: state,
          QuestObjective: quest.objectives[0]?.id ?? 'None',
          QuestBools: [],
          QuestInts: [],
        },
      ]
      if (state === 1 && !getString(block, 'QuestTracked')) {
        block.QuestTracked = quest.id
      }
    })
  }

  const needle = query.trim().toLowerCase()

  function matchesSearch(label: string, quest: CatalogQuest | undefined, extra = '') {
    if (!needle) return true
    const blob = [
      label,
      quest?.name,
      quest?.description,
      quest?.region,
      quest?.kind,
      extra,
      ...(quest?.objectives.map((objective) => `${objective.id} ${objective.text}`) ?? []),
    ].join(' ').toLowerCase()
    return blob.includes(needle)
  }

  const active: Array<{ row: JsonObject; index: number; quest?: CatalogQuest }> = []
  const completed: Array<{ row: JsonObject; index: number; quest?: CatalogQuest }> = []
  const ungiven: Array<{ row: JsonObject; index: number; quest?: CatalogQuest }> = []
  const unknown: Array<{ row: JsonObject; index: number }> = []

  for (const [index, row] of list.entries()) {
    const id = getString(row, 'QuestId')
    const quest = getQuest(id)
    const state = getNumber(row, 'QuestState')
    const label = quest?.name ?? id
    if (!matchesSearch(label, quest, id)) continue
    if (!quest && id) {
      unknown.push({ row, index })
      continue
    }
    if (state === 2) completed.push({ row, index, quest })
    else if (state === 1) active.push({ row, index, quest })
    else ungiven.push({ row, index, quest })
  }

  const missing = quests.filter((quest) => {
    if (byId.has(quest.id)) return false
    if (quest.hidden) return false
    return matchesSearch(quest.name, quest, quest.id)
  })
  const hiddenMissing = quests.filter((quest) => {
    if (!quest.hidden || byId.has(quest.id)) return false
    return matchesSearch(quest.name, quest, quest.id)
  })

  const showActive = filter === 'all' || filter === 'active'
  const showCompleted = filter === 'all' || filter === 'completed'
  const showNotStarted = filter === 'all' || filter === 'not-started'
  const trackedQuest = getQuest(tracked)
  const filteredLocations = locations.filter((loc) => {
    if (!needle) return true
    const id = getString(loc, 'QuestLocationId')
    return `${id} ${prettyLocation(id)}`.toLowerCase().includes(needle)
  })

  return (
    <section className="panel stack">
      <h2>Quests</h2>
      <div className="progress-toolbar">
        <input
          placeholder="Search quests"
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
      </div>

      <div className="quest-tracked-bar">
        <label>
          Tracked
          <select
            value={tracked}
            onChange={(event) => setTracked(event.target.value)}
          >
            <option value="">None</option>
            {list
              .filter((row) => getNumber(row, 'QuestState') === 1)
              .map((row) => {
                const id = getString(row, 'QuestId')
                return (
                  <option key={id} value={id}>
                    {questLabel(id) || id}
                  </option>
                )
              })}
          </select>
        </label>
        {tracked ? (
          <p className="muted quest-tracked-name">
            {trackedQuest?.kind && KIND_ICON[trackedQuest.kind] ? (
              <ItemIcon
                icon={KIND_ICON[trackedQuest.kind]}
                folder="hud"
                alt={KIND_LABEL[trackedQuest.kind] ?? trackedQuest.kind}
                size={22}
                className="quest-kind-icon"
              />
            ) : null}
            {trackedQuest?.name ?? tracked}
          </p>
        ) : null}
      </div>

      {showActive ? (
        <Collapsible
          title="Active"
          description="Quests currently in the log (Given)."
          meta={`${active.length}`}
        >
          {active.length === 0 ? <p className="muted">No active quests.</p> : null}
          <div className="quest-list">
            {active.map((entry) => (
              <QuestCard
                key={entry.index}
                row={entry.row}
                quest={entry.quest}
                tracked={tracked === getString(entry.row, 'QuestId')}
                onPatch={(updates) => patchQuest(entry.index, updates)}
                onTrack={() => {
                  const id = getString(entry.row, 'QuestId')
                  setTracked(tracked === id ? '' : id)
                }}
              />
            ))}
          </div>
        </Collapsible>
      ) : null}

      {showCompleted ? (
        <Collapsible
          title="Completed"
          description="Quests marked complete on this character."
          meta={`${completed.length}`}
        >
          {completed.length === 0 ? <p className="muted">No completed quests.</p> : null}
          <div className="quest-list">
            {completed.map((entry) => (
              <QuestCard
                key={entry.index}
                row={entry.row}
                quest={entry.quest}
                tracked={false}
                onPatch={(updates) => patchQuest(entry.index, updates)}
              />
            ))}
          </div>
        </Collapsible>
      ) : null}

      {showNotStarted ? (
        <Collapsible
          title="Not started"
          description="Ungiven quests on the save, plus catalog quests this character has never received."
          meta={`${ungiven.length + missing.length}`}
        >
          {ungiven.length === 0 && missing.length === 0 ? (
            <p className="muted">Nothing left to start.</p>
          ) : null}
          <div className="quest-list">
            {ungiven.map((entry) => (
              <QuestCard
                key={entry.index}
                row={entry.row}
                quest={entry.quest}
                tracked={false}
                onPatch={(updates) => patchQuest(entry.index, updates)}
              />
            ))}
            {missing.map((quest) => (
              <article key={quest.id} className="quest-card">
                <QuestHeader quest={quest} fallbackId={quest.id} />
                {quest.description ? <p className="quest-desc">{quest.description}</p> : null}
                <div className="quest-actions">
                  <button type="button" onClick={() => addQuest(quest, 1)}>
                    Add to log
                  </button>
                </div>
              </article>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {hiddenMissing.length > 0 && filter === 'all' ? (
        <Collapsible
          title="Hidden"
          description="Tutorial leftovers and placeholder quests that stay out of the in-game list."
          meta={`${hiddenMissing.length}`}
        >
          <div className="quest-list">
            {hiddenMissing.map((quest) => (
              <article key={quest.id} className="quest-card">
                <QuestHeader quest={quest} fallbackId={quest.id} />
                {quest.description ? <p className="quest-desc">{quest.description}</p> : null}
                <div className="quest-actions">
                  <button type="button" onClick={() => addQuest(quest, 1)}>
                    Add to log
                  </button>
                </div>
              </article>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {unknown.length > 0 && filter === 'all' ? (
        <Collapsible
          title="Unknown IDs"
          description="Save rows that are not in the packed quest catalog."
          meta={`${unknown.length}`}
        >
          <div className="quest-list">
            {unknown.map((entry) => (
              <QuestCard
                key={entry.index}
                row={entry.row}
                tracked={tracked === getString(entry.row, 'QuestId')}
                onPatch={(updates) => patchQuest(entry.index, updates)}
                onTrack={() => {
                  const id = getString(entry.row, 'QuestId')
                  setTracked(tracked === id ? '' : id)
                }}
              />
            ))}
          </div>
        </Collapsible>
      ) : null}

      <Collapsible
        title="Locations"
        description="Visited quest location flags, including tutorial markers."
        meta={`${filteredLocations.length}`}
      >
        {filteredLocations.length === 0 ? <p className="muted">No location flags.</p> : null}
        <ul className="quest-locations">
          {filteredLocations.map((loc, index) => {
            const id = getString(loc, 'QuestLocationId')
            const on = loc.QuestLocationsState === true
            return (
              <li key={`${id}-${index}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  className={on ? 'switch on' : 'switch'}
                  onClick={() => patch((block) => {
                    const copy = locations.map((row) => ({ ...row }))
                    copy[index] = { ...copy[index], QuestLocationsState: !on }
                    block.QuestLocations = copy
                  })}
                >
                  <span className="switch-label">{prettyLocation(id)}</span>
                  <span className="switch-track" aria-hidden>
                    <span className="switch-thumb" />
                  </span>
                </button>
                <code className="quest-loc-id">{id}</code>
              </li>
            )
          })}
        </ul>
      </Collapsible>
    </section>
  )
}

function QuestCard({
  row,
  quest,
  tracked,
  onPatch,
  onTrack,
}: {
  row: JsonObject
  quest?: CatalogQuest
  tracked: boolean
  onPatch: (updates: JsonObject) => void
  onTrack?: () => void
}) {
  const id = getString(row, 'QuestId')
  const state = getNumber(row, 'QuestState')
  const objective = getString(row, 'QuestObjective')
  const bools = arrayOfObjects(row.QuestBools)
  const ints = arrayOfObjects(row.QuestInts)
  const options = objectiveOptions(quest, objective)

  return (
    <article className={tracked ? 'quest-card tracked' : 'quest-card'}>
      <QuestHeader quest={quest} fallbackId={id} />
      {quest?.description ? <p className="quest-desc">{quest.description}</p> : null}
      <div className="form-grid">
        <label>
          State
          <select
            value={state}
            onChange={(event) => {
              const nextState = Number(event.target.value)
              const updates: JsonObject = { QuestState: nextState }
              if (nextState === 1 && (!objective || objective === 'None') && quest?.objectives[0]) {
                updates.QuestObjective = quest.objectives[0].id
              }
              onPatch(updates)
            }}
          >
            {QUEST_STATES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          Objective
          <select
            value={objective}
            onChange={(event) => onPatch({ QuestObjective: event.target.value })}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.text}</option>
            ))}
          </select>
        </label>
      </div>
      {state === 1 && onTrack ? (
        <div className="quest-actions">
          <button
            type="button"
            role="switch"
            aria-checked={tracked}
            className={tracked ? 'switch on' : 'switch'}
            onClick={onTrack}
          >
            <span className="switch-label">Tracked</span>
            <span className="switch-track" aria-hidden>
              <span className="switch-thumb" />
            </span>
          </button>
        </div>
      ) : null}
      {bools.length > 0 || ints.length > 0 ? (
        <details className="quest-vars">
          <summary>Variables</summary>
          <BoolList
            title="Flags"
            rows={bools}
            nameKey="QuestVariableName"
            valueKey="QuestVariableValue"
            onChange={(rows) => onPatch({ QuestBools: rows })}
          />
          <IntList
            title="Counters"
            rows={ints}
            onChange={(rows) => onPatch({ QuestInts: rows })}
          />
        </details>
      ) : null}
    </article>
  )
}

function QuestHeader({ quest, fallbackId }: { quest?: CatalogQuest; fallbackId: string }) {
  const kind = quest?.kind
  const kindLabel = kind ? KIND_LABEL[kind] ?? kind : undefined
  const icon = kind ? KIND_ICON[kind] : undefined
  return (
    <div className="quest-head">
      {icon ? (
        <ItemIcon
          icon={icon}
          folder="hud"
          alt={kindLabel ?? ''}
          size={36}
          className="quest-kind-icon"
        />
      ) : null}
      <div>
        <h4 className="quest-title">{quest?.name ?? fallbackId}</h4>
        <p className="quest-meta">
          {[quest?.region, kindLabel].filter(Boolean).join(' · ') || fallbackId}
        </p>
      </div>
    </div>
  )
}

function objectiveOptions(quest: CatalogQuest | undefined, current: string) {
  const options = [{ id: 'None', text: 'None' }]
  const seen = new Set(['None'])
  for (const objective of quest?.objectives ?? []) {
    if (seen.has(objective.id)) continue
    seen.add(objective.id)
    options.push({
      id: objective.id,
      text: objective.text && objective.text !== objective.id
        ? objective.text
        : prettyLocation(objective.id),
    })
  }
  if (current && !seen.has(current)) {
    options.push({ id: current, text: prettyLocation(current) })
  }
  return options
}

function prettyLocation(id: string): string {
  if (!id) return id
  const spaced = id
    .replace(/_FTUE_/g, ' tutorial ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return spaced.replace(/\s+/g, ' ').trim()
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOfObjects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function BoolList({
  title,
  rows,
  nameKey,
  valueKey,
  onChange,
}: {
  title: string
  rows: JsonObject[]
  nameKey: string
  valueKey: string
  onChange: (rows: JsonObject[]) => void
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4>{title}</h4>
      {rows.map((row, index) => (
        <label key={index} className="check">
          <input
            type="checkbox"
            checked={row[valueKey] === true}
            onChange={(event) => {
              const copy = rows.map((entry) => ({ ...entry }))
              copy[index] = { ...copy[index], [valueKey]: event.target.checked }
              onChange(copy)
            }}
          />
          {prettyLocation(String(row[nameKey] ?? `flag ${index}`))}
        </label>
      ))}
    </div>
  )
}

function IntList({
  title,
  rows,
  onChange,
}: {
  title: string
  rows: JsonObject[]
  onChange: (rows: JsonObject[]) => void
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4>{title}</h4>
      {rows.map((row, index) => (
        <label key={index}>
          {prettyLocation(String(row.QuestVariableName ?? `int ${index}`))}
          <input
            type="number"
            value={typeof row.QuestVariableValue === 'number' ? row.QuestVariableValue : 0}
            onChange={(event) => {
              const copy = rows.map((entry) => ({ ...entry }))
              copy[index] = { ...copy[index], QuestVariableValue: Number(event.target.value) }
              onChange(copy)
            }}
          />
        </label>
      ))}
    </div>
  )
}
