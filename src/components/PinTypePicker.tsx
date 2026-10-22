import { mapMarkerUrl } from '../catalog'
import { PIN_TYPES } from '../saves/lookups'

type Props = {
  value: number
  onChange: (value: number) => void
}

export function PinTypePicker({ value, onChange }: Props) {
  return (
    <div className="pin-type-picker" role="radiogroup">
      {PIN_TYPES.map((type) => {
        const src = mapMarkerUrl(type.icon)
        const on = type.value === value
        return (
          <button
            key={type.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'pin-type-btn on' : 'pin-type-btn'}
            title={`${type.value} ${type.label}`}
            aria-label={`${type.value} ${type.label}`}
            onClick={() => onChange(type.value)}
          >
            {src ? <img src={src} alt="" /> : type.label}
          </button>
        )
      })}
      <input
        className="pin-type-raw"
        type="number"
        value={Number.isFinite(value) ? value : ''}
        aria-label="Pin type number"
        title="Pin type number"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
