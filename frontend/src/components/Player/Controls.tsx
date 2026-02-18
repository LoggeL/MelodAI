import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faPlay, faForwardStep, faExpand } from '@fortawesome/free-solid-svg-icons'
import styles from './Controls.module.css'

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
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
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Derive initial mix/volume from stored per-track volumes ──────────────────
// mix=0: pure vocals, mix=50: both equal, mix=100: pure instrumental
function computeInitialMixVol(vv: number, iv: number): { mix: number; vol: number } {
  const vol = Math.max(vv, iv)
  if (vol === 0) return { mix: 50, vol: 100 }
  const mix = vv >= iv
    ? Math.round((iv / vv) * 50)
    : Math.round(100 - (vv / iv) * 50)
  return { mix, vol }
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
  if (norm < 0) norm += 360
  return Math.max(0, Math.min(100, Math.round((norm / K.sweep) * 100)))
}

interface KnobProps {
  value: number
  label: string
  knobId: string
  /** Show a centre-position marker (for mix knob) */
  centerMark?: boolean
  /** Custom text to render in the knob centre */
  centerText?: string
  /** Labels at arc start [value=0] and arc end [value=100] */
  endLabels?: [string, string]
  onChange: (v: number) => void
}

function ArcKnob({ value, label, knobId, centerMark, centerText, endLabels, onChange }: KnobProps) {
  const dragging = useRef(false)
  const endDeg = K.start + (value / 100) * K.sweep
  const dot = kPt(endDeg)
  const bgPath = kPath(K.start, K.start + K.sweep)
  const fillPath = value > 0 ? kPath(K.start, endDeg) : ''
  const gradId = `knob-grad-${knobId}`
  const glowId = `knob-glow-${knobId}`

  // Centre mark position: mix=50 sits at angle 0° (12 o'clock)
  const cmInner = kPt(0, K.r - 8)
  const cmOuter = kPt(0, K.r - 2)

  return (
    <div className={styles.knobContainer}>
      <svg
        width={K.size}
        height={K.size}
        viewBox={`0 0 ${K.size} ${K.size}`}
        className={styles.knobSvg}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          onChange(kValueFromPointer(e))
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          onChange(kValueFromPointer(e))
        }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
        style={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
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

        {/* Inner shadow ring */}
        <circle cx={K.cx} cy={K.cy} r={K.r + 3} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="6" />

        {/* Background track */}
        <path d={bgPath} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={K.stroke} strokeLinecap="round" />

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

        {/* Tick marks at 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const tickDeg = K.start + (tick / 100) * K.sweep
          const inner = kPt(tickDeg, K.r - 6)
          const outer = kPt(tickDeg, K.r - 3)
          const active = tick <= value
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

        {/* Centre-position marker (for mix knob) */}
        {centerMark && (
          <line
            x1={cmInner.x} y1={cmInner.y}
            x2={cmOuter.x} y2={cmOuter.y}
            stroke={Math.abs(value - 50) < 4 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)'}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}

        {/* Arc endpoint labels (e.g. VOX / INST) */}
        {endLabels && (
          <>
            <text x="3" y="63" textAnchor="start" fontSize="7" fontWeight="800"
              fontFamily="'Barlow Condensed', sans-serif" letterSpacing="0.5"
              fill={value < 50 ? 'var(--accent)' : 'rgba(255,255,255,0.25)'}>
              {endLabels[0]}
            </text>
            <text x="63" y="63" textAnchor="end" fontSize="7" fontWeight="800"
              fontFamily="'Barlow Condensed', sans-serif" letterSpacing="0.5"
              fill={value > 50 ? 'var(--accent)' : 'rgba(255,255,255,0.25)'}>
              {endLabels[1]}
            </text>
          </>
        )}

        {/* Indicator dot */}
        <circle
          cx={dot.x}
          cy={dot.y}
          r={3.5}
          fill={value > 0 ? '#fff' : 'rgba(255,255,255,0.15)'}
          filter={value > 0 ? `url(#${glowId})` : undefined}
        />

        {/* Centre value / label */}
        <text
          x={K.cx}
          y={K.cy + 5}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif"
          fill={value > 0 ? 'var(--text)' : 'var(--text-muted)'}
          letterSpacing="0.5"
        >
          {centerText ?? value}
        </text>
      </svg>
      <span className={styles.knobLabel}>{label}</span>
    </div>
  )
}

// ── Controls ──────────────────────────────────────────────────────────────────

export function Controls({
  isPlaying, currentTime, duration, analyserRef, thumbnail,
  initialVocalsVolume, initialInstrumentalVolume,
  onTogglePlay, onSeek, onPrev, onNext,
  onVocalsVolume, onInstrumentalVolume,
}: Props) {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  const { mix: initMix, vol: initVol } = computeInitialMixVol(
    initialVocalsVolume ?? 100,
    initialInstrumentalVolume ?? 100,
  )
  const [mix, setMix] = useState(initMix)
  const [masterVol, setMasterVol] = useState(initVol)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const vizAnimRef = useRef<number | null>(null)
  const smoothBarsRef = useRef(new Float32Array(80))

  // Sync gain nodes whenever mix or master volume changes
  useEffect(() => {
    const vocalsWeight = Math.min(1, Math.max(0, 2 * (100 - mix) / 100))
    const instWeight   = Math.min(1, Math.max(0, 2 * mix / 100))
    onVocalsVolume(Math.round(vocalsWeight * masterVol))
    onInstrumentalVolume(Math.round(instWeight * masterVol))
  }, [mix, masterVol, onVocalsVolume, onInstrumentalVolume])

  // Background frequency visualizer + bass-driven play button pulse
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cachedRgb = '217, 4, 41'
    let rgbFrame = 0
    let prevW = 0, prevH = 0
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
          prevW = w; prevH = h
        }
      }

      ctx.clearRect(0, 0, prevW, prevH)
      if (rgbFrame++ % 30 === 0) {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim()
        if (v) cachedRgb = v
      }

      const barCount = 80, gap = 1
      const barWidth = (prevW - (barCount - 1) * gap) / barCount
      const maxBarHeight = prevH * 0.7
      let hasActivity = false

      if (analyser && isPlaying) {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        let bassSum = 0
        const bassBins = Math.min(5, data.length)
        for (let i = 0; i < bassBins; i++) bassSum += data[i]
        const kick = (bassSum / (bassBins * 255)) ** 2
        wrapper.style.transform = `scale(${1 + kick * 0.45})`
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
        ctx.fillStyle = `rgba(${cachedRgb}, ${0.03 + value * 0.1})`
        ctx.fillRect(i * (barWidth + gap), prevH - (value * maxBarHeight + 1), barWidth, value * maxBarHeight + 1)
      }

      if (isPlaying || hasActivity) vizAnimRef.current = requestAnimationFrame(draw)
      else vizAnimRef.current = null
    }

    vizAnimRef.current = requestAnimationFrame(draw)
    return () => {
      if (vizAnimRef.current) cancelAnimationFrame(vizAnimRef.current)
      wrapper.style.transform = ''
      wrapper.style.filter = ''
    }
  }, [isPlaying, analyserRef])

  const isDraggingRef = useRef(false)

  const seekFromPointer = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration)
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

  const handlePointerUp = useCallback(() => { isDraggingRef.current = false }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
    else document.exitFullscreen()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      switch (e.key) {
        case ' ':  e.preventDefault(); onTogglePlay(); break
        case 'ArrowLeft': e.preventDefault(); onSeek(Math.max(0, currentTime - 5)); break
        case 'ArrowRight': e.preventDefault(); onSeek(Math.min(duration, currentTime + 5)); break
        case 'f': toggleFullscreen(); break
        case 'n': onNext(); break
        case 'p': onPrev(); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onSeek, onNext, onPrev, toggleFullscreen, currentTime, duration])

  // Label for mix knob centre text
  const mixCenterText = mix < 50 ? 'VOX' : mix === 50 ? 'EVEN' : 'INST'

  return (
    <div className={styles.controls}>
      <canvas ref={canvasRef} className={`${styles.visualizerBg} ${styles.visualizerBgActive}`} />

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
              value={mix}
              label="MIX"
              knobId="mix"
              centerMark
              centerText={mixCenterText}
              endLabels={['VOX', 'INST']}
              onChange={setMix}
            />
            <ArcKnob
              value={masterVol}
              label="VOL"
              knobId="vol"
              onChange={setMasterVol}
            />
          </div>
        </div>

        <div className={styles.playback}>
          <button className={styles.controlBtn} onClick={onPrev} title="Previous (P)">
            <FontAwesomeIcon icon={faBackwardStep} />
          </button>
          <div ref={wrapperRef} className={styles.playBtnWrapper}>
            <button
              className={`${styles.playBtn} ${isPlaying ? styles.playBtnPlaying : ''}`}
              onClick={onTogglePlay}
              title="Play/Pause (Space)"
            >
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
          <button className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen (F)">
            <FontAwesomeIcon icon={faExpand} />
          </button>
        </div>
      </div>
    </div>
  )
}
