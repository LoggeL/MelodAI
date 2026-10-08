/**
 * Player parts that only appear on demand are separate chunks, so the player route stays within its
 * size budget (§3.3). Callers may preload them on hover or focus to hide the network round trip.
 */
export const loadSoundSheet = () => import('./SoundSheet')
export const loadStageMode = () => import('./StageMode')
export const loadTranslationPanel = () => import('./TranslationPanel')
export const loadOptionsSheet = () => import('./OptionsSheet')

/** Fire-and-forget preload; a failed request is retried when the part is actually rendered. */
export function preload(load: () => Promise<unknown>) {
  load().catch(() => {})
}

export const loadLibraryPanel = () => import('../Library/LibraryPanel')
export const loadSuggestedSongs = () => import('./SuggestedSongs')
export const loadStageStatus = () => import('./StageStatus')
