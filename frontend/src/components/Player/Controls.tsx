import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faPlay, faForwardStep, faExpand, faMicrophone } from '@fortawesome/free-solid-svg-icons'
import styles from './Controls.module.css'

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  karaokeMode: boolean
  analyserRef: React.RefObject<AnalyserNode | null>
  thumbnail?: string
  initialVocalsVolume?: number
  initialInstrumentalVolume?: number
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onPrev: () => void
  onNext: () => void
  onVocalsVolume: (v: number) => void
  onInstrumentalVolume: (v: number) => void
  onToggleKaraoke: () => void
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Arc Knob ──────────────────────────────────────────────────────────────────
const K = { size: 66, cx: 33, cy: 33, r: 23, stroke: 4.5, start: 225, sweep: 270 }

function kPt(deg: number, r: number = K.r) {
  const rad = (deg * Math.PI) / 180
  return { x: K.cx + r * Math.sin(rad), y: K.cy - r * Math.cos(rad) }
}

function kPath(from: number, to: number): string {
  if (to - from < 0.5) return ''
  const s = kPt(from)
  const e = kPt(to)
  const large = to - from > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${K.r} ${K.r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

function kValueFromPointer(e: React.PointerEvent<SVGSVGElement>): number {
  const rect = e.currentTarget.getBoundingClientRect()
  const scaleX = K.size / rect.width
  const scaleY = K.size / rect.height
  const dx = (e.clientX - rect.left) * scaleX - K.cx
  const dy = (e.clientY - rect.top) * scaleY - K.cy
  let deg = Math.atan2(dx, -dy) * (180 / Math.PI)
  if (deg < 0) deg += 360
  let norm = deg - K.start
  if (norm < -(K.sweep / 2 + 45)) norm += 360
  return Math.max(0, Math.min(100, Math.round((Math.max(0, norm) / K.sweep) * 100)))
}

interface KnobProps {
  value: number
  disabled?: boolean
  label: string
  knobId: string
  onChange: (v: number) => void
}

function ArcKnob({ value, disabled, label, knobId, onChange }: KnobProps) {
  const dragging = useRef(false)
  const endDeg = K.start + (value / 100) * K.sweep
  const dot = kPt(endDeg)
  const dotStart = kPt(K.start)
  const bgPath = kPath(K.start, K.start + K.sweep)
  const fillPath = value > 0 && !disabled ? kPath(K.start, endDeg) : ''
  const gradId = `knob-grad-${knobId}`
  const glowId = `knob-glow-${knobId}`

  return (
    <div className={`${styles.knobContainer} ${disabled ? styles.knobDisabled : ''}`}>
      <svg
        width={K.size}
        height={K.size}
        viewBox={`0 0 ${K.size} ${K.size}`}
        className={styles.knobSvg}
        onPointerDown={(e) => {
          if (disabled) return
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          onChange(kValueFromPointer(e))
        }}
        onPointerMove={(e) => {
          if (!dragging.current || disabled) return
          onChange(kValueFromPointer(e))
        }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
        style={{ cursor: disabled ? 'not-allowed' : 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--primary-dark)" />
          </linearGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle inner shadow ring */}
        <circle cx={K.cx} cy={K.cy} r={K.r + 3} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="6" />

        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={K.stroke}
          strokeLinecap="round"
        />

        {/* Filled track */}
        {fillPath && (
          <path
            d={fillPath}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={K.stroke}
            strokeLinecap="round"
            filter={`url(#${glowId})`}
          />
        )}

        {/* Track tick marks */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const tickDeg = K.start + (tick / 100) * K.sweep
          const inner = kPt(tickDeg, K.r - 6)
          const outer = kPt(tickDeg, K.r - 3)
          const active = !disabled && tick <= value
          return (
            <line
              key={tick}
              x1={inner.x} y1={inner.y}
              x2={outer.x} y2={outer.y}
              stroke={active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.1)'}
              strokeWidth="1"
              strokeLinecap="round"
            />
          )
        })}

        {/* Indicator dot */}
        {!disabled ? (
          <circle
            cx={dot.x}
            cy={dot.y}
            r={3.5}
            fill={value > 0 ? '#fff' : 'rgba(255,255,255,0.15)'}
            filter={value > 0 ? `url(#${glowId})` : undefined}
          />
        ) : (
          <circle cx={dotStart.x} cy={dotStart.y} r={2.5} fill="rgba(255,255,255,0.08)" />
        )}

        {/* Center value */}
        <text
          x={K.cx}
          y={K.cy + 5}
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif"
          fill={disabled ? 'rgba(255,255,255,0.12)' : value > 0 ? 'var(--text)' : 'var(--text-muted)'}
          letterSpacing="0.5"
        >
          {disabled ? '—' : value}
        </text>
      </svg>
      <span className={styles.knobLabel}>{label}</span>
    </div>
  )
}

// ── Controls ──────────────────────────────────────────────────────────────────

export function Controls({
  isPlaying, currentTime, duration, karaokeMode, analyserRef, thumbnail,
  initialVocalsVolume, initialInstrumentalVolume,
  onTogglePlay, onSeek, onPrev, onNext,
  onVocalsVolume, onInstrumentalVolume, onToggleKaraoke,
}: Props) {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const [vocalsVol, setVocalsVol] = useState(initialVocalsVolume ?? 50)
  const [instrumentalVol, setInstrumentalVol] = useState(initialInstrumentalVolume ?? 50)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const vizAnimRef = useRef<number | null>(null)
  const smoothBarsRef = useRef(new Float32Array(80))

  // Background frequency visualizer + bass-driven play button pulse
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cachedRgb = '217, 4, 41'
    let rgbFrame = 0
    let prevW = 0
    let prevH = 0
    const smoothBars = smoothBarsRef.current
    const decay = 0.92

    const draw = () => {
      const analyser = analyserRef.current

      const parent = canvas.parentElement
      if (parent) {
        const w = parent.clientWidth
        const h = parent.clientHeight
        if (w !== prevW || h !== prevH) {
          const dpr = window.devicePixelRatio || 1
          canvas.width = Math.floor(w * dpr)
          canvas.height = Math.floor(h * dpr)
          canvas.style.width = w + 'px'
          canvas.style.height = h + 'px'
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          prevW = w
          prevH = h
        }
      }

      ctx.clearRect(0, 0, prevW, prevH)

      if (rgbFrame++ % 30 === 0) {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim()
        if (v) cachedRgb = v
      }

      const barCount = 80
      const gap = 1
      const barWidth = (prevW - (barCount - 1) * gap) / barCount
      const maxBarHeight = prevH * 0.7
      let hasActivity = false

      if (analyser && isPlaying) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)

        let bassSum = 0
        const bassBins = Math.min(5, data.length)
        for (let i = 0; i < bassBins; i++) bassSum += data[i]
        const bassEnergy = bassSum / (bassBins * 255)
        const kick = bassEnergy * bassEnergy
        const scale = 1 + kick * 0.45
        wrapper.style.transform = `scale(${scale})`
        wrapper.style.filter = `drop-shadow(0 0 ${8 + kick * 40}px rgba(${cachedRgb}, ${0.25 + kick * 0.65}))`

        const step = Math.max(1, Math.floor(data.length / barCount))
        for (let i = 0; i < barCount; i++) {
          const target = data[i * step] / 255
          smoothBars[i] = target > smoothBars[i] ? target : smoothBars[i] * decay
        }
        hasActivity = true
      } else {
        wrapper.style.transform = ''
        wrapper.style.filter = ''
        for (let i = 0; i < barCount; i++) {
          smoothBars[i] *= decay
          if (smoothBars[i] > 0.001) hasActivity = true
        }
      }

      for (let i = 0; i < barCount; i++) {
        const value = smoothBars[i]
        if (value < 0.001) continue
        const barHeight = value * maxBarHeight + 1
        const alpha = 0.03 + value * 0.1
        ctx.fillStyle = `rgba(${cachedRgb}, ${alpha})`
        const x = i * (barWidth + gap)
        ctx.fillRect(x, prevH - barHeight, barWidth, barHeight)
      }

      if (isPlaying || hasActivity) {
        vizAnimRef.current = requestAnimationFrame(draw)
      } else {
        vizAnimRef.current = null
      }
    }

    vizAnimRef.current = requestAnimationFrame(draw)
    return () => {
      if (vizAnimRef.current) cancelAnimationFrame(vizAnimRef.current)
      wrapper.style.transform = ''
      wrapper.style.filter = ''
    }
  }, [isPlaying, analyserRef])

  const handleVocalsChange = useCallback((v: number) => {
    setVocalsVol(v)
    onVocalsVolume(v)
  }, [onVocalsVolume])

  const handleInstrumentalChange = useCallback((v: number) => {
    setInstrumentalVol(v)
    onInstrumentalVolume(v)
  }, [onInstrumentalVolume])

  const isDraggingRef = useRef(false)

  const seekFromPointer = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(ratio * duration)
  }, [duration, onSeek])

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    seekFromPointer(e)
  }, [seekFromPointer])

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    seekFromPointer(e)
  }, [seekFromPointer])

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen()
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          onTogglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          onSeek(Math.max(0, currentTime - 5))
          break
        case 'ArrowRight':
          e.preventDefault()
          onSeek(Math.min(duration, currentTime + 5))
          break
        case 'k':
          onToggleKaraoke()
          break
        case 'f':
          toggleFullscreen()
          break
        case 'n':
          onNext()
          break
        case 'p':
          onPrev()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onSeek, onNext, onPrev, onToggleKaraoke, toggleFullscreen, currentTime, duration])

  return (
    <div className={styles.controls}>
      <canvas
        ref={canvasRef}
        className={`${styles.visualizerBg} ${styles.visualizerBgActive}`}
      />
      <div className={styles.progressRow}>
        <div className={styles.progress}>
          <span className={styles.time}>{formatTime(currentTime)}</span>
          <div
            className={styles.barWrapper}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div className={styles.barFill} style={{ width: `${pct}%` }}>
              <div className={styles.thumb} />
            </div>
          </div>
          <span className={styles.time}>{formatTime(duration)}</span>
        </div>
      </div>

      <div className={styles.buttonsRow}>
        <div className={styles.leftControls}>
          <div className={styles.knobPanel}>
            <ArcKnob
              value={karaokeMode ? 0 : vocalsVol}
              disabled={karaokeMode}
              label="VOX"
              knobId="vocals"
              onChange={handleVocalsChange}
            />
            <ArcKnob
              value={instrumentalVol}
              label="INST"
              knobId="inst"
              onChange={handleInstrumentalChange}
            />
          </div>
        </div>

        <div className={styles.playback}>
          <button className={styles.controlBtn} onClick={onPrev} title="Previous (P)">
            <FontAwesomeIcon icon={faBackwardStep} />
          </button>
          <div ref={wrapperRef} className={styles.playBtnWrapper}>
            <button className={`${styles.playBtn} ${isPlaying ? styles.playBtnPlaying : ''}`} onClick={onTogglePlay} title="Play/Pause (Space)">
              {isPlaying ? (
                <div className={styles.record}>
                  <div className={styles.recordGrooves} />
                  <div className={styles.recordLabel}>
                    {thumbnail && <img src={thumbnail} alt="" className={styles.recordArt} />}
                  </div>
                  <div className={styles.recordHole} />
                </div>
              ) : (
                <FontAwesomeIcon icon={faPlay} />
              )}
            </button>
          </div>
          <button className={styles.controlBtn} onClick={onNext} title="Next (N)">
            <FontAwesomeIcon icon={faForwardStep} />
          </button>
        </div>

        <div className={styles.rightControls}>
          <button
            className={`${styles.karaokeBtn} ${karaokeMode ? styles.karaokeBtnActive : ''}`}
            onClick={onToggleKaraoke}
            title="Karaoke mode (K)"
          >
            <span className={styles.karaokeIndicator} />
            <span className={styles.karaokeMicWrap}>
              <FontAwesomeIcon icon={faMicrophone} className={styles.karaokeMicIcon} />
            </span>
            <span className={styles.karaokeBtnLabel}>
              {karaokeMode ? 'SINGING' : 'KARAOKE'}
            </span>
          </button>
          <button className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen (F)">
            <FontAwesomeIcon icon={faExpand} />
          </button>
        </div>
      </div>
    </div>
  )
}
