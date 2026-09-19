import { randomUUID } from 'node:crypto'

function required(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) {
    throw new Error(`${name} is required. Run npm run test:integration for isolated offline tests, or provide explicit E2E_BASE_URL, E2E_ADMIN_USER and E2E_ADMIN_PASS for a dedicated live test instance.`)
  }
  return value
}

// Credentials are injected by the offline runner or explicitly supplied for
// an expendable live test instance. Never fall back to a personal account.
export const BASE = required('E2E_BASE_URL').trim().replace(/\/$/, '')
export const ADMIN_USER = required('E2E_ADMIN_USER').trim()
export const ADMIN_PASS = required('E2E_ADMIN_PASS')
export const OFFLINE = process.env.E2E_OFFLINE === '1'
export const REGULAR_USER = process.env.E2E_REGULAR_USER || `e2e-member-${randomUUID()}`
export const REGULAR_PASS = process.env.E2E_REGULAR_PASS || randomUUID()
export const testEmail = (username: string) => `${username.replace(/[^a-z0-9-]/gi, '-')}@example.test`

/** Select the Flask session, including its deletion cookie on logout.
 * Login can also delete auth_token, which must not replace the session.
 */
export function extractCookie(response: Response): string {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=]+=[^;]*)/)
  return cookies.map(cookie => cookie.trim().split(';')[0]).find(cookie => cookie.startsWith('session=')) || ''
}
