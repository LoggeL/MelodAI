import { ICONS, type IconName } from './icons'

interface Props {
  name: IconName
  size?: 16 | 20 | 26 | number
  className?: string
}

/** Decorative line icon. Meaning always comes from a visible label or the button's aria-label. */
export function Icon({ name, size = 20, className }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}

export type { IconName }
