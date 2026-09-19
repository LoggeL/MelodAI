import { useState, useCallback, useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHeart as faHeartSolid } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartRegular } from '@fortawesome/free-regular-svg-icons'
import styles from './HeartButton.module.css'

interface Props {
  active: boolean
  onClick: (e: React.MouseEvent) => void | Promise<void>
  className?: string
  activeClassName?: string
  title?: string
  disabled?: boolean
}

export function HeartButton({ active, onClick, className = '', activeClassName = '', title, disabled = false }: Props) {
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

  const label = title || (active ? 'Remove from favorites' : 'Add to favorites')
  return (
    <button type="button" className={`${className} ${active ? activeClassName : ''}`} onClick={handleClick}
      title={label} aria-label={label} aria-pressed={active} disabled={disabled}>
      <span className={`${styles.wrap} ${burst ? styles.burst : ''}`}>
        <FontAwesomeIcon icon={active ? faHeartSolid : faHeartRegular} />
      </span>
    </button>
  )
}
