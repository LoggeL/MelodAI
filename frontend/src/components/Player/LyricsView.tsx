import { useRef, useEffect, useMemo, useState, useCallback, useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMicrophone, faGuitar, faTriangleExclamation, faLanguage, faChevronDown } from '@fortawesome/free-solid-svg-icons'
import type { LyricsData, LyricTranslation, TranslationLanguage } from '../../types'
import styles from './LyricsView.module.css'

interface Props {
  lyrics: LyricsData | null
  loading: boolean
  currentTime: number
  isPlaying?: boolean
  duration: number
  onSeek: (time: number) => void
  onEditWord?: (segIdx: number, wordIdx: number, newWord: string) => void
  hasTrack: boolean
  translation?: LyricTranslation | null
  translationLanguage: TranslationLanguage
  translationMode: 'original' | 'translation' | 'both'
  translationLoading?: boolean
  onTranslationLanguageChange: (language: TranslationLanguage) => void
  onTranslationModeChange: (mode: 'original' | 'translation' | 'both') => void
  onTranslate: () => void
}

const SPEAKER_CLASSES = [
  styles.speaker0, styles.speaker1, styles.speaker2,
  styles.speaker3, styles.speaker4, styles.speaker5,
]

const VISIBLE_TRANSLATION_LANGUAGES: Array<{ code: TranslationLanguage; label: string }> = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
]

export function LyricsView({
  lyrics,
  loading,
  currentTime,
  isPlaying = false,
  duration,
  onSeek,
  onEditWord,
  hasTrack,
  translation,
  translationLanguage,
  translationMode,
  translationLoading = false,
  onTranslationLanguageChange,
  onTranslationModeChange,
  onTranslate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const manualScrollUntilRef = useRef(0)
  const lastActiveLineRef = useRef<HTMLElement | null>(null)
  const previousTimeRef = useRef(currentTime)
  const currentTimeRef = useRef(currentTime)
  currentTimeRef.current = currentTime
  const [editing, setEditing] = useState<{ seg: number; word: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const editingRef = useRef(editing)
  editingRef.current = editing
  const [warningDismissed, setWarningDismissed] = useState(false)
  const [translationMenuOpen, setTranslationMenuOpen] = useState(false)
  const translationMenuId = useId()
  const editRef = useRef<HTMLInputElement>(null)
  const translationByIndex = useMemo(() => {
    const map = new Map<number, string>()
    translation?.lines?.forEach(line => map.set(line.index, line.translation))
    return map
  }, [translation])
  const showOriginal = translationMode !== 'translation' || !translation?.available
  const showTranslation = translationMode !== 'original' && !!translation?.available

  const speakerMap = useMemo(() => {
    const map: Record<string, string> = {}
    let idx = 0
    lyrics?.segments?.forEach(seg => {
      if (seg.speaker && !(seg.speaker in map)) {
        map[seg.speaker] = SPEAKER_CLASSES[idx % SPEAKER_CLASSES.length]
        idx++
      }
    })
    return map
  }, [lyrics])

  const centerActiveLine = useCallback((force = false) => {
    const container = containerRef.current
    if (!container || editingRef.current || (!force && Date.now() < manualScrollUntilRef.current)) return
    const lines = container.querySelectorAll<HTMLElement>(`.${styles.line}`)
    const activeLine = container.querySelector<HTMLElement>(`.${styles.lineActive}, .${styles.lineNext}`)
      ?? (currentTimeRef.current > 0 ? lines[lines.length - 1] : lines[0])
    if (!activeLine || (!force && activeLine === lastActiveLineRef.current)) return
    lastActiveLineRef.current = activeLine
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    const controlsHeight = container.querySelector<HTMLElement>(`.${styles.translationControls}`)?.offsetHeight ?? 0
    const readingPosition = controlsHeight + (containerRect.height - controlsHeight) * 0.4
    const offset = lineRect.top - containerRect.top + lineRect.height / 2 - readingPosition
    if (Math.abs(offset) < 4) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top: container.scrollTop + offset, behavior: force || reducedMotion ? 'instant' : 'smooth' })
  }, [])

  // Follow new lines while playing and jump directly after a paused seek.
  useEffect(() => {
    const jumped = Math.abs(currentTime - previousTimeRef.current) > 1.5
    previousTimeRef.current = currentTime
    centerActiveLine(!isPlaying || jumped)
  }, [currentTime, isPlaying, centerActiveLine])

  // A viewport or panel resize must also position lyrics when playback is paused.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame: number | null = null
    const recenter = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => centerActiveLine(true))
    }
    const deferFollowing = () => { manualScrollUntilRef.current = Date.now() + 6000 }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) deferFollowing()
    }
    const observer = new ResizeObserver(recenter)
    observer.observe(container)
    window.addEventListener('resize', recenter)
    container.addEventListener('wheel', deferFollowing, { passive: true })
    container.addEventListener('touchstart', deferFollowing, { passive: true })
    container.addEventListener('pointerdown', deferFollowing, { passive: true })
    container.addEventListener('keydown', onKeyDown)
    recenter()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', recenter)
      container.removeEventListener('wheel', deferFollowing)
      container.removeEventListener('touchstart', deferFollowing)
      container.removeEventListener('pointerdown', deferFollowing)
      container.removeEventListener('keydown', onKeyDown)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [lyrics, loading, hasTrack, centerActiveLine])

  useEffect(() => {
    centerActiveLine(true)
  }, [translationMode, translationMenuOpen, translation, warningDismissed, editing, duration, centerActiveLine])

  const handleDoubleClick = useCallback((segIdx: number, wordIdx: number, word: string) => {
    if (!onEditWord) return
    setEditing({ seg: segIdx, word: wordIdx })
    setEditValue(word)
    setTimeout(() => editRef.current?.focus(), 0)
  }, [onEditWord])

  const commitEdit = useCallback(() => {
    if (!editing || !editValue.trim() || !onEditWord) return
    onEditWord(editing.seg, editing.word, editValue.trim())
    setEditing(null)
  }, [editing, editValue, onEditWord])

  const cancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  if (!hasTrack) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><FontAwesomeIcon icon={faMicrophone} /></div>
          <h3>No Song Selected</h3>
          <p>Search for a song or pick one from the library to start singing</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.skeleton}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={styles.skeletonLine} />
          ))}
        </div>
      </div>
    )
  }

  const segments = lyrics?.segments || []
  const plainLyrics = lyrics?.plain_lyrics || []
  const isUntimed = lyrics?.untimed && plainLyrics.length > 0

  const translationToolbar = (
    <div className={styles.translationControls}>
      <div className={styles.translationDisclosure}>
        <button
          type="button"
          className={styles.translationToggle}
          aria-label="Translation settings"
          aria-expanded={translationMenuOpen}
          aria-controls={translationMenuId}
          onClick={() => setTranslationMenuOpen(open => !open)}
        >
          <FontAwesomeIcon icon={faLanguage} />
          Translation
          <FontAwesomeIcon icon={faChevronDown} className={styles.translationChevron} />
        </button>
      </div>
      <div id={translationMenuId} className={styles.translationToolbar} hidden={!translationMenuOpen}>
        <div className={styles.translationGroup}>
          <FontAwesomeIcon icon={faLanguage} />
          <select
            className={styles.translationSelect}
            value={translationLanguage}
            onChange={e => onTranslationLanguageChange(e.target.value as TranslationLanguage)}
            aria-label="Translation language"
          >
            {VISIBLE_TRANSLATION_LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
          {!translation?.available && (
            <button className={styles.translateButton} onClick={onTranslate} disabled={translationLoading}>
              {translationLoading ? 'Translating…' : 'Translate'}
            </button>
          )}
        </div>
        <div className={styles.translationModeGroup}>
          <button
            className={translationMode === 'original' ? styles.translationModeActive : ''}
            onClick={() => onTranslationModeChange('original')}
          >Original</button>
          <button
            className={translationMode === 'translation' ? styles.translationModeActive : ''}
            onClick={() => onTranslationModeChange('translation')}
            disabled={!translation?.available && !translationLoading}
          >Translation</button>
          <button
            className={translationMode === 'both' ? styles.translationModeActive : ''}
            onClick={() => onTranslationModeChange('both')}
            disabled={!translation?.available && !translationLoading}
          >Both</button>
        </div>
      </div>
    </div>
  )

  if (segments.length === 0 && !isUntimed) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><FontAwesomeIcon icon={faGuitar} /></div>
          <h3>No Lyrics Available</h3>
          <p>This song appears to be instrumental or has no detectable lyrics</p>
        </div>
      </div>
    )
  }

  // Untimed lyrics mode: evenly scroll through plain text lines
  if (isUntimed) {
    const progress = duration > 0 ? currentTime / duration : 0
    const activeLineIdx = Math.min(
      Math.floor(progress * plainLyrics.length),
      plainLyrics.length - 1
    )

    return (
      <div className={styles.container} ref={containerRef}>
        {translationToolbar}
        <div className={styles.untimedBanner}>
          <FontAwesomeIcon icon={faLanguage} />
          <span>Lyrics from external source — word-level timing unavailable</span>
        </div>
        {plainLyrics.map((line, i) => {
          const dist = Math.abs(i - activeLineIdx)
          const lineClass = [
            styles.line,
            styles.untimedLine,
            dist === 0 ? styles.lineActive : '',
            dist <= 2 && dist > 0 ? styles.lineNear : '',
          ].filter(Boolean).join(' ')

          return (
            <div key={i} className={lineClass}>
              {showOriginal && <span className={styles.word}>{line || '\u00A0'}</span>}
              {showTranslation && <div className={styles.translationLine}>{translationByIndex.get(i) || '\u00A0'}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  // Compute the active and next segment indices
  const activeIndex = segments.findIndex(
    seg => currentTime >= seg.start && currentTime <= seg.end + 0.3
  )
  const nextIndex = activeIndex >= 0
    ? segments.findIndex((seg, i) => i > activeIndex && seg.start > currentTime)
    : segments.findIndex(seg => seg.start > currentTime)

  // Calculate the gap between lines for break indicator
  const activeEnd = activeIndex >= 0 ? segments[activeIndex].end : -1
  const nextStart = nextIndex >= 0 ? segments[nextIndex].start : -1
  // Original gap: stable value based on segment boundaries (not currentTime)
  const prevEnd = activeIndex >= 0 ? activeEnd : (nextIndex > 0 ? segments[nextIndex - 1].end : -1)
  const originalGap = nextIndex >= 0 && prevEnd >= 0 ? nextStart - prevEnd : 0

  const showConfidenceWarning = !warningDismissed
    && lyrics?.avg_confidence != null
    && lyrics.avg_confidence < 0.55

  return (
    <div className={styles.container} ref={containerRef}>
      {translationToolbar}
      {showConfidenceWarning && (
        <div className={styles.confidenceWarning}>
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>Lyrics may be inaccurate — low transcription confidence</span>
          <button onClick={() => setWarningDismissed(true)} aria-label="Dismiss warning">&times;</button>
        </div>
      )}
      {segments.map((seg, i) => {
        const isActive = i === activeIndex
        const isNext = i === nextIndex
        const dist = Math.abs(currentTime - (seg.start + seg.end) / 2)
        const isNear = !isActive && !isNext && dist < 5
        const spkClass = speakerMap[seg.speaker] || SPEAKER_CLASSES[0]

        const lineClass = [
          styles.line,
          spkClass,
          isActive ? styles.lineActive : '',
          isNext ? styles.lineNext : '',
          isNear ? styles.lineNear : '',
        ].filter(Boolean).join(' ')

        // Break indicator: rendered when gap > 3s, animated via CSS grid expand/collapse
        const timeUntilNext = isNext ? nextStart - currentTime : 0
        const hasBreak = isNext && originalGap > 3
        const breakVisible = hasBreak && timeUntilNext > 0.5
        const remainingSeconds = Math.max(timeUntilNext, 0).toFixed(1)

        return (
          <div key={i}>
            {hasBreak && (
              <div className={`${styles.breakWrapper} ${breakVisible ? styles.breakWrapperVisible : ''}`}>
                <div className={styles.breakContent}>
                  <div className={styles.breakIndicator}>
                    {`\u00B7 \u00B7 \u00B7 ${remainingSeconds}s \u00B7 \u00B7 \u00B7`}
                  </div>
                </div>
              </div>
            )}
            <div className={lineClass}>
              {showOriginal && seg.words.map((w, j) => {
                const wActive = isActive && currentTime >= w.start && currentTime <= w.end + 0.1
                const isEditing = editing?.seg === i && editing?.word === j

                if (isEditing) {
                  return (
                    <input
                      key={j}
                      ref={editRef}
                      className={styles.wordEdit}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      onBlur={commitEdit}
                      style={{ width: `${Math.max(editValue.length + 1, 3)}ch` }}
                    />
                  )
                }

                return (
                  <span
                    key={j}
                    className={`${styles.word} ${wActive ? styles.wordActive : ''}`}
                    data-text={w.word}
                    onClick={() => onSeek(w.start)}
                    onDoubleClick={() => handleDoubleClick(i, j, w.word)}
                    title="Click to seek, double-click to edit"
                  >
                    {w.word}
                  </span>
                )
              })}
              {showTranslation && <div className={styles.translationLine}>{translationByIndex.get(i) || '\u00A0'}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
