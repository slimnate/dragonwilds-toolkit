import { useMemo, useState } from 'react'
import { getItem, items, itemLabel } from '../catalog'
import { ItemIcon } from './ItemIcon'

type Props = {
  values: string[]
  onChange: (next: string[]) => void
  title: string
}

export function ItemIdList({ values, onChange, title }: Props) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return items.filter((item) => (
      item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    )).slice(0, 40)
  }, [query])

  function toggle(id: string) {
    if (values.includes(id)) onChange(values.filter((entry) => entry !== id))
    else onChange([...values, id])
  }

  return (
    <div className="id-list">
      <div className="id-list-head">
        <h3>{title}</h3>
        <span className="muted">{values.length}</span>
      </div>
      <input placeholder="Search items to add" value={query} onChange={(event) => setQuery(event.target.value)} />
      {filtered.length > 0 ? (
        <div className="chip-row">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className={values.includes(item.id) ? 'chip on' : 'chip'}
              onClick={() => toggle(item.id)}
            >
              <ItemIcon icon={item.icon} size={16} />
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="inline-add">
        <input
          placeholder="Add persistence id"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              toggle(draft.trim())
              setDraft('')
            }
          }}
        />
        <button type="button" onClick={() => { if (draft.trim()) { toggle(draft.trim()); setDraft('') } }}>Add</button>
      </div>
      <ul className="id-values">
        {values.map((id) => {
          const item = getItem(id)
          return (
            <li key={id}>
              <ItemIcon icon={item?.icon} size={18} />
              <span>{itemLabel(id)}</span>
              <button type="button" className="linkish" onClick={() => toggle(id)}>Remove</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
