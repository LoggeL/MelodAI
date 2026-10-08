// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AboutPage } from '../AboutPage'

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

it('describes local separation with BS-RoFormer and Demucs only as fallback', async () => {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AboutPage))))
  const text = host.textContent ?? ''
  expect(text).toContain('BS-RoFormer trennt Gesang und Instrumental direkt auf dem Server-Prozessor')
  expect(text).toContain('Fällt der lokale Dienst aus, springt Demucs auf Replicate ein.')
  const link = host.querySelector<HTMLAnchorElement>('a[href="https://github.com/LoggeL/turbo-roformer"]')
  expect(link?.textContent).toBe('turbo-roformer')
  expect(link?.rel).toContain('noreferrer')
})

it('describes local transcription with WhisperX only as fallback', async () => {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AboutPage))))
  expect(host.textContent).toContain('Ersatz ist WhisperX auf Replicate.')
  expect(host.querySelector('a[href="https://github.com/LoggeL/turbo-lyrics"]')?.textContent).toBe('turbo-lyrics')
})
