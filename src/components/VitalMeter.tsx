import { type CSSProperties, type ReactNode } from 'react'
import { ItemIcon } from './ItemIcon'

type CompanionField = {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
}

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
  color: string
  icon?: string
  max?: number
  step?: number
  hint?: string
  companion?: CompanionField
  active?: { checked: boolean; onChange: (on: boolean) => void }
  editing?: boolean
  extras?: ReactNode
}

export function VitalMeter({
  label,
  value,
  onChange,
  color,
  icon,
  max = 100,
  step = 1,
  hint,
  companion,
  active,
  editing = false,
  extras,
}: Props) {
  const numeric = Number.isFinite(value) ? value : 0
  const ceiling = Math.max(max, numeric)
  const pct = ceiling <= 0 ? 0 : Math.min(100, Math.max(0, (numeric / ceiling) * 100))

  return (
    <div className={`vital-meter${editing ? ' editing' : ''}${active ? ' status' : ''}`}>
      <div className="vital-main">
        <ItemIcon key={icon ?? 'none'} icon={icon} folder="hud" alt="" size={44} className="vital-icon" />
        <div className="vital-body">
          <div className="vital-head">
            <span className="vital-name">{label}</span>
            <strong>{formatVital(numeric, step)}</strong>
          </div>
          <div className="vital-bar" style={{ '--bar': color, '--pct': `${pct}%` } as CSSProperties}>
            <span className="vital-bar-fill" />
          </div>
          {hint ? <p className="tiny">{hint}</p> : null}
        </div>
      </div>
      {editing ? (
        <>
          <div className="vital-divider" aria-hidden="true" />
          <div
            className={
              companion
                ? 'vital-fields paired'
                : active
                  ? 'vital-fields with-active'
                  : 'vital-fields'
            }
          >
            <NumberField label="Value" value={numeric} step={step} onChange={onChange} />
            {active ? (
              <label className="vital-toggle">
                <input
                  type="checkbox"
                  checked={active.checked}
                  onChange={(event) => active.onChange(event.target.checked)}
                />
                Active
              </label>
            ) : null}
            {companion ? (
              <NumberField
                label={companion.label}
                value={companion.value}
                step={companion.step ?? step}
                onChange={companion.onChange}
              />
            ) : null}
          </div>
        </>
      ) : null}
      {extras}
    </div>
  )
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}) {
  const numeric = Number.isFinite(value) ? value : 0
  // Saves store IEEE floats (e.g. 25.672063827514648). step=0.1 makes the
  // browser reject those as invalid, so fractional vitals use step="any".
  const inputStep = step >= 1 ? step : 'any'
  return (
    <label className="vital-number">
      {label}
      <input
        type="number"
        min={0}
        step={inputStep}
        value={numeric}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function formatVital(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value))
  if (!Number.isFinite(value)) return '0'
  // Compact display; full float precision is preserved in the edit fields.
  const text = value.toFixed(6).replace(/\.?0+$/, '')
  return text || '0'
}
