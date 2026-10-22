import { withPropertyNumber, withPropertyText } from '../../saves/spud/edit'
import { serializeUnrealJson } from '../../saves/serialize'
import type { JsonObject, JsonValue } from '../../saves/types'
import { leafClass, pageFor, propertyNumber, propertyText, type WorldDocument, type WorldObject } from '../../saves/spud/world'
import { DraftNumber, WorldPage, commitWorld, prettyLeaf } from './shared'

type Props = {
  doc: WorldDocument
  onChange: (doc: WorldDocument) => void
}

export function WorldTimeSection({ doc, onChange }: Props) {
  const objects = doc.objects.filter((object) => pageFor(object) === 'time')
  const clock = objects.find((object) => leafClass(object.className).includes('InGameTime'))
  const weather = objects.find((object) => leafClass(object.className).includes('Weather'))
  const stored = clock ? propertyNumber(clock, 'StoredTime') : null
  const raw = weather ? propertyText(weather, 'WeathersJSONData') : null
  const parsed = parseWeather(raw)

  function apply(bytes: Uint8Array) {
    commitWorld(doc, bytes, onChange)
  }

  return (
    <WorldPage
      title='Time and weather'
      meta={parsed ? `${definitionsCount(parsed)} regions` : undefined}
      hint='Stored time is the in-game clock. Each weather definition is one region.'
    >
      {clock ? (
        <div className='form-grid'>
          <label>
            Stored time
            <DraftNumber
              value={stored ?? 0}
              step={0.1}
              onCommit={(value) => apply(withPropertyNumber(doc, clock.id, 'StoredTime', value))}
            />
          </label>
        </div>
      ) : <p className='muted'>No in-game clock in this save.</p>}
      {weather && parsed ? (
        <WeatherEditor
          object={weather}
          value={parsed}
          raw={raw ?? ''}
          onCommit={(next) => {
            const text = raw?.endsWith('\n') ? serializeUnrealJson(next) : serializeUnrealJson(next).replace(/\r?\n$/, '')
            apply(withPropertyText(doc, weather.id, 'WeathersJSONData', text))
          }}
        />
      ) : null}
      {weather && !parsed && raw ? (
        <label>
          Weather JSON
          <textarea value={raw} readOnly rows={8} />
        </label>
      ) : null}
      {objects.filter((object) => object !== clock && object !== weather).map((object) => (
        <p key={object.id} className='muted'>{prettyLeaf(object.className)}</p>
      ))}
    </WorldPage>
  )
}

function definitionsCount(value: JsonObject): number {
  return Array.isArray(value.Definitions) ? value.Definitions.length : 0
}

function parseWeather(text: string | null): JsonObject | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as JsonObject
  } catch {
    return null
  }
  return null
}

function WeatherEditor({
  object,
  value,
  raw,
  onCommit,
}: {
  object: WorldObject
  value: JsonObject
  raw: string
  onCommit: (value: JsonObject) => void
}) {
  const definitions = Array.isArray(value.Definitions) ? value.Definitions.filter(isObject) : []
  return (
    <div className='world-weather'>
      <h3>{prettyLeaf(object.className)}</h3>
      <p className='muted'>Version {String(value.Version ?? '')}. {definitions.length} definitions.</p>
      {definitions.map((entry, index) => {
        const data = isObject(entry.WeatherData) ? entry.WeatherData : {}
        function patch(partial: JsonObject) {
          const nextDefs = definitions.map((row, rowIndex) => (rowIndex === index ? { ...row, ...partial } : row))
          onCommit({ ...value, Definitions: nextDefs })
        }
        function patchData(partial: JsonObject) {
          patch({ WeatherData: { ...data, ...partial } })
        }
        const name = String(entry.WeatherName ?? `Region ${index + 1}`)
        return (
          <article key={`${name}-${index}`} className='world-card'>
            <div className='world-card-copy'>
              <strong>{name}</strong>
              <span className='tiny'>{String(data.TYPE ?? 'weather').replace(/^E\w+::/, '')}</span>
            </div>
            <div className='form-grid'>
              <label>
                Name
                <DraftNumberish
                  text={String(entry.WeatherName ?? '')}
                  onCommit={(next) => patch({ WeatherName: next })}
                />
              </label>
              <label>
                Type
                <DraftNumberish text={String(data.TYPE ?? '')} onCommit={(next) => patchData({ TYPE: next })} />
              </label>
              <label>
                Day count
                <DraftNumber
                  value={typeof data.DAY_COUNT === 'number' ? data.DAY_COUNT : 0}
                  onCommit={(next) => patchData({ DAY_COUNT: next })}
                />
              </label>
              <label>
                Remaining time
                <DraftNumber
                  value={typeof data.REMAINING_TIME === 'number' ? data.REMAINING_TIME : 0}
                  step={0.1}
                  onCommit={(next) => patchData({ REMAINING_TIME: next })}
                />
              </label>
            </div>
          </article>
        )
      })}
      {definitions.length === 0 ? <pre className='muted'>{raw.slice(0, 400)}</pre> : null}
    </div>
  )
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function DraftNumberish({ text, onCommit }: { text: string, onCommit: (value: string) => void }) {
  return (
    <input
      defaultValue={text}
      key={text}
      onBlur={(event) => {
        if (event.target.value !== text) onCommit(event.target.value)
      }}
    />
  )
}
