import type { CSSProperties } from 'react'
import styles from './LyricsView.module.css'

interface Props {
  past: string
  active: string
  next: string
  /** Frozen sweep position on the active line, 0…1. */
  progress?: number
}

/** Static stage excerpt using the real lyric line styles (About page, docs). Decorative. */
export function LyricPreview({ past, active, next, progress = 0.6 }: Props) {
  const words = active.split(' ')
  const total = words.reduce((sum, word) => sum + word.length, 0)
  let seen = 0
  return (
    <div className={styles.preview} aria-hidden="true">
      <p className={`${styles.line} ${styles.linePast}`}>{past}</p>
      <p className={`${styles.line} ${styles.lineActive}`}>
        {words.map((word, index) => {
          const start = seen / total
          seen += word.length
          const end = seen / total
          const state = progress >= end ? styles.wordSung : progress > start ? styles.wordNow : ''
          const p = Math.min(1, Math.max(0, (progress - start) / (end - start)))
          const style = state === styles.wordNow ? { '--p': `${(p * 100).toFixed(1)}%`, '--p-num': p.toFixed(3) } as CSSProperties : undefined
          return <span key={index}><span className={`${styles.word} ${state}`} style={style}>{word}</span>{index < words.length - 1 ? ' ' : ''}</span>
        })}
      </p>
      <div className={styles.nextKicker}>Als Nächstes</div>
      <p className={`${styles.line} ${styles.lineNext}`}>{next}</p>
    </div>
  )
}
