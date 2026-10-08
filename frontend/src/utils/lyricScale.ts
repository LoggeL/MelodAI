export const LYRIC_SCALES = [0.85, 1, 1.2] as const

export function readLyricScale(): number {
  try {
    const stored = Number(localStorage.getItem('lyricScale'))
    return (LYRIC_SCALES as readonly number[]).includes(stored) ? stored : 1
  } catch { return 1 }
}

export function storeLyricScale(scale: number) {
  try { localStorage.setItem('lyricScale', String(scale)) } catch { /* Storage is optional. */ }
}
