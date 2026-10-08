import { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback, type CSSProperties } from 'react'
import type { LyricsData, LyricsSegment, LyricTranslation } from '../../types'
import { Icon } from '../common/Icon'
import { formatSeconds } from '../../utils/format'
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
  translationMode: 'original' | 'translation' | 'both'
  /** Gesang fader at 0 → „Gesang aus · Jetzt du.“ cue above the active line. */
  vocalsMuted?: boolean
  /** Text language for hyphenation; defaults to German. */
  lang?: string
  /** Larger cue in Bühnenmodus. */
  stageMode?: boolean
}

const BREAK_THRESHOLD = 3
const DONE_HOLD = 1

/** §6.3: long lines shrink so the active line never exceeds three lines. */
function lyricFit(text: string): number {
  return text.length > 64 ? 0.7 : text.length > 42 ? 0.82 : 1
}

function segmentText(seg: LyricsSegment): string {
  return seg.words.map(word => word.word).join(' ')
}

interface Timeline {
  /** Line shown in the active slot. */
  active: number
  /** Active line is already fully sung (gap hold). */
  done: boolean
  /** Active line has not started yet (it fills the active slot during a long break). */
  preview: boolean
  next: number
  breakRemaining: number | null
  breakTotal: number
}

function timeline(segments: LyricsSegment[], t: number): Timeline {
  const none: Timeline = { active: -1, done: false, preview: false, next: -1, breakRemaining: null, breakTotal: 0 }
  if (!segments.length) return none
  const running = segments.findIndex(seg => t >= seg.start && t <= seg.end + 0.3)
  if (running >= 0) return { ...none, active: running, next: running + 1 < segments.length ? running + 1 : -1 }
  let last = -1
  for (let i = 0; i < segments.length; i++) if (segments[i].start <= t) last = i
  const upcoming = last + 1 < segments.length ? last + 1 : -1
  const prevEnd = last >= 0 ? segments[last].end : 0
  const gap = upcoming >= 0 ? segments[upcoming].start - prevEnd : 0
  const remaining = upcoming >= 0 ? segments[upcoming].start - t : 0
  const longBreak = upcoming >= 0 && gap > BREAK_THRESHOLD && remaining > 0.5
  if (last >= 0 && (upcoming < 0 ? t <= prevEnd + DONE_HOLD : !longBreak || t <= prevEnd + DONE_HOLD)) {
    return { ...none, active: last, done: true, next: upcoming }
  }
  if (upcoming >= 0) {
    return {
      active: upcoming, done: false, preview: true, next: upcoming + 1 < segments.length ? upcoming + 1 : -1,
      breakRemaining: longBreak ? remaining : null, breakTotal: gap,
    }
  }
  return { ...none, active: -1 }
}

export function LyricsView({
  lyrics, loading, currentTime, isPlaying = false, duration, onSeek, onEditWord, hasTrack,
  translation, translationMode, vocalsMuted = false, lang = 'de', stageMode = false,
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
  const editRef = useRef<HTMLInputElement>(null)
  const nextRectRef = useRef<{ index: number; top: number; fontSize: number } | null>(null)
  const translationByIndex = useMemo(() => {
    const map = new Map<number, string>()
    translation?.lines?.forEach(line => map.set(line.index, line.translation))
    return map
  }, [translation])
  const showOriginal = translationMode !== 'translation' || !translation?.available
  const showTranslation = translationMode !== 'original' && !!translation?.available
  const onlyTranslation = showTranslation && !showOriginal

  const segments = useMemo(() => lyrics?.segments || [], [lyrics])
  const plainLyrics = useMemo(() => lyrics?.plain_lyrics || [], [lyrics])
  const isUntimed = !!lyrics?.untimed && plainLyrics.length > 0

  const speakerTags = useMemo(() => {
    const tags = new Map<number, string>()
    const order: string[] = []
    segments.forEach(seg => { if (seg.speaker && !order.includes(seg.speaker)) order.push(seg.speaker) })
    if (order.length < 2) return tags
    let previous = ''
    segments.forEach((seg, i) => {
      if (seg.speaker && seg.speaker !== previous) tags.set(i, String.fromCharCode(65 + (order.indexOf(seg.speaker) % 26)))
      previous = seg.speaker
    })
    return tags
  }, [segments])

  const state = useMemo<Timeline>(() => {
    if (isUntimed) {
      const progress = duration > 0 ? currentTime / duration : 0
      const active = Math.min(Math.floor(progress * plainLyrics.length), plainLyrics.length - 1)
      return { active, done: false, preview: false, next: active + 1 < plainLyrics.length ? active + 1 : -1, breakRemaining: null, breakTotal: 0 }
    }
    return timeline(segments, currentTime)
  }, [isUntimed, duration, currentTime, plainLyrics.length, segments])

  const centerActiveLine = useCallback((force = false) => {
    const container = containerRef.current
    if (!container || editingRef.current || (!force && Date.now() < manualScrollUntilRef.current)) return
    const lines = container.querySelectorAll<HTMLElement>(`.${styles.line}`)
    const activeLine = container.querySelector<HTMLElement>(`.${styles.lineActive}`)
      ?? (currentTimeRef.current > 0 ? lines[lines.length - 1] : lines[0])
    if (!activeLine || (!force && activeLine === lastActiveLineRef.current)) return
    lastActiveLineRef.current = activeLine
    // Layout offsets, not client rects: a running FLIP transform must not skew the target.
    let lineTop = 0
    for (let el: HTMLElement | null = activeLine; el && el !== container; el = el.offsetParent as HTMLElement | null) lineTop += el.offsetTop
    const readingPosition = container.clientHeight * (window.matchMedia('(min-width: 900px)').matches ? 0.42 : 0.4)
    const offset = lineTop - container.scrollTop + activeLine.offsetHeight / 2 - readingPosition
    if (Math.abs(offset) < 4) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top: container.scrollTop + offset, behavior: force || reducedMotion ? 'instant' : 'smooth' })
  }, [])

  // FLIP: the size change happens through the state class (one reflow per line);
  // the new active line animates from its previous „Als Nächstes“ geometry.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>(`.${styles.lineActive}`)
    const previous = nextRectRef.current
    if (active && previous && previous.index === state.active && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && active.animate) {
      const rect = active.getBoundingClientRect()
      const fontSize = parseFloat(getComputedStyle(active).fontSize) || 1
      const scale = previous.fontSize / fontSize
      const dy = previous.top - rect.top
      if (Math.abs(scale - 1) > 0.02) {
        active.animate([{ transform: `translateY(${dy}px) scale(${scale})` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    const next = container.querySelector<HTMLElement>(`.${styles.lineNext}`)
    nextRectRef.current = next
      ? { index: Number(next.dataset.index), top: next.getBoundingClientRect().top, fontSize: parseFloat(getComputedStyle(next).fontSize) || 1 }
      : null
  }, [state.active])

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
  }, [translationMode, translation, editing, duration, stageMode, centerActiveLine])

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

  const cancelEdit = useCallback(() => setEditing(null), [])

  if (!hasTrack) return null

  if (loading) {
    return (
      <div className={styles.container} aria-busy="true" aria-label="Text wird geladen">
        <div className={styles.skeleton}>
          {['near', 'near', 'active', 'near', 'near'].map((size, i) => (
            <div key={i} className={`skeleton ${size === 'active' ? styles.skeletonActive : styles.skeletonNear}`} style={{ width: `${[58, 72, 80, 64, 46][i]}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (segments.length === 0 && !isUntimed) {
    return (
      <div className={styles.container}>
        <div className={`emptyState ${styles.noLyrics}`}>
          <span className={styles.noLyricsIcon}><Icon name="guitar" size={26} /></span>
          <h3>Instrumental – kein Text gefunden.</h3>
          <p>Du kannst trotzdem mitsummen.</p>
        </div>
      </div>
    )
  }

  const lineClass = (i: number) => {
    if (i === state.active) return state.done ? `${styles.lineActive} ${styles.lineDone}` : styles.lineActive
    if (i === state.next) return styles.lineNext
    if (state.active >= 0 ? i < state.active : (isUntimed ? false : (segments[i]?.end ?? 0) < currentTime)) return styles.linePast
    return styles.lineFar
  }

  const cue = (
    <div className={`${styles.cue} ${stageMode ? styles.cueStage : ''}`} aria-hidden="true">
      <Icon name="mic-off" size={16} /> Gesang aus · Jetzt du.
    </div>
  )

  const breakRow = state.breakRemaining !== null && (
    <div className={styles.breakRow} aria-hidden="true">
      <span>Instrumental · {formatSeconds(state.breakRemaining)}</span>
      <span className={styles.breakDots}>
        {[0, 1, 2].map(dot => {
          const elapsed = 1 - state.breakRemaining! / Math.max(state.breakTotal, 0.1)
          return <i key={dot} className={elapsed > (dot + 1) / 3 ? styles.dotOut : undefined} />
        })}
      </span>
    </div>
  )

  const renderTranslation = (index: number) => showTranslation && (
    <span className={onlyTranslation ? styles.translationOnly : styles.translationLine}>{translationByIndex.get(index) || ' '}</span>
  )

  return (
    <div className={styles.container} ref={containerRef} lang={lang} aria-live="off" tabIndex={-1}>
      <div className={styles.spacer} aria-hidden="true" />
      {isUntimed
        ? plainLyrics.map((line, i) => (
          <div key={i} className={styles.lineWrap}>
            {i === state.next && <div className={styles.nextKicker} aria-hidden="true">Als Nächstes</div>}
            {i === state.active && vocalsMuted && cue}
            <p data-index={i} className={`${styles.line} ${lineClass(i)}`} aria-current={i === state.active ? 'true' : undefined}
              style={{ '--lyric-fit': lyricFit(line) } as CSSProperties}>
              {showOriginal && <span>{line || ' '}</span>}
              {renderTranslation(i)}
            </p>
          </div>
        ))
        : segments.map((seg, i) => {
          const isActive = i === state.active
          const sweeping = isActive && !state.done && !state.preview
          const tag = speakerTags.get(i)
          return (
            <div key={i} className={styles.lineWrap}>
              {isActive && breakRow}
              {i === state.next && <div className={styles.nextKicker} aria-hidden="true">Als Nächstes</div>}
              {isActive && vocalsMuted && cue}
              <p data-index={i} className={`${styles.line} ${lineClass(i)}`} aria-current={isActive ? 'true' : undefined}
                style={{ '--lyric-fit': lyricFit(segmentText(seg)) } as CSSProperties}>
                {tag && <span className={styles.speaker} aria-label={`Stimme ${tag}`}>{tag}</span>}
                {showOriginal && seg.words.map((w, j) => {
                  if (editing?.seg === i && editing?.word === j) {
                    return (
                      <input key={j} ref={editRef} className={styles.wordEdit} value={editValue} aria-label="Wort bearbeiten"
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
                        onBlur={commitEdit}
                        style={{ width: `${Math.max(editValue.length + 1, 3)}ch` }} />
                    )
                  }
                  let wordState = ''
                  let style: CSSProperties | undefined
                  if (isActive && state.done) wordState = styles.wordSung
                  else if (sweeping) {
                    if (currentTime > w.end) wordState = styles.wordSung
                    else if (currentTime >= w.start) {
                      const p = Math.min(1, Math.max(0, (currentTime - w.start) / Math.max(w.end - w.start, 0.01)))
                      wordState = styles.wordNow
                      style = { '--p': `${(p * 100).toFixed(1)}%`, '--p-num': p.toFixed(3) } as CSSProperties
                    }
                  }
                  return (
                    <span key={j}>
                      <span className={`${styles.word} ${wordState}`} style={style} data-text={w.word}
                        onClick={() => onSeek(w.start)} onDoubleClick={() => handleDoubleClick(i, j, w.word)}
                        title="Klicken zum Springen, Doppelklick zum Bearbeiten">{w.word}</span>
                      {j < seg.words.length - 1 ? ' ' : ''}
                    </span>
                  )
                })}
                {renderTranslation(i)}
              </p>
            </div>
          )
        })}
      <div className={styles.spacer} aria-hidden="true" />
    </div>
  )
}
