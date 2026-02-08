export interface SearchResult {
  id: string
  id_type: string
  title: string
  artist: string
  album: string
  album_id: number
  img_url: string
  preview_url: string
}

export interface QueueItem {
  id: string
  title: string
  artist: string
  thumbnail: string
  vocalsUrl: string
  musicUrl: string
  lyricsUrl: string
  ready: boolean
  progress: number
  status: string
  error: boolean
}

export interface LyricsWord {
  word: string
  start: number
  end: number
  speaker: string
}

export interface LyricsSegment {
  start: number
  end: number
  words: LyricsWord[]
  speaker: string
}

export interface LyricsData {
  segments: LyricsSegment[]
  avg_confidence?: number
}

export interface TrackMetadata {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  img_url: string
}

export interface LibraryTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  img_url: string
  complete: boolean
}

export interface User {
  id: number
  username: string
  display_name: string
  is_admin: boolean
  is_approved: boolean
  credits: number
  created_at: string
  last_online: string | null
  activity_count: number
}

export interface Playlist {
  id: number
  name: string
  track_count: number
  created_at: string
}

export interface InviteKey {
  id: number
  key: string
  created_at: string
  used_by: string | null
  used_at: string | null
}

export interface UsageLog {
  id: number
  username: string
  action: string
  detail: string
  created_at: string
}

export interface AdminStats {
  total_users: number
  total_plays: number
  total_downloads: number
  total_searches: number
  most_active_user: string | null
  most_active_count: number
}

export interface StorageStats {
  disk_total: number
  disk_used: number
  disk_free: number
  songs_size: number
  songs_count: number
  db_size: number
}

export interface HealthCheck {
  status: 'ok' | 'error'
  message: string
}

export interface ProcessingStatus {
  status: string
  progress: number
  detail: string
  updated_at: string
}

export interface AdminSong {
  id: string
  title: string
  artist: string
  img_url: string
  complete: boolean
  file_sizes: Record<string, number>
  avg_confidence: number | null
}

export interface UnfinishedTrack {
  track_id: string
  title: string
  artist: string
  stage: string
  error_message: string
  failure_count: number
  updated_at: string
  complete: boolean
}

export interface LyricsEditPayload {
  segmentIndex: number
  wordIndex: number
  word: string
}

export interface SongFileInfo {
  exists: boolean
  size: number
}

export interface ProcessingFailure {
  id: number
  stage: string
  error_message: string
  failure_count: number
  created_at: string
  updated_at: string
}

export interface SongError {
  id: number
  error_type: string
  source: string
  error_message: string
  stack_trace: string | null
  created_at: string
}

export interface SongUsage {
  play_count: number
  download_count: number
  recent_plays: Array<{ username: string; created_at: string }>
}

export interface SongDetail {
  id: string
  metadata: TrackMetadata & Record<string, unknown>
  complete: boolean
  files: Record<string, SongFileInfo>
  lyrics: LyricsData | null
  lyrics_raw: { segments: Array<{ start: number; end: number; text: string; words: Array<{ word: string; start: number; end: number; score: number; speaker: string }> }> } | null
  processing_failures: ProcessingFailure[]
  errors: SongError[]
  usage: SongUsage
  favorites_count: number
  playlist_count: number
}

export interface ActivityItem {
  action: 'play' | 'download'
  track_id: string
  title: string
  artist: string
  img_url: string
  cost: number
  created_at: string
}

export interface ActivityResponse {
  items: ActivityItem[]
  total: number
  page: number
  per_page: number
}

export interface AppLogEntry {
  id: number
  level: 'info' | 'warning' | 'error'
  source: string
  message: string
  details: string | null
  track_id: string | null
  username: string | null
  created_at: string
}

export interface AppLogResponse {
  logs: AppLogEntry[]
  total: number
  page: number
  per_page: number
}

export interface ErrorLogEntry {
  id: number
  error_type: 'pipeline' | 'api'
  source: string
  error_message: string
  stack_trace: string | null
  track_id: string | null
  request_method: string | null
  request_path: string | null
  user_id: number | null
  username: string | null
  resolved: boolean
  resolved_at: string | null
  created_at: string
}

export interface ErrorLogResponse {
  errors: ErrorLogEntry[]
  total: number
  page: number
  per_page: number
}
