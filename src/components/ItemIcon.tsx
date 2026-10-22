import { useState } from 'react'
import { catalogIconUrl, type IconFolder } from '../catalog'

type Props = {
  icon?: string
  alt?: string
  size?: number
  className?: string
  folder?: IconFolder
}

export function ItemIcon({ icon, alt = '', size = 40, className, folder = 'icons' }: Props) {
  const [failed, setFailed] = useState(false)
  const src = catalogIconUrl(folder, icon)

  if (!src || failed) {
    return (
      <span
        className={`item-icon placeholder ${className ?? ''}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }

  return (
    <img
      className={`item-icon ${className ?? ''}`}
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

