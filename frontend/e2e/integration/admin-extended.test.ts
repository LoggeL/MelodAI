import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'

let adminCookie = ''

async function post(path: string, body: Record<string, unknown> = {}, c = adminCookie): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: c },
    body: JSON.stringify(body),
  })
}

async function get(path: string, c = adminCookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: { Cookie: c }, redirect: 'manual' })
}

async function del(path: string, c = adminCookie): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { Cookie: c }, redirect: 'manual' })
}

describe('Admin Extended API', () => {
  beforeAll(async () => {
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    adminCookie = (loginResp.headers.get('set-cookie') || '').split(';')[0]
  })

  // ─── Error Log Endpoints ───

  describe('GET /admin/errors', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/admin/errors', '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should return paginated error list', async () => {
      const resp = await get('/api/admin/errors')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('errors')
      expect(data).toHaveProperty('total')
      expect(data).toHaveProperty('page')
      expect(data).toHaveProperty('per_page')
      expect(Array.isArray(data.errors)).toBe(true)
      expect(typeof data.total).toBe('number')
    })

    it('should support type filter', async () => {
      const resp = await get('/api/admin/errors?type=pipeline')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      for (const err of data.errors) {
        expect(err.error_type).toBe('pipeline')
      }
    })

    it('should support resolved filter', async () => {
      const resp = await get('/api/admin/errors?resolved=0')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      for (const err of data.errors) {
        expect(err.resolved).toBe(false)
      }
    })

    it('should support pagination params', async () => {
      const resp = await get('/api/admin/errors?page=1&per_page=5')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.page).toBe(1)
      expect(data.per_page).toBe(5)
      expect(data.errors.length).toBeLessThanOrEqual(5)
    })

    it('should return errors with expected fields', async () => {
      const resp = await get('/api/admin/errors')
      const data = await resp.json()
      if (data.errors.length > 0) {
        const err = data.errors[0]
        expect(err).toHaveProperty('id')
        expect(err).toHaveProperty('error_type')
        expect(err).toHaveProperty('source')
        expect(err).toHaveProperty('error_message')
        expect(err).toHaveProperty('resolved')
        expect(err).toHaveProperty('created_at')
        expect(typeof err.resolved).toBe('boolean')
      }
    })
  })

  describe('POST /admin/errors/:id/resolve', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await post('/api/admin/errors/1/resolve', {}, '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should return 404 for non-existent error', async () => {
      const resp = await post('/api/admin/errors/99999/resolve')
      expect(resp.status).toBe(404)
    })

    it('should toggle resolution status if errors exist', async () => {
      // Get an error to toggle
      const listResp = await get('/api/admin/errors')
      const listData = await listResp.json()
      if (listData.errors.length > 0) {
        const errorId = listData.errors[0].id
        const wasBefore = listData.errors[0].resolved

        const resp = await post(`/api/admin/errors/${errorId}/resolve`)
        expect(resp.status).toBe(200)
        const data = await resp.json()
        expect(data.success).toBe(true)
        expect(data.resolved).toBe(!wasBefore)

        // Toggle back
        const resp2 = await post(`/api/admin/errors/${errorId}/resolve`)
        expect(resp2.status).toBe(200)
        const data2 = await resp2.json()
        expect(data2.resolved).toBe(wasBefore)
      }
    })
  })

  describe('DELETE /admin/errors/resolved', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await del('/api/admin/errors/resolved', '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should clear resolved errors', async () => {
      const resp = await del('/api/admin/errors/resolved')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })
  })

  // ─── Storage Endpoint ───

  describe('GET /admin/storage', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/admin/storage', '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should return storage stats', async () => {
      const resp = await get('/api/admin/storage')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('disk_total')
      expect(data).toHaveProperty('disk_used')
      expect(data).toHaveProperty('disk_free')
      expect(data).toHaveProperty('songs_size')
      expect(data).toHaveProperty('songs_count')
      expect(data).toHaveProperty('db_size')
      expect(typeof data.disk_total).toBe('number')
      expect(typeof data.disk_used).toBe('number')
      expect(typeof data.disk_free).toBe('number')
      expect(typeof data.songs_size).toBe('number')
      expect(typeof data.songs_count).toBe('number')
      expect(typeof data.db_size).toBe('number')
      expect(data.disk_total).toBeGreaterThan(0)
      expect(data.disk_free).toBeGreaterThan(0)
      expect(data.db_size).toBeGreaterThan(0)
    })

    it('should have consistent disk stats (used + free = total)', async () => {
      const resp = await get('/api/admin/storage')
      const data = await resp.json()
      // Allow generous margin for WSL2 / virtual disk environments
      const sum = data.disk_used + data.disk_free
      expect(Math.abs(sum - data.disk_total)).toBeLessThan(data.disk_total * 0.50)
    })
  })

  // ─── Song Details Endpoint ───

  describe('GET /admin/songs/:id/details', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/admin/songs/12345/details', '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should return 404 for non-existent track', async () => {
      const resp = await get('/api/admin/songs/99999999/details')
      expect(resp.status).toBe(404)
      const data = await resp.json()
      expect(data.error).toContain('not found')
    })

    it('should return details for existing song', async () => {
      // First check if any songs exist
      const songsResp = await get('/api/admin/songs')
      const songs = await songsResp.json()
      if (songs.length > 0) {
        const songId = songs[0].id
        const resp = await get(`/api/admin/songs/${songId}/details`)
        expect(resp.status).toBe(200)
        const data = await resp.json()
        expect(data).toHaveProperty('id')
        expect(data).toHaveProperty('metadata')
        expect(data).toHaveProperty('complete')
        expect(data).toHaveProperty('files')
        expect(data).toHaveProperty('usage')
        expect(data).toHaveProperty('favorites_count')
        expect(data).toHaveProperty('playlist_count')
        expect(typeof data.complete).toBe('boolean')
        expect(typeof data.usage).toBe('object')
        expect(data.usage).toHaveProperty('play_count')
        expect(data.usage).toHaveProperty('download_count')
        expect(data.usage).toHaveProperty('recent_plays')
      }
    })
  })

  // ─── Invite Key Cleanup ───

  describe('DELETE /admin/invite-keys/used', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await del('/api/admin/invite-keys/used', '')
      expect([401, 302, 403]).toContain(resp.status)
    })

    it('should delete used invite keys and return count', async () => {
      const resp = await del('/api/admin/invite-keys/used')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data).toHaveProperty('deleted')
      expect(typeof data.deleted).toBe('number')
    })
  })

  // ─── Usage Logs - Username Filter ───

  describe('GET /admin/usage-logs - username filter', () => {
    it('should filter logs by username', async () => {
      const resp = await get(`/api/admin/usage-logs?username=${ADMIN_USER}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      for (const log of data.logs) {
        expect(log.username.toLowerCase()).toContain(ADMIN_USER.toLowerCase())
      }
    })

    it('should return empty for non-existent username', async () => {
      const resp = await get('/api/admin/usage-logs?username=definitely_not_a_user_xyz123')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.logs.length).toBe(0)
      expect(data.total).toBe(0)
    })
  })
})
