import { describe, it, expect, beforeAll } from 'vitest'

import { BASE, ADMIN_USER, ADMIN_PASS, extractCookie, REGULAR_PASS, testEmail } from '../config'
const PENDING_USER = `pendinguser_${Date.now()}`
const PENDING_PASS = REGULAR_PASS

let adminCookie = ''
let memberCookie = ''
let memberId = 0
let pendingUserId = 0

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
  return fetch(`${BASE}${path}`, { method: 'DELETE', headers: { Cookie: c } })
}

describe('Admin API - /admin/*', () => {
  beforeAll(async () => {
    // Login with the explicitly configured test admin
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    expect(loginResp.status).toBe(200)
    adminCookie = extractCookie(loginResp)
    expect(adminCookie).toMatch(/^session=.+/)

    const keyResp = await post('/api/admin/invite-keys')
    expect(keyResp.status).toBe(200)
    const { key } = await keyResp.json()
    const memberName = `${PENDING_USER}_member`
    const memberResp = await post('/api/auth/register', {
      username: memberName, email: testEmail(memberName), password: REGULAR_PASS, invite_key: key,
    }, '')
    expect(memberResp.status).toBe(200)
    memberCookie = extractCookie(memberResp)
    expect(memberCookie).toMatch(/^session=.+/)
    const users = await (await get('/api/admin/users')).json()
    memberId = users.find((user: { username: string }) => user.username === memberName).id

    // Register a pending user
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: PENDING_USER, email: testEmail(PENDING_USER), password: PENDING_PASS }),
    })
  })

  describe('Auth guard', () => {
    it('should reject unauthenticated access to /admin/users', async () => {
      const resp = await get('/api/admin/users', '')
      expect(resp.status).toBe(401)
    })

    it('should reject non-admin access to /admin/users', async () => {
      const resp = await get('/api/admin/users', memberCookie)
      expect(resp.status).toBe(403)
      expect((await resp.json()).error).toBe('Admin access required')
    })
  })

  describe('GET /admin/users', () => {
    it('should list all users', async () => {
      const resp = await get('/api/admin/users')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThanOrEqual(2) // admin + pending user

      const admin = data.find((u: any) => u.username === ADMIN_USER)
      expect(admin).toBeDefined()
      expect(admin.is_admin).toBe(true)
      expect(admin.is_approved).toBe(true)

      const pending = data.find((u: any) => u.username === PENDING_USER)
      expect(pending).toBeDefined()
      expect(pending.is_approved).toBe(false)
      pendingUserId = pending.id
    })

    it('should include activity_count field', async () => {
      const resp = await get('/api/admin/users')
      const data = await resp.json()
      expect(data[0]).toHaveProperty('activity_count')
      expect(typeof data[0].activity_count).toBe('number')
    })
  })

  describe('POST /admin/users/:id/approve', () => {
    it('should approve a pending user', async () => {
      expect(pendingUserId).toBeGreaterThan(0)
      const resp = await post(`/api/admin/users/${pendingUserId}/approve`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      // Verify user is now approved
      const usersResp = await get('/api/admin/users')
      const users = await usersResp.json()
      const user = users.find((u: any) => u.id === pendingUserId)
      expect(user.is_approved).toBe(true)
    })
  })

  describe('POST /admin/users/:id/promote', () => {
    it('should promote a user to admin', async () => {
      const resp = await post(`/api/admin/users/${pendingUserId}/promote`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      const usersResp = await get('/api/admin/users')
      const users = await usersResp.json()
      const user = users.find((u: any) => u.id === pendingUserId)
      expect(user.is_admin).toBe(true)
    })
  })

  describe('POST /admin/users/:id/demote', () => {
    it('should demote a user from admin', async () => {
      const resp = await post(`/api/admin/users/${pendingUserId}/demote`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      const usersResp = await get('/api/admin/users')
      const users = await usersResp.json()
      const user = users.find((u: any) => u.id === pendingUserId)
      expect(user.is_admin).toBe(false)
    })
  })

  describe('Invite Keys - /admin/invite-keys', () => {
    let generatedKey = ''

    it('should generate an invite key', async () => {
      const resp = await post('/api/admin/invite-keys')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.key).toBeDefined()
      expect(typeof data.key).toBe('string')
      expect(data.key.length).toBeGreaterThan(10)
      generatedKey = data.key
    })

    it('should list invite keys', async () => {
      const resp = await get('/api/admin/invite-keys')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      const found = data.find((k: any) => k.key === generatedKey)
      expect(found).toBeDefined()
      expect(found.used_by).toBeNull()
    })
  })

  describe('GET /admin/stats', () => {
    it('should return usage statistics', async () => {
      const resp = await get('/api/admin/stats')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('total_users')
      expect(data).toHaveProperty('total_plays')
      expect(data).toHaveProperty('total_downloads')
      expect(data).toHaveProperty('total_searches')
      expect(typeof data.total_users).toBe('number')
      expect(data.total_users).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /admin/usage-logs', () => {
    it('should return paginated logs', async () => {
      const resp = await get('/api/admin/usage-logs')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data).toHaveProperty('logs')
      expect(data).toHaveProperty('total')
      expect(data).toHaveProperty('page')
      expect(data).toHaveProperty('per_page')
      expect(Array.isArray(data.logs)).toBe(true)
    })

    it('should support pagination params', async () => {
      const resp = await get('/api/admin/usage-logs?page=1&per_page=5')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.page).toBe(1)
      expect(data.per_page).toBe(5)
    })

    it('should support action filter', async () => {
      const resp = await get('/api/admin/usage-logs?action=search')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      // All returned logs should be search actions
      for (const log of data.logs) {
        expect(log.action).toBe('search')
      }
    })
  })

  describe('GET /admin/songs', () => {
    it('should return array of songs', async () => {
      const resp = await get('/api/admin/songs')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('title')
      expect(data[0]).toHaveProperty('artist')
      expect(data[0]).toHaveProperty('complete')
      expect(data[0]).toHaveProperty('file_sizes')
    })
  })

  describe('Status endpoints', () => {
    it('POST /admin/status/checks should run health checks', async () => {
      const resp = await post('/api/admin/status/checks')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(typeof data).toBe('object')
      // Should have at least the database check
      expect(data).toHaveProperty('database')
      expect(data.database).toHaveProperty('status')
      expect(data.database).toHaveProperty('message')
    })

    it('GET /admin/status/history should return check history', async () => {
      const resp = await get('/api/admin/status/history')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
      expect(data[0]).toHaveProperty('component')
      expect(data[0]).toHaveProperty('status')
      expect(data[0]).toHaveProperty('message')
      expect(data[0]).toHaveProperty('checked_at')
    })

    it('GET /admin/status/queue should return processing queue', async () => {
      const resp = await get('/api/admin/status/queue')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(typeof data).toBe('object')
    })

    it('GET /admin/status/unfinished should return unfinished tracks', async () => {
      const resp = await get('/api/admin/status/unfinished')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
    })
  })

  describe('DELETE /admin/users/:id', () => {
    it('should delete a user', async () => {
      const resp = await del(`/api/admin/users/${pendingUserId}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)

      // Verify user is gone
      const usersResp = await get('/api/admin/users')
      const users = await usersResp.json()
      const user = users.find((u: any) => u.id === pendingUserId)
      expect(user).toBeUndefined()
      expect((await del(`/api/admin/users/${memberId}`)).status).toBe(200)
    })
  })
})
