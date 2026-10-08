import { errorMessage } from './account/errors'
import { useState, useEffect, useCallback, useRef, Fragment, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { admin } from '../services/api'
import { useToast } from '../hooks/useToast'
import type { SongDetail } from '../types'
import { Cover } from '../components/common/Cover'
import { Icon } from '../components/common/Icon'
import type { IconName } from '../components/common/icons'
import { PageState } from '../components/common/PageState'
import { formatBytes, formatDateTime, formatDuration, formatInt, formatPercent } from '../utils/format'
import { de } from '../utils/messages'
import { hiResCover } from './library/trackPresentation'
import { ConfirmAction, type Confirmation } from './admin/AdminAction'
import styles from './SongDetailView.module.css'

interface SongDetailViewProps {
  trackId: string
}

const FILE_LABELS: Record<string, { name: string; type: string }> = {
  metadata: { name: 'metadata.json', type: 'Metadaten' },
  song: { name: 'song.mp3', type: 'Original' },
  vocals: { name: 'vocals.mp3', type: 'Gesang' },
  no_vocals: { name: 'no_vocals.mp3', type: 'Instrumental' },
  lyrics: { name: 'lyrics.json', type: 'Zeilen' },
  lyrics_raw: { name: 'lyrics_raw.json', type: 'Transkript' },
}

const REPROCESS: { stage: string; label: string; hint: string; icon: IconName }[] = [
  { stage: 'all', label: 'Alles', hint: 'Von vorn, ab dem Download', icon: 'redo' },
  { stage: 'splitting', label: 'Nur Stimmtrennung', hint: 'Gesang und Instrumental neu trennen', icon: 'music' },
  { stage: 'lyrics', label: 'Nur Transkription', hint: 'Wörter und Zeitstempel neu erkennen', icon: 'doc' },
  { stage: 'processing', label: 'Nur Zeilen', hint: 'Zeilen neu bauen lassen', icon: 'sparkles' },
]
const STAGE_TEXT: Record<string, string> = { all: 'ganz von vorn', splitting: 'ab der Stimmtrennung', lyrics: 'ab der Transkription', processing: 'ab dem Zeilenbau' }

function formatTime(ts: number) {
  const m = Math.floor(ts / 60)
  const s = (ts % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

function sourceNote(lyrics: NonNullable<SongDetail['lyrics']>) {
  const stats = lyrics.correction_stats
  if (lyrics.lyrics_source === 'reference' && stats) return `Abgleich mit Referenztext: ${formatPercent(stats.quality ?? 0, 1)} · ${formatInt(stats.total_words ?? 0)} Wörter zugeordnet`
  switch (stats?.reason) {
    case 'not_found': return 'Kein Referenztext für diesen Song gefunden.'
    case 'fetch_error': return `Referenztext konnte nicht geladen werden: ${stats.error ?? ''}`
    case 'low_quality': return `Abgleich zu schwach (${formatPercent(stats.quality ?? 0, 1)}), Zeilen nach Pausen getrennt.`
    case 'missing_metadata': return 'Titel oder Interpret fehlen für die Textsuche.'
  }
  if (lyrics.lyrics_source === 'reference') return 'Zeilen nach dem Referenztext gesetzt.'
  if (!lyrics.lyrics_source) return 'Verarbeitet, bevor die Korrektur protokolliert wurde.'
  return 'Zeilen nach Pausen im Gesang getrennt statt nach Referenztext.'
}

export function SongDetailView({ trackId }: SongDetailViewProps) {
  const [data, setData] = useState<SongDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [expandedError, setExpandedError] = useState<number | null>(null)
  const [fetchingRef, setFetchingRef] = useState(false)
  const [fetchingRefAI, setFetchingRefAI] = useState(false)
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])
  const toast = useToast()

  const load = useCallback(async () => {
    const current = ++requestId.current
    setError(null)
    try {
      const result = await admin.songDetails(trackId)
      if (current !== requestId.current) return
      if ('error' in result && typeof (result as Record<string, unknown>).error === 'string') {
        setError(de((result as Record<string, unknown>).error as string))
      } else {
        setData(result)
      }
    } catch (e) {
      if (current === requestId.current) setError(errorMessage(e))
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [trackId])

  useEffect(() => { void load(); return cancelRequest }, [load, cancelRequest])

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const [showReprocessMenu, setShowReprocessMenu] = useState(false)

  const handleReprocess = (fromStage = 'all') => {
    setShowReprocessMenu(false)
    setConfirmation({
      title: 'Song neu verarbeiten?',
      description: `Die Verarbeitung startet ${STAGE_TEXT[fromStage] ?? `ab „${fromStage}“`}. Erzeugte Dateien werden ersetzt, und es können kostenpflichtige Dienste laufen.`,
      label: 'Neu verarbeiten', tone: 'neutral', action: () => admin.reprocessSong(trackId, fromStage), success: 'Verarbeitung gestartet.',
    })
  }

  const handleDelete = () => setConfirmation({
    title: 'Song löschen?', description: 'Der Song und alle erzeugten Audiodateien und Texte verschwinden für alle. Das lässt sich nicht rückgängig machen.',
    label: 'Song löschen', action: async () => { await admin.deleteSong(trackId); navigate('/admin/songs') }, success: 'Song gelöscht.',
  })

  const handleFetchRef = async () => {
    setFetchingRef(true)
    try {
      const result = await admin.fetchReferenceLyrics(trackId)
      if ('error' in result) {
        toast.error(de(String((result as Record<string, unknown>).error)))
      } else {
        setData(prev => prev ? { ...prev, reference_lyrics: result } : prev)
        toast.success('Referenztext geladen.')
      }
    } catch {
      toast.error('Der Referenztext konnte nicht geladen werden.')
    }
    setFetchingRef(false)
  }

  const handleFetchRefAI = async () => {
    setFetchingRefAI(true)
    try {
      const result = await admin.fetchReferenceLyricsAI(trackId)
      if ('error' in result) {
        toast.error(de(String((result as Record<string, unknown>).error)))
      } else {
        setData(prev => prev ? { ...prev, reference_lyrics: result } : prev)
        toast.success('Referenztext per KI erzeugt.')
      }
    } catch {
      toast.error('Die KI konnte keinen Referenztext erzeugen.')
    }
    setFetchingRefAI(false)
  }

  const back = <Link to="/admin/songs" className={styles.backLink}><Icon name="chevron-left" size={18} /> Alle Songs</Link>

  if (loading) return <PageState title="Song wird geladen …" loading />
  if (error) return <>
    {back}
    <PageState error title="Die Song-Details konnten nicht geladen werden." description={error} action={<button type="button" className="btn" onClick={load}><Icon name="redo" /> Erneut versuchen</button>} />
  </>

  if (!data) return null

  const meta = data.metadata
  const fileEntries = Object.entries(data.files)
  const totalSize = fileEntries.reduce((a, [, f]) => a + f.size, 0)
  const present = fileEntries.filter(([, f]) => f.exists).length
  const confidence = data.lyrics?.avg_confidence
  const timedLines = data.lyrics?.segments.length ?? 0
  const words = data.lyrics?.segments.reduce((a, s) => a + s.words.length, 0) ?? 0
  const confidenceTone = confidence == null ? '' : confidence < 0.6 ? 'warn' : ''
  const refBusy = fetchingRef || fetchingRefAI
  const refActions = <div className={styles.refActions}>
    <button type="button" className="btn btn--sm" onClick={handleFetchRef} disabled={refBusy} aria-busy={fetchingRef}><Icon name="globe" size={16} /> {fetchingRef ? 'Wird geladen …' : data.reference_lyrics ? 'Neu von lrclib laden' : 'Von lrclib laden'}</button>
    <button type="button" className="btn btn--sm" onClick={handleFetchRefAI} disabled={refBusy} aria-busy={fetchingRefAI}><Icon name="sparkles" size={16} /> {fetchingRefAI ? 'Wird erzeugt …' : 'Per KI erzeugen'}</button>
  </div>

  return (
    <>
      {back}

      {/* Head */}
      <header className={styles.head}>
        <Cover className={styles.cover} src={hiResCover(meta.img_url)} />
        <div className={styles.headInfo}>
          <span className="kicker">Backstage · Song <span className={styles.mono}>#{data.id}</span></span>
          <h1 className={styles.title}>{meta.title}</h1>
          <div className={styles.artist}>{meta.artist}{meta.album ? <span className={styles.album}> · {meta.album}</span> : null}{meta.duration > 0 ? <span className={styles.album}> · {formatDuration(meta.duration)}</span> : null}</div>
          <div className={styles.chips}>
            <span className={`chip ${data.complete ? 'chip--ok' : 'chip--err'}`}>{data.complete ? 'Fertig' : 'Unvollständig'}</span>
            {data.lyrics?.untimed && <span className="chip chip--warn">Ohne Timing</span>}
            {confidence != null && confidence < 0.6 && <span className="chip chip--warn">Konfidenz niedrig</span>}
            {data.processing_failures.length > 0 && <span className="chip chip--err">{formatInt(data.processing_failures.length)} Fehlversuche</span>}
          </div>
        </div>
        <div className={styles.actions}>
          {data.complete && (
            <button type="button" className="btn btn--primary" onClick={() => navigate('/song/' + trackId)}>
              <Icon name="play" /> Abspielen
            </button>
          )}
          <div className={styles.reprocessDropdown} onKeyDown={e => { if (e.key === 'Escape') { setShowReprocessMenu(false); e.stopPropagation() } }}>
            <button type="button" className="btn" aria-expanded={showReprocessMenu} aria-controls="song-reprocess-options" onClick={() => setShowReprocessMenu(prev => !prev)}>
              <Icon name="redo" /> Neu verarbeiten
              <Icon name="chevron" size={16} className={`${styles.dropdownChevron} ${showReprocessMenu ? styles.dropdownChevronOpen : ''}`} />
            </button>
            {showReprocessMenu && (
              <>
                <div className={styles.reprocessBackdrop} onClick={() => setShowReprocessMenu(false)} />
                <div id="song-reprocess-options" className={styles.reprocessMenu}>
                  <div className={styles.reprocessMenuHeader}>Neu verarbeiten ab …</div>
                  {REPROCESS.map(option => <button type="button" key={option.stage} onClick={() => handleReprocess(option.stage)}>
                    <Icon name={option.icon} size={18} className={styles.reprocessMenuIcon} />
                    <span><b>{option.label}</b><small>{option.hint}</small></span>
                  </button>)}
                </div>
              </>
            )}
          </div>
          <button type="button" className="btn btn--danger" onClick={handleDelete}>
            <Icon name="trash" /> Löschen
          </button>
        </div>
      </header>

      {/* Stat strip */}
      <div className={`stats ${styles.stats}`}>
        <div className={`stat ${confidenceTone ? 'stat--warn' : ''}`}><b>{confidence == null ? '–' : formatPercent(confidence, 1)}</b><span className="kicker">Konfidenz</span></div>
        <div className="stat"><b>{formatInt(timedLines)}</b><span className="kicker">Zeilen getimt</span></div>
        <div className={`stat ${present < fileEntries.length ? 'stat--err' : ''}`}><b>{present}/{fileEntries.length}</b><span className="kicker">Dateien</span></div>
        <div className="stat"><b>{formatBytes(totalSize)}</b><span className="kicker">Größe</span></div>
        <div className="stat"><b>{formatInt(data.usage.play_count)}</b><span className="kicker">Gesungen</span></div>
      </div>

      <div className={styles.columns}>
        {/* Files */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Dateien</h2>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th scope="col">Datei</th><th scope="col">Typ</th><th scope="col" className="num">Größe</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {fileEntries.map(([key, info]) => (
                  <tr key={key}>
                    <td className={`cell-main ${styles.mono}`}>{FILE_LABELS[key]?.name ?? key}</td>
                    <td data-label="Typ" className="cell-inline">{FILE_LABELS[key]?.type ?? '–'}</td>
                    <td data-label="Größe" className="num cell-inline">{info.exists ? formatBytes(info.size) : '–'}</td>
                    <td className="cell-acts">
                      <span className={info.exists ? styles.fileOk : styles.fileMissing}><span aria-hidden="true">{info.exists ? '●' : '○'}</span> {info.exists ? 'Vorhanden' : 'Fehlt'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Lyrics status: timing source and confidence, never the text itself */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Lyrics-Status</h2>
          {data.lyrics ? <div className={`panel ${styles.lyricsCard}`}>
            <div className={styles.lyricsHead}>
              <span className={`chip ${data.lyrics.lyrics_source === 'reference' ? 'chip--ok' : 'chip--warn'}`}>
                {data.lyrics.lyrics_source === 'reference' ? 'Mit Referenztext korrigiert' : 'Nach Pausen getrennt'}
              </span>
              <span className={styles.mono}>{formatInt(timedLines)} Zeilen · {formatInt(words)} Wörter</span>
            </div>
            <p className={styles.lyricsNote}>{sourceNote(data.lyrics)}</p>
            {confidence != null && <div className={styles.confidence}>
              <div className={styles.confidenceRow}><span className="kicker">Konfidenz</span><span className={styles.mono}>{formatPercent(confidence, 1)}</span></div>
              <span className={`meter ${confidence < 0.6 ? 'meter--warn' : 'meter--inst'}`} aria-hidden="true"><i style={{ '--v': `${Math.round(confidence * 100)}%` } as CSSProperties} /></span>
            </div>}
          </div> : <p className={styles.empty}>Noch keine verarbeiteten Lyrics.</p>}
        </section>
      </div>

      {/* Lyrics tools for admins (collapsed by default) */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Text prüfen</h2>
        {data.lyrics && (
          <div className={styles.collapsible}>
            <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['lyrics']} onClick={() => toggle('lyrics')}>
              <span className={styles.collapsibleTitle}>Verarbeitete Zeilen <span className={styles.collapsibleBadge}>{formatInt(timedLines)} Zeilen · {formatInt(words)} Wörter</span></span>
              <Icon name="chevron" size={18} className={`${styles.chevron} ${expanded['lyrics'] ? styles.chevronOpen : ''}`} />
            </button>
            {expanded['lyrics'] && (
              <div className={styles.collapsibleBody}>
                <div className={styles.lyricsBlock}>
                  {data.lyrics.segments.map((seg, i) => (
                    <div key={i} className={styles.segmentLine}>
                      <span className={styles.segmentTime}>{formatTime(seg.start)}</span>
                      <span className={styles.segmentSpeaker}>{seg.speaker}</span>
                      <span className={styles.segmentText}>
                        {seg.words.map((w, wi) => {
                          const isLow = w.score != null && w.score < 0.5
                          const isMed = w.score != null && w.score >= 0.5 && w.score < 0.7
                          return (
                            <span key={wi} className={isLow ? styles.wordLow : isMed ? styles.wordMed : undefined} title={w.score != null ? `${(w.score * 100).toFixed(0)} %` : undefined}>
                              {wi > 0 ? ' ' : ''}{w.word}
                            </span>
                          )
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={styles.collapsible}>
          <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['reference']} onClick={() => toggle('reference')}>
            <span className={styles.collapsibleTitle}>Referenztext {data.reference_lyrics && <span className={styles.collapsibleBadge}>{formatInt(data.reference_lyrics.lines.length)} Zeilen</span>}</span>
            <Icon name="chevron" size={18} className={`${styles.chevron} ${expanded['reference'] ? styles.chevronOpen : ''}`} />
          </button>
          {expanded['reference'] && (
            <div className={styles.collapsibleBody}>
              {data.reference_lyrics ? (
                <div className={styles.refBlock}>
                  {data.reference_lyrics.lines.map((line, i) => (
                    <div key={i} className={styles.refLine}><span className={styles.refLineNum}>{i + 1}</span>{line}</div>
                  ))}
                  {refActions}
                </div>
              ) : (
                <div className={styles.refEmpty}><p>Kein Referenztext gespeichert.</p>{refActions}</div>
              )}
            </div>
          )}
        </div>

        {data.lyrics_raw ? (
          <div className={styles.collapsible}>
            <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['lyrics_raw']} onClick={() => toggle('lyrics_raw')}>
              <span className={styles.collapsibleTitle}>Rohtranskript (WhisperX) <span className={styles.collapsibleBadge}>{formatInt(data.lyrics_raw.segments.length)} Abschnitte</span></span>
              <Icon name="chevron" size={18} className={`${styles.chevron} ${expanded['lyrics_raw'] ? styles.chevronOpen : ''}`} />
            </button>
            {expanded['lyrics_raw'] && (
              <div className={styles.collapsibleBody}>
                <div className={styles.lyricsBlock}>
                  {data.lyrics_raw.segments.map((seg, i) => (
                    <div key={i} className={styles.segmentLine}>
                      <span className={styles.segmentTime}>{formatTime(seg.start)}</span>
                      <span className={styles.segmentText}>{seg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.empty}>Kein Rohtranskript vorhanden.</p>
        )}
      </section>

      {/* Processing Failures */}
      {data.processing_failures.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Fehlversuche</h2>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th scope="col">Meldung</th><th scope="col">Schritt</th><th scope="col" className="num">Versuche</th><th scope="col">Zuletzt</th></tr></thead>
              <tbody>
                {data.processing_failures.map(f => (
                  <tr key={f.id}>
                    <td className={`cell-main ${styles.errorText}`}>{f.error_message}</td>
                    <td data-label="Schritt" className="cell-inline"><span className="chip chip--err">{f.stage}</span></td>
                    <td data-label="Versuche" className="num cell-inline">{formatInt(f.failure_count)}</td>
                    <td data-label="Zuletzt" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(f.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Error Log */}
      {data.errors.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Fehlerprotokoll</h2>
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th scope="col">Meldung</th><th scope="col">Bereich</th><th scope="col">Zeit</th></tr></thead>
              <tbody>
                {data.errors.map(e => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className={`cell-main ${styles.errorText}`}>{e.stack_trace ? <button type="button" className={styles.detailButton} aria-expanded={expandedError === e.id} onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}>{e.error_message}</button> : e.error_message}</td>
                      <td data-label="Bereich" className="cell-inline"><span className="chip chip--err">{e.error_type}</span> <span className={styles.subtle}>{e.source}</span></td>
                      <td data-label="Zeit" className={`cell-inline ${styles.mono} ${styles.nowrap}`}>{formatDateTime(e.created_at)}</td>
                    </tr>
                    {expandedError === e.id && e.stack_trace && (
                      <tr className={styles.detailRow}>
                        <td colSpan={3}><pre className={styles.stackTrace}>{e.stack_trace}</pre></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Usage */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Nutzung</h2>
        <div className={styles.chips}>
          <span className="chip">{formatInt(data.usage.download_count)} Downloads</span>
          <span className="chip">{formatInt(data.favorites_count)} Favoriten</span>
          <span className="chip">{formatInt(data.playlist_count)} Playlists</span>
        </div>
        {data.usage.recent_plays.length > 0 ? (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th scope="col">Nutzer</th><th scope="col">Gesungen am</th></tr></thead>
              <tbody>
                {data.usage.recent_plays.map((p, i) => (
                  <tr key={i}>
                    <td className="cell-main">{p.username}</td>
                    <td className={`cell-acts ${styles.mono} ${styles.nowrap}`}>{formatDateTime(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>Noch nicht gesungen.</p>}
      </section>
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} />}
    </>
  )
}
