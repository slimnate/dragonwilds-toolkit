import { asObject, ensureObject, getCustomizationRoot, getString } from '../saves/access'
import {
  CUSTOMIZATION_OPTIONS,
  CUSTOMIZATION_TABLES,
  type CustomizationSlot,
} from '../saves/lookups'
import type { JsonObject } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

const SLOTS = Object.keys(CUSTOMIZATION_TABLES) as CustomizationSlot[]

export function AppearanceSection({ save, onChange }: Props) {
  const custom = getCustomizationRoot(save)
  const data = asObject(asObject(custom)?.CustomizationData)

  function setRow(slot: CustomizationSlot, rowName: string) {
    const next = structuredClone(save)
    const root = getCustomizationRoot(next) ?? ensureCustomization(next)
    const customizationData = ensureObject(root, 'CustomizationData')
    customizationData[slot] = {
      dataTable: CUSTOMIZATION_TABLES[slot],
      rowName,
    }
    onChange(next)
  }

  return (
    <section className="panel">
      <h2>Appearance</h2>
      {!custom ? <p className="muted">No customization block on this save.</p> : null}
      <div className="form-grid">
        {SLOTS.map((slot) => {
          const handle = asObject(data?.[slot])
          const row = getString(handle, 'rowName')
          const options = CUSTOMIZATION_OPTIONS[slot]
          const extra = row && !options.includes(row) ? [row, ...options] : options
          return (
            <label key={slot}>
              {slot}
              <select value={row} onChange={(event) => setRow(slot, event.target.value)}>
                {extra.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function ensureCustomization(save: JsonObject): JsonObject {
  if (save.GameProgress) {
    const created: JsonObject = { CustomizationData: {} }
    save.Customization = created
    return created
  }
  const character = ensureObject(save, 'Character')
  return ensureObject(character, 'Customization')
}
