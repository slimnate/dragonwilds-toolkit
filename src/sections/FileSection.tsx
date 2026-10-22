import { useEffect, useState } from 'react'
import { listWorldNames } from '../native'
import { asObject, getBool, getGameplayRoot, getNumber, getString } from '../saves/access'
import type { JsonObject } from '../saves/types'

function lookupWorld(names: Map<string, string>, id: string): string | null {
  const key = id.trim().toUpperCase()
  if (!key || /^0+$/.test(key)) return null
  return names.get(key) ?? null
}

function lastPlayedLabel(value: number): string | null {
  if (!Number.isFinite(value) || value < 1_000_000_000 || value > 10_000_000_000) return null
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type Props = {
  save: JsonObject
  path: string | null
  onChange: (save: JsonObject) => void
}

export function FileSection({ save, path, onChange }: Props) {
  const meta = asObject(save.meta_data) ?? {}
  const hardcore = asObject(save.Hardcore) ?? {}
  const worlds = asObject(meta.worlds_playtime) ?? {}
  const [worldNames, setWorldNames] = useState<Map<string, string>>(() => new Map())
  const associatedWorld = getString(hardcore, 'AssociatedWorld')
  const associatedName = lookupWorld(worldNames, associatedWorld)

  useEffect(() => {
    let cancelled = false
    listWorldNames()
      .then((rows) => {
        if (cancelled) return
        const next = new Map<string, string>()
        for (const row of rows) {
          if (row.name) next.set(row.guid.toUpperCase(), row.name)
        }
        setWorldNames(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function patchMeta(key: string, value: string | number) {
    const next = structuredClone(save)
    const nextMeta = asObject(next.meta_data) ?? {}
    nextMeta[key] = value
    next.meta_data = nextMeta
    onChange(next)
  }

  function patchHardcore(key: string, value: boolean | string) {
    const next = structuredClone(save)
    const nextHardcore = asObject(next.Hardcore) ?? {}
    nextHardcore[key] = value
    next.Hardcore = nextHardcore
    onChange(next)
  }

  return (
    <section className="panel">
      <h2>File</h2>
      {path ? <p className="path">{path}</p> : <p className="muted">No path yet — Save As to choose one.</p>}
      <div className="form-grid">
        <label>
          Character name
          <input value={getString(meta, 'char_name')} onChange={(event) => patchMeta('char_name', event.target.value)} />
        </label>
        <label>
          Character GUID
          <input value={getString(meta, 'char_guid')} onChange={(event) => patchMeta('char_guid', event.target.value)} />
        </label>
        <label>
          Character type
          <input
            type="number"
            value={getNumber(meta, 'char_type')}
            onChange={(event) => patchMeta('char_type', Number(event.target.value))}
          />
        </label>
        <label>
          Version
          <input value={String(save.Version ?? '')} readOnly />
        </label>
        <label>
          Save count
          <input
            type="number"
            value={getNumber(save, 'SaveCount')}
            onChange={(event) => {
              const next = structuredClone(save)
              next.SaveCount = Number(event.target.value)
              onChange(next)
            }}
          />
        </label>
        <label>
          Backup token
          <input value={String(save.Backup ?? '')} readOnly />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={getBool(hardcore, 'IsHardcore')}
            onChange={(event) => patchHardcore('IsHardcore', event.target.checked)}
          />
          Hardcore
        </label>
        <label className="wide">
          Hardcore world
          <span className="id-row">
            <input
              value={associatedWorld}
              onChange={(event) => patchHardcore('AssociatedWorld', event.target.value)}
            />
            {associatedName ? <span className="world-name">{associatedName}</span> : null}
          </span>
        </label>
      </div>
      <h3>Worlds playtime</h3>
      <p className="hint">
        Each number is the last time this character played that world, stored as Unix time
        (seconds since 1 January 1970 UTC). The date beside it is that instant in local time.
      </p>
      <ul className="kv-list">
        {Object.entries(worlds).map(([guid, value]) => {
          const seconds = typeof value === 'number' ? value : 0
          const name = lookupWorld(worldNames, guid)
          const played = lastPlayedLabel(seconds)
          return (
            <li key={guid}>
              <span className="world-id">
                <code>{guid}</code>
                {name ? <span className="world-name">{name}</span> : null}
              </span>
              <span className="playtime-value">
                <input
                  type="number"
                  value={seconds}
                  onChange={(event) => {
                    const next = structuredClone(save)
                    const nextMeta = asObject(next.meta_data) ?? {}
                    const map = asObject(nextMeta.worlds_playtime) ?? {}
                    map[guid] = Number(event.target.value)
                    nextMeta.worlds_playtime = map
                    next.meta_data = nextMeta
                    onChange(next)
                  }}
                />
                {played ? <span className="muted tiny">{played}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="hint">
        Gameplay root: {getGameplayRoot(save) === save ? 'flat (v≤67)' : 'GameProgress wrapper (v≥75)'}.
        Version is not migrated automatically.
      </p>
    </section>
  )
}
