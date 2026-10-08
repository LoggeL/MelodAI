// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StageError } from '../StageStatus'
import type { QueueItem } from '../../../types'

const track: QueueItem = { id: '7', title: 'Demo-Song', artist: 'Die Testband', thumbnail: '', ready: true, status: 'error', progress: 0, error: true, vocalsUrl: '', musicUrl: '', lyricsUrl: '' }
let root: Root
let host: HTMLElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('offers retrying and removing the failed song', async () => {
  const onRetry = vi.fn()
  const onRemove = vi.fn()
  await act(async () => root.render(createElement(StageError, { track, onRetry, onRemove })))
  const buttons = [...host.querySelectorAll('button')]
  expect(buttons.map(button => button.textContent?.trim())).toEqual(['Erneut versuchen', 'Aus der Setlist entfernen'])
  await act(async () => buttons[1].click())
  expect(onRemove).toHaveBeenCalledTimes(1)
  expect(onRetry).not.toHaveBeenCalled()
})
