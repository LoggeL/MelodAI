import { useEffect, useRef, useCallback } from 'react'

interface SyncQueueItem {
  id: string
  title: string
  artist: string
  thumbnail: string
}

export interface SyncState {
  queue: SyncQueueItem[]
  currentIndex: number
  isPlaying: boolean
  version: number
}

export interface SyncCommand {
  command: string
  payload: Record<string, unknown>
}

interface UseSyncOptions {
  enabled: boolean
  onSyncState: (state: SyncState) => void
  onCommand: (cmd: SyncCommand) => void
}

const CLIENT_ID_KEY = 'melodai_sync_client_id'

function getClientId(): string {
  let id = sessionStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

export function useSync({ enabled, onSyncState, onCommand }: UseSyncOptions) {
  const clientIdRef = useRef(getClientId())
  const versionRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const suppressUntilRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)

  // Keep callbacks in refs to avoid reconnecting on every render
  const onSyncStateRef = useRef(onSyncState)
  const onCommandRef = useRef(onCommand)
  onSyncStateRef.current = onSyncState
  onCommandRef.current = onCommand

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    const url = `/api/sync/stream?clientId=${clientIdRef.current}&lastVersion=${versionRef.current}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.addEventListener('sync_state', (e: MessageEvent) => {
      if (Date.now() < suppressUntilRef.current) return
      try {
        const state: SyncState = JSON.parse(e.data)
        versionRef.current = state.version
        onSyncStateRef.current(state)
      } catch { /* ignore parse errors */ }
    })

    es.addEventListener('command', (e: MessageEvent) => {
      if (Date.now() < suppressUntilRef.current) return
      try {
        const cmd: SyncCommand = JSON.parse(e.data)
        onCommandRef.current(cmd)
      } catch { /* ignore parse errors */ }
    })

    es.onopen = () => {
      backoffRef.current = 1000
    }

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
      // Reconnect with backoff
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30000)
        connect()
      }, backoffRef.current)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }
  }, [enabled, connect])

  const pushQueue = useCallback(
    (queue: SyncQueueItem[], currentIndex: number, isPlaying: boolean) => {
      suppressUntilRef.current = Date.now() + 500
      fetch('/api/sync/queue', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientIdRef.current,
        },
        body: JSON.stringify({ queue, currentIndex, isPlaying }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.version) versionRef.current = data.version
        })
        .catch(() => {})
    },
    [],
  )

  const sendCommand = useCallback(
    (command: string, payload: Record<string, unknown> = {}) => {
      suppressUntilRef.current = Date.now() + 500
      fetch('/api/sync/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientIdRef.current,
        },
        body: JSON.stringify({ command, payload }),
      }).catch(() => {})
    },
    [],
  )

  return { pushQueue, sendCommand }
}
