/**
 * Pipeline Integration Test — Full Song Processing
 *
 * This test hits LIVE external APIs (Deezer, Replicate, OpenRouter).
 * It downloads a song, splits vocals, extracts lyrics, and post-processes them.
 *
 * Run separately:  npm run test:pipeline
 * Expected time:   3-8 minutes depending on API load
 * Cost:            ~$0.05-0.10 per run (Replicate GPU time)
 */
import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'

// Use a short, well-known track for testing
// "One More Time" by Daft Punk — ~5:20, reliable on Deezer
const TEST_TRACK_ID = process.env.E2E_TRACK_ID || '3135556'

let cookie = ''
let pipelineComplete = false

async function get(path: string, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Cookie: c }, redirect: 'manual' })
}

async function del(path: string, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { Cookie: c } })
}

/** Poll track status until it reaches a terminal state or timeout */
async function pollStatus(
  trackId: string,
  timeoutMs: number = 480_000,
  intervalMs: number = 5_000,
): Promise<{ status: string; progress: number; message?: string }> {
  const start = Date.now()
  let lastStatus = { status: 'unknown', progress: 0, message: '' }

  while (Date.now() - start < timeoutMs) {
    const resp = await get(`/api/track/status?id=${trackId}`)
    const data = await resp.json()
    lastStatus = data

    const elapsed = ((Date.now() - start) / 1000).toFixed(0)
    console.log(`  [${elapsed}s] ${data.status} ${data.progress}% — ${data.message || ''}`)

    if (data.status === 'complete' || data.status === 'error') {
      return data
    }

    await new Promise(r => setTimeout(r, intervalMs))
  }

  return lastStatus
}

describe('Song Processing Pipeline', () => {
  beforeAll(async () => {
    // Login
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    cookie = (loginResp.headers.get('set-cookie') || '').split(';')[0]
    expect(cookie).toContain('session')
  })

  describe('Search validation', () => {
    it('should find tracks on Deezer', async () => {
      const resp = await get('/api/search?q=one+more+time+daft+punk')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('title')
      expect(data[0]).toHaveProperty('artist')
    })
  })

  describe('Full pipeline: add + process + verify', () => {
    it('should clean up any previous test data', async () => {
      // Delete the test track if it exists from a previous run
      await del(`/api/admin/songs/${TEST_TRACK_ID}`)
      // Brief wait for filesystem cleanup
      await new Promise(r => setTimeout(r, 2000))
    })

    it('should trigger processing for a track', async () => {
      const resp = await get(`/api/add?id=${TEST_TRACK_ID}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(['processing', 'ready', 'already_processing']).toContain(data.status)

      if (data.status === 'ready') {
        pipelineComplete = true
        console.log('Track already fully processed')
      } else {
        console.log(`Processing started for track ${TEST_TRACK_ID}`)
      }
    })

    it('should complete all 6 processing stages', async () => {
      if (pipelineComplete) {
        console.log('Track already complete, skipping poll')
        return
      }

      console.log('Polling processing status...')
      const result = await pollStatus(TEST_TRACK_ID)

      if (result.status === 'error') {
        console.error(`Pipeline error: ${result.message}`)
      }

      expect(result.status).toBe('complete')
      expect(result.progress).toBe(100)
      pipelineComplete = true
    })

    it('should return track metadata via /track/<id>', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get(`/api/track/${TEST_TRACK_ID}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()

      expect(data.metadata).toBeDefined()
      expect(data.metadata.title).toBeDefined()
      expect(data.metadata.artist).toBeDefined()
      expect(data.metadata.id).toBe(TEST_TRACK_ID)
      expect(typeof data.metadata.title).toBe('string')
      expect(typeof data.metadata.artist).toBe('string')
      expect(data.metadata.title.length).toBeGreaterThan(0)
      expect(data.metadata.artist.length).toBeGreaterThan(0)
      expect(data.complete).toBe(true)

      console.log(`Track: "${data.metadata.title}" by ${data.metadata.artist}`)
    })

    it('should return processed lyrics via /track/<id>/lyrics', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get(`/api/track/${TEST_TRACK_ID}/lyrics`)
      expect(resp.status).toBe(200)
      const data = await resp.json()

      // Lyrics should have segments array
      expect(data).toHaveProperty('segments')
      expect(Array.isArray(data.segments)).toBe(true)
      expect(data.segments.length).toBeGreaterThan(0)

      // Each segment should have words with timing
      const segment = data.segments[0]
      expect(segment).toHaveProperty('words')
      expect(Array.isArray(segment.words)).toBe(true)
      expect(segment.words.length).toBeGreaterThan(0)

      // Each word should have text, start, end
      const word = segment.words[0]
      expect(word).toHaveProperty('word')
      expect(word).toHaveProperty('start')
      expect(word).toHaveProperty('end')
      expect(typeof word.word).toBe('string')
      expect(typeof word.start).toBe('number')
      expect(typeof word.end).toBe('number')
      expect(word.start).toBeGreaterThanOrEqual(0)
      expect(word.end).toBeGreaterThan(word.start)

      console.log(`Lyrics: ${data.segments.length} segments, first: "${segment.words.map((w: any) => w.word).join(' ')}"`)
    })

    it('should show track as "ready" when adding again', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get(`/api/add?id=${TEST_TRACK_ID}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.status).toBe('ready')
      expect(data.progress).toBe(100)
      expect(data.metadata).toBeDefined()
    })

    it('should include track in library', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get('/api/track/library')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)

      const track = data.find((t: any) => t.id === TEST_TRACK_ID)
      expect(track).toBeDefined()
      expect(track.complete).toBe(true)
      expect(track.title).toBeDefined()
      expect(track.artist).toBeDefined()
    })

    it('should serve audio files', async () => {
      expect(pipelineComplete).toBe(true)

      // Check vocals file is accessible
      const vocalsResp = await get(`/songs/${TEST_TRACK_ID}/vocals.mp3`)
      expect(vocalsResp.status).toBe(200)
      const vocalsType = vocalsResp.headers.get('content-type') || ''
      expect(vocalsType).toContain('audio')
      const vocalsSize = Number(vocalsResp.headers.get('content-length') || '0')
      expect(vocalsSize).toBeGreaterThan(100_000)

      // Check no_vocals file
      const instrResp = await get(`/songs/${TEST_TRACK_ID}/no_vocals.mp3`)
      expect(instrResp.status).toBe(200)
      const instrSize = Number(instrResp.headers.get('content-length') || '0')
      expect(instrSize).toBeGreaterThan(100_000)

      // Check original song file
      const songResp = await get(`/songs/${TEST_TRACK_ID}/song.mp3`)
      expect(songResp.status).toBe(200)
      const songSize = Number(songResp.headers.get('content-length') || '0')
      expect(songSize).toBeGreaterThan(100_000)

      console.log(`Audio: song=${(songSize / 1024 / 1024).toFixed(1)}MB, vocals=${(vocalsSize / 1024 / 1024).toFixed(1)}MB, instrumental=${(instrSize / 1024 / 1024).toFixed(1)}MB`)
    })

    it('should log play event', async () => {
      const resp = await get(`/api/play/${TEST_TRACK_ID}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should return track from /random', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get('/api/random')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('id')
      expect(data).toHaveProperty('metadata')
      expect(data.metadata.title).toBeDefined()
    })

    it('should show track in admin songs list', async () => {
      expect(pipelineComplete).toBe(true)

      const resp = await get('/api/admin/songs')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)

      const track = data.find((s: any) => String(s.id) === String(TEST_TRACK_ID))
      expect(track).toBeDefined()
      expect(track.complete).toBe(true)
      expect(track.file_sizes).toBeDefined()
      expect(track.file_sizes.song).toBeGreaterThan(0)
      expect(track.file_sizes.vocals).toBeGreaterThan(0)
      expect(track.file_sizes.lyrics).toBeGreaterThan(0)
    })
  })

  describe('Error handling', () => {
    it('should handle invalid track ID gracefully', async () => {
      const resp = await get('/api/add?id=99999999999')
      // Should start processing and eventually fail, or fail immediately
      expect([200, 400, 500]).toContain(resp.status)

      if (resp.status === 200) {
        const data = await resp.json()
        if (data.status === 'processing') {
          // Wait for it to fail
          const result = await pollStatus('99999999999', 60_000, 3_000)
          expect(result.status).toBe('error')
        }
      }
    })
  })
})
