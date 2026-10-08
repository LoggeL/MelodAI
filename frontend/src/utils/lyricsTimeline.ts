import type { LyricsData } from '../types'

/** Gaps longer than this are drawn as instrumental breaks on the progress bar. */
export const PAUSE_THRESHOLD = 3
/** Below this average word confidence the stage shows „Timing unsicher“. */
export const LOW_CONFIDENCE = 0.55

export type LyricsNote = { kind: 'untimed' } | { kind: 'low'; confidence: number } | null

/** Start times of the timed lyric lines (empty for untimed lyrics). */
export function lineStarts(lyrics: LyricsData | null | undefined): number[] {
  if (!lyrics || lyrics.untimed) return []
  return (lyrics.segments ?? []).map(segment => segment.start).filter(Number.isFinite)
}

/** Instrumental gaps over {@link PAUSE_THRESHOLD} s, including the intro and the outro. */
export function lyricPauses(lyrics: LyricsData | null | undefined, duration: number): Array<[number, number]> {
  if (!lyrics || lyrics.untimed) return []
  const segments = (lyrics.segments ?? []).filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end))
  if (segments.length === 0) return []
  const pauses: Array<[number, number]> = []
  let previousEnd = 0
  for (const segment of segments) {
    if (segment.start - previousEnd > PAUSE_THRESHOLD) pauses.push([previousEnd, segment.start])
    previousEnd = Math.max(previousEnd, segment.end)
  }
  if (duration > 0 && duration - previousEnd > PAUSE_THRESHOLD) pauses.push([previousEnd, duration])
  return pauses
}

export function lyricsNote(lyrics: LyricsData | null | undefined): LyricsNote {
  if (!lyrics) return null
  if (lyrics.untimed && (lyrics.plain_lyrics?.length ?? 0) > 0) return { kind: 'untimed' }
  if (lyrics.avg_confidence != null && lyrics.avg_confidence < LOW_CONFIDENCE && (lyrics.segments?.length ?? 0) > 0) {
    return { kind: 'low', confidence: lyrics.avg_confidence }
  }
  return null
}
