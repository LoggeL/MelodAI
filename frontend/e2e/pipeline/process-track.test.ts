/**
 * One real processing run against a fresh, dedicated local test server.
 *
 * Opt in with E2E_ALLOW_PAID_PIPELINE=1 and E2E_DEDICATED_PIPELINE_SERVER=1.
 * The runner must disable startup hooks and use disposable storage. It owns
 * cleanup; this suite never deletes tracks or retries a paid processing run.
 * Provider-internal fallbacks still apply and must be bounded by the runner.
 *
 * Default catalog identity verified with https://api.deezer.com/track/3135556:
 * "Harder, Better, Faster, Stronger", Daft Punk, Discovery (226 seconds).
 */
import { describe, it, expect } from 'vitest'
import { BASE, ADMIN_USER, ADMIN_PASS, extractCookie } from '../config'

const TEST_TRACK_ID = process.env.E2E_TRACK_ID || '3135556'
const TEST_TRACK_TITLE = process.env.E2E_TRACK_TITLE || (TEST_TRACK_ID === '3135556' ? 'Harder, Better, Faster, Stronger' : '')
const TEST_TRACK_ARTIST = process.env.E2E_TRACK_ARTIST || (TEST_TRACK_ID === '3135556' ? 'Daft Punk' : '')
const POLL_TIMEOUT = 480_000
const REQUEST_TIMEOUT = 30_000

interface Metadata {
  id: string
  title: string
  artist: string
  duration?: number
}
interface TrackInfo {
  metadata: Metadata
  complete: boolean
}
interface Status {
  status: string
  progress: number
}
interface Word {
  word?: unknown
  start?: unknown
  end?: unknown
}
interface Lyrics {
  untimed?: boolean
  segments?: { words?: Word[] }[]
}

let cookie = ''

function requireDedicatedServer(): void {
  if (process.env.E2E_DEDICATED_PIPELINE_SERVER !== '1') {
    throw new Error('Start an isolated server with disposable storage and set E2E_DEDICATED_PIPELINE_SERVER=1. The suite does not clean up shared servers.')
  }
  const address = new URL(BASE)
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port || address.pathname !== '/' || address.search || address.hash || address.username || address.password) {
    throw new Error('Paid pipeline tests require an explicit http://127.0.0.1:<port> dedicated local server.')
  }
  if (!/^\d{1,32}$/.test(TEST_TRACK_ID) || !TEST_TRACK_TITLE || !TEST_TRACK_ARTIST) {
    throw new Error('A custom E2E_TRACK_ID requires E2E_TRACK_TITLE and E2E_TRACK_ARTIST to verify the catalog identity before processing.')
  }
}

async function request(method: string, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
}

async function api<T>(method: string, path: string, expectedStatus = 200, body?: Record<string, unknown>): Promise<T> {
  const response = await request(method, path, body)
  if (response.status !== expectedStatus) {
    // Never serialize provider responses, credentials, metadata internals, or lyrics.
    throw new Error(`${method} ${path.split('?')[0]} returned HTTP ${response.status}; expected ${expectedStatus}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw new Error(`${method} ${path.split('?')[0]} returned invalid JSON.`)
  }
}

async function waitForCompletion(): Promise<void> {
  const start = Date.now()
  let previousStage = 'metadata'
  while (Date.now() - start < POLL_TIMEOUT) {
    const status = await api<Status>('GET', `/api/track/status?id=${TEST_TRACK_ID}`)
    if (status.status === 'error') {
      throw new Error(`Processing failed (last observed stage: ${previousStage}). Inspect the local server diagnostics; no retry was submitted.`)
    }
    if (!['metadata', 'downloading', 'splitting', 'lyrics', 'processing', 'complete'].includes(status.status)) {
      throw new Error('Processing returned an unexpected status. No retry was submitted.')
    }
    if (status.status !== previousStage) {
      console.log(`Pipeline stage: ${status.status} (${Math.round((Date.now() - start) / 1000)}s)`)
      previousStage = status.status
    }
    if (status.status === 'complete') {
      expect(status.progress).toBe(100)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 5_000))
  }
  throw new Error('Processing did not finish within 8 minutes. No retry was submitted; provider work may still be running on the dedicated server.')
}

describe.skipIf(process.env.E2E_ALLOW_PAID_PIPELINE !== '1')('Real song processing', () => {
  // One sequential test gives the first actionable failure instead of a cascade
  // of dependent failures. An explicit retry override prevents another paid run.
  it('processes the verified catalog track and serves timed lyrics and audio', { timeout: 600_000, retry: 0 }, async () => {
    requireDedicatedServer()

    const login = await request('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS })
    expect(login.status).toBe(200)
    cookie = extractCookie(login)
    expect(/^session=.+/.test(cookie)).toBe(true)
    const account = await api<{ authenticated: boolean; is_admin: boolean }>('GET', '/api/auth/check')
    expect(account.authenticated).toBe(true)
    expect(account.is_admin).toBe(true)

    const existing = await api<unknown[]>('GET', '/api/admin/songs')
    expect(Array.isArray(existing)).toBe(true)
    expect(existing.length, 'The dedicated server must have a fresh, empty song directory.').toBe(0)
    const queue = await api<Record<string, Status>>('GET', '/api/track/status')
    expect(Object.keys(queue).length, 'The dedicated server must have no existing processing jobs.').toBe(0)
    await api('GET', `/api/track/${TEST_TRACK_ID}`, 404)

    const query = encodeURIComponent(`${TEST_TRACK_TITLE} ${TEST_TRACK_ARTIST}`)
    const catalog = await api<Metadata[]>('GET', `/api/search?q=${query}`)
    expect(Array.isArray(catalog)).toBe(true)
    const selected = catalog.find(track => String(track.id) === TEST_TRACK_ID)
    expect(Boolean(selected), 'The exact requested track must be present in catalog search results.').toBe(true)
    expect(selected?.title).toBe(TEST_TRACK_TITLE)
    expect(selected?.artist).toBe(TEST_TRACK_ARTIST)
    console.log(`Catalog verified: "${TEST_TRACK_TITLE}" by ${TEST_TRACK_ARTIST} (${TEST_TRACK_ID})`)

    // Reject a syntactically invalid ID before processing; never launch an
    // additional paid pipeline just to test a provider-side missing song.
    const invalid = await api<{ error: string }>('POST', '/api/add', 400, { id: '../invalid' })
    expect(invalid.error).toBe('Invalid track ID')

    // This is the only valid /add request. Do not automatically retry it even
    // when the response is interrupted: the server may have already started.
    const started = await api<Status>('POST', '/api/add', 200, { id: TEST_TRACK_ID })
    expect(started.status).toBe('processing')
    await waitForCompletion()

    const track = await api<TrackInfo>('GET', `/api/track/${TEST_TRACK_ID}`)
    expect(track.complete).toBe(true)
    expect(String(track.metadata.id)).toBe(TEST_TRACK_ID)
    expect(track.metadata.title).toBe(TEST_TRACK_TITLE)
    expect(track.metadata.artist).toBe(TEST_TRACK_ARTIST)
    expect(typeof track.metadata.duration).toBe('number')
    expect(track.metadata.duration).toBeGreaterThan(0)

    const lyrics = await api<Lyrics>('GET', `/api/track/${TEST_TRACK_ID}/lyrics`)
    // Timed karaoke output is required. Reference-only untimed fallback is a
    // supported app state, but does not prove successful word alignment.
    expect(lyrics.untimed === true, 'Timed karaoke lyrics are required for this acceptance test.').toBe(false)
    expect(Array.isArray(lyrics.segments)).toBe(true)
    const segments = lyrics.segments || []
    expect(segments.length).toBeGreaterThan(0)
    let wordCount = 0
    for (const [segmentIndex, segment] of segments.entries()) {
      expect(Array.isArray(segment.words), `Segment ${segmentIndex} needs timed words.`).toBe(true)
      const words = segment.words || []
      expect(words.length).toBeGreaterThan(0)
      for (const [wordIndex, word] of words.entries()) {
        const label = `Segment ${segmentIndex}, word ${wordIndex}`
        // All assertions use booleans or numbers so failure output cannot print
        // the lyric content through Vitest's object/string diff formatter.
        expect(typeof word.word === 'string' && word.word.trim().length > 0, `${label}: text exists`).toBe(true)
        expect(typeof word.start === 'number' && Number.isFinite(word.start), `${label}: finite start`).toBe(true)
        expect(typeof word.end === 'number' && Number.isFinite(word.end), `${label}: finite end`).toBe(true)
        const start = word.start as number
        const end = word.end as number
        expect(start, `${label}: nonnegative start`).toBeGreaterThanOrEqual(0)
        expect(end, `${label}: positive duration`).toBeGreaterThan(start)
        expect(end, `${label}: within song duration`).toBeLessThanOrEqual((track.metadata.duration || 0) + 1)
        wordCount++
      }
    }
    console.log(`Timed lyrics verified: ${segments.length} segments, ${wordCount} words. Text omitted.`)

    for (const filename of ['song.mp3', 'vocals.mp3', 'no_vocals.mp3']) {
      const response = await request('GET', `/songs/${TEST_TRACK_ID}/${filename}`, undefined, { Range: 'bytes=0-2047' })
      expect(response.status, `${filename}: byte-range response`).toBe(206)
      expect(response.headers.get('content-type')?.startsWith('audio/')).toBe(true)
      const range = /^bytes 0-2047\/(\d+)$/.exec(response.headers.get('content-range') || '')
      expect(Boolean(range), `${filename}: valid Content-Range`).toBe(true)
      expect(Number(range?.[1]), `${filename}: nontrivial full audio file`).toBeGreaterThan(100_000)
      expect((await response.arrayBuffer()).byteLength).toBe(2048)
    }

    const library = await api<(Metadata & { complete: boolean })[]>('GET', '/api/track/library')
    const libraryTrack = library.find(item => String(item.id) === TEST_TRACK_ID)
    expect(libraryTrack?.complete).toBe(true)
    expect(libraryTrack?.title).toBe(TEST_TRACK_TITLE)
    const random = await api<{ id: string; metadata: Metadata }>('GET', '/api/random')
    expect(String(random.id)).toBe(TEST_TRACK_ID)
    expect(random.metadata.title).toBe(TEST_TRACK_TITLE)
    const play = await api<{ success: boolean }>('GET', `/api/play/${TEST_TRACK_ID}`)
    expect(play.success).toBe(true)
    const songs = await api<{ id: string; complete: boolean; file_sizes: Record<string, number> }[]>('GET', '/api/admin/songs')
    const saved = songs.find(item => String(item.id) === TEST_TRACK_ID)
    expect(saved?.complete).toBe(true)
    for (const key of ['song', 'vocals', 'no_vocals', 'lyrics']) {
      expect(saved?.file_sizes[key], `${key}: persisted file size`).toBeGreaterThan(0)
    }
    console.log('Pipeline acceptance passed. Local files are preserved for browser and audio verification.')
  })
})
