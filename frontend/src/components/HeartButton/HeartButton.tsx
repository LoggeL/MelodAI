import { useState, useCallback, useEffect, useRef } from 'react'
import { Icon } from '../common/Icon'
import styles from './HeartButton.module.css'

interface Props {
  active: boolean
  onClick: (e: React.MouseEvent) => void | Promise<void>
  className?: string
  activeClassName?: string
  title?: string
  disabled?: boolean
  size?: 16 | 20
}

export function HeartButton({ active, onClick, className = 'iconbtn', activeClassName = '', title, disabled = false, size = 20 }: Props) {
  const [burst, setBurst] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!active && !burst) {
      setBurst(true)
      timerRef.current = setTimeout(() => setBurst(false), 550)
    }
    void onClick(e)
  }, [active, burst, onClick])

  const label = title || (active ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen')
  return (
    <button type="button" className={`${className} ${styles.heart} ${active ? `${styles.active} ${activeClassName}` : ''}`} onClick={handleClick}
      title={label} aria-label={label} aria-pressed={active} disabled={disabled}>
      <span className={`${styles.wrap} ${burst ? styles.burst : ''}`}>
        <Icon name={active ? 'heart-filled' : 'heart'} size={size} />
      </span>
    </button>
  )
}
