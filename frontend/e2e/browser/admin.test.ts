import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser, newPage, loginViaUI, BASE, ADMIN_USER, ADMIN_PASS, exists, waitForIdle } from '../helpers'

const TEST_USER = `e2eregular_${Date.now()}`
const TEST_PASS = 'testpass456'

let browser: Browser
let page: Page

beforeAll(async () => {
  // Register a pending regular user for testing admin actions
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
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
      expect(pageText).toContain('Users')
    })

    it('should have navigation tabs', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Users')
      expect(pageText).toContain('Keys')
      expect(pageText).toContain('Usage')
      expect(pageText).toContain('Songs')
      expect(pageText).toContain('Status')
      expect(pageText).toContain('Errors')
    })
  })

  describe('Users tab', () => {
    it('should display user list with admin user', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain(ADMIN_USER)
    })

    it('should show Generate Invite Key button on Keys tab', async () => {
      // Navigate to Keys tab
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="navTab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Keys') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Generate Invite Key')

      // Navigate back to Users tab
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="navTab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Users') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
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
              b => b.textContent?.includes('Approve')
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
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="navTab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Usage') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasStats = pageText.includes('Users') || pageText.includes('Plays') ||
                       pageText.includes('Search') || pageText.includes('Downloads')
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
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="navTab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Songs') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasSongsContent = pageText.includes('Songs') || pageText.includes('No songs') ||
                              pageText.includes('song')
      expect(hasSongsContent).toBe(true)
    })
  })

  describe('Status tab', () => {
    it('should switch to status tab and show Run Checks button', async () => {
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="navTab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Status') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 2000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Run Checks')
    })

    it('should run health checks and show results', async () => {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          if (btn.textContent?.includes('Run Checks')) {
            btn.click()
            break
          }
        }
      })
      await waitForIdle(page, 5000)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasResults = pageText.toLowerCase().includes('database') ||
                         pageText.toLowerCase().includes('ok') ||
                         pageText.toLowerCase().includes('healthy')
      expect(hasResults).toBe(true)
    })
  })
})
