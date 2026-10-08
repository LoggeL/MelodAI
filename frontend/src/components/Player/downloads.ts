/** Files a listener can download from the now-playing row (§4.2). */
export const DOWNLOADS = [
  { type: 'no_vocals', file: 'no_vocals.mp3', label: 'Nur Instrumental', name: 'Instrumental' },
  { type: 'vocals', file: 'vocals.mp3', label: 'Nur Gesang', name: 'Gesang' },
  { type: 'song', file: 'song.mp3', label: 'Ganzer Song', name: 'Original' },
] as const

export type DownloadOption = typeof DOWNLOADS[number]

export type TranslationMode = 'original' | 'translation' | 'both'
