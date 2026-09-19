import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, request } from '../http'
import { auth } from '../api'

const fetchMock = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('window', { location: { pathname: '/login', search: '', assign: vi.fn() } }); fetchMock.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('HTTP request contract', () => {
  it('returns a successful JSON response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    await expect(request('/api/test')).resolves.toEqual({ ok: true })
  })
  it('rejects failed mutations with their server error and status', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }))
    await expect(request('/api/test', { method: 'POST' })).rejects.toMatchObject({ message: 'Not allowed', status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('never retries a mutation after a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network failed'))
    await expect(request('/api/test', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not retry deterministic validation errors', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Invalid input"}', { status: 400 }))
    await expect(request('/api/test')).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('retries safe reads on transient upstream failures', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response('Unavailable', { status: 503 })).mockResolvedValueOnce(new Response('[1]'))
    const pending = request('/api/test')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('rejects HTML error pages without JSON parser details', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Oops</html>', { status: 500 }))
    await expect(request('/api/test')).rejects.toMatchObject({ status: 500, message: 'Request failed (500). Please try again.' })
  })
  it('rejects a successful HTML login fallback', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Sign in</html>'))
    await expect(request('/api/test')).rejects.toMatchObject({ message: 'The server returned an unexpected response. Please try again.' })
  })
  it('accepts empty successful responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(request('/api/test', { method: 'DELETE' })).resolves.toBeNull()
  })
  it('retains credit error details for callers', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"insufficient_credits","credits":2,"required":5}', { status: 402 }))
    await expect(request('/api/add', { method: 'POST' })).rejects.toMatchObject({
      message: 'This action requires 5 credits. Your balance is 2.',
      data: { error: 'insufficient_credits', credits: 2, required: 5 },
    })
  })
  it('explains insufficient credits even when no required amount is supplied', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"insufficient_credits","credits":0}', { status: 403 }))
    await expect(request('/api/play/1/credit', { method: 'POST' })).rejects.toMatchObject({
      message: 'You do not have enough credits for this action. Your balance is 0.',
    })
  })
  it('keeps an incorrect current password on the profile form', async () => {
    window.location.pathname = '/profile'
    fetchMock.mockResolvedValue(new Response('{"error":"Current password is incorrect"}', { status: 401 }))
    await expect(auth.changePassword('wrong-password', 'new-password')).rejects.toMatchObject({
      message: 'Current password is incorrect', status: 401,
    })
    expect(window.location.assign).not.toHaveBeenCalled()
  })
  it('keeps authentication form failures on the current page', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Invalid credentials"}', { status: 401 }))
    await expect(request('/api/auth/login', { method: 'POST', skipAuthRedirect: true })).rejects.toMatchObject({ status: 401 })
    expect(window.location.assign).not.toHaveBeenCalled()
  })
  it('respects cancellation without retrying', async () => {
    const abort = new AbortController(); abort.abort()
    fetchMock.mockRejectedValue(abort.signal.reason)
    await expect(request('/api/test', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('still redirects an expired protected session and preserves the return route', async () => {
    window.location.pathname = '/library'
    window.location.search = '?view=favorites'
    fetchMock.mockResolvedValue(new Response('{"error":"Not authenticated"}', { status: 401 }))
    await expect(request('/api/track/library')).rejects.toMatchObject({ status: 401 })
    expect(window.location.assign).toHaveBeenCalledWith('/login?returnTo=%2Flibrary%3Fview%3Dfavorites')
  })
})
