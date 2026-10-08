import { LYRIC_SCALES } from '../../utils/lyricScale'
import styles from './LyricScale.module.css'

/** A−/A+ lyric size (0.85 / 1 / 1.2), persisted per device. */
export function LyricScale({ value, onChange, className }: { value: number; onChange: (scale: number) => void; className?: string }) {
  const index = Math.max(0, LYRIC_SCALES.findIndex(scale => scale === value))
  return (
    <div className={`seg ${styles.scale} ${className ?? ''}`} role="group" aria-label="Textgröße">
      <button type="button" disabled={index === 0} onClick={() => onChange(LYRIC_SCALES[index - 1])} aria-label="Text kleiner" title="Text kleiner">A−</button>
      <button type="button" disabled={index === LYRIC_SCALES.length - 1} onClick={() => onChange(LYRIC_SCALES[index + 1])} aria-label="Text größer" title="Text größer">A+</button>
    </div>
  )
}
