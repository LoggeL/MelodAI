// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DailyUsageTable } from '../UsageTab'

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

it('lists one row per day with estimated credits', async () => {
  await act(async () => root.render(createElement(DailyUsageTable, { days: [
    { day: '2026-10-08', plays: 12, searches: 3, downloads: 2, credits: 1234 },
    { day: '2026-10-07', plays: 0, searches: 0, downloads: 0, credits: 0 },
  ] })))
  const rows = [...host.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))
  expect(rows).toEqual([
    ['Do., 08.10.', '12', '3', '2', '−1.234'],
    ['Mi., 07.10.', '0', '0', '0', '0'],
  ])
  expect(host.textContent).toContain('Letzte 2 Tage')
})

it('shows the empty state when nothing happened', async () => {
  await act(async () => root.render(createElement(DailyUsageTable, { days: [{ day: '2026-10-08', plays: 0, searches: 0, downloads: 0, credits: 0 }] })))
  expect(host.querySelector('table')).toBeNull()
  expect(host.textContent).toContain('Keine Einträge.')
})
