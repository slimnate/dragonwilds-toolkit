import { useMemo, useState } from 'react'
import { ItemIcon } from '../../components/ItemIcon'
import { aiLabel, getJournalEntry, hookLabel, journalLabel } from '../../catalog'
import { withNameList } from '../../saves/spud/edit'
import { nameList } from '../../saves/spud/view'
import { leafClass, pageFor, type WorldDocument, type WorldObject } from '../../saves/spud/world'
import { WorldPage, commitWorld, levelTitle, prettyLeaf, shortName } from './shared'

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

const LISTS = [
  { key: 'DefeatedBossesInternalNames', title: 'Defeated bosses', label: (id: string) => aiLabel(id) || shortName(id) },
  { key: 'WorldHooksTriggered', title: 'World hooks', label: (id: string) => hookLabel(shortName(id)) || shortName(id) },
  { key: 'TaggedWorldProgressValues', title: 'Tagged progress', label: (id: string) => shortName(id) },
]

export function WorldProgressSection({ doc, onChange }: Props) {
  const [query, setQuery] = useState('')
  const progress = doc.objects.filter((object) => pageFor(object) === 'progress')
  const manager = progress.find((object) => leafClass(object.className) === 'WorldProgressManager')
  const lore = useMemo(() => progress.filter((object) => leafClass(object.className) === 'BP_LoreItem'), [progress])
  const needle = query.trim().toLowerCase()
  const shownLore = lore.filter((object) => {
    if (!needle) return true
    return `${object.name} ${object.level} ${journalTitle(object)}`.toLowerCase().includes(needle)
  })

  return (
    <WorldPage
      title='Progress'
      meta={manager ? `${lore.length} lore` : undefined}
      hint='Defeated bosses, world hooks, and tagged progress from the world progress manager. Lore rows are actors still placed in the world.'
      toolbar={(
        <div className='progress-toolbar world-toolbar'>
          <input placeholder='Search lore and progress' value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      )}
    >
      {manager ? LISTS.map((list) => {
        const values = nameList(doc, manager, list.key)
        if (!values) {
          const property = manager.properties.find((entry) => entry.name === list.key)
          const text = property?.value.kind === 'bytes' ? property.value.text : ''
          return text ? (
            <div key={list.key}>
              <h3>{list.title}</h3>
              <p className='muted'>{text}</p>
            </div>
          ) : null
        }
        return (
          <NameList
            key={list.key}
            title={list.title}
            values={values}
            label={list.label}
            onCommit={(next) => commitWorld(doc, withNameList(doc, manager.id, list.key, next), onChange)}
          />
        )
      }) : <p className='muted'>No world progress manager in this save.</p>}
      <h3>Lore pickups</h3>
      <p className='hint'>{shownLore.length} of {lore.length} placed. Collected pickups removed from the world are not listed.</p>
      <div className='world-card-grid'>
        {shownLore.slice(0, 200).map((object) => {
          const entry = journalFor(object)
          return (
            <article key={object.id} className='world-card'>
              <div className='world-card-main plain'>
                <ItemIcon icon={entry?.icon} alt='' size={36} folder='journal' />
                <span className='world-card-copy'>
                  <strong>{entry ? journalLabel(entry.id) : prettyLeaf(object.className)}</strong>
                  <span className='tiny'>{levelTitle(object.level)}</span>
                </span>
              </div>
              {object.destroyed ? <div className='world-card-stats'><span className='flag on'>collected</span></div> : null}
            </article>
          )
        })}
      </div>
      {shownLore.length > 200 ? <p className='hint'>Showing 200 of {shownLore.length}.</p> : null}
    </WorldPage>
  )
}

function journalFor(object: WorldObject) {
  for (const property of object.properties) {
    if (property.value.kind === 'string') {
      const entry = getJournalEntry(property.value.value)
      if (entry) return entry
    }
    if (property.value.kind === 'bytes') {
      for (const part of property.value.text.split(', ')) {
        const entry = getJournalEntry(part)
        if (entry) return entry
      }
    }
  }
  return undefined
}

function journalTitle(object: WorldObject): string {
  const entry = journalFor(object)
  return entry ? journalLabel(entry.id) : object.name
}

function NameList({
  title,
  values,
  label,
  onCommit,
}: {
  title: string
  values: string[]
  label: (id: string) => string
  onCommit: (values: string[]) => void
}) {
  return (
    <div>
      <h3>{title}</h3>
      {values.length === 0 ? <p className='muted'>None recorded.</p> : (
        <div className='world-card-grid'>
          {values.map((id) => (
            <article key={id} className='world-card'>
              <div className='world-card-copy'>
                <strong>{label(id)}</strong>
                {id !== label(id) ? <span className='tiny'>{id}</span> : null}
              </div>
              <div className='world-card-actions'>
                <button type='button' onClick={() => onCommit(values.filter((entry) => entry !== id))}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <AddLine onAdd={(id) => onCommit([...values, id])} />
    </div>
  )
}

function AddLine({ onAdd }: { onAdd: (id: string) => void }) {
  const [draft, setDraft] = useState('')
  function add() {
    const next = draft.trim()
    if (!next) return
    onAdd(next)
    setDraft('')
  }
  return (
    <div className='journal-actions'>
      <label>
        Add id
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
      </label>
      <button type='button' onClick={add}>Add</button>
    </div>
  )
}
