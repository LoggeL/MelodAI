import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5000'
// Use the .env admin credentials (created on startup)
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'hyper.xjo@gmail.com'
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || '404noswagfound'
const REGULAR_USER = `testuser_${Date.now()}`
const REGULAR_PASS = 'testpass456'

let adminCookie = ''
let regularUserId = 0

async function extractCookie(resp: Response): Promise<string> {
  const setCookie = resp.headers.get('set-cookie') || ''
  return setCookie.split(';')[0] || ''
}

async function post(path: string, body: Record<string, unknown>, cookie = ''): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
}

async function get(path: string, cookie = ''): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  })
}

describe('Auth API - /auth/*', () => {
  describe('POST /auth/register', () => {
    it('should reject empty username', async () => {
      const resp = await post('/api/auth/register', { username: '', password: 'test' })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('required')
    })

    it('should reject short password', async () => {
      const resp = await post('/api/auth/register', { username: 'test', password: 'ab' })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('4 characters')
    })

    it('should reject duplicate of existing admin username', async () => {
      const resp = await post('/api/auth/register', { username: ADMIN_USER, password: 'whatever1' })
      expect(resp.status).toBe(409)
      const data = await resp.json()
      expect(data.error).toContain('already taken')
    })

    it('should register new user as pending (no invite key)', async () => {
      const resp = await post('/api/auth/register', { username: REGULAR_USER, password: REGULAR_PASS })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data.pending).toBe(true)
    })

    it('should reject invalid invite key', async () => {
      const resp = await post('/api/auth/register', {
        username: 'badkey_user',
        password: 'test1234',
        invite_key: 'invalid-key-12345',
      })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Invalid invite key')
    })
  })

  describe('POST /auth/login', () => {
    it('should reject empty credentials', async () => {
      const resp = await post('/api/auth/login', { username: '', password: '' })
      expect(resp.status).toBe(400)
    })

    it('should reject wrong password', async () => {
      const resp = await post('/api/auth/login', { username: ADMIN_USER, password: 'wrong' })
      expect(resp.status).toBe(401)
      const data = await resp.json()
      expect(data.error).toContain('Invalid credentials')
    })

    it('should reject unapproved user', async () => {
      const resp = await post('/api/auth/login', { username: REGULAR_USER, password: REGULAR_PASS })
      expect(resp.status).toBe(403)
      const data = await resp.json()
      expect(data.error).toContain('pending')
    })

    it('should login admin successfully', async () => {
      const resp = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data.username).toBe(ADMIN_USER)
      expect(data.is_admin).toBe(true)
      adminCookie = await extractCookie(resp)
      expect(adminCookie).toContain('session')
    })

    it('should set remember-me cookie when requested', async () => {
      const resp = await post('/api/auth/login', {
        username: ADMIN_USER,
        password: ADMIN_PASS,
        remember: true,
      })
      expect(resp.status).toBe(200)
      const setCookie = resp.headers.get('set-cookie') || ''
      expect(setCookie).toContain('auth_token')
      // Update admin cookie for subsequent tests
      adminCookie = await extractCookie(resp)
    })
  })

  describe('GET /auth/check', () => {
    it('should return authenticated: false without session', async () => {
      const resp = await get('/api/auth/check')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.authenticated).toBe(false)
    })

    it('should return authenticated: true with valid session', async () => {
      const resp = await get('/api/auth/check', adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.authenticated).toBe(true)
      expect(data.username).toBe(ADMIN_USER)
      expect(data.is_admin).toBe(true)
    })
  })

  describe('GET /auth/profile', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/auth/profile')
      expect(resp.status).toBe(401)
    })

    it('should return user profile', async () => {
      const resp = await get('/api/auth/profile', adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.username).toBe(ADMIN_USER)
      expect(data.is_admin).toBe(true)
      expect(data.created_at).toBeDefined()
    })
  })

  describe('POST /auth/forgot-password', () => {
    it('should not reveal non-existent user', async () => {
      const resp = await post('/api/auth/forgot-password', { username: 'nonexistent_user_xyz' })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true) // Same response regardless
    })

    it('should reject empty username', async () => {
      const resp = await post('/api/auth/forgot-password', { username: '' })
      expect(resp.status).toBe(400)
    })
  })

  describe('POST /auth/reset-password', () => {
    it('should reject invalid token', async () => {
      const resp = await post('/api/auth/reset-password', {
        token: 'invalid-token',
        password: 'newpass123',
      })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Invalid or expired')
    })

    it('should reject short password', async () => {
      const resp = await post('/api/auth/reset-password', { token: 'some-token', password: 'ab' })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('4 characters')
    })
  })

  describe('POST /auth/logout', () => {
    it('should clear session', async () => {
      const resp = await post('/api/auth/logout', {}, adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should no longer be authenticated after logout', async () => {
      // Re-login to get fresh cookie, then logout and use the NEW cookie from logout response
      const loginResp = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS })
      const loginCookie = await extractCookie(loginResp)

      const logoutResp = await post('/api/auth/logout', {}, loginCookie)
      // Flask sets a new (empty) session cookie on logout
      const logoutCookie = await extractCookie(logoutResp)

      const checkResp = await get('/api/auth/check', logoutCookie || loginCookie)
      const data = await checkResp.json()
      // After logout with the updated cookie, should not be authenticated
      expect(data.authenticated).toBe(false)
    })
  })

  describe('Invite key registration flow', () => {
    let inviteKey = ''

    beforeAll(async () => {
      // Login as admin
      const resp = await post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS })
      adminCookie = await extractCookie(resp)
    })

    it('should generate an invite key', async () => {
      const resp = await post('/api/admin/invite-keys', {}, adminCookie)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.key).toBeDefined()
      expect(data.key.length).toBeGreaterThan(10)
      inviteKey = data.key
    })

    it('should register a user with valid invite key (auto-approved)', async () => {
      const newUser = `invited_${Date.now()}`
      const resp = await post('/api/auth/register', {
        username: newUser,
        password: 'test1234',
        invite_key: inviteKey,
      })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
      expect(data.pending).toBeUndefined()
    })

    it('should reject reuse of the same invite key', async () => {
      const resp = await post('/api/auth/register', {
        username: `reuse_${Date.now()}`,
        password: 'test1234',
        invite_key: inviteKey,
      })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Invalid invite key')
    })
  })
})
