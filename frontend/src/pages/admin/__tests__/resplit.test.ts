import { describe, expect, it } from 'vitest'
import type { SeparationStatus } from '../../../types'
import { resplitAction, resplitSummary, workerLabel } from '../resplit'

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
    expect(resplitSummary(status({}).batch)).toBe('No re-split has run yet.')
    expect(resplitSummary(status({ status: 'running', total: 213, counts: { done: 10, skipped: 2, failed: 1, pending: 200 } }).batch))
      .toBe('13 of 213 songs processed · 10 re-split · 2 already current · 1 failed')
    expect(resplitSummary(status({ status: 'done', total: 1, counts: { done: 1 } }).batch)).toBe('1 of 1 song processed · 1 re-split')
  })

  it('offers start, resume or stop', () => {
    expect(resplitAction(status({}))).toBe('start')
    expect(resplitAction(status({ status: 'running', total: 3, counts: { pending: 3 } }))).toBe('stop')
    expect(resplitAction(status({ status: 'stopped', total: 3, counts: { pending: 2, done: 1 } }))).toBe('resume')
    expect(resplitAction(status({ status: 'error', total: 3, counts: { done: 3 } }))).toBe('start')
    expect(resplitAction(status({}, { split_backend: 'replicate' }))).toBeNull()
  })

  it('describes the worker', () => {
    expect(workerLabel(status({}))).toBe('Local worker ready · resurrection, kernels, bf16')
    expect(workerLabel(status({}, { worker: { available: false, state: 'stopped', error: 'turbo-roformer is not installed' } })))
      .toBe('Local worker unavailable (turbo-roformer is not installed); new songs fall back to Replicate Demucs.')
    expect(workerLabel(status({}, { split_backend: 'replicate' }))).toBe('Local separation is off; new songs use Replicate Demucs.')
  })
})
