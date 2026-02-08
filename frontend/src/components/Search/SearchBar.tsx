import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { tracks } from '../../services/api'
import type { SearchResult } from '../../types'
import styles from './SearchBar.module.css'

interface Props {
  onSelect: (id: string, meta: { title: string; artist: string; img_url: string }) => void
}

export interface SearchBarHandle {
  search: (query: string) => void
}

export const SearchBar = forwardRef<SearchBarHandle, Props>(function SearchBar({ onSelect }, ref) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [loading, setLoading] = useState(false)
  const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch library track IDs on mount
  useEffect(() => {
    tracks.library()
      .then(lib => setLibraryIds(new Set(lib.map(t => t.id))))
      .catch(() => {})
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setShowResults(false); return }
    setLoading(true)
    setShowResults(true)
    try {
      const data = await tracks.search(q)
      setResults(data)
    } catch {
      setResults([])
    }
    setLoading(false)
  }, [])

  useImperativeHandle(ref, () => ({
    search: (q: string) => {
      setQuery(q)
      doSearch(q)
      inputRef.current?.focus()
    }
  }), [doSearch])

  const handleInput = useCallback((val: string) => {
    setQuery(val)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (val.trim().length < 2) { setShowResults(false); return }
    timeoutRef.current = setTimeout(() => doSearch(val.trim()), 300)
  }, [doSearch])

  const handleClear = useCallback(() => {
    setQuery('')
    setShowResults(false)
  }, [])

  const handleSelect = useCallback((item: SearchResult) => {
    onSelect(item.id, { title: item.title, artist: item.artist, img_url: item.img_url })
    setQuery('')
    setShowResults(false)
  }, [onSelect])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <span className={styles.icon}><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        placeholder="Search for a song..."
        value={query}
        onChange={e => handleInput(e.target.value)}
        autoComplete="off"
      />
      {query && (
        <button className={styles.clear} onClick={handleClear}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}

      {showResults && (
        <div className={styles.results}>
          {loading && <div className={styles.spinner}>Searching...</div>}
          {!loading && results.length === 0 && <div className={styles.spinner}>No results found</div>}
          {!loading && results.map(item => (
            <div key={item.id} className={styles.resultItem} onClick={() => handleSelect(item)}>
              <img src={item.img_url} alt="" loading="lazy" />
              <div className={styles.resultInfo}>
                <div className={styles.resultTitle}>{item.title}</div>
                <div className={styles.resultArtist}>{item.artist}</div>
              </div>
              {libraryIds.has(item.id) && (
                <span className={styles.libraryBadge}>IN LIBRARY</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
