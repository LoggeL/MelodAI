import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Icon } from '../common/Icon'
import { Modal } from '../common/Modal'
import { Fader } from './Fader'
import { LyricScale } from './LyricScale'
import { formatDuration } from '../../utils/format'
import { faderShort, supportsVerticalRange } from '../../utils/fader'
import styles from './Controls.module.css'

interface Props {
  disabled?: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  vocalsVolume?: number
  instrumentalVolume?: number
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onPrev: () => void
  onNext: () => void
  onVocalsVolume: (v: number) => void
  onInstrumentalVolume: (v: number) => void
  /** Lyric line starts (s) drawn as ticks on the progress track. */
  lineStarts?: number[]
  /** Instrumental gaps over 3 s drawn as blue segments. */
  pauses?: Array<[number, number]>
  lyricScale?: number
  onLyricScale?: (scale: number) => void
  stageMode?: boolean
  onStageMode?: (enter: boolean) => void
}

type Preset = 'karaoke' | 'withVocals' | 'custom'

function presetOf(vocals: number, instrumental: number): Preset {
  if (vocals === 0 && instrumental > 0) return 'karaoke'
  if (vocals === instrumental && vocals > 0) return 'withVocals'
  return 'custom'
}

function Meters({ vocals, instrumental }: { vocals: number; instrumental: number }) {
  return (
    <span className={styles.meters} aria-hidden="true">
      <i style={{ '--v': `${vocals}%`, '--c': 'var(--vocal)' } as CSSProperties} />
      <i style={{ '--v': `${instrumental}%`, '--c': 'var(--inst)' } as CSSProperties} />
    </span>
  )
}

export function Controls({
  disabled = false, isPlaying, currentTime, duration,
  vocalsVolume = 100, instrumentalVolume = 100,
  onTogglePlay, onSeek, onPrev, onNext, onVocalsVolume, onInstrumentalVolume,
  lineStarts = [], pauses = [], lyricScale = 1, onLyricScale, stageMode = false, onStageMode,
}: Props) {
  const [soundOpen, setSoundOpen] = useState(false)
  const [vertical] = useState(() => typeof document !== 'undefined' && supportsVerticalRange())
  const [announcement, setAnnouncement] = useState('')
  const previousVocals = useRef(vocalsVolume)
  const preset = presetOf(vocalsVolume, instrumentalVolume)
  const loudness = Math.max(vocalsVolume, instrumentalVolume) || 100
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  useEffect(() => {
    if (vocalsVolume === 0 && previousVocals.current !== 0) setAnnouncement('Gesang aus. Jetzt du.')
    else if (vocalsVolume !== 0) setAnnouncement('')
    previousVocals.current = vocalsVolume
  }, [vocalsVolume])

  const applyPreset = useCallback((next: Exclude<Preset, 'custom'>) => {
    onVocalsVolume(next === 'karaoke' ? 0 : loudness)
    onInstrumentalVolume(loudness)
  }, [loudness, onVocalsVolume, onInstrumentalVolume])

  const toggleStage = useCallback(() => onStageMode?.(!stageMode), [onStageMode, stageMode])

  // Keyboard shortcuts: Space, ←/→, F (Bühnenmodus), N, P. Skipped inside inputs and dialogs.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (disabled || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select, button, a, [role=slider], [role=combobox], [contenteditable=true], dialog')) return
      switch (e.key) {
        case ' ': e.preventDefault(); onTogglePlay(); break
        case 'ArrowLeft': e.preventDefault(); onSeek(Math.max(0, currentTime - 5)); break
        case 'ArrowRight': e.preventDefault(); onSeek(Math.min(duration, currentTime + 5)); break
        case 'f': case 'F': toggleStage(); break
        case 'n': onNext(); break
        case 'p': onPrev(); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onSeek, onNext, onPrev, toggleStage, currentTime, duration, disabled])

  const onProgressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    const time = event.key === 'Home' ? 0 : event.key === 'End' ? duration
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? currentTime - 5
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? currentTime + 5 : null
    if (time === null) return
    event.preventDefault()
    event.stopPropagation()
    onSeek(Math.max(0, Math.min(duration, time)))
  }

  const marks = useMemo(() => duration > 0 ? {
    ticks: lineStarts.filter(t => t >= 0 && t <= duration).map(t => (t / duration) * 100),
    pauses: pauses.filter(([s, e]) => e > s && s < duration).map(([s, e]) => [(s / duration) * 100, (Math.min(e, duration) - s) / duration * 100]),
  } : { ticks: [], pauses: [] }, [lineStarts, pauses, duration])

  const progress = (
    <div className={styles.progressRow}>
      <span className={styles.time}>{formatDuration(currentTime)}</span>
      <div className={styles.bar} style={{ '--t': `${pct}%`, '--tn': pct / 100 } as CSSProperties}>
        <div className={styles.marks} aria-hidden="true">
          {marks.pauses.map(([left, width], i) => <b key={i} style={{ left: `${left}%`, width: `${width}%` }} />)}
          {marks.ticks.map((left, i) => <i key={i} style={{ left: `${left}%` }} />)}
        </div>
        <input type="range" className={styles.progress} min={0} max={Math.max(duration, 0.1)} step={0.1}
          value={Math.min(currentTime, duration || 0)} disabled={disabled}
          aria-label="Wiedergabeposition" aria-valuetext={`${formatDuration(currentTime)} von ${formatDuration(duration)}`}
          onKeyDown={onProgressKey} onChange={e => onSeek(Number(e.target.value))} />
      </div>
      <span className={styles.time}>{formatDuration(duration)}</span>
    </div>
  )

  const transport = (
    <div className={styles.transport}>
      <button type="button" className={`iconbtn ${styles.skip}`} disabled={disabled} aria-label="Vorheriger Song" onClick={onPrev} title="Vorheriger Song (P)">
        <Icon name="prev" size={26} />
      </button>
      <button type="button" className={`playdisc ${styles.play}`} disabled={disabled} aria-label={isPlaying ? 'Pause' : 'Abspielen'}
        onClick={onTogglePlay} title={isPlaying ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)'}>
        <Icon name={isPlaying ? 'pause' : 'play'} size={30} />
      </button>
      <button type="button" className={`iconbtn ${styles.skip}`} disabled={disabled} aria-label="Nächster Song" onClick={onNext} title="Nächster Song (N)">
        <Icon name="next" size={26} />
      </button>
    </div>
  )

  const live = <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

  if (stageMode) {
    return (
      <div className={`${styles.controls} ${styles.tv}`} data-desk>
        {live}
        {progress}
        <div className={styles.tvRow}>
          <span className={styles.tvMeter}><Meters vocals={vocalsVolume} instrumental={instrumentalVolume} />
            <span>Gesang {faderShort(vocalsVolume)} · Instrumental {faderShort(instrumentalVolume)}</span></span>
          <div className={styles.tvTransport}>{transport}</div>
          <div className={styles.tvEnd}>
            {onLyricScale && <LyricScale value={lyricScale} onChange={onLyricScale} />}
            <span className={styles.hints}>Esc verlassen · Leertaste Pause</span>
            <button type="button" className="iconbtn iconbtn--outline" aria-label="Bühnenmodus verlassen (Esc)" title="Bühnenmodus verlassen (Esc)" onClick={() => onStageMode?.(false)}>
              <Icon name="x" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const presets = (
    <div className={`seg ${styles.presets}`} role="group" aria-label="Voreinstellung">
      <button type="button" aria-pressed={preset === 'karaoke'} title="Karaoke: Gesang aus" onClick={() => applyPreset('karaoke')}><Icon name="mic-off" size={16} /><span className={styles.presetLabel}>Karaoke</span></button>
      <button type="button" aria-pressed={preset === 'withVocals'} title="Mit Gesang" onClick={() => applyPreset('withVocals')}><Icon name="mic" size={16} /><span className={styles.presetLabel}>Mit Gesang</span></button>
      {preset === 'custom' && <span className={styles.customPreset} aria-current="true">Eigene</span>}
    </div>
  )

  const stageButton = (className: string) => (
    <button type="button" className={`iconbtn iconbtn--outline ${className}`} aria-label="Bühnenmodus (F)" title="Bühnenmodus (F)" onClick={() => onStageMode?.(true)}>
      <Icon name="tv" />
    </button>
  )

  return (
    <div className={styles.controls} data-desk>
      {live}
      {progress}
      <div className={styles.deskRow}>
        <div className={styles.faders}>
          <Fader channel="vocal" value={vocalsVolume} onChange={onVocalsVolume} className={styles.fader} />
          <Fader channel="inst" value={instrumentalVolume} onChange={onInstrumentalVolume} className={styles.fader} />
        </div>
        <div className={styles.compactFaders}>
          <Fader channel="vocal" value={vocalsVolume} onChange={onVocalsVolume} compact />
          <Fader channel="inst" value={instrumentalVolume} onChange={onInstrumentalVolume} compact />
        </div>
        <button type="button" className={styles.soundButton} aria-haspopup="dialog"
          aria-label={`Ton: ${vocalsVolume === 0 ? 'Gesang aus' : `Gesang ${vocalsVolume} %`}, ${instrumentalVolume === 0 ? 'Instrumental aus' : `Instrumental ${instrumentalVolume} %`}`}
          onClick={event => { event.currentTarget.focus(); setSoundOpen(true) }}>
          <Meters vocals={vocalsVolume} instrumental={instrumentalVolume} />
          <span>Ton</span>
        </button>
        {transport}
        <div className={styles.right}>
          {presets}
          <div className={styles.rightTools}>
            {onLyricScale && <LyricScale value={lyricScale} onChange={onLyricScale} />}
            {stageButton('')}
          </div>
        </div>
        {stageButton(styles.mobileStage)}
      </div>

      {soundOpen && (
        <Modal title="Ton" size="small" variant="sheet" onClose={() => setSoundOpen(false)}
          footer={<button type="button" className="btn btn--primary btn--block" onClick={() => setSoundOpen(false)}>Fertig</button>}>
          <div className={styles.sound}>
            <div className={styles.presetTiles} role="group" aria-label="Voreinstellung">
              <button type="button" aria-pressed={preset === 'karaoke'} onClick={() => applyPreset('karaoke')}>
                <strong>Karaoke</strong><span>Gesang aus, du singst allein.</span>
              </button>
              <button type="button" aria-pressed={preset === 'withVocals'} onClick={() => applyPreset('withVocals')}>
                <strong>Mit Gesang</strong><span>Originalstimme dabei, zum Reinfinden.</span>
              </button>
            </div>
            <div className={vertical ? styles.strips : styles.stripsHorizontal}>
              <Fader channel="vocal" value={vocalsVolume} onChange={onVocalsVolume} orientation={vertical ? 'vertical' : 'horizontal'} />
              <Fader channel="inst" value={instrumentalVolume} onChange={onInstrumentalVolume} orientation={vertical ? 'vertical' : 'horizontal'} />
              {!vertical && <span className={styles.endLabels} aria-hidden="true"><i>aus</i><i>voll</i></span>}
            </div>
            <p className={styles.tip}><Icon name={vocalsVolume === 0 ? 'mic-off' : 'mic'} />{vocalsVolume === 0 ? 'Gesang aus · Jetzt du.' : 'Gesang ganz runter, und du bist dran.'}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
