import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Browser, Page } from 'puppeteer'
import { launchBrowser, newPage, loginViaUI, BASE, ADMIN_USER, ADMIN_PASS, exists, waitForIdle } from '../helpers'

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await launchBrowser()
  page = await newPage(browser)
  await loginViaUI(page, ADMIN_USER, ADMIN_PASS)
}, 30_000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
})

describe('Player Page E2E', () => {
  describe('Layout', () => {
    it('should render sidebar with Queue and Library tabs', async () => {
      const pageText = await page.evaluate(() => document.body.textContent || '')
      expect(pageText).toContain('Queue')
      expect(pageText).toContain('Library')
    })

    it('should render header with profile link', async () => {
      const hasProfile = await exists(page, '[class*="avatarCircle"]')
      expect(hasProfile).toBe(true)
    })

    it('should show main content area', async () => {
      // Either lyrics are displayed (song playing) or suggested songs are shown (no song)
      const hasContent = await page.evaluate(() => {
        const main = document.querySelector('main')
        return main !== null && (main.textContent || '').length > 0
      })
      expect(hasContent).toBe(true)
    })

    it('should render playback controls', async () => {
      const hasControls = await exists(page, '[class*="controls"]')
      expect(hasControls).toBe(true)
    })
  })

  describe('Search', () => {
    it('should have a search input', async () => {
      const hasSearch = await exists(page, 'input[placeholder*="Search"]')
      expect(hasSearch).toBe(true)
    })

    it('should show search results on typing', async () => {
      // Set search value via React-compatible programmatic approach
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        if (!input) return
        input.focus()
        // Use native setter to bypass React's controlled value
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        nativeSetter.call(input, 'shape of you')
        // Reset React's internal value tracker so it detects the change
        const tracker = (input as any)._valueTracker
        if (tracker) tracker.setValue('')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })

      // Wait for search results to appear (debounce 300ms + API call)
      await page.waitForSelector('[class*="resultItem"]', { timeout: 10000 })

      const resultCount = await page.evaluate(() =>
        document.querySelectorAll('[class*="resultItem"]').length
      )
      expect(resultCount).toBeGreaterThan(0)

      // Clear search using the X button
      const clearBtn = await page.$('[class*="clear"]')
      if (clearBtn) {
        await clearBtn.click()
      }
      await waitForIdle(page, 500)
    })

    it('should not search for single character', async () => {
      // Set input to single char using React-compatible approach
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        if (!input) return
        input.focus()
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        nativeSetter.call(input, 'a')
        const tracker = (input as any)._valueTracker
        if (tracker) tracker.setValue('')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await waitForIdle(page, 1500)

      const resultCount = await page.evaluate(() =>
        document.querySelectorAll('[class*="resultItem"]').length
      )
      expect(resultCount).toBe(0)

      // Clear
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        if (!input) return
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        nativeSetter.call(input, '')
        const tracker = (input as any)._valueTracker
        if (tracker) tracker.setValue('x')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await waitForIdle(page, 500)
    })

    it('should add song to queue when clicking a search result', async () => {
      // Search using React-compatible approach
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        if (!input) return
        input.focus()
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        nativeSetter.call(input, 'bohemian rhapsody')
        const tracker = (input as any)._valueTracker
        if (tracker) tracker.setValue('')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })

      // Wait for results
      await page.waitForSelector('[class*="resultItem"]', { timeout: 10000 })

      // Click first result
      const clicked = await page.evaluate(() => {
        const item = document.querySelector('[class*="resultItem"]')
        if (item) {
          (item as HTMLElement).click()
          return true
        }
        return false
      })

      if (clicked) {
        await waitForIdle(page, 2000)

        // Switch to Queue tab to see the added item
        await page.evaluate(() => {
          const tabs = document.querySelectorAll('[class*="tab"]')
          for (const tab of tabs) {
            if (tab.textContent?.trim() === 'Queue') {
              (tab as HTMLElement).click()
              break
            }
          }
        })
        await waitForIdle(page, 500)

        // Check for queue items using draggable attribute
        const queueItems = await page.evaluate(() =>
          document.querySelectorAll('[draggable="true"]').length
        )
        expect(queueItems).toBeGreaterThanOrEqual(1)
      }

      // Clear search
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        if (!input) return
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        nativeSetter.call(input, '')
        const tracker = (input as any)._valueTracker
        if (tracker) tracker.setValue('x')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await waitForIdle(page, 500)
    })
  })

  describe('Queue Panel', () => {
    it('should have Random button', async () => {
      // Ensure Queue tab is active
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="tab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Queue') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 500)

      const hasRandom = await exists(page, 'button[title="Random"]')
      expect(hasRandom).toBe(true)
    })
  })

  describe('Sidebar tabs', () => {
    it('should switch between Queue and Library tabs', async () => {
      // Click Library tab
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="tab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Library') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 1500)

      const hasLibraryContent = await page.evaluate(() =>
        document.querySelector('[class*="filterInput"], [class*="grid"], [class*="emptyState"]') !== null
      )
      expect(hasLibraryContent).toBe(true)

      // Click Queue tab back
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[class*="tab"]')
        for (const tab of tabs) {
          if (tab.textContent?.trim() === 'Queue') {
            (tab as HTMLElement).click()
            break
          }
        }
      })
      await waitForIdle(page, 500)
    })
  })

  describe('Theme toggle', () => {
    it('should toggle between dark and light mode', async () => {
      const themeBefore = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme')
      )

      // Click the theme toggle button directly (standalone button in header)
      await page.evaluate(() => {
        const btn = document.querySelector('button[title="Toggle Theme"]') as HTMLElement
        if (btn) btn.click()
      })
      await waitForIdle(page, 500)

      const themeAfter = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme')
      )
      expect(themeAfter).not.toBe(themeBefore)

      // Toggle back
      await page.evaluate(() => {
        const btn = document.querySelector('button[title="Toggle Theme"]') as HTMLElement
        if (btn) btn.click()
      })
      await waitForIdle(page, 300)
    })
  })

  describe('Volume controls', () => {
    it('should have vocal and instrumental volume sliders', async () => {
      const sliders = await page.evaluate(() =>
        document.querySelectorAll('input[type="range"]').length
      )
      expect(sliders).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Header actions', () => {
    it('should show profile link and logout button', async () => {
      // Profile chip links to /profile
      const profileLink = await page.evaluate(() => {
        const el = document.querySelector('[class*="avatarCircle"]') as HTMLAnchorElement
        return el ? { text: el.textContent || '', href: el.getAttribute('href') || '' } : null
      })
      expect(profileLink).not.toBeNull()
      expect(profileLink!.href).toContain('/profile')

      // Logout button exists
      const hasLogout = await exists(page, 'button[title="Logout"]')
      expect(hasLogout).toBe(true)

      // Theme toggle exists
      const hasTheme = await exists(page, 'button[title="Toggle Theme"]')
      expect(hasTheme).toBe(true)
    })
  })
})
