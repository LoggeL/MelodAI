import type { ResplitBatchStatus, SeparationStatus } from '../../types'

/** One-line progress summary of the stem re-split batch, e.g. "12 of 213 songs processed · 1 failed". */
export function resplitSummary(batch: ResplitBatchStatus): string {
  if (batch.status === 'idle' || batch.total === 0) return 'No re-split has run yet.'
  const done = batch.counts.done ?? 0
  const skipped = batch.counts.skipped ?? 0
  const failed = batch.counts.failed ?? 0
  const processed = done + skipped + failed
  const parts = [`${processed} of ${batch.total} ${batch.total === 1 ? 'song' : 'songs'} processed`]
  if (done) parts.push(`${done} re-split`)
  if (skipped) parts.push(`${skipped} already current`)
  if (failed) parts.push(`${failed} failed`)
  return parts.join(' · ')
}

export type ResplitAction = 'start' | 'resume' | 'stop' | null

/** Which control the panel offers for the current state. */
export function resplitAction(status: SeparationStatus): ResplitAction {
  const batch = status.batch
  if (batch.status === 'running') return 'stop'
  if (status.split_backend !== 'local') return null
  if ((batch.status === 'stopped' || batch.status === 'error') && (batch.counts.pending ?? 0) > 0) return 'resume'
  return 'start'
}

export function workerLabel(status: SeparationStatus): string {
  if (status.split_backend !== 'local') return 'Local separation is off; new songs use Replicate Demucs.'
  const worker = status.worker
  if (!worker.available) return `Local worker unavailable${worker.error ? ` (${worker.error})` : ''}; new songs fall back to Replicate Demucs.`
  const info = worker.info ?? {}
  const detail = [info.model, info.compute_backend, info.precision].filter(Boolean).join(', ')
  return `Local worker ${worker.state}${detail ? ` · ${detail}` : ''}`
}
