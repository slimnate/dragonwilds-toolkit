import { useMemo, useState } from 'react'
import { categories, getItem, items, itemLabel } from '../catalog'
import { ItemIcon } from './ItemIcon'
import type { CatalogItem } from '../saves/types'

type Props = {
  value?: string
  onChange: (id: string | undefined) => void
  allowEmpty?: boolean
  label?: string
  title?: string
  choices?: CatalogItem[]
}

export function ItemPicker({ value, onChange, allowEmpty = true, label, title = 'Choose item', choices }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const selected = getItem(value)
  const pool = choices ?? items

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool.filter((item) => {
      if (!choices && category && item.category !== category) return false
      if (!q) return true
      return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    })
  }, [pool, choices, query, category])

  return (
    <div className="picker">
      {label ? <span className="field-label">{label}</span> : null}
      <button type="button" className="picker-current" onClick={() => setOpen(true)}>
        <ItemIcon icon={selected?.icon} alt="" size={32} />
        <span>
          <strong>{selected?.name ?? (value ? itemLabel(value) : 'Empty')}</strong>
          {value ? <code>{value}</code> : null}
        </span>
      </button>
      {open ? (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal picker-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                <path d="M1 1l12 12M13 1L1 13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            <header className="modal-head">
              <h3>{title}</h3>
            </header>
            <div className="modal-filters">
              <input
                autoFocus
                placeholder="Search name or id"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {choices ? null : (
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="">All categories</option>
                  {categories().map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              )}
              {allowEmpty ? (
                <button type="button" onClick={() => { onChange(undefined); setOpen(false) }}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="picker-results">
              <div className="picker-grid">
                {filtered.slice(0, 300).map((item) => (
                  <ItemChoice
                    key={item.id}
                    item={item}
                    active={item.id === value}
                    onPick={() => { onChange(item.id); setOpen(false) }}
                  />
                ))}
              </div>
              {filtered.length > 300 ? <p className="hint">{filtered.length} matches — refine search.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ItemChoice({ item, active, onPick }: { item: CatalogItem; active: boolean; onPick: () => void }) {
  return (
    <button type="button" className={active ? 'picker-item active' : 'picker-item'} onClick={onPick}>
      <ItemIcon icon={item.icon} alt="" size={36} />
      <span>
        {item.name}
        <small>
          {item.description ?? `${item.category}${item.subcategory ? ` · ${item.subcategory}` : ''}`}
        </small>
      </span>
    </button>
  )
}
