import { describe, expect, it } from 'vitest'
import type { SeparationStatus } from '../../../types'
import { resplitAction, resplitDetail, resplitSummary, workerLabel } from '../resplit'

function status(batch: Partial<SeparationStatus['batch']>, extra: Partial<SeparationStatus> = {}): SeparationStatus {
  return {
    split_backend: 'local',
    package_version: '0.1.0',
    worker: { available: true, state: 'ready', info: { model: 'resurrection', compute_backend: 'kernels', precision: 'bf16' } },
    batch: { status: 'idle', running: false, total: 0, counts: {}, current: null, failures: [], ...batch },
    ...extra,
  }
}

describe('re-split panel helpers', () => {
  it('summarises progress', () => {
    expect(resplitSummary(status({}).batch)).toBe('Bisher lief noch keine Neutrennung.')
    expect(resplitSummary(status({ status: 'running', total: 213, counts: { done: 10, skipped: 2, failed: 1, pending: 200 } }).batch))
      .toBe('13 von 213 Songs verarbeitet · 10 neu getrennt · 2 schon aktuell · 1 fehlgeschlagen')
    expect(resplitSummary(status({ status: 'done', total: 1, counts: { done: 1 } }).batch)).toBe('1 von 1 Song verarbeitet · 1 neu getrennt')
  })

  it('offers start, resume or stop', () => {
    expect(resplitAction(status({}))).toBe('start')
    expect(resplitAction(status({ status: 'running', running: true, total: 3, counts: { pending: 3 } }))).toBe('stop')
    expect(resplitAction(status({ status: 'running', running: false, total: 3, counts: { pending: 3 } }))).toBe('resume')
    expect(resplitAction(status({ status: 'stopped', total: 3, counts: { pending: 2, done: 1 } }))).toBe('resume')
    expect(resplitAction(status({ status: 'error', total: 3, counts: { done: 3 } }))).toBe('start')
    expect(resplitAction(status({}, { split_backend: 'replicate' }))).toBeNull()
  })

  it('describes the worker', () => {
    expect(workerLabel(status({}))).toBe('Lokaler Worker bereit · resurrection, kernels, bf16')
    expect(workerLabel(status({}, { worker: { available: false, state: 'stopped', error: 'turbo-roformer is not installed' } })))
      .toBe('Lokaler Worker nicht verfügbar (turbo-roformer is not installed). Die Verarbeitung ist angehalten.')
    expect(workerLabel(status({}, { split_backend: 'replicate' }))).toBe('Lokale Stimmtrennung ist nicht verfügbar. Die Verarbeitung ist angehalten.')
  })

  it('translates the per-song progress detail', () => {
    expect(resplitDetail('Separating vocals (3/12)...')).toBe('Trennt Gesang (3/12) …')
    expect(resplitDetail('Waiting in queue (position 2)...')).toBe('Wartet in der Warteschlange (Platz 2) …')
    expect(resplitDetail('Loading separation model...')).toBe('Lädt das Trennmodell …')
    expect(resplitDetail('something new')).toBe('something new')
  })
})
