import { useMemo, useState } from 'react'
import { getRecipe, recipes, recipeLabel } from '../catalog'

type Props = {
  values: string[]
  onChange: (next: string[]) => void
  mode: 'items' | 'recipes' | 'raw'
  title: string
}

export function IdListEditor({ values, onChange, mode, title }: Props) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')

  const catalog = mode === 'recipes' ? recipes : []
  const filtered = useMemo(() => {
    if (mode === 'raw') return []
    const q = query.trim().toLowerCase()
    const source = mode === 'recipes' ? catalog : []
    if (mode === 'items') return []
    if (!q) return source.slice(0, 40)
    return source.filter((entry) => (
      entry.name.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q)
    )).slice(0, 40)
  }, [catalog, mode, query])

  function toggle(id: string) {
    if (values.includes(id)) onChange(values.filter((entry) => entry !== id))
    else onChange([...values, id])
  }

  function addDraft() {
    const id = draft.trim()
    if (!id) return
    if (!values.includes(id)) onChange([...values, id])
    setDraft('')
  }

  return (
    <div className="id-list">
      <div className="id-list-head">
        <h3>{title}</h3>
        <span className="muted">{values.length}</span>
      </div>
      {mode === 'recipes' ? (
        <input
          placeholder="Filter recipes to add"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {mode === 'recipes' && filtered.length > 0 ? (
        <div className="chip-row">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={values.includes(entry.id) ? 'chip on' : 'chip'}
              onClick={() => toggle(entry.id)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="inline-add">
        <input
          placeholder="Add persistence id"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') addDraft() }}
        />
        <button type="button" onClick={addDraft}>Add</button>
      </div>
      <ul className="id-values">
        {values.map((id) => (
          <li key={id}>
            <span>{mode === 'recipes' ? recipeLabel(id) : id}</span>
            {mode === 'recipes' && getRecipe(id) ? <code>{id}</code> : null}
            <button type="button" className="linkish" onClick={() => toggle(id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
