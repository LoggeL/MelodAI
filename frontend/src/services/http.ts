const MAX_RETRIES = 2
let redirectingToLogin = false

export class ApiError extends Error {
  readonly status: number
  readonly data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

type RequestOptions = RequestInit & { skipAuthRedirect?: boolean }

function wait(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** HTTP failures always reject. Only safe reads retry transient failures. */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuthRedirect, ...init } = options
  const method = (init.method || 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
    } catch (error) {
      if (init.signal?.aborted) throw error
      if (!canRetry || attempt >= MAX_RETRIES) throw new ApiError('Unable to connect. Check your connection and try again.', 0)
      await wait(500 * 2 ** attempt, init.signal)
      continue
    }
    if (canRetry && [502, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
      await wait(500 * 2 ** attempt, init.signal)
      continue
    }
    let data: unknown = null
    const body = await response.text()
    if (body) {
      try { data = JSON.parse(body) } catch {
        if (response.ok) throw new ApiError('The server returned an unexpected response. Please try again.', response.status)
      }
    }
    if (!response.ok) {
      const details = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
      let message = typeof details.error === 'string' ? details.error : `Request failed (${response.status}). Please try again.`
      if (details.error === 'insufficient_credits') {
        message = 'You do not have enough credits for this action.'
        if (typeof details.required === 'number' && typeof details.credits === 'number') {
          message = `This action requires ${details.required} credits. Your balance is ${details.credits}.`
        } else if (typeof details.credits === 'number') {
          message += ` Your balance is ${details.credits}.`
        }
      }
      if (response.status === 401 && !skipAuthRedirect && !redirectingToLogin && window.location.pathname !== '/login') {
        redirectingToLogin = true
        const returnTo = window.location.pathname + window.location.search
        window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      }
      throw new ApiError(message, response.status, details)
    }
    return data as T
  }
}
