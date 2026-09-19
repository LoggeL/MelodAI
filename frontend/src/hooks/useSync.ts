import { useEffect, useRef, useCallback, useState } from 'react'
import type { QueueMetadata } from '../utils/queue'

export interface SyncState { queue: QueueMetadata[]; currentIndex: number; isPlaying: boolean; version: number; initial?: boolean }
export interface SyncCommand { command: string; payload: Record<string, unknown> }
interface UseSyncOptions { enabled: boolean; onSyncState: (state: SyncState) => void; onCommand: (cmd: SyncCommand) => void }

export function useSync({ enabled, onSyncState, onCommand }: UseSyncOptions) {
  const [clientId] = useState(() => crypto.randomUUID())
  const versionRef = useRef(0)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const callbacksRef = useRef({ onSyncState, onCommand })
  callbacksRef.current = { onSyncState, onCommand }
  const outgoingRef = useRef<Promise<void>>(Promise.resolve())
  const localPlaybackIntentRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoff = 1000
    let firstHydration = true
    const connect = () => {
      if (cancelled) return
      const current = new EventSource(`/api/sync/stream?clientId=${encodeURIComponent(clientId)}&lastVersion=${versionRef.current}`)
      source = current
      current.addEventListener('sync_state', (event: MessageEvent) => {
        if (cancelled || source !== current) return
        try {
          const state: SyncState = JSON.parse(event.data)
          if (!Array.isArray(state.queue) || !Number.isInteger(state.version) || state.version <= versionRef.current || typeof state.isPlaying !== 'boolean') return
          versionRef.current = state.version
          // A Play gesture made while this first connection opens owns the
          // selection. Only its saved snapshot is stale; live changes and
          // snapshots after reconnect must still control this player.
          if (state.initial === true && firstHydration && localPlaybackIntentRef.current) return
          callbacksRef.current.onSyncState(state)
        } catch { /* Ignore malformed events. */ }
      })
      current.addEventListener('sync_ready', () => {
        if (!cancelled && source === current) firstHydration = false
      })
      current.addEventListener('command', (event: MessageEvent) => {
        if (cancelled || source !== current) return
        try {
          const command: SyncCommand = JSON.parse(event.data)
          if (typeof command.command === 'string') callbacksRef.current.onCommand(command)
        } catch { /* Ignore malformed events. */ }
      })
      current.onopen = () => { backoff = 1000 }
      current.onerror = () => {
        if (cancelled || source !== current) return
        firstHydration = false
        current.close()
        source = null
        timer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 30000)
      }
    }
    connect()
    return () => { cancelled = true; source?.close(); clearTimeout(timer) }
  }, [enabled, clientId])

  // Serialize writes so a slower old queue cannot overwrite a newer one.
  const send = useCallback((path: string, method: string, body: unknown) => {
    if (!enabledRef.current) return
    outgoingRef.current = outgoingRef.current.then(async () => {
      if (!enabledRef.current) return
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId }, body: JSON.stringify(body) })
      if (!response.ok) return
      const data = await response.json()
      if (Number.isInteger(data.version)) versionRef.current = Math.max(versionRef.current, data.version)
    }).catch(() => {})
  }, [clientId])

  useEffect(() => { enabledRef.current = enabled; return () => { enabledRef.current = false } }, [enabled])

  const pushQueue = useCallback((queue: QueueMetadata[], currentIndex: number, isPlaying: boolean) => {
    send('/api/sync/queue', 'PUT', { queue, currentIndex, isPlaying: isPlaying && currentIndex >= 0 })
  }, [send])
  const sendCommand = useCallback((command: string, payload: Record<string, unknown> = {}) => {
    send('/api/sync/command', 'POST', { command, payload })
  }, [send])
  const markPlaybackIntent = useCallback(() => { localPlaybackIntentRef.current = true }, [])
  return { pushQueue, sendCommand, markPlaybackIntent }
}
