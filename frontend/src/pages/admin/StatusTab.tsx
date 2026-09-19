import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHardDrive, faDatabase, faMusic, faTrash, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { useToast } from '../../hooks/useToast'
import { admin } from '../../services/api'
import type { HealthCheck, StorageStats, UnfinishedTrack, ProcessingStatus, DeezerConfigStatus } from '../../types'
import { PageState } from '../../components/common/PageState'
import { ConfirmAction, type Confirmation } from './AdminAction'
import styles from '../AdminPage.module.css'

const PAGE_SIZE = 20

// ─── Status Tab ───
export function StatusTab() {
  const [checks, setChecks] = useState<Record<string, HealthCheck>>({})
  const [queue, setQueue] = useState<Record<string, ProcessingStatus>>({})
  const [unfinished, setUnfinished] = useState<UnfinishedTrack[]>([])
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [deezerConfig, setDeezerConfig] = useState<DeezerConfigStatus | null>(null)
  const [deezerArl, setDeezerArl] = useState('')
  const [deezerSaving, setDeezerSaving] = useState(false)
  const [deezerTesting, setDeezerTesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [unfinishedPage, setUnfinishedPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [loadError, setLoadError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const requestId = useRef(0)
  const cancelRequest = useCallback(() => { requestId.current++ }, [])

  const load = useCallback(async () => {
    const current = ++requestId.current
    try {
      const [q, u, s, d] = await Promise.all([admin.processingQueue(), admin.unfinished(), admin.storage(), admin.deezerConfig()])
      if (current !== requestId.current) return
      setQueue(q)
      setUnfinished(u)
      setStorage(s)
      setDeezerConfig(previous => ({ ...previous, ...d }))
      setLoadError('')
    } catch (error) {
      if (current === requestId.current) setLoadError(errorMessage(error))
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      await load()
      if (!cancelled) timer = setTimeout(refresh, 5000)
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer); cancelRequest() }
  }, [load, cancelRequest])

  const runChecks = async () => {
    setRunning(true)
    try {
      const r = await admin.runChecks()
      setChecks(r)
      toast.success('Health checks complete')
    } catch {
      toast.error('Health checks failed')
    }
    setRunning(false)
  }

  const handleSaveDeezerArl = async () => {
    if (!deezerArl.trim()) {
      toast.error('Paste a Deezer ARL first')
      return
    }
    setDeezerSaving(true)
    try {
      const result = await admin.setDeezerArl(deezerArl.trim())
      if (result.error || result.status === 'error') {
        toast.error(result.success ? 'ARL saved, but the login test failed. Check the credential and try again.' : result.error || result.message || 'Deezer login failed')
      } else {
        toast.success('Deezer ARL saved and tested')
        setDeezerArl('')
      }
      if (result.success) setDeezerArl('')
      setDeezerConfig(result)
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save Deezer ARL'))
    }
    setDeezerSaving(false)
  }

  const handleTestDeezerArl = async () => {
    setDeezerTesting(true)
    try {
      const result = await admin.testDeezerArl(deezerArl.trim() || undefined)
      if (result.status === 'ok') toast.success('Deezer login active')
      else toast.error(result.message || result.error || 'Deezer login failed')
      setDeezerConfig(prev => ({ ...(prev || {}), ...result }))
    } catch (error) {
      toast.error(errorMessage(error, 'Deezer test failed'))
    }
    setDeezerTesting(false)
  }

  const unfinishedPages = Math.ceil(unfinished.length / PAGE_SIZE) || 1
  const currentPage = Math.min(unfinishedPage, unfinishedPages)
  const pagedUnfinished = unfinished.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return bytes + ' B'
  }

  if (loading) return <PageState title="Loading system status" loading />
  if (loadError) return <PageState title="System status unavailable" description={loadError} action={<button className={styles.primaryBtn} onClick={load}>Try again</button>} />

  return (
    <>
      {storage && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Storage</h3>
            <button className={styles.primaryBtn} onClick={() => setConfirmation({ title: 'Compress song audio?', description: 'This rewrites stored song audio in the background. Playback may be temporarily affected.', label: 'Start compression', action: admin.compressSongs, success: 'Compression started in background' })}>
              Compress songs
            </button>
          </div>
          <div className={styles.stats}>
            <div className={`${styles.statCard} ${styles.statCardPlays}`}>
              <div className={styles.statIcon} style={{ color: 'var(--success)' }}><FontAwesomeIcon icon={faHardDrive} /></div>
              <div className={styles.statValue}>{formatBytes(storage.disk_free)}</div>
              <div className={styles.statLabel}>Free of {formatBytes(storage.disk_total)}</div>
            </div>
            <div className={`${styles.statCard} ${styles.statCardDownloads}`}>
              <div className={styles.statIcon} style={{ color: '#6366f1' }}><FontAwesomeIcon icon={faMusic} /></div>
              <div className={styles.statValue}>{formatBytes(storage.songs_size)}</div>
              <div className={styles.statLabel}>{storage.songs_count} song{storage.songs_count !== 1 ? 's' : ''}</div>
            </div>
            <div className={`${styles.statCard} ${styles.statCardSearches}`}>
              <div className={styles.statIcon} style={{ color: 'var(--warning)' }}><FontAwesomeIcon icon={faDatabase} /></div>
              <div className={styles.statValue}>{formatBytes(storage.db_size)}</div>
              <div className={styles.statLabel}>Database</div>
            </div>
          </div>
          <div className={styles.storageBar}>
            <div className={styles.storageBarUsed} style={{ width: `${((storage.disk_used - storage.songs_size) / storage.disk_total) * 100}%` }} />
            <div className={styles.storageBarSongs} style={{ width: `${(storage.songs_size / storage.disk_total) * 100}%` }} />
          </div>
          <div className={styles.storageBarLegend}>
            <span><span className={styles.legendDot} style={{ background: 'var(--text-muted)' }} /> System ({formatBytes(storage.disk_used - storage.songs_size)})</span>
            <span><span className={styles.legendDot} style={{ background: 'var(--primary)' }} /> Songs ({formatBytes(storage.songs_size)})</span>
            <span><span className={styles.legendDot} style={{ background: 'var(--border)' }} /> Free ({formatBytes(storage.disk_free)})</span>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h3>Deezer ARL</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--spacing-md)' }}>
          Current: {deezerConfig?.masked || 'not configured'}
          {deezerConfig?.status && ` · Last test: ${deezerConfig.status}${deezerConfig.message ? ` (${deezerConfig.message})` : ''}`}
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            aria-label="New Deezer ARL"
            value={deezerArl}
            onChange={e => setDeezerArl(e.target.value)}
            placeholder="Paste new Deezer ARL"
            autoComplete="off"
            style={{
              flex: '1 1 360px',
              minWidth: 0,
              padding: '0.65rem 0.75rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          <button className={styles.primaryBtn} onClick={handleSaveDeezerArl} disabled={deezerSaving || deezerTesting || !deezerArl.trim()}>
            {deezerSaving ? 'Saving...' : 'Save & Test'}
          </button>
          <button className={styles.actionBtn} onClick={handleTestDeezerArl} disabled={deezerSaving || deezerTesting}>
            {deezerTesting ? 'Testing...' : 'Test'}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Health Checks</h3>
          <button className={styles.primaryBtn} onClick={runChecks} disabled={running}>
            {running ? 'Running...' : 'Run Checks'}
          </button>
        </div>
        <div className={styles.healthGrid}>
          {Object.keys(checks).length === 0 && <p className={styles.subtle}>Run checks to test the configured services.</p>}
          {Object.entries(checks).map(([name, check]) => (
            <div key={name} className={`${styles.healthCard} ${check.status === 'ok' ? styles.healthCardOk : styles.healthCardError}`}>
              <div className={styles.healthTitle}>{name}</div>
              <div className={styles.healthMessage}>{check.message}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <h3>Processing Queue</h3>
        {Object.keys(queue).length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No active processing</p>}
        {Object.entries(queue).map(([id, status]) => (
          <div key={id} className={styles.songItem}>
            <div className={styles.songInfo}>
              <div className={styles.songTitle}>Track {id}</div>
              <div className={styles.songArtist}>{status.detail || status.status} - {status.progress}%</div>
            </div>
            <div style={{ width: 100, height: 4, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{ width: `${status.progress}%`, height: '100%', background: 'var(--gradient)', borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <h3>Unfinished Tracks ({unfinished.length})</h3>
        {unfinished.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No unfinished tracks</p>}
        {pagedUnfinished.map(t => (
          <div key={t.track_id} className={styles.songItem}>
            <div className={styles.songInfo}>
              <div className={styles.songTitle}>{t.title}</div>
              <div className={styles.songArtist}>{t.artist} &middot; Stage: {t.stage} &middot; Failures: {t.failure_count}</div>
              {t.error_message && <div style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 2 }}>{t.error_message.slice(0, 100)}</div>}
            </div>
            <button className={styles.actionBtn} aria-label={`Reprocess ${t.title}`} onClick={() => setConfirmation({ title: `Reprocess ${t.title}?`, description: 'This replaces generated audio and lyrics and may use paid processing services.', label: 'Reprocess track', action: () => admin.reprocessSong(t.track_id), success: 'Reprocessing started' })} title="Reprocess"><FontAwesomeIcon icon={faRotateRight} /></button>
            <button className={`${styles.actionBtn} ${styles.dangerBtn}`} aria-label={`Delete ${t.title}`} onClick={() => setConfirmation({ title: `Delete ${t.title}?`, description: 'The track and its generated files will be permanently removed for everyone.', label: 'Delete track', action: () => admin.deleteSong(t.track_id), success: 'Track deleted' })} title="Delete"><FontAwesomeIcon icon={faTrash} /></button>
          </div>
        ))}
        {unfinishedPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.actionBtn} disabled={currentPage <= 1} onClick={() => setUnfinishedPage(currentPage - 1)}>Previous</button>
            <span className={styles.pageInfo}>Page {currentPage} of {unfinishedPages}</span>
            <button className={styles.actionBtn} disabled={currentPage >= unfinishedPages} onClick={() => setUnfinishedPage(currentPage + 1)}>Next</button>
          </div>
        )}
      </div>
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
    </>
  )
}
