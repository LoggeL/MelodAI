import { useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHeart as faHeartSolid } from '@fortawesome/free-solid-svg-icons'
import { faHeart as faHeartRegular } from '@fortawesome/free-regular-svg-icons'
import styles from './HeartButton.module.css'

interface Props {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  className?: string
  activeClassName?: string
  title?: string
}

export function HeartButton({ active, onClick, className = '', activeClassName = '', title }: Props) {
  const [burst, setBurst] = useState(false)
  const shown = active || burst

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!active && !burst) {
      setBurst(true)
      setTimeout(() => setBurst(false), 550)
    }
    onClick(e)
  }, [active, burst, onClick])

  return (
    <button
      className={`${className} ${shown ? activeClassName : ''}`}
      onClick={handleClick}
      title={title}
    >
      <span className={`${styles.wrap} ${burst ? styles.burst : ''}`}>
        <FontAwesomeIcon icon={shown ? faHeartSolid : faHeartRegular} />
      </span>
    </button>
  )
}
