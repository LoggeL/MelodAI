import { useCallback, useEffect, useRef, useState } from 'react'
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

function sliderTrackStyle(value: number): React.CSSProperties {
  return {
    background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${value}%, var(--surface-hover) ${value}%, var(--surface-hover) 100%)`,
  }
}

export function Controls({
  isPlaying, currentTime, duration, karaokeMode, analyserRef, thumbnail,
  onTogglePlay, onSeek, onPrev, onNext,
  onVocalsVolume, onInstrumentalVolume, onToggleKaraoke,
}: Props) {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const [vocalsVol, setVocalsVol] = useState(50)
  const [instrumentalVol, setInstrumentalVol] = useState(50)
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
    const decay = 0.92 // how fast bars shrink when paused

    const draw = () => {
      const analyser = analyserRef.current

      // Resize canvas to match parent
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

      // Refresh cached color every ~30 frames
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

        // Bass kick energy for play button pulsation (sub-bass + kick bins 0-4)
        let bassSum = 0
        const bassBins = Math.min(5, data.length)
        for (let i = 0; i < bassBins; i++) {
          bassSum += data[i]
        }
        const bassEnergy = bassSum / (bassBins * 255)
        // Apply a power curve to emphasize peaks (kicks) over sustained bass
        const kick = bassEnergy * bassEnergy
        const scale = 1 + kick * 0.45
        wrapper.style.transform = `scale(${scale})`
        wrapper.style.filter = `drop-shadow(0 0 ${8 + kick * 40}px rgba(${cachedRgb}, ${0.25 + kick * 0.65}))`

        // Update smooth bars with live data
        const step = Math.max(1, Math.floor(data.length / barCount))
        for (let i = 0; i < barCount; i++) {
          const target = data[i * step] / 255
          // Smooth rise + fall
          smoothBars[i] = target > smoothBars[i]
            ? target
            : smoothBars[i] * decay
        }
        hasActivity = true
      } else {
        // Decay bars smoothly when paused
        wrapper.style.transform = ''
        wrapper.style.filter = ''
        for (let i = 0; i < barCount; i++) {
          smoothBars[i] *= decay
          if (smoothBars[i] > 0.001) hasActivity = true
        }
      }

      // Draw bars (both playing and during fade-out)
      for (let i = 0; i < barCount; i++) {
        const value = smoothBars[i]
        if (value < 0.001) continue
        const barHeight = value * maxBarHeight + 1
        const alpha = 0.03 + value * 0.1
        ctx.fillStyle = `rgba(${cachedRgb}, ${alpha})`
        const x = i * (barWidth + gap)
        ctx.fillRect(x, prevH - barHeight, barWidth, barHeight)
      }

      // Keep animating during fade-out even when paused
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

  const handleVocalsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setVocalsVol(val)
    onVocalsVolume(val)
  }, [onVocalsVolume])

  const handleInstrumentalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setInstrumentalVol(val)
    onInstrumentalVolume(val)
  }, [onInstrumentalVolume])

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(ratio * duration)
  }, [duration, onSeek])

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
          <div className={styles.barWrapper} onClick={handleBarClick}>
            <div className={styles.barFill} style={{ width: `${pct}%` }}>
              <div className={styles.thumb} />
            </div>
          </div>
          <span className={styles.time}>{formatTime(duration)}</span>
        </div>
      </div>

      <div className={styles.buttonsRow}>
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
            <FontAwesomeIcon icon={faMicrophone} />
          </button>
          <div className={styles.volumeStack}>
            <div className={styles.volumeGroup}>
              <div className={styles.volumeLabelRow}>
                <span className={styles.volumeLabel}>Vocals</span>
                <span className={styles.volumeValue}>{vocalsVol}%</span>
              </div>
              <input
                type="range"
                className={styles.slider}
                min="0" max="100" value={vocalsVol}
                title="Vocals volume"
                disabled={karaokeMode}
                style={sliderTrackStyle(karaokeMode ? 0 : vocalsVol)}
                onChange={handleVocalsChange}
              />
            </div>
            <div className={styles.volumeGroup}>
              <div className={styles.volumeLabelRow}>
                <span className={styles.volumeLabel}>Instrumental</span>
                <span className={styles.volumeValue}>{instrumentalVol}%</span>
              </div>
              <input
                type="range"
                className={styles.slider}
                min="0" max="100" value={instrumentalVol}
                title="Instrumental volume"
                style={sliderTrackStyle(instrumentalVol)}
                onChange={handleInstrumentalChange}
              />
            </div>
          </div>
          <button className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen (F)">
            <FontAwesomeIcon icon={faExpand} />
          </button>
        </div>
      </div>
    </div>
  )
}
