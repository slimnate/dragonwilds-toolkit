import { useMemo, useState } from 'react'
import { ItemIcon } from '../../components/ItemIcon'
import { withPropertyNumber, withPropertyText } from '../../saves/spud/edit'
import { pageFor, propertyNumber, propertyText, type WorldDocument, type WorldObject } from '../../saves/spud/world'
import { DraftNumber, DraftText, LazyGroup, ROW_CAP, WorldPage, buildingForClass, commitWorld, levelTitle, prettyLeaf } from './shared'

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

export function WorldBuildingsSection({ doc, onChange }: Props) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => doc.objects.filter((object) => pageFor(object) === 'buildings'), [doc])
  const needle = query.trim().toLowerCase()
  const shown = rows.filter((object) => {
    if (!needle) return true
    const catalog = buildingForClass(object.className)
    return `${catalog?.name ?? ''} ${prettyLeaf(object.className)} ${object.name} ${object.level}`.toLowerCase().includes(needle)
  })
  const world = shown.filter((object) => !object.level.startsWith('RSACell'))
  const cells = shown.filter((object) => object.level.startsWith('RSACell'))

  return (
    <WorldPage
      title='Buildings'
      meta={`${shown.length} pieces`}
      hint='Placed pieces. Positions stay as they were saved.'
      toolbar={(
        <div className='progress-toolbar world-toolbar'>
          <input placeholder='Search buildings' value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      )}
    >
      <BuildingList doc={doc} objects={world} onChange={onChange} />
      {cells.length > 0 ? (
        <div className='world-groups'>
          <LazyGroup title='Cells' meta={String(cells.length)}>
            {() => <BuildingList doc={doc} objects={cells.slice(0, ROW_CAP)} onChange={onChange} />}
          </LazyGroup>
        </div>
      ) : null}
    </WorldPage>
  )
}

function BuildingList({
  doc,
  objects,
  onChange,
}: {
  doc: WorldDocument
  objects: WorldObject[]
  onChange: (doc: WorldDocument) => void
}) {
  return (
    <div className='world-card-grid'>
      {objects.slice(0, ROW_CAP).map((object) => {
        const catalog = buildingForClass(object.className)
        const pieceKey = object.properties.find((entry) => entry.name === 'BuildingPieceID' || entry.name === 'GeneratedPieceID')
        const owner = object.properties.find((entry) => /owner|character/i.test(entry.name) && (entry.value.kind === 'string' || entry.name.includes('Guid')))
        const stage = object.properties.find((entry) => /stage|growth/i.test(entry.name) && entry.value.kind === 'number')
        return (
          <article key={object.id} className='world-card'>
            <div className='world-card-main plain'>
              <ItemIcon icon={catalog?.icon} alt='' size={36} />
              <span className='world-card-copy'>
                <strong>{catalog?.name ?? prettyLeaf(object.className)}</strong>
                <span className='tiny'>{levelTitle(object.level)}</span>
              </span>
            </div>
            <div className='form-grid'>
              {pieceKey && pieceKey.value.kind === 'number' ? (
                <label>
                  Piece id
                  <DraftNumber
                    value={propertyNumber(object, pieceKey.key) ?? 0}
                    onCommit={(value) => commitWorld(doc, withPropertyNumber(doc, object.id, pieceKey.key, value), onChange)}
                  />
                </label>
              ) : null}
              {owner && owner.value.kind === 'string' ? (
                <label>
                  Owner
                  <DraftText
                    value={propertyText(object, owner.key) ?? ''}
                    onCommit={(value) => commitWorld(doc, withPropertyText(doc, object.id, owner.key, value), onChange)}
                  />
                </label>
              ) : null}
              {stage && stage.value.kind === 'number' ? (
                <label>
                  Farm stage
                  <DraftNumber
                    value={propertyNumber(object, stage.key) ?? 0}
                    onCommit={(value) => commitWorld(doc, withPropertyNumber(doc, object.id, stage.key, value), onChange)}
                  />
                </label>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
