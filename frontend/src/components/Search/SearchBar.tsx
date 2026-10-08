import { useState, useRef, useCallback, useEffect, useId, forwardRef, useImperativeHandle, useMemo, type CSSProperties } from 'react'
import { tracks } from '../../services/api'
import type { QueueItem, SearchResult, SongMeta } from '../../types'
import { Icon } from '../common/Icon'
import { Cover } from '../common/Cover'
import { de } from '../../utils/messages'
import { pipelineLabel } from '../../utils/pipeline'
import { formatDuration } from '../../utils/format'
import styles from './SearchBar.module.css'

interface Props {
  onSelect: (id: string, meta: SongMeta) => void
  /** Credits shown in the „Neu laden“ group (non-admins only). */
  credits?: number
  isAdmin?: boolean
  /** Current song, shown as „Läuft“. */
  currentId?: string
  /** Setlist entries, used for „Stimmtrennung 40 %“ chips on songs that are still being prepared. */
  queue?: QueueItem[]
}

export interface SearchBarHandle {
  search: (query: string) => void
  /** Focuses the field on desktop or opens the full-screen sheet on phones. */
  open: () => void
}

const RECENT_KEY = 'recentSearches'
function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : []
  } catch { return [] }
}
function storeRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))) } catch { /* Storage is optional. */ }
}
const isDesktop = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark className={styles.match}>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>
}

export const SearchBar = forwardRef<SearchBarHandle, Props>(function SearchBar({ onSelect, credits, isAdmin = false, currentId, queue = [] }, ref) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    let cancelled = false
    tracks.library().then(lib => {
      if (!cancelled) setLibraryIds(new Set(lib.filter(t => t.complete).map(t => t.id)))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const cancelSearch = useCallback(() => {
    searchSeqRef.current += 1
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const doSearch = useCallback(async (q: string, seq: number) => {
    try {
      const data = await tracks.search(q)
      if (seq !== searchSeqRef.current) return
      setResults(data)
    } catch (err) {
      if (seq !== searchSeqRef.current) return
      setResults([])
      setError(err instanceof Error ? de(err.message) : 'Die Suche ist gerade nicht erreichbar.')
    } finally {
      if (seq === searchSeqRef.current) setLoading(false)
    }
  }, [])

  const startSearch = useCallback((value: string, immediate = false) => {
    cancelSearch()
    setQuery(value)
    setActiveIndex(-1)
    setResults([])
    setError('')
    const q = value.trim()
    const canSearch = q.length >= 2
    setShowResults(canSearch)
    setLoading(canSearch)
    if (!canSearch) return
    const seq = searchSeqRef.current
    if (immediate) void doSearch(q, seq)
    else timeoutRef.current = setTimeout(() => void doSearch(q, seq), 300)
  }, [cancelSearch, doSearch])

  const open = useCallback(() => {
    if (!isDesktop()) setSheetOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    setShowResults(false)
    setActiveIndex(-1)
    triggerRef.current?.focus()
  }, [])

  useImperativeHandle(ref, () => ({
    search: (q: string) => {
      if (!isDesktop()) setSheetOpen(true)
      startSearch(q, true)
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    open,
  }), [startSearch, open])

  const handleClear = useCallback(() => {
    startSearch('')
    inputRef.current?.focus()
  }, [startSearch])

  const handleSelect = useCallback((item: SearchResult) => {
    const q = query.trim()
    if (q) {
      const next = [q, ...recent.filter(entry => entry.toLowerCase() !== q.toLowerCase())].slice(0, 6)
      setRecent(next)
      storeRecent(next)
    }
    cancelSearch()
    setQuery('')
    setResults([])
    setLoading(false)
    setShowResults(false)
    setActiveIndex(-1)
    setSheetOpen(false)
    onSelect(item.id, { title: item.title, artist: item.artist, img_url: item.img_url, duration: item.duration })
  }, [cancelSearch, onSelect, query, recent])

  useEffect(() => cancelSearch, [cancelSearch])

  // „/“ opens the search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable=true], dialog, [role=dialog]')) return
      event.preventDefault()
      open()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeSheet() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen, closeSheet])

  // Close the popover when the viewport crosses to the sheet layout and back.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 900px)')
    const onChange = () => setSheetOpen(false)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  const ordered = useMemo(() => {
    const library = results.filter(item => libraryIds.has(item.id))
    const fresh = results.filter(item => !libraryIds.has(item.id))
    return { library, fresh, all: [...library, ...fresh] }
  }, [results, libraryIds])

  useEffect(() => {
    if (showResults && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, showResults, listId])

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!sheetOpen && !wrapperRef.current?.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [sheetOpen])

  const queueById = useMemo(() => new Map(queue.map(item => [item.id, item])), [queue])

  const renderOption = (item: SearchResult, index: number, inLibrary: boolean) => {
    const queued = queueById.get(item.id)
    const processing = queued && !queued.ready && !queued.error
    const playing = item.id === currentId
    return (
      <div key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
        className={`${styles.resultItem} ${index === activeIndex ? styles.resultActive : ''}`}
        onPointerDown={e => e.preventDefault()}
        onPointerEnter={() => setActiveIndex(index)}
        onClick={() => handleSelect(item)}>
        <Cover className={styles.cover} src={item.img_url} />
        <div className={styles.resultInfo}>
          <div className={styles.resultTitle}><Highlight text={item.title} query={query} /></div>
          <div className={styles.resultArtist}><Highlight text={item.artist} query={query} />{item.album ? <span className={styles.album}> · {item.album}</span> : null}</div>
          {processing && <span className={`meter meter--inst meter--thin ${styles.bar}`} aria-hidden="true"><i style={{ '--v': `${queued.progress}%` } as CSSProperties} /></span>}
        </div>
        {item.duration ? <span className={styles.duration}>{formatDuration(item.duration)}</span> : <span aria-hidden="true" />}
        <span className={styles.action}>
          {playing ? <span className="chip chip--live chip--solid"><span className="live-dot" aria-hidden="true" />Läuft</span>
            : processing ? <span className="chip chip--work">{pipelineLabel(queued.status, queued.progress)}</span>
            : <span className={styles.addLabel}><Icon name="plus" size={16} /><span className={styles.addText}>{inLibrary ? 'Setlist' : 'Hinzufügen'}</span></span>}
        </span>
      </div>
    )
  }

  const trimmed = query.trim()
  const showEmptySheet = sheetOpen && trimmed.length < 2

  return (
    <div ref={wrapperRef}
      className={`${styles.wrapper} ${sheetOpen ? styles.sheetOpen : ''}`}
      role={sheetOpen ? 'dialog' : undefined} aria-modal={sheetOpen || undefined} aria-label={sheetOpen ? 'Suche' : undefined}
      onBlur={e => { if (!sheetOpen && !e.currentTarget.contains(e.relatedTarget as Node | null)) setShowResults(false) }}>
      <button ref={triggerRef} type="button" className={`iconbtn ${styles.trigger}`} aria-label="Suchen" title="Suchen ( / )" onClick={open}>
        <Icon name="search" />
      </button>
      <div className={styles.field}>
        <button type="button" className={`iconbtn ${styles.back}`} aria-label="Suche schließen" onClick={closeSheet}>
          <Icon name="arrow-left" />
        </button>
        <span className={styles.icon} aria-hidden="true"><Icon name="search" size={18} /></span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          data-testid="search-input"
          aria-label="Song oder Interpret suchen"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? listId : undefined}
          aria-activedescendant={showResults && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          className={styles.input}
          placeholder="Song oder Interpret suchen"
          value={query}
          onChange={e => startSearch(e.target.value)}
          onFocus={() => { if (query.trim().length >= 2) setShowResults(true) }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              if (sheetOpen) { e.preventDefault(); e.stopPropagation(); closeSheet() }
              else { setShowResults(false); setActiveIndex(-1) }
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setShowResults(true)
              const count = ordered.all.length
              if (count) setActiveIndex(index => e.key === 'ArrowDown'
                ? (index + 1) % count
                : (index <= 0 ? count - 1 : index - 1))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (showResults && activeIndex >= 0 && ordered.all[activeIndex]) handleSelect(ordered.all[activeIndex])
              else startSearch(query, true)
            }
          }}
          autoComplete="off"
          enterKeyHint="search"
        />
        {query
          ? <button type="button" className={styles.clear} onClick={handleClear} aria-label="Suche leeren"><Icon name="x" size={18} /></button>
          : <kbd className={styles.kbd} aria-hidden="true">/</kbd>}
      </div>

      {showEmptySheet && (
        <div className={styles.recent}>
          {recent.length > 0 && (
            <>
              <h2 className="kicker">Zuletzt gesucht</h2>
              <div className={styles.recentChips}>
                {recent.map(entry => (
                  <button key={entry} type="button" className="chip" onClick={() => { startSearch(entry, true); inputRef.current?.focus() }}>
                    <Icon name="clock" size={14} /> {entry}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className={styles.tip}>Tipp: Suche nach Titel oder Interpret. Songs aus deiner Bibliothek sind sofort singbar.</p>
        </div>
      )}

      {showResults && (
        <div className={styles.results}>
          <div role="status" aria-live="polite" className={styles.state}>
            {loading && <div className={styles.loading}><span className="spinner" aria-hidden="true" /><span className="spinner-text">Lädt …</span> Sucht nach „{trimmed}“ …</div>}
            {!loading && error && (
              <div className={`error-panel ${styles.error}`}>
                <Icon name="alert" size={24} />
                <h3>Die Suche ist gerade nicht erreichbar.</h3>
                {error !== 'Die Suche ist gerade nicht erreichbar.' && <p>{error}</p>}
                <button type="button" className="btn" onMouseDown={e => e.preventDefault()} onClick={() => startSearch(query, true)}><Icon name="redo" /> Erneut versuchen</button>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="emptyState">
                <Icon name="search" size={48} />
                <h3>Nichts gefunden für „{trimmed}“.</h3>
                <p>Versuch’s mit dem Interpreten oder einer anderen Schreibweise.</p>
              </div>
            )}
          </div>
          <div id={listId} role="listbox" aria-label="Suchergebnisse" aria-busy={loading} className={styles.list}>
            {!loading && ordered.library.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-lib`}>
                <div id={`${listId}-lib`} className={`kicker ${styles.groupHead}`}>In deiner Bibliothek · sofort singbar</div>
                {ordered.library.map((item, i) => renderOption(item, i, true))}
              </div>
            )}
            {!loading && ordered.fresh.length > 0 && (
              <div role="group" aria-labelledby={`${listId}-new`}>
                <div id={`${listId}-new`} className={`kicker ${styles.groupHead}`}>
                  <span>Neu laden · 5 Credits pro Song · ca. 2 Min.</span>
                  {!isAdmin && credits != null && <span className={styles.balance}>Guthaben {credits}</span>}
                </div>
                {ordered.fresh.map((item, i) => renderOption(item, ordered.library.length + i, false))}
              </div>
            )}
          </div>
          {!loading && results.length > 0 && <div className={styles.footer} aria-hidden="true">↑↓ auswählen · Enter hinzufügen · Esc schließen</div>}
        </div>
      )}
    </div>
  )
})
