import { useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMusic, faGripVertical, faRotateRight, faXmark, faDice, faShuffle, faTrashCan } from '@fortawesome/free-solid-svg-icons'
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
      <div className={styles.list}>
        {queue.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}><FontAwesomeIcon icon={faMusic} /></div>
            <h3>Queue is empty</h3>
            <p>Search for a song to get started</p>
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
              <img className={styles.thumb} src={item.thumbnail || '/logo.svg'} alt="" loading="lazy" />
              <div className={styles.info}>
                <div className={styles.title}>{item.title}</div>
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
                  <button className={styles.removeBtn} onClick={() => onRetry(i)} title="Retry">
                    <FontAwesomeIcon icon={faRotateRight} />
                  </button>
                )}
                {!isActive && (
                  <button className={styles.removeBtn} onClick={() => onRemove(i)} title="Remove">
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className={styles.queueActions}>
        <button className={styles.actionBtn} onClick={onRandom} title="Random">
          <FontAwesomeIcon icon={faDice} />
        </button>
        <button className={styles.actionBtn} onClick={onShuffle} title="Shuffle">
          <FontAwesomeIcon icon={faShuffle} />
        </button>
        <button className={styles.actionBtn} onClick={handleClear} title="Clear">
          <FontAwesomeIcon icon={faTrashCan} />
        </button>
      </div>

      {showConfirm && (
        <div className={styles.modalBackdrop} onClick={() => setShowConfirm(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalIcon}>
              <FontAwesomeIcon icon={faTrashCan} />
            </div>
            <h3 className={styles.modalTitle}>Clear Queue?</h3>
            <p className={styles.modalText}>
              Remove all songs except the currently playing one?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalBtn} onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className={`${styles.modalBtn} ${styles.modalBtnDanger}`} onClick={() => { onClear(); setShowConfirm(false) }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
