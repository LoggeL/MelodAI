import type {
  SearchResult, LyricsData, LibraryTrack, TrackMetadata,
  User, InviteKey, UsageLog, AdminStats, HealthCheck, StorageStats,
  AdminSong, UnfinishedTrack, ProcessingStatus, LyricsEditPayload, Playlist,
  ErrorLogResponse, AppLogResponse, SongDetail, ActivityResponse,
} from '../types'

const MAX_RETRIES = 3
const INITIAL_DELAY = 1000
let redirectingToLogin = false

async function request<T>(url: string, options?: RequestInit & { skipAuthRedirect?: boolean }): Promise<T> {
  let delay = INITIAL_DELAY

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })

      // Redirect to login on auth failure (guard against multiple parallel redirects)
      // Skip redirect for auth endpoints that handle 401 themselves (login, etc.)
      if (resp.status === 401 && !options?.skipAuthRedirect) {
        if (!redirectingToLogin) {
          redirectingToLogin = true
          window.location.href = '/login'
        }
        throw new Error('Authentication required')
      }

      // Don't retry other client errors (4xx) - return the response as-is
      if (resp.status >= 400 && resp.status < 500) {
        return resp.json()
      }

      // Retry server errors (5xx) with backoff
      if (!resp.ok) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, delay))
          delay *= 2
          continue
        }
        return resp.json()
      }

      return resp.json()
    } catch (err) {
      // Don't retry auth errors
      if (err instanceof Error && err.message === 'Authentication required') {
        throw err
      }
      // Network error - retry with backoff
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, delay))
        delay *= 2
        continue
      }
      throw err
    }
  }

  throw new Error('Max retries exceeded')
}

// ─── Auth ───

export const auth = {
  check: () => request<{ authenticated: boolean; username?: string; is_admin?: boolean; display_name?: string; credits?: number }>('/api/auth/check'),
  login: (username: string, password: string, remember: boolean) =>
    request<{ success?: boolean; error?: string; username?: string; is_admin?: boolean }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, remember }), skipAuthRedirect: true }
    ),
  register: (username: string, email: string, password: string, invite_key: string) =>
    request<{ success?: boolean; error?: string; pending?: boolean; message?: string }>(
      '/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, invite_key }) }
    ),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  forgotPassword: (username: string) =>
    request<{ success?: boolean; message?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username }) }),
  resetPassword: (token: string, password: string) =>
    request<{ success?: boolean; error?: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  profile: () => request<{ username: string; is_admin: boolean; created_at: string }>('/api/auth/profile'),
  profileStats: () => request<{
    credits: number; songs_processed: number; total_plays: number;
    playlists_count: number; favorites_count: number; member_since: string;
    display_name: string; username: string; is_admin: boolean;
  }>('/api/auth/profile/stats'),
  changePassword: (current_password: string, new_password: string) =>
    request<{ success?: boolean; error?: string; message?: string }>(
      '/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }
    ),
  activity: (page: number, sort = 'date_desc', action = '') => {
    const params = new URLSearchParams({ page: String(page), per_page: '15', sort })
    if (action) params.set('action', action)
    return request<ActivityResponse>(`/api/auth/profile/activity?${params}`)
  },
}

// ─── Tracks ───

export const tracks = {
  search: (q: string) => request<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  add: (id: string) => request<{ status: string; progress: number; metadata?: TrackMetadata; error?: string; credits?: number; required?: number }>(`/api/add?id=${id}`),
  info: (id: string) => request<{ metadata: TrackMetadata; complete: boolean; status: ProcessingStatus | null }>(`/api/track/${id}`),
  lyrics: (id: string) => request<LyricsData>(`/api/track/${id}/lyrics`),
  library: () => request<LibraryTrack[]>('/api/track/library'),
  status: (id?: string) => {
    const url = id ? `/api/track/status?id=${id}` : '/api/track/status'
    return request<ProcessingStatus | Record<string, ProcessingStatus>>(url)
  },
  logPlay: (id: string) => fetch(`/api/play/${id}`).catch(() => {}),
  random: (exclude: string[]) => request<{ id: string; metadata: TrackMetadata }>(`/api/random?exclude=${exclude.join(',')}`),
  editWord: (id: string, payload: LyricsEditPayload) =>
    request<{ success: boolean }>(`/api/track/${id}/lyrics`, { method: 'PUT', body: JSON.stringify(payload) }),
  favorites: () => request<string[]>('/api/favorites'),
  addFavorite: (id: string) => request<{ success: boolean }>(`/api/favorites/${id}`, { method: 'POST' }),
  removeFavorite: (id: string) => request<{ success: boolean }>(`/api/favorites/${id}`, { method: 'DELETE' }),
  credits: () => request<{ credits: number }>('/api/credits'),
  deductPlayCredit: (id: string) => request<{ success?: boolean; credits?: number; error?: string }>(`/api/play/${id}/credit`, { method: 'POST' }),
  playlists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string) => request<{ id: number; name: string }>('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) }),
  deletePlaylist: (id: number) => request<{ success: boolean }>(`/api/playlists/${id}`, { method: 'DELETE' }),
  playlistTracks: (id: number) => request<LibraryTrack[]>(`/api/playlists/${id}/tracks`),
  addToPlaylist: (playlistId: number, trackId: string) =>
    request<{ success: boolean }>(`/api/playlists/${playlistId}/tracks`, { method: 'POST', body: JSON.stringify({ track_id: trackId }) }),
  removeFromPlaylist: (playlistId: number, trackId: string) =>
    request<{ success: boolean }>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' }),
}

// ─── Admin ───

export const admin = {
  users: () => request<User[]>('/api/admin/users'),
  approveUser: (id: number) => request('/api/admin/users/' + id + '/approve', { method: 'POST' }),
  promoteUser: (id: number) => request('/api/admin/users/' + id + '/promote', { method: 'POST' }),
  demoteUser: (id: number) => request('/api/admin/users/' + id + '/demote', { method: 'POST' }),
  deleteUser: (id: number) => request('/api/admin/users/' + id, { method: 'DELETE' }),
  setCredits: (id: number, credits: number) => request('/api/admin/users/' + id + '/credits', { method: 'POST', body: JSON.stringify({ credits }) }),
  inviteKeys: () => request<InviteKey[]>('/api/admin/invite-keys'),
  generateInviteKey: () => request<{ key: string }>('/api/admin/invite-keys', { method: 'POST' }),
  deleteUsedInviteKeys: () => request<{ success: boolean; deleted: number }>('/api/admin/invite-keys/used', { method: 'DELETE' }),
  stats: () => request<AdminStats>('/api/admin/stats'),
  usageLogs: (page: number, username?: string, action?: string) => {
    const params = new URLSearchParams({ page: String(page), per_page: '50' })
    if (username) params.set('username', username)
    if (action) params.set('action', action)
    return request<{ logs: UsageLog[]; total: number; page: number; per_page: number }>(`/api/admin/usage-logs?${params}`)
  },
  storage: () => request<StorageStats>('/api/admin/storage'),
  songs: () => request<AdminSong[]>('/api/admin/songs'),
  deleteSong: (id: string) => request('/api/admin/songs/' + id, { method: 'DELETE' }),
  reprocessSong: (id: string) => request('/api/admin/songs/' + id + '/reprocess', { method: 'POST' }),
  songDetails: (id: string) => request<SongDetail>('/api/admin/songs/' + id + '/details'),
  runChecks: () => request<Record<string, HealthCheck>>('/api/admin/status/checks', { method: 'POST' }),
  statusHistory: () => request<Array<{ id: number; component: string; status: string; message: string; checked_at: string }>>('/api/admin/status/history'),
  processingQueue: () => request<Record<string, ProcessingStatus>>('/api/admin/status/queue'),
  unfinished: () => request<UnfinishedTrack[]>('/api/admin/status/unfinished'),
  errors: (page: number, type?: string, resolved?: string) => {
    const params = new URLSearchParams({ page: String(page), per_page: '50' })
    if (type) params.set('type', type)
    if (resolved !== undefined && resolved !== '') params.set('resolved', resolved)
    return request<ErrorLogResponse>(`/api/admin/errors?${params}`)
  },
  resolveError: (id: number) => request<{ success: boolean; resolved: boolean }>(`/api/admin/errors/${id}/resolve`, { method: 'POST' }),
  clearResolved: () => request<{ success: boolean }>('/api/admin/errors/resolved', { method: 'DELETE' }),
  logs: (page: number, level?: string, source?: string) => {
    const params = new URLSearchParams({ page: String(page), per_page: '50' })
    if (level) params.set('level', level)
    if (source) params.set('source', source)
    return request<AppLogResponse>(`/api/admin/logs?${params}`)
  },
  clearLogs: () => request<{ success: boolean }>('/api/admin/logs/clear', { method: 'DELETE' }),
  compressSongs: () => request<{ success: boolean; message: string }>('/api/admin/songs/compress', { method: 'POST' }),
}
