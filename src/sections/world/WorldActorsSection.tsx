import { useMemo, useState } from 'react'
import { withPropertyNumber, withPropertyText } from '../../saves/spud/edit'
import { pageFor, propertyNumber, propertyText, type WorldDocument, type WorldObject, type WorldProperty } from '../../saves/spud/world'
import { DraftNumber, DraftText, LazyGroup, WorldPage, actorGroup, commitWorld, levelTitle, prettyLeaf } from './shared'

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

export function WorldActorsSection({ doc, onChange }: Props) {
  const [query, setQuery] = useState('')
  const actors = useMemo(
    () => doc.objects.filter((object) => pageFor(object) === 'actors' && object.properties.some(isScalar)),
    [doc],
  )
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, WorldObject[]>()
  for (const object of actors) {
    if (needle && !`${prettyLeaf(object.className)} ${object.name} ${object.level}`.toLowerCase().includes(needle)) continue
    const key = actorGroup(object.className)
    const list = groups.get(key) ?? []
    list.push(object)
    groups.set(key, list)
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  return (
    <WorldPage
      title='Actors'
      meta={`${actors.length} with fields`}
      hint='Actors that did not fit another page, grouped by blueprint. Only decoded numbers and strings are editable.'
      toolbar={(
        <div className='progress-toolbar world-toolbar'>
          <input placeholder='Search actors' value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      )}
    >
      <div className='world-groups'>
        {ordered.slice(0, 60).map(([name, objects]) => (
          <LazyGroup key={name} title={prettyLeaf(name)} meta={String(objects.length)}>
            {() => (
              <div className='world-card-grid'>
                {objects.slice(0, 40).map((object) => (
                  <article key={object.id} className='world-card'>
                    <div className='world-card-copy'>
                      <strong>{prettyLeaf(object.className)}</strong>
                      <span className='tiny'>{levelTitle(object.level)}</span>
                    </div>
                    <div className='form-grid'>
                      {object.properties.filter(isScalar).slice(0, 12).map((property) => (
                        <ScalarField key={property.key} doc={doc} object={object} property={property} onChange={onChange} />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </LazyGroup>
        ))}
      </div>
      {ordered.length > 60 ? <p className='hint'>Showing 60 groups. Search to find another blueprint.</p> : null}
    </WorldPage>
  )
}

function isScalar(property: WorldProperty): boolean {
  return property.value.kind === 'number' || property.value.kind === 'string'
}

function ScalarField({
  doc,
  object,
  property,
  onChange,
}: {
  doc: WorldDocument
  object: WorldObject
  property: WorldProperty
  onChange: (doc: WorldDocument) => void
}) {
  if (property.value.kind === 'number' && property.value.control === 'check') {
    return (
      <label className='check'>
        <input
          type='checkbox'
          checked={property.value.value !== 0}
          onChange={(event) => commitWorld(doc, withPropertyNumber(doc, object.id, property.key, event.target.checked ? 1 : 0), onChange)}
        />
        {property.name}
      </label>
    )
  }
  if (property.value.kind === 'number') {
    return (
      <label>
        {property.name}
        <DraftNumber
          value={propertyNumber(object, property.key) ?? 0}
          step={property.value.control === 'float' ? 0.1 : 1}
          onCommit={(value) => commitWorld(doc, withPropertyNumber(doc, object.id, property.key, value), onChange)}
        />
      </label>
    )
  }
  return (
    <label>
      {property.name}
      <DraftText
        value={propertyText(object, property.key) ?? ''}
        onCommit={(value) => commitWorld(doc, withPropertyText(doc, object.id, property.key, value), onChange)}
      />
    </label>
  )
}
