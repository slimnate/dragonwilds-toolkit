import { useState } from 'react'
import { getItem, items } from '../catalog'
import { Collapsible } from '../components/Collapsible'
import { ItemIcon } from '../components/ItemIcon'
import { ItemPicker } from '../components/ItemPicker'
import { VitalMeter } from '../components/VitalMeter'
import { asObject, ensureObject, getBool, getCharacter, getNumber, getString } from '../saves/access'
import { MOUNT_GROUPS, MOUNTS, STATUS_EFFECTS, mountById, mountLabel } from '../saves/lookups'
import type { JsonObject, JsonValue } from '../saves/types'

type Props = {
  save: JsonObject
  onChange: (save: JsonObject) => void
}

const CORE_STATUS = new Set(['Cold', 'Poison', 'Burning', 'Bleeding', 'Slow', 'WellRested', 'Cosiness', 'Wither'])

const STATUS_LABELS: Record<string, string> = {
  WellRested: 'Well rested',
  OverEating: 'Overeating',
  SoulScourge: 'Soul scourge',
  AnimaCharge: 'Anima charge',
}

function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key
}

const ANIMA_ICONS: Record<string, string> = {
  Air: 'T_Air_Icon.png',
  Earth: 'T_Earth_Icon.png',
  Fire: 'T_Fire_Icon.png',
  Water: 'T_Water_Icon.png',
}

function statusIcon(key: string, icon: string | undefined, block: JsonObject): string | undefined {
  if (key !== 'AnimaCharge') return icon
  return ANIMA_ICONS[getString(block, 'Attunement')] ?? icon
}

export function VitalsSection({ save, onChange }: Props) {
  const [editVitals, setEditVitals] = useState(false)
  const [editStatus, setEditStatus] = useState(false)
  const character = getCharacter(save)
  if (!character) return <section className="panel"><p>No Character block.</p></section>

  function patchCharacter(mutator: (character: JsonObject) => void) {
    const next = structuredClone(save)
    const target = getCharacter(next)
    if (!target) return
    mutator(target)
    onChange(next)
  }

  const health = asObject(character.Health)
  const stamina = asObject(character.Stamina)
  const sustenance = asObject(character.Sustenance)
  const hydration = asObject(character.Hydration)
  const endurance = asObject(character.Endurance)
  const toxicity = asObject(character.Toxicity)
  const drink = asObject(hydration?.HydrationDrinkBuff)
  const mount = asObject(character.Mount)
  const soul = asObject(character.SoulRift)
  const location = asObject(character.LastAccessibleLocation)
  const effects = asObject(character.StatusEffects) ?? {}
  const unlocks = Array.isArray(mount?.MountsUnlockedList)
    ? mount.MountsUnlockedList.filter((entry): entry is string => typeof entry === 'string')
    : []

  const equippedId = getString(mount, 'MountEquipped', 'None')
  const equippedInfo = mountById(equippedId)

  function toggleMount(id: string) {
    patchCharacter((c) => {
      const m = ensureObject(c, 'Mount')
      const list = Array.isArray(m.MountsUnlockedList) ? [...m.MountsUnlockedList] : []
      const index = list.indexOf(id)
      if (index >= 0) list.splice(index, 1)
      else list.push(id)
      m.MountsUnlockedList = list as JsonValue[]
    })
  }

  function equipMount(id: string) {
    patchCharacter((c) => { ensureObject(c, 'Mount').MountEquipped = id })
  }

  const position = parsePosition(getString(location, 'Position'))

  return (
    <section className="panel character-page">
      <h2>Character</h2>
      <div className="section-head">
        <h3>Vitals</h3>
        <button
          type="button"
          className={editVitals ? 'section-edit on' : 'section-edit'}
          aria-label={editVitals ? 'Hide vital editors' : 'Edit vitals'}
          aria-pressed={editVitals}
          onClick={() => setEditVitals((open) => !open)}
        >
          <PencilIcon />
          {editVitals ? 'Done' : 'Edit'}
        </button>
      </div>
      <p className="hint">Health and stamina maxima are not stored in the save. Bars fill against 100, or the current value if it is higher.</p>
      <div className="vital-grid">
        <VitalMeter
          label="Health"
          icon="T_Icon_Health.png"
          color="#c45c4a"
          editing={editVitals}
          value={getNumber(health, 'CurrentValue', 100)}
          onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Health').CurrentValue = value })}
        />
        <VitalMeter
          label="Stamina"
          icon="T_Icon_Stamina.png"
          color="#d4b06a"
          editing={editVitals}
          value={getNumber(stamina, 'CurrentValue', 100)}
          onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Stamina').CurrentValue = value })}
        />
        <VitalMeter
          label="Sustenance"
          icon="T_Icon_Upkeep_Sustenance.png"
          color="#c98a3c"
          step={0.1}
          editing={editVitals}
          value={getNumber(sustenance, 'SustenanceValue')}
          onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Sustenance').SustenanceValue = value })}
          companion={{
            label: 'Decay buffer',
            value: getNumber(sustenance, 'SustenanceDecayBuffer'),
            onChange: (value) => patchCharacter((c) => { ensureObject(c, 'Sustenance').SustenanceDecayBuffer = value }),
          }}
        />
        <VitalMeter
          label="Hydration"
          icon="T_Icon_Upkeep_Hydration.png"
          color="#4aa3c9"
          step={0.1}
          editing={editVitals}
          value={getNumber(hydration, 'HydrationValue')}
          onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Hydration').HydrationValue = value })}
          companion={{
            label: 'Decay buffer',
            value: getNumber(hydration, 'HydrationDecayBuffer'),
            onChange: (value) => patchCharacter((c) => { ensureObject(c, 'Hydration').HydrationDecayBuffer = value }),
          }}
        />
        <VitalMeter
          label="Endurance"
          icon="T_Icon_Upkeep_Endurance.png"
          color="#8b6cc9"
          step={0.1}
          editing={editVitals}
          value={getNumber(endurance, 'EnduranceValue')}
          onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Endurance').EnduranceValue = value })}
          companion={{
            label: 'Decay buffer',
            value: getNumber(endurance, 'EnduranceDecayBuffer'),
            onChange: (value) => patchCharacter((c) => { ensureObject(c, 'Endurance').EnduranceDecayBuffer = value }),
          }}
        />
        {toxicity ? (
          <VitalMeter
            label="Toxicity"
            color="#6bb84a"
            step={0.1}
            editing={editVitals}
            value={getNumber(toxicity, 'ToxicityValue')}
            onChange={(value) => patchCharacter((c) => { ensureObject(c, 'Toxicity').ToxicityValue = value })}
            companion={{
              label: 'Highest',
              value: getNumber(toxicity, 'HighestToxicityValue'),
              onChange: (value) => patchCharacter((c) => { ensureObject(c, 'Toxicity').HighestToxicityValue = value }),
            }}
          />
        ) : null}
      </div>

      {hydration ? (
        <>
          <h3>Drink buff</h3>
          <div className="drink-card">
            <ItemIcon icon="T_Icon_Buff_Quenched.png" folder="hud" alt="" size={44} className="vital-icon" />
            <div className="vital-body">
              <ItemPicker
                title="Choose drink"
                choices={items.filter((item) => item.drinkBuff)}
                value={getString(drink, 'DrinkBuffPersistenceId') || undefined}
                onChange={(id) => patchCharacter((c) => {
                  const hydra = ensureObject(c, 'Hydration')
                  if (!id) {
                    delete hydra.HydrationDrinkBuff
                    return
                  }
                  const buff = ensureObject(hydra, 'HydrationDrinkBuff')
                  buff.DrinkBuffPersistenceId = id
                  if (typeof buff.DrinkBuffTimeRemaining !== 'number') buff.DrinkBuffTimeRemaining = 300
                })}
              />
              {drink ? (
                <NumField
                  label="Seconds left"
                  value={getNumber(drink, 'DrinkBuffTimeRemaining')}
                  step={0.1}
                  onChange={(value) => patchCharacter((c) => { ensureObject(ensureObject(c, 'Hydration'), 'HydrationDrinkBuff').DrinkBuffTimeRemaining = value })}
                />
              ) : (
                <p className="tiny">No drink selected.</p>
              )}
              {getItem(getString(drink, 'DrinkBuffPersistenceId'))?.description ? (
                <p className="drink-effect">{getItem(getString(drink, 'DrinkBuffPersistenceId'))?.description}</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <h3>Mount</h3>
      <div className="mount-layout">
        <div className="mount-group mount-equipped">
          <h4>Equipped</h4>
          <MountCard
            name={equippedId === 'None' || !equippedId ? 'None' : mountLabel(equippedId)}
            icon={equippedInfo?.icon}
            unlocked
            equipped
            onUnequip={equippedId && equippedId !== 'None' ? () => equipMount('None') : undefined}
          />
        </div>
        <div className="mount-available">
          {MOUNT_GROUPS.map((group) => (
            <div key={group} className="mount-group">
              <h4>{group}</h4>
              <div className="mount-grid">
                {MOUNTS.filter((entry) => entry.group === group).map((entry) => {
                  const unlocked = unlocks.includes(entry.id)
                  return (
                    <MountCard
                      key={entry.id}
                      name={entry.name}
                      icon={entry.icon}
                      unlocked={unlocked}
                      equipped={equippedId === entry.id}
                      showLock
                      onToggleLock={() => toggleMount(entry.id)}
                      onEquip={() => equipMount(entry.id)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          {unlocks.filter((id) => !mountById(id)).length > 0 ? (
            <div className="mount-group">
              <h4>Other</h4>
              <div className="mount-grid">
                {unlocks.filter((id) => !mountById(id)).map((id) => (
                  <MountCard
                    key={id}
                    name={mountLabel(id)}
                    unlocked
                    equipped={equippedId === id}
                    showLock
                    onToggleLock={() => toggleMount(id)}
                    onEquip={() => equipMount(id)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section-head">
        <h3>Status effects</h3>
        <button
          type="button"
          className={editStatus ? 'section-edit on' : 'section-edit'}
          aria-label={editStatus ? 'Hide status editors' : 'Edit status effects'}
          aria-pressed={editStatus}
          onClick={() => setEditStatus((open) => !open)}
        >
          <PencilIcon />
          {editStatus ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="status-grid">
        {STATUS_EFFECTS.filter((effect) => effects[effect.key] !== undefined || CORE_STATUS.has(effect.key)).map((effect) => {
          const block = asObject(effects[effect.key]) ?? { Hash: effect.hash, Value: 0, Active: [false] }
          const activeArr = Array.isArray(block.Active) ? block.Active : []
          const active = activeArr[0] === true
          if (effects[effect.key] === undefined && !CORE_STATUS.has(effect.key)) return null
          return (
            <div key={effect.key} className={`status-card${active ? ' on' : ''}`}>
              <VitalMeter
                label={statusLabel(effect.key)}
                icon={statusIcon(effect.key, effect.icon, block)}
                color={effect.color}
                step={0.1}
                editing={editStatus}
                value={getNumber(block, 'Value')}
                active={{
                  checked: active,
                  onChange: (on) => patchCharacter((c) => {
                    const group = ensureObject(c, 'StatusEffects')
                    const current = asObject(group[effect.key]) ?? { Hash: effect.hash, Value: 0, Active: [false] as JsonValue[] }
                    current.Active = [on]
                    group[effect.key] = current
                  }),
                }}
                onChange={(value) => patchCharacter((c) => {
                  const group = ensureObject(c, 'StatusEffects')
                  const current = asObject(group[effect.key]) ?? { Hash: effect.hash, Active: [false] as JsonValue[] }
                  current.Value = value
                  group[effect.key] = current
                })}
              />
            </div>
          )
        })}
      </div>
      <Collapsible title="Advanced">
      <div className="character-general">
        <DurationField
          label="Playtime (sim)"
          seconds={getNumber(character, 'Playtime_sim')}
          onChange={(value) => patchCharacter((c) => { c.Playtime_sim = value })}
        />
        <DurationField
          label="Playtime (wall)"
          seconds={getNumber(character, 'Playtime_wall')}
          onChange={(value) => patchCharacter((c) => { c.Playtime_wall = value })}
        />
        {character.WalkedDistanceSinceXp !== undefined ? (
          <NumField label="Walked since XP" value={getNumber(character, 'WalkedDistanceSinceXp')} onChange={(value) => patchCharacter((c) => { c.WalkedDistanceSinceXp = value })} />
        ) : null}
        {position ? (
          <LocationFields
            position={position}
            onChange={(next) => patchCharacter((c) => { ensureObject(c, 'LastAccessibleLocation').Position = formatPosition(next) })}
          />
        ) : (
          <label className="vital-number character-span">
            Last location
            <input
              value={getString(location, 'Position')}
              onChange={(event) => patchCharacter((c) => { ensureObject(c, 'LastAccessibleLocation').Position = event.target.value })}
            />
          </label>
        )}
        {typeof effects.WellRestedDecayRate === 'number' ? (
          <NumField
            label="Well rested decay"
            value={getNumber(effects, 'WellRestedDecayRate')}
            onChange={(value) => patchCharacter((c) => { ensureObject(c, 'StatusEffects').WellRestedDecayRate = value })}
          />
        ) : null}
        {typeof effects.LastMaxCosiness === 'number' ? (
          <NumField
            label="Last max cosiness"
            value={getNumber(effects, 'LastMaxCosiness')}
            onChange={(value) => patchCharacter((c) => { ensureObject(c, 'StatusEffects').LastMaxCosiness = value })}
          />
        ) : null}
      </div>
      {soul ? (
        <>
          <h4>Soul rift</h4>
          <div className="form-grid">
            <NumField label="Duration" value={getNumber(soul, 'SoulRiftedDuration')} onChange={(value) => patchCharacter((c) => { ensureObject(c, 'SoulRift').SoulRiftedDuration = value })} />
            <label className="check">
              <input
                type="checkbox"
                checked={getBool(soul, 'PlayingImaruEvent')}
                onChange={(event) => patchCharacter((c) => { ensureObject(c, 'SoulRift').PlayingImaruEvent = event.target.checked })}
              />
              Playing Imaru event
            </label>
          </div>
        </>
      ) : null}
      </Collapsible>
    </section>
  )
}

function MountCard({
  name,
  icon,
  unlocked,
  equipped,
  showLock = false,
  onToggleLock,
  onEquip,
  onUnequip,
}: {
  name: string
  icon?: string
  unlocked: boolean
  equipped: boolean
  showLock?: boolean
  onToggleLock?: () => void
  onEquip?: () => void
  onUnequip?: () => void
}) {
  return (
    <div className={`mount-card${unlocked ? ' on' : ''}${equipped ? ' equipped' : ''}`}>
      {showLock ? (
        <button
          type="button"
          className={unlocked ? 'mount-lock open' : 'mount-lock'}
          title={unlocked ? 'Lock' : 'Unlock'}
          aria-label={unlocked ? `Lock ${name}` : `Unlock ${name}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggleLock?.()
          }}
        >
          <MountLockIcon open={unlocked} />
        </button>
      ) : null}
      <span className={`mount-portrait${showLock && !unlocked ? ' locked' : ''}`}>
        <ItemIcon icon={icon} folder="mounts" alt="" size={92} />
      </span>
      <span className="mount-name">{name}</span>
      {onEquip ? (
        <button
          type="button"
          className="mount-equip"
          disabled={!unlocked || equipped}
          onClick={() => onEquip()}
        >
          Equip
        </button>
      ) : null}
      {onUnequip ? (
        <button type="button" className="mount-equip" onClick={onUnequip}>
          Unequip
        </button>
      ) : null}
    </div>
  )
}

function MountLockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {open ? (
        <path
          d="M5 7.2V4.6a3 3 0 0 1 5.7-1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M5 7.2V5a3 3 0 0 1 6 0v2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
      <rect
        x="3.2"
        y="7.1"
        width="9.6"
        height="7.1"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function NumField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  const inputStep = step >= 1 ? step : 'any'
  return (
    <label className="vital-number">
      {label}
      <input
        type="number"
        step={inputStep}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function DurationField({
  label,
  seconds,
  onChange,
}: {
  label: string
  seconds: number
  onChange: (seconds: number) => void
}) {
  const total = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total - hours * 3600 - minutes * 60

  function write(nextHours: number, nextMinutes: number) {
    const h = Number.isFinite(nextHours) ? Math.max(0, nextHours) : 0
    const m = Number.isFinite(nextMinutes) ? Math.max(0, nextMinutes) : 0
    onChange(h * 3600 + m * 60 + rest)
  }

  return (
    <div className="duration-field">
      <span className="vital-number">{label}</span>
      <div className="vital-fields paired">
        <label className="vital-number">
          Hours
          <input type="number" min={0} step={1} value={hours} onChange={(event) => write(Number(event.target.value), minutes)} />
        </label>
        <label className="vital-number">
          Minutes
          <input type="number" min={0} step={1} value={minutes} onChange={(event) => write(hours, Number(event.target.value))} />
        </label>
      </div>
    </div>
  )
}

type Position = { x: number; y: number; z: number }

function parsePosition(raw: string): Position | null {
  const match = raw.match(/X=([-\d.]+).*Y=([-\d.]+).*Z=([-\d.]+)/)
  if (!match) return null
  const x = Number(match[1])
  const y = Number(match[2])
  const z = Number(match[3])
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}

function formatPosition(position: Position): string {
  return `V(X=${position.x}, Y=${position.y}, Z=${position.z})`
}

function LocationFields({ position, onChange }: { position: Position; onChange: (position: Position) => void }) {
  function setAxis(axis: keyof Position, raw: string) {
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    onChange({ ...position, [axis]: next })
  }

  return (
    <div className="duration-field location-fields character-span">
      <span className="vital-number">Last location</span>
      <div className="location-inputs">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <label key={axis} className="vital-number">
            {axis.toUpperCase()}
            <input
              type="number"
              step={0.01}
              value={position[axis]}
              onChange={(event) => setAxis(axis, event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M11.7 1.8l2.5 2.5-8.4 8.4H3.3v-2.5l8.4-8.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 3.3l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
