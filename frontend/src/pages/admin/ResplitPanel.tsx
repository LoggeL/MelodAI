import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { admin } from '../../services/api'
import type { SeparationStatus } from '../../types'
import { Icon } from '../../components/common/Icon'
import { errorMessage } from '../account/errors'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { resplitAction, resplitDetail, resplitSummary, workerLabel } from './resplit'
import styles from '../AdminPage.module.css'

/** Status and controls for re-splitting every song's stems with the local separation model. */
export function ResplitPanel({ onFinished }: { onFinished?: () => void }) {
  const [status, setStatus] = useState<SeparationStatus | null>(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const wasRunning = useRef(false)
  const headingId = useId()
  const load = useCallback(async () => {
    try {
      const next = await admin.separation()
      setStatus(next)
      setError('')
      if (wasRunning.current && next.batch.status !== 'running') onFinished?.()
      wasRunning.current = next.batch.status === 'running'
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [onFinished])
  useEffect(() => { void load() }, [load])
  const running = status?.batch.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { void load() }, 5000)
    return () => clearInterval(timer)
  }, [running, load])

  if (!status) return error ? <p className={styles.alert} role="alert">Status der Stimmtrennung nicht verfügbar: {error}</p> : null
  const batch = status.batch
  const action = resplitAction(status)
  const failed = batch.counts.failed ?? 0
  return <section className={styles.resplit} aria-labelledby={headingId}>
    <div className={styles.resplitInfo}>
      <div className={styles.resplitHead}>
        <h3 id={headingId}>Stimmtrennung erneuern</h3>
        <span className={`chip ${batch.status === 'running' ? 'chip--live' : batch.status === 'error' ? 'chip--err' : ''}`}>
          {batch.status === 'running' ? 'Läuft' : batch.status === 'stopped' ? 'Gestoppt' : batch.status === 'error' ? 'Fehler' : batch.status === 'done' ? 'Fertig' : 'Bereit'}
        </span>
      </div>
      <p className={styles.subtle}>{workerLabel(status)}</p>
      <p className={styles.resplitStatus} role="status">
        {resplitSummary(batch)}
        {batch.current && <> · jetzt: {batch.current.title} – {resplitDetail(batch.current.detail)}</>}
        {batch.status === 'error' && batch.error && <> · {batch.error}</>}
      </p>
      {failed > 0 && <details className={styles.detailBox}><summary>{failed} {failed === 1 ? 'Song' : 'Songs'} fehlgeschlagen (alte Stems bleiben)</summary>
        <ul>{batch.failures.map(f => <li key={f.track_id}>{f.title}: {f.error}</li>)}</ul>
      </details>}
    </div>
    <div className={styles.rowActions}>
      {action === 'stop' && <button type="button" className={styles.actionBtn} onClick={() => setConfirmation({
        title: 'Neutrennung stoppen?', description: 'Der aktuelle Song wird abgebrochen und behält seine alten Stems. Du kannst später weitermachen.',
        label: 'Neutrennung stoppen', tone: 'neutral', action: () => admin.stopResplit(), success: 'Neutrennung gestoppt.',
      })}><Icon name="x" size={16} /> Stoppen</button>}
      {(action === 'start' || action === 'resume') && <button type="button" className="btn btn--primary" disabled={!status.worker.available} onClick={() => setConfirmation({
        title: action === 'resume' ? 'Neutrennung fortsetzen?' : 'Alle Songs neu trennen?',
        description: 'Jeder Song wird mit dem lokalen Modell auf der Server-CPU neu getrennt, einer nach dem anderen (etwa 3 Minuten pro Song). Neue Anfragen von Nutzern gehen vor. Die bisherigen Stems bleiben als Sicherung, die Lyrics ändern sich nicht.',
        label: action === 'resume' ? 'Fortsetzen' : 'Neutrennung starten', tone: 'neutral', action: () => admin.startResplit(), success: action === 'resume' ? 'Neutrennung läuft weiter.' : 'Neutrennung gestartet.',
      })}><Icon name="redo" size={16} /> {action === 'resume' ? 'Neutrennung fortsetzen' : 'Alle Songs neu trennen'}</button>}
    </div>
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </section>
}
