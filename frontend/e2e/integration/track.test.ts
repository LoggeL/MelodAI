import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'

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
    // Login with the .env admin (created on startup)
    const loginResp = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS }, '')
    cookie = (loginResp.headers.get('set-cookie') || '').split(';')[0]
  })

  describe('GET /search', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/search?q=test', '')
      expect([401, 302]).toContain(resp.status)
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
      expect([401, 302]).toContain(resp.status)
    })

    it('should return array (possibly empty)', async () => {
      const resp = await get('/api/track/library')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
    })
  })

  describe('GET /track/status', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/track/status', '')
      expect([401, 302]).toContain(resp.status)
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

  describe('GET /add', () => {
    it('should reject missing track ID', async () => {
      const resp = await get('/api/add')
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Track ID required')
    })

    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/add?id=12345', '')
      expect([401, 302]).toContain(resp.status)
    })
  })

  describe('GET /random', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/random', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should return 404 when no songs available', async () => {
      const resp = await get('/api/random')
      const data = await resp.json()
      if (resp.status === 404) {
        expect(data.error).toContain('No songs available')
      } else {
        expect(data).toHaveProperty('id')
        expect(data).toHaveProperty('metadata')
      }
    })
  })

  describe('GET /play/<track_id>', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/play/12345', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should log play and return success', async () => {
      const resp = await get('/api/play/12345')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })
  })

  describe('Already-processed track (if exists)', () => {
    it('should return metadata for existing track 139470659', async () => {
      const resp = await get('/api/track/139470659')
      if (resp.status === 200) {
        const data = await resp.json()
        expect(data.metadata).toBeDefined()
        expect(data.metadata.title).toBe('Shape of You')
        expect(data.metadata.artist).toBe('Ed Sheeran')
        expect(data).toHaveProperty('complete')
        expect(data).toHaveProperty('status')
      }
    })

    it('should return "ready" when adding already-complete track', async () => {
      const resp = await get('/api/add?id=139470659')
      if (resp.status === 200) {
        const data = await resp.json()
        expect(['ready', 'processing', 'already_processing']).toContain(data.status)
      }
    })
  })
})
