import { useCallback, useEffect, useState } from 'react'
import { tracks } from '../../services/api'
import type { SearchResult } from '../../types'

/** Every query owns its response, even when earlier requests finish later. */
export function useCatalogSearch(query: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const [state, setState] = useState<{ query: string; results: SearchResult[]; loading: boolean; error: string }>({
    query: '', results: [], loading: false, error: '',
  })
  const normalized = query.trim()
  useEffect(() => {
    if (!enabled || normalized.length < 2) return
    setState({ query: normalized, results: [], loading: true, error: '' })
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const results = await tracks.search(normalized)
        if (!cancelled) setState({ query: normalized, results, loading: false, error: '' })
      } catch (err) {
        if (!cancelled) setState({ query: normalized, results: [], loading: false,
          error: err instanceof Error ? err.message : 'Search failed. Please try again.' })
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, normalized, attempt])
  if (!enabled || normalized.length < 2) return { results: [], loading: false, error: '', retry }
  return { ...(state.query === normalized ? state : { results: [], loading: true, error: '' }), retry }
}
