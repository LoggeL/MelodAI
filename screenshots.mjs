import puppeteer from 'puppeteer'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOTS_DIR = path.join(__dirname, 'docs', 'screenshots')
const BASE = 'http://localhost:5000'

const delay = ms => new Promise(r => setTimeout(r, ms))

async function clickTab(page, tabName) {
  const tabs = await page.$$('button')
  for (const tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab)
    if (text && text.includes(tabName)) {
      await tab.click()
      return
    }
  }
}

async function main() {
  const browser = await puppeteer.launch({
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

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  // Navigate to base first
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await delay(1500)

  // --- 1. Login page (before auth) ---
  console.log('1/7 Login page...')
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await delay(1500)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/01-login.png` })

  // Login as admin via API
  console.log('    Logging in...')
  const loginResp = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hyper.xjo@gmail.com', password: '404noswagfound', remember: false })
    })
    return r.json()
  })
  console.log('    Login:', loginResp.status || 'ok')

  // --- 2. Player with a song loaded (high confidence - Daft Punk) ---
  console.log('2/7 Player page...')
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await delay(2000)
  // Load a complete track into the queue via the app's API
  await page.evaluate(async () => {
    // Trigger adding a known complete track to the queue
    await fetch('/api/add?id=3135556')
  })
  await delay(3000)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/02-player.png` })

  // --- 3. Library page ---
  console.log('3/7 Library page...')
  await page.goto(BASE + '/library', { waitUntil: 'domcontentloaded' })
  await delay(3000)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/03-library.png` })

  // --- 4. Admin - Songs tab (shows confidence scores) ---
  console.log('4/7 Admin songs...')
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' })
  await delay(1500)
  await clickTab(page, 'Songs')
  await delay(2000)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/04-admin-songs.png` })

  // --- 5. Admin - Song detail view (shows confidence badge) ---
  console.log('5/7 Song detail...')
  await page.goto(BASE + '/admin/songs/3135556', { waitUntil: 'domcontentloaded' })
  await delay(2000)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/05-song-detail.png` })

  // --- 6. Admin - Users tab ---
  console.log('6/7 Admin users...')
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' })
  await delay(2000)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/06-admin-users.png` })

  // --- 7. About page ---
  console.log('7/7 About page...')
  await page.goto(BASE + '/about', { waitUntil: 'domcontentloaded' })
  await delay(1500)
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/07-about.png` })

  console.log('All screenshots saved to docs/screenshots/')
  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
