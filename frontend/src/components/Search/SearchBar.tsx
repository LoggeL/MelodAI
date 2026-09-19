import { useState, useRef, useCallback, useEffect, useId, forwardRef, useImperativeHandle } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { tracks } from '../../services/api'
import type { SearchResult } from '../../types'
import styles from './SearchBar.module.css'

interface Props {
  onSelect: (id: string, meta: { title: string; artist: string; img_url: string | null }) => void
}

export interface SearchBarHandle {
  search: (query: string) => void
}

export const SearchBar = forwardRef<SearchBarHandle, Props>(function SearchBar({ onSelect }, ref) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
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
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.')
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

  useImperativeHandle(ref, () => ({
    search: (q: string) => {
      startSearch(q, true)
      inputRef.current?.focus()
    },
  }), [startSearch])

  const handleClear = useCallback(() => {
    startSearch('')
    inputRef.current?.focus()
  }, [startSearch])

  const handleSelect = useCallback((item: SearchResult) => {
    cancelSearch()
    setQuery('')
    setResults([])
    setLoading(false)
    setShowResults(false)
    setActiveIndex(-1)
    onSelect(item.id, { title: item.title, artist: item.artist, img_url: item.img_url })
  }, [cancelSearch, onSelect])

  useEffect(() => cancelSearch, [cancelSearch])

  useEffect(() => {
    if (showResults && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, showResults, listId])

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  return (
    <div className={styles.wrapper} ref={wrapperRef} onBlur={e => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShowResults(false)
    }}>
      <span className={styles.icon}><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search for a song"
        aria-autocomplete="list"
        aria-expanded={showResults}
        aria-controls={showResults ? listId : undefined}
        aria-activedescendant={showResults && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        className={styles.input}
        placeholder="Search for a song..."
        value={query}
        onChange={e => startSearch(e.target.value)}
        onFocus={() => { if (query.trim().length >= 2) setShowResults(true) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setShowResults(false); setActiveIndex(-1) }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setShowResults(true)
            if (results.length) setActiveIndex(index => e.key === 'ArrowDown'
              ? (index + 1) % results.length
              : (index <= 0 ? results.length - 1 : index - 1))
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (showResults && activeIndex >= 0 && results[activeIndex]) handleSelect(results[activeIndex])
            else startSearch(query, true)
          }
        }}
        autoComplete="off"
      />
      {query && <button type="button" className={styles.clear} onClick={handleClear} aria-label="Clear search"><FontAwesomeIcon icon={faXmark} /></button>}
      {showResults && (
        <div className={styles.results}>
          <div role="status" aria-live="polite">
            {loading && <p className={styles.spinner}>Searching...</p>}
            {!loading && error && <p className={styles.spinner}>{error}</p>}
            {!loading && !error && results.length === 0 && <p className={styles.spinner}>No songs found. Try another title or artist.</p>}
          </div>
          <div id={listId} role="listbox" aria-label="Song search results" aria-busy={loading}>
            {!loading && results.map((item, index) => (
              <div key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                className={`${styles.resultItem} ${index === activeIndex ? styles.resultActive : ''}`}
                onPointerDown={e => e.preventDefault()}
                onClick={() => handleSelect(item)}>
                <img src={item.img_url || '/logo.svg'} alt="" loading="lazy" />
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>{item.title}</div>
                  <div className={styles.resultArtist}>{item.artist}</div>
                </div>
                {libraryIds.has(item.id) && <span className={styles.libraryBadge}>In library</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
