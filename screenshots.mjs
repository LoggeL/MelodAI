// Regenerates docs/screenshots against a running MelodAI instance.
//
// Use a demo song store whose songs and lyrics you are allowed to publish (never a
// production store with real song lyrics). Credentials come from the environment
// and are never written to disk or printed:
//
//   MELODAI_URL                   base URL (default http://localhost:5000)
//   MELODAI_SCREENSHOT_USER       admin account used for every shot
//   MELODAI_SCREENSHOT_PASSWORD   its password
//   MELODAI_SCREENSHOT_SONG       ID of a finished demo song with timed lyrics
//   MELODAI_SCREENSHOT_THEME      dark (default) or light for the main shots
//
//   node screenshots.mjs        (uses puppeteer from frontend/node_modules)
//
// Runs one headless browser and closes it at the end.
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const puppeteer = createRequire(path.join(__dirname, 'frontend', 'package.json'))('puppeteer')
const OUT = path.join(__dirname, 'docs', 'screenshots')
const BASE = (process.env.MELODAI_URL || 'http://localhost:5000').replace(/\/$/, '')
const USER = process.env.MELODAI_SCREENSHOT_USER
const PASSWORD = process.env.MELODAI_SCREENSHOT_PASSWORD
const SONG = process.env.MELODAI_SCREENSHOT_SONG
const THEME = process.env.MELODAI_SCREENSHOT_THEME === 'light' ? 'light' : 'dark'

if (!USER || !PASSWORD || !SONG) {
  console.error('Set MELODAI_SCREENSHOT_USER, MELODAI_SCREENSHOT_PASSWORD and MELODAI_SCREENSHOT_SONG first.')
  process.exit(1)
}

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2' })
  const status = await page.evaluate(async credentials => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, remember: false }),
    })
    return response.status
  }, { username: USER, password: PASSWORD })
  if (status !== 200) throw new Error(`Login failed with HTTP ${status}`)
}

async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll('#toast-container > *').forEach(node => node.remove()))
}

/** Start the song, then jump to a point where a lyric line is active. */
async function playAt(page, fraction) {
  await page.waitForSelector('[aria-label="Abspielen"]:not([disabled]), [aria-label="Pause"]:not([disabled])', { timeout: 20000 })
  const play = await page.$('[aria-label="Abspielen"]')
  if (play) await play.click()
  await delay(1200)
  for (const bar of await page.$$('[aria-label="Wiedergabeposition"]')) {
    const box = await bar.boundingBox()
    if (!box) continue
    await page.mouse.click(box.x + 8 + (box.width - 16) * fraction, box.y + box.height / 2)
    break
  }
  await delay(2200)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await clearToasts(page)
}

const SHOTS = [
  { file: '01-login.png', go: '/login', auth: false },
  { file: '02-player.png', go: `/song/${SONG}`, act: page => playAt(page, 0.16) },
  { file: '03-library.png', go: '/library' },
  { file: '04-admin-songs.png', go: '/admin/songs' },
  { file: '05-song-detail.png', go: `/admin/songs/${SONG}` },
  { file: '06-admin-users.png', go: '/admin/users' },
  { file: '07-about.png', go: '/about', auth: false },
  { file: '08-player-light.png', go: `/song/${SONG}`, theme: 'light', act: page => playAt(page, 0.16) },
  { file: '09-phone-player.png', go: `/song/${SONG}`, viewport: PHONE, act: page => playAt(page, 0.16) },
  { file: '10-phone-library.png', go: '/library', viewport: PHONE, theme: 'light' },
]

const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
try {
  for (const [index, shot] of SHOTS.entries()) {
    console.log(`${index + 1}/${SHOTS.length} ${shot.file}`)
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    try {
      await page.setViewport(shot.viewport || DESKTOP)
      await page.evaluateOnNewDocument(theme => { try { localStorage.setItem('theme', theme) } catch { /* storage disabled */ } }, shot.theme || THEME)
      if (shot.auth !== false) await login(page)
      await page.goto(BASE + shot.go, { waitUntil: 'networkidle2' })
      await delay(1500)
      if (shot.act) await shot.act(page)
      await clearToasts(page)
      await page.screenshot({ path: path.join(OUT, shot.file) })
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
