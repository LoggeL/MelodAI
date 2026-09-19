import { describe, it, expect, beforeAll } from 'vitest'

import { BASE, ADMIN_USER, ADMIN_PASS, extractCookie } from '../config'

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

describe('Playlists API - /playlists/*', () => {
  let playlistId = 0

  beforeAll(async () => {
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    })
    expect(loginResp.status).toBe(200)
    cookie = extractCookie(loginResp)
    expect(cookie).toMatch(/^session=.+/)
  })

  describe('GET /playlists', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get('/api/playlists', '')
      expect(resp.status).toBe(401)
    })

    it('should return an array', async () => {
      const resp = await get('/api/playlists')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
    })
  })

  describe('POST /playlists', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await post('/api/playlists', { name: 'test' }, '')
      expect(resp.status).toBe(401)
    })

    it('should reject empty name', async () => {
      const resp = await post('/api/playlists', { name: '' })
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('Name required')
    })

    it('should create a playlist', async () => {
      const resp = await post('/api/playlists', { name: 'Test Playlist' })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.id).toBeDefined()
      expect(data.name).toBe('Test Playlist')
      playlistId = data.id
    })

    it('should appear in playlists list after creation', async () => {
      const resp = await get('/api/playlists')
      expect(resp.status).toBe(200)
      const data = await resp.json()
      const found = data.find((p: { id: number }) => p.id === playlistId)
      expect(found).toBeDefined()
      expect(found.name).toBe('Test Playlist')
      expect(found.track_count).toBe(0)
      expect(found.created_at).toBeDefined()
    })
  })

  describe('GET /playlists/:id/tracks', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await get(`/api/playlists/${playlistId}/tracks`, '')
      expect(resp.status).toBe(401)
    })

    it('should return empty array for new playlist', async () => {
      const resp = await get(`/api/playlists/${playlistId}/tracks`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(0)
    })

    it('should return 404 for non-existent playlist', async () => {
      const resp = await get('/api/playlists/99999/tracks')
      expect(resp.status).toBe(404)
    })
  })

  describe('POST /playlists/:id/tracks', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await post(`/api/playlists/${playlistId}/tracks`, { track_id: '12345' }, '')
      expect(resp.status).toBe(401)
    })

    it('should reject missing track_id', async () => {
      const resp = await post(`/api/playlists/${playlistId}/tracks`, {})
      expect(resp.status).toBe(400)
      const data = await resp.json()
      expect(data.error).toContain('track_id required')
    })

    it('should add a track to the playlist', async () => {
      const resp = await post(`/api/playlists/${playlistId}/tracks`, { track_id: '12345' })
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should reject duplicate track in same playlist', async () => {
      const resp = await post(`/api/playlists/${playlistId}/tracks`, { track_id: '12345' })
      expect(resp.status).toBe(409)
      const data = await resp.json()
      expect(data.error).toContain('already in playlist')
    })

    it('should return 404 for non-existent playlist', async () => {
      const resp = await post('/api/playlists/99999/tracks', { track_id: '12345' })
      expect(resp.status).toBe(404)
    })

    it('should add multiple tracks with incrementing positions', async () => {
      const added = await post(`/api/playlists/${playlistId}/tracks`, { track_id: '67890' })
      expect(added.status).toBe(200)
      const resp = await get(`/api/playlists/${playlistId}/tracks`)
      const data = await resp.json()
      expect(resp.status).toBe(200)
      expect(data.map((track: { id: string }) => track.id)).toEqual(['12345', '67890'])
      expect(data.map((track: { position: number }) => track.position)).toEqual([1, 2])
    })

    it('should update track_count in playlist list', async () => {
      const resp = await get('/api/playlists')
      const data = await resp.json()
      const found = data.find((p: { id: number }) => p.id === playlistId)
      expect(found).toBeDefined()
      expect(found.track_count).toBe(2)
    })
  })

  describe('DELETE /playlists/:id/tracks/:track_id', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await del(`/api/playlists/${playlistId}/tracks/12345`, '')
      expect(resp.status).toBe(401)
    })

    it('should remove a track from the playlist', async () => {
      const resp = await del(`/api/playlists/${playlistId}/tracks/12345`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should return 404 for non-existent playlist', async () => {
      const resp = await del('/api/playlists/99999/tracks/12345')
      expect(resp.status).toBe(404)
    })

    it('should handle removing non-existent track gracefully', async () => {
      const resp = await del(`/api/playlists/${playlistId}/tracks/99999999`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })
  })

  describe('DELETE /playlists/:id', () => {
    it('should reject unauthenticated request', async () => {
      const resp = await del(`/api/playlists/${playlistId}`, '')
      expect(resp.status).toBe(401)
    })

    it('should return 404 for non-existent playlist', async () => {
      const resp = await del('/api/playlists/99999')
      expect(resp.status).toBe(404)
    })

    it('should delete the playlist', async () => {
      const resp = await del(`/api/playlists/${playlistId}`)
      expect(resp.status).toBe(200)
      const data = await resp.json()
      expect(data.success).toBe(true)
    })

    it('should no longer appear in playlists list', async () => {
      const resp = await get('/api/playlists')
      const data = await resp.json()
      const found = data.find((p: { id: number }) => p.id === playlistId)
      expect(found).toBeUndefined()
    })
  })
})
