import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'

let cookie = ''

async function post(path: string, body: Record<string, unknown> = {}, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c },
    body: JSON.stringify(body),
  })
}

async function get(path: string, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Cookie: c }, redirect: 'manual' })
}

async function del(path: string, c = cookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { Cookie: c }, redirect: 'manual' })
}

describe('Favorites API - /favorites/*', () => {
  beforeAll(async () => {
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    cookie = (loginResp.headers.get('set-cookie') || '').split(';')[0]
  })

  describe('GET /favorites', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/favorites', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should return an array', async () => {
      const resp = await get('/api/favorites')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
    })
  })

  describe('POST /favorites/:track_id', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await post('/api/favorites/12345', {}, '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should add a track to favorites', async () => {
      const resp = await post('/api/favorites/12345')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should appear in favorites list after adding', async () => {
      const resp = await get('/api/favorites')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toContain('12345')
    })

    it('should handle duplicate add gracefully (idempotent)', async () => {
      const resp = await post('/api/favorites/12345')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      // Should still only appear once
      const listResp = await get('/api/favorites')
      const list = await listResp.json()
      const count = list.filter((id: string) => id === '12345').length
      expect(count).toBe(1)
    })

    it('should support multiple favorites', async () => {
      await post('/api/favorites/67890')
      const resp = await get('/api/favorites')
      const data = await resp.json()
      expect(data).toContain('12345')
      expect(data).toContain('67890')
    })
  })

  describe('DELETE /favorites/:track_id', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await del('/api/favorites/12345', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should remove a track from favorites', async () => {
      const resp = await del('/api/favorites/12345')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should no longer appear in favorites after removal', async () => {
      const resp = await get('/api/favorites')
      const data = await resp.json()
      expect(data).not.toContain('12345')
    })

    it('should handle removing non-existent favorite gracefully', async () => {
      const resp = await del('/api/favorites/99999999')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })
  })

  // Cleanup
  describe('cleanup', () => {
    it('should remove remaining test favorites', async () => {
      await del('/api/favorites/67890')
      const resp = await get('/api/favorites')
      const data = await resp.json()
      expect(data).not.toContain('67890')
    })
  })
})
