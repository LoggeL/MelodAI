import type { ResplitBatchStatus, SeparationStatus } from '../../types'
import { formatInt } from '../../utils/format'

/** One-line progress summary of the stem re-split batch, e.g. „12 von 213 Songs verarbeitet · 1 fehlgeschlagen“. */
export function resplitSummary(batch: ResplitBatchStatus): string {
  if (batch.status === 'idle' || batch.total === 0) return 'Bisher lief noch keine Neutrennung.'
  const done = batch.counts.done ?? 0
  const skipped = batch.counts.skipped ?? 0
  const failed = batch.counts.failed ?? 0
  const processed = done + skipped + failed
  const parts = [`${formatInt(processed)} von ${formatInt(batch.total)} ${batch.total === 1 ? 'Song' : 'Songs'} verarbeitet`]
  if (done) parts.push(`${formatInt(done)} neu getrennt`)
  if (skipped) parts.push(`${formatInt(skipped)} schon aktuell`)
  if (failed) parts.push(`${formatInt(failed)} fehlgeschlagen`)
  return parts.join(' · ')
}

export type ResplitAction = 'start' | 'resume' | 'stop' | null

/** Which control the panel offers for the current state. */
export function resplitAction(status: SeparationStatus): ResplitAction {
  const batch = status.batch
  // "running" on disk without a live runner (e.g. the resume lost a race during a deploy): offer to resume it.
  if (batch.status === 'running' && batch.running) return 'stop'
  if (status.split_backend !== 'local') return null
  if (batch.status === 'running' && (batch.counts.pending ?? 0) > 0) return 'resume'
  if ((batch.status === 'stopped' || batch.status === 'error') && (batch.counts.pending ?? 0) > 0) return 'resume'
  return 'start'
}

const WORKER_STATES: Record<string, string> = {
  ready: 'bereit', idle: 'im Leerlauf', loading: 'lädt das Modell', starting: 'startet', running: 'arbeitet',
  busy: 'arbeitet', stopped: 'gestoppt', failed: 'fehlgeschlagen',
}

/** German name of a worker state; unknown states pass through. */
export function workerState(state: string | undefined): string {
  return (state && WORKER_STATES[state]) || state || 'unbekannt'
}

export function workerLabel(status: SeparationStatus): string {
  if (status.split_backend !== 'local') return 'Lokale Trennung ist aus. Neue Songs nutzen Replicate Demucs.'
  const worker = status.worker
  if (!worker.available) return `Lokaler Worker nicht verfügbar${worker.error ? ` (${worker.error})` : ''}. Neue Songs nutzen ersatzweise Replicate Demucs.`
  const info = worker.info ?? {}
  const detail = [info.model, info.compute_backend, info.precision].filter(Boolean).join(', ')
  return `Lokaler Worker ${workerState(worker.state)}${detail ? ` · ${detail}` : ''}`
}

/** The batch runner reports per-song progress in English; map the known shapes. */
export function resplitDetail(detail: string): string {
  const text = detail.trim()
  const queued = text.match(/^Waiting in queue \(position (\d+)\)\.\.\.$/)
  if (queued) return `Wartet in der Warteschlange (Platz ${queued[1]}) …`
  const progress = text.match(/^Separating vocals \((\d+)\/(\d+)\)\.\.\.$/)
  if (progress) return `Trennt Gesang (${progress[1]}/${progress[2]}) …`
  const known: Record<string, string> = {
    'Waiting for the worker...': 'Wartet auf den Worker …',
    'Waiting in queue...': 'Wartet in der Warteschlange …',
    'Loading separation model...': 'Lädt das Trennmodell …',
    'Separating vocals...': 'Trennt Gesang …',
  }
  return known[text] ?? text
}
