import { errorMessage } from './account/errors'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft, faPlay, faDownload, faHeart, faListOl,
  faCheck, faTimes, faRotateRight, faTrash, faFileAudio,
  faFileLines, faChevronDown, faExclamationTriangle, faMusic,
  faWandMagicSparkles
} from '@fortawesome/free-solid-svg-icons'
import { admin } from '../services/api'
import { useToast } from '../hooks/useToast'
import type { SongDetail } from '../types'
import { PageState } from '../components/common/PageState'
import { ConfirmAction, type Confirmation } from './admin/AdminAction'
import styles from './SongDetailView.module.css'

interface SongDetailViewProps {
  trackId: string
}

const FILE_LABELS: Record<string, string> = {
  metadata: 'metadata.json',
  song: 'song.mp3',
  vocals: 'vocals.mp3',
  no_vocals: 'no_vocals.mp3',
  lyrics: 'lyrics.json',
  lyrics_raw: 'lyrics_raw.json',
}

function formatSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTime(ts: number) {
  const m = Math.floor(ts / 60)
  const s = (ts % 60).toFixed(1)
  return `${m}:${s.padStart(4, '0')}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
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
        setError((result as Record<string, unknown>).error as string)
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
      title: 'Reprocess this song?',
      description: `Processing will restart from ${fromStage === 'all' ? 'the beginning' : fromStage}. This replaces generated files and may use paid processing services.`,
      label: 'Start reprocessing', action: () => admin.reprocessSong(trackId, fromStage), success: 'Reprocessing started',
    })
  }

  const handleDelete = () => setConfirmation({
    title: 'Delete this song?', description: 'The song and all generated audio and lyrics will be permanently removed for everyone.',
    label: 'Delete song', action: async () => { await admin.deleteSong(trackId); navigate('/admin/songs') }, success: 'Song deleted',
  })

  const handleFetchRef = async () => {
    setFetchingRef(true)
    try {
      const result = await admin.fetchReferenceLyrics(trackId)
      if ('error' in result) {
        toast.error(String((result as Record<string, unknown>).error))
      } else {
        setData(prev => prev ? { ...prev, reference_lyrics: result } : prev)
        toast.success('Reference lyrics fetched')
      }
    } catch {
      toast.error('Failed to fetch reference lyrics')
    }
    setFetchingRef(false)
  }

  const handleFetchRefAI = async () => {
    setFetchingRefAI(true)
    try {
      const result = await admin.fetchReferenceLyricsAI(trackId)
      if ('error' in result) {
        toast.error(String((result as Record<string, unknown>).error))
      } else {
        setData(prev => prev ? { ...prev, reference_lyrics: result } : prev)
        toast.success('AI reference lyrics generated')
      }
    } catch {
      toast.error('Failed to generate AI reference lyrics')
    }
    setFetchingRefAI(false)
  }

  if (loading) return <PageState title="Loading song details" loading />
  if (error) return <>
    <Link to="/admin/songs" className={styles.backLink}><FontAwesomeIcon icon={faArrowLeft} /> Back to songs</Link>
    <PageState title="Could not load song details" description={error} action={<button className={styles.actionBtn} onClick={load}>Try again</button>} />
  </>

  if (!data) return null

  const meta = data.metadata
  const totalSize = Object.values(data.files).reduce((a, f) => a + f.size, 0)

  return (
    <>
      <Link to="/admin/songs" className={styles.backLink}>
        <FontAwesomeIcon icon={faArrowLeft} /> Back to Songs
      </Link>

      {/* Header */}
      <div className={styles.detailHeader}>
        <img
          className={styles.albumArt}
          src={meta.img_url?.replace('/56x56', '/500x500') || '/logo.svg'}
          alt=""
        />
        <div className={styles.headerInfo}>
          <h1 className={styles.detailTitle}>{meta.title}</h1>
          <div className={styles.detailArtist}>{meta.artist}</div>
          <div className={styles.detailMeta}>
            <span className={`${styles.tag} ${data.complete ? styles.tagSuccess : styles.tagWarning}`}>
              {data.complete ? 'Complete' : 'Incomplete'}
            </span>
            {meta.album && (
              <span className={styles.metaItem}>
                <strong>Album:</strong> {meta.album}
              </span>
            )}
            {meta.duration > 0 && (
              <span className={styles.metaItem}>
                <strong>Duration:</strong> {formatDuration(meta.duration)}
              </span>
            )}
            <span className={styles.metaItem}>
              <strong>ID:</strong> {data.id}
            </span>
            <span className={styles.metaItem}>
              <strong>Total Size:</strong> {formatSize(totalSize)}
            </span>
          </div>
          <div className={styles.detailActions}>
            {data.complete && (
              <button className={`${styles.actionBtn} ${styles.playBtn}`} onClick={() => navigate('/song/' + trackId)}>
                <FontAwesomeIcon icon={faPlay} /> Play Song
              </button>
            )}
            <div className={styles.reprocessDropdown} onKeyDown={e => { if (e.key === 'Escape') { setShowReprocessMenu(false); e.stopPropagation() } }}>
              <button className={`${styles.actionBtn} ${showReprocessMenu ? styles.actionBtnOpen : ''}`} aria-expanded={showReprocessMenu} aria-controls="song-reprocess-options" onClick={() => setShowReprocessMenu(prev => !prev)}>
                <FontAwesomeIcon icon={faRotateRight} /> Reprocess
                <FontAwesomeIcon icon={faChevronDown} className={`${styles.dropdownChevron} ${showReprocessMenu ? styles.dropdownChevronOpen : ''}`} />
              </button>
              {showReprocessMenu && (
                <>
                  <div className={styles.reprocessBackdrop} onClick={() => setShowReprocessMenu(false)} />
                  <div id="song-reprocess-options" className={styles.reprocessMenu}>
                    <div className={styles.reprocessMenuHeader}>Reprocess from stage</div>
                    <button onClick={() => handleReprocess('all')}>
                      <FontAwesomeIcon icon={faRotateRight} className={styles.reprocessMenuIcon} /> Reprocess All
                    </button>
                    <button onClick={() => handleReprocess('splitting')}>
                      <FontAwesomeIcon icon={faMusic} className={styles.reprocessMenuIcon} /> Redo Vocal Split
                    </button>
                    <button onClick={() => handleReprocess('lyrics')}>
                      <FontAwesomeIcon icon={faFileLines} className={styles.reprocessMenuIcon} /> Redo Lyrics Extraction
                    </button>
                    <button onClick={() => handleReprocess('processing')}>
                      <FontAwesomeIcon icon={faWandMagicSparkles} className={styles.reprocessMenuIcon} /> Redo Lyrics Processing
                    </button>
                  </div>
                </>
              )}
            </div>
            <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={handleDelete}>
              <FontAwesomeIcon icon={faTrash} /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Usage Stats */}
      <div className={styles.stats}>
        <div className={`${styles.statCard} ${styles.statCardPlays}`}>
          <div className={styles.statIcon}><FontAwesomeIcon icon={faPlay} /></div>
          <div className={styles.statValue}>{data.usage.play_count}</div>
          <div className={styles.statLabel}>Plays</div>
        </div>
        <div className={`${styles.statCard} ${styles.statCardDownloads}`}>
          <div className={styles.statIcon}><FontAwesomeIcon icon={faDownload} /></div>
          <div className={styles.statValue}>{data.usage.download_count}</div>
          <div className={styles.statLabel}>Downloads</div>
        </div>
        <div className={`${styles.statCard} ${styles.statCardFavorites}`}>
          <div className={styles.statIcon}><FontAwesomeIcon icon={faHeart} /></div>
          <div className={styles.statValue}>{data.favorites_count}</div>
          <div className={styles.statLabel}>Favorites</div>
        </div>
        <div className={`${styles.statCard} ${styles.statCardPlaylists}`}>
          <div className={styles.statIcon}><FontAwesomeIcon icon={faListOl} /></div>
          <div className={styles.statValue}>{data.playlist_count}</div>
          <div className={styles.statLabel}>Playlists</div>
        </div>
      </div>

      {/* Files */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <FontAwesomeIcon icon={faFileAudio} className={styles.sectionIcon} /> Files
        </div>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Song details table"><table className={styles.table}>
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.files).map(([key, info]) => (
              <tr key={key}>
                <td className={styles.mono}>{FILE_LABELS[key] || key}</td>
                <td>
                  {info.exists ? (
                    <span className={styles.statusOk}><FontAwesomeIcon icon={faCheck} /> Present</span>
                  ) : (
                    <span className={styles.statusMissing}><FontAwesomeIcon icon={faTimes} /> Missing</span>
                  )}
                </td>
                <td>{info.exists ? formatSize(info.size) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* Processed Lyrics */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <FontAwesomeIcon icon={faMusic} className={styles.sectionIcon} /> Lyrics
        </div>

        {/* Lyrics source indicator */}
        {data.lyrics && (
          <div className={`${styles.lyricsSourceBanner} ${
            data.lyrics.lyrics_source === 'reference' ? styles.lyricsSourceReference : styles.lyricsSourceHeuristic
          }`}>
            <div className={styles.lyricsSourceHeader}>
              <FontAwesomeIcon icon={data.lyrics.lyrics_source === 'reference' ? faCheck : faExclamationTriangle} />
              <span className={styles.lyricsSourceLabel}>
                {data.lyrics.lyrics_source === 'reference' ? 'Lyrics corrected' : 'Heuristic fallback'}
              </span>
            </div>
            <span className={styles.lyricsSourceDetail}>
              {data.lyrics.lyrics_source === 'reference' && data.lyrics.correction_stats ? (
                <>Alignment quality: {((data.lyrics.correction_stats.quality ?? 0) * 100).toFixed(1)}% &middot; {data.lyrics.correction_stats.total_words} words matched</>
              ) : data.lyrics.correction_stats?.reason === 'not_found' ? (
                <>No lyrics found for this track</>
              ) : data.lyrics.correction_stats?.reason === 'fetch_error' ? (
                <>Lyrics fetch failed: {data.lyrics.correction_stats.error}</>
              ) : data.lyrics.correction_stats?.reason === 'low_quality' ? (
                <>Match quality too low ({((data.lyrics.correction_stats.quality ?? 0) * 100).toFixed(1)}%), fell back to timing-based splitting</>
              ) : data.lyrics.correction_stats?.reason === 'missing_metadata' ? (
                <>Missing title/artist metadata for lyrics lookup</>
              ) : !data.lyrics.lyrics_source ? (
                <>Processed before correction tracking was added</>
              ) : (
                <>Lyrics split using timing gaps instead of reference line breaks</>
              )}
            </span>
          </div>
        )}

        {data.lyrics ? (
          <div className={styles.collapsible}>
            <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['lyrics']} onClick={() => toggle('lyrics')}>
              <span className={styles.collapsibleTitle}>
                Processed Lyrics
                <span className={styles.collapsibleBadge}>
                  {data.lyrics.segments.length} segments, {data.lyrics.segments.reduce((a, s) => a + s.words.length, 0)} words
                </span>
                {data.lyrics.avg_confidence != null && (
                  <span className={styles.confidenceBadge} style={{
                    color: data.lyrics.avg_confidence < 0.55 ? 'var(--danger)' : data.lyrics.avg_confidence < 0.65 ? 'var(--warning)' : 'var(--success)',
                    borderColor: data.lyrics.avg_confidence < 0.55 ? 'var(--danger)' : data.lyrics.avg_confidence < 0.65 ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {(data.lyrics.avg_confidence * 100).toFixed(1)}% confidence
                  </span>
                )}
              </span>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`${styles.chevron} ${expanded['lyrics'] ? styles.chevronOpen : ''}`}
              />
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
                            <span
                              key={wi}
                              className={isLow ? styles.wordLow : isMed ? styles.wordMed : undefined}
                              title={w.score != null ? `${(w.score * 100).toFixed(0)}%` : undefined}
                            >
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
        ) : (
          <div className={styles.empty}>No processed lyrics available</div>
        )}

        {/* Reference Lyrics */}
        <div className={styles.collapsible}>
          <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['reference']} onClick={() => toggle('reference')}>
            <span className={styles.collapsibleTitle}>
              <FontAwesomeIcon icon={faWandMagicSparkles} style={{ fontSize: '0.75rem' }} />
              Reference Lyrics
              {data.reference_lyrics && (
                <span className={styles.collapsibleBadge}>
                  {data.reference_lyrics.lines.length} lines
                </span>
              )}
            </span>
            <FontAwesomeIcon
              icon={faChevronDown}
              className={`${styles.chevron} ${expanded['reference'] ? styles.chevronOpen : ''}`}
            />
          </button>
          {expanded['reference'] && (
            <div className={styles.collapsibleBody}>
              {data.reference_lyrics ? (
                <div className={styles.refBlock}>
                  {data.reference_lyrics.lines.map((line, i) => (
                    <div key={i} className={styles.refLine}>
                      <span className={styles.refLineNum}>{i + 1}</span>
                      {line}
                    </div>
                  ))}
                  <div className={styles.refFetch} style={{ marginTop: 12 }}>
                    <button className={styles.actionBtn} onClick={handleFetchRef} disabled={fetchingRef || fetchingRefAI}>
                      <FontAwesomeIcon icon={faWandMagicSparkles} />
                      {fetchingRef ? 'Fetching...' : 'Re-fetch lrclib'}
                    </button>
                    <button className={styles.actionBtn} onClick={handleFetchRefAI} disabled={fetchingRef || fetchingRefAI}>
                      <FontAwesomeIcon icon={faWandMagicSparkles} />
                      {fetchingRefAI ? 'Generating...' : 'Generate with AI'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.refFetch}>
                  <p>No cached reference lyrics.</p>
                  <button className={styles.actionBtn} onClick={handleFetchRef} disabled={fetchingRef || fetchingRefAI}>
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                    {fetchingRef ? 'Fetching...' : 'Fetch from lrclib'}
                  </button>
                  <button className={styles.actionBtn} onClick={handleFetchRefAI} disabled={fetchingRef || fetchingRefAI}>
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                    {fetchingRefAI ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {data.lyrics_raw ? (
          <div className={styles.collapsible}>
            <button type="button" className={styles.collapsibleHeader} aria-expanded={!!expanded['lyrics_raw']} onClick={() => toggle('lyrics_raw')}>
              <span className={styles.collapsibleTitle}>
                Raw Lyrics (WhisperX)
                <span className={styles.collapsibleBadge}>
                  {data.lyrics_raw.segments.length} segments
                </span>
              </span>
              <FontAwesomeIcon
                icon={faChevronDown}
                className={`${styles.chevron} ${expanded['lyrics_raw'] ? styles.chevronOpen : ''}`}
              />
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
          <div className={styles.empty}>No raw lyrics available</div>
        )}
      </div>

      {/* Processing Failures */}
      {data.processing_failures.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <FontAwesomeIcon icon={faExclamationTriangle} className={styles.sectionIcon} /> Processing Failures
          </div>
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Song details table"><table className={styles.table}>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Error</th>
                <th>Failures</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.processing_failures.map(f => (
                <tr key={f.id}>
                  <td><span className={`${styles.tag} ${styles.tagDanger}`}>{f.stage}</span></td>
                  <td style={{ maxWidth: 400, wordBreak: 'break-word' }}>{f.error_message}</td>
                  <td>{f.failure_count}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(f.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Error Log */}
      {data.errors.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <FontAwesomeIcon icon={faFileLines} className={styles.sectionIcon} /> Error Log
          </div>
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Song details table"><table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Source</th>
                <th>Message</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.errors.map(e => (
                <Fragment key={e.id}>
                  <tr className={styles.errorRow}>
                    <td><span className={`${styles.tag} ${styles.tagDanger}`}>{e.error_type}</span></td>
                    <td>{e.source}</td>
                    <td style={{ maxWidth: 400, wordBreak: 'break-word' }}>{e.stack_trace ? <button className={styles.detailButton} aria-expanded={expandedError === e.id} onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}>{e.error_message}</button> : e.error_message}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.created_at)}</td>
                  </tr>
                  {expandedError === e.id && e.stack_trace && (
                    <tr key={`${e.id}-stack`}>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <div className={styles.stackTrace}>{e.stack_trace}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {/* Recent Plays */}
      {data.usage.recent_plays.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <FontAwesomeIcon icon={faPlay} className={styles.sectionIcon} /> Recent Plays
          </div>
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Song details table"><table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.usage.recent_plays.map((p, i) => (
                <tr key={i}>
                  <td>{p.username}</td>
                  <td>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} />}
    </>
  )
}
