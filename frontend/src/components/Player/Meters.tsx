import type { CSSProperties } from 'react'
import styles from './Meters.module.css'

/** Two mini level bars, red for Gesang and blue for Instrumental (§5.11). Decorative. */
export function Meters({ vocals, instrumental }: { vocals: number; instrumental: number }) {
  return (
    <span className={styles.meters} aria-hidden="true">
      <i style={{ '--v': `${vocals}%`, '--c': 'var(--vocal)' } as CSSProperties} />
      <i style={{ '--v': `${instrumental}%`, '--c': 'var(--inst)' } as CSSProperties} />
    </span>
  )
}
