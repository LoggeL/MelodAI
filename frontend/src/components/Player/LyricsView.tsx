import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMicrophone, faGuitar, faTriangleExclamation, faLanguage } from '@fortawesome/free-solid-svg-icons'
import type { LyricsData } from '../../types'
import styles from './LyricsView.module.css'

interface Props {
  lyrics: LyricsData | null
  loading: boolean
  currentTime: number
  duration: number
  onSeek: (time: number) => void
  onEditWord?: (segIdx: number, wordIdx: number, newWord: string) => void
  hasTrack: boolean
}

const SPEAKER_CLASSES = [
  styles.speaker0, styles.speaker1, styles.speaker2,
  styles.speaker3, styles.speaker4, styles.speaker5,
]

export function LyricsView({ lyrics, loading, currentTime, duration, onSeek, onEditWord, hasTrack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollRef = useRef(0)
  const [editing, setEditing] = useState<{ seg: number; word: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [warningDismissed, setWarningDismissed] = useState(false)
  const editRef = useRef<HTMLInputElement>(null)

  const speakerMap = useMemo(() => {
    const map: Record<string, string> = {}
    let idx = 0
    lyrics?.segments.forEach(seg => {
      if (seg.speaker && !(seg.speaker in map)) {
        map[seg.speaker] = SPEAKER_CLASSES[idx % SPEAKER_CLASSES.length]
        idx++
      }
    })
    return map
  }, [lyrics])

  // Improved auto-scroll: smooth with read-ahead offset
  useEffect(() => {
    if (!containerRef.current || !lyrics || editing) return
    const activeLine = containerRef.current.querySelector(`.${styles.lineActive}`) as HTMLElement | null
    if (!activeLine) return

    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    // Position active line slightly above center (40% from top) for read-ahead feel
    const targetTop = containerRect.height * 0.4
    const offset = lineRect.top - containerRect.top - targetTop + lineRect.height / 2

    if (Math.abs(offset) > 30 && Date.now() - lastScrollRef.current > 80) {
      container.scrollTop += offset * 0.12
      lastScrollRef.current = Date.now()
    }
  }, [currentTime, lyrics, editing])

  // Auto-scroll for untimed lyrics
  useEffect(() => {
    if (!containerRef.current || !lyrics?.untimed || !lyrics?.plain_lyrics?.length || !duration) return
    const progress = duration > 0 ? currentTime / duration : 0
    const activeIdx = Math.min(
      Math.floor(progress * lyrics.plain_lyrics.length),
      lyrics.plain_lyrics.length - 1
    )
    const lines = containerRef.current.querySelectorAll(`.${styles.untimedLine}`)
    const activeLine = lines[activeIdx] as HTMLElement | undefined
    if (!activeLine) return

    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const lineRect = activeLine.getBoundingClientRect()
    const targetTop = containerRect.height * 0.4
    const offset = lineRect.top - containerRect.top - targetTop + lineRect.height / 2

    if (Math.abs(offset) > 30) {
      container.scrollTop += offset * 0.12
    }
  }, [currentTime, lyrics, duration])

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
        <div className={styles.untimedBanner}>
          <FontAwesomeIcon icon={faLanguage} />
          <span>Lyrics from external source — word-level timing unavailable</span>
        </div>
        {plainLyrics.map((line, i) => {
          const dist = Math.abs(i - activeLineIdx)
          const lineClass = [
            styles.line,
            styles.untimedLine,
            dist === 0 ? styles.lineNear : '',
            dist <= 2 && dist > 0 ? styles.lineNear : '',
          ].filter(Boolean).join(' ')

          return (
            <div key={i} className={lineClass}>
              <span className={styles.word}>{line || '\u00A0'}</span>
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

        // Smooth approach: ramp from lineNext → lineActive over 2s before activation
        const timeUntilStart = seg.start - currentTime
        const isApproaching = i === nextIndex && !isActive && timeUntilStart > 0 && timeUntilStart <= 2
        let approachStyle: React.CSSProperties | undefined
        if (isApproaching) {
          const linear = 1 - (timeUntilStart / 2) // 0 → 1
          const t = linear * linear * (3 - 2 * linear) // smoothstep
          approachStyle = { '--approach': t } as React.CSSProperties
        }

        const lineClass = [
          styles.line,
          spkClass,
          isActive ? styles.lineActive : '',
          isApproaching ? styles.lineApproaching : '',
          isNext && !isApproaching ? styles.lineNext : '',
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
            <div className={lineClass} style={approachStyle}>
              {seg.words.map((w, j) => {
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
            </div>
          </div>
        )
      })}
    </div>
  )
}
