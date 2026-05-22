export function isValidTrackId(trackId: string | null | undefined): trackId is string {
  return typeof trackId === 'string' && /^\d+$/.test(trackId.trim())
}

export function normalizeTrackId(trackId: string): string {
  const normalized = trackId.trim()
  if (!isValidTrackId(normalized)) {
    throw new Error('Invalid track ID')
  }
  return normalized
}

export function trackPathSegment(trackId: string): string {
  return encodeURIComponent(normalizeTrackId(trackId))
}
