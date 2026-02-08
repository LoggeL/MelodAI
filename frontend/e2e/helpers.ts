import puppeteer, { type Browser, type Page } from 'puppeteer'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'
const REGULAR_USER = 'testuser'
const REGULAR_PASS = 'testpass456'

export { BASE, ADMIN_USER, ADMIN_PASS, REGULAR_USER, REGULAR_PASS }

export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [
        process.env.CHROME_LIB_PATH || `${process.env.HOME}/.local/lib/chrome-deps/usr/lib/x86_64-linux-gnu`,
        process.env.LD_LIBRARY_PATH || '',
      ].filter(Boolean).join(':'),
    },
  })
}

export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(15000)
  await page.setViewport({ width: 1280, height: 800 })
  return page
}

/** Register a new user via API (bypasses UI) */
export async function registerUser(username: string, password: string, inviteKey = ''): Promise<{ success: boolean; is_admin?: boolean; pending?: boolean }> {
  const resp = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, invite_key: inviteKey }),
  })
  return resp.json()
}

/** Login via the UI form and return the page (now authenticated) */
export async function loginViaUI(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  // Make sure we're on the login tab
  await page.waitForSelector('input[name="username"]', { visible: true })
  await page.type('input[name="username"]', username)
  await page.type('input[name="password"]', password)
  await page.click('button[type="submit"]')
  // Wait for redirect to /
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {})
  // Give SPA time to load
  await page.waitForFunction(
    () => document.querySelector('[class*="avatarCircle"]') !== null,
    { timeout: 10000 }
  ).catch(() => {})
}

/** Login via API and set session cookie on the page */
export async function loginViaAPI(page: Page, username: string, password: string): Promise<void> {
  // Use page.evaluate to make the login request with cookies
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
  await page.evaluate(async (u: string, p: string) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, remember: false }),
    })
    return resp.json()
  }, username, password)
}

/** Wait for an element matching a CSS selector and return its text */
export async function getText(page: Page, selector: string): Promise<string> {
  await page.waitForSelector(selector, { visible: true })
  return page.$eval(selector, el => el.textContent?.trim() || '')
}

/** Check if an element exists on the page */
export async function exists(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: 3000, visible: true })
    return true
  } catch {
    return false
  }
}

/** Wait for network to be idle */
export async function waitForIdle(page: Page, ms = 1000): Promise<void> {
  await page.evaluate((t: number) => new Promise(r => setTimeout(r, t)), ms)
}

/** Fetch JSON from API using the page's session cookies */
export async function apiGet(page: Page, path: string): Promise<unknown> {
  return page.evaluate(async (url: string) => {
    const r = await fetch(url)
    return r.json()
  }, path)
}

/** POST JSON to API using the page's session cookies */
export async function apiPost(page: Page, path: string, body: Record<string, unknown> = {}): Promise<unknown> {
  return page.evaluate(async (url: string, data: string) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    })
    return r.json()
  }, path, JSON.stringify(body))
}
