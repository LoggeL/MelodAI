import { useCallback, useEffect, useRef, useState } from 'react'
import { admin } from '../../services/api'
import type { SeparationStatus } from '../../types'
import { errorMessage } from '../account/errors'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { resplitAction, resplitSummary, workerLabel } from './resplit'
import styles from '../AdminPage.module.css'

/** Status and controls for re-splitting every song's stems with the local separation model. */
export function ResplitPanel({ onFinished }: { onFinished?: () => void }) {
  const [status, setStatus] = useState<SeparationStatus | null>(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const wasRunning = useRef(false)
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

  if (!status) return error ? <p className={styles.subtle} role="alert">Separation status unavailable: {error}</p> : null
  const batch = status.batch
  const action = resplitAction(status)
  const failed = batch.counts.failed ?? 0
  return <div className={styles.filters} aria-label="Stem re-split">
    <div>
      <div><strong>Stem re-split</strong> <span className={styles.subtle}>{workerLabel(status)}</span></div>
      <div className={styles.subtle} role="status">
        {resplitSummary(batch)}
        {batch.current && <> · now: {batch.current.title} — {batch.current.detail}</>}
        {batch.status === 'stopped' && ' · stopped'}
        {batch.status === 'error' && batch.error && <> · {batch.error}</>}
      </div>
      {failed > 0 && <details className={styles.subtle}><summary>{failed} failed {failed === 1 ? 'song' : 'songs'} (old stems kept)</summary>
        <ul>{batch.failures.map(f => <li key={f.track_id}>{f.title}: {f.error}</li>)}</ul>
      </details>}
    </div>
    {action === 'stop' && <button className={styles.actionBtn} onClick={() => setConfirmation({
      title: 'Stop the re-split?', description: 'The current song is abandoned and keeps its old stems. You can resume later.',
      label: 'Stop re-split', action: () => admin.stopResplit(), success: 'Re-split stopped',
    })}>Stop</button>}
    {(action === 'start' || action === 'resume') && <button className={styles.primaryBtn} disabled={!status.worker.available} onClick={() => setConfirmation({
      title: action === 'resume' ? 'Resume the re-split?' : 'Re-split all songs?',
      description: 'Each song is separated again with the local model on the server CPU, one song at a time (about 3 minutes per song). New user requests go first. Previous stems are kept as a backup and lyrics are not changed.',
      label: action === 'resume' ? 'Resume re-split' : 'Start re-split', action: () => admin.startResplit(), success: action === 'resume' ? 'Re-split resumed' : 'Re-split started',
    })}>{action === 'resume' ? 'Resume re-split' : 'Re-split all songs'}</button>}
    {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
  </div>
}
