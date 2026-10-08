import { errorMessage } from '../account/errors'
import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useToast } from '../../hooks/useToast'
import { admin } from '../../services/api'
import type { HealthCheck, StorageStats, UnfinishedTrack, ProcessingStatus, DeezerConfigStatus } from '../../types'
import { Icon } from '../../components/common/Icon'
import { PageState } from '../../components/common/PageState'
import { formatBytes, formatInt } from '../../utils/format'
import { de } from '../../utils/messages'
import { PIPELINE_STEPS, pipelineIndex, pipelineLabel } from '../../utils/pipeline'
import { ConfirmAction, type Confirmation } from './AdminAction'
import { LoadError, Pagination, SectionHead } from './shared'
import styles from '../AdminPage.module.css'

const PAGE_SIZE = 20

const CHECK_NAMES: Record<string, string> = {
  database: 'Datenbank', deezer: 'Deezer', filesystem: 'Speicher', replicate: 'Replicate', queue: 'Warteschlange', lrclib: 'lrclib', openrouter: 'OpenRouter', voxtral: 'Voxtral',
}

/** Health check texts come from the backend in English; translate the known shapes. */
function checkMessage(message: string) {
  const processing = message.match(/^(\d+) tracks processing$/)
  if (processing) return `${processing[1]} ${processing[1] === '1' ? 'Song' : 'Songs'} in Arbeit.`
  const free = message.match(/^([\d.]+) GB free$/)
  if (free) return `${free[1].replace('.', ',')} GB frei.`
  return de(message)
}

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
      toast.success('Prüfung abgeschlossen.')
    } catch {
      toast.error('Die Prüfung ist fehlgeschlagen.')
    }
    setRunning(false)
  }

  const handleSaveDeezerArl = async () => {
    if (!deezerArl.trim()) {
      toast.error('Füg zuerst einen Deezer-ARL ein.')
      return
    }
    setDeezerSaving(true)
    try {
      const result = await admin.setDeezerArl(deezerArl.trim())
      if (result.error || result.status === 'error') {
        toast.error(result.success ? 'ARL gespeichert, aber die Anmeldung ist fehlgeschlagen. Prüf den Wert und versuch es noch einmal.' : de(result.error || result.message || 'Deezer login failed'))
      } else {
        toast.success('Deezer-ARL gespeichert und getestet.')
        setDeezerArl('')
      }
      if (result.success) setDeezerArl('')
      setDeezerConfig(result)
    } catch (error) {
      toast.error(errorMessage(error, 'Der Deezer-ARL konnte nicht gespeichert werden.'))
    }
    setDeezerSaving(false)
  }

  const handleTestDeezerArl = async () => {
    setDeezerTesting(true)
    try {
      const result = await admin.testDeezerArl(deezerArl.trim() || undefined)
      if (result.status === 'ok') toast.success('Deezer-Anmeldung aktiv.')
      else toast.error(de(result.message || result.error || 'Deezer login failed'))
      setDeezerConfig(prev => ({ ...(prev || {}), ...result }))
    } catch (error) {
      toast.error(errorMessage(error, 'Der Deezer-Test ist fehlgeschlagen.'))
    }
    setDeezerTesting(false)
  }

  const unfinishedPages = Math.ceil(unfinished.length / PAGE_SIZE) || 1
  const currentPage = Math.min(unfinishedPage, unfinishedPages)
  const pagedUnfinished = unfinished.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const queueEntries = Object.entries(queue)
  const checkEntries = Object.entries(checks)

  if (loading) return <PageState title="Systemstatus wird geladen …" loading />
  if (loadError) return <LoadError title="Der Systemstatus ist gerade nicht verfügbar." error={loadError} onRetry={load} />

  const share = (bytes: number) => storage && storage.disk_total > 0 ? `${Math.max(0, (bytes / storage.disk_total) * 100)}%` : '0%'

  return (
    <>
      {storage && (
        <section className={styles.section}>
          <div className={`stats ${styles.statStrip}`}>
            <div className="stat"><b>{formatBytes(storage.disk_free)}</b><span className="kicker">Frei von {formatBytes(storage.disk_total)}</span></div>
            <div className="stat"><b>{formatBytes(storage.songs_size)}</b><span className="kicker">{formatInt(storage.songs_count)} {storage.songs_count === 1 ? 'Song' : 'Songs'}</span></div>
            <div className="stat"><b>{formatBytes(storage.db_size)}</b><span className="kicker">Datenbank</span></div>
            <div className={`stat ${queueEntries.length ? 'stat--work' : ''}`}><b>{formatInt(queueEntries.length)}</b><span className="kicker">In Arbeit</span></div>
            <div className={`stat ${unfinished.length ? 'stat--err' : ''}`}><b>{formatInt(unfinished.length)}</b><span className="kicker">Unfertig</span></div>
          </div>
          <SectionHead title="Speicher">
            <button type="button" className={styles.actionBtn} onClick={() => setConfirmation({ title: 'Song-Audio komprimieren?', description: 'Die gespeicherten Audiodateien werden im Hintergrund neu geschrieben. Die Wiedergabe kann kurz gestört sein.', label: 'Komprimierung starten', tone: 'neutral', action: admin.compressSongs, success: 'Komprimierung läuft im Hintergrund.' })}>
              <Icon name="disk" size={16} /> Songs komprimieren
            </button>
          </SectionHead>
          <div className={styles.storageBar} role="img" aria-label={`Belegt: System ${formatBytes(storage.disk_used - storage.songs_size)}, Songs ${formatBytes(storage.songs_size)}, frei ${formatBytes(storage.disk_free)}`}>
            <i className={styles.barSystem} style={{ width: share(storage.disk_used - storage.songs_size) } as CSSProperties} />
            <i className={styles.barSongs} style={{ width: share(storage.songs_size) } as CSSProperties} />
          </div>
          <div className={styles.legend}>
            <span><i className={styles.barSystem} /> System {formatBytes(storage.disk_used - storage.songs_size)}</span>
            <span><i className={styles.barSongs} /> Songs {formatBytes(storage.songs_size)}</span>
            <span><i className={styles.legendFree} /> Frei {formatBytes(storage.disk_free)}</span>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <SectionHead title="Dienste">
          <button type="button" className="btn btn--primary" onClick={runChecks} disabled={running} aria-busy={running}>
            <Icon name="pulse" /> {running ? 'Prüfung läuft …' : 'Prüfung starten'}
          </button>
        </SectionHead>
        {checkEntries.length === 0
          ? <p className={styles.subtle}>Starte die Prüfung, um Datenbank, Speicher, Deezer, Replicate und lrclib zu testen.</p>
          : <div className={styles.healthGrid}>
            {checkEntries.map(([name, check]) => (
              <div key={name} className={styles.healthCard}>
                <div className={styles.healthHead}>
                  <span className={styles.healthTitle}>{CHECK_NAMES[name] ?? name}</span>
                  <span className={`chip ${check.status === 'ok' ? 'chip--ok' : 'chip--err'}`}>{check.status === 'ok' ? 'OK' : 'Fehler'}</span>
                </div>
                <div className={styles.healthMessage}>{checkMessage(check.message)}</div>
              </div>
            ))}
          </div>}
      </section>

      <section className={styles.section}>
        <SectionHead title="Deezer-Zugang" />
        <p className={styles.sectionLead}>
          Aktuell: <span className={styles.mono}>{deezerConfig?.masked || 'nicht hinterlegt'}</span>
          {deezerConfig?.status && <> · Letzter Test: <span className={`chip ${deezerConfig.status === 'ok' ? 'chip--ok' : 'chip--err'}`}>{deezerConfig.status === 'ok' ? 'OK' : 'Fehler'}</span>{deezerConfig.message ? ` ${de(deezerConfig.message)}` : ''}</>}
        </p>
        <div className={styles.arlForm}>
          <input
            className="input"
            type="password"
            aria-label="Neuer Deezer-ARL"
            value={deezerArl}
            onChange={e => setDeezerArl(e.target.value)}
            placeholder="Neuen Deezer-ARL einfügen"
            autoComplete="off"
          />
          <button type="button" className="btn btn--primary" onClick={handleSaveDeezerArl} disabled={deezerSaving || deezerTesting || !deezerArl.trim()} aria-busy={deezerSaving}>
            {deezerSaving ? 'Wird gespeichert …' : 'Speichern und testen'}
          </button>
          <button type="button" className="btn" onClick={handleTestDeezerArl} disabled={deezerSaving || deezerTesting} aria-busy={deezerTesting}>
            {deezerTesting ? 'Wird getestet …' : 'Testen'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <SectionHead title="Verarbeitung läuft" count={queueEntries.length} />
        {queueEntries.length === 0 && <p className={styles.subtle}>Gerade wird nichts verarbeitet.</p>}
        {queueEntries.length > 0 && <div className={styles.queueList}>
          {queueEntries.map(([id, status]) => (
            <div key={id} className={styles.queueItem}>
              <div className={styles.cellStack}>
                <span className={styles.cellTitle}>Song <span className={styles.mono}>#{id}</span></span>
                <span className={styles.cellSub}>{pipelineLabel(status.status, status.progress)}{status.detail ? ` · ${status.detail}` : ''}</span>
              </div>
              <span className="meter meter--inst" aria-hidden="true"><i style={{ '--v': `${status.progress}%` } as CSSProperties} /></span>
            </div>
          ))}
        </div>}
      </section>

      <section className={styles.section}>
        <SectionHead title="Unfertige Songs" count={unfinished.length} />
        {unfinished.length === 0 ? <p className={styles.subtle}>Keine unfertigen Songs.</p> : <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th scope="col">Song</th><th scope="col">Schritt</th><th scope="col" className="num">Fehlversuche</th><th scope="col" className="num"><span className="sr-only">Aktionen</span></th></tr></thead>
            <tbody>{pagedUnfinished.map(t => (
              <tr key={t.track_id}>
                <td className="cell-main"><div className={styles.cellStack}>
                  <span className={styles.cellTitle}>{t.title}</span>
                  <span className={styles.cellSub}>{t.artist} · <span className={styles.mono}>#{t.track_id}</span></span>
                  {t.error_message && <span className={styles.cellError}>{t.error_message.slice(0, 160)}</span>}
                </div></td>
                <td data-label="Schritt" className="cell-inline"><span className="chip chip--err">{PIPELINE_STEPS[pipelineIndex(t.stage)].label}</span></td>
                <td data-label="Fehlversuche" className="num cell-inline">{formatInt(t.failure_count)}</td>
                <td className="num"><div className={styles.tableActions}>
                  <button type="button" className={`${styles.actionBtn} ${styles.reprocessWide}`} onClick={() => setConfirmation({ title: `„${t.title}“ neu verarbeiten?`, description: 'Audio und Lyrics werden neu erzeugt. Das kann kostenpflichtige Dienste nutzen.', label: 'Neu verarbeiten', tone: 'neutral', action: () => admin.reprocessSong(t.track_id), success: 'Verarbeitung gestartet.' })}><Icon name="redo" size={16} /> Neu verarbeiten</button>
                  <button type="button" className={`${styles.actionBtn} ${styles.iconOnly} ${styles.danger}`} aria-label={`${t.title} löschen`} title="Löschen" onClick={() => setConfirmation({ title: `„${t.title}“ löschen?`, description: 'Der Song und seine erzeugten Dateien verschwinden für alle.', label: 'Song löschen', action: () => admin.deleteSong(t.track_id), success: 'Song gelöscht.' })}><Icon name="trash" size={16} /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
        <Pagination page={currentPage} pages={unfinishedPages} onPage={setUnfinishedPage} label="Seiten der unfertigen Songs" />
      </section>
      {confirmation && <ConfirmAction confirmation={confirmation} onClose={() => setConfirmation(null)} onSuccess={load} />}
    </>
  )
}
