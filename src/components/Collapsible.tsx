import { useState, type ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  meta?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function Collapsible({
  title,
  description,
  meta,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <details
      className="collapse"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next !== open) setOpen(next)
      }}
    >
      <summary className="collapse-head">
        <span className="collapse-copy">
          <span className="collapse-title-row">
            <h3>{title}</h3>
            {meta ? <span className="muted">{meta}</span> : null}
          </span>
          {description ? <span className="collapse-desc">{description}</span> : null}
        </span>
        <svg
          className="collapse-arrow"
          viewBox="0 0 12 12"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div className="collapse-body">{children}</div>
    </details>
  )
}
