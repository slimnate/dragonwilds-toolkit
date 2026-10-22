import { useMemo, useState } from 'react'
import { ItemIcon } from '../components/ItemIcon'
import { getJournalEntry, journalEntries } from '../catalog'
import { asObject, getGameplayRoot, getStringArray } from '../saves/access'
import type { CatalogJournalEntry, JsonObject } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

type Tab = 'World' | 'Recipes' | 'Knowledge'
type Filter = 'all' | 'unlocked' | 'locked' | 'unread'

const TABS: Tab[] = ['World', 'Recipes', 'Knowledge']
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unlocked', label: 'Unlocked' },
  { id: 'locked', label: 'Locked' },
  { id: 'unread', label: 'Unread' },
]

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function JournalSection({ save, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('World')
  const [filter, setFilter] = useState<Filter>('unlocked')
  const [subcategory, setSubcategory] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const journal = asObject(getGameplayRoot(save).Journal) ?? {}
  const unlocked = getStringArray(journal.UnlockedEntries)
  const unread = getStringArray(journal.UnreadEntries)
  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked])
  const unreadSet = useMemo(() => new Set(unread), [unread])

  const extras = unlocked.filter((id) => !getJournalEntry(id))
  const selected = (selectedId && getJournalEntry(selectedId)) || null

  const tabEntries = useMemo(
    () => journalEntries.filter((entry) => entry.category === tab && !entry.deprecated),
    [tab],
  )

  const subcategories = useMemo(() => {
    const names = unique(tabEntries.map((entry) => entry.subcategory || 'Other'))
    names.sort()
    return names
  }, [tabEntries])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tabEntries.filter((entry) => {
      if (subcategory !== 'all' && (entry.subcategory || 'Other') !== subcategory) return false
      const isUnlocked = unlockedSet.has(entry.id)
      if (filter === 'unlocked' && !isUnlocked) return false
      if (filter === 'locked' && isUnlocked) return false
      if (filter === 'unread' && !unreadSet.has(entry.id)) return false
      if (!q) return true
      const hay = `${entry.name} ${entry.subcategory ?? ''} ${entry.group ?? ''} ${entry.description ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [filter, query, subcategory, tabEntries, unreadSet, unlockedSet])

  const groups = useMemo(() => {
    const byGroup = new Map<string, CatalogJournalEntry[]>()
    for (const entry of visible) {
      const key = entry.group || entry.subcategory || 'Entries'
      const list = byGroup.get(key) ?? []
      list.push(entry)
      byGroup.set(key, list)
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  function patch(mutator: (block: JsonObject) => void) {
    const next = structuredClone(save)
    const block = asObject(getGameplayRoot(next).Journal) ?? {}
    mutator(block)
    getGameplayRoot(next).Journal = block
    onChange(next)
  }

  function setUnlocked(id: string, on: boolean) {
    if (on === unlockedSet.has(id)) return
    patch((block) => {
      if (on) {
        block.UnlockedEntries = unique([...unlocked, id])
        if (!unreadSet.has(id)) block.UnreadEntries = unique([...unread, id])
        return
      }
      block.UnlockedEntries = unlocked.filter((entry) => entry !== id)
      block.UnreadEntries = unread.filter((entry) => entry !== id)
    })
  }

  function setUnread(id: string, on: boolean) {
    if (!unlockedSet.has(id) && on) {
      setUnlocked(id, true)
      return
    }
    if (on === unreadSet.has(id)) return
    patch((block) => {
      block.UnreadEntries = on
        ? unique([...unread, id])
        : unread.filter((entry) => entry !== id)
    })
  }

  function unlockVisible() {
    const ids = visible.map((entry) => entry.id)
    patch((block) => {
      block.UnlockedEntries = unique([...unlocked, ...ids])
      block.UnreadEntries = unique([...unread, ...ids.filter((id) => !unlockedSet.has(id))])
    })
  }

  function markVisibleRead() {
    const ids = new Set(visible.map((entry) => entry.id))
    patch((block) => {
      block.UnreadEntries = unread.filter((id) => !ids.has(id))
    })
  }

  function unlockAll() {
    const ids = journalEntries.filter((entry) => !entry.deprecated).map((entry) => entry.id)
    patch((block) => {
      const added = ids.filter((id) => !unlockedSet.has(id))
      block.UnlockedEntries = unique([...unlocked, ...ids])
      block.UnreadEntries = unique([...unread, ...added])
    })
  }

  function tabUnread(name: Tab) {
    return journalEntries.filter((entry) => entry.category === name && unreadSet.has(entry.id)).length
  }

  const unlockedInTab = tabEntries.filter((entry) => unlockedSet.has(entry.id)).length

  return (
    <section className="panel journal-page">
      <div className="journal-head">
        <div className="panel-head">
          <h2>Journal</h2>
          <span className="muted">{unlocked.length} / {journalEntries.filter((entry) => !entry.deprecated).length} unlocked</span>
        </div>
        <p className="hint">
          World, Recipes, and Knowledge pages from the in-game journal. Unlock a page or mark it unread the way the game does.
        </p>
        <div className="progress-toolbar">
          <input
            placeholder="Search journal"
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
        <div className="journal-tabrow">
          <div className="journal-tablist" role="tablist" aria-label="Journal category">
            {TABS.map((name) => {
              const count = tabUnread(name)
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  className="journal-tab"
                  onClick={() => {
                    setTab(name)
                    setSubcategory('all')
                    setSelectedId(null)
                  }}
                >
                  {name}
                  {count > 0 ? <span className="journal-unread-count">{count}</span> : null}
                </button>
              )
            })}
          </div>
          <div className="journal-actions">
            <span className="tiny muted">{unlockedInTab} / {tabEntries.length} in {tab}</span>
            <button type="button" onClick={unlockVisible}>Unlock visible</button>
            <button type="button" onClick={markVisibleRead}>Mark visible read</button>
            <button type="button" onClick={unlockAll}>Unlock all</button>
          </div>
        </div>
      </div>

      <div className="journal-body">
        <div className="journal-list-pane">
          <div className="journal-tablist journal-subtabs" role="tablist" aria-label="Journal subcategory">
            <button
              type="button"
              role="tab"
              aria-selected={subcategory === 'all'}
              className="journal-tab"
              onClick={() => setSubcategory('all')}
            >
              All
            </button>
            {subcategories.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={subcategory === name}
                className="journal-tab"
                onClick={() => setSubcategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="journal-list">
            {groups.map(([group, entries]) => (
              <section key={group} className="journal-group">
                <h4>{group}</h4>
                {entries.map((entry) => {
                  const isUnlocked = unlockedSet.has(entry.id)
                  const isUnread = unreadSet.has(entry.id)
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`journal-row${selectedId === entry.id ? ' selected' : ''}${isUnlocked ? ' on' : ' locked'}${isUnread ? ' unread' : ''}`}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <ItemIcon icon={entry.icon} alt="" size={36} folder="journal" />
                      <span className="journal-row-copy">
                        <strong>{entry.name}</strong>
                        <span className="tiny">{entry.subcategory}{entry.location ? ` · ${entry.location}` : ''}</span>
                      </span>
                      {isUnread ? <span className="journal-dot" title="Unread" /> : null}
                    </button>
                  )
                })}
              </section>
            ))}
            {visible.length === 0 ? <p className="muted tiny">Nothing matches this filter.</p> : null}
          </div>
        </div>

        <article className="journal-detail">
          {selected ? (
            <>
              <div className="journal-detail-head">
                <ItemIcon icon={selected.icon} alt="" size={72} folder="journal" />
                <div>
                  <p className="tiny muted">{selected.category} · {selected.subcategory}{selected.group ? ` · ${selected.group}` : ''}</p>
                  <h3>{selected.name}</h3>
                  {selected.location ? <p className="tiny">{selected.location}</p> : null}
                </div>
              </div>
              <div className="journal-detail-flags">
                <button
                  type="button"
                  role="switch"
                  aria-checked={unlockedSet.has(selected.id)}
                  className={unlockedSet.has(selected.id) ? 'switch on' : 'switch'}
                  onClick={() => setUnlocked(selected.id, !unlockedSet.has(selected.id))}
                >
                  <span className="switch-label">Unlocked</span>
                  <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={unreadSet.has(selected.id)}
                  className={unreadSet.has(selected.id) ? 'switch on' : 'switch'}
                  disabled={!unlockedSet.has(selected.id) && !unreadSet.has(selected.id)}
                  onClick={() => setUnread(selected.id, !unreadSet.has(selected.id))}
                >
                  <span className="switch-label">Unread</span>
                  <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
                </button>
              </div>
              {selected.description ? (
                <div className="journal-detail-body">
                  {selected.description.split('\n\n').map((page, index) => (
                    <p key={index}>{page}</p>
                  ))}
                </div>
              ) : (
                <p className="muted">No journal text extracted for this page.</p>
              )}
            </>
          ) : (
            <p className="muted">Select an entry to read it.</p>
          )}
        </article>
      </div>

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
    </section>
  )
}
