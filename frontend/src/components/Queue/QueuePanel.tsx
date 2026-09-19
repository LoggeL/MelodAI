import { useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faMusic, faGripVertical, faRotateRight, faXmark,
  faDice, faShuffle, faTrashCan, faPlay, faVolumeHigh,
} from '@fortawesome/free-solid-svg-icons'
import { Modal } from '../common/Modal'
import type { QueueItem } from '../../types'
import styles from './QueuePanel.module.css'

interface Props {
  queue: QueueItem[]
  currentIndex: number
  onPlay: (index: number) => void
  onRemove: (index: number) => void
  onReorder: (from: number, to: number) => void
  onRetry: (index: number) => void
  onRandom: () => void
  onShuffle: () => void
  onClear: () => void
}

export function QueuePanel({
  queue, currentIndex, onPlay, onRemove, onReorder, onRetry,
  onRandom, onShuffle, onClear,
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleClear = useCallback(() => {
    if (queue.length === 0) return
    setShowConfirm(true)
  }, [queue])

  return (
    <>
      {queue.length > 0 && (
        <div className={styles.queueActions}>
          <span className={styles.queueCount}>{queue.length} song{queue.length !== 1 ? 's' : ''}</span>
          <div className={styles.actionBtns}>
            <button className={styles.actionBtn} onClick={onRandom} title="Add random song">
              <FontAwesomeIcon icon={faDice} />
            </button>
            <button className={styles.actionBtn} onClick={onShuffle} title="Shuffle queue">
              <FontAwesomeIcon icon={faShuffle} />
            </button>
            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={handleClear} title="Clear queue">
              <FontAwesomeIcon icon={faTrashCan} />
            </button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {queue.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><FontAwesomeIcon icon={faMusic} /></div>
            <h3>Nothing in queue</h3>
            <p>Search for a song or pick from the library</p>
          </div>
        )}
        {queue.map((item, i) => {
          const isActive = i === currentIndex
          const cls = [
            styles.item,
            isActive ? styles.active : '',
            item.error ? styles.error : '',
            !item.ready && !item.error ? styles.processing : '',
            dragIdx === i ? styles.dragging : '',
            dragOverIdx === i ? styles.dragOver : '',
          ].filter(Boolean).join(' ')

          return (
            <div
              key={item.id + '-' + i}
              className={cls}
              tabIndex={0}
              aria-label={`${item.title} by ${item.artist}${isActive ? ', current song' : ''}`}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) return
                if ((event.key === 'Enter' || event.key === ' ') && item.ready) { event.preventDefault(); onPlay(i) }
                if (event.altKey && event.key === 'ArrowUp' && i > 0) { event.preventDefault(); onReorder(i, i - 1) }
                if (event.altKey && event.key === 'ArrowDown' && i < queue.length - 1) { event.preventDefault(); onReorder(i, i + 1) }
              }}
              title="Enter to play. Alt + Up or Down to reorder."
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
              <div className={styles.grip}><FontAwesomeIcon icon={faGripVertical} /></div>

              <div className={styles.thumbWrap}>
                <img className={styles.thumb} src={item.thumbnail || '/logo.svg'} alt="" loading="lazy" />
                {isActive && (
                  <div className={styles.eqBars}>
                    <span /><span /><span />
                  </div>
                )}
                {!isActive && item.ready && (
                  <div className={styles.playOverlay}>
                    <FontAwesomeIcon icon={faPlay} />
                  </div>
                )}
              </div>

              <div className={styles.info}>
                <div className={styles.titleRow}>
                  {isActive && (
                    <FontAwesomeIcon icon={faVolumeHigh} className={styles.nowIcon} />
                  )}
                  <span className={styles.title}>{item.title}</span>
                </div>
                <div className={styles.artist}>{item.artist}</div>
                {item.error && <div className={styles.status} style={{ color: 'var(--danger)' }}>Error</div>}
                {!item.ready && !item.error && (
                  <>
                    <div className={styles.status}>{item.status}</div>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{ width: `${item.progress}%` }} />
                    </div>
                  </>
                )}
              </div>

              <div className={styles.actions} onClick={e => e.stopPropagation()}>
                {item.error && (
                  <button className={styles.removeBtn} onClick={() => onRetry(i)} title="Retry" aria-label={`Retry ${item.title}`}>
                    <FontAwesomeIcon icon={faRotateRight} />
                  </button>
                )}
                {!isActive && (
                  <button className={styles.removeBtn} onClick={() => onRemove(i)} title="Remove" aria-label={`Remove ${item.title} from queue`}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {showConfirm && (
        <Modal title="Clear queue?" size="small" onClose={() => setShowConfirm(false)}
          footer={<>
            <button className="button" onClick={() => setShowConfirm(false)}>Cancel</button>
            <button className="button button-danger" onClick={() => { onClear(); setShowConfirm(false) }}>Clear queue</button>
          </>}>
          <p>Remove all songs except the currently selected one?</p>
        </Modal>
      )}
    </>
  )
}
