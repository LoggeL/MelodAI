import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser, newPage, BASE, ADMIN_USER, ADMIN_PASS, exists, waitForIdle } from '../helpers'

const TEST_USER = `e2euser_${Date.now()}`
const TEST_PASS = 'testpass456'

let browser: Browser

beforeAll(async () => {
  browser = await launchBrowser()
}, 30_000)

afterAll(async () => {
  await browser?.close()
})

describe('Auth E2E - Login Page', () => {
  describe('Page rendering', () => {
    it('should render the login page at /login', async () => {
      const page = await newPage(browser)
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })

      const hasUsername = await exists(page, 'input[name="username"]')
      const hasPassword = await exists(page, 'input[name="password"]')
      expect(hasUsername).toBe(true)
      expect(hasPassword).toBe(true)
      await page.close()
    })

    it('should have login and register tabs', async () => {
      const page = await newPage(browser)
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })

      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Login')
      expect(pageText).toContain('Register')
      await page.close()
    })

    it('should redirect unauthenticated user from / to /login', async () => {
      const page = await newPage(browser)
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' })
      await waitForIdle(page, 1500)

      expect(page.url()).toContain('/login')
      await page.close()
    })
  })

  describe('Login flow', () => {
    it('should show error for wrong credentials', async () => {
      // Use incognito context to avoid stale session cookies
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      await page.setViewport({ width: 1280, height: 800 })
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
      await waitForIdle(page, 500)

      await page.waitForSelector('input[name="username"]', { visible: true })
      await page.type('input[name="username"]', 'wronguser')
      await page.type('input[name="password"]', 'wrongpass')
      await page.click('button[type="submit"]')

      // Wait for the error message element to appear
      await page.waitForSelector('[class*="messageError"], [class*="message"]', { timeout: 5000 }).catch(() => {})
      await waitForIdle(page, 500)

      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasError = pageText.includes('Invalid') || pageText.includes('failed') || pageText.includes('Error')
      expect(hasError).toBe(true)
      await page.close()
      await context.close()
    })

    it('should login successfully and show profile button', async () => {
      const page = await newPage(browser)
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })

      await page.waitForSelector('input[name="username"]', { visible: true })
      await page.type('input[name="username"]', ADMIN_USER)
      await page.type('input[name="password"]', ADMIN_PASS)
      await page.click('button[type="submit"]')

      await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
      await waitForIdle(page, 2000)

      // Should see a profile link
      const hasProfile = await exists(page, '[class*="avatarCircle"]')
      expect(hasProfile).toBe(true)

      const profileText = await page.evaluate(() => {
        const el = document.querySelector('[class*="avatarCircle"]')
        return el?.textContent || ''
      })
      // Avatar shows the first letter initial
      expect(profileText.length).toBeGreaterThan(0)
      await page.close()
    })
  })

  describe('Register flow', () => {
    it('should register a new user and show pending message', async () => {
      // Use incognito context to avoid sharing cookies with login tests
      const context = await browser.createBrowserContext()
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      await page.setViewport({ width: 1280, height: 800 })
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
      await waitForIdle(page, 500)

      // Click the Register tab
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          if (btn.textContent?.trim() === 'Register') {
            btn.click()
            break
          }
        }
      })
      await waitForIdle(page, 1000)

      // Wait for the register form to render (it has an invite_key input)
      await page.waitForSelector('input[name="invite_key"]', { timeout: 5000 }).catch(() => {})

      // Fill the registration form
      const usernameInput = await page.$('input[name="username"]')
      if (usernameInput) {
        await usernameInput.click({ clickCount: 3 })
        await usernameInput.type(TEST_USER)
      }
      const passwordInput = await page.$('input[name="password"]')
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 })
        await passwordInput.type(TEST_PASS)
      }

      // Submit the registration form
      await page.click('button[type="submit"]')
      // Wait for message element to appear (success or error)
      await page.waitForSelector('[class*="message"]', { timeout: 10000 }).catch(() => {})
      await waitForIdle(page, 1000)

      const messageText = await page.evaluate(() => {
        const el = document.querySelector('[class*="message"]')
        return el?.textContent || ''
      })
      const pageText = await page.evaluate(() => document.body.textContent || '')
      const hasMessage = messageText.includes('pending') || messageText.includes('Waiting') ||
                         messageText.includes('approval') || messageText.includes('success') ||
                         pageText.includes('pending') || pageText.includes('Waiting') ||
                         pageText.includes('approval')
      expect(hasMessage).toBe(true)
      await page.close()
      await context.close()
    })
  })

  describe('Logout flow', () => {
    it('should logout via profile dropdown', async () => {
      const page = await newPage(browser)
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
      await waitForIdle(page, 1000)

      // Login if we see the form, otherwise we're already logged in
      const hasLoginForm = await exists(page, 'input[name="username"]')
      if (hasLoginForm) {
        await page.type('input[name="username"]', ADMIN_USER)
        await page.type('input[name="password"]', ADMIN_PASS)
        await page.click('button[type="submit"]')
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
        await waitForIdle(page, 2000)
      }

      // Click the logout button directly (standalone button in header)
      const logoutBtn = await page.$('button[title="Logout"]')
      expect(logoutBtn).not.toBeNull()
      await page.evaluate(() => {
        const btn = document.querySelector('button[title="Logout"]') as HTMLElement
        if (btn) btn.click()
      })
      await waitForIdle(page, 2000)

      // Should be back on login page
      expect(page.url()).toContain('/login')
      await page.close()
    })
  })
})
