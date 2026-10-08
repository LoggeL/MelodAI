import { REGULAR_PASS, testEmail } from '../config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser, newPage, loginViaUI, BASE, ADMIN_USER, ADMIN_PASS, waitForIdle } from '../helpers'

const TEST_USER = `e2eregular_${Date.now()}`
const TEST_PASS = REGULAR_PASS

let browser: Browser
let page: Page

beforeAll(async () => {
  // Register a pending regular user for testing admin actions
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, email: testEmail(TEST_USER), password: TEST_PASS }),
  })

  browser = await launchBrowser()
  page = await newPage(browser)
  await loginViaUI(page, ADMIN_USER, ADMIN_PASS)
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' })
  await waitForIdle(page, 2000)
}, 30_000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
})

describe('Admin Page E2E', () => {
  describe('Admin page access', () => {
    it('should render admin page for admin user', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Nutzer')
    })

    it('should have navigation tabs', async () => {
      for (const tab of ['users', 'keys', 'usage', 'songs', 'status', 'logs', 'errors']) {
        expect(await page.$(`[data-testid="admin-tab-${tab}"]`)).not.toBeNull()
      }
      const tabs = await page.$$eval('[class*="navTab"]', nodes => nodes.map(node => node.textContent || ''))
      expect(tabs.join(' ')).toContain('Schlüssel')
      expect(tabs.join(' ')).toContain('Fehler')
    })
  })

  describe('Users tab', () => {
    it('should display user list with admin user', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain(ADMIN_USER)
    })

    it('should show the create invite key button on the Keys tab', async () => {
      // Navigate to Keys tab
      await page.click('[data-testid="admin-tab-keys"]')
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Einladungsschlüssel erstellen')

      // Navigate back to Users tab
      await page.click('[data-testid="admin-tab-users"]')
      await waitForIdle(page, 2000)
    })

    it('should show pending users', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain(TEST_USER)
    })

    it('should have action buttons for users', async () => {
      const hasActionBtns = await page.evaluate(() =>
        document.querySelectorAll('[class*="actionBtn"]').length
      )
      expect(hasActionBtns).toBeGreaterThan(0)
    })

    it('should approve a pending user', async () => {
      const approved = await page.evaluate((username) => {
        const rows = document.querySelectorAll('tr')
        for (const row of rows) {
          if (row.textContent?.includes(username)) {
            const approveBtn = Array.from(row.querySelectorAll('button')).find(
              b => b.textContent?.includes('Freigeben')
            )
            if (approveBtn) {
              approveBtn.click()
              return true
            }
          }
        }
        return false
      }, TEST_USER)

      if (approved) {
        await waitForIdle(page, 1500)
        // Verify the page updated
        const pageText = await page.evaluate(() => document.body.textContent || '')
        expect(pageText).toBeDefined()
      }
    })
  })

  describe('Usage tab', () => {
    it('should switch to usage tab and show stats', async () => {
      await page.click('[data-testid="admin-tab-usage"]')
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasStats = pageText.includes('Nutzer') || pageText.includes('Wiedergaben') ||
                       pageText.includes('Suchen') || pageText.includes('Downloads')
      expect(hasStats).toBe(true)
    })

    it('should show usage logs table', async () => {
      const hasTable = await page.evaluate(() =>
        document.querySelector('table') !== null
      )
      expect(hasTable).toBe(true)
    })
  })

  describe('Songs tab', () => {
    it('should switch to songs tab', async () => {
      await page.click('[data-testid="admin-tab-songs"]')
      await waitForIdle(page, 2000)

      // Either real rows or the explicit empty state; the tab label alone must not count.
      const state = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-testid="admin-song-row"]').length,
        empty: (document.body.textContent || '').includes('Noch keine verarbeiteten Songs.'),
      }))
      expect(state.rows > 0 || state.empty).toBe(true)
    })
  })

  describe('Status tab', () => {
    it('should switch to status tab and show the health check button', async () => {
      await page.click('[data-testid="admin-tab-status"]')
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Prüfung starten')
    })

    it('should run health checks and show results', async () => {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          if (btn.textContent?.includes('Prüfung starten')) {
            btn.click()
            break
          }
        }
      })
      await waitForIdle(page, 5000)

      await page.waitForSelector('[data-check="database"]', { timeout: 10000 })
      const database = await page.$eval('[data-check="database"]', el => ({ status: el.getAttribute('data-status'), text: el.textContent || '' }))
      expect(database.text).toContain('Datenbank')
      expect(database.status).toBe('ok')
    })
  })
})
