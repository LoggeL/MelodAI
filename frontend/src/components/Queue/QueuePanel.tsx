import { useState, type CSSProperties } from 'react'
import { Icon } from '../common/Icon'
import { Cover } from '../common/Cover'
import type { QueueItem } from '../../types'
import { pipelineLabel } from '../../utils/pipeline'
import { formatDuration } from '../../utils/format'
import styles from './QueuePanel.module.css'

interface Props {
  queue: QueueItem[]
  currentIndex: number
  onPlay: (index: number) => void
  onRemove: (index: number) => void
  onReorder: (from: number, to: number) => void
  onRetry: (index: number) => void
  onRandom: () => void
  /** Opens the search from the empty state. */
  onSearch?: () => void
}

/** Setlist rows (§5.5). The header with the actions lives in SetlistHead. */
export function QueuePanel({ queue, currentIndex, onPlay, onRemove, onReorder, onRetry, onRandom, onSearch }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  if (queue.length === 0) {
    return (
      <div className="emptyState">
        <Icon name="queue" size={48} />
        <h3>Die Setlist ist leer.</h3>
        <p>Such dir einen Song aus oder lass den Zufall entscheiden.</p>
        <div className="actions">
          {onSearch && <button type="button" className="btn btn--primary" onClick={onSearch}><Icon name="search" /> Song suchen</button>}
          <button type="button" className="btn" onClick={onRandom}><Icon name="dice" /> Zufälligen Song hinzufügen</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <ol className={styles.list} aria-label="Setlist">
        {queue.map((item, i) => {
          const isActive = i === currentIndex
          const processing = !item.ready && !item.error
          const cls = [
            styles.item,
            isActive ? styles.active : '',
            item.error ? styles.error : '',
            processing ? styles.processing : '',
            dragIdx === i ? styles.dragging : '',
            dragOverIdx === i ? styles.dragOver : '',
          ].filter(Boolean).join(' ')
          const state = isActive ? ', läuft gerade' : item.error ? ', Fehler' : processing ? `, ${pipelineLabel(item.status, item.progress)}` : ''

          return (
            <li
              key={item.id + '-' + i}
              className={cls}
              tabIndex={0}
              aria-label={`${i + 1}. ${item.title}${item.artist ? ` von ${item.artist}` : ''}${state}`}
              aria-current={isActive ? 'true' : undefined}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return
                if ((event.key === 'Enter' || event.key === ' ') && item.ready) { event.preventDefault(); onPlay(i) }
                if (event.altKey && event.key === 'ArrowUp' && i > 0) { event.preventDefault(); onReorder(i, i - 1) }
                if (event.altKey && event.key === 'ArrowDown' && i < queue.length - 1) { event.preventDefault(); onReorder(i, i + 1) }
              }}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={e => {
                e.preventDefault()
                if (dragIdx !== null && dragIdx !== i) onReorder(dragIdx, i)
                setDragIdx(null)
                setDragOverIdx(null)
              }}
              onClick={() => item.ready && onPlay(i)}
            >
              <span className={styles.grip} aria-hidden="true"><Icon name="grip" size={16} /></span>
              <span className={styles.pos} aria-hidden="true">
                {isActive ? <span className={styles.eqBars}><i /><i /><i /></span> : String(i + 1).padStart(2, '0')}
              </span>
              <Cover className={styles.thumb} src={item.thumbnail} />
              <span className={styles.info}>
                <span className={styles.title}>{item.title}</span>
                <span className={styles.artist}>{item.artist}</span>
                {processing && <span className={`meter meter--inst meter--thin ${styles.bar}`} aria-hidden="true"><i style={{ '--v': `${item.progress}%` } as CSSProperties} /></span>}
              </span>
              <span className={styles.slot} onClick={e => e.stopPropagation()}>
                {isActive && <span className="chip chip--live chip--solid">Läuft</span>}
                {processing && <span className="chip chip--work">{Math.round(item.progress)} %</span>}
                {!isActive && !processing && !item.error && !!item.duration && (
                  <span className={styles.duration} aria-label={`Dauer ${formatDuration(item.duration)}`}>{formatDuration(item.duration)}</span>
                )}
                {item.error && (
                  <button type="button" className="btn btn--sm" onClick={() => onRetry(i)} aria-label={`${item.title} erneut versuchen`}>
                    <Icon name="redo" size={16} /> Erneut
                  </button>
                )}
                {(!isActive || item.error) && (
                  <button type="button" className={`iconbtn iconbtn--sm ${styles.remove}`} onClick={() => onRemove(i)}
                    title="Entfernen" aria-label={`${item.title} aus der Setlist entfernen`}>
                    <Icon name="x" size={18} />
                  </button>
                )}
              </span>
              {item.error && <span className={styles.errorLine}>Konnte nicht vorbereitet werden.</span>}
            </li>
          )
        })}
      </ol>
      <p className={styles.hint}>Ziehen oder Alt + ↑↓ zum Sortieren</p>
    </>
  )
}
