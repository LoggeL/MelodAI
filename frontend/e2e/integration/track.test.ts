import { describe, it, expect, beforeAll } from 'vitest'

import { BASE, ADMIN_USER, ADMIN_PASS, extractCookie, OFFLINE } from '../config'

import fixtures from '../fixtures.json'

let cookie = ''

async function post(path: string, body: Record<string, unknown>, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
}

async function get(path: string, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Cookie: c }, redirect: 'manual' })
}

describe('Track API', () => {
  beforeAll(async () => {
    // Login with the explicitly configured test admin
    const loginResp = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS }, '')
    expect(loginResp.status).toBe(200)
    cookie = extractCookie(loginResp)
    expect(cookie).toMatch(/^session=.+/)
  })

  describe('GET /search', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/search?q=test', '')
      expect(resp.status).toBe(401)
    })

    it('should return empty array for empty query', async () => {
      const resp = await get('/api/search?q=')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toEqual([])
    })

    it('should return search results for a valid query', async () => {
      const resp = await get('/api/search?q=shape+of+you')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
      const first = data[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('title')
      expect(first).toHaveProperty('artist')
    })

    it('should return results with expected fields', async () => {
      const resp = await get('/api/search?q=bohemian+rhapsody')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.length).toBeGreaterThan(0)
      const result = data[0]
      // Deezer search returns id as string
      expect(typeof result.id).toBe('string')
      expect(typeof result.title).toBe('string')
      expect(typeof result.artist).toBe('string')
      expect(result).toHaveProperty('img_url')
      expect(result).toHaveProperty('album')
      expect(result).toHaveProperty('preview_url')
    })
  })

  describe('GET /track/library', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/track/library', '')
      expect(resp.status).toBe(401)
    })

    it('should return the completed library', async () => {
      const resp = await get('/api/track/library')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
      if (OFFLINE) expect(data.map((track: { id: string }) => track.id).sort()).toEqual(fixtures.tracks.map(track => track.id).sort())
    })
  })

  describe('GET /track/status', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/track/status', '')
      expect(resp.status).toBe(401)
    })

    it('should return status object', async () => {
      const resp = await get('/api/track/status')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(typeof data).toBe('object')
    })

    it('should return unknown for non-existent track', async () => {
      const resp = await get('/api/track/status?id=99999999')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.status).toBe('unknown')
    })
  })

  describe('GET /track/<id>', () => {
    it('should return 404 for non-existent track', async () => {
      const resp = await get('/api/track/99999999')
      expect(resp.status).toBe(404)
      const data = await resp.json()
      expect(data.error).toContain('not found')
    })
  })

  describe('GET /track/<id>/lyrics', () => {
    it('should return 404 for non-existent track', async () => {
      const resp = await get('/api/track/99999999/lyrics')
      expect(resp.status).toBe(404)
      const data = await resp.json()
      expect(data.error).toContain('not found')
    })
  })

  describe('POST /add', () => {
    it('should reject missing track ID', async () => {
      const resp = await post('/api/add', {})
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Track ID required')
    })

    it('should reject unauthenticated request', async () => {
      const resp = await post('/api/add', { id: '12345' }, '')
      expect(resp.status).toBe(401)
    })
  })

  describe('GET /random', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/random', '')
      expect(resp.status).toBe(401)
    })

    it('should return a playable library track', async () => {
      const resp = await get('/api/random')
      const data = await resp.json()
      expect(resp.status).toBe(200)
      expect(data).toHaveProperty('id')
      expect(data).toHaveProperty('metadata')
      const trackResp = await get(`/api/track/${data.id}`)
      expect(trackResp.status).toBe(200)
      expect((await trackResp.json()).complete).toBe(true)
    })
  })

  describe('GET /play/<track_id>', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/play/12345', '')
      expect(resp.status).toBe(401)
    })

    it('should log play and return success', async () => {
      const resp = await get('/api/play/12345')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })
  })

  describe('Completed track fixture', () => {
    it('should return timed lyrics', async () => {
      const resp = await get('/api/track/139470659/lyrics')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.lines.length).toBeGreaterThan(0)
      expect(data.lines[0].start).toBeGreaterThanOrEqual(0)
      expect(data.lines[0].end).toBeGreaterThan(data.lines[0].start)
      if (OFFLINE) expect(data).toEqual(fixtures.lyrics)
    })

    it('should protect audio files and serve byte ranges for seeking', async () => {
      const unauthorized = await get('/songs/139470659/song.mp3', '')
      expect(unauthorized.status).toBe(401)
      expect((await unauthorized.json()).error).toBe('Authentication required')
      const resp = await fetch(`${BASE}/songs/139470659/song.mp3`, {
        headers: { Cookie: cookie, Range: 'bytes=0-43' },
      })
      expect(resp.status).toBe(206)
      expect(resp.headers.get('content-range')).toMatch(/^bytes 0-43\/\d+$/)
      const bytes = await resp.arrayBuffer()
      expect(bytes.byteLength).toBe(44)
      if (OFFLINE) expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    })

    it('should return metadata for existing track 139470659', async () => {
      const resp = await get('/api/track/139470659')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.metadata).toBeDefined()
      expect(data.metadata.title.length).toBeGreaterThan(0)
      expect(data.metadata.artist.length).toBeGreaterThan(0)
      expect(data.complete).toBe(true)
      expect(data).toHaveProperty('status')
      if (OFFLINE) expect(data.metadata).toEqual(fixtures.tracks[0])
    })

    it('should return "ready" when adding already-complete track', async () => {
      // Never start paid processing if the dedicated test instance lacks fixtures.
      const fixture = await get('/api/track/139470659')
      expect(fixture.status).toBe(200)
      expect((await fixture.json()).complete).toBe(true)
      const resp = await post('/api/add', { id: '139470659' })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.status).toBe('ready')
    })
  })
})
