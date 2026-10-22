import { useMemo, useState } from 'react'
import { Collapsible } from './Collapsible'
import { ItemIcon } from './ItemIcon'
import type { IconFolder } from '../catalog'

export type UnlockEntry = {
  id: string
  name: string
  icon?: string
  category?: string
}

type Filter = 'unlocked' | 'new' | 'locked' | 'all'

export type UnlockFlags = {
  unlocked: string[]
  newIds?: string[]
  favourites?: string[]
}

type Props = {
  title: string
  entries: UnlockEntry[]
  unlocked: string[]
  onChange: (next: UnlockFlags) => void
  newIds?: string[]
  favourites?: string[]
  iconFolder?: IconFolder
  resolveIcon?: (entry: UnlockEntry) => string | undefined
  description?: string
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'unlocked', label: 'Unlocked' },
  { id: 'new', label: 'New' },
  { id: 'locked', label: 'Locked' },
  { id: 'all', label: 'All' },
]

export function UnlockCatalog({
  title,
  entries,
  unlocked,
  onChange,
  newIds,
  favourites,
  iconFolder = 'icons',
  resolveIcon,
  description,
}: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('unlocked')
  const canMarkNew = newIds !== undefined
  const canFavourite = favourites !== undefined
  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked])
  const newSet = useMemo(() => new Set(newIds ?? []), [newIds])
  const favSet = useMemo(() => new Set(favourites ?? []), [favourites])
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  const extras = unlocked.filter((id) => !byId.has(id))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      const isUnlocked = unlockedSet.has(entry.id)
      if (filter === 'unlocked' && !isUnlocked) return false
      if (filter === 'locked' && isUnlocked) return false
      if (filter === 'new' && !newSet.has(entry.id)) return false
      if (!q) return true
      return entry.name.toLowerCase().includes(q)
        || entry.id.toLowerCase().includes(q)
        || (entry.category ?? '').toLowerCase().includes(q)
    })
  }, [entries, filter, newSet, query, unlockedSet])

  function emit(nextUnlocked: string[], nextNew = newIds, nextFav = favourites) {
    const next: UnlockFlags = { unlocked: nextUnlocked }
    if (canMarkNew) next.newIds = nextNew ?? []
    if (canFavourite) next.favourites = nextFav ?? []
    onChange(next)
  }

  function setUnlocked(id: string, on: boolean) {
    if (on === unlockedSet.has(id)) return
    if (on) {
      const nextNew = canMarkNew && !newSet.has(id) ? [...(newIds ?? []), id] : newIds
      emit([...unlocked, id], nextNew, favourites)
      return
    }
    emit(
      unlocked.filter((entry) => entry !== id),
      newIds?.filter((entry) => entry !== id),
      favourites?.filter((entry) => entry !== id),
    )
  }

  function toggleNew(id: string) {
    if (!canMarkNew) return
    if (newSet.has(id)) {
      emit(unlocked, (newIds ?? []).filter((entry) => entry !== id), favourites)
      return
    }
    const nextUnlocked = unlockedSet.has(id) ? unlocked : [...unlocked, id]
    emit(nextUnlocked, [...(newIds ?? []), id], favourites)
  }

  function toggleFavourite(id: string) {
    if (!canFavourite) return
    if (favSet.has(id)) emit(unlocked, newIds, (favourites ?? []).filter((entry) => entry !== id))
    else emit(unlocked, newIds, [...(favourites ?? []), id])
  }

  return (
    <Collapsible
      title={title}
      description={description}
      meta={`${unlocked.length} / ${entries.length}`}
    >
      <div className="progress-toolbar">
        <input
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="chip-row">
          {FILTERS.map((option) => (
            option.id === 'new' && !canMarkNew ? null : (
              <button
                key={option.id}
                type="button"
                className={filter === option.id ? 'chip on' : 'chip'}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            )
          ))}
        </div>
      </div>
      <div className="unlock-grid">
        {filtered.map((entry) => {
          const isUnlocked = unlockedSet.has(entry.id)
          const isNew = newSet.has(entry.id)
          const isFav = favSet.has(entry.id)
          return (
            <div
              key={entry.id}
              className={`unlock-card${isUnlocked ? ' on' : ''}${isNew ? ' is-new' : ''}`}
              title={entry.id}
            >
              <div className="unlock-main">
                <ItemIcon
                  icon={resolveIcon ? resolveIcon(entry) : entry.icon}
                  alt=""
                  size={40}
                  folder={iconFolder}
                />
                <span className="unlock-copy">
                  <strong>{entry.name}</strong>
                  {entry.category ? <span className="tiny">{entry.category}</span> : null}
                </span>
              </div>
              <span className="unlock-flags">
                <Switch
                  label="Unlocked"
                  checked={isUnlocked}
                  title={isUnlocked ? 'Lock' : 'Unlock'}
                  onToggle={() => setUnlocked(entry.id, !isUnlocked)}
                />
                {canMarkNew ? (
                  <Switch
                    label="New"
                    checked={isNew}
                    title="Unread / new badge"
                    onToggle={() => toggleNew(entry.id)}
                  />
                ) : null}
                {canFavourite ? (
                  <button
                    type="button"
                    className={isFav ? 'flag on' : 'flag'}
                    title="Favourite"
                    onClick={() => toggleFavourite(entry.id)}
                  >
                    ★
                  </button>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      {filtered.length === 0 ? <p className="muted tiny">Nothing matches this filter.</p> : null}
      {extras.length > 0 ? (
        <details className="progress-unknown">
          <summary>{extras.length} unknown ids</summary>
          <ul className="id-values">
            {extras.map((id) => (
              <li key={id}>
                <span>{id}</span>
                <button type="button" className="linkish" onClick={() => setUnlocked(id, false)}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Collapsible>
  )
}

function Switch({
  label,
  checked,
  title,
  onToggle,
}: {
  label: string
  checked: boolean
  title?: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={checked ? 'switch on' : 'switch'}
      title={title}
      onClick={onToggle}
    >
      <span className="switch-label">{label}</span>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  )
}
