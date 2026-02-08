import { useState, useEffect, useCallback } from 'react'
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
  const [fetchingGenius, setFetchingGenius] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      const result = await admin.songDetails(trackId)
      if ('error' in result && typeof (result as Record<string, unknown>).error === 'string') {
        setError((result as Record<string, unknown>).error as string)
      } else {
        setData(result)
      }
    } catch {
      setError('Failed to load song details')
    }
    setLoading(false)
  }, [trackId])

  useEffect(() => { load() }, [load])

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const [showReprocessMenu, setShowReprocessMenu] = useState(false)

  const handleReprocess = async (fromStage?: string) => {
    setShowReprocessMenu(false)
    await admin.reprocessSong(trackId, fromStage)
    toast.success('Reprocessing started' + (fromStage && fromStage !== 'all' ? ` (from ${fromStage})` : ''))
  }

  const handleDelete = async () => {
    await admin.deleteSong(trackId)
    toast.success('Song deleted')
    navigate('/admin/songs')
  }

  const handleFetchGenius = async () => {
    setFetchingGenius(true)
    try {
      const result = await admin.fetchGeniusLyrics(trackId)
      if ('error' in result) {
        toast.error(String((result as Record<string, unknown>).error))
      } else {
        setData(prev => prev ? { ...prev, genius_lyrics: result } : prev)
        toast.success('Reference lyrics fetched')
      }
    } catch {
      toast.error('Failed to fetch reference lyrics')
    }
    setFetchingGenius(false)
  }

  if (loading) return (
    <>
      <Link to="/admin/songs" className={styles.backLink}>
        <FontAwesomeIcon icon={faArrowLeft} /> Back to Songs
      </Link>
      <div className={styles.loadingHeader}>
        <div className={`${styles.skeleton} ${styles.loadingArt}`} />
        <div className={styles.loadingInfo}>
          <div className={styles.skeleton} style={{ width: 250, height: 28 }} />
          <div className={styles.skeleton} style={{ width: 160, height: 18 }} />
          <div className={styles.skeleton} style={{ width: 300, height: 14 }} />
          <div className={styles.skeleton} style={{ width: 200, height: 14 }} />
        </div>
      </div>
      <div className={styles.stats}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.statCard}>
            <div className={styles.skeleton} style={{ width: 40, height: 32, margin: '0 auto 8px' }} />
            <div className={styles.skeleton} style={{ width: 60, height: 12, margin: '0 auto' }} />
          </div>
        ))}
      </div>
    </>
  )

  if (error) return (
    <>
      <Link to="/admin/songs" className={styles.backLink}>
        <FontAwesomeIcon icon={faArrowLeft} /> Back to Songs
      </Link>
      <div className={styles.errorState}>
        <h2>Track not found</h2>
        <p>{error}</p>
      </div>
    </>
  )

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
            <div className={styles.reprocessDropdown}>
              <button className={`${styles.actionBtn} ${showReprocessMenu ? styles.actionBtnOpen : ''}`} onClick={() => setShowReprocessMenu(prev => !prev)}>
                <FontAwesomeIcon icon={faRotateRight} /> Reprocess
                <FontAwesomeIcon icon={faChevronDown} className={`${styles.dropdownChevron} ${showReprocessMenu ? styles.dropdownChevronOpen : ''}`} />
              </button>
              {showReprocessMenu && (
                <>
                  <div className={styles.reprocessBackdrop} onClick={() => setShowReprocessMenu(false)} />
                  <div className={styles.reprocessMenu}>
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
        <table className={styles.table}>
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
        </table>
      </div>

      {/* Processed Lyrics */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <FontAwesomeIcon icon={faMusic} className={styles.sectionIcon} /> Lyrics
        </div>

        {/* Lyrics source indicator */}
        {data.lyrics && (
          <div className={`${styles.lyricsSourceBanner} ${
            data.lyrics.lyrics_source === 'genius' ? styles.lyricsSourceGenius : styles.lyricsSourceHeuristic
          }`}>
            <div className={styles.lyricsSourceHeader}>
              <FontAwesomeIcon icon={data.lyrics.lyrics_source === 'genius' ? faCheck : faExclamationTriangle} />
              <span className={styles.lyricsSourceLabel}>
                {data.lyrics.lyrics_source === 'genius' ? 'Lyrics corrected' : 'Heuristic fallback'}
              </span>
            </div>
            <span className={styles.lyricsSourceDetail}>
              {data.lyrics.lyrics_source === 'genius' && data.lyrics.genius_stats ? (
                <>Alignment quality: {((data.lyrics.genius_stats.quality ?? 0) * 100).toFixed(1)}% &middot; {data.lyrics.genius_stats.total_words} words matched</>
              ) : data.lyrics.genius_stats?.reason === 'not_found' ? (
                <>No lyrics found on Genius for this track</>
              ) : data.lyrics.genius_stats?.reason === 'fetch_error' ? (
                <>Genius fetch failed: {data.lyrics.genius_stats.error}</>
              ) : data.lyrics.genius_stats?.reason === 'low_quality' ? (
                <>Genius match too low ({((data.lyrics.genius_stats.quality ?? 0) * 100).toFixed(1)}%), fell back to timing-based splitting</>
              ) : data.lyrics.genius_stats?.reason === 'missing_metadata' ? (
                <>Missing title/artist metadata for Genius lookup</>
              ) : !data.lyrics.lyrics_source ? (
                <>Processed before correction tracking was added</>
              ) : (
                <>Lyrics split using timing gaps instead of Genius line breaks</>
              )}
            </span>
          </div>
        )}

        {data.lyrics ? (
          <div className={styles.collapsible}>
            <div className={styles.collapsibleHeader} onClick={() => toggle('lyrics')}>
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
            </div>
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
          <div className={styles.collapsibleHeader} onClick={() => toggle('genius')}>
            <span className={styles.collapsibleTitle}>
              <FontAwesomeIcon icon={faWandMagicSparkles} style={{ fontSize: '0.75rem' }} />
              Reference Lyrics
              {data.genius_lyrics && (
                <span className={styles.collapsibleBadge}>
                  {data.genius_lyrics.lines.length} lines
                </span>
              )}
            </span>
            <FontAwesomeIcon
              icon={faChevronDown}
              className={`${styles.chevron} ${expanded['genius'] ? styles.chevronOpen : ''}`}
            />
          </div>
          {expanded['genius'] && (
            <div className={styles.collapsibleBody}>
              {data.genius_lyrics ? (
                <div className={styles.geniusBlock}>
                  {data.genius_lyrics.lines.map((line, i) => (
                    <div key={i} className={styles.geniusLine}>
                      <span className={styles.geniusLineNum}>{i + 1}</span>
                      {line}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.geniusFetch}>
                  <p>No cached reference lyrics.</p>
                  <button className={styles.actionBtn} onClick={handleFetchGenius} disabled={fetchingGenius}>
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                    {fetchingGenius ? 'Fetching...' : 'Fetch from lrclib'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {data.lyrics_raw ? (
          <div className={styles.collapsible}>
            <div className={styles.collapsibleHeader} onClick={() => toggle('lyrics_raw')}>
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
            </div>
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
          <table className={styles.table}>
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
          </table>
        </div>
      )}

      {/* Error Log */}
      {data.errors.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <FontAwesomeIcon icon={faFileLines} className={styles.sectionIcon} /> Error Log
          </div>
          <table className={styles.table}>
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
                <>
                  <tr key={e.id} className={styles.errorRow} onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}>
                    <td><span className={`${styles.tag} ${styles.tagDanger}`}>{e.error_type}</span></td>
                    <td>{e.source}</td>
                    <td style={{ maxWidth: 400, wordBreak: 'break-word' }}>{e.error_message}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.created_at)}</td>
                  </tr>
                  {expandedError === e.id && e.stack_trace && (
                    <tr key={`${e.id}-stack`}>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <div className={styles.stackTrace}>{e.stack_trace}</div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent Plays */}
      {data.usage.recent_plays.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <FontAwesomeIcon icon={faPlay} className={styles.sectionIcon} /> Recent Plays
          </div>
          <table className={styles.table}>
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
          </table>
        </div>
      )}
    </>
  )
}
