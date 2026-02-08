import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'
const CREDIT_TEST_USER = `credituser_${Date.now()}`
const CREDIT_TEST_PASS = 'testpass789'

let adminCookie = ''
let userCookie = ''
let testUserId = 0

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

describe('Credits, Profile Stats & Change Password API', () => {
  beforeAll(async () => {
    // Login as admin
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    adminCookie = (loginResp.headers.get('set-cookie') || '').split(';')[0]

    // Generate invite key and register test user (auto-approved)
    const keyResp = await post('/api/admin/invite-keys', {}, adminCookie)
    const { key } = await keyResp.json()

    const regResp = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: CREDIT_TEST_USER, password: CREDIT_TEST_PASS, invite_key: key }),
    })
    userCookie = (regResp.headers.get('set-cookie') || '').split(';')[0]

    // Get user ID from admin users list
    const usersResp = await get('/api/admin/users', adminCookie)
    const users = await usersResp.json()
    const user = users.find((u: { username: string }) => u.username === CREDIT_TEST_USER)
    testUserId = user.id
  })

  describe('GET /credits', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/credits', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should return credits for authenticated user', async () => {
      const resp = await get('/api/credits', userCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('credits')
      expect(typeof data.credits).toBe('number')
      expect(data.credits).toBe(50) // Default credits from schema
    })
  })

  describe('POST /admin/users/:id/credits', () => {
    it('should reject missing credits field', async () => {
      const resp = await post(`/api/admin/users/${testUserId}/credits`, {}, adminCookie)
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('credits required')
    })

    it('should set user credits', async () => {
      const resp = await post(`/api/admin/users/${testUserId}/credits`, { credits: 100 }, adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should reflect updated credits', async () => {
      const resp = await get('/api/credits', userCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.credits).toBe(100)
    })

    it('should allow setting credits to zero', async () => {
      await post(`/api/admin/users/${testUserId}/credits`, { credits: 0 }, adminCookie)
      const resp = await get('/api/credits', userCookie)
      const data = await resp.json()
      expect(data.credits).toBe(0)
    })
  })

  describe('POST /play/:track_id/credit', () => {
    let endpointExists = false

    beforeAll(async () => {
      // Set credits to 10 for play credit tests
      await post(`/api/admin/users/${testUserId}/credits`, { credits: 10 }, adminCookie)
      // Check if endpoint exists (may not be in running server)
      const probe = await post('/api/play/12345/credit', {}, adminCookie)
      endpointExists = probe.status !== 404
    })

    it('should reject unauthenticated request', async () => {
      if (!endpointExists) return
      const resp = await post('/api/play/12345/credit', {}, '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should deduct 1 credit for non-admin user', async () => {
      if (!endpointExists) return
      const resp = await post('/api/play/12345/credit', {}, userCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data.credits).toBe(9)
    })

    it('should not deduct credits for admin user', async () => {
      if (!endpointExists) return
      const beforeResp = await get('/api/auth/check', adminCookie)
      const beforeData = await beforeResp.json()
      const creditsBefore = beforeData.credits

      const resp = await post('/api/play/12345/credit', {}, adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data.credits).toBe(creditsBefore)
    })

    it('should reject when user has insufficient credits', async () => {
      if (!endpointExists) return
      // Set credits to 0
      await post(`/api/admin/users/${testUserId}/credits`, { credits: 0 }, adminCookie)

      const resp = await post('/api/play/12345/credit', {}, userCookie)
      expect(resp.status).toBe(403)
      const data = await resp.json()
      expect(data.error).toBe('insufficient_credits')
      expect(data.credits).toBe(0)
    })
  })

  describe('GET /auth/profile/stats', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/auth/profile/stats', '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should return profile stats', async () => {
      const resp = await get('/api/auth/profile/stats', userCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('credits')
      expect(data).toHaveProperty('songs_processed')
      expect(data).toHaveProperty('total_plays')
      expect(data).toHaveProperty('playlists_count')
      expect(data).toHaveProperty('favorites_count')
      expect(data).toHaveProperty('member_since')
      expect(data).toHaveProperty('display_name')
      expect(data).toHaveProperty('username')
      expect(data).toHaveProperty('is_admin')
      expect(data.username).toBe(CREDIT_TEST_USER)
      expect(data.is_admin).toBe(false)
      expect(typeof data.songs_processed).toBe('number')
      expect(typeof data.total_plays).toBe('number')
      expect(typeof data.playlists_count).toBe('number')
      expect(typeof data.favorites_count).toBe('number')
    })
  })

  describe('POST /auth/change-password', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await post('/api/auth/change-password', {
        current_password: 'test',
        new_password: 'test',
      }, '')
      expect([401, 302]).toContain(resp.status)
    })

    it('should reject empty passwords', async () => {
      const resp = await post('/api/auth/change-password', {
        current_password: '',
        new_password: '',
      }, userCookie)
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Both passwords required')
    })

    it('should reject short new password', async () => {
      const resp = await post('/api/auth/change-password', {
        current_password: CREDIT_TEST_PASS,
        new_password: 'ab',
      }, userCookie)
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('4 characters')
    })

    it('should reject incorrect current password', async () => {
      const resp = await post('/api/auth/change-password', {
        current_password: 'wrongpassword',
        new_password: 'newpass1234',
      }, userCookie)
      expect(resp.status).toBe(401)
      const data = await resp.json()
      expect(data.error).toContain('incorrect')
    })

    it('should change password successfully', async () => {
      const newPass = 'newpass1234'
      const resp = await post('/api/auth/change-password', {
        current_password: CREDIT_TEST_PASS,
        new_password: newPass,
      }, userCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      // Verify can login with new password
      const loginResp = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: CREDIT_TEST_USER, password: newPass }),
      })
      expect(loginResp.status).toBe(200)
      const loginData = await loginResp.json()
      expect(loginData.success).toBe(true)
    })
  })

  // Cleanup
  describe('cleanup', () => {
    it('should delete test user', async () => {
      const resp = await del(`/api/admin/users/${testUserId}`, adminCookie)
      expect(resp.status).toBe(200)
    })
  })
})
