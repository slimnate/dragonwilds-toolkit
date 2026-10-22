import { useMemo, useState } from 'react'
import { ItemPicker } from '../../components/ItemPicker'
import { BagGrid } from '../InventoryGrid'
import { withComponentString, withPropertyNumber, withPropertyText } from '../../saves/spud/edit'
import { serializeUnrealJson } from '../../saves/serialize'
import { randomInstanceGuid } from '../../saves/ids'
import type { ItemSlot, JsonObject } from '../../saves/types'
import { inventoryJsonAt } from '../../saves/spud/view'
import { pageFor, propertyNumber, propertyText, type WorldDocument, type WorldObject } from '../../saves/spud/world'
import { LazyGroup, ROW_CAP, WorldPage, commitWorld, itemForClass, levelTitle, prettyLeaf } from './shared'

const INVENTORY_KEYS = ['InventoryComponent', 'JsonInventory', 'FuelInventory', 'OutputInventory', 'CatalystInventory', 'ResourcesInventory']

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

export function WorldContainersSection({ doc, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const containers = useMemo(() => doc.objects.filter((object) => pageFor(object) === 'containers'), [doc])
  const needle = query.trim().toLowerCase()
  const shown = containers.filter((object) => {
    const leaf = prettyLeaf(object.className)
    if (kind === 'chest' && !/chest|loot/i.test(leaf)) return false
    if (kind === 'station' && !/fuel|output|catalyst|station|bench|furnace/i.test(`${leaf} ${object.properties.map((entry) => entry.name).join(' ')}`)) return false
    if (kind === 'dropped' && !/world item|runtime/i.test(leaf)) return false
    if (!needle) return true
    return `${leaf} ${object.name} ${object.level}`.toLowerCase().includes(needle)
  })

  const labels: Record<string, string> = { all: 'All', chest: 'Chests', station: 'Stations', dropped: 'Dropped' }
  return (
    <WorldPage
      title='Containers'
      meta={`${shown.length} of ${containers.length}`}
      hint='Chests, station inventories, and dropped items. Open one to edit its slots the same way as a character bag.'
      toolbar={(
        <div className='progress-toolbar world-toolbar'>
          <input placeholder='Search containers' value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className='chip-row'>
            {['all', 'chest', 'station', 'dropped'].map((option) => (
              <button key={option} type='button' className={kind === option ? 'chip on' : 'chip'} onClick={() => setKind(option)}>
                {labels[option]}
              </button>
            ))}
          </div>
        </div>
      )}
    >
      <div className='world-groups'>
        {shown.slice(0, 80).map((object) => (
          <LazyGroup key={object.id} title={itemForClass(object.className)?.name ?? prettyLeaf(object.className)} meta={levelTitle(object.level)}>
            {() => <ContainerBody doc={doc} object={object} onChange={onChange} />}
          </LazyGroup>
        ))}
      </div>
      {shown.length > 80 ? <p className='hint'>Showing 80 of {shown.length}. Search to narrow the list.</p> : null}
    </WorldPage>
  )
}

function ContainerBody({ doc, object, onChange }: { doc: WorldDocument, object: WorldObject, onChange: (doc: WorldDocument) => void }) {
  const keys = INVENTORY_KEYS.filter((key) => object.properties.some((entry) => entry.name === key || entry.key === key))
  const jsonKeys = keys.filter((key) => inventoryJsonAt(doc, object, key))
  if (jsonKeys.length === 0) {
    return <ScalarInventory doc={doc} object={object} onChange={onChange} />
  }
  return (
    <>
      {jsonKeys.map((key) => (
        <InventoryEditor key={key} doc={doc} object={object} propertyKey={key} onChange={onChange} />
      ))}
    </>
  )
}

function InventoryEditor({
  doc,
  object,
  propertyKey,
  onChange,
}: {
  doc: WorldDocument
  object: WorldObject
  propertyKey: string
  onChange: (doc: WorldDocument) => void
}) {
  const json = inventoryJsonAt(doc, object, propertyKey) ?? {}
  const [selected, setSelected] = useState<number | null>(null)
  const entries = slotEntries(json)
  const byIndex = new Map(entries.map((entry) => [entry.index, entry.slot]))
  const indices = entries.length > 0 ? entries.map((entry) => entry.index) : [0]
  const current = selected !== null ? byIndex.get(selected) : undefined

  function write(next: JsonObject) {
    const property = object.properties.find((entry) => entry.key === propertyKey || entry.name === propertyKey)
    const serialized = serializeUnrealJson(next)
    const original = property?.value.kind === 'string' ? property.value.value : ''
    const body = original.endsWith('\n') ? serialized : serialized.replace(/\r?\n$/, '')
    const bytes = property?.value.kind === 'string'
      ? withPropertyText(doc, object.id, propertyKey, body)
      : withComponentString(doc, object.id, propertyKey, body)
    commitWorld(doc, bytes, onChange)
  }

  function patchSlot(index: number, slot: ItemSlot | null) {
    const next: JsonObject = { ...json }
    if (!slot) delete next[String(index)]
    else next[String(index)] = slot
    write(next)
  }

  return (
    <div className='world-bag'>
      <h3>{propertyKey.replace(/([A-Z])/g, ' $1').trim()}</h3>
      <BagGrid
        source={object.id + propertyKey}
        byIndex={byIndex}
        indices={indices.slice(0, ROW_CAP)}
        columns={8}
        selectedSource={selected !== null ? object.id + propertyKey : null}
        selectedIndex={selected}
        onSelect={setSelected}
        onMove={(fromIndex, fromSource, toIndex, toSource) => {
          if (fromSource !== toSource) return
          const from = byIndex.get(fromIndex)
          const to = byIndex.get(toIndex)
          const next: JsonObject = { ...json }
          if (from) next[String(toIndex)] = from
          else delete next[String(toIndex)]
          if (to) next[String(fromIndex)] = to
          else delete next[String(fromIndex)]
          write(next)
        }}
      />
      {current && selected !== null ? (
        <div className='form-grid'>
          <ItemPicker
            label='Item'
            value={typeof current.ItemData === 'string' ? current.ItemData : undefined}
            onChange={(id) => patchSlot(selected, { ...current, ItemData: id })}
          />
          <label>
            Count
            <input
              type='number'
              defaultValue={typeof current.Count === 'number' ? current.Count : 1}
              key={`count-${selected}-${String(current.Count)}`}
              onBlur={(event) => patchSlot(selected, { ...current, Count: Number(event.target.value) })}
            />
          </label>
          <label>
            Durability
            <input
              type='number'
              defaultValue={typeof current.Durability === 'number' ? current.Durability : 0}
              key={`durability-${selected}-${String(current.Durability)}`}
              onBlur={(event) => patchSlot(selected, { ...current, Durability: Number(event.target.value) })}
            />
          </label>
          <button type='button' onClick={() => patchSlot(selected, null)}>Clear slot</button>
        </div>
      ) : <p className='muted'>Select a slot to edit it.</p>}
      <button
        type='button'
        onClick={() => {
          const used = new Set(entries.map((entry) => entry.index))
          let index = 0
          while (used.has(index)) index += 1
          patchSlot(index, { GUID: randomInstanceGuid(), Count: 1 })
          setSelected(index)
        }}
      >
        Add slot
      </button>
    </div>
  )
}

function ScalarInventory({ doc, object, onChange }: { doc: WorldDocument, object: WorldObject, onChange: (doc: WorldDocument) => void }) {
  const names = ['ItemDataPersistenceId', 'Count', 'Durability', 'ChestState']
  const fields = object.properties.filter((entry) => names.includes(entry.name))
  if (fields.length === 0) return <p className='muted'>No inventory payload on this actor.</p>
  return (
    <div className='form-grid'>
      {fields.map((field) => {
        if (field.value.kind === 'string') {
          return (
            <label key={field.key}>
              {field.name}
              <input
                defaultValue={propertyText(object, field.key) ?? ''}
                onBlur={(event) => commitWorld(doc, withPropertyText(doc, object.id, field.key, event.target.value), onChange)}
              />
            </label>
          )
        }
        if (field.value.kind === 'number') {
          return (
            <label key={field.key}>
              {field.name}
              <input
                type='number'
                defaultValue={propertyNumber(object, field.key) ?? 0}
                onBlur={(event) => commitWorld(doc, withPropertyNumber(doc, object.id, field.key, Number(event.target.value)), onChange)}
              />
            </label>
          )
        }
        return null
      })}
    </div>
  )
}

function slotEntries(json: JsonObject): { index: number, slot: ItemSlot }[] {
  const entries: { index: number, slot: ItemSlot }[] = []
  for (const [key, value] of Object.entries(json)) {
    if (!/^\d+$/.test(key) || typeof value !== 'object' || value === null || Array.isArray(value)) continue
    entries.push({ index: Number(key), slot: value as ItemSlot })
  }
  return entries.sort((a, b) => a.index - b.index)
}
