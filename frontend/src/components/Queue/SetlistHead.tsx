import { useState } from 'react'
import { Icon } from '../common/Icon'
import { Modal } from '../common/Modal'
import styles from './QueuePanel.module.css'

interface Props {
  count: number
  onRandom: () => void
  onShuffle: () => void
  onClear: () => void
}

/** Setlist panel header (§5.5): title, count and the three `actionBtn` buttons. */
export function SetlistHead({ count, onRandom, onShuffle, onClear }: Props) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={styles.head}>
      <div className={styles.headTitle}>
        <h2 className={styles.heading}>Setlist</h2>
        <span className={styles.count}>{count} {count === 1 ? 'Song' : 'Songs'}</span>
      </div>
      <div className={styles.actionBtns}>
        <button type="button" className={`iconbtn ${styles.actionBtn}`} onClick={onRandom} data-testid="random-song"
          title="Zufälligen Song hinzufügen" aria-label="Zufälligen Song hinzufügen">
          <Icon name="dice" />
        </button>
        <button type="button" className={`iconbtn ${styles.actionBtn}`} onClick={onShuffle} disabled={count < 2}
          title="Mischen" aria-label="Setlist mischen">
          <Icon name="shuffle" />
        </button>
        <button type="button" className={`iconbtn ${styles.actionBtn}`} onClick={() => setConfirm(true)} disabled={count === 0}
          title="Leeren" aria-label="Setlist leeren">
          <Icon name="trash" />
        </button>
      </div>
      {confirm && (
        <Modal title="Setlist leeren?" size="small" onClose={() => setConfirm(false)}
          footer={<>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>Abbrechen</button>
            <button type="button" className="btn btn--danger-solid" onClick={() => { onClear(); setConfirm(false) }}>Setlist leeren</button>
          </>}>
          <p>Alle Songs außer dem aktuellen werden aus der Setlist entfernt.</p>
        </Modal>
      )}
    </div>
  )
}
