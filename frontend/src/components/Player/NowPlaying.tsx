import { useState, useCallback, useEffect, useRef, useId } from 'react'
import type { LyricTranslation, QueueItem, TranslationLanguage } from '../../types'
import { useToast } from '../../hooks/useToast'
import { HeartButton } from '../HeartButton/HeartButton'
import { Icon } from '../common/Icon'
import { Cover } from '../common/Cover'
import { Modal } from '../common/Modal'
import { LyricScale } from './LyricScale'
import styles from './NowPlaying.module.css'

export type TranslationMode = 'original' | 'translation' | 'both'

interface Props {
  track: QueueItem | null
  isFavorite?: boolean
  onToggleFavorite?: (trackId: string) => void
  /** „Ohne Timing“ or „Timing unsicher · 54 %“ kicker; never an overlay on the lyrics. */
  lyricsNote?: { kind: 'untimed' } | { kind: 'low'; confidence: number } | null
  translation?: LyricTranslation | null
  translationLanguage?: TranslationLanguage
  translationMode?: TranslationMode
  translationLoading?: boolean
  onTranslationLanguageChange?: (language: TranslationLanguage) => void
  onTranslationModeChange?: (mode: TranslationMode) => void
  onTranslate?: () => void
  lyricScale?: number
  onLyricScale?: (scale: number) => void
}

const LANGUAGES: Array<{ code: TranslationLanguage; label: string }> = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
]

const DOWNLOADS = [
  { type: 'no_vocals', file: 'no_vocals.mp3', label: 'Nur Instrumental', name: 'Instrumental' },
  { type: 'vocals', file: 'vocals.mp3', label: 'Nur Gesang', name: 'Gesang' },
  { type: 'song', file: 'song.mp3', label: 'Ganzer Song', name: 'Original' },
] as const

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { close(); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open, close, ref])
}

export function NowPlaying({
  track, isFavorite, onToggleFavorite, lyricsNote,
  translation, translationLanguage = 'de', translationMode = 'original', translationLoading = false,
  onTranslationLanguageChange, onTranslationModeChange, onTranslate, lyricScale = 1, onLyricScale,
}: Props) {
  const [menu, setMenu] = useState<'translation' | 'download' | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const translationRef = useRef<HTMLDivElement>(null)
  const downloadRef = useRef<HTMLDivElement>(null)
  const translationPanelId = useId()
  const downloadMenuId = useId()
  const closeMenu = useCallback(() => setMenu(null), [])
  useDismiss(menu === 'translation', closeMenu, translationRef)
  useDismiss(menu === 'download', closeMenu, downloadRef)
  const toast = useToast()

  const handleDownload = useCallback(async (option: typeof DOWNLOADS[number]) => {
    if (!track || downloading) return
    setDownloading(true)
    setMenu(null)
    setSheetOpen(false)
    toast.success(`${option.name} wird heruntergeladen …`)
    try {
      const resp = await fetch(`/songs/${track.id}/${option.file}`)
      if (!resp.ok) throw new Error('Download unavailable')
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${track.artist} - ${track.title} (${option.name}).mp3`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch {
      toast.error('Download fehlgeschlagen.')
    } finally { setDownloading(false) }
  }, [track, toast, downloading])

  const handleShare = useCallback(() => {
    if (!track) return
    setSheetOpen(false)
    const url = `${window.location.origin}/song/${track.id}`
    if (!navigator.clipboard) { toast.warning('Die Zwischenablage ist in diesem Browser nicht verfügbar.'); return }
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link kopiert.'),
      () => toast.warning('Link konnte nicht kopiert werden.'),
    )
  }, [track, toast])

  if (!track) return null

  const translationAvailable = !!translation?.available
  const translationPanel = (
    <div className={styles.translationPanel}>
      <label className="field">
        <span className="field-label">Sprache</span>
        <select className="input" value={translationLanguage} aria-label="Übersetzungssprache"
          onChange={e => onTranslationLanguageChange?.(e.target.value as TranslationLanguage)}>
          {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
        </select>
      </label>
      <div className="seg" role="group" aria-label="Anzeige">
        <button type="button" aria-pressed={translationMode === 'original'} onClick={() => onTranslationModeChange?.('original')}>Original</button>
        <button type="button" aria-pressed={translationMode === 'translation'} disabled={!translationAvailable && !translationLoading} onClick={() => onTranslationModeChange?.('translation')}>Übersetzung</button>
        <button type="button" aria-pressed={translationMode === 'both'} disabled={!translationAvailable && !translationLoading} onClick={() => onTranslationModeChange?.('both')}>Beide</button>
      </div>
      {!translationAvailable && (
        <button type="button" className="btn btn--primary" onClick={onTranslate} disabled={translationLoading} aria-busy={translationLoading}>
          {translationLoading ? <><span className="spinner" aria-hidden="true" /><span className="spinner-text">Lädt …</span> Übersetzt …</> : <><Icon name="lang" /> Übersetzen</>}
        </button>
      )}
    </div>
  )

  return (
    <div className={styles.wrapper}>
      <Cover className={styles.art} src={track.thumbnail} />
      <div className={styles.info}>
        <span className={`kicker ${styles.live}`}><span className="live-dot" aria-hidden="true" />Läuft</span>
        <h1 className={styles.title} aria-live="polite">{track.title}</h1>
        <div className={styles.artist}>{track.artist}</div>
        {lyricsNote?.kind === 'untimed' && <span className={`kicker ${styles.note}`}>Ohne Timing<span className={styles.noteLong}> · gleichmäßiger Bildlauf</span></span>}
        {lyricsNote?.kind === 'low' && <span className={`kicker ${styles.note} ${styles.noteWarn}`}><Icon name="alert" size={16} />Timing unsicher · {Math.round(lyricsNote.confidence * 100)} %</span>}
      </div>
      <div className={styles.actions}>
        <div ref={translationRef} className={`${styles.menuAnchor} ${styles.desktopOnly}`}>
          <button type="button" className={`btn btn--pill ${styles.chipBtn}`} aria-expanded={menu === 'translation'} aria-controls={translationPanelId}
            onClick={() => setMenu(menu === 'translation' ? null : 'translation')}>
            <Icon name="lang" /> Übersetzung <Icon name="chevron" size={16} className={menu === 'translation' ? styles.flip : undefined} />
          </button>
          <div id={translationPanelId} className={styles.popover} hidden={menu !== 'translation'}>{translationPanel}</div>
        </div>
        {onToggleFavorite && (
          <HeartButton active={isFavorite || false} onClick={() => onToggleFavorite(track.id)} />
        )}
        <div ref={downloadRef} className={`${styles.menuAnchor} ${styles.desktopOnly}`}>
          <button type="button" className="iconbtn" onClick={() => setMenu(menu === 'download' ? null : 'download')} disabled={downloading}
            aria-expanded={menu === 'download'} aria-controls={downloadMenuId} aria-label="Herunterladen" title="Herunterladen">
            <Icon name="download" />
          </button>
          <div id={downloadMenuId} className={`${styles.popover} ${styles.menu}`} hidden={menu !== 'download'}>
            {DOWNLOADS.map(option => (
              <button key={option.type} type="button" className={styles.menuItem} onClick={() => handleDownload(option)}>
                <Icon name="download" size={16} /> {option.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className={`iconbtn ${styles.desktopOnly}`} onClick={handleShare} title="Link kopieren" aria-label="Link kopieren">
          <Icon name="share" />
        </button>
        <button type="button" className={`iconbtn ${styles.mobileOnly}`} aria-haspopup="dialog" aria-label="Weitere Optionen" onClick={() => setSheetOpen(true)}>
          <Icon name="more" />
        </button>
      </div>

      {sheetOpen && (
        <Modal title="Optionen" variant="sheet" size="small" onClose={() => setSheetOpen(false)}>
          <div className={styles.sheet}>
            <section>
              <h3 className="kicker">Übersetzung</h3>
              {translationPanel}
            </section>
            {onLyricScale && (
              <section>
                <h3 className="kicker">Textgröße</h3>
                <LyricScale value={lyricScale} onChange={onLyricScale} />
              </section>
            )}
            <section>
              <h3 className="kicker">Herunterladen</h3>
              <div className={styles.sheetList}>
                {DOWNLOADS.map(option => (
                  <button key={option.type} type="button" className="btn" disabled={downloading} onClick={() => handleDownload(option)}>
                    <Icon name="download" /> {option.label}
                  </button>
                ))}
              </div>
            </section>
            <button type="button" className="btn btn--block" onClick={handleShare}><Icon name="share" /> Link kopieren</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
