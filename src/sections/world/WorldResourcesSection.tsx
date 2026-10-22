import { useMemo, useState } from 'react'
import { ItemIcon } from '../../components/ItemIcon'
import { withComponentNumber } from '../../saves/spud/edit'
import { resourceState } from '../../saves/spud/view'
import { pageFor, parseWorld, type WorldDocument } from '../../saves/spud/world'
import { LazyGroup, ROW_CAP, WorldPage, describeResource, formatNumber, resourceGroupTitle } from './shared'

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

type Filter = 'all' | 'depleted' | 'respawning' | 'ore' | 'rock' | 'tree' | 'other'

const FILTERS: { id: Filter, label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'depleted', label: 'Depleted' },
  { id: 'respawning', label: 'Respawning' },
  { id: 'ore', label: 'Ore' },
  { id: 'rock', label: 'Rock' },
  { id: 'tree', label: 'Tree' },
  { id: 'other', label: 'Other' },
]

export function WorldResourcesSection({ doc, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [amount, setAmount] = useState(1)
  const rows = useMemo(() => doc.objects.filter((object) => pageFor(object) === 'resources').map((object) => {
    const state = resourceState(doc, object)
    const face = describeResource(object.className)
    const depleted = object.destroyed || state.available === 0 || (state.health !== null && state.health <= 0)
    return {
      object,
      kind: face.kind,
      ...state,
      depleted,
      respawning: state.timer !== null && state.timer !== 0,
      label: face.name,
      icon: face.icon,
      size: face.size,
    }
  }), [doc])
  const needle = query.trim().toLowerCase()
  const shown = rows.filter((row) => {
    if (filter === 'depleted' && !row.depleted) return false
    if (filter === 'respawning' && !row.respawning) return false
    if (filter !== 'all' && filter !== 'depleted' && filter !== 'respawning' && row.kind !== filter) return false
    if (!needle) return true
    return `${row.label} ${row.object.name} ${row.object.level}`.toLowerCase().includes(needle)
  })
  const groups = new Map<string, typeof shown>()
  for (const row of shown) {
    const key = row.object.level || 'world'
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  const ordered = [...groups.entries()].sort((a, b) => Number(a[0].startsWith('RSACell')) - Number(b[0].startsWith('RSACell')) || a[0].localeCompare(b[0]))

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))
  }

  function bulk(edit: (current: WorldDocument, id: string) => Uint8Array) {
    let current = doc
    for (const id of selected) {
      const bytes = edit(current, id)
      if (bytes !== current.bytes) current = parseWorld(bytes)
    }
    if (current !== doc) onChange(current)
  }

  return (
    <WorldPage
      title='Resources'
      meta={`${shown.length} of ${rows.length}`}
      hint='Nodes stay grouped by level. Cell groups stay closed until you open them.'
      toolbar={(
        <>
          <div className='progress-toolbar world-toolbar'>
            <input placeholder='Search resources' value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className='chip-row'>
              {FILTERS.map((option) => (
                <button key={option.id} type='button' className={filter === option.id ? 'chip on' : 'chip'} onClick={() => setFilter(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className='journal-actions'>
            <label className='world-amount'>
              Refill amount
              <input type='number' value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
            </label>
            <button type='button' disabled={selected.length === 0} onClick={() => bulk((current, id) => withComponentNumber(current, id, 'RespawnComponent', 1, 'i32', amount))}>
              Refill selected ({selected.length})
            </button>
            <button type='button' disabled={selected.length === 0} onClick={() => bulk((current, id) => withComponentNumber(current, id, 'RespawnComponent', 2, 'i64', 0))}>
              Clear respawn timers
            </button>
          </div>
        </>
      )}
    >
      <div className='world-groups'>
        {ordered.map(([level, group]) => (
          <LazyGroup key={level} title={resourceGroupTitle(level, group.map((row) => row.label))} meta={`${group.length}`} defaultOpen={!level.startsWith('RSACell') && !/^[A-Z0-9]{20,}$/.test(level)}>
            {() => (
              <>
                <div className='world-card-grid'>
                  {group.slice(0, ROW_CAP).map((row) => {
                    const on = selected.includes(row.object.id)
                    return (
                      <article key={row.object.id} className={`world-card${on ? ' on' : ''}${row.depleted ? ' depleted' : ''}`}>
                        <label className='world-card-main'>
                          <input type='checkbox' checked={on} onChange={() => toggle(row.object.id)} />
                          <ItemIcon icon={row.icon} alt='' size={36} />
                          <span className='world-card-copy'>
                            <strong>{row.label}</strong>
                            <span className='tiny'>{row.size ?? row.kind}</span>
                          </span>
                        </label>
                        <div className='world-card-stats'>
                          {row.health !== null ? <span className='flag'>{formatNumber(row.health, 1)} hp</span> : null}
                          {row.available !== null ? <span className='flag'>{row.available} left</span> : null}
                          {row.timer !== null && row.timer !== 0 ? <span className='flag'>timer {row.timer}</span> : null}
                          {row.depleted ? <span className='flag on'>depleted</span> : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
                {group.length > ROW_CAP ? <p className='hint'>Showing {ROW_CAP} of {group.length} in this cell.</p> : null}
              </>
            )}
          </LazyGroup>
        ))}
      </div>
    </WorldPage>
  )
}
