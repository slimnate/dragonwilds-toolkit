import { useEffect, useMemo } from 'react'
import {
  DIFFICULTY_OPTIONS,
  HARDCORE_OPTIONS,
  PRIVACY_OPTIONS,
  difficultyLabel,
  type WorldDocument,
} from '../../saves/spud/world'
import {
  withCrossplay,
  withCustomScale,
  withDifficulty,
  withFriendlyFire,
  withHardcore,
  withMapName,
  withOwnerName,
  withPassword,
  withPrivacy,
  withWorldName,
} from '../../saves/spud/edit'
import { Collapsible } from '../../components/Collapsible'
import { DraftNumber, DraftText, WorldPage, commitWorld } from './shared'

const SCALE_LABELS: Record<string, string> = {
  'Difficulty.Player.DamageScale': 'Player damage',
  'Difficulty.Player.HealthScale': 'Player health',
  'Difficulty.Player.StaminaScale': 'Player stamina',
  'Difficulty.Player.LifewardScale': 'Lifeward',
  'Difficulty.Player.ResistancesScale': 'Resistances',
  'Difficulty.Player.InventoryCarryCapacityScale': 'Carry capacity',
  'Difficulty.Player.SpellCostScale': 'Spell cost',
  'Difficulty.Player.SpellCooldownScale': 'Spell cooldown',
  'Difficulty.Player.TeleportationCostScale': 'Teleport cost',
  'Difficulty.Progression.XPGainScale': 'XP gain',
  'Difficulty.SurvivalCore.EnduranceDrainScale': 'Endurance drain',
  'Difficulty.SurvivalCore.HydrationDrainScale': 'Hydration drain',
  'Difficulty.SurvivalCore.SustenanceDrainScale': 'Sustenance drain',
  'Difficulty.Player.MaxNumberOfGravestonesPerPlayer': 'Gravestone cap',
  'Difficulty.SurvivalCore.ThirstKills': 'Thirst kills',
  'Difficulty.Player.KeepInventoryOnDeath': 'Keep inventory',
  'Difficulty.Player.ResetLastCompletedXPLevelOnDeath': 'Reset XP on death',
  'Difficulty.Environment.FriendlyFire': 'Environment friendly fire',
}

const BOOL_SCALES = new Set([
  'Difficulty.SurvivalCore.ThirstKills',
  'Difficulty.Player.KeepInventoryOnDeath',
  'Difficulty.Player.ResetLastCompletedXPLevelOnDeath',
  'Difficulty.Environment.FriendlyFire',
])

type Props = {
  doc: WorldDocument
  path: string | null
  onChange: (doc: WorldDocument) => void
}

export function WorldFileSection({ doc, path, onChange }: Props) {
  const info = doc.info
  const scales = doc.custom.filter((field) => field.name.startsWith('Difficulty.') && field.value.kind === 'number')
  const shotUrl = useMemo(() => {
    if (!doc.screenshot || doc.screenshot.length < 8) return null
    if (doc.screenshot[0] !== 0x89 || doc.screenshot[1] !== 0x50) return null
    const copy = new ArrayBuffer(doc.screenshot.byteLength)
    new Uint8Array(copy).set(doc.screenshot)
    return URL.createObjectURL(new Blob([copy], { type: 'image/png' }))
  }, [doc])
  useEffect(() => () => {
    if (shotUrl) URL.revokeObjectURL(shotUrl)
  }, [shotUrl])
  const slot = path?.split(/[/\\]/).pop()?.replace(/\.sav$/i, '') ?? ''

  function apply(bytes: Uint8Array) {
    commitWorld(doc, bytes, onChange)
  }

  return (
    <WorldPage
      title='File'
      meta={slot || undefined}
      hint={`${difficultyLabel(info.difficulty)} world. Character saves point at this GUID from Hardcore.AssociatedWorld and meta_data.worlds_playtime. This page does not rewrite those files.`}
    >
      <div className={shotUrl ? 'world-file-hero' : 'world-file-hero no-shot'}>
        {shotUrl ? <img className='world-shot' src={shotUrl} alt='World screenshot' /> : null}
        <dl className='world-facts'>
          <div><dt>Save GUID</dt><dd>{info.guid}</dd></div>
          <div><dt>Slot</dt><dd>{slot || 'Unsaved'}</dd></div>
          <div><dt>Timestamp</dt><dd>{info.timestamp || '—'}</dd></div>
          <div><dt>Revision</dt><dd>{info.revision}</dd></div>
          <div><dt>System version</dt><dd>{info.systemVersion}</dd></div>
          <div><dt>Levels</dt><dd>{info.levelCount}</dd></div>
          <div><dt>Cells</dt><dd>{info.cellCount}</dd></div>
        </dl>
      </div>
      {path ? <p className='path'>{path}</p> : <p className='muted'>No path yet — Save as to choose one.</p>}
      <h3>Settings</h3>
      <div className='form-grid'>
        <label>
          World name
          <DraftText value={info.worldName} onCommit={(value) => apply(withWorldName(doc, value))} />
        </label>
        <label>
          Map
          <DraftText value={info.mapName} onCommit={(value) => apply(withMapName(doc, value))} />
        </label>
        <label>
          Survival difficulty
          <select value={info.difficulty} onChange={(event) => apply(withDifficulty(doc, Number(event.target.value)))}>
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Hardcore
          <select value={info.hardcore} onChange={(event) => apply(withHardcore(doc, Number(event.target.value)))}>
            {HARDCORE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Session privacy
          <select value={info.privacy} onChange={(event) => apply(withPrivacy(doc, Number(event.target.value)))}>
            {PRIVACY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Password
          <DraftText value={info.password} onCommit={(value) => apply(withPassword(doc, value))} />
        </label>
        <label>
          Owner name
          <DraftText value={info.owner} onCommit={(value) => apply(withOwnerName(doc, value))} />
        </label>
        <label className='check'>
          <input
            type='checkbox'
            checked={info.friendlyFire !== 0}
            onChange={(event) => apply(withFriendlyFire(doc, event.target.checked ? 1 : 0))}
          />
          Friendly fire
        </label>
        <label className='check'>
          <input
            type='checkbox'
            checked={info.crossplay !== 0}
            onChange={(event) => apply(withCrossplay(doc, event.target.checked ? 1 : 0))}
          />
          Crossplay
        </label>
      </div>
      {scales.length > 0 ? (
        <Collapsible title={info.difficulty === 3 ? 'Custom difficulty' : 'Difficulty scales'} meta={`${scales.length} fields`} defaultOpen={info.difficulty === 3}>
          <div className='form-grid'>
            {scales.map((field) => {
              const value = field.value.kind === 'number' ? field.value.value : 0
              const label = SCALE_LABELS[field.name] ?? field.name
              if (BOOL_SCALES.has(field.name)) {
                return (
                  <label key={field.name} className='check'>
                    <input
                      type='checkbox'
                      checked={value !== 0}
                      onChange={(event) => apply(withCustomScale(doc, field.name, event.target.checked ? 1 : 0))}
                    />
                    {label}
                  </label>
                )
              }
              return (
                <label key={field.name}>
                  {label}
                  <DraftNumber value={value} step={0.05} onCommit={(next) => apply(withCustomScale(doc, field.name, next))} />
                </label>
              )
            })}
          </div>
        </Collapsible>
      ) : null}
    </WorldPage>
  )
}
